const fixedWindow = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return { count <= tonumber(ARGV[2]) and 1 or 0, math.max(0, tonumber(ARGV[2]) - count), ttl, count }
`;

const slidingWindow = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local currentStart = now - (now % window)
local previousStart = currentStart - window
local currentKey = KEYS[1] .. ':' .. currentStart
local previousKey = KEYS[1] .. ':' .. previousStart
local current = redis.call('GET', currentKey) or 0
local previous = redis.call('GET', previousKey) or 0
local elapsed = now - currentStart
local weighted = (tonumber(previous) * ((window - elapsed) / window)) + tonumber(current)
if weighted + 1 <= limit then
  redis.call('INCR', currentKey)
  redis.call('PEXPIRE', currentKey, window * 2)
  current = tonumber(current) + 1
  weighted = (tonumber(previous) * ((window - elapsed) / window)) + tonumber(current)
  return {1, math.max(0, math.floor(limit - weighted)), window - elapsed, weighted}
end
return {0, 0, window - elapsed, weighted}
`;

const tokenBucket = `
local now = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens'))
local updated = tonumber(redis.call('HGET', KEYS[1], 'updated'))
if not tokens then tokens = capacity end
if not updated then updated = now end
local elapsed = math.max(0, now - updated) / 1000
 tokens = math.min(capacity, tokens + (elapsed * refill))
local allowed = tokens >= requested
if allowed then tokens = tokens - requested end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated', now)
redis.call('PEXPIRE', KEYS[1], math.ceil((capacity / math.max(refill, 0.001)) * 1000 * 2))
return {allowed and 1 or 0, math.floor(tokens), allowed and 0 or math.ceil(((requested - tokens) / math.max(refill, 0.001)) * 1000), tokens}
`;

async function decide(redis, policy, identity) {
  const key = `rl:${policy.id}:${identity}`;
  const now = Date.now();
  let result;
  if (policy.algorithm === 'fixed-window') {
    result = await redis.eval(fixedWindow, 1, key, policy.windowMs, policy.limit);
  } else if (policy.algorithm === 'sliding-window') {
    result = await redis.eval(slidingWindow, 1, key, now, policy.windowMs, policy.limit);
  } else {
    result = await redis.eval(tokenBucket, 1, key, now, policy.refillRate, policy.capacity, 1);
  }
  return {
    allowed: Number(result[0]) === 1,
    remaining: Math.max(0, Number(result[1])),
    retryAfterMs: Math.max(0, Number(result[2])),
    count: Number(result[3]),
    algorithm: policy.algorithm,
  };
}

module.exports = { decide, scripts: { fixedWindow, slidingWindow, tokenBucket } };
