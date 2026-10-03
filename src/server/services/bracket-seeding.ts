// Seeding from the tournament rules (Tournament Settings → Rules →
// "Bracket Generation").
//
// The rules editor stores four bracket choices; this module is what makes
// them change a generated bracket:
//
//   seedingStrategy        who counts as the stronger competitor
//                          (skill rating / years of training / belt rank /
//                          random draw). A director-set seed always wins.
//   byePlacement           who gets the byes when the count is not a power
//                          of two: the top seeds, a random draw, or the
//                          matches at the top of the sheet.
//   round1Pairing          who meets whom in round 1 (1 v 8 standard,
//                          1 v 5 top half v bottom half, 1 v 2 adjacent).
//   avoidSameSchoolRound1  swap people between first-round matches so
//                          team-mates do not fight first, when possible.
//
// Everything is deterministic: ties and "random" draws use a hash of a
// draw key (the division id) and the registration id, so the same
// division generates the same bracket every time (bracket corrections
// require that) while the order still is not alphabetical.
//
// The output is a first-round layout handed to
// `generateEliminationFromSlots`, so the bracket structure and its
// `positions` map are exactly the ones the size would get anyway.

import type { PrismaClient, Prisma } from '@prisma/client';
import {
  generateBracket,
  generateEliminationFromSlots,
  generateSingleElimination,
  nextPowerOf2,
  standardSeedOrder,
  type BracketStructure,
  type CompetitorSeed,
  type SeedingStrategy,
} from './bracket-generator.js';
import { COLORED_BELTS } from '../../shared/constants/belts.js';
import {
  DEFAULT_BRACKET_RULES,
  parseTournamentRules,
  type BracketRules,
} from '../../shared/constants/tournament-rules.js';
import { normalizeSchool } from '../../shared/utils/same-school.js';

// ─── Rules ─────────────────────────────────────────────────────────────

const SEED_BY = ['rating', 'experience', 'belt', 'random'] as const;
const BYE_PLACEMENT = ['top', 'random', 'rating'] as const;
const PAIRING = ['adjacent', 'balanced', 'split'] as const;

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

/** Stored bracket rules with unknown or missing values replaced by defaults. */
export function resolveBracketRules(rules: Partial<BracketRules> | null | undefined): BracketRules {
  const r = rules ?? {};
  return {
    ...DEFAULT_BRACKET_RULES,
    ...r,
    applySeedingRules: r.applySeedingRules === true,
    avoidSameSchoolRound1: typeof r.avoidSameSchoolRound1 === 'boolean'
      ? r.avoidSameSchoolRound1
      : DEFAULT_BRACKET_RULES.avoidSameSchoolRound1,
    seedingStrategy: pick(r.seedingStrategy, SEED_BY, DEFAULT_BRACKET_RULES.seedingStrategy),
    byePlacement: pick(r.byePlacement, BYE_PLACEMENT, DEFAULT_BRACKET_RULES.byePlacement),
    round1Pairing: pick(r.round1Pairing, PAIRING, DEFAULT_BRACKET_RULES.round1Pairing),
  };
}

// ─── Deterministic draw ────────────────────────────────────────────────

/** A stable number in [0, 1) for a piece of text (FNV-1a + a mixer). */
export function drawNumber(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ─── Belt rank ─────────────────────────────────────────────────────────

/**
 * Belt seniority as a number (higher = more senior). Colour belts follow
 * the stripe-level order in `COLORED_BELTS`; black belts rank above every
 * colour belt and by dan. Unknown belts rank lowest.
 */
export function beltRankScore(belt: string | null | undefined, beltStripe?: string | null, danRank?: number | null): number {
  const name = (belt ?? '').trim();
  if (!name) return -1;
  if (name.toLowerCase() === 'black') return 100 + Math.max(0, danRank ?? 0);
  const lower = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');
  const candidates = beltStripe ? [`${name} / ${beltStripe.trim()}`, name] : [name];
  for (const candidate of candidates) {
    const index = COLORED_BELTS.findIndex((b) => lower(b) === lower(candidate));
    if (index >= 0) return index;
  }
  // "Green (advanced)" and similar: match the colour word at the start.
  const base = COLORED_BELTS.findIndex((b) => !b.includes('/') && lower(name).startsWith(lower(b)));
  return base >= 0 ? base : -1;
}

// ─── Ranking ───────────────────────────────────────────────────────────

/**
 * Order competitors strongest first. A director-set seed (`manualSeed`)
 * comes before everything; then the chosen measure, belt rank as the
 * fallback, then the deterministic draw.
 */
export function rankCompetitors(
  competitors: CompetitorSeed[],
  seedBy: BracketRules['seedingStrategy'],
  drawKey: string,
): CompetitorSeed[] {
  const measure = (c: CompetitorSeed): number => {
    if (seedBy === 'rating') return c.skillRating ?? Number.NEGATIVE_INFINITY;
    if (seedBy === 'experience') return c.experienceScore ?? Number.NEGATIVE_INFINITY;
    return Number.NEGATIVE_INFINITY;
  };
  const useBelt = seedBy !== 'random';
  const keyed = competitors.map((c) => ({
    c,
    manual: typeof c.manualSeed === 'number' && c.manualSeed > 0 ? c.manualSeed : Number.POSITIVE_INFINITY,
    measure: measure(c),
    belt: useBelt ? c.beltRank ?? -1 : 0,
    draw: drawNumber(`${drawKey}:${c.registrationId}`),
  }));
  keyed.sort((a, b) =>
    a.manual - b.manual
    || (a.measure === b.measure ? 0 : b.measure - a.measure)
    || b.belt - a.belt
    || a.draw - b.draw
    || a.c.registrationId.localeCompare(b.c.registrationId)
  );
  return keyed.map((k) => k.c);
}

// ─── First-round plan ──────────────────────────────────────────────────

type Unit = [CompetitorSeed, CompetitorSeed | null];

export interface FirstRoundPlan {
  /** Bracket-sheet order; round-1 match k is slots[2k] v slots[2k+1]. */
  slots: (CompetitorSeed | null)[];
  /** Competitors in rank order (index 0 = top seed). */
  ranked: CompetitorSeed[];
  /** Same-school first-round fights left in the plan. */
  sameSchoolFights: number;
}

const schoolKey = (c: CompetitorSeed | null) => (c ? normalizeSchool(c.school) : '');
const isSameSchool = (unit: Unit) => {
  const a = schoolKey(unit[0]);
  return a !== '' && unit[1] !== null && a === schoolKey(unit[1]);
};

/**
 * Remove same-school first-round pairs by swapping one competitor with a
 * competitor of another match. Each swap strictly lowers the number of
 * same-school pairs, and a same-school pair is only kept when every other
 * match already holds someone from that school, so the result has the
 * fewest same-school pairs possible for these matches. Among the possible
 * swaps the one closest in rank is used, keeping the seeding intact as
 * far as possible. Byes are left alone (`fixed` units).
 */
function separateSchools(units: Unit[], fixed: number, rankOf: Map<string, number>): void {
  const rank = (c: CompetitorSeed) => rankOf.get(c.registrationId) ?? 0;
  const stuck = new Set<number>();
  for (let guard = 0; guard < (units.length + 1) ** 2; guard++) {
    const u = units.findIndex((unit, i) => i >= fixed && !stuck.has(i) && isSameSchool(unit));
    if (u < 0) return;
    const school = schoolKey(units[u][0]);
    const mover = units[u][1]!; // the lower-ranked of the pair moves
    let best: { v: number; p: 0 | 1; distance: number; rank: number } | null = null;
    for (let v = fixed; v < units.length; v++) {
      if (v === u) continue;
      const [x, y] = units[v];
      if (!y || schoolKey(x) === school || schoolKey(y) === school) continue;
      for (const p of [0, 1] as const) {
        const candidate = units[v][p]!;
        const distance = Math.abs(rank(candidate) - rank(mover));
        if (!best || distance < best.distance || (distance === best.distance && rank(candidate) < best.rank)) {
          best = { v, p, distance, rank: rank(candidate) };
        }
      }
    }
    if (!best) {
      // Every other match already has someone from this school.
      stuck.add(u);
      continue;
    }
    const candidate = units[best.v][best.p]!;
    units[best.v][best.p] = mover;
    units[u][1] = candidate;
    // Keep the stronger competitor first in each match.
    for (const i of [u, best.v]) {
      const [a, b] = units[i];
      if (b && rank(b) < rank(a)) units[i] = [b, a];
    }
    stuck.clear();
  }
}

/**
 * Lay out round 1 from the bracket rules. Needs at least 2 competitors
 * (smaller divisions have no first round).
 */
export function planFirstRound(
  competitors: CompetitorSeed[],
  rulesInput: Partial<BracketRules> | null | undefined,
  drawKey: string,
): FirstRoundPlan {
  const rules = resolveBracketRules(rulesInput);
  const count = competitors.length;
  if (count < 2) throw new RangeError('A first round needs at least 2 competitors');
  if (count > 64) throw new RangeError('Elimination brackets support at most 64 competitors');
  const size = nextPowerOf2(count);
  const byes = size - count;
  const matchCount = size / 2;

  const ranked = rankCompetitors(competitors, rules.seedingStrategy, drawKey);
  const rankOf = new Map(ranked.map((c, i) => [c.registrationId, i]));

  // Who gets the byes.
  let byeTakers: CompetitorSeed[];
  if (byes === 0) byeTakers = [];
  else if (rules.byePlacement === 'random') {
    byeTakers = [...ranked]
      .sort((a, b) => drawNumber(`${drawKey}:bye:${a.registrationId}`) - drawNumber(`${drawKey}:bye:${b.registrationId}`))
      .slice(0, byes)
      .sort((a, b) => rankOf.get(a.registrationId)! - rankOf.get(b.registrationId)!);
  } else {
    byeTakers = ranked.slice(0, byes);
  }
  const byeIds = new Set(byeTakers.map((c) => c.registrationId));
  const rest = ranked.filter((c) => !byeIds.has(c.registrationId));

  // Who meets whom (strongest match first).
  const contested: Unit[] = [];
  const half = rest.length / 2;
  for (let i = 0; i < half; i++) {
    if (rules.round1Pairing === 'adjacent') contested.push([rest[2 * i], rest[2 * i + 1]]);
    else if (rules.round1Pairing === 'balanced') contested.push([rest[i], rest[i + half]]);
    else contested.push([rest[i], rest[rest.length - 1 - i]]);
  }
  const units: Unit[] = [...byeTakers.map((c): Unit => [c, null]), ...contested];
  if (rules.avoidSameSchoolRound1) separateSchools(units, byeTakers.length, rankOf);

  // Where each match goes on the sheet. Match `matchOfSeed[j]` is the one
  // standard seeding gives seed j, so the strongest matches are spread
  // over the halves/quarters (seeds 1 and 2 can only meet in the final).
  const order = standardSeedOrder(size);
  const matchOfSeed: number[] = new Array(matchCount);
  for (let m = 0; m < matchCount; m++) {
    const top = Math.min(order[2 * m], order[2 * m + 1]);
    matchOfSeed[top] = m;
  }
  const placement: number[] = rules.byePlacement === 'top' && byes > 0
    ? [
      // Byes fill the first matches on the sheet; the contested matches
      // keep the spread order in the rest.
      ...Array.from({ length: byes }, (_, i) => i),
      ...matchOfSeed.filter((m) => m >= byes),
    ]
    : matchOfSeed;

  const slots: (CompetitorSeed | null)[] = new Array(size).fill(null);
  units.forEach((unit, i) => {
    const m = placement[i];
    slots[2 * m] = unit[0];
    slots[2 * m + 1] = unit[1];
  });

  return { slots, ranked, sameSchoolFights: units.filter(isSameSchool).length };
}

/**
 * Generate an elimination bracket seeded from the tournament's bracket
 * rules. Divisions of 0 or 1 competitors keep the generators' own
 * structures.
 */
export function generateEliminationFromRules(
  competitors: CompetitorSeed[],
  format: 'double_elim' | 'single_elim',
  rulesInput: Partial<BracketRules> | null | undefined,
  drawKey: string,
): BracketStructure {
  if (competitors.length < 2) {
    return trivialBracket(competitors);
  }
  const plan = planFirstRound(competitors, rulesInput, drawKey);
  const structure = generateEliminationFromSlots(plan.slots, format);
  const fights = plan.slots.length / 2 - (plan.slots.length - competitors.length);
  structure.seedingInfo = {
    strategy: 'tournament_rules',
    skillBalance: skillBalance(plan.slots),
    schoolDiversity: fights > 0 ? Math.round((1 - plan.sameSchoolFights / fights) * 100) : 100,
    sameSchoolFirstRound: plan.sameSchoolFights,
  };
  return structure;
}

function trivialBracket(competitors: CompetitorSeed[]): BracketStructure {
  if (competitors.length === 0) {
    return {
      winners: [], losers: [], finals: [], competitorCount: 0,
      positions: { winnersFinal: null, losersFinal: null, grandFinals: null, reset: null },
    };
  }
  // One competitor wins by default (same shape for both formats).
  return {
    winners: [],
    losers: [],
    finals: [{ matchNumber: 1, round: 1, competitor1Id: competitors[0].registrationId, competitor2Id: null }],
    competitorCount: 1,
    positions: { winnersFinal: 1, losersFinal: null, grandFinals: 1, reset: null },
  };
}

function skillBalance(slots: (CompetitorSeed | null)[]): number {
  const halfway = slots.length / 2;
  const sum = (part: (CompetitorSeed | null)[]) => part.reduce((total, c) => total + (c?.skillRating ?? 0), 0);
  const left = sum(slots.slice(0, halfway));
  const right = sum(slots.slice(halfway));
  return left + right > 0 ? Math.round((1 - Math.abs(left - right) / (left + right)) * 100) : 100;
}

// ─── Loading the inputs ────────────────────────────────────────────────

type SeedingDb = PrismaClient | Prisma.TransactionClient;

/** Extra seeding facts per registration, merged into `CompetitorSeed`s. */
export type SeedFacts = Pick<CompetitorSeed, 'skillRating' | 'experienceScore' | 'beltRank' | 'manualSeed'>;

export interface RuleSeedingInput {
  rules: BracketRules;
  /** Draw key for ties and random draws (the division id). */
  drawKey: string;
  facts: Map<string, SeedFacts>;
}

/**
 * True only when the director switched on "Use these bracket rules when
 * brackets are made" (`settings.brackets.applySeedingRules === true`).
 * Everything else (no settings, saved rules with the switch off or
 * missing) keeps the long-standing school-spread seeding, unchanged.
 */
export function bracketRulesEnabled(settings: string | null | undefined): boolean {
  if (!settings) return false;
  try {
    const parsed: unknown = JSON.parse(settings);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const brackets = (parsed as { brackets?: unknown }).brackets;
    if (!brackets || typeof brackets !== 'object' || Array.isArray(brackets)) return false;
    return (brackets as { applySeedingRules?: unknown }).applySeedingRules === true;
  } catch {
    return false;
  }
}

/**
 * Load the tournament's bracket rules and each competitor's seeding facts
 * (skill rating for the division's event, years of training, belt rank,
 * director-set seed) for a division. Returns null when the division is
 * missing or the bracket-rules switch is off: then brackets are generated
 * exactly as before the rules were used.
 */
export async function loadRuleSeeding(db: SeedingDb, divisionId: string): Promise<RuleSeedingInput | null> {
  const division = await db.division.findUnique({
    where: { id: divisionId },
    select: {
      id: true,
      eventType: true,
      tournament: { select: { settings: true } },
      assignments: {
        select: {
          registrationId: true,
          registration: {
            select: {
              seeding: true,
              experienceScore: true,
              competitor: { select: { id: true, belt: true, beltStripe: true, danRank: true, yearsTraining: true } },
            },
          },
        },
      },
    },
  });
  if (!division || !bracketRulesEnabled(division.tournament.settings)) return null;
  const competitorIds = division.assignments.map((a) => a.registration.competitor.id);
  const ratings = competitorIds.length > 0
    ? await db.competitorRating.findMany({
      where: { competitorId: { in: competitorIds }, eventType: division.eventType },
      select: { competitorId: true, rating: true },
    })
    : [];
  const ratingOf = new Map(ratings.map((r) => [r.competitorId, r.rating]));
  const facts = new Map<string, SeedFacts>();
  for (const a of division.assignments) {
    const { competitor } = a.registration;
    facts.set(a.registrationId, {
      skillRating: ratingOf.get(competitor.id),
      experienceScore: competitor.yearsTraining ?? a.registration.experienceScore ?? undefined,
      beltRank: beltRankScore(competitor.belt, competitor.beltStripe, competitor.danRank),
      manualSeed: a.registration.seeding,
    });
  }
  return {
    rules: resolveBracketRules(parseTournamentRules(division.tournament.settings).brackets),
    drawKey: division.id,
    facts,
  };
}

/** Merge loaded seeding facts into the generator's competitor list. */
export function withSeedFacts(competitors: CompetitorSeed[], facts: Map<string, SeedFacts>): CompetitorSeed[] {
  return competitors.map((c) => ({ ...c, ...facts.get(c.registrationId) }));
}

/**
 * Elimination bracket for a generate / reseed request. With `seeding`
 * (saved bracket rules) and the app's default strategy, the rules decide;
 * otherwise the named strategy runs exactly as it always has.
 */
export function generateEliminationBracket(
  competitors: CompetitorSeed[],
  format: 'double_elim' | 'single_elim',
  seedingStrategy: SeedingStrategy,
  seeding: RuleSeedingInput | null | undefined,
): BracketStructure {
  if (seeding && usesTournamentRules(seedingStrategy)) {
    return generateEliminationFromRules(withSeedFacts(competitors, seeding.facts), format, seeding.rules, seeding.drawKey);
  }
  return format === 'single_elim'
    ? generateSingleElimination(competitors, seedingStrategy)
    : generateBracket(competitors, seedingStrategy);
}

/**
 * True when a generate request should follow the tournament rules: the
 * app always asks for 'school_spread' (or nothing). An API caller that
 * names another strategy ('manual', 'skill_based', ...) keeps it.
 */
export function usesTournamentRules(seedingStrategy: unknown): boolean {
  return seedingStrategy === undefined || seedingStrategy === null || seedingStrategy === 'school_spread';
}
