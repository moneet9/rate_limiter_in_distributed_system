const path = require('node:path');
const http = require('node:http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { v4: uuid } = require('uuid');
const { createRedis } = require('./src/redis');
const { rateLimit } = require('./src/rateLimiter');
const { Metrics } = require('./src/metrics');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const redis = createRedis();
const metrics = new Metrics();
const instanceId = process.env.INSTANCE_ID || 'dashboard-gateway';
const port = Number(process.env.PORT || 3000);

const policies = new Map([['global', {
  id: 'global', name: 'Global API policy', algorithm: 'fixed-window', limit: 100,
  windowMs: 60000, refillRate: 2, capacity: 100, scope: 'API key', endpoint: '/api/demo',
  action: 'reject', maxDelayMs: 1000
}]]);
const instances = new Map(['app-1', 'app-2', 'app-3'].map((id, index) => [id, {
  id, healthy: true, requests: 0, latency: 0, startedAt: Date.now() - ((index + 1) * 3600000)
}]));
const requestLog = [];
let simulation = null;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function activeInstances() { return [...instances.values()].filter((item) => item.healthy); }
function chooseInstance() {
  const active = activeInstances();
  if (!active.length) throw new Error('No healthy application instances are available');
  return active[Math.floor(Math.random() * active.length)];
}
function currentPolicy(input = {}) {
  const stored = policies.get(input.policyId || 'global') || policies.get('global');
  return { ...stored, ...input, id: stored.id };
}
function identityFrom(input) {
  const type = input.identityType || 'apiKey';
  const values = { ip: input.clientIp, apiKey: input.apiKey, userId: input.userId, tenantId: input.tenantId };
  return `${type}:${values[type] || 'anonymous'}`;
}
function broadcast() {
  io.emit('metrics:update', { metrics: metrics.snapshot(), instances: [...instances.values()], policy: policies.get('global'), recent: requestLog.slice(0, 12) });
}

async function processRequest(input = {}) {
  const started = performance.now();
  const target = chooseInstance();
  const identity = identityFrom(input);
  const policy = currentPolicy(input);
  const decision = await rateLimit(redis, policy, identity);
  const latency = Math.max(1, Math.round(performance.now() - started));
  target.requests += 1;
  target.latency = Math.round((target.latency * 0.8) + (latency * 0.2));
  const record = {
    id: uuid(), timestamp: new Date().toISOString(), identity, targetInstance: target.id,
    endpoint: input.endpoint || '/api/demo', method: input.method || 'GET', algorithm: policy.algorithm,
    allowed: decision.allowed, decision: decision.delayedMs ? (decision.allowed ? 'DELAYED + ALLOWED' : 'DELAYED + REJECTED') : (decision.allowed ? 'ALLOWED' : 'REJECTED'), status: decision.status,
    latency, delayedMs: decision.delayedMs, remaining: decision.remaining, retryAfter: decision.retryAfter,
    reason: decision.delayedMs ? `Waited ${decision.delayedMs} ms before retrying` : (decision.allowed ? 'Quota available' : 'Rate limit exhausted'),
    policyId: policy.id
  };
  requestLog.unshift(record); requestLog.splice(500);
  metrics.record(record);
  io.emit('request:decision', record); broadcast();
  return record;
}

function validatePolicy(input) {
  const algorithm = ['fixed-window', 'sliding-window', 'token-bucket'].includes(input.algorithm) ? input.algorithm : 'fixed-window';
  const action = ['reject', 'delay'].includes(input.action) ? input.action : 'reject';
  const limit = Math.max(1, Math.min(100000, Number(input.limit) || 100));
  const windowMs = Math.max(1000, Math.min(86400000, Number(input.windowMs) || 60000));
  return { id: input.id || `policy-${Date.now()}`, name: input.name || 'Custom policy', algorithm, limit, windowMs,
    refillRate: Math.max(0.01, Number(input.refillRate) || 2), capacity: Math.max(1, Number(input.capacity) || limit),
    scope: input.scope || 'API key', endpoint: input.endpoint || '/api/demo', action,
    maxDelayMs: action === 'delay' ? Math.max(50, Math.min(10000, Number(input.maxDelayMs) || 1000)) : 0 };
}

app.get('/api/metrics/live', (req, res) => res.json({ metrics: metrics.snapshot(), instances: [...instances.values()], policy: policies.get('global') }));
app.post('/api/metrics/reset', (req, res) => { metrics.reset(); requestLog.length = 0; instances.forEach((item) => { item.requests = 0; item.latency = 0; }); broadcast(); res.json({ reset: true }); });
app.get('/api/instances', (req, res) => res.json([...instances.values()]));
app.post('/api/instances/:id/fault', (req, res) => {
  const item = instances.get(req.params.id); if (!item) return res.status(404).json({ error: 'Instance not found' });
  item.healthy = req.body.healthy !== undefined ? Boolean(req.body.healthy) : !item.healthy;
  io.emit('instances:update', [...instances.values()]); broadcast(); res.json(item);
});
app.post('/api/instances/:id/restart', (req, res) => {
  const item = instances.get(req.params.id); if (!item) return res.status(404).json({ error: 'Instance not found' });
  item.healthy = true; item.startedAt = Date.now(); io.emit('instances:update', [...instances.values()]); broadcast(); res.json(item);
});
app.get('/api/policies', (req, res) => res.json([...policies.values()]));
app.post('/api/policies', (req, res) => { const policy = validatePolicy(req.body); policies.set(policy.id, policy); policies.set('global', policy); io.emit('policy:update', policy); res.status(201).json(policy); });
app.get('/api/requests', (req, res) => {
  let result = requestLog;
  if (req.query.status === 'allowed') result = result.filter((item) => item.allowed);
  if (req.query.status === 'rejected') result = result.filter((item) => !item.allowed);
  if (req.query.client) result = result.filter((item) => item.identity.includes(req.query.client));
  if (req.query.instance) result = result.filter((item) => item.targetInstance === req.query.instance);
  res.json(result.slice(0, 100));
});
app.post('/api/traffic/single', async (req, res) => {
  try { res.status(200).json(await processRequest(req.body)); } catch (error) { res.status(503).json({ error: error.message }); }
});
app.post('/api/traffic/batch', async (req, res) => {
  try {
    const count = Math.min(1000, Math.max(1, Number(req.body.count) || 1));
    const results = []; for (let i = 0; i < count; i += 1) results.push(await processRequest(req.body));
    res.json({ results, metrics: metrics.snapshot() });
  } catch (error) { res.status(503).json({ error: error.message }); }
});
app.post('/api/traffic/start', (req, res) => {
  if (simulation) return res.status(409).json({ error: 'Simulation already running' });
  const config = { total: Math.min(5000, Math.max(1, Number(req.body.total) || 150)), rps: Math.min(100, Math.max(1, Number(req.body.rps) || 25)), pattern: req.body.pattern || 'constant', clients: Math.max(1, Number(req.body.clients) || 1), sent: 0, paused: false };
  simulation = { ...config, timer: null, startedAt: Date.now() };
  const tick = async () => {
    if (!simulation || simulation.paused) return;
    const rampRate = simulation.pattern === 'ramp' ? Math.max(1, Math.ceil((simulation.rps / 5) * (simulation.sent / simulation.total))) : Math.ceil(simulation.rps / 5);
    const amount = simulation.pattern === 'burst' ? Math.min(25, simulation.total - simulation.sent) : Math.min(Math.max(1, rampRate), simulation.total - simulation.sent);
    for (let index = 0; index < amount; index += 1) { if (!simulation) return; await processRequest({ apiKey: `demo-key-${(simulation.sent % simulation.clients) + 1}`, clientIp: `10.0.0.${(simulation.sent % simulation.clients) + 1}`, identityType: 'apiKey', endpoint: '/api/demo' }); simulation.sent += 1; }
    io.emit('simulation:progress', { ...simulation, timer: undefined });
    if (simulation.sent >= simulation.total) { io.emit('simulation:complete', { ...metrics.snapshot(), total: simulation.sent }); clearInterval(simulation.timer); simulation = null; }
  };
  simulation.timer = setInterval(tick, 200); tick(); res.json({ ...simulation, timer: undefined });
});
app.post('/api/traffic/pause', (req, res) => { if (simulation) simulation.paused = true; res.json({ running: Boolean(simulation), paused: true }); });
app.post('/api/traffic/resume', (req, res) => { if (simulation) simulation.paused = false; res.json({ running: Boolean(simulation), paused: false }); });
app.post('/api/traffic/stop', (req, res) => { if (simulation) clearInterval(simulation.timer); simulation = null; io.emit('simulation:stopped'); res.json({ stopped: true }); });
app.get('/api/experiments/:id/report', (req, res) => {
  const snapshot = metrics.snapshot(); const distribution = [...instances.values()].map((item) => ({ id: item.id, requests: item.requests }));
  res.json({ id: req.params.id, measured: true, createdAt: new Date().toISOString(), ...snapshot, acceptanceRate: snapshot.total ? Number((snapshot.accepted / snapshot.total * 100).toFixed(1)) : 0, rejectionRate: snapshot.total ? Number((snapshot.rejected / snapshot.total * 100).toFixed(1)) : 0, distribution });
});
app.post('/api/experiments', (req, res) => res.status(201).json({ id: `EXP-${Date.now()}`, ...metrics.snapshot(), measured: true }));

io.on('connection', (socket) => { socket.emit('metrics:update', { metrics: metrics.snapshot(), instances: [...instances.values()], policy: policies.get('global'), recent: requestLog.slice(0, 12) }); });

async function start() { await redis.connect(); server.listen(port, () => console.log(`Distributed limiter listening on http://localhost:${port} (${instanceId})`)); }
if (require.main === module) start().catch((error) => { console.error(error); process.exit(1); });
module.exports = { app, processRequest, policies, instances };
