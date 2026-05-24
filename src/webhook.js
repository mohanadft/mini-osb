import { createHmac, timingSafeEqual } from 'crypto';
import { provisionInstance, deprovisionInstance } from './broker.js';

const SERVICE_ID = 'redis-service-0001';
const PLAN_ID = 'redis-plan-small-0001';

function verifySignature(secret, rawBody, signature) {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // Buffers must be same length for timingSafeEqual
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Kubernetes names must be lowercase alphanumeric + hyphens, max 63 chars
function branchToInstanceId(branch) {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

export function createWebhookHandler(secret) {
  return async (req, res) => {
    const signature = req.headers['x-hub-signature-256'];
    if (!signature) {
      return res.status(400).json({ description: 'Missing X-Hub-Signature-256 header.' });
    }

    if (!verifySignature(secret, req.rawBody, signature)) {
      return res.status(401).json({ description: 'Invalid signature.' });
    }

    const event = req.headers['x-github-event'];

    // Only handle push events on branches
    if (event !== 'push' || !req.body.ref?.startsWith('refs/heads/')) {
      return res.status(200).json({ description: 'Event ignored.' });
    }

    const branch = req.body.ref.replace('refs/heads/', '');
    const instanceId = branchToInstanceId(branch);

    if (req.body.deleted) {
      console.log(`\n[webhook] Branch deleted: "${branch}" → deprovisioning "${instanceId}"`);
      try {
        await deprovisionInstance(instanceId);
        console.log(`[webhook] Deprovisioned "${instanceId}" ✓`);
        return res.status(200).json({ description: `Deprovisioned ${instanceId}.` });
      } catch (err) {
        console.error(`[webhook] Deprovision failed:`, err.body || err.message);
        return res.status(500).json({ description: err.body?.message || err.message });
      }
    }

    console.log(`\n[webhook] Branch pushed: "${branch}" → provisioning "${instanceId}"`);
    try {
      const status = await provisionInstance(instanceId, SERVICE_ID, PLAN_ID);
      const label = status === 201 ? 'created ✓' : 'already exists, skipped';
      console.log(`[webhook] Instance "${instanceId}" ${label}`);
      return res.status(200).json({ description: `Provisioned ${instanceId}.` });
    } catch (err) {
      console.error(`[webhook] Provision failed:`, err.body || err.message);
      return res.status(500).json({ description: err.body?.message || err.message });
    }
  };
}
