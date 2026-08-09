const BUILD_VERSION = new URL(self.location.href).searchParams.get('v') || 'unversioned';
const CACHE_VERSION = BUILD_VERSION.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-96);
const SHELL_CACHE = `bowin-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `bowin-static-${CACHE_VERSION}`;
const SHELL_URL = '/index.html';
const MANIFEST_URL = '/.vite/manifest.json';
const SHELL_MARKER = '<meta name="bowin-app-shell" content="1"';

async function offlineShellResponse() {
  const cached = await (await caches.open(SHELL_CACHE)).match(SHELL_URL);
  return cached || new Response('Bowin is offline and the application shell is unavailable.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      fetch(SHELL_URL, { cache: 'reload', credentials: 'same-origin' }),
      fetch(MANIFEST_URL, { cache: 'reload', credentials: 'same-origin' }),
    ])
      .then(async ([response, manifestResponse]) => {
        const html = response.ok && response.headers.get('content-type')?.includes('text/html')
          ? await response.clone().text()
          : '';
        if (!html.includes(SHELL_MARKER)) {
          throw new Error('Bowin offline shell was not a valid HTML document');
        }
        if (!manifestResponse.ok) throw new Error('Bowin build manifest was unavailable');
        const manifest = await manifestResponse.json();
        const shellAssets = [...new Set(Object.values(manifest).flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return [];
          return [entry.file, ...(entry.css || []), ...(entry.assets || [])]
            .filter((path) => typeof path === 'string' && path.startsWith('assets/'))
            .map((path) => `/${path}`);
        }))];
        if (shellAssets.length === 0) throw new Error('Bowin build manifest contained no shell assets');
        const shellCache = await caches.open(SHELL_CACHE);
        const staticCache = await caches.open(STATIC_CACHE);
        await shellCache.put(SHELL_URL, response);
        await staticCache.addAll([...shellAssets, '/site.webmanifest']);
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const current = new Set([SHELL_CACHE, STATIC_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('bowin-') && !current.has(key))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => response.status >= 500 ? offlineShellResponse() : response)
        .catch(() => offlineShellResponse()),
    );
    return;
  }

  if (!['script', 'style', 'font', 'image'].includes(request.destination)) return;
  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      // The immutable hashed URL is the cache identity. Ignore response Vary
      // metadata because install-time fetch headers differ from module/style
      // requests during an offline reload.
      const cached = await cache.match(request, { ignoreVary: true });
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }),
  );
});
