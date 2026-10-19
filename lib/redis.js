// Minimal Upstash Redis REST client (no dependency needed).
// Used to keep per-chat conversation state between Telegram messages,
// since Vercel serverless functions have no memory between invocations.

const URL = process.env.UPSTASH_REDIS_URL
  || process.env.UPSTASH_REDIS_REST_URL
  || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_TOKEN
  || process.env.UPSTASH_REDIS_REST_TOKEN
  || process.env.KV_REST_API_TOKEN;

async function command(args) {
  if (!URL || !TOKEN) throw new Error('Redis env vars are missing');
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Redis error: ${data.error}`);
  return data.result;
}

export async function redisCommand(args) {
  return command(args);
}

export async function getJson(key) {
  const raw = await command(['GET', key]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function setJson(key, value, ttlSeconds = null) {
  const args = ['SET', key, JSON.stringify(value)];
  if (ttlSeconds) args.push('EX', ttlSeconds);
  await command(args);
}

export async function deleteKey(key) {
  await command(['DEL', key]);
}

export async function listJson(pattern) {
  const keys = [];
  let cursor = '0';
  do {
    const result = await command(['SCAN', cursor, 'MATCH', pattern, 'COUNT', 100]);
    cursor = String(result?.[0] || '0');
    keys.push(...(result?.[1] || []));
  } while (cursor !== '0');
  return Promise.all(keys.map(async (key) => ({ key, value: await getJson(key) })));
}

const SESSION_TTL_SECONDS = 30 * 60; // 30 minutes of inactivity clears the session

export async function getSession(chatId) {
  const raw = await command(['GET', `session:${chatId}`]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setSession(chatId, session) {
  await command([
    'SET',
    `session:${chatId}`,
    JSON.stringify(session),
    'EX',
    SESSION_TTL_SECONDS,
  ]);
}

export async function clearSession(chatId) {
  await command(['DEL', `session:${chatId}`]);
}

export async function claimOnce(key, ttlSeconds = 300) {
  const result = await command(['SET', `once:${key}`, '1', 'NX', 'EX', ttlSeconds]);
  return result === 'OK';
}
