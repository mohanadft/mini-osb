import { readFile } from 'fs/promises';
import { load as parseYaml } from 'js-yaml';
import { instances, provisionInstance, deprovisionInstance } from './broker.js';
import { listManagedDeployments } from './k8s.js';

const SERVICE_ID = 'redis-service-0001';
const PLAN_ID    = 'redis-plan-small-0001';

// Last reconcile result — surfaced via GET /api/reconcile-status
export const reconcileStatus = {
  lastRun:   null,   // ISO timestamp
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
    const raw     = await readFile(configPath, 'utf8');
    const config  = parseYaml(raw) ?? {};
    const desired = new Map(
      (config.instances ?? []).map(entry => [
        entry.id,
        { planId: entry.plan ?? 'small', serviceId: SERVICE_ID },
      ])
    );

    // ── 2. Read actual state from Kubernetes ───────────────────────────────
    const actualIds = await listManagedDeployments();
    const actual    = new Set(actualIds);

    // ── 3. Sync in-memory Map with k8s reality ─────────────────────────────
    // Re-adopt pods that exist in k8s but were lost from memory (e.g. restart)
    for (const id of actual) {
      if (!instances.has(id)) {
        instances.set(id, {
          serviceId: SERVICE_ID,
          planId: PLAN_ID,
          createdAt: Date.now(),
        });
      }
    }
    // Drop entries that no longer exist in k8s
    for (const [id] of instances) {
      if (!actual.has(id)) instances.delete(id);
    }

    // ── 4. Diff ────────────────────────────────────────────────────────────
    const toCreate    = [...desired.keys()].filter(id => !actual.has(id));
    const toDelete    = [...actual].filter(id => !desired.has(id));
    const toKeep      = [...desired.keys()].filter(id => actual.has(id));

    const created   = [];
    const deleted   = [];
    const errors    = [];

    // ── 5. Converge ────────────────────────────────────────────────────────
    await Promise.all([
      ...toCreate.map(async id => {
        try {
          await provisionInstance(id, SERVICE_ID, PLAN_ID);
          created.push(id);
          console.log(`[reconcile] + created  ${id}`);
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
      errors: [{ action: 'reconcile', error }],
      running: false,
    });
    throw err;
  }
}

