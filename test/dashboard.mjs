import assert from 'node:assert';

process.env.CLICKUP_API_TOKEN = 'TEST_CU_TOKEN';
process.env.CLICKUP_LIST_ID = '123';
process.env.DASHBOARD_PASSWORD = 'management-secret';
process.env.UPSTASH_REDIS_URL = 'https://fake-redis.example.com';
process.env.UPSTASH_REDIS_TOKEN = 'TEST_REDIS_TOKEN';

globalThis.fetch = async (url, options = {}) => {
  const value = String(url);
  if (value.startsWith(process.env.UPSTASH_REDIS_URL)) {
    const [command] = JSON.parse(options.body);
    if (command === 'SCAN') return response({ result: ['0', []] });
  }
  if (value.endsWith('/member')) return response({ members: [{ id: 42, username: 'Оля' }] });
  if (value.includes('/list/123/task')) return response({ tasks: [{ id: 'project-1', name: 'Project Alpha', url: 'https://app.clickup.com/t/project-1', status: { status: 'active' }, assignees: [{ id: 42, username: 'Оля' }] }] });
  throw new Error(`Unexpected request: ${value}`);
};

function response(data, status = 200) { return { ok: status >= 200 && status < 300, json: async () => data }; }
function result() { const state = { headers: {} }; return { status(code) { state.status = code; return this; }, json(body) { state.body = body; return this; }, setHeader(name, value) { state.headers[name] = value; }, state }; }
const { default: handler } = await import('../api/dashboard.js');

const denied = result(); await handler({ method: 'GET', headers: { 'x-dashboard-password': 'wrong' } }, denied); assert.strictEqual(denied.state.status, 401);
const allowed = result(); await handler({ method: 'GET', headers: { 'x-dashboard-password': 'management-secret' } }, allowed); assert.strictEqual(allowed.state.status, 200); assert.strictEqual(allowed.state.body.projects[0].name, 'Project Alpha'); assert.deepStrictEqual(allowed.state.body.pending, []); assert.deepStrictEqual(allowed.state.body.ignored, []);
console.log('OK - dashboard assertions passed');
