const test = require('node:test');
const assert = require('node:assert/strict');
const { createRedis } = require('../src/redis');
const { rateLimit } = require('../src/rateLimiter');

const redis = createRedis();
const policy = (algorithm) => ({ id: `test-${algorithm}`, algorithm, limit: 2, windowMs: 60000, capacity: 2, refillRate: 0.1 });

test.before(async () => { await redis.connect(); });
test.after(async () => { await redis.quit(); });

test('fixed window rejects after the configured limit', async () => {
  await redis.del('rl:test-fixed-window:a');
  assert.equal((await rateLimit(redis, policy('fixed-window'), 'a')).allowed, true);
  assert.equal((await rateLimit(redis, policy('fixed-window'), 'a')).allowed, true);
  assert.equal((await rateLimit(redis, policy('fixed-window'), 'a')).allowed, false);
});

test('shared Redis state enforces one quota across logical instances', async () => {
  await redis.del('rl:test-fixed-window:shared-client');
  const instanceOne = rateLimit(redis, policy('fixed-window'), 'shared-client');
  const instanceTwo = rateLimit(redis, policy('fixed-window'), 'shared-client');
  const decisions = await Promise.all([instanceOne, instanceTwo]);
  assert.equal(decisions.filter((decision) => decision.allowed).length, 2);
  assert.equal((await rateLimit(redis, policy('fixed-window'), 'shared-client')).allowed, false);
});

test('token bucket refills over time', async () => {
  await redis.del('rl:test-token-bucket:bucket');
  const bucket = policy('token-bucket');
  bucket.refillRate = 10;
  assert.equal((await rateLimit(redis, bucket, 'bucket')).allowed, true);
  assert.equal((await rateLimit(redis, bucket, 'bucket')).allowed, true);
  assert.equal((await rateLimit(redis, bucket, 'bucket')).allowed, false);
});
