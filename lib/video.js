import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';

const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 4;

export function extractUrls(text = '') {
  return [...new Set(text.match(/https?:\/\/[^\s<>"')\]]+/gi) || [])]
    .map((url) => url.replace(/[.,;:!?]+$/, ''));
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return address === '::1' || address.startsWith('fc') || address.startsWith('fd')
    || address.startsWith('fe80:');
}

async function assertPublicUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('UNSAFE_URL');
  const addresses = await dns.lookup(parsed.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('UNSAFE_URL');
  }
}

async function safeFetch(url) {
  let currentUrl = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicUrl(currentUrl);
    const response = await fetch(currentUrl, { redirect: 'manual' });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      currentUrl = new URL(response.headers.get('location'), currentUrl).toString();
      continue;
    }
    return { response, finalUrl: currentUrl };
  }
  throw new Error('TOO_MANY_REDIRECTS');
}

async function readLimitedBody(response) {
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > MAX_VIDEO_BYTES) throw new Error('VIDEO_TOO_LARGE');
  if (!response.body) throw new Error('EMPTY_VIDEO');

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_VIDEO_BYTES) {
      await reader.cancel();
      throw new Error('VIDEO_TOO_LARGE');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
}

function videoFileName(finalUrl, contentType) {
  const rawName = decodeURIComponent(path.basename(new URL(finalUrl).pathname)) || 'video';
  const safeName = rawName.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120);
  if (/\.(mp4|mov|webm|m4v)$/i.test(safeName)) return safeName;
  const extension = contentType.includes('webm') ? '.webm' : contentType.includes('quicktime') ? '.mov' : '.mp4';
  return `${safeName || 'video'}${extension}`;
}

export async function prepareVideoAttachments(description) {
  const attachments = [];
  const failedUrls = [];

  for (const url of extractUrls(description)) {
    try {
      const { response, finalUrl } = await safeFetch(url);
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const looksLikeVideo = contentType.startsWith('video/')
        || /\.(mp4|mov|webm|m4v)(?:\?|$)/i.test(finalUrl);
      if (!looksLikeVideo) throw new Error('NOT_DIRECT_VIDEO');
      const buffer = await readLimitedBody(response);
      attachments.push({ buffer, contentType: contentType || 'video/mp4', fileName: videoFileName(finalUrl, contentType) });
    } catch {
      failedUrls.push(url);
    }
  }

  return { attachments, failedUrls };
}
