const { decide } = require('./algorithms');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function rateLimit(redis, policy, identity) {
  if (!identity) throw new Error('A rate-limit identity is required');
  let decision = await decide(redis, policy, identity);
  let delayedMs = 0;
  if (!decision.allowed && policy.action === 'delay' && policy.maxDelayMs > 0 && decision.retryAfterMs > 0) {
    delayedMs = Math.min(decision.retryAfterMs, policy.maxDelayMs);
    await wait(delayedMs);
    decision = await decide(redis, policy, identity);
  }
  return {
    ...decision,
    delayedMs,
    status: decision.allowed ? 200 : 429,
    retryAfter: Math.ceil(decision.retryAfterMs / 1000),
  };
}

module.exports = { rateLimit };
