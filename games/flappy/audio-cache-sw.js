const AUDIO_CACHE_NAME = 'flappy-audio-v1';
const AUDIO_PATH = /\/games\/flappy\/music\/[^/]+\.mp3$/i;

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !AUDIO_PATH.test(url.pathname)
  ) {
    return;
  }

  event.respondWith(getAudioResponse(request, event));
});

async function getAudioResponse(request, event) {
  const cache = await caches.open(AUDIO_CACHE_NAME);
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return createRangeResponse(request, cached);

  // Fetch one complete stream even when the media element initially asks for
  // a byte range. The response can play immediately while its clone is cached.
  const headers = new Headers(request.headers);
  headers.delete('range');
  const networkResponse = await fetch(new Request(request, { headers }));
  if (networkResponse.ok && networkResponse.status === 200) {
    event.waitUntil(cache.put(cacheKey, networkResponse.clone()).catch(error => {
      console.warn('Failed to persist Flappy audio:', error);
    }));
  }
  return networkResponse;
}

async function createRangeResponse(request, response) {
  const range = request.headers.get('range');
  if (!range) return response;

  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match) return response;

  const blob = await response.clone().blob();
  const size = blob.size;
  let start;
  let end;

  if (match[1] === '') {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return response;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` }
    });
  }

  const contentType = response.headers.get('content-type') || 'audio/mpeg';
  const chunk = blob.slice(start, end + 1, contentType);
  return new Response(chunk, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Length': String(chunk.size),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Type': contentType
    }
  });
}
