const PRIORITY_MAP = {
  urgent: 1,
  high: 2,
  normal: 3,
  low: 4,
};

export async function createClickUpTask({ creator, title, description, due_date, priority }) {
  const listId = process.env.CLICKUP_LIST_ID;
  const token = process.env.CLICKUP_API_TOKEN;

  const shortTitle = title.length > 80 ? title.slice(0, 77) + '...' : title;
  const name = creator ? `[${creator}] ${shortTitle}` : shortTitle;

  const fullDescription = creator
    ? `Виконавець: ${creator}\n\n${description || ''}`
    : description || '';

  const body = {
    name,
    description: fullDescription,
  };

  if (priority && PRIORITY_MAP[priority]) {
    body.priority = PRIORITY_MAP[priority];
  }

  if (due_date) {
    const ts = new Date(`${due_date}T18:00:00Z`).getTime();
    if (!Number.isNaN(ts)) {
      body.due_date = ts;
      body.due_date_time = false;
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
