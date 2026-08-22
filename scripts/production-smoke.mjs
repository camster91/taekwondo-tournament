import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseURL = process.env.PRODUCTION_BASE_URL || 'https://tkd.ashbi.ca';
if (!baseURL.startsWith('https://')) {
  throw new Error('PRODUCTION_BASE_URL must be an https URL');
}

const outputDir = resolve('test-results', 'production-smoke');
await mkdir(outputDir, { recursive: true });

function fail(message) {
  throw new Error(message);
}

async function assertResponse(response, expectedStatus, label) {
  if (!response) {
    fail(`${label}: no response`);
  }
  if (response.status() !== expectedStatus) {
    const text = await response.text().catch(() => '');
    fail(`${label}: status ${response.status()} - ${text}`);
  }
  return response;
}

async function assertJson(response, label) {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`${label}: invalid JSON response (${error instanceof Error ? error.message : 'parse error'})`);
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
const request = context.request;
const page = await context.newPage();

const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await assertResponse(
    await request.get(`${baseURL}/`),
    200,
    'GET /'
  );

  await assertResponse(await request.get('/login'), 200, 'GET /login');
  await assertResponse(await request.get('/dashboard'), 200, 'GET /dashboard');
  await assertResponse(await request.get('/support/tickets'), 200, 'GET /support/tickets');

  const health = await assertJson(await assertResponse(
    await request.get('/api/health'),
    200,
    'GET /api/health'
  ), 'GET /api/health');
  if (health.status !== 'ok') fail(`GET /api/health: unexpected payload ${JSON.stringify(health)}`);

  const ready = await assertJson(await assertResponse(
    await request.get('/api/health/ready'),
    200,
    'GET /api/health/ready'
  ), 'GET /api/health/ready');
  if (ready.status !== 'ok') fail(`GET /api/health/ready: unexpected payload ${JSON.stringify(ready)}`);

  const supportUnauth = await assertResponse(await request.get('/api/support'), 401, 'GET /api/support unauthorized');
  const supportUnauthBody = await supportUnauth.text();
  if (!supportUnauthBody.includes('Authentication required') && !supportUnauthBody.includes('error')) {
    fail(`GET /api/support unauthorized: expected auth error, got ${supportUnauthBody}`);
  }

  const supportPayload = {
    message: 'I can see registration status is stale on the dashboard.',
    page: '/register',
    createTicket: true,
    contactName: 'QA User',
    contactEmail: 'qa@local.test',
    priority: 'normal',
  };

  const supportApi = await assertJson(await assertResponse(
    await request.post('/api/support', {
      data: supportPayload,
      headers: { 'Content-Type': 'application/json' },
    }),
    200,
    'POST /api/support'
  ), 'POST /api/support');
  if (!supportApi.answer || typeof supportApi.answer !== 'string') {
    fail(`POST /api/support: invalid response payload ${JSON.stringify(supportApi)}`);
  }
  if (!supportApi.ticket?.id) {
    fail(`POST /api/support createTicket=false but no ticket returned: ${JSON.stringify(supportApi)}`);
  }

  const supportChatAlias = await assertJson(await assertResponse(
    await request.post('/api/support/chat', {
      data: supportPayload,
      headers: { 'Content-Type': 'application/json' },
    }),
    200,
    'POST /api/support/chat'
  ), 'POST /api/support/chat');
  if (!supportChatAlias.answer || typeof supportChatAlias.answer !== 'string') {
    fail(`POST /api/support/chat: invalid response payload ${JSON.stringify(supportChatAlias)}`);
  }

  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: `${outputDir}/homepage.png`, fullPage: true });
  if (pageErrors.length) {
    fail(`Browser errors: ${pageErrors.join(' | ')}`);
  }

  console.log('QA PASS: production smoke checks completed');
} finally {
  await context.close();
  await browser.close();
}
