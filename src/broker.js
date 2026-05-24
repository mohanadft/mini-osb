import { createInstance, deleteInstance } from './k8s.js';
import { lookupService } from './catalog.js';

// In-memory store: instanceId → { serviceId, planId, serviceName, planName, port, createdAt }
export const instances = new Map();

// Core logic — used by HTTP handlers, reconciler, and webhook
export async function provisionInstance(instanceId, serviceName, planName) {
  if (instances.has(instanceId)) return 200;

  const svc = lookupService(serviceName, planName);

  try {
    await createInstance(instanceId, svc);
    instances.set(instanceId, {
      serviceId:   svc.serviceId,
      planId:      svc.planId,
      serviceName,
      planName,
      port:        svc.port,
      createdAt:   Date.now(),
    });
    return 201;
  } catch (err) {
    // 409 = resources already exist (broker restarted and lost memory)
    if (err.response?.statusCode === 409 || err.statusCode === 409) {
      instances.set(instanceId, {
        serviceId:   svc.serviceId,
        planId:      svc.planId,
        serviceName,
        planName,
        port:        svc.port,
        createdAt:   Date.now(),
      });
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

  // Resolve service name from catalog using the OSB service_id/plan_id
  const { CATALOG } = await import('./catalog.js');
  const service = CATALOG.services.find(s => s.id === req.body.service_id);
  const plan    = service?.plans.find(p => p.id === req.body.plan_id);

  if (!service || !plan) {
    return res.status(400).json({ description: `Unknown service_id or plan_id.` });
  }

  try {
    const status = await provisionInstance(instance_id, service.name, plan.name);
    return res.status(status).json({ dashboard_url: '' });
  } catch (err) {
    console.error('provision error:', err.body || err.message);
    return res.status(err.statusCode === 400 ? 400 : 500).json({ description: err.body?.message ?? err.message });
  }
}

export async function bind(req, res) {
  const { instance_id } = req.params;
  const inst = instances.get(instance_id);

  if (!inst) {
    return res.status(404).json({ description: `Instance ${instance_id} not found.` });
  }

  return res.status(201).json({
    credentials: {
      host:     instance_id,
      port:     inst.port,
      password: '',
    },
  });
}

export async function deprovision(req, res) {
  const { instance_id } = req.params;
  try {
    const status = await deprovisionInstance(instance_id);
    return res.status(status).json({});
  } catch (err) {
    console.error('deprovision error:', err.body || err.message);
    return res.status(500).json({ description: err.body?.message ?? err.message });
  }
}
