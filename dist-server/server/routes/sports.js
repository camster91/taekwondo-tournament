import { Router } from 'express';
import { SPORT_PROFILES, getSportProfile } from '../../shared/constants/sport-profiles.js';
const router = Router();
// Get all sport profiles
router.get('/', (_req, res) => {
    res.json(SPORT_PROFILES.map(p => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        icon: p.icon,
        description: p.description,
        eventTypes: p.eventTypes,
        beltConfig: p.beltConfig,
        scoringConfig: p.scoringConfig,
    })));
});
// Get single sport profile
router.get('/:slug', (req, res) => {
    const profile = getSportProfile(req.params.slug);
    if (!profile) {
        return res.status(404).json({ error: 'Sport profile not found' });
    }
    res.json(profile);
});
export default router;
