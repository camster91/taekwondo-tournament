import { Router } from 'express';
import type { Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { validateRequest } from '../middleware/validate.js';
import {
  authenticate,
  requireTournamentAccess,
  checkTournamentAccess,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import {
  loadTournamentRules,
  evaluateBracketRules,
  evaluateDivisionRules,
  getDefaultRules,
} from '../services/rule-engine.js';

const router = Router();

// Helper to safely get string param
const getParam = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0];
  return param || '';
};

// Helper to safely parse a `parameters` JSON string. Returns the fallback
// when the stored JSON is malformed (e.g. truncated row from a botched
// migration or a manual edit) so one bad record doesn't crash the whole
// request.
function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// Validation schemas
const createRuleSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  category: z.enum(['bracket', 'division', 'weight', 'seeding', 'custom']),
  ruleType: z.string().min(1).max(100),
  enforcement: z.enum(['hard', 'soft', 'info']).default('soft'),
  parameters: z.record(z.string(), z.unknown()),
  priority: z.number().int().min(0).max(100).default(50),
  isActive: z.boolean().default(true),
  source: z.string().max(50).default('manual'),
});

const updateRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  category: z.enum(['bracket', 'division', 'weight', 'seeding', 'custom']).optional(),
  ruleType: z.string().min(1).max(100).optional(),
  enforcement: z.enum(['hard', 'soft', 'info']).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
  source: z.string().max(50).optional(),
});

const parseRuleSchema = z.object({
  text: z.string().min(1).max(2000),
});

// ── Natural Language Rule Parser ───────────────────────────────────────

function parseNaturalLanguageRule(text: string, _tournamentId: string): {
  suggestedRule: object | null;
  confidence: number;
  explanation: string;
  needsHumanReview: boolean;
} {
  const lower = text.toLowerCase().trim();

  // Pattern: same-school avoidance
  if (/same.school|same.dojo|same.dojang|teammates/.test(lower)) {
    const scope = /first.two|first.2/.test(lower) ? 'first_two_rounds'
                : /all.round|never|any.round/.test(lower) ? 'all_rounds'
                : 'first_round';
    const enforcement = /must|never|require|mandatory/.test(lower) ? 'hard' : 'soft';
    return {
      suggestedRule: {
        name: 'Same-school avoidance',
        description: text,
        category: 'bracket',
        ruleType: 'same_school_avoidance',
        enforcement,
        parameters: { scope, minRoundsApart: scope === 'first_round' ? 1 : 2, exceptions: [] },
        priority: 80,
        source: 'llm_suggested',
      },
      confidence: 0.9,
      explanation: `Interpreted as: ${enforcement === 'hard' ? 'Hard' : 'Soft'} constraint to avoid same-school matches in ${scope.replace(/_/g, ' ')}`,
      needsHumanReview: enforcement === 'hard',
    };
  }

  // Pattern: weight limits
  if (/weight.diff|weight.limit|lbs?.apart|pounds?.apart|max.weight/.test(lower)) {
    const numberMatch = lower.match(/(\d+)\s*(lbs?|pounds?)/);
    const maxDiff = numberMatch ? parseInt(numberMatch[1]) : 20;
    const enforcement = /must|require|hard|strict/.test(lower) ? 'hard' : 'soft';
    return {
      suggestedRule: {
        name: `Weight tolerance: ${maxDiff} lbs`,
        description: text,
        category: 'bracket',
        ruleType: 'weight_tolerance',
        enforcement,
        parameters: { maxDifferenceLbs: maxDiff, checkInVerification: true, allowDivisionChange: false },
        priority: 90,
        source: 'llm_suggested',
      },
      confidence: numberMatch ? 0.95 : 0.7,
      explanation: `Interpreted as: Maximum ${maxDiff} lbs weight difference between opponents (${enforcement} enforcement)`,
      needsHumanReview: true,
    };
  }

  // Pattern: height limits
  if (/height.diff|height.limit|inches?.apart|max.height|tall/.test(lower)) {
    const numberMatch = lower.match(/(\d+)\s*inch/);
    const maxDiff = numberMatch ? parseInt(numberMatch[1]) : 6;
    return {
      suggestedRule: {
        name: `Height tolerance: ${maxDiff} inches`,
        description: text,
        category: 'bracket',
        ruleType: 'height_limit',
        enforcement: 'soft',
        parameters: { maxDifferenceInches: maxDiff, applyToSparringOnly: true },
        priority: 70,
        source: 'llm_suggested',
      },
      confidence: numberMatch ? 0.9 : 0.65,
      explanation: `Interpreted as: Maximum ${maxDiff} inch height difference for sparring`,
      needsHumanReview: true,
    };
  }

  // Pattern: novice/experience separation
  if (/novice|beginner|first.time|experience|veteran|separate.new/.test(lower)) {
    const noviceMatch = lower.match(/(\d+)\s*(tournament|event|competition)/);
    const threshold = noviceMatch ? parseInt(noviceMatch[1]) : 2;
    return {
      suggestedRule: {
        name: 'Separate novice competitors',
        description: text,
        category: 'division',
        ruleType: 'experience_grouping',
        enforcement: 'soft',
        parameters: { separateNovice: true, noviceThreshold: threshold, separateVeteran: false, veteranThreshold: 10 },
        priority: 50,
        source: 'llm_suggested',
      },
      confidence: 0.75,
      explanation: `Interpreted as: Separate competitors with fewer than ${threshold} tournament(s) into novice divisions`,
      needsHumanReview: true,
    };
  }

  // Pattern: division size
  if (/division.size|min.competitors|max.competitors|too.few|too.many|division.of/.test(lower)) {
    const minMatch = lower.match(/(?:min|at.least|minimum)\s*(\d+)/);
    const maxMatch = lower.match(/(?:max|no.more.than|maximum|at.most)\s*(\d+)/);
    return {
      suggestedRule: {
        name: 'Division size limits',
        description: text,
        category: 'division',
        ruleType: 'min_division_size',
        enforcement: 'soft',
        parameters: {
          minCompetitors: minMatch ? parseInt(minMatch[1]) : 3,
          maxCompetitors: maxMatch ? parseInt(maxMatch[1]) : 16,
          mergeStrategy: 'adjacent_age',
          splitStrategy: 'skill_balanced',
        },
        priority: 60,
        source: 'llm_suggested',
      },
      confidence: (minMatch || maxMatch) ? 0.85 : 0.5,
      explanation: `Interpreted as: Divisions should have ${minMatch ? `at least ${minMatch[1]}` : '3+'} and ${maxMatch ? `at most ${maxMatch[1]}` : '16 or fewer'} competitors`,
      needsHumanReview: true,
    };
  }

  // No pattern matched
  return {
    suggestedRule: null,
    confidence: 0,
    explanation: 'Could not parse this rule. Please try rephrasing or create it manually. Examples: "No same-school matches in round 1", "Max 15 lbs weight difference", "Separate novice competitors"',
    needsHumanReview: false,
  };
}

// ── Routes ─────────────────────────────────────────────────────────────

// GET /api/rules/tournament/:tournamentId - List rules for tournament
router.get(
  '/tournament/:tournamentId',
  authenticate,
  requireTournamentAccess('director'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const tournamentId = getParam(req.params.tournamentId);

    const rules = await prisma.tournamentRule.findMany({
      where: { tournamentId },
      orderBy: { priority: 'desc' },
    });

    // Parse parameters JSON for the response
    const parsed = rules.map(rule => ({
      ...rule,
      parameters: safeJsonParse(rule.parameters, {}),
    }));

    res.json(parsed);
  }
);

// POST /api/rules/tournament/:tournamentId - Create a rule
router.post(
  '/tournament/:tournamentId',
  authenticate,
  requireTournamentAccess('director'),
  validateRequest(createRuleSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const tournamentId = getParam(req.params.tournamentId);

    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const { name, description, category, ruleType, enforcement, parameters, priority, isActive, source } = req.body;

    const rule = await prisma.tournamentRule.create({
      data: {
        tournamentId,
        name,
        description: description || null,
        category,
        ruleType,
        enforcement,
        parameters: JSON.stringify(parameters),
        priority,
        isActive,
        source,
        createdBy: req.user?.id || null,
      },
    });

    res.status(201).json({
      ...rule,
      parameters: JSON.parse(rule.parameters),
    });
  }
);

// PUT /api/rules/:ruleId - Update a rule
router.put(
  '/:ruleId',
  authenticate,
  validateRequest(updateRuleSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const ruleId = getParam(req.params.ruleId);

    const existing = await prisma.tournamentRule.findUnique({
      where: { id: ruleId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    // Authorize against the parent tournament.
    const access = await checkTournamentAccess(req, prisma, existing.tournamentId, 'director');
    if (!access.ok) {
      return res.status(access.status || 403).json({ error: access.error });
    }

    const updateData: Record<string, unknown> = {};
    const { name, description, category, ruleType, enforcement, parameters, priority, isActive, source } = req.body;

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (category !== undefined) updateData.category = category;
    if (ruleType !== undefined) updateData.ruleType = ruleType;
    if (enforcement !== undefined) updateData.enforcement = enforcement;
    if (parameters !== undefined) updateData.parameters = JSON.stringify(parameters);
    if (priority !== undefined) updateData.priority = priority;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (source !== undefined) updateData.source = source;

    const updated = await prisma.tournamentRule.update({
      where: { id: ruleId },
      data: updateData,
    });

    res.json({
      ...updated,
      parameters: safeJsonParse(updated.parameters, {}),
    });
  }
);

// DELETE /api/rules/:ruleId - Delete a rule
router.delete(
  '/:ruleId',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const ruleId = getParam(req.params.ruleId);

    const existing = await prisma.tournamentRule.findUnique({
      where: { id: ruleId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    // Authorize against the parent tournament.
    const access = await checkTournamentAccess(req, prisma, existing.tournamentId, 'director');
    if (!access.ok) {
      return res.status(access.status || 403).json({ error: access.error });
    }

    await prisma.tournamentRule.delete({
      where: { id: ruleId },
    });

    res.json({ message: 'Rule deleted successfully' });
  }
);

// POST /api/rules/tournament/:tournamentId/defaults - Initialize default rules
router.post(
  '/tournament/:tournamentId/defaults',
  authenticate,
  requireTournamentAccess('director'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const tournamentId = getParam(req.params.tournamentId);

    // Check if rules already exist
    const existingCount = await prisma.tournamentRule.count({
      where: { tournamentId },
    });

    if (existingCount > 0) {
      return res.status(409).json({
        error: 'Tournament already has rules configured',
        existingCount,
        suggestion: 'Delete existing rules first or update them individually',
      });
    }

    const defaults = getDefaultRules(tournamentId);

    const created = await prisma.tournamentRule.createMany({
      data: defaults.map(rule => ({
        ...rule,
        createdBy: req.user?.id || null,
      })),
    });

    // Return the created rules
    const rules = await prisma.tournamentRule.findMany({
      where: { tournamentId },
      orderBy: { priority: 'desc' },
    });

    const parsed = rules.map(rule => ({
      ...rule,
      parameters: safeJsonParse(rule.parameters, {}),
    }));

    res.status(201).json({
      message: `Created ${created.count} default rules`,
      rules: parsed,
    });
  }
);

// POST /api/rules/tournament/:tournamentId/evaluate - Run rules against current brackets/divisions
router.post(
  '/tournament/:tournamentId/evaluate',
  authenticate,
  requireTournamentAccess('director'),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const tournamentId = getParam(req.params.tournamentId);

    // 1. Load tournament rules
    const rules = await loadTournamentRules(prisma, tournamentId);

    if (rules.length === 0) {
      return res.json({
        message: 'No active rules configured for this tournament',
        divisionResult: { passed: true, violations: [], warnings: [], info: [], score: 100 },
        bracketResult: { passed: true, violations: [], warnings: [], info: [], score: 100 },
        overallScore: 100,
      });
    }

    // 2. Load divisions with assignments and competitor data
    const divisions = await prisma.division.findMany({
      where: { tournamentId },
      include: {
        assignments: {
          include: {
            registration: {
              include: {
                competitor: {
                  select: {
                    id: true,
                    schoolDojang: true,
                    weightLbs: true,
                    heightInches: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // 3. Load brackets with matches and competitor data
    const brackets = await prisma.bracket.findMany({
      where: {
        division: { tournamentId },
      },
      include: {
        matches: {
          include: {
            competitor1: {
                select: {
                  id: true,
                  competitorId: true,
                  ageAtTournament: true,
                  competitor: {
                    select: {
                      id: true,
                      schoolDojang: true,
                      weightLbs: true,
                      heightInches: true,
                    },
                  },
                },
              },
            competitor2: {
                select: {
                  id: true,
                  competitorId: true,
                  ageAtTournament: true,
                  competitor: {
                    select: {
                      id: true,
                      schoolDojang: true,
                      weightLbs: true,
                      heightInches: true,
                    },
                  },
                },
              },
          },
        },
      },
    });

    // 4. Transform divisions for evaluator
    const divisionData = divisions.map(div => ({
      id: div.id,
      name: div.name,
      eventType: div.eventType,
      assignments: div.assignments.map(a => ({
        registration: {
          id: a.registration.id,
          competitorId: a.registration.competitorId,
          ageAtTournament: a.registration.ageAtTournament,
          weightAtRegistration: a.registration.weightAtRegistration,
          competitor: {
            schoolDojang: a.registration.competitor.schoolDojang,
            weightLbs: a.registration.competitor.weightLbs,
            heightInches: a.registration.competitor.heightInches,
          },
        },
      })),
    }));

    // 5. Transform matches for evaluator
    const allMatches = brackets.flatMap(bracket =>
      bracket.matches.map(match => ({
        id: match.id,
        roundNumber: match.roundNumber,
        matchNumber: match.matchNumber,
        competitor1: match.competitor1 ? {
          id: match.competitor1.id,
          competitorId: match.competitor1.competitorId,
          ageAtTournament: match.competitor1.ageAtTournament,
          competitor: {
            schoolDojang: match.competitor1.competitor.schoolDojang,
            weightLbs: match.competitor1.competitor.weightLbs,
            heightInches: match.competitor1.competitor.heightInches,
          },
        } : null,
        competitor2: match.competitor2 ? {
          id: match.competitor2.id,
          competitorId: match.competitor2.competitorId,
          ageAtTournament: match.competitor2.ageAtTournament,
          competitor: {
            schoolDojang: match.competitor2.competitor.schoolDojang,
            weightLbs: match.competitor2.competitor.weightLbs,
            heightInches: match.competitor2.competitor.heightInches,
          },
        } : null,
      }))
    );

    // 6. Run both evaluators
    const divisionResult = evaluateDivisionRules(rules, divisionData);
    const bracketResult = evaluateBracketRules(rules, allMatches);

    // 7. Combine results
    const overallScore = Math.round((divisionResult.score + bracketResult.score) / 2);

    res.json({
      divisionResult,
      bracketResult,
      overallScore,
      summary: {
        totalRules: rules.length,
        divisionsEvaluated: divisions.length,
        bracketsEvaluated: brackets.length,
        matchesEvaluated: allMatches.length,
        hardViolations: divisionResult.violations.length + bracketResult.violations.length,
        softWarnings: divisionResult.warnings.length + bracketResult.warnings.length,
        infoItems: divisionResult.info.length + bracketResult.info.length,
      },
    });
  }
);

// POST /api/rules/tournament/:tournamentId/parse - LLM-powered natural language rule parser
router.post(
  '/tournament/:tournamentId/parse',
  authenticate,
  requireTournamentAccess('director'),
  validateRequest(parseRuleSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const prisma: PrismaClient = req.app.locals.prisma;
    const tournamentId = getParam(req.params.tournamentId);

    const { text } = req.body;

    const result = parseNaturalLanguageRule(text, tournamentId);

    res.json(result);
  }
);

export default router;
