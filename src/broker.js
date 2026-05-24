import { createInstance, deleteInstance } from './k8s.js';

// In-memory store: instanceId → { serviceId, planId }
export const instances = new Map();

const SERVICE_ID = 'redis-service-0001';
const PLAN_ID = 'redis-plan-small-0001';

// Core logic — used by both HTTP handlers and the webhook
export async function provisionInstance(instanceId, serviceId = SERVICE_ID, planId = PLAN_ID) {
  if (instances.has(instanceId)) return 200;

  try {
    await createInstance(instanceId);
    instances.set(instanceId, { serviceId, planId });
    return 201;
  } catch (err) {
    // Kubernetes 409 = resources already exist (broker restarted and lost memory)
    if (err.response?.statusCode === 409 || err.statusCode === 409) {
      instances.set(instanceId, { serviceId, planId });
      return 200;
    }
    throw err;
  }
}

export async function deprovisionInstance(instanceId) {
  try {
    await deleteInstance(instanceId);
    instances.delete(instanceId);
    return 200;
  } catch (err) {
    // Kubernetes 404 = resources already gone
    if (err.response?.statusCode === 404 || err.statusCode === 404) {
      instances.delete(instanceId);
      return 410;
    }
    throw err;
  }
}

// OSB HTTP handlers
export async function provision(req, res) {
  const { instance_id } = req.params;
  try {
    const status = await provisionInstance(instance_id, req.body.service_id, req.body.plan_id);
    return res.status(status).json({ dashboard_url: '' });
  } catch (err) {
    console.error('provision error:', err.body || err.message);
    return res.status(500).json({ description: err.body?.message || err.message });
  }
}

export async function bind(req, res) {
  const { instance_id } = req.params;

  if (!instances.has(instance_id)) {
    return res.status(404).json({ description: `Instance ${instance_id} not found.` });
  }

  return res.status(201).json({
    credentials: { host: instance_id, port: 6379, password: '' },
  });
}

export async function deprovision(req, res) {
  const { instance_id } = req.params;
  try {
    const status = await deprovisionInstance(instance_id);
    return res.status(status).json({});
  } catch (err) {
    console.error('deprovision error:', err.body || err.message);
    return res.status(500).json({ description: err.body?.message || err.message });
  }
}
