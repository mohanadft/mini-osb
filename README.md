# mini-osb

A minimal [Open Service Broker](https://www.openservicebrokerapi.org/) that provisions real service pods inside a local minikube cluster.

Two provisioning modes work side by side:

- **Declarative (GitOps)** — edit `instances.yaml`, commit, push to `main`. The broker reconciles automatically via GitHub webhook.
- **Branch-based** — push a feature branch → pod appears. Delete the branch → pod disappears.

A live dashboard at `http://localhost:3000` shows all running instances, their real pod status, connection credentials, and reconcile history.

---

## Prerequisites

- Node.js 18+
- minikube running (`minikube start`)
- `~/.kube/config` pointing at minikube (default after `minikube start`)
- [ngrok](https://ngrok.com/download) — to expose the broker to GitHub webhooks

---

## Setup

```bash
cd mini-osb
npm install
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `WEBHOOK_SECRET` | For webhook | GitHub signs every payload with this — must match what you set in GitHub settings |
| `DASHBOARD_TOKEN` | Recommended | Bearer token required to call `/api/*` and use the dashboard |
| `BRANCH_SERVICE` | No | Service to provision on branch push (default: `redis`) |
| `BRANCH_PLAN` | No | Plan to use for branch provisioning (default: `small`) |

### Start the broker

```bash
WEBHOOK_SECRET="your-secret" DASHBOARD_TOKEN="your-token" npm start
```

On startup the broker:
1. Reconciles `instances.yaml` against live Kubernetes state
2. Re-adopts any pods that survived a restart (preserving their real creation time)
3. Watches for incoming webhook events

---

## Services

The catalog is defined in `src/catalog.js`. Two services are available out of the box:

| Service | Image | Port | URI scheme |
|---|---|---|---|
| `redis` | `redis:7-alpine` | 6379 | `redis://` |
| `postgres` | `postgres:16-alpine` | 5432 | `postgresql://` |

To add a new service, add an entry to the `services` array in `src/catalog.js` with `image`, `port`, `uriScheme`, and any `env` vars. No other file needs to change.

---

## Declarative provisioning (GitOps)

`instances.yaml` at the repo root is the source of truth. Declare what you want:

```yaml
instances:
  - id: my-redis
    service: redis
    plan: small
  - id: my-postgres
    service: postgres
    plan: small
```

Commit and push to `main` — the webhook triggers a reconcile and the broker converges Kubernetes to match. Add an entry → pod is created. Remove an entry → pod is deleted.

### Reconcile triggers

| Trigger | When |
|---|---|
| Startup | Always runs on boot |
| Push `instances.yaml` to `main` | GitHub webhook triggers reconcile automatically |
| Manual | `POST /api/reconcile` or the **Reconcile now** button in the dashboard |

---

## Branch-based provisioning

Push a branch → pod named after the branch. Delete the branch → pod removed.

```bash
# Pod appears
git checkout -b feature/my-thing
git push origin feature/my-thing

# Pod disappears
git push origin --delete feature/my-thing
```

Branch names are sanitized to Kubernetes-safe IDs: lowercased, non-alphanumeric characters replaced with hyphens, truncated to 63 chars. `feature/my-thing` → `feature-my-thing`.

Only branch **creation** and **deletion** trigger provisioning — subsequent pushes to an existing branch are ignored, and merges to `main` are handled by the reconciler instead.

---

## GitHub Webhook setup

### 1. Start ngrok

```bash
ngrok http 3000
```

Copy the `Forwarding` URL, e.g. `https://abc123.ngrok-free.app`.

### 2. Add the webhook on GitHub

Go to your repo → **Settings → Webhooks → Add webhook**:

| Field | Value |
|---|---|
| Payload URL | `https://abc123.ngrok-free.app/webhook` |
| Content type | `application/json` |
| Secret | your `WEBHOOK_SECRET` value |
| Events | **Just the push event** |

> **Note:** ngrok's free tier rotates the URL on restart. If deliveries start failing, update the webhook URL in GitHub settings. You can redeliver failed payloads from **Settings → Webhooks → Recent Deliveries** without pushing again.

---

## Dashboard

Open `http://localhost:3000`. The dashboard requires `DASHBOARD_TOKEN` — it will prompt on first load and store the token in `localStorage`.

| Feature | Details |
|---|---|
| Instance cards | Live pod status (Running / Pending / Failed), real creation time from Kubernetes |
| Credentials | Click host, port, or URI to copy to clipboard |
| Reconcile bar | Last reconcile time, pods created / deleted / unchanged |
| Reconcile now | Triggers an immediate reconcile against `instances.yaml` |
| New instance | Provision manually with a chosen service and plan |
| Delete | Two-click confirmation before removing a pod |

---

## OSB API

All requests require the `X-Broker-Api-Version` header.

### GET /v2/catalog

```bash
curl -s -H "X-Broker-Api-Version: 2.17" http://localhost:3000/v2/catalog | jq
```

### PUT /v2/service_instances/:instance_id — Provision

```bash
curl -s -X PUT \
  -H "X-Broker-Api-Version: 2.17" \
  -H "Content-Type: application/json" \
  -d '{
    "service_id": "redis-service-0001",
    "plan_id":    "redis-plan-small-0001",
    "context":    { "platform": "kubernetes" },
    "parameters": {}
  }' \
  http://localhost:3000/v2/service_instances/my-redis-1 | jq
```

### PUT /v2/service_instances/:instance_id/service_bindings/:binding_id — Bind

```bash
curl -s -X PUT \
  -H "X-Broker-Api-Version: 2.17" \
  -H "Content-Type: application/json" \
  -d '{
    "service_id": "redis-service-0001",
    "plan_id":    "redis-plan-small-0001"
  }' \
  http://localhost:3000/v2/service_instances/my-redis-1/service_bindings/binding-abc | jq
```

Response:
```json
{ "credentials": { "host": "my-redis-1", "port": 6379, "password": "" } }
```

### DELETE /v2/service_instances/:instance_id — Deprovision

```bash
curl -s -X DELETE \
  -H "X-Broker-Api-Version: 2.17" \
  "http://localhost:3000/v2/service_instances/my-redis-1?service_id=redis-service-0001&plan_id=redis-plan-small-0001" | jq
```

---

## Project structure

```
mini-osb/
  src/
    index.js       — Express app, routes, startup reconcile
    catalog.js     — service catalog + lookupService() helper
    broker.js      — provision / bind / deprovision (core logic + OSB HTTP handlers)
    k8s.js         — Kubernetes client, Deployment/Service builders, pod info
    reconciler.js  — declarative reconcile loop (diff desired vs actual)
    webhook.js     — GitHub webhook handler, HMAC signature verification
    api.js         — dashboard REST API (/api/instances, /api/reconcile)
    middleware.js  — Bearer token auth middleware
  public/
    index.html     — dashboard UI
  instances.yaml   — declarative instance config (source of truth)
  package.json
  README.md
```

## Notes

- State is kept in memory — restarting the broker re-adopts running pods via the startup reconcile. Pod age is read from `metadata.creationTimestamp` so it never resets.
- The reconciler only manages resources it created — identified by the `managed-by=mini-osb` label. It will not touch unrelated Kubernetes resources.
- Change `NAMESPACE` in `src/k8s.js` to deploy into a different namespace.
