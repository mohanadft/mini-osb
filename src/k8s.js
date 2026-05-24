import { KubeConfig, AppsV1Api, CoreV1Api } from '@kubernetes/client-node';

const kc = new KubeConfig();
kc.loadFromDefault();

const appsApi = kc.makeApiClient(AppsV1Api);
const coreApi = kc.makeApiClient(CoreV1Api);

const NAMESPACE = 'default';

function buildDeployment(instanceId, { image, port, env = [] }) {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: instanceId,
      namespace: NAMESPACE,
      labels: { app: instanceId, 'managed-by': 'mini-osb' },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: instanceId } },
      template: {
        metadata: { labels: { app: instanceId } },
        spec: {
          containers: [
            {
              name: instanceId,
              image,
              ports: [{ containerPort: port }],
              env: env.map(e => ({ name: e.name, value: e.value })),
            },
          ],
        },
      },
    },
  };
}

function buildService(instanceId, { port }) {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: instanceId,
      namespace: NAMESPACE,
      labels: { app: instanceId, 'managed-by': 'mini-osb' },
    },
    spec: {
      selector: { app: instanceId },
      ports: [{ port, targetPort: port }],
      type: 'ClusterIP',
    },
  };
}

export async function listManagedDeployments() {
  const res = await appsApi.listNamespacedDeployment({
    namespace: NAMESPACE,
    labelSelector: 'managed-by=mini-osb',
  });
  return res.items.map(d => d.metadata.name);
}

export async function getPodInfo(instanceId) {
  try {
    const res = await coreApi.listNamespacedPod({
      namespace: NAMESPACE,
      labelSelector: `app=${instanceId}`,
    });
    const pod = res.items?.[0];
    if (!pod) return { status: 'unknown', createdAt: null };
    return {
      status:    pod.status?.phase?.toLowerCase() ?? 'unknown',
      createdAt: pod.metadata?.creationTimestamp
        ? new Date(pod.metadata.creationTimestamp).getTime()
        : null,
    };
  } catch {
    return { status: 'unknown', createdAt: null };
  }
}

export async function createInstance(instanceId, serviceMetadata) {
  await appsApi.createNamespacedDeployment({ namespace: NAMESPACE, body: buildDeployment(instanceId, serviceMetadata) });
  await coreApi.createNamespacedService({ namespace: NAMESPACE, body: buildService(instanceId, serviceMetadata) });
}

export async function deleteInstance(instanceId) {
  // Verify ownership before deleting
  try {
    const dep = await appsApi.readNamespacedDeployment({ name: instanceId, namespace: NAMESPACE });
    if (dep.metadata?.labels?.['managed-by'] !== 'mini-osb') {
      const err = new Error(`Deployment "${instanceId}" is not managed by mini-osb`);
      err.statusCode = 403;
      throw err;
    }
  } catch (err) {
    if (err.statusCode === 403) throw err;
    const status = err.response?.statusCode ?? err.statusCode;
    if (status !== 404) throw err;
  }

  await appsApi.deleteNamespacedDeployment({ name: instanceId, namespace: NAMESPACE });
  await coreApi.deleteNamespacedService({ name: instanceId, namespace: NAMESPACE });
}
