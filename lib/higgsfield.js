const API_BASE = 'https://api.higgsfield.ai';
const MODEL_PATH = '/higgsfield/genjutsu-light/motion-transfer/v1.0';

export const VIDEO_MAX_BYTES = 250 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_MAX_COUNT = 8;
export const PROMPT_MAX_LENGTH = 10_000;
export const VIDEO_TYPES = new Set(['video/mp4']);
export const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
export const RESOLUTIONS = new Set(['480p', '720p', '1080p']);
export const TERMINAL_STATUSES = new Set(['completed', 'failed', 'nsfw', 'canceled']);

export class HiggsfieldRequestError extends Error {
  constructor(message, status = 400, code = 'INVALID_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function validateCredentials(value) {
  const credentials = String(value || '').trim();
  if (!/^[^:\s]{3,200}:[^:\s]{3,500}$/.test(credentials)) {
    throw new HiggsfieldRequestError('API-ключ має формат KEY_ID:KEY_SECRET.', 400, 'INVALID_API_KEY_FORMAT');
  }
  return credentials;
}

export function validateUploadMetadata(value) {
  const kind = value?.kind === 'video' ? 'video' : value?.kind === 'image' ? 'image' : '';
  const contentType = String(value?.contentType || '').toLowerCase();
  const size = Number(value?.size);
  if (!kind) throw new HiggsfieldRequestError('Невідомий тип файлу.');
  const allowedTypes = kind === 'video' ? VIDEO_TYPES : IMAGE_TYPES;
  const maxBytes = kind === 'video' ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
  if (!allowedTypes.has(contentType)) {
    throw new HiggsfieldRequestError(kind === 'video' ? 'Потрібен MP4-файл.' : 'Непідтримуваний формат зображення.');
  }
  if (!Number.isInteger(size) || size <= 0 || size > maxBytes) {
    const maxMb = Math.round(maxBytes / 1024 / 1024);
    throw new HiggsfieldRequestError(`Файл має бути не більшим за ${maxMb} МБ.`);
  }
  return { kind, contentType, size };
}

export function validateGenerationInput(value) {
  const prompt = String(value?.prompt || '').trim();
  const resolution = String(value?.resolution || '480p');
  const videoUploadId = String(value?.videoUploadId || '');
  const imageUploadIds = Array.isArray(value?.imageUploadIds)
    ? value.imageUploadIds.map(String)
    : [];
  const idempotencyKey = String(value?.idempotencyKey || '');
  if (!prompt || prompt.length > PROMPT_MAX_LENGTH) {
    throw new HiggsfieldRequestError(`Промпт має містити від 1 до ${PROMPT_MAX_LENGTH} символів.`);
  }
  if (!RESOLUTIONS.has(resolution)) throw new HiggsfieldRequestError('Непідтримувана роздільна здатність.');
  if (!/^[0-9a-f-]{36}$/i.test(videoUploadId)) throw new HiggsfieldRequestError('Відео не завантажено.');
  if (imageUploadIds.length < 1 || imageUploadIds.length > IMAGE_MAX_COUNT
    || imageUploadIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
    throw new HiggsfieldRequestError('Потрібно завантажити від 1 до 8 зображень.');
  }
  if (!/^[!-~]{1,255}$/.test(idempotencyKey)) {
    throw new HiggsfieldRequestError('Некоректний ключ запуску генерації.');
  }
  return { prompt, resolution, videoUploadId, imageUploadIds, idempotencyKey };
}

export function validateRequestId(value) {
  const requestId = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new HiggsfieldRequestError('Некоректний request_id.');
  }
  return requestId;
}

async function apiRequest(path, credentials, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(8000),
    headers: {
      Authorization: `Key ${credentials}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : `HTTP ${response.status}`;
    throw new HiggsfieldRequestError(detail, response.status, 'HIGGSFIELD_ERROR');
  }
  return data;
}

function httpsUrl(value, field) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('HTTPS required');
    return url.href;
  } catch {
    throw new HiggsfieldRequestError(`Higgsfield повернув некоректний ${field}.`, 502, 'INVALID_UPSTREAM_RESPONSE');
  }
}

export async function createUploadTarget(credentials, contentType) {
  const data = await apiRequest('/files/generate-upload-url', credentials, {
    method: 'POST',
    body: JSON.stringify({ content_type: contentType }),
  });
  if (!data.upload_headers || typeof data.upload_headers !== 'object' || Array.isArray(data.upload_headers)) {
    throw new HiggsfieldRequestError('Higgsfield не повернув upload_headers.', 502, 'INVALID_UPSTREAM_RESPONSE');
  }
  return {
    publicUrl: httpsUrl(data.public_url, 'public_url'),
    uploadUrl: httpsUrl(data.upload_url, 'upload_url'),
    uploadHeaders: Object.fromEntries(Object.entries(data.upload_headers).map(([key, value]) => [String(key), String(value)])),
  };
}

export async function submitGeneration(credentials, input) {
  const data = await apiRequest(MODEL_PATH, credentials, {
    method: 'POST',
    headers: { 'Idempotency-Key': input.idempotencyKey },
    body: JSON.stringify({
      prompt: input.prompt,
      video_url: input.videoUrl,
      image_urls: input.imageUrls,
      resolution: input.resolution,
    }),
  });
  return {
    requestId: validateRequestId(data.request_id),
    status: String(data.status || 'queued'),
  };
}

export async function getGenerationStatus(credentials, requestId) {
  const data = await apiRequest(`/requests/${encodeURIComponent(validateRequestId(requestId))}/status`, credentials, {
    method: 'GET',
  });
  const status = String(data.status || '');
  if (!['queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled'].includes(status)) {
    throw new HiggsfieldRequestError('Higgsfield повернув невідомий статус.', 502, 'INVALID_UPSTREAM_RESPONSE');
  }
  return {
    requestId: validateRequestId(data.request_id),
    status,
    error: typeof data.error === 'string' ? data.error : null,
    videoUrl: status === 'completed' && data.video?.url ? httpsUrl(data.video.url, 'video.url') : null,
    expiresAt: data.expires_at || null,
  };
}
