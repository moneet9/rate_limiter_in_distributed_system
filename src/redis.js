const Redis = require('ioredis');

function createRedis() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });
  redis.on('error', (error) => console.error('[redis]', error.message));
  return redis;
}

module.exports = { createRedis };
