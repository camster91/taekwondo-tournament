import type { Request, Response, NextFunction } from 'express-serve-static-core';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import 'express-async-errors';
import { PrismaClient } from '@prisma/client';
import competitorsRouter from './routes/competitors.js';
import tournamentsRouter from './routes/tournaments.js';
import divisionsRouter from './routes/divisions.js';
import bracketsRouter from './routes/brackets.js';
import authRouter from './routes/auth.js';
import publicRouter from './routes/public.js';
import fairnessRouter from './routes/fairness.js';
import analyticsRouter from './routes/analytics.js';
import invitesRouter from './routes/invites.js';
import sportsRouter from './routes/sports.js';
import organizationsRouter from './routes/organizations.js';
import rulesRouter from './routes/rules.js';
import { isAppError, toApiError } from './utils/errors.js';
import { isEmailConfigured, verifyEmailConnection } from './services/email.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// Trust proxy only in production (behind Coolify/Docker reverse proxy)
if (isProduction) {
  app.set('trust proxy', 1);
}

// Security middleware
const corsOptions = {
  origin: isProduction
    ? process.env.ALLOWED_ORIGINS?.split(',') || false // Fail closed: reject if not configured
    : true, // Allow all in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));

// Security headers
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'");
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

// Make prisma available to routes
app.locals.prisma = prisma;

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/public', publicRouter);
app.use('/api/competitors', competitorsRouter);
app.use('/api/tournaments', tournamentsRouter);
app.use('/api/divisions', divisionsRouter);
app.use('/api/brackets', bracketsRouter);
app.use('/api/fairness', fairnessRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/sports', sportsRouter);
app.use('/api/organizations', organizationsRouter);
app.use('/api/rules', rulesRouter);

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files in production
if (isProduction) {
  const distPath = path.join(__dirname, '../../dist');
  app.use(express.static(distPath, {
    setHeaders: (res: Response, filePath: string) => {
      // Set correct MIME types for JavaScript modules
      if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      } else if (filePath.endsWith('.css')) {
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
      }
    },
  }));

  // Handle client-side routing - serve index.html for all non-API routes
  app.get('*', (req: Request, res: Response) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
}

// Error handler with structured error responses
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  // Log error for debugging
  console.error('Error:', {
    message: err.message,
    stack: isProduction ? undefined : err.stack,
    path: req.path,
    method: req.method,
  });

  // Convert to API error format
  const apiError = isAppError(err) ? err.toJSON() : toApiError(err);

  // Send structured error response
  res.status(apiError.statusCode).json({
    error: apiError.error,
    code: apiError.code,
    recoverable: apiError.recoverable,
    suggestion: apiError.suggestion,
    details: apiError.details,
  });
});

// Start server
app.listen(Number(PORT), '0.0.0.0', async () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);

  if (isEmailConfigured()) {
    const ok = await verifyEmailConnection();
    console.log(ok ? 'SMTP connection verified' : 'SMTP connection failed — emails will not be sent');
  } else {
    console.log('SMTP not configured — email features disabled');
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
