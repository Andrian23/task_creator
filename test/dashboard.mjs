import assert from 'node:assert';

process.env.CLICKUP_API_TOKEN = 'TEST_CU_TOKEN';
process.env.CLICKUP_LIST_ID = '123';
process.env.DASHBOARD_PASSWORD = 'management-secret';

globalThis.fetch = async (url) => {
  const value = String(url);
  if (value.endsWith('/member')) {
    return response({ members: [{ id: 42, username: 'Оля', profilePicture: null }] });
  }
  if (value.includes('/list/123/task')) {
    return response({ tasks: [{
      id: 'task-1',
      name: 'Зняти ролик',
      url: 'https://app.clickup.com/t/task-1',
      status: { status: 'in progress', color: '#123456', type: 'custom' },
      assignees: [{ id: 42, username: 'Оля' }],
      priority: { priority: 'high', color: '#f00' },
      due_date: '1786500000000',
      date_created: '1786400000000',
      date_closed: null,
      tags: [{ name: 'video' }],
    }] });
  }
  throw new Error(`Unexpected request: ${value}`);
};

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, json: async () => data };
}

function request(password) {
  return { method: 'GET', headers: password ? { 'x-dashboard-password': password } : {} };
}

function result() {
  const state = { headers: {} };
  return {
    status(code) { state.status = code; return this; },
    json(body) { state.body = body; return this; },
    setHeader(name, value) { state.headers[name] = value; },
    state,
  };
}

const { default: handler } = await import('../api/dashboard.js');

const denied = result();
await handler(request('wrong'), denied);
assert.strictEqual(denied.state.status, 401);

const allowed = result();
await handler(request('management-secret'), allowed);
assert.strictEqual(allowed.state.status, 200);
assert.strictEqual(allowed.state.body.members[0].name, 'Оля');
assert.strictEqual(allowed.state.body.tasks[0].status.name, 'in progress');
assert.strictEqual(allowed.state.body.tasks[0].assignees[0].id, 42);
assert.strictEqual(allowed.state.headers['Cache-Control'], 'private, no-store');

console.log('OK - dashboard API assertions passed');
