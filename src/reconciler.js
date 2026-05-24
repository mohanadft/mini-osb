import { readFile } from 'fs/promises';
import { load as parseYaml } from 'js-yaml';
import { instances, provisionInstance, deprovisionInstance } from './broker.js';
import { listManagedDeployments } from './k8s.js';
import { lookupService } from './catalog.js';

const DEFAULT_SERVICE = 'redis';
const DEFAULT_PLAN    = 'small';

// Last reconcile result — surfaced via GET /api/reconcile-status
export const reconcileStatus = {
  lastRun:   null,
  created:   [],
  deleted:   [],
  unchanged: [],
  errors:    [],
  running:   false,
};

export async function reconcile(configPath) {
  if (reconcileStatus.running) return { skipped: true };
  reconcileStatus.running = true;

  try {
    // ── 1. Read desired state ──────────────────────────────────────────────
    const raw    = await readFile(configPath, 'utf8');
    const config = parseYaml(raw) ?? {};
    const desired = new Map(
      (config.instances ?? []).map(entry => [
        entry.id,
        {
          service: entry.service ?? DEFAULT_SERVICE,
          plan:    entry.plan    ?? DEFAULT_PLAN,
        },
      ])
    );

    // ── 2. Read actual state from Kubernetes ───────────────────────────────
    const actualIds = await listManagedDeployments();
    const actual    = new Set(actualIds);

    // ── 3. Sync in-memory Map with k8s reality ─────────────────────────────
    for (const id of actual) {
      if (!instances.has(id)) {
        // Re-adopt: pod exists in k8s but not in memory (broker restarted)
        // Use desired config if available, otherwise fall back to defaults
        const cfg = desired.get(id);
        const svc = lookupService(cfg?.service ?? DEFAULT_SERVICE, cfg?.plan ?? DEFAULT_PLAN);
        instances.set(id, {
          serviceId:   svc.serviceId,
          planId:      svc.planId,
          serviceName: cfg?.service ?? DEFAULT_SERVICE,
          planName:    cfg?.plan    ?? DEFAULT_PLAN,
          port:        svc.port,
          uriScheme:   svc.uriScheme,
          createdAt:   Date.now(),
        });
      }
    }
    // Drop entries that no longer exist in k8s
    for (const [id] of instances) {
      if (!actual.has(id)) instances.delete(id);
    }

    // ── 4. Diff ────────────────────────────────────────────────────────────
    const toCreate = [...desired.keys()].filter(id => !actual.has(id));
    const toDelete = [...actual].filter(id => !desired.has(id));
    const toKeep   = [...desired.keys()].filter(id => actual.has(id));

    const created = [];
    const deleted = [];
    const errors  = [];

    // ── 5. Converge ────────────────────────────────────────────────────────
    await Promise.all([
      ...toCreate.map(async id => {
        const { service, plan } = desired.get(id);
        try {
          await provisionInstance(id, service, plan);
          created.push(id);
          console.log(`[reconcile] + created  ${id} (${service}/${plan})`);
        } catch (err) {
          errors.push({ id, action: 'create', error: err.body?.message ?? err.message });
          console.error(`[reconcile] ! error creating ${id}:`, err.body?.message ?? err.message);
        }
      }),
      ...toDelete.map(async id => {
        try {
          await deprovisionInstance(id);
          deleted.push(id);
          console.log(`[reconcile] - deleted  ${id}`);
        } catch (err) {
          errors.push({ id, action: 'delete', error: err.body?.message ?? err.message });
          console.error(`[reconcile] ! error deleting ${id}:`, err.body?.message ?? err.message);
        }
      }),
    ]);

    if (toKeep.length && !created.length && !deleted.length && !errors.length) {
      console.log(`[reconcile] ✓ nothing to do (${toKeep.length} instance${toKeep.length === 1 ? '' : 's'} already match)`);
    }

    Object.assign(reconcileStatus, {
      lastRun:   new Date().toISOString(),
      created,
      deleted,
      unchanged: toKeep,
      errors,
      running:   false,
    });

    return { created, deleted, unchanged: toKeep, errors };
  } catch (err) {
    const error = err.message ?? String(err);
    console.error('[reconcile] fatal:', error);
    Object.assign(reconcileStatus, {
      lastRun: new Date().toISOString(),
      errors:  [{ action: 'reconcile', error }],
      running: false,
    });
    throw err;
  }
}
