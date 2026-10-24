import assert from 'node:assert';
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
import videoGeneratorHandler from '../api/video-generator.js';

assert.strictEqual(validateCredentials('key-id:key-secret'), 'key-id:key-secret');
assert.throws(() => validateCredentials('missing-secret'), HiggsfieldRequestError);
assert.deepStrictEqual(validateUploadMetadata({ kind: 'video', contentType: 'video/mp4', size: 1024 }), {
  kind: 'video', contentType: 'video/mp4', size: 1024,
});
assert.throws(() => validateUploadMetadata({ kind: 'video', contentType: 'video/quicktime', size: 1024 }), HiggsfieldRequestError);
assert.throws(() => validateUploadMetadata({ kind: 'image', contentType: 'image/png', size: 21 * 1024 * 1024 }), HiggsfieldRequestError);

const uuid = '123e4567-e89b-42d3-a456-426614174000';
assert.strictEqual(validateRequestId(uuid), uuid);
assert.deepStrictEqual(validateGenerationInput({
  prompt: 'Test', resolution: '480p', videoUploadId: uuid, imageUploadIds: [uuid], idempotencyKey: uuid,
}), {
  prompt: 'Test', resolution: '480p', videoUploadId: uuid, imageUploadIds: [uuid], idempotencyKey: uuid,
});
assert.throws(() => validateGenerationInput({ prompt: 'Test', resolution: '4k' }), HiggsfieldRequestError);

const calls = [];
global.fetch = async (url, options) => {
  calls.push({ url, options });
  if (url.endsWith('/files/generate-upload-url')) {
    return new Response(JSON.stringify({
      public_url: 'https://cdn.example/input.mp4',
      upload_url: 'https://storage.example/upload',
      upload_headers: { 'Content-Type': 'video/mp4', 'x-amz-tagging': 'retention=temporary' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/requests/')) {
    return new Response(JSON.stringify({ request_id: uuid, status: 'completed', video: { url: 'https://cdn.example/result.mp4' } }), { status: 200 });
  }
  return new Response(JSON.stringify({ request_id: uuid, status: 'queued' }), { status: 200 });
};

const target = await createUploadTarget('key-id:key-secret', 'video/mp4');
assert.strictEqual(target.uploadUrl, 'https://storage.example/upload');
const submitted = await submitGeneration('key-id:key-secret', {
  prompt: 'Test', resolution: '480p', videoUrl: 'https://cdn.example/input.mp4',
  imageUrls: ['https://cdn.example/input.png'], idempotencyKey: uuid,
});
assert.strictEqual(submitted.requestId, uuid);
assert.strictEqual(calls[1].options.headers.Authorization, 'Key key-id:key-secret');
assert.strictEqual(calls[1].options.headers['Idempotency-Key'], uuid);
const status = await getGenerationStatus('key-id:key-secret', uuid);
assert.strictEqual(status.videoUrl, 'https://cdn.example/result.mp4');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

process.env.DASHBOARD_PASSWORD = 'dashboard-secret';
const unauthorized = responseRecorder();
await videoGeneratorHandler({ method: 'POST', headers: {}, body: { action: 'authorize' } }, unauthorized);
assert.strictEqual(unauthorized.statusCode, 401);
const authorized = responseRecorder();
await videoGeneratorHandler({
  method: 'POST', headers: { 'x-dashboard-password': 'dashboard-secret' }, body: { action: 'authorize' },
}, authorized);
assert.strictEqual(authorized.statusCode, 200);
assert.deepStrictEqual(authorized.body, { ok: true });

console.log('OK - Higgsfield contract assertions passed');
