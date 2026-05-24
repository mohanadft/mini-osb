import express from 'express';
import { CATALOG } from './catalog.js';
import { provision, bind, deprovision } from './broker.js';
import { createWebhookHandler } from './webhook.js';

const app = express();

// Capture raw body for webhook signature verification before JSON parsing
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// GitHub webhook — no OSB header required
const webhookSecret = process.env.WEBHOOK_SECRET;
if (webhookSecret) {
  app.post('/webhook', createWebhookHandler(webhookSecret));
  console.log('GitHub webhook enabled at POST /webhook');
} else {
  console.warn('WEBHOOK_SECRET not set — /webhook endpoint disabled');
}

// OSB requires this header on every request
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
app.listen(PORT, () => console.log(`mini-osb listening on port ${PORT}`));
