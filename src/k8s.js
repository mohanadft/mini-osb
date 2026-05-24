import { KubeConfig, AppsV1Api, CoreV1Api } from '@kubernetes/client-node';

const kc = new KubeConfig();
kc.loadFromDefault();

const appsApi = kc.makeApiClient(AppsV1Api);
const coreApi = kc.makeApiClient(CoreV1Api);

const NAMESPACE = 'default';
const REDIS_IMAGE = 'redis:7-alpine';

function buildDeployment(instanceId) {
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
              name: 'redis',
              image: REDIS_IMAGE,
              ports: [{ containerPort: 6379 }],
            },
          ],
        },
      },
    },
  };
}

function buildService(instanceId) {
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
      ports: [{ port: 6379, targetPort: 6379 }],
      type: 'ClusterIP',
    },
  };
}

export async function getPodStatus(instanceId) {
  try {
    const res = await coreApi.listNamespacedPod({
      namespace: NAMESPACE,
      labelSelector: `app=${instanceId}`,
    });
    const pod = res.items?.[0];
    if (!pod) return 'unknown';
    return pod.status?.phase?.toLowerCase() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function createInstance(instanceId) {
  await appsApi.createNamespacedDeployment({ namespace: NAMESPACE, body: buildDeployment(instanceId) });
  await coreApi.createNamespacedService({ namespace: NAMESPACE, body: buildService(instanceId) });
}

export async function deleteInstance(instanceId) {
  // Verify the resource is owned by mini-osb before deleting
  try {
    const dep = await appsApi.readNamespacedDeployment({ name: instanceId, namespace: NAMESPACE });
    if (dep.metadata?.labels?.['managed-by'] !== 'mini-osb') {
      const err = new Error(`Deployment "${instanceId}" is not managed by mini-osb`);
      err.statusCode = 403;
      throw err;
    }
  } catch (err) {
    // 403 = not our resource; any unexpected error → re-throw
    // 404 = resource doesn't exist, let the delete attempt surface its own 404
    if (err.statusCode === 403) throw err;
    const status = err.response?.statusCode ?? err.statusCode;
    if (status !== 404) throw err;
  }

  await appsApi.deleteNamespacedDeployment({ name: instanceId, namespace: NAMESPACE });
  await coreApi.deleteNamespacedService({ name: instanceId, namespace: NAMESPACE });
}
