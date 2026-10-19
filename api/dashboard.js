import { getActiveClickUpProjects, getClickUpMembers } from '../lib/clickup.js';
import { deleteKey, getJson, listJson, setJson } from '../lib/redis.js';
import { resolvePendingUpworkEvent } from '../lib/upwork.js';

function isAuthorized(req) {
  const password = process.env.DASHBOARD_PASSWORD;
  return Boolean(password) && req.headers['x-dashboard-password'] === password;
}

function unauthorized(res) {
  res.status(401).json({ error: 'UNAUTHORIZED' });
}

async function dashboardData() {
  const [projects, members] = await Promise.all([
    getActiveClickUpProjects(),
    getClickUpMembers(),
  ]);
  let pendingRows = [];
  let mappingRows = [];
  let assigneeRows = [];
  let ignoredRows = [];
  let storageError = null;
  try {
    [pendingRows, mappingRows, assigneeRows, ignoredRows] = await Promise.all([
      listJson('upwork:pending:*'),
      listJson('upwork:room:*'),
      listJson('upwork:assignee:*'),
      listJson('upwork:ignored:*'),
    ]);
  } catch (error) {
    console.error('Redis dashboard error:', error);
    storageError = 'REDIS_UNAVAILABLE';
  }
  return {
    fetchedAt: Date.now(),
    projects,
    members: members.map((member) => ({ id: member.id, name: member.username || member.email || `ID ${member.id}` })),
    pending: pendingRows.filter(({ value }) => value).map(({ key, value }) => ({ nonce: key.slice('upwork:pending:'.length), ...value })),
    mappings: mappingRows.filter(({ value }) => value).map(({ key, value }) => ({ roomId: key.slice('upwork:room:'.length), ...value })),
    assigneeTags: Object.fromEntries(assigneeRows.map(({ key, value }) => [key.slice('upwork:assignee:'.length), value])),
    ignored: ignoredRows.filter(({ value }) => value).map(({ key, value }) => ({ roomId: key.slice('upwork:ignored:'.length), ...value })),
    storageError,
  };
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    unauthorized(res);
    return;
  }
  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).json(await dashboardData());
      return;
    }
    if (req.method === 'POST' && req.body?.action === 'match') {
      const result = await resolvePendingUpworkEvent(String(req.body.nonce || ''), String(req.body.taskId || ''));
      res.status(result.error ? 400 : 200).json(result);
      return;
    }
    if (req.method === 'POST' && req.body?.action === 'saveTags') {
      const allowed = new Set(['@annaaaaa_kk', '@karynakrnnk', '']);
      for (const [memberId, username] of Object.entries(req.body.tags || {})) {
        if (!allowed.has(username)) continue;
        if (username) await setJson(`upwork:assignee:${memberId}`, username);
        else await deleteKey(`upwork:assignee:${memberId}`);
      }
      res.status(200).json({ ok: true });
      return;
    }
    if (req.method === 'POST' && req.body?.action === 'deleteMapping') {
      await deleteKey(`upwork:room:${String(req.body.roomId || '')}`);
      res.status(200).json({ ok: true });
      return;
    }
    if (req.method === 'POST' && req.body?.action === 'archiveRoom') {
      const nonce = String(req.body.nonce || '');
      const pending = nonce ? await getJson(`upwork:pending:${nonce}`) : null;
      const roomId = String(req.body.roomId || pending?.event?.roomId || '');
      if (!roomId) {
        res.status(400).json({ error: 'ROOM_ID_REQUIRED' });
        return;
      }
      await setJson(`upwork:ignored:${roomId}`, {
        label: pending?.event?.topic || pending?.event?.author || roomId,
        archivedAt: Date.now(),
      });
      if (nonce) await deleteKey(`upwork:pending:${nonce}`);
      await deleteKey(`upwork:room:${roomId}`);
      res.status(200).json({ ok: true });
      return;
    }
    if (req.method === 'POST' && req.body?.action === 'restoreRoom') {
      await deleteKey(`upwork:ignored:${String(req.body.roomId || '')}`);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: 'DASHBOARD_REQUEST_FAILED' });
  }
}
