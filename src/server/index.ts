import 'dotenv/config';
import type { Request, Response, NextFunction } from 'express-serve-static-core';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import 'express-async-errors';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import competitorsRouter from './routes/competitors.js';
import tournamentsRouter from './routes/tournaments.js';
import divisionsRouter from './routes/divisions.js';
import bracketsRouter from './routes/brackets.js';
import authRouter from './routes/auth.js';
import publicRouter from './routes/public.js';
import analyticsRouter from './routes/analytics.js';
import invitesRouter from './routes/invites.js';
import sportsRouter from './routes/sports.js';
import { isAppError, toApiError } from './utils/errors.js';
import { isEmailConfigured, verifyEmailConnection } from './services/email.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prisma 7: lazy proxy to defer PrismaClient construction.
// v7 requires a driver adapter — using PrismaPg so the client engine can connect to PostgreSQL.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };
const buildPrisma = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: ['warn', 'error'],
  });

const app = express();
const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = (globalForPrisma.prisma ??= buildPrisma());
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});
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

// Security headers — HSTS, X-Content-Type-Options, X-Frame-Options, etc.
// Helmet's defaults are sensible for an internal dashboard. We override
// CSP because the app does serve HTML (the React SPA) and the default
// `default-src 'self'` would break Vite's inline-style hydration; we
// keep `style-src 'self' 'unsafe-inline'` to match the hand-rolled
// CSP that was here before. COEP off because the API + SPA don't
// need cross-origin isolation.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

// 1 MB JSON body limit. Heavy endpoints (Excel auto-map, import) accept
// multipart/form-data or pre-parsed JSON from the client. A larger
// default + a single huge endpoint was an OOM vector.
app.use(express.json({ limit: '1mb' }));

// Make prisma available to routes
app.locals.prisma = prisma;

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/public', publicRouter);
app.use('/api/competitors', competitorsRouter);
app.use('/api/tournaments', tournamentsRouter);
app.use('/api/divisions', divisionsRouter);
app.use('/api/brackets', bracketsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/sports', sportsRouter);

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

  // Handle client-side routing - serve index.html for non-API routes,
  // return 404 JSON for unmatched /api/* paths. Without the /api/* branch,
  // the handler silently no-ops and the connection sits open until the
  // client times out (Express 4 has no built-in 404 default).
  app.get('*', (req: Request, res: Response) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({
        error: 'Not found',
        code: 'ROUTE_NOT_FOUND',
        path: req.originalUrl,
        method: req.method,
      });
      return;
    }
    res.sendFile(path.join(distPath, 'index.html'));
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
