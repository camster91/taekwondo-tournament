const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY || '';
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'ashbi.ca';
const MAILGUN_BASE_URL = process.env.MAILGUN_BASE_URL || 'https://api.mailgun.net/v3';

export function isEmailConfigured(): boolean {
  return !!MAILGUN_API_KEY;
}

export async function verifyEmailConnection(): Promise<boolean> {
  if (!MAILGUN_API_KEY) return false;

  try {
    const auth = Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64');
    // Hit /v3/domains/{domain} (the domain-info endpoint), not /v3/{domain}
    // which is a 404. The previous shape was wrong even though sending
    // worked — the startup log "SMTP connection failed" was a false negative
    // caused by this verify path.
    const res = await fetch(`${MAILGUN_BASE_URL}/domains/${MAILGUN_DOMAIN}`, {
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
  if (!MAILGUN_API_KEY) {
    console.log(`[Email not configured] To: ${to}, Subject: ${subject}`);
    return { success: false, error: 'Email not configured' };
  }

  const fromName = process.env.EMAIL_FROM_NAME || 'bowin';
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || `noreply@${MAILGUN_DOMAIN}`;

  try {
    const params = new URLSearchParams();
    params.append('from', `"${fromName}" <${fromAddress}>`);
    params.append('to', to);
    params.append('subject', subject);
    params.append('html', html);

    const auth = Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64');
    const res = await fetch(`${MAILGUN_BASE_URL}/${MAILGUN_DOMAIN}/messages`, {
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

    return { success: true };
  } catch (err: unknown) {
    console.error('Failed to send email:', err);
    const message = err instanceof Error ? err.message : 'Failed to send email';
    return { success: false, error: message };
  }
}