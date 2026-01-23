import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createToken, authenticate, type AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

// Register new user
router.post('/register', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { email, password, firstName, lastName } = req.body;

  // Validation
  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

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
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Login
router.post('/login', async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

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
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
router.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
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
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Change password
router.put('/password', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
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
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Update profile
router.put('/profile', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { firstName, lastName } = req.body;

  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'First name and last name are required' });
  }

  try {
    const user = await prisma.user.update({
      where: { id: req.user!.id },
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
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Admin: List all users
router.get('/users', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const prisma: PrismaClient = req.app.locals.prisma;

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
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// Admin: Update user role
router.put('/users/:userId/role', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const prisma: PrismaClient = req.app.locals.prisma;
  const { userId } = req.params;
  const { role } = req.body;

  const validRoles = ['admin', 'director', 'scorekeeper', 'viewer'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  // Prevent removing own admin role
  if (userId === req.user!.id && role !== 'admin') {
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
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// Admin: Toggle user active status
router.put('/users/:userId/status', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const prisma: PrismaClient = req.app.locals.prisma;
  const { userId } = req.params;
  const { isActive } = req.body;

  // Prevent deactivating self
  if (userId === req.user!.id && !isActive) {
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
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// Admin: Grant tournament access
router.post('/tournaments/:tournamentId/access', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const prisma: PrismaClient = req.app.locals.prisma;
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
  } catch (error) {
    console.error('Grant access error:', error);
    res.status(500).json({ error: 'Failed to grant tournament access' });
  }
});

// Admin: Revoke tournament access
router.delete('/tournaments/:tournamentId/access/:userId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const prisma: PrismaClient = req.app.locals.prisma;
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
  } catch (error) {
    console.error('Revoke access error:', error);
    res.status(500).json({ error: 'Failed to revoke tournament access' });
  }
});

export default router;
