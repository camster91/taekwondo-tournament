import type { APIRequestContext, Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { resetDemoShowcase } from '../../prisma/demo-seed.js';

/**
 * Run `fn` with a short-lived Prisma client against the e2e database.
 * Specs use it to own their preconditions: every Playwright project
 * (chromium, firefox, webkit, mobile-chrome) runs against the SAME seeded
 * database, so a spec must not assume an earlier project left it untouched.
 */
export async function withE2EPrisma<T>(fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Put Minho Kim (a seeded black-belt sparring athlete in "Spring Championship
 * 2026") back to not-checked-in. checkin.spec and the keyboard check-in journey
 * check him in, so any spec that needs a visible "Check In" button on the
 * seeded tournament resets him first instead of relying on run order.
 */
export async function resetSeededCheckIn() {
  await withE2EPrisma((prisma) => prisma.registration.updateMany({
    where: { tournament: { name: 'Spring Championship 2026' }, competitor: { firstName: 'Minho', lastName: 'Kim' } },
    data: { checkedIn: false, checkInTime: null, checkInWeight: null },
  }));
}

/**
 * The server caps magic-link issuance at 5 links per email per 15 minutes
 * (MAX_LINKS_PER_EMAIL_WINDOW in routes/auth.ts) and keeps the rows even when
 * the user is deleted. Specs with a fixed operator email sign in several times
 * per project, and every browser project reuses the email, so the next
 * project's sign-ins were silently answered with the generic "If an account
 * exists" response. Each sign-in owns its precondition: a fresh issuance
 * budget for that email. The cap itself stays enforced for everything else.
 */
export async function resetMagicLinkBudget(email: string) {
  await withE2EPrisma((prisma) => prisma.magicLink.deleteMany({ where: { email: email.toLowerCase() } }));
}

export async function loginRequestAsEmail(request: APIRequestContext, email: string) {
  await resetMagicLinkBudget(email);
  const requested = await request.post('/api/auth/request-magic-link', { data: { email } });
  if (!requested.ok()) throw new Error(`request-magic-link failed: ${requested.status()}`);
  const body = await requested.json() as { code?: string };
  if (!body.code) throw new Error('Expected an E2E verification code');
  const verified = await request.post('/api/auth/verify-magic-link', { data: { email, code: body.code } });
  if (!verified.ok()) throw new Error(`verify-magic-link failed: ${verified.status()}`);
  const { token } = await verified.json() as { token: string };
  const state = await request.storageState();
  const csrf = state.cookies.find((cookie) => cookie.name === 'bowin_csrf')?.value;
  if (!csrf) throw new Error('Expected a CSRF cookie after verification');
  return { Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrf };
}

/**
 * Helper: log in via the real magic-link OTP flow in dev mode.
 *
 * The dev server returns `{ devMode: true, magicUrl, code }` from
 * POST /api/auth/request-magic-link when MAILGUN_API_KEY isn't set (which
 * is the case for `npm run dev` in a clean checkout). We intercept the
 * network response to read the code — this is more robust than scraping
 * the DOM, and it tests the same UX path a human goes through.
 */
export async function loginAsEmail(page: Page, email: string) {
  await resetMagicLinkBudget(email);
  // Set up the response listener BEFORE the click that triggers the request.
  const magicLinkResponse = page.waitForResponse(
    (resp) =>
      resp.url().endsWith('/api/auth/request-magic-link') &&
      resp.request().method() === 'POST'
  );

  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: /Send sign-in link/i }).click();

  const response = await magicLinkResponse;
  if (!response.ok()) {
    throw new Error(`request-magic-link failed: ${response.status()} ${await response.text()}`);
  }
  const body = await response.json();
  if (!body.devMode || !body.code) {
    throw new Error(`Expected devMode + code in response, got: ${JSON.stringify(body)}`);
  }
  const code: string = body.code;

  // Wait for the dev-mode code UI to be visible (proves the React state updated).
  await expectDevModeCodeVisible(page, code);

  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: /Verify code/i }).click();

  // Login redirects to "/" on success.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 10_000 });
}

/**
 * Skip the first-run onboarding tour. The tour renders a full-viewport
 * overlay (z-index 100, pointer-events-auto) that intercepts clicks on
 * "New Tournament" / check-in controls. Persist the same localStorage
 * flag the real UI writes on dismiss so the tour never mounts.
 */
export async function skipOnboardingTour(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('bowin_tour_completed', '1');
    } catch {
      /* ignore quota / private-mode failures */
    }
  });
}

/**
 * Helper: log in via the one-click "Explore the live demo" button. Faster than the
 * OTP flow, used for tests that need an authenticated session but aren't
 * specifically about the login UX (e.g. tournament create, check-in).
 */
export async function loginAsDemo(page: Page) {
  await skipOnboardingTour(page);
  await page.goto('/login');
  // Wait for setup-status so the auth card doesn't remount (setup vs
  // email form swap) mid-click — that detaches the button and makes
  // Playwright retry until the 180s test timeout.
  await page.waitForResponse(
    (resp) => resp.url().includes('/api/auth/setup-status') && resp.ok(),
    { timeout: 15_000 },
  ).catch(() => undefined);
  const demoBtn = page.getByRole('button', { name: /Explore the live demo/i });
  await demoBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 }),
    demoBtn.click(),
  ]);
}

async function expectDevModeCodeVisible(page: Page, code: string) {
  // The dev-mode callout has the heading "Dev Mode — Email Not Configured".
  // Inside the callout, the code is rendered in a 6-char mono block. We
  // locate it by anchoring on the callout's heading first to scope the search.
  const callout = page.locator('div', { hasText: /Dev Mode.*Email Not Configured/i }).first();
  await callout.waitFor({ state: 'visible', timeout: 10_000 });

  // The code element uses class "font-mono" + "tracking-[0.3em]". Use a
  // data attribute or just find a 6-digit text inside the callout.
  const codeLocator = callout.locator(`text=/^\\s*${code}\\s*$/`);
  await codeLocator.waitFor({ state: 'visible', timeout: 5_000 });
}

/**
 * Reinstall the fabricated demo showcase (the same marker-protected reset
 * global-setup and staging use). Specs that consume showcase state — checking
 * athletes in, recording ready matches — call it first so they see a fresh
 * showcase in every project rather than whatever the previous project left.
 */
export async function resetShowcase() {
  await withE2EPrisma(async (prisma) => { await resetDemoShowcase(prisma); });
}

/**
 * Snapshot every match (and its audit trail) in a seeded tournament and return
 * a function that puts them back. Scoring specs record real results — several
 * deliberately let the PUT commit and then drop the response — so without a
 * restore each project consumes ready matches the next project needs.
 */
export async function snapshotTournamentMatches(tournamentName: string): Promise<() => Promise<void>> {
  const where = { bracket: { division: { tournament: { name: tournamentName } } } };
  const { matches, auditIds } = await withE2EPrisma(async (prisma) => {
    const rows = await prisma.match.findMany({ where });
    const audits = await prisma.matchAuditLog.findMany({ where: { matchId: { in: rows.map((m) => m.id) } }, select: { id: true } });
    return { matches: rows, auditIds: audits.map((a) => a.id) };
  });
  return () => withE2EPrisma(async (prisma) => {
    await prisma.$transaction([
      ...matches.map((m) => prisma.match.update({
        where: { id: m.id },
        data: {
          competitor1Id: m.competitor1Id,
          competitor2Id: m.competitor2Id,
          winnerId: m.winnerId,
          score1: m.score1,
          score2: m.score2,
          status: m.status,
          scheduledTime: m.scheduledTime,
          ringNumber: m.ringNumber,
          notes: m.notes,
          videoUrl: m.videoUrl,
        },
      })),
      prisma.matchAuditLog.deleteMany({ where: { matchId: { in: matches.map((m) => m.id) }, id: { notIn: auditIds } } }),
    ]);
  });
}
