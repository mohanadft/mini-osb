import { instances, provisionInstance, deprovisionInstance } from './broker.js';
import { getPodStatus } from './k8s.js';

export async function listInstances(req, res) {
  const list = await Promise.all(
    [...instances.entries()].map(async ([id, data]) => ({
      id,
      ...data,
      podStatus: await getPodStatus(id),
      credentials: { host: id, port: 6379, password: '' },
    }))
  );
  return res.json(list);
}

export async function createInstance(req, res) {
  const { id } = req.body ?? {};
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id is required' });
  }
  const valid = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(id);
  if (!valid) {
    return res.status(400).json({ error: 'ID must be lowercase alphanumeric + hyphens, 1–63 chars, no leading/trailing hyphens' });
  }
  try {
    const status = await provisionInstance(id);
    return res.status(status).json({ id });
  } catch (err) {
    return res.status(500).json({ error: err.body?.message ?? err.message });
  }
}

export async function removeInstance(req, res) {
  const { id } = req.params;
  try {
    const status = await deprovisionInstance(id);
    return res.status(status).json({});
  } catch (err) {
    return res.status(500).json({ error: err.body?.message ?? err.message });
  }
}
