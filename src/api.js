import { instances, provisionInstance, deprovisionInstance } from './broker.js';
import { getPodInfo } from './k8s.js';

export async function listInstances(req, res) {
  const list = await Promise.all(
    [...instances.entries()].map(async ([id, data]) => {
      const { status, createdAt } = await getPodInfo(id);
      return {
        id,
        ...data,
        podStatus: status,
        createdAt: createdAt ?? data.createdAt,
        credentials: { host: id, port: data.port, password: '' },
      };
    })
  );
  return res.json(list);
}

export async function createInstance(req, res) {
  const { id, service = 'redis', plan = 'small' } = req.body ?? {};
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id is required' });
  }
  const valid = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(id);
  if (!valid) {
    return res.status(400).json({ error: 'ID must be lowercase alphanumeric + hyphens, 1–63 chars, no leading/trailing hyphens' });
  }
  try {
    const status = await provisionInstance(id, service, plan);
    return res.status(status).json({ id });
  } catch (err) {
    const code = err.statusCode === 400 ? 400 : 500;
    return res.status(code).json({ error: err.body?.message ?? err.message });
  }
}

const K8S_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export async function removeInstance(req, res) {
  const { id } = req.params;
  if (!K8S_NAME_RE.test(id)) {
    return res.status(400).json({ error: 'Invalid instance ID' });
  }
  try {
    const status = await deprovisionInstance(id);
    return res.status(status).json({});
  } catch (err) {
    if (err.statusCode === 403) {
      return res.status(403).json({ error: err.message });
    }
    return res.status(500).json({ error: err.body?.message ?? err.message });
  }
}
