export const CATALOG = {
  services: [
    {
      id: 'redis-service-0001',
      name: 'redis',
      description: 'Redis in-memory data store provisioned as a Kubernetes pod.',
      bindable: true,
      metadata: {
        image:     'redis:7-alpine',
        port:      6379,
        uriScheme: 'redis',
      },
      plans: [
        {
          id: 'redis-plan-small-0001',
          name: 'small',
          description: 'Single Redis pod with default resource limits.',
          free: true,
        },
      ],
    },
    {
      id: 'postgres-service-0001',
      name: 'postgres',
      description: 'PostgreSQL relational database provisioned as a Kubernetes pod.',
      bindable: true,
      metadata: {
        image:     'postgres:16-alpine',
        port:      5432,
        uriScheme: 'postgresql',
        env: [
          { name: 'POSTGRES_PASSWORD', value: 'password' },
          { name: 'POSTGRES_DB',       value: 'app' },
        ],
      },
      plans: [
        {
          id: 'postgres-plan-small-0001',
          name: 'small',
          description: 'Single PostgreSQL pod with default resource limits.',
          free: true,
        },
      ],
    },
  ],
};

// Resolve a service + plan by human-readable name and return provisioning metadata
export function lookupService(serviceName, planName) {
  const service = CATALOG.services.find(s => s.name === serviceName);
  if (!service) {
    const available = CATALOG.services.map(s => s.name).join(', ');
    throw Object.assign(new Error(`Unknown service "${serviceName}". Available: ${available}`), { statusCode: 400 });
  }
  const plan = service.plans.find(p => p.name === planName);
  if (!plan) {
    const available = service.plans.map(p => p.name).join(', ');
    throw Object.assign(new Error(`Unknown plan "${planName}" for service "${serviceName}". Available: ${available}`), { statusCode: 400 });
  }
  return {
    serviceId: service.id,
    planId:    plan.id,
    image:     service.metadata.image,
    port:      service.metadata.port,
    uriScheme: service.metadata.uriScheme,
    env:       service.metadata.env ?? [],
  };
}
