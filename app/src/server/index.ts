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
import { isAppError, toApiError } from './utils/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// Security middleware
const corsOptions = {
  origin: isProduction
    ? process.env.ALLOWED_ORIGINS?.split(',') || true // Configure allowed origins in production
    : true, // Allow all in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '50mb' }));

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

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files in production
if (isProduction) {
  const distPath = path.join(__dirname, '../../dist');
  app.use(express.static(distPath));

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
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
