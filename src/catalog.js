export const CATALOG = {
  services: [
    {
      id: 'redis-service-0001',
      name: 'redis',
      description: 'Managed Redis instance provisioned as a Kubernetes pod in minikube.',
      bindable: true,
      plans: [
        {
          id: 'redis-plan-small-0001',
          name: 'small',
          description: 'Single Redis pod with default resource limits.',
          free: true,
        },
      ],
    },
  ],
};
