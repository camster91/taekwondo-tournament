export function validateProductionServiceConfig(
  env: Record<string, string | undefined>,
): { publicAppUrl: string; allowedOrigins: string[] } {
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'ALLOWED_ORIGINS',
    'PUBLIC_APP_URL',
    'MAILGUN_API_KEY',
    'MAILGUN_DOMAIN',
    'EMAIL_FROM_ADDRESS',
  ] as const;
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(`Required production configuration is missing: ${missing.join(', ')}`);
  }
  if (env.JWT_SECRET!.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }

  const publicAppUrl = env.PUBLIC_APP_URL!.trim().replace(/\/$/, '');
  if (!publicAppUrl.startsWith('https://')) {
    throw new Error('PUBLIC_APP_URL must use HTTPS in production');
  }
  const allowedOrigins = env.ALLOWED_ORIGINS!.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (!allowedOrigins.length || allowedOrigins.some((origin) => !origin.startsWith('https://'))) {
    throw new Error('Every ALLOWED_ORIGINS entry must use HTTPS in production');
  }
  return { publicAppUrl, allowedOrigins };
}

export function publicAppUrlFromEnv(env: Record<string, string | undefined>): string {
  return (env.PUBLIC_APP_URL?.trim() || 'http://localhost:5173').replace(/\/$/, '');
}
