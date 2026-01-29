import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { createToken, authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
const router = Router();
// Rate limiting for auth routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: { error: 'Too many attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 registrations per hour per IP
    message: { error: 'Too many accounts created, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});
// Validation schemas
const registerSchema = z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    firstName: z.string().min(1, 'First name is required').max(100),
    lastName: z.string().min(1, 'Last name is required').max(100),
});
const loginSchema = z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password is required'),
});
const passwordChangeSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});
const profileUpdateSchema = z.object({
    firstName: z.string().min(1, 'First name is required').max(100),
    lastName: z.string().min(1, 'Last name is required').max(100),
});
const roleUpdateSchema = z.object({
    role: z.enum(['admin', 'director', 'scorekeeper', 'viewer']),
});
const statusUpdateSchema = z.object({
    isActive: z.boolean(),
});
const tournamentAccessSchema = z.object({
    userId: z.string().min(1, 'User ID is required'),
    role: z.enum(['director', 'scorekeeper', 'viewer']),
});
// Register new user
router.post('/register', registerLimiter, validateRequest(registerSchema), async (req, res) => {
    const prisma = req.app.locals.prisma;
    const { email, password, firstName, lastName } = req.body;
    try {
        // Check if email already exists
        const existingUser = await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
        });
        if (existingUser) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);
        // Check if this is the first user (make them admin)
        const userCount = await prisma.user.count();
        const role = userCount === 0 ? 'admin' : 'viewer';
        // Create user
        const user = await prisma.user.create({
            data: {
                email: email.toLowerCase(),
                passwordHash,
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                role,
            },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                createdAt: true,
            },
        });
        // Create token
        const token = createToken({
            userId: user.id,
            email: user.email,
            role: user.role,
        });
        res.status(201).json({
            user,
            token,
            message: userCount === 0 ? 'Admin account created successfully' : 'Account created successfully',
        });
    }
    catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Failed to create account' });
    }
});
// Login
router.post('/login', authLimiter, validateRequest(loginSchema), async (req, res) => {
    const prisma = req.app.locals.prisma;
    const { email, password } = req.body;
    try {
        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
        });
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        if (!user.isActive) {
            return res.status(401).json({ error: 'Account is disabled' });
        }
        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        // Update last login
        await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() },
        });
        // Create token
        const token = createToken({
            userId: user.id,
            email: user.email,
            role: user.role,
        });
        res.json({
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
            },
            token,
        });
    }
    catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});
// Get current user
router.get('/me', authenticate, async (req, res) => {
    const prisma = req.app.locals.prisma;
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                createdAt: true,
                lastLogin: true,
                tournamentAccess: {
                    include: {
                        tournament: {
                            select: { id: true, name: true, date: true },
                        },
                    },
                },
            },
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    }
    catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user' });
    }
});
// Change password
router.put('/password', authenticate, validateRequest(passwordChangeSchema), async (req, res) => {
    const prisma = req.app.locals.prisma;
    const { currentPassword, newPassword } = req.body;
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        const passwordHash = await bcrypt.hash(newPassword, 12);
        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash },
        });
        res.json({ message: 'Password updated successfully' });
    }
    catch (error) {
        console.error('Password change error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
});
// Update profile
router.put('/profile', authenticate, validateRequest(profileUpdateSchema), async (req, res) => {
    const prisma = req.app.locals.prisma;
    const { firstName, lastName } = req.body;
    try {
        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: {
                firstName: firstName.trim(),
                lastName: lastName.trim(),
            },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
            },
        });
        res.json(user);
    }
    catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});
// Admin: List all users
router.get('/users', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const prisma = req.app.locals.prisma;
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isActive: true,
                createdAt: true,
                lastLogin: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(users);
    }
    catch (error) {
        console.error('List users error:', error);
        res.status(500).json({ error: 'Failed to list users' });
    }
});
// Admin: Update user role
router.put('/users/:userId/role', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const prisma = req.app.locals.prisma;
    const { userId } = req.params;
    const { role } = req.body;
    const validRoles = ['admin', 'director', 'scorekeeper', 'viewer'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }
    // Prevent removing own admin role
    if (userId === req.user.id && role !== 'admin') {
        return res.status(400).json({ error: 'Cannot remove your own admin role' });
    }
    try {
        const user = await prisma.user.update({
            where: { id: userId },
            data: { role },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isActive: true,
            },
        });
        res.json(user);
    }
    catch (error) {
        console.error('Update role error:', error);
        res.status(500).json({ error: 'Failed to update user role' });
    }
});
// Admin: Toggle user active status
router.put('/users/:userId/status', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const prisma = req.app.locals.prisma;
    const { userId } = req.params;
    const { isActive } = req.body;
    // Prevent deactivating self
    if (userId === req.user.id && !isActive) {
        return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }
    try {
        const user = await prisma.user.update({
            where: { id: userId },
            data: { isActive },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isActive: true,
            },
        });
        res.json(user);
    }
    catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({ error: 'Failed to update user status' });
    }
});
// Admin: Grant tournament access
router.post('/tournaments/:tournamentId/access', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const prisma = req.app.locals.prisma;
    const { tournamentId } = req.params;
    const { userId, role } = req.body;
    const validRoles = ['director', 'scorekeeper', 'viewer'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }
    try {
        const access = await prisma.userTournamentAccess.upsert({
            where: {
                userId_tournamentId: {
                    userId,
                    tournamentId,
                },
            },
            update: { role },
            create: { userId, tournamentId, role },
            include: {
                user: {
                    select: { id: true, email: true, firstName: true, lastName: true },
                },
                tournament: {
                    select: { id: true, name: true },
                },
            },
        });
        res.json(access);
    }
    catch (error) {
        console.error('Grant access error:', error);
        res.status(500).json({ error: 'Failed to grant tournament access' });
    }
});
// Admin: Revoke tournament access
router.delete('/tournaments/:tournamentId/access/:userId', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const prisma = req.app.locals.prisma;
    const { tournamentId, userId } = req.params;
    try {
        await prisma.userTournamentAccess.delete({
            where: {
                userId_tournamentId: {
                    userId,
                    tournamentId,
                },
            },
        });
        res.status(204).send();
    }
    catch (error) {
        console.error('Revoke access error:', error);
        res.status(500).json({ error: 'Failed to revoke tournament access' });
    }
});
export default router;
