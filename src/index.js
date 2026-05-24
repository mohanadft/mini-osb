import express from 'express';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { CATALOG } from './catalog.js';
import { provision, bind, deprovision } from './broker.js';
import { createWebhookHandler } from './webhook.js';
import { listInstances, createInstance, removeInstance } from './api.js';
import { requireToken } from './middleware.js';
import { reconcile, reconcileStatus } from './reconciler.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const CONFIG     = join(__dirname, '../instances.yaml');

const app = express();

app.use(express.json({
  limit: '5mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// Static dashboard
app.use(express.static(join(__dirname, '../public')));

// Dashboard REST API — token-protected
const dashToken = process.env.DASHBOARD_TOKEN;
if (!dashToken) {
  console.warn('WARNING: DASHBOARD_TOKEN not set — /api/* endpoints are unauthenticated');
}
app.use('/api', requireToken(dashToken));
app.get('/api/instances',          listInstances);
app.post('/api/instances',         createInstance);
app.delete('/api/instances/:id',   removeInstance);
app.post('/api/reconcile',         async (req, res) => {
  try {
    const result = await reconcile(CONFIG);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
app.get('/api/reconcile-status',   (req, res) => res.json(reconcileStatus));

// GitHub webhook
const webhookSecret = process.env.WEBHOOK_SECRET;
if (webhookSecret) {
  app.post('/webhook', createWebhookHandler(webhookSecret, CONFIG));
  console.log('GitHub webhook enabled at POST /webhook');
} else {
  console.warn('WEBHOOK_SECRET not set — /webhook endpoint disabled');
}

// OSB header guard
app.use((req, res, next) => {
  if (!req.headers['x-broker-api-version']) {
    return res.status(412).json({ description: 'Missing X-Broker-Api-Version header.' });
  }
  next();
});

app.get('/v2/catalog', (req, res) => res.json(CATALOG));
app.put('/v2/service_instances/:instance_id', provision);
app.put('/v2/service_instances/:instance_id/service_bindings/:binding_id', bind);
app.delete('/v2/service_instances/:instance_id', deprovision);

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`mini-osb listening on port ${PORT}`);
  console.log(`Dashboard → http://localhost:${PORT}`);

  // Reconcile on startup so existing k8s state is adopted and config is applied
  console.log('[reconcile] startup reconcile...');
  await reconcile(CONFIG).catch(err => console.error('[reconcile] startup failed:', err.message));

});
