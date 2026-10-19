const state = { password: '', data: null, selected: {}, search: '' };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

async function api(options = {}) {
  const response = await fetch('/api/dashboard', { ...options, headers: { 'Content-Type': 'application/json', 'x-dashboard-password': state.password, ...options.headers } });
  if (!response.ok) throw new Error(response.status === 401 ? 'WRONG_PASSWORD' : 'REQUEST_FAILED');
  return response.json();
}

async function load(password = state.password) {
  state.password = password;
  state.data = await api();
  sessionStorage.setItem('dashboardPassword', password);
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#updatedAt').textContent = `Оновлено ${new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' }).format(state.data.fetchedAt)}`;
  render();
}

function render() {
  const { pending, projects, mappings, members, assigneeTags } = state.data;
  $('#storageAlert').classList.toggle('hidden', !state.data.storageError);
  $('#metrics').innerHTML = [['Чекають matching', pending.length], ['Активні проєкти', projects.length], ['Привʼязані чати', mappings.length]].map(([label, count]) => `<article class="metric"><p>${label}</p><strong>${count}</strong></article>`).join('');
  $('#pending').innerHTML = pending.map((item) => `<div class="chat-card"><strong>${escapeHtml(item.event.topic || item.event.author || item.event.roomId)}</strong><p>${escapeHtml(item.event.message)}</p><small>${escapeHtml(item.event.author)}</small><div class="match-row"><select data-select="${item.nonce}"><option value="">Оберіть проєкт</option>${projects.map((project) => `<option value="${project.id}" ${item.candidateIds.includes(project.id) ? 'data-suggested="true"' : ''}>${item.candidateIds.includes(project.id) ? '★ ' : ''}${escapeHtml(project.name)}</option>`).join('')}</select><button data-match="${item.nonce}">Привʼязати</button></div></div>`).join('') || '<p class="empty">Нових чатів для зіставлення немає.</p>';
  renderProjects();
  $('#mappings').innerHTML = mappings.map((mapping) => `<div class="mapping"><div><strong>${escapeHtml(mapping.taskName)}</strong><small>${escapeHtml(mapping.roomId)}</small></div><button class="danger" data-delete="${escapeHtml(mapping.roomId)}">Видалити</button></div>`).join('') || '<p class="empty">Звʼязків ще немає.</p>';
  $('#tags').innerHTML = members.map((member) => `<label><span>${escapeHtml(member.name)}</span><select data-member="${member.id}"><option value="">Без тега</option><option value="@annaaaaa_kk" ${assigneeTags[member.id] === '@annaaaaa_kk' ? 'selected' : ''}>@annaaaaa_kk</option><option value="@karynakrnnk" ${assigneeTags[member.id] === '@karynakrnnk' ? 'selected' : ''}>@karynakrnnk</option></select></label>`).join('');
  bindActions();
}

function renderProjects() {
  const query = state.search.toLowerCase();
  $('#projects').innerHTML = state.data.projects.filter((project) => project.name.toLowerCase().includes(query)).map((project) => `<a href="${escapeHtml(project.url)}" target="_blank" rel="noopener"><span><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.assignees.map((person) => person.name).join(', ') || 'Без відповідального')}</small></span><em>${escapeHtml(project.status)}</em></a>`).join('');
}

function bindActions() {
  document.querySelectorAll('[data-match]').forEach((button) => button.onclick = async () => {
    const nonce = button.dataset.match; const taskId = document.querySelector(`[data-select="${nonce}"]`).value;
    if (!taskId) return;
    button.disabled = true;
    await api({ method: 'POST', body: JSON.stringify({ action: 'match', nonce, taskId }) }); await load();
  });
  document.querySelectorAll('[data-delete]').forEach((button) => button.onclick = async () => {
    await api({ method: 'POST', body: JSON.stringify({ action: 'deleteMapping', roomId: button.dataset.delete }) }); await load();
  });
}

$('#loginForm').onsubmit = async (event) => { event.preventDefault(); $('#loginError').textContent = ''; try { await load($('#password').value); } catch (error) { $('#loginError').textContent = error.message === 'WRONG_PASSWORD' ? 'Невірний пароль.' : 'Не вдалося завантажити дані.'; } };
$('#refreshButton').onclick = () => load(); $('#logoutButton').onclick = () => { sessionStorage.clear(); location.reload(); };
$('#projectSearch').oninput = (event) => { state.search = event.target.value; renderProjects(); };
$('#saveTags').onclick = async () => { const tags = Object.fromEntries([...document.querySelectorAll('[data-member]')].map((select) => [select.dataset.member, select.value])); await api({ method: 'POST', body: JSON.stringify({ action: 'saveTags', tags }) }); $('#tagStatus').textContent = 'Збережено.'; await load(); };
const saved = sessionStorage.getItem('dashboardPassword'); if (saved) load(saved).catch(() => sessionStorage.removeItem('dashboardPassword'));
