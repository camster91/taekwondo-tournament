import { appMetrics } from './observability.js';

/**
 * Where outgoing email goes. A root admin can save Mailgun settings in the
 * app (Settings → Email delivery, stored encrypted in PlatformSetting);
 * those win over the MAILGUN_* environment variables so email can be fixed
 * without a redeploy. Without either, email is "not configured" and auth
 * runs in its dev-mode branch (see routes/auth.ts).
 */
export interface EmailConfig {
  apiKey: string;
  domain: string;
  baseUrl: string;
  fromName: string;
  fromAddress: string;
  source: 'saved' | 'environment';
}

export interface EmailSendOutcome {
  at: string;
  ok: boolean;
  error?: string;
}

let savedConfig: Omit<EmailConfig, 'source'> | null = null;
let lastOutcome: EmailSendOutcome | null = null;

/** Settings saved in the app (null clears them, falling back to the environment). */
export function setSavedEmailConfig(config: Omit<EmailConfig, 'source'> | null): void {
  savedConfig = config;
}

function environmentEmailConfig(): EmailConfig | null {
  const apiKey = process.env.MAILGUN_API_KEY || '';
  if (!apiKey) return null;
  const domain = process.env.MAILGUN_DOMAIN || 'ashbi.ca';
  return {
    apiKey,
    domain,
    baseUrl: process.env.MAILGUN_BASE_URL || 'https://api.mailgun.net/v3',
    fromName: process.env.EMAIL_FROM_NAME || 'bowin',
    fromAddress: process.env.EMAIL_FROM_ADDRESS || `noreply@${domain}`,
    source: 'environment',
  };
}

/** The settings email is sent with right now, or null when email is off. */
export function activeEmailConfig(): EmailConfig | null {
  if (savedConfig) return { ...savedConfig, source: 'saved' };
  return environmentEmailConfig();
}

export function isEmailConfigured(): boolean {
  return activeEmailConfig() !== null;
}

/** Result of the most recent send attempt in this process (for the admin page). */
export function lastEmailOutcome(): EmailSendOutcome | null {
  return lastOutcome;
}

export async function verifyEmailConnection(): Promise<boolean> {
  const config = activeEmailConfig();
  if (!config) return false;

  try {
    const auth = Buffer.from(`api:${config.apiKey}`).toString('base64');
    // Hit /v3/domains/{domain} (the domain-info endpoint), not /v3/{domain}
    // which is a 404. The previous shape was wrong even though sending
    // worked — the startup log "SMTP connection failed" was a false negative
    // caused by this verify path.
    const res = await fetch(`${config.baseUrl}/domains/${config.domain}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    return res.ok;
  } catch (err) {
    console.error('Mailgun connection verification failed:', err);
    return false;
  }
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ success: boolean; error?: string }> {
  const config = activeEmailConfig();
  if (!config) {
    console.log(`[Email not configured] To: ${to}, Subject: ${subject}`);
    return { success: false, error: 'Email not configured' };
  }

  try {
    const params = new URLSearchParams();
    params.append('from', `"${config.fromName}" <${config.fromAddress}>`);
    params.append('to', to);
    params.append('subject', subject);
    params.append('html', html);

    const auth = Buffer.from(`api:${config.apiKey}`).toString('base64');
    const res = await fetch(`${config.baseUrl}/${config.domain}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Mailgun API error: ${res.status} - ${err}`);
    }

    appMetrics.recordEmail(true);
    lastOutcome = { at: new Date().toISOString(), ok: true };
    return { success: true };
  } catch (err: unknown) {
    appMetrics.recordEmail(false);
    console.error('Failed to send email:', err);
    const message = err instanceof Error ? err.message : 'Failed to send email';
    lastOutcome = { at: new Date().toISOString(), ok: false, error: message.slice(0, 500) };
    return { success: false, error: message };
  }
}
