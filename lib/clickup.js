const PRIORITY_MAP = {
  urgent: 1,
  high: 2,
  normal: 3,
  low: 4,
};

export async function getClickUpMembers() {
  const listId = process.env.CLICKUP_LIST_ID;
  const token = process.env.CLICKUP_API_TOKEN;
  const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/member`, {
    headers: { Authorization: token },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`ClickUp members error: ${JSON.stringify(data)}`);
  return data.members || [];
}

export async function getActiveClickUpProjects() {
  const listId = process.env.CLICKUP_LIST_ID;
  const token = process.env.CLICKUP_API_TOKEN;
  const projects = [];
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ archived: 'false', include_closed: 'false', page: String(page) });
    const response = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task?${query}`, {
      headers: { Authorization: token },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`ClickUp projects error: ${JSON.stringify(data)}`);
    const batch = data.tasks || [];
    projects.push(...batch.map((task) => ({
      id: task.id,
      name: task.name,
      url: task.url,
      status: task.status?.status || '',
      assignees: (task.assignees || []).map((person) => ({
        id: person.id,
        name: person.username || person.email || `ID ${person.id}`,
      })),
    })));
    if (batch.length < 100) break;
  }
  return projects;
}

export async function addClickUpTaskComment(taskId, commentText) {
  const response = await fetch(`https://api.clickup.com/api/v2/task/${encodeURIComponent(taskId)}/comment`, {
    method: 'POST',
    headers: {
      Authorization: process.env.CLICKUP_API_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ comment_text: commentText, notify_all: false }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`ClickUp comment error: ${JSON.stringify(data)}`);
  return data;
}

export async function createClickUpTask({
  title,
  description,
  due_datetime,
  due_date,
  priority,
  assigneeId,
}) {
  const listId = process.env.CLICKUP_LIST_ID;
  const token = process.env.CLICKUP_API_TOKEN;

  const shortTitle = title.length > 80 ? title.slice(0, 77) + '...' : title;

  const body = {
    name: shortTitle,
    markdown_content: description || '',
  };

  if (assigneeId) body.assignees = [Number(assigneeId)];

  if (priority && PRIORITY_MAP[priority]) {
    body.priority = PRIORITY_MAP[priority];
  }

  const deadline = due_datetime || (due_date ? `${due_date}T18:00:00+07:00` : null);
  if (deadline) {
    const ts = new Date(deadline).getTime();
    if (!Number.isNaN(ts)) {
      body.due_date = ts;
      body.due_date_time = true;
    }
  }

  const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return { ok: res.ok, data };
}

export async function uploadClickUpAttachments(taskId, attachments) {
  if (!attachments.length) return { ok: true, data: null };
  const form = new FormData();
  attachments.forEach((attachment, index) => {
    form.append(
      `attachment[${index}]`,
      new Blob([attachment.buffer], { type: attachment.contentType }),
      attachment.fileName
    );
  });

  const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/attachment`, {
    method: 'POST',
    headers: { Authorization: process.env.CLICKUP_API_TOKEN },
    body: form,
  });
  const data = await res.json();
  return { ok: res.ok, data };
}
