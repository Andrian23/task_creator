const MAX_PAGES = 20;

function unauthorized(res) {
  res.status(401).json({ error: 'UNAUTHORIZED' });
}

function isAuthorized(req) {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  const provided = req.headers['x-dashboard-password'];
  return typeof provided === 'string' && provided === expected;
}

async function clickUp(path) {
  const response = await fetch(`https://api.clickup.com/api/v2${path}`, {
    headers: { Authorization: process.env.CLICKUP_API_TOKEN },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`ClickUp error: ${JSON.stringify(data)}`);
  return data;
}

async function getAllTasks(listId) {
  const tasks = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      archived: 'false',
      include_closed: 'true',
      subtasks: 'true',
      page: String(page),
    });
    const data = await clickUp(`/list/${listId}/task?${query}`);
    const batch = data.tasks || [];
    tasks.push(...batch);
    if (batch.length < 100) break;
  }
  return tasks;
}

function normalizeTask(task) {
  return {
    id: task.id,
    name: task.name,
    url: task.url,
    status: task.status ? {
      name: task.status.status,
      color: task.status.color,
      type: task.status.type,
    } : null,
    assignees: (task.assignees || []).map((person) => ({
      id: person.id,
      name: person.username || person.email || `ID ${person.id}`,
      avatar: person.profilePicture || null,
    })),
    priority: task.priority ? {
      name: task.priority.priority,
      color: task.priority.color,
    } : null,
    dueDate: task.due_date ? Number(task.due_date) : null,
    createdAt: task.date_created ? Number(task.date_created) : null,
    closedAt: task.date_closed ? Number(task.date_closed) : null,
    tags: (task.tags || []).map((tag) => tag.name),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  if (!process.env.DASHBOARD_PASSWORD) {
    res.status(503).json({ error: 'DASHBOARD_NOT_CONFIGURED' });
    return;
  }
  if (!isAuthorized(req)) {
    unauthorized(res);
    return;
  }

  try {
    const listId = process.env.CLICKUP_LIST_ID;
    const [tasks, membersData] = await Promise.all([
      getAllTasks(listId),
      clickUp(`/list/${listId}/member`),
    ]);
    const normalizedTasks = tasks.map(normalizeTask);
    const members = (membersData.members || []).map((person) => ({
      id: person.id,
      name: person.username || person.email || `ID ${person.id}`,
      avatar: person.profilePicture || null,
    }));
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json({
      fetchedAt: Date.now(),
      members,
      tasks: normalizedTasks,
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: 'CLICKUP_REQUEST_FAILED' });
  }
}
