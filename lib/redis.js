// Minimal Upstash Redis REST client (no dependency needed).
// Used to keep per-chat conversation state between Telegram messages,
// since Vercel serverless functions have no memory between invocations.

const URL = process.env.UPSTASH_REDIS_URL;
const TOKEN = process.env.UPSTASH_REDIS_TOKEN;

async function command(args) {
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
