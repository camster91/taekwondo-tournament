import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const workerSource = () => readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

async function runNavigation(fetchResult: Response | Error, cached?: Response): Promise<Response> {
  let fetchHandler: ((event: { request: Request; respondWith(value: Promise<Response>): void }) => void) | undefined;
  let responsePromise: Promise<Response> | undefined;
  const self = {
    location: { origin: 'https://bowin.test', href: 'https://bowin.test/sw.js?v=test-build' },
    addEventListener(type: string, handler: typeof fetchHandler) {
      if (type === 'fetch') fetchHandler = handler;
    },
  };
  const caches = {
    open: async () => ({ match: async () => cached?.clone() }),
    keys: async () => [],
    delete: async () => true,
  };
  const fetch = async () => {
    if (fetchResult instanceof Error) throw fetchResult;
    return fetchResult;
  };
  runInNewContext(workerSource(), { self, caches, fetch, URL, Response, Set, Promise, Error });
  fetchHandler?.({
    request: { method: 'GET', url: 'https://bowin.test/checkin/example', mode: 'navigate', destination: 'document' } as Request,
    respondWith(value) { responsePromise = value; },
  });
  if (!responsePromise) throw new Error('Service worker did not handle navigation');
  return responsePromise;
}

describe('offline application shell contract', () => {
  it('registers a service worker from the client entrypoint', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
    expect(main).toContain('registerOfflineShell(`/sw.js?v=${encodeURIComponent(buildAsset)}`)');
  });

  it('caches navigation and static assets without caching private API responses', () => {
    const worker = workerSource();
    const navigationBlock = worker.slice(
      worker.indexOf("if (request.mode === 'navigate')"),
      worker.indexOf("if (!['script'"),
    );
    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).toContain("request.mode === 'navigate'");
    expect(navigationBlock).not.toContain('cache.put(request');
    expect(worker).toContain("content-type')?.includes('text/html')");
    expect(worker).toContain('html.includes(SHELL_MARKER)');
    expect(worker).toContain('match(SHELL_URL)');
    expect(worker).toContain('response.status >= 500 ? offlineShellResponse() : response');
    expect(worker).toContain("fetch(MANIFEST_URL, { cache: 'reload'");
    expect(worker).toContain("path.startsWith('assets/')");
    expect(worker).toContain('const staticCache = await caches.open(STATIC_CACHE)');
    expect(worker).toContain("staticCache.addAll([...shellAssets, '/site.webmanifest'])");
    expect(worker).toContain("key.startsWith('bowin-')");
    expect(worker).toContain("status: 503");
  });

  it('uses the cached shell for rejected requests and HTTP 503 responses', async () => {
    const cached = new Response('<!doctype html><meta name="bowin-app-shell" content="1">');
    expect(await (await runNavigation(new TypeError('offline'), cached)).text()).toContain('bowin-app-shell');
    expect(await (await runNavigation(new Response('upstream unavailable', { status: 503 }), cached)).text()).toContain('bowin-app-shell');
  });

  it('returns an explicit 503 without a cached shell and preserves normal navigation', async () => {
    const unavailable = await runNavigation(new Response('upstream unavailable', { status: 503 }));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).toContain('application shell is unavailable');

    const normal = await runNavigation(new Response('normal page', { status: 200 }));
    expect(normal.status).toBe(200);
    expect(await normal.text()).toBe('normal page');
  });

  it('serves a precached static asset without using the network', async () => {
    let fetchHandler: ((event: { request: Request; respondWith(value: Promise<Response>): void }) => void) | undefined;
    let responsePromise: Promise<Response> | undefined;
    const cachedAsset = new Response('cached application javascript');
    const self = {
      location: { origin: 'https://bowin.test', href: 'https://bowin.test/sw.js?v=test-build' },
      addEventListener(type: string, handler: typeof fetchHandler) { if (type === 'fetch') fetchHandler = handler; },
    };
    const caches = {
      open: async (name: string) => ({ match: async () => name.startsWith('bowin-static-') ? cachedAsset.clone() : undefined }),
      keys: async () => [],
      delete: async () => true,
    };
    const fetch = async () => { throw new TypeError('offline'); };
    runInNewContext(workerSource(), { self, caches, fetch, URL, Response, Set, Promise, Error });
    fetchHandler?.({
      request: { method: 'GET', url: 'https://bowin.test/assets/app.js', mode: 'cors', destination: 'script' } as Request,
      respondWith(value) { responsePromise = value; },
    });
    if (!responsePromise) throw new Error('Service worker did not handle static asset');
    expect(await (await responsePromise).text()).toBe('cached application javascript');
  });
});
