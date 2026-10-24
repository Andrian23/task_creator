import { randomUUID } from 'node:crypto';
import { getJson, setJson } from '../lib/redis.js';
import {
  HiggsfieldRequestError,
  createUploadTarget,
  getGenerationStatus,
  submitGeneration,
  validateCredentials,
  validateGenerationInput,
  validateRequestId,
  validateUploadMetadata,
} from '../lib/higgsfield.js';

const UPLOAD_TTL_SECONDS = 60 * 60;
const UPLOAD_PREFIX = 'video-generator:upload:';

function isAuthorized(req) {
  const password = process.env.DASHBOARD_PASSWORD;
  return Boolean(password) && req.headers['x-dashboard-password'] === password;
}

function credentials(req) {
  return validateCredentials(req.headers['x-higgsfield-key']);
}

function uploadKey(uploadId) {
  return `${UPLOAD_PREFIX}${uploadId}`;
}

async function resolveUploads(input) {
  const [video, ...images] = await Promise.all([
    getJson(uploadKey(input.videoUploadId)),
    ...input.imageUploadIds.map((id) => getJson(uploadKey(id))),
  ]);
  if (!video || video.kind !== 'video') throw new HiggsfieldRequestError('Посилання на відео протерміноване. Завантаж файл повторно.');
  if (images.some((image) => !image || image.kind !== 'image')) {
    throw new HiggsfieldRequestError('Одне з посилань на зображення протерміноване. Завантаж файли повторно.');
  }
  return { videoUrl: video.publicUrl, imageUrls: images.map(({ publicUrl }) => publicUrl) };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  try {
    const action = req.body?.action;
    if (action === 'authorize') {
      res.status(200).json({ ok: true });
      return;
    }
    const apiKey = credentials(req);
    if (action === 'uploadUrl') {
      const metadata = validateUploadMetadata(req.body);
      const target = await createUploadTarget(apiKey, metadata.contentType);
      const uploadId = randomUUID();
      await setJson(uploadKey(uploadId), {
        kind: metadata.kind,
        contentType: metadata.contentType,
        size: metadata.size,
        publicUrl: target.publicUrl,
        createdAt: Date.now(),
      }, UPLOAD_TTL_SECONDS);
      res.status(200).json({
        uploadId,
        uploadUrl: target.uploadUrl,
        uploadHeaders: target.uploadHeaders,
        expiresIn: UPLOAD_TTL_SECONDS,
      });
      return;
    }
    if (action === 'generate') {
      const input = validateGenerationInput(req.body);
      const urls = await resolveUploads(input);
      const result = await submitGeneration(apiKey, { ...input, ...urls });
      res.status(200).json(result);
      return;
    }
    if (action === 'status') {
      const result = await getGenerationStatus(apiKey, validateRequestId(req.body?.requestId));
      res.status(200).json(result);
      return;
    }
    res.status(400).json({ error: 'UNKNOWN_ACTION', message: 'Невідома дія.' });
  } catch (error) {
    const status = error instanceof HiggsfieldRequestError ? error.status : 502;
    const code = error instanceof HiggsfieldRequestError ? error.code : 'VIDEO_GENERATOR_FAILED';
    const message = error instanceof HiggsfieldRequestError
      ? error.message
      : 'Не вдалося виконати запит. Спробуйте ще раз пізніше.';
    if (!(error instanceof HiggsfieldRequestError)) console.error('Video generator request failed');
    res.status(status).json({ error: code, message });
  }
}
