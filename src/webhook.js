import { createHmac, timingSafeEqual } from 'crypto';
import { provisionInstance, deprovisionInstance } from './broker.js';
import { reconcile } from './reconciler.js';

// Default service used for branch-based provisioning
const DEFAULT_SERVICE = process.env.BRANCH_SERVICE ?? 'redis';
const DEFAULT_PLAN    = process.env.BRANCH_PLAN    ?? 'small';

function verifySignature(secret, rawBody, signature) {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function branchToInstanceId(branch) {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

function touchedConfigFile(body) {
  const files = [
    ...(body.head_commit?.added    ?? []),
    ...(body.head_commit?.modified ?? []),
    ...(body.head_commit?.removed  ?? []),
  ];
  return files.includes('instances.yaml');
}

export function createWebhookHandler(secret, configPath) {
  return async (req, res) => {
    const signature = req.headers['x-hub-signature-256'];
    if (!signature) {
      return res.status(400).json({ description: 'Missing X-Hub-Signature-256 header.' });
    }
    if (!verifySignature(secret, req.rawBody, signature)) {
      return res.status(401).json({ description: 'Invalid signature.' });
    }

    const event  = req.headers['x-github-event'];
    if (event !== 'push' || !req.body.ref?.startsWith('refs/heads/')) {
      return res.status(200).json({ description: 'Event ignored.' });
    }

    const branch = req.body.ref.replace('refs/heads/', '');

    // ── Push to main that touches instances.yaml → GitOps reconcile ────────
    if (branch === 'main' && touchedConfigFile(req.body)) {
      console.log('\n[webhook] instances.yaml changed on main → reconciling...');
      try {
        const result = await reconcile(configPath);
        console.log(`[webhook] reconcile done — +${result.created.length} -${result.deleted.length}`);
        return res.status(200).json({ description: 'Reconciled.', ...result });
      } catch (err) {
        console.error('[webhook] reconcile failed:', err.message);
        return res.status(500).json({ description: err.message });
      }
    }

    // ── Feature branch create → provision ──────────────────────────────────
    // ── Feature branch delete → deprovision ────────────────────────────────
    // Only react to create/delete, not every push (avoids provisioning on merge commits)
    if (!req.body.deleted && !req.body.created) {
      return res.status(200).json({ description: 'Not a branch creation or deletion. Ignored.' });
    }

    const instanceId = branchToInstanceId(branch);

    if (req.body.deleted) {
      console.log(`\n[webhook] Branch deleted: "${branch}" → deprovisioning "${instanceId}"`);
      try {
        await deprovisionInstance(instanceId);
        console.log(`[webhook] Deprovisioned "${instanceId}" ✓`);
        return res.status(200).json({ description: `Deprovisioned ${instanceId}.` });
      } catch (err) {
        console.error('[webhook] Deprovision failed:', err.body || err.message);
        return res.status(500).json({ description: err.body?.message || err.message });
      }
    }

    console.log(`\n[webhook] Branch created: "${branch}" → provisioning "${instanceId}"`);
    try {
      const status = await provisionInstance(instanceId, DEFAULT_SERVICE, DEFAULT_PLAN);
      const label  = status === 201 ? 'created ✓' : 'already exists, skipped';
      console.log(`[webhook] Instance "${instanceId}" ${label}`);
      return res.status(200).json({ description: `Provisioned ${instanceId}.` });
    } catch (err) {
      console.error('[webhook] Provision failed:', err.body || err.message);
      return res.status(500).json({ description: err.body?.message || err.message });
    }
  };
}
