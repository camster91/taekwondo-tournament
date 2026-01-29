import { Router } from 'express';
import { autoCategorize, previewCategorization } from '../services/categorization-engine.js';
import { Errors } from '../utils/errors.js';
import { checkDataLoss, validateTournamentState, backupDivisionState, saveBackup, } from '../services/backup-recovery.js';
import { authenticate } from '../middleware/auth.js';
const router = Router();
// Helper to safely get string param
const getParam = (param) => {
    if (Array.isArray(param))
        return param[0];
    return param || '';
};
// Get divisions for a tournament
router.get('/tournament/:tournamentId', async (req, res) => {
    const prisma = req.app.locals.prisma;
    const divisions = await prisma.division.findMany({
        where: { tournamentId: getParam(req.params.tournamentId) },
        include: {
            _count: {
                select: { assignments: true },
            },
            bracket: true,
        },
        orderBy: [
            { beltLevel: 'asc' },
            { gender: 'asc' },
            { eventType: 'asc' },
            { ageMin: 'asc' },
            { displayOrder: 'asc' },
        ],
    });
    res.json(divisions);
});
// Get single division with competitors
router.get('/:id', async (req, res) => {
    const prisma = req.app.locals.prisma;
    const division = await prisma.division.findUnique({
        where: { id: getParam(req.params.id) },
        include: {
            assignments: {
                include: {
                    registration: {
                        include: {
                            competitor: true,
                        },
                    },
                },
                orderBy: { seedPosition: 'asc' },
            },
            bracket: {
                include: {
                    matches: {
                        orderBy: [{ roundNumber: 'asc' }, { matchNumber: 'asc' }],
                    },
                },
            },
        },
    });
    if (!division) {
        return res.status(404).json({ error: 'Division not found' });
    }
    res.json(division);
});
// Preview divisions before generating (requires authentication)
router.post('/tournament/:tournamentId/preview', authenticate, async (req, res) => {
    const prisma = req.app.locals.prisma;
    const { config } = req.body;
    const tournament = await prisma.tournament.findUnique({
        where: { id: getParam(req.params.tournamentId) },
    });
    if (!tournament) {
        return res.status(404).json({ error: 'Tournament not found' });
    }
    // Get all registrations with competitor data
    const registrations = await prisma.registration.findMany({
        where: { tournamentId: getParam(req.params.tournamentId) },
        include: { competitor: true },
    });
    if (registrations.length === 0) {
        return res.json({
            divisions: [],
            totalCompetitors: 0,
            warnings: ['No registrations found for this tournament'],
        });
    }
    // Run preview (no database changes)
    const categorizationConfig = {
        divisionThreshold: config?.divisionThreshold ?? 8,
        ...config,
    };
    const preview = previewCategorization(registrations, categorizationConfig);
    res.json(preview);
});
// Check if regenerating divisions would lose data
router.get('/tournament/:tournamentId/check-data-loss', async (req, res) => {
    const prisma = req.app.locals.prisma;
    const tournamentId = getParam(req.params.tournamentId);
    const dataLoss = await checkDataLoss(prisma, tournamentId, 'regenerate_divisions');
    res.json(dataLoss);
});
// Auto-generate divisions for tournament (requires authentication)
router.post('/tournament/:tournamentId/auto-generate', authenticate, async (req, res) => {
    const prisma = req.app.locals.prisma;
    const tournamentId = getParam(req.params.tournamentId);
    const { config, force = false } = req.body;
    const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId },
    });
    if (!tournament) {
        throw Errors.tournamentNotFound(tournamentId);
    }
    // Validate state
    const validation = await validateTournamentState(prisma, tournamentId, 'has_registrations');
    if (!validation.valid) {
        throw Errors.noRegistrations(tournament.name);
    }
    // Check for data loss unless forced
    if (!force) {
        const dataLoss = await checkDataLoss(prisma, tournamentId, 'regenerate_divisions');
        if (dataLoss.wouldLoseData) {
            return res.status(409).json({
                error: 'Operation would cause data loss',
                code: 'DATA_LOSS_WARNING',
                warning: dataLoss.warning,
                affectedItems: dataLoss.affectedItems,
                recoverable: true,
                suggestion: 'Set "force: true" to proceed anyway, or export data first',
            });
        }
    }
    // Create backup before modifying
    const backup = await backupDivisionState(prisma, tournamentId);
    saveBackup(backup);
    // Get all registrations with competitor data
    const registrations = await prisma.registration.findMany({
        where: { tournamentId },
        include: { competitor: true },
    });
    // Run auto-categorization
    const categorizationConfig = {
        divisionThreshold: config?.divisionThreshold ?? 8,
        ...config,
    };
    const result = await autoCategorize(prisma, tournamentId, registrations, categorizationConfig);
    res.json({
        ...result,
        backupAvailable: true,
        message: `Generated ${result.divisions} divisions with ${result.assignments} assignments`,
    });
});
// Create manual division (requires authentication)
router.post('/', authenticate, async (req, res) => {
    const prisma = req.app.locals.prisma;
    const { tournamentId, name, beltLevel, gender, eventType, ageMin, ageMax, beltColors, danMin, danMax, weightClass, divisionNumber, isSpecialNeeds, } = req.body;
    const division = await prisma.division.create({
        data: {
            tournamentId,
            name,
            beltLevel,
            gender,
            eventType,
            ageMin,
            ageMax,
            beltColors: beltColors ? JSON.stringify(beltColors) : null,
            danMin,
            danMax,
            weightClass,
            divisionNumber: divisionNumber ?? 1,
            isSpecialNeeds: isSpecialNeeds ?? false,
        },
    });
    res.status(201).json(division);
});
// Update division (requires authentication)
router.put('/:id', authenticate, async (req, res) => {
    const prisma = req.app.locals.prisma;
    const { name, ageMin, ageMax, beltColors, danMin, danMax, weightClass, divisionNumber, isSpecialNeeds, displayOrder, } = req.body;
    const division = await prisma.division.update({
        where: { id: getParam(req.params.id) },
        data: {
            name,
            ageMin,
            ageMax,
            beltColors: beltColors ? JSON.stringify(beltColors) : undefined,
            danMin,
            danMax,
            weightClass,
            divisionNumber,
            isSpecialNeeds,
            displayOrder,
        },
    });
    res.json(division);
});
// Delete division (requires authentication)
router.delete('/:id', authenticate, async (req, res) => {
    const prisma = req.app.locals.prisma;
    const divisionId = getParam(req.params.id);
    const force = req.query.force === 'true';
    const division = await prisma.division.findUnique({
        where: { id: divisionId },
        include: {
            bracket: {
                include: {
                    matches: { where: { status: { in: ['completed', 'in_progress'] } } },
                },
            },
        },
    });
    if (!division) {
        throw Errors.divisionNotFound(divisionId);
    }
    // Check if bracket has results
    if (!force && division.bracket && division.bracket.matches.length > 0) {
        return res.status(409).json({
            error: 'Division has match results',
            code: 'DIVISION_HAS_RESULTS',
            warning: `Division "${division.name}" has ${division.bracket.matches.length} completed match(es)`,
            recoverable: true,
            suggestion: 'Add ?force=true to delete anyway',
        });
    }
    await prisma.division.delete({
        where: { id: divisionId },
    });
    res.json({ deleted: true, name: division.name });
});
// Clear all divisions for a tournament (requires authentication)
router.delete('/tournament/:tournamentId/all', authenticate, async (req, res) => {
    const prisma = req.app.locals.prisma;
    const tournamentId = getParam(req.params.tournamentId);
    const force = req.query.force === 'true';
    // Check for data loss unless forced
    if (!force) {
        const dataLoss = await checkDataLoss(prisma, tournamentId, 'delete_divisions');
        if (dataLoss.wouldLoseData) {
            return res.status(409).json({
                error: 'Operation would cause data loss',
                code: 'DATA_LOSS_WARNING',
                warning: dataLoss.warning,
                affectedItems: dataLoss.affectedItems,
                recoverable: true,
                suggestion: 'Add ?force=true to proceed anyway',
            });
        }
    }
    // Create backup before deleting
    const backup = await backupDivisionState(prisma, tournamentId);
    saveBackup(backup);
    const result = await prisma.division.deleteMany({
        where: { tournamentId },
    });
    res.json({
        deleted: result.count,
        backupAvailable: true,
        message: `Deleted ${result.count} division(s)`,
    });
});
// Assign competitor to division (requires authentication)
router.post('/:id/assign', authenticate, async (req, res) => {
    const prisma = req.app.locals.prisma;
    const { registrationId, seedPosition, manualOverride } = req.body;
    const assignment = await prisma.divisionAssignment.create({
        data: {
            divisionId: getParam(req.params.id),
            registrationId,
            seedPosition,
            manualOverride: manualOverride ?? true,
        },
        include: {
            registration: {
                include: { competitor: true },
            },
        },
    });
    res.status(201).json(assignment);
});
// Remove competitor from division (requires authentication)
router.delete('/:id/assign/:assignmentId', authenticate, async (req, res) => {
    const prisma = req.app.locals.prisma;
    await prisma.divisionAssignment.delete({
        where: { id: getParam(req.params.assignmentId) },
    });
    res.status(204).send();
});
// Move competitor between divisions (requires authentication)
router.post('/:id/move', authenticate, async (req, res) => {
    const prisma = req.app.locals.prisma;
    const { assignmentId, toDivisionId } = req.body;
    const assignment = await prisma.divisionAssignment.update({
        where: { id: assignmentId },
        data: {
            divisionId: toDivisionId,
            manualOverride: true,
        },
        include: {
            registration: {
                include: { competitor: true },
            },
        },
    });
    res.json(assignment);
});
// Split division (requires authentication)
router.post('/:id/split', authenticate, async (req, res) => {
    const prisma = req.app.locals.prisma;
    const { splitCount = 2 } = req.body;
    const division = await prisma.division.findUnique({
        where: { id: getParam(req.params.id) },
        include: {
            assignments: {
                include: {
                    registration: { include: { competitor: true } },
                },
            },
        },
    });
    if (!division) {
        return res.status(404).json({ error: 'Division not found' });
    }
    const assignments = division.assignments;
    const perDivision = Math.ceil(assignments.length / splitCount);
    // Create new divisions and reassign
    const newDivisions = [];
    for (let i = 0; i < splitCount; i++) {
        const isFirst = i === 0;
        const newDivision = isFirst
            ? division
            : await prisma.division.create({
                data: {
                    tournamentId: division.tournamentId,
                    name: `${division.name.replace(/ DIV\d+$/, '')} DIV${i + 1}`,
                    beltLevel: division.beltLevel,
                    gender: division.gender,
                    eventType: division.eventType,
                    ageMin: division.ageMin,
                    ageMax: division.ageMax,
                    beltColors: division.beltColors,
                    danMin: division.danMin,
                    danMax: division.danMax,
                    weightClass: division.weightClass,
                    divisionNumber: i + 1,
                    isSpecialNeeds: division.isSpecialNeeds,
                },
            });
        // Update first division name if needed
        if (isFirst && !division.name.includes('DIV')) {
            await prisma.division.update({
                where: { id: division.id },
                data: { name: `${division.name} DIV1`, divisionNumber: 1 },
            });
        }
        const divisionAssignments = assignments.slice(i * perDivision, (i + 1) * perDivision);
        // Move assignments to new division
        if (!isFirst) {
            for (const assignment of divisionAssignments) {
                await prisma.divisionAssignment.update({
                    where: { id: assignment.id },
                    data: { divisionId: newDivision.id },
                });
            }
        }
        newDivisions.push(newDivision);
    }
    res.json(newDivisions);
});
export default router;
