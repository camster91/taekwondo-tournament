import 'dotenv/config';
import type { Request, Response, NextFunction } from 'express-serve-static-core';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import crypto from 'node:crypto';
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
import publicPortalRouter from './routes/public-portal.js';
import analyticsRouter from './routes/analytics.js';
import invitesRouter from './routes/invites.js';
import sportsRouter from './routes/sports.js';
import rulesRouter from './routes/rules.js';
import incidentsRouter from './routes/incidents.js';
import recommendationsRouter from './routes/recommendations.js';
import organizationsRouter from './routes/organizations.js';
import organizationLogoRouter from './routes/organization-logo.js';
import billingRouter, { stripeWebhookHandler } from './routes/billing.js';
import supportRouter from './routes/support.js';
import sosAlertsRouter from './routes/sos-alerts.js';
import { isAppError, toApiError } from './utils/errors.js';
import { isEmailConfigured, verifyEmailConnection } from './services/email.js';
import {
  retentionConfigFromEnv,
  startRetentionPurgeJob,
} from './services/retention-policy.js';
import { registrationLegalConfigFromEnv } from './routes/public-validation.js';
import { validateProductionServiceConfig } from './services/production-config.js';
import {
  createHttpMetrics,
  metricsTokenFromEnv,
  normalizeMetricRoute,
} from './services/observability.js';
import {
  initSentry,
  mountSentryRequestHandler,
  mountSentryErrorHandler,
  captureException as sentryCaptureException,
} from './services/sentry.js';
import { initializeWebSocket } from './services/websocket.js';

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
const httpMetrics = createHttpMetrics();
const retentionConfig = retentionConfigFromEnv(process.env);
registrationLegalConfigFromEnv(process.env, isProduction);

// Closes D9 (env validation): without this check, a typo or missing
// var in the deploy env file crashes the server on the first DB
// call (or silently boots in an unsafe state if JWT_SECRET is
// missing — it would fall back to a literal default and accept
// any token signed with that default). Now: fail-fast at startup
// with a clear list of which vars are missing, so an operator
// notices before the first request lands.
if (isProduction) {
  try {
    validateProductionServiceConfig(process.env);
  } catch (error) {
    console.error(`[startup] FATAL: ${error instanceof Error ? error.message : 'invalid production configuration'}`);
    process.exit(1);
  }
}
const metricsToken = metricsTokenFromEnv(process.env, false);

// Initialize Sentry BEFORE any middleware or routes
initSentry(app);

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
};
app.use(cors(corsOptions));

// Mount Sentry request handler AFTER cors, BEFORE routes
mountSentryRequestHandler(app);

// Correlate API errors with reverse-proxy and provider logs. An incoming ID
// is accepted only when it is short and header-safe; otherwise generate one.
app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.header('x-request-id');
  const requestId = incoming && /^[A-Za-z0-9._-]{8,80}$/.test(incoming)
    ? incoming
    : crypto.randomUUID();
  const startedAt = performance.now();
  res.setHeader('X-Request-ID', requestId);
  res.on('finish', () => {
    httpMetrics.record({
      method: req.method,
      route: normalizeMetricRoute(req.path),
      statusCode: res.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
    });
  });
  res.locals.requestId = requestId;
  next();
});

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

// Stripe signs the exact request bytes. Mount this before express.json(),
// otherwise signature verification receives a re-serialized object.
app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: '256kb' }), stripeWebhookHandler);

// 1 MB JSON body limit. Heavy endpoints (Excel auto-map, import) accept
// multipart/form-data or pre-parsed JSON from the client. A larger
// default + a single huge endpoint was an OOM vector.
//
// Per-route override pattern (closes D4): a route that needs a larger
// body (e.g. /api/competitors/auto-map accepts up to 25 MB of
// base64-encoded Excel) can mount a route-specific express.json
// with a higher limit ahead of the global one. Express will use
// the first middleware that actually parses the request, so
// the global 1 MB limit is the default and only the specific
// routes opt in to higher.
const defaultJsonParser = express.json({ limit: '1mb' });
// Closes D4: per-route higher body limit for the Excel auto-map
// endpoint. The global defaultJsonParser is 1 MB; the auto-map
// route accepts a 25 MB base64-encoded buffer, which inflates
// from the original .xlsx via base64 ~33%. The mount order is
// critical: the more-specific (longer prefix) express.json
// here runs FIRST, parses the body, and Express's body-parser
// only parses a request once per content-type — so the global
// 1 MB limit no longer trips for this route.
app.use('/api/competitors/auto-map', jsonBodyParser('40mb'));

// The global 1 MB default applies to every other route. Mounted
// after the per-route override so the specific path matches first.
app.use(defaultJsonParser);

// Helper: per-route body parser with a custom limit. Routes that
// need to accept a larger payload (Excel auto-map) wrap their
// handler with this. Always returns the same parser so a single
// route mounts the same middleware consistently.
export function jsonBodyParser(limit: string) {
  return express.json({ limit });
}

// Cookie parsing for JWT session tokens. Reads the HttpOnly
// `bowin_session` cookie set on login. The auth middleware
// accepts the cookie as the primary credential source; the
// `Authorization: Bearer` header remains a fallback for tests
// and other non-browser clients.
app.use(cookieParser());

// Compression MUST run before API routers. Express only invokes
// later middleware for unmatched requests — mounting compression
// after `/api/*` left every JSON response uncompressed (scoreboard,
// day-of, withMatches). Closes D11 for real.
app.use((await import('compression')).default());

// Make prisma available to routes
app.locals.prisma = prisma;

app.get('/api/internal/metrics', (req: Request, res: Response) => {
  if (!metricsToken) return res.status(404).json({ error: 'Not found' });
  const supplied = req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const expectedBuffer = Buffer.from(metricsToken);
  const suppliedBuffer = Buffer.from(supplied);
  const authorized = expectedBuffer.length === suppliedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
  if (!authorized) return res.status(401).json({ error: 'Invalid metrics credentials.' });
  res.type('text/plain; version=0.0.4').send(httpMetrics.render());
});

// API Routes
app.use('/api/auth', authRouter);
// Older cached clients used this pre-auth-router endpoint. Keep the API
// response compatible during service-worker/client asset transitions rather
// than letting the SPA fallback return HTML to a JSON consumer.
app.get('/api/setup-status', (_req: Request, res: Response) => {
  res.redirect(307, '/api/auth/setup-status');
});
app.use('/api/public', publicRouter);
app.use('/api/public/portal', publicPortalRouter);
app.use('/api/competitors', competitorsRouter);
app.use('/api/tournaments', tournamentsRouter);
app.use('/api/divisions', divisionsRouter);
app.use('/api/brackets', bracketsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/sports', sportsRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/incidents', incidentsRouter);
app.use('/api/support', supportRouter);
app.use('/api/recommendations', recommendationsRouter);
app.use('/api/organizations', organizationsRouter);
app.use('/api/organizations', organizationLogoRouter);
app.use('/api/billing', billingRouter);
app.use('/api/sos-alerts', sosAlertsRouter);

// Serve uploaded organization logos (P1-11)
app.use('/logos', express.static('/opt/cursor/logos', {
  maxAge: '1d',
  etag: true,
  lastModified: true,
}));

// Health check (liveness — the process is up and the HTTP server
// is bound). This is the cheap probe for the load balancer.
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness check (closes D10). Confirms the process is bound AND
// the Prisma client can answer a SELECT 1. The deploy script gates
// on this endpoint before declaring the new container healthy.
app.get('/api/health/ready', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'ok' });
  } catch (err: unknown) {
    // Never echo err.message — connection strings / hostnames can
    // appear in Prisma/pg errors and this probe is often public.
    console.error('[health/ready] db check failed:', err);
    res.status(503).json({ status: 'not ready', db: 'error' });
  }
});

// Serve the built client in production. The explicit test-only branch lets
// Playwright exercise the real service worker over localhost without weakening
// production's HTTPS and Secure-cookie requirements.
const serveBuiltClient = isProduction
  || (process.env.NODE_ENV === 'test' && process.env.ENABLE_E2E_STATIC_SERVER === '1');
if (serveBuiltClient) {
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
    if (req.path === '/register' || req.path === '/check-registration') {
      res.setHeader('X-Robots-Tag', 'noindex');
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Mount Sentry error handler BEFORE our error handler
mountSentryErrorHandler(app);

// Error handler with structured error responses
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  // Log error for debugging
  console.error('Error:', {
    requestId: res.locals.requestId,
    message: err.message,
    stack: isProduction ? undefined : err.stack,
    path: req.path,
    method: req.method,
  });

  // Capture exception in Sentry (with request context already attached)
  sentryCaptureException(err, {
    requestId: res.locals.requestId,
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


// Graceful shutdown (closes D7). Docker / Coolify / Kubernetes
// send SIGTERM first, then SIGKILL after 10 s. The previous
// handler only caught SIGINT (Ctrl-C in a terminal) — under
// SIGTERM the in-flight PDF export and analytics requests
// were 502'd and the Prisma connection pool leaked.
//
// New flow:
//   1. Receive signal, log it.
//   2. Stop accepting new connections (server.close).
//   3. Disconnect Prisma so in-flight queries can finish
//      cleanly against a healthy pool.
//   4. Hard-exit after 25 s in case anything hangs.
const server = app.listen(Number(PORT), '0.0.0.0', async () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);

  if (retentionConfig) {
    await startRetentionPurgeJob({ database: prisma, ...retentionConfig });
  } else {
    console.log('[retention] automatic purge disabled');
  }

  if (isEmailConfigured()) {
    const ok = await verifyEmailConnection();
    console.log(ok ? 'SMTP connection verified' : 'SMTP connection failed — emails will not be sent');
  } else {
    console.log('SMTP not configured — email features disabled');
  }
});

// Initialize WebSocket server after HTTP server is listening
initializeWebSocket(server);

const shutdown = async (signal: string) => {
  console.log(`[shutdown] received ${signal}, draining...`);
  // Stop accepting new connections.
  server.close(() => console.log('[shutdown] HTTP server closed'));
  // Hard-exit safety net.
  setTimeout(() => {
    console.error('[shutdown] 25s grace exceeded, forcing exit');
    process.exit(1);
  }, 25_000).unref();
  try {
    await prisma.$disconnect();
    console.log('[shutdown] Prisma disconnected');
  } catch (err) {
    console.error('[shutdown] Prisma disconnect error:', err);
  }
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
