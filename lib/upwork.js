import { createHash, randomUUID } from 'node:crypto';
import { addClickUpTaskComment, getActiveClickUpProjects } from './clickup.js';
import { deleteKey, getJson, setJson } from './redis.js';
import { sendMessage } from './telegram.js';

const ROOM_PREFIX = 'upwork:room:';
const EVENT_PREFIX = 'upwork:event:';
const PENDING_PREFIX = 'upwork:pending:';
const IGNORED_PREFIX = 'upwork:ignored:';
const PLACEHOLDER_TEXTS = [
  'maxime est vitae',
  'quisque fringilla risus nec tortor dignissim semper incidunt lectus pharetra',
];

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function eventFingerprint(event) {
  const basis = [event.roomId, event.messageId, event.author, event.message, event.timestamp].map(normalized).join('|');
  return createHash('sha256').update(basis).digest('hex');
}

export function validateUpworkEvent(value) {
  if (!value || typeof value !== 'object') return null;
  const event = {
    roomId: String(value.roomId || '').slice(0, 200),
    messageId: String(value.messageId || '').slice(0, 200),
    author: String(value.author || '').trim().slice(0, 200),
    topic: String(value.topic || '').trim().slice(0, 300),
    message: String(value.message || '').trim().slice(0, 4000),
    timestamp: String(value.timestamp || '').slice(0, 100),
    url: String(value.url || '').slice(0, 1000),
    receivedAt: Date.now(),
    discovery: value.discovery === true,
  };
  if (!event.roomId || !event.message) return null;
  const searchable = normalized(`${event.author} ${event.topic} ${event.message}`);
  if (PLACEHOLDER_TEXTS.some((placeholder) => searchable.includes(placeholder))) return null;
  try {
    const url = new URL(event.url);
    if (url.hostname !== 'www.upwork.com') event.url = '';
  } catch { event.url = ''; }
  return event;
}

export function findProjectCandidates(event, projects) {
  const topic = normalized(event.topic);
  if (!topic) return [];
  const exact = projects.filter((project) => normalized(project.name) === topic);
  if (exact.length) return exact;
  return projects.filter((project) => {
    const name = normalized(project.name);
    return name.length >= 4 && (name.includes(topic) || topic.includes(name));
  });
}

function commentText(event) {
  return [`Upwork · ${event.author || 'Невідомий автор'}`, event.message, event.url ? `Відкрити чат: ${event.url}` : '']
    .filter(Boolean).join('\n\n');
}

async function telegramUsername(project) {
  for (const assignee of project.assignees || []) {
    const username = await getJson(`upwork:assignee:${assignee.id}`);
    if (username) return username;
  }
  return '';
}

export async function deliverUpworkEvent(event, project, fingerprint = eventFingerprint(event)) {
  const state = await getJson(`${EVENT_PREFIX}${fingerprint}`);
  if (state?.status === 'delivered') return { duplicate: true };
  await addClickUpTaskComment(project.id, commentText(event));
  await setJson(`${ROOM_PREFIX}${event.roomId}`, { taskId: project.id, taskName: project.name, updatedAt: Date.now() });
  await setJson(`${EVENT_PREFIX}${fingerprint}`, { status: 'delivered', roomId: event.roomId, taskId: project.id }, 60 * 60 * 24 * 90);
  const mention = await telegramUsername(project);
  const chatId = process.env.TELEGRAM_UPWORK_CHAT_ID;
  if (chatId) {
    await sendMessage(chatId, [`💬 Нове повідомлення Upwork`, `Проєкт: ${project.name}`, mention, `Від: ${event.author || 'Невідомо'}`, '', event.message, event.url].filter(Boolean).join('\n'), { disable_web_page_preview: true });
  }
  return { delivered: true, project };
}

export async function ingestUpworkEvent(rawEvent) {
  const event = validateUpworkEvent(rawEvent);
  if (!event) return { error: 'INVALID_EVENT' };
  const fingerprint = eventFingerprint(event);
  if (await getJson(`${IGNORED_PREFIX}${event.roomId}`)) return { ignored: true };
  const knownEvent = await getJson(`${EVENT_PREFIX}${fingerprint}`);
  if (knownEvent) return { duplicate: true };

  const projects = await getActiveClickUpProjects();
  const mapping = await getJson(`${ROOM_PREFIX}${event.roomId}`);
  const mappedProject = mapping && projects.find((project) => project.id === mapping.taskId);
  if (event.discovery && mappedProject) {
    await setJson(`${EVENT_PREFIX}${fingerprint}`, { status: 'discovered', roomId: event.roomId, taskId: mappedProject.id }, 60 * 60 * 24 * 90);
    return { discovered: true, project: mappedProject };
  }
  if (mappedProject) return deliverUpworkEvent(event, mappedProject, fingerprint);

  const candidates = findProjectCandidates(event, projects);
  if (event.discovery && candidates.length === 1) {
    await setJson(`${ROOM_PREFIX}${event.roomId}`, { taskId: candidates[0].id, taskName: candidates[0].name, updatedAt: Date.now() });
    await setJson(`${EVENT_PREFIX}${fingerprint}`, { status: 'discovered', roomId: event.roomId, taskId: candidates[0].id }, 60 * 60 * 24 * 90);
    return { discovered: true, project: candidates[0] };
  }
  if (candidates.length === 1) return deliverUpworkEvent(event, candidates[0], fingerprint);

  const nonce = randomUUID();
  await setJson(`${EVENT_PREFIX}${fingerprint}`, { status: 'pending', nonce }, 60 * 60 * 24 * 30);
  await setJson(`${PENDING_PREFIX}${nonce}`, { event, fingerprint, candidateIds: candidates.map(({ id }) => id) }, 60 * 60 * 24 * 30);
  const chatId = process.env.TELEGRAM_UPWORK_CHAT_ID;
  if (chatId && !event.discovery) {
    const buttons = (candidates.length ? candidates : projects).slice(0, 20).map((project) => [{
      text: project.name.slice(0, 50), callback_data: `uw:${nonce}:${project.id}`.slice(0, 64),
    }]);
    await sendMessage(chatId, `Не вдалося однозначно визначити проєкт для чату «${event.topic || event.author || event.roomId}».`, {
      reply_markup: { inline_keyboard: buttons },
    });
  }
  return { pending: true, nonce, candidates: candidates.length };
}

export async function resolvePendingUpworkEvent(nonce, taskId) {
  const pending = await getJson(`${PENDING_PREFIX}${nonce}`);
  if (!pending) return { error: 'PENDING_NOT_FOUND' };
  const projects = await getActiveClickUpProjects();
  const project = projects.find((item) => String(item.id) === String(taskId));
  if (!project) return { error: 'PROJECT_NOT_ACTIVE' };
  if (pending.event.discovery) {
    await setJson(`${ROOM_PREFIX}${pending.event.roomId}`, { taskId: project.id, taskName: project.name, updatedAt: Date.now() });
    await setJson(`${EVENT_PREFIX}${pending.fingerprint}`, { status: 'discovered', roomId: pending.event.roomId, taskId: project.id }, 60 * 60 * 24 * 90);
    await deleteKey(`${PENDING_PREFIX}${nonce}`);
    return { mapped: true, project };
  }
  const result = await deliverUpworkEvent(pending.event, project, pending.fingerprint);
  if (!result.error) await deleteKey(`${PENDING_PREFIX}${nonce}`);
  return result;
}
