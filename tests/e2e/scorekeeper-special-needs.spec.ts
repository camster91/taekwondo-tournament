import { expect, test } from '@playwright/test';
import { buildProposedBracketCorrection, loadBracketCorrectionSnapshot } from '../../src/server/services/bracket-correction';
import { loginAsEmail, loginRequestAsEmail, skipOnboardingTour, withE2EPrisma } from './helpers';

// A scorekeeper sees a "Note" badge next to a competitor in the match they
// are scoring and can open the special-needs note. Viewers get 403 from the
// per-match endpoint, and match lists no longer carry notes. The tournament
// is org-less (legacy pool) so the org-less scorekeeper can open it.

test.describe.configure({ mode: 'serial' });

test('scorekeeper opens the special-needs note for the match being scored', async ({ page, request }) => {
  const stamp = `${Date.now()}-${test.info().project.name}`;
  const scorekeeperEmail = `e2e-sk-note-${stamp}@example.com`;
  const viewerEmail = `e2e-sk-note-viewer-${stamp}@example.com`;
  const divisionName = `E2E Note Division ${stamp}`;
  const note = `E2E uses a hearing aid, tap shoulder to start ${stamp}`;
  const lastName = `SkNote${stamp}`;

  const { tournamentId, matchId } = await withE2EPrisma(async (prisma) => {
    await prisma.user.create({ data: { email: scorekeeperEmail, firstName: 'E2E', lastName: 'NoteKeeper', role: 'scorekeeper' } });
    await prisma.user.create({ data: { email: viewerEmail, firstName: 'E2E', lastName: 'NoteViewer', role: 'viewer' } });
    const tournament = await prisma.tournament.create({
      data: { name: `E2E Scorekeeper Note ${stamp}`, date: new Date(Date.now() + 24 * 60 * 60 * 1000), status: 'in_progress' },
    });
    const withNote = await prisma.competitor.create({
      data: { firstName: 'E2E Noa', lastName, gender: 'F', dateOfBirth: new Date('2013-03-01'), belt: 'Blue', specialNeeds: note },
    });
    const plain = await prisma.competitor.create({
      data: { firstName: 'E2E Pat', lastName, gender: 'F', dateOfBirth: new Date('2013-06-01'), belt: 'Blue' },
    });
    const r1 = await prisma.registration.create({ data: { tournamentId: tournament.id, competitorId: withNote.id, sparring: true, specialNeeds: note } });
    const r2 = await prisma.registration.create({ data: { tournamentId: tournament.id, competitorId: plain.id, sparring: true } });
    const division = await prisma.division.create({
      data: {
        tournamentId: tournament.id,
        name: divisionName,
        beltLevel: 'CB',
        gender: 'F',
        eventType: 'sparring',
        ageMin: 10,
        ageMax: 14,
        assignments: { create: [{ registrationId: r1.id, seedPosition: 1 }, { registrationId: r2.id, seedPosition: 2 }] },
      },
    });
    const snapshot = await loadBracketCorrectionSnapshot(prisma, division.id);
    const proposed = buildProposedBracketCorrection(snapshot, { format: 'single_elim', seedingStrategy: 'school_spread' });
    const bracket = await prisma.bracket.create({ data: { divisionId: division.id, structure: JSON.stringify(proposed.structure), format: 'single_elim' } });
    await prisma.match.createMany({ data: proposed.matches.map((match) => ({ ...match, bracketId: bracket.id })) });
    await prisma.match.updateMany({ where: { bracketId: bracket.id, competitor1Id: { not: null }, competitor2Id: { not: null } }, data: { status: 'ready' } });
    const match = await prisma.match.findFirstOrThrow({ where: { bracketId: bracket.id, status: 'ready' } });
    return { tournamentId: tournament.id, matchId: match.id };
  });

  try {
    // Viewers can't read notes, and the match list doesn't carry them.
    const viewerHeaders = await loginRequestAsEmail(request, viewerEmail);
    const denied = await request.get(`/api/brackets/match/${matchId}/special-needs`, { headers: viewerHeaders });
    expect(denied.status()).toBe(403);
    const list = await request.get(`/api/divisions/tournament/${tournamentId}?withMatches=true`, { headers: viewerHeaders });
    expect(list.ok()).toBe(true);
    expect(await list.text()).not.toContain(note);

    await skipOnboardingTour(page);
    await loginAsEmail(page, scorekeeperEmail);
    await page.goto(`/scorekeeper/${tournamentId}`);
    await page.getByRole('button', { name: new RegExp(`^${divisionName}, .*1 ready`) }).click();

    // Only the competitor with a note gets the badge; the note opens inline.
    const badge = page.getByRole('button', { name: `Note for E2E Noa ${lastName}` });
    await expect(badge).toBeVisible();
    await expect(page.getByRole('button', { name: `Note for E2E Pat ${lastName}` })).toHaveCount(0);
    await expect(page.getByText(note)).toBeHidden();
    const box = await badge.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await badge.focus();
    await page.keyboard.press('Enter');
    await expect(badge).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(note)).toBeVisible();
  } finally {
    await withE2EPrisma(async (prisma) => {
      await prisma.match.deleteMany({ where: { bracket: { division: { tournamentId } } } });
      await prisma.bracket.deleteMany({ where: { division: { tournamentId } } });
      await prisma.tournament.deleteMany({ where: { id: tournamentId } });
      await prisma.competitor.deleteMany({ where: { lastName } });
      await prisma.magicLink.deleteMany({ where: { email: { in: [scorekeeperEmail, viewerEmail] } } });
      await prisma.user.deleteMany({ where: { email: { in: [scorekeeperEmail, viewerEmail] } } });
    });
  }
});
