# mini-osb

Minimal [Open Service Broker](https://www.openservicebrokerapi.org/) that provisions Redis pods inside a local minikube cluster.

Includes a GitHub webhook that **automatically provisions a Redis pod when you push a branch and tears it down when you delete it** — watch `kubectl get pods -w` update in real time as you work in git.

## Prerequisites

- Node.js 18+
- minikube running (`minikube start`)
- `~/.kube/config` pointing at minikube (default after `minikube start`)
- [ngrok](https://ngrok.com/download) (for the webhook tunnel)

## Setup

```bash
cd mini-osb
npm install
```

---

## GitHub Webhook — the fun part

### 1. Start a tunnel with ngrok

GitHub needs a public URL to POST to. ngrok punches a hole through to your localhost:

```bash
ngrok http 3000
```

Copy the `Forwarding` URL it gives you, e.g. `https://abc123.ngrok-free.app`.

### 2. Pick a webhook secret

This is a password GitHub uses to sign every payload so your broker can verify it's real:

```bash
export WEBHOOK_SECRET="some-random-string-you-choose"
```

### 3. Start the broker

```bash
WEBHOOK_SECRET="some-random-string-you-choose" npm start
```

You should see:
```
GitHub webhook enabled at POST /webhook
mini-osb listening on port 3000
```

### 4. Add the webhook on GitHub

Go to your repo → **Settings → Webhooks → Add webhook**:

| Field | Value |
|---|---|
| Payload URL | `https://abc123.ngrok-free.app/webhook` |
| Content type | `application/json` |
| Secret | the same string you used above |
| Events | **Just the push event** |

Click **Add webhook**. GitHub will send a ping — you'll see it arrive in the broker logs.

### 5. Watch it work

Open a terminal and watch pods in real time:

```bash
kubectl get pods -w
```

Then in your repo:

```bash
# Push a new branch → Redis pod appears
git checkout -b feature/my-thing
git push origin feature/my-thing

# Delete the branch → Redis pod disappears
git push origin --delete feature/my-thing
```

The broker maps the branch name to a Kubernetes-safe instance ID (slashes become hyphens, lowercased). So `feature/my-thing` becomes a pod named `feature-my-thing`.

### Revert a change, watch the service go down

```bash
# Push a branch (provisions Redis)
git checkout -b experiment/cache
git push origin experiment/cache

# Decide it was a mistake — delete the branch (deprovisions Redis)
git push origin --delete experiment/cache
```

You can also simulate "the service is down" by just watching what happens between the push and the delete — the pod is running, Redis is reachable from inside the cluster, then it's gone.

---

## Manual OSB endpoints

All requests need the `X-Broker-Api-Version` header.

### GET /v2/catalog

```bash
curl -s \
  -H "X-Broker-Api-Version: 2.17" \
  http://localhost:3000/v2/catalog | jq
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

Expected response:
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
    index.js    — Express app, routes, header guard
    catalog.js  — hardcoded service catalog
    broker.js   — provision / bind / deprovision (core logic + HTTP handlers)
    k8s.js      — Kubernetes client + Deployment/Service builders
    webhook.js  — GitHub webhook handler + signature verification
  package.json
  README.md
```

## Notes

- State is stored in memory — restarting the broker loses instance records, but Kubernetes resources persist and will be re-adopted on the next provision or deleted on the next deprovision call.
- The broker targets the `default` namespace. Change `NAMESPACE` in `src/k8s.js` to override.
- Branch names are sanitized to valid Kubernetes names: lowercased, non-alphanumeric characters replaced with hyphens, truncated to 63 characters.
