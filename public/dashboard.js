const state = { tasks: [], members: [], password: '', filters: { person: 'all', status: 'all', due: 'all', search: '' } };
const $ = (selector) => document.querySelector(selector);
const day = 86_400_000;

function isDone(task) {
  return task.status?.type === 'closed' || /done|complete|закрит|готов/i.test(task.status?.name || '');
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function initials(name = '?') {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function formatDate(timestamp) {
  if (!timestamp) return 'Без дедлайну';
  return new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short' }).format(timestamp);
}

function avatar(person) {
  return person?.avatar
    ? `<img src="${escapeHtml(person.avatar)}" alt="">`
    : `<span>${escapeHtml(initials(person?.name))}</span>`;
}

async function loadData(password = state.password) {
  $('#refreshButton').classList.add('loading');
  const response = await fetch('/api/dashboard', { headers: { 'x-dashboard-password': password } });
  if (!response.ok) throw new Error(response.status === 401 ? 'WRONG_PASSWORD' : 'LOAD_FAILED');
  const data = await response.json();
  state.password = password;
  state.tasks = data.tasks;
  state.members = data.members;
  sessionStorage.setItem('dashboardPassword', password);
  $('#updatedAt').textContent = `Дані ClickUp · оновлено ${new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' }).format(data.fetchedAt)}`;
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  render();
  $('#refreshButton').classList.remove('loading');
}

function renderMetrics() {
  const active = state.tasks.filter((task) => !isDone(task));
  const done = state.tasks.filter(isDone);
  const overdue = active.filter((task) => task.dueDate && task.dueDate < startOfToday());
  const unassigned = active.filter((task) => !task.assignees.length);
  const cards = [
    ['Активні задачі', active.length, 'Зараз у роботі', 'violet'],
    ['Завершено', done.length, 'За весь доступний період', 'green'],
    ['Прострочено', overdue.length, overdue.length ? 'Потребують уваги' : 'Усе за планом', 'orange'],
    ['Без виконавця', unassigned.length, 'Ще не розподілені', 'blue'],
  ];
  $('#metrics').innerHTML = cards.map(([label, value, note, color]) => `
    <article class="metric ${color}"><p>${label}</p><strong>${value}</strong><span>${note}</span></article>
  `).join('');
}

function renderPeople() {
  const active = state.tasks.filter((task) => !isDone(task));
  const people = state.members.map((member) => {
    const tasks = active.filter((task) => task.assignees.some((person) => String(person.id) === String(member.id)));
    const overdue = tasks.filter((task) => task.dueDate && task.dueDate < startOfToday()).length;
    return { ...member, tasks, overdue };
  }).sort((a, b) => b.tasks.length - a.tasks.length);
  $('#people').innerHTML = people.map((person) => `
    <button class="person-card ${state.filters.person === String(person.id) ? 'selected' : ''}" data-person="${person.id}">
      <div class="avatar">${avatar(person)}</div>
      <div class="person-copy"><strong>${escapeHtml(person.name)}</strong><span>${person.tasks.length ? escapeHtml(person.tasks[0].name) : 'Немає активних задач'}</span></div>
      <div class="workload"><strong>${person.tasks.length}</strong><span>активних</span>${person.overdue ? `<em>${person.overdue} простр.</em>` : ''}</div>
    </button>
  `).join('') || '<p class="muted">У цьому списку немає учасників.</p>';
  document.querySelectorAll('[data-person]').forEach((button) => button.addEventListener('click', () => {
    const person = button.dataset.person;
    state.filters.person = state.filters.person === person ? 'all' : person;
    $('#personFilter').value = state.filters.person;
    renderPeople();
    renderTasks();
  }));
}

function matchesDue(task, filter) {
  if (filter === 'all') return true;
  if (filter === 'none') return !task.dueDate;
  if (!task.dueDate || isDone(task)) return false;
  const today = startOfToday();
  if (filter === 'overdue') return task.dueDate < today;
  if (filter === 'today') return task.dueDate >= today && task.dueDate < today + day;
  if (filter === 'week') return task.dueDate >= today && task.dueDate < today + 7 * day;
  return true;
}

function renderTasks() {
  const query = state.filters.search.toLowerCase();
  const tasks = state.tasks.filter((task) =>
    (!query || task.name.toLowerCase().includes(query))
    && (state.filters.person === 'all' || (state.filters.person === 'none'
      ? !task.assignees.length
      : task.assignees.some((person) => String(person.id) === state.filters.person)))
    && (state.filters.status === 'all' || task.status?.name === state.filters.status)
    && matchesDue(task, state.filters.due)
  ).sort((a, b) => (isDone(a) - isDone(b)) || ((a.dueDate || Infinity) - (b.dueDate || Infinity)));
  $('#resultCount').textContent = `${tasks.length} задач`;
  $('#taskRows').innerHTML = tasks.map((task) => {
    const overdue = !isDone(task) && task.dueDate && task.dueDate < startOfToday();
    return `<tr>
      <td><strong>${escapeHtml(task.name)}</strong><span class="mobile-meta">${escapeHtml(task.status?.name || 'Без статусу')}</span></td>
      <td><div class="assignees">${task.assignees.length ? task.assignees.map((person) => `<div class="mini-avatar" title="${escapeHtml(person.name)}">${avatar(person)}</div>`).join('') : '<span class="muted">—</span>'}</div></td>
      <td><span class="status"><i style="background:${escapeHtml(task.status?.color || '#94a3b8')}"></i>${escapeHtml(task.status?.name || 'Без статусу')}</span></td>
      <td class="${overdue ? 'overdue' : ''}">${formatDate(task.dueDate)}</td>
      <td>${task.priority ? `<span class="priority"><i style="background:${escapeHtml(task.priority.color)}"></i>${escapeHtml(task.priority.name)}</span>` : '<span class="muted">—</span>'}</td>
      <td><a class="open-task" href="${escapeHtml(task.url)}" target="_blank" rel="noopener" aria-label="Відкрити в ClickUp">↗</a></td>
    </tr>`;
  }).join('');
  $('#emptyState').classList.toggle('hidden', tasks.length > 0);
}

function populateFilters() {
  $('#personFilter').innerHTML = '<option value="all">Усі виконавці</option><option value="none">Без виконавця</option>'
    + state.members.map((person) => `<option value="${person.id}">${escapeHtml(person.name)}</option>`).join('');
  const statuses = [...new Set(state.tasks.map((task) => task.status?.name).filter(Boolean))];
  $('#statusFilter').innerHTML = '<option value="all">Усі статуси</option>'
    + statuses.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join('');
}

function render() {
  populateFilters();
  renderMetrics();
  renderPeople();
  renderTasks();
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#loginError').textContent = '';
  try { await loadData($('#password').value); }
  catch (error) { $('#loginError').textContent = error.message === 'WRONG_PASSWORD' ? 'Невірний пароль.' : 'Не вдалося завантажити дані.'; }
});
$('#refreshButton').addEventListener('click', () => loadData().catch(() => { $('#updatedAt').textContent = 'Не вдалося оновити дані'; }));
$('#logoutButton').addEventListener('click', () => { sessionStorage.removeItem('dashboardPassword'); location.reload(); });
$('#searchInput').addEventListener('input', (event) => { state.filters.search = event.target.value; renderTasks(); });
$('#personFilter').addEventListener('change', (event) => { state.filters.person = event.target.value; renderPeople(); renderTasks(); });
$('#statusFilter').addEventListener('change', (event) => { state.filters.status = event.target.value; renderTasks(); });
$('#dueFilter').addEventListener('change', (event) => { state.filters.due = event.target.value; renderTasks(); });

const savedPassword = sessionStorage.getItem('dashboardPassword');
if (savedPassword) loadData(savedPassword).catch(() => sessionStorage.removeItem('dashboardPassword'));
