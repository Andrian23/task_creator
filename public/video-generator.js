const state = {
  password: '',
  video: null,
  images: [],
  busy: false,
  pollingController: null,
  previewUrls: new Set(),
};

const $ = (selector) => document.querySelector(selector);
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'nsfw', 'canceled']);

function apiKey() {
  return $('#apiKey').value.trim();
}

async function api(body, { signal, requireKey = true } = {}) {
  const headers = { 'Content-Type': 'application/json', 'x-dashboard-password': state.password };
  if (requireKey) headers['x-higgsfield-key'] = apiKey();
  const response = await fetch('/api/video-generator', {
    method: 'POST', headers, body: JSON.stringify(body), signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || (response.status === 401 ? 'Невірний пароль.' : `Помилка HTTP ${response.status}`));
  return data;
}

function setBusy(value) {
  state.busy = value;
  $('#generateButton').disabled = value;
  $('#videoInput').disabled = value;
  $('#imageInput').disabled = value;
  $('#restoreButton').disabled = value;
}

function showSteps(items) {
  $('#steps').innerHTML = '';
  for (const { text, state: itemState = '' } of items) {
    const item = document.createElement('li');
    item.className = itemState;
    item.textContent = text;
    $('#steps').append(item);
  }
}

function clearPreviewUrl(url) {
  if (!url) return;
  URL.revokeObjectURL(url);
  state.previewUrls.delete(url);
}

function setVideo(file) {
  if (state.video?.previewUrl) clearPreviewUrl(state.video.previewUrl);
  if (!file) {
    state.video = null;
    $('#videoPreview').removeAttribute('src');
    $('#videoSource').classList.add('hidden');
    $('#videoInput').value = '';
    return;
  }
  if (file.type !== 'video/mp4' || file.size <= 0 || file.size > MAX_VIDEO_BYTES) {
    throw new Error('Оберіть MP4 до 250 МБ.');
  }
  const previewUrl = URL.createObjectURL(file);
  state.previewUrls.add(previewUrl);
  state.video = { file, previewUrl };
  $('#videoPreview').src = previewUrl;
  $('#videoName').textContent = file.name;
  $('#videoSource').classList.remove('hidden');
}

function renderImages() {
  $('#imageGrid').innerHTML = '';
  state.images.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'image-card';
    const image = document.createElement('img');
    image.src = item.previewUrl;
    image.alt = item.file.name;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '×';
    button.title = 'Видалити';
    button.onclick = () => {
      clearPreviewUrl(item.previewUrl);
      state.images.splice(index, 1);
      renderImages();
    };
    card.append(image, button);
    $('#imageGrid').append(card);
  });
}

function addImages(files) {
  if (state.images.length + files.length > 8) throw new Error('Можна додати максимум 8 зображень.');
  for (const file of files) {
    if (!IMAGE_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      throw new Error(`Файл «${file.name}» має непідтримуваний формат або перевищує 20 МБ.`);
    }
  }
  for (const file of files) {
    const previewUrl = URL.createObjectURL(file);
    state.previewUrls.add(previewUrl);
    state.images.push({ file, previewUrl });
  }
  renderImages();
}

async function uploadFile(item, kind, position, total) {
  showSteps([{ text: `Файл ${position}/${total}: отримання адреси завантаження`, state: 'active' }]);
  const target = await api({ action: 'uploadUrl', kind, contentType: item.file.type, size: item.file.size });
  showSteps([{ text: `Файл ${position}/${total}: завантаження у сховище`, state: 'active' }]);
  const response = await fetch(target.uploadUrl, {
    method: 'PUT',
    headers: target.uploadHeaders,
    body: item.file,
  });
  if (!response.ok) throw new Error(`Не вдалося завантажити файл «${item.file.name}» (HTTP ${response.status}).`);
  return target.uploadId;
}

function statusLabel(status) {
  return ({ queued: 'Запит у черзі Higgsfield', in_progress: 'Higgsfield генерує відео' })[status] || status;
}

function showResult(result) {
  $('#resultVideo').src = result.videoUrl;
  $('#openResult').href = result.videoUrl;
  $('#downloadResult').href = result.videoUrl;
  $('#resultExpiry').textContent = result.expiresAt ? `Посилання доступне до ${new Date(result.expiresAt).toLocaleString('uk-UA')}.` : '';
  $('#resultPanel').classList.remove('hidden');
}

async function pollStatus(requestId) {
  state.pollingController?.abort();
  state.pollingController = new AbortController();
  const { signal } = state.pollingController;
  const startedAt = Date.now();
  let delay = 3000;
  let failures = 0;
  setBusy(true);
  $('#restore').classList.add('hidden');
  $('#requestId').textContent = requestId;
  $('#requestRow').classList.remove('hidden');
  try {
    while (!signal.aborted && Date.now() - startedAt < 15 * 60 * 1000) {
      const result = await api({ action: 'status', requestId }, { signal }).catch((error) => {
        failures += 1;
        if (failures >= 5) throw error;
        return null;
      });
      if (result) {
        failures = 0;
        showSteps([{ text: statusLabel(result.status), state: result.status === 'failed' || result.status === 'nsfw' || result.status === 'canceled' ? 'error' : 'active' }]);
        if (result.status === 'completed') {
          sessionStorage.removeItem('higgsfieldRequestId');
          showSteps([{ text: 'Відео успішно згенеровано', state: 'done' }]);
          showResult(result);
          return;
        }
        if (TERMINAL_STATUSES.has(result.status)) {
          sessionStorage.removeItem('higgsfieldRequestId');
          throw new Error(result.error || ({ nsfw: 'Генерацію зупинено фільтром безпеки.', canceled: 'Генерацію скасовано.' })[result.status] || 'Генерація завершилася помилкою.');
        }
      }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
      });
      delay = Math.min(Math.round(delay * 1.5), 15000);
    }
    if (!signal.aborted) throw new Error('Перевірку зупинено через 15 хвилин. Request ID збережено — її можна відновити пізніше.');
  } finally {
    setBusy(false);
  }
}

async function generate(event) {
  event.preventDefault();
  if (state.busy) return;
  $('#formError').textContent = '';
  $('#resultPanel').classList.add('hidden');
  try {
    if (!/^[^:\s]+:[^:\s]+$/.test(apiKey())) throw new Error('Введіть API-ключ у форматі KEY_ID:KEY_SECRET.');
    if (!state.video) throw new Error('Додайте MP4-відео.');
    if (state.images.length < 1 || state.images.length > 8) throw new Error('Додайте від 1 до 8 зображень.');
    const prompt = $('#prompt').value.trim();
    if (!prompt || prompt.length > 10000) throw new Error('Перевірте довжину промпта.');
    setBusy(true);
    const items = [{ ...state.video, kind: 'video' }, ...state.images.map((item) => ({ ...item, kind: 'image' }))];
    const uploadIds = [];
    for (let index = 0; index < items.length; index += 1) {
      uploadIds.push(await uploadFile(items[index], items[index].kind, index + 1, items.length));
    }
    showSteps([{ text: 'Файли завантажено', state: 'done' }, { text: 'Створення платного запиту генерації', state: 'active' }]);
    const idempotencyKey = crypto.randomUUID();
    const result = await api({
      action: 'generate',
      prompt,
      resolution: $('#resolution').value,
      videoUploadId: uploadIds[0],
      imageUploadIds: uploadIds.slice(1),
      idempotencyKey,
    });
    sessionStorage.setItem('higgsfieldRequestId', result.requestId);
    await pollStatus(result.requestId);
  } catch (error) {
    if (error.name !== 'AbortError') {
      $('#formError').textContent = error.message;
      showSteps([{ text: error.message, state: 'error' }]);
    }
    setBusy(false);
  }
}

async function authorize(password) {
  state.password = password;
  await api({ action: 'authorize' }, { requireKey: false });
  sessionStorage.setItem('dashboardPassword', password);
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  const requestId = sessionStorage.getItem('higgsfieldRequestId');
  if (requestId) {
    $('#savedRequestId').textContent = requestId;
    $('#restore').classList.remove('hidden');
  }
}

$('#loginForm').onsubmit = async (event) => {
  event.preventDefault();
  $('#loginError').textContent = '';
  try { await authorize($('#password').value); } catch (error) { $('#loginError').textContent = error.message; }
};
$('#toggleKey').onclick = () => {
  const hidden = $('#apiKey').type === 'password';
  $('#apiKey').type = hidden ? 'text' : 'password';
  $('#toggleKey').textContent = hidden ? 'Приховати' : 'Показати';
};
$('#videoInput').onchange = (event) => { try { setVideo(event.target.files[0]); $('#formError').textContent = ''; } catch (error) { setVideo(null); $('#formError').textContent = error.message; } };
$('#removeVideo').onclick = () => setVideo(null);
$('#imageInput').onchange = (event) => { try { addImages([...event.target.files]); $('#formError').textContent = ''; } catch (error) { $('#formError').textContent = error.message; } event.target.value = ''; };
$('#prompt').oninput = () => { $('#promptCount').textContent = `${$('#prompt').value.length} / 10 000`; };
$('#prompt').dispatchEvent(new Event('input'));
$('#generatorForm').onsubmit = generate;
$('#restoreButton').onclick = async () => {
  $('#formError').textContent = '';
  if (!/^[^:\s]+:[^:\s]+$/.test(apiKey())) { $('#formError').textContent = 'Повторно введіть Higgsfield API-ключ.'; return; }
  try { await pollStatus(sessionStorage.getItem('higgsfieldRequestId')); } catch (error) { if (error.name !== 'AbortError') { $('#formError').textContent = error.message; showSteps([{ text: error.message, state: 'error' }]); } }
};
$('#logoutButton').onclick = () => { state.pollingController?.abort(); sessionStorage.removeItem('dashboardPassword'); location.reload(); };
window.addEventListener('pagehide', () => { state.pollingController?.abort(); state.previewUrls.forEach((url) => URL.revokeObjectURL(url)); });

const savedPassword = sessionStorage.getItem('dashboardPassword');
if (savedPassword) authorize(savedPassword).catch(() => sessionStorage.removeItem('dashboardPassword'));
