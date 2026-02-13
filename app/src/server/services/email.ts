import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return transporter;
}

export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function verifyEmailConnection(): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;

  try {
    await t.verify();
    return true;
  } catch (err) {
    console.error('SMTP connection verification failed:', err);
    return false;
  }
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ success: boolean; error?: string }> {
  const t = getTransporter();

  if (!t) {
    console.log(`[Email not configured] To: ${to}, Subject: ${subject}`);
    return { success: false, error: 'Email not configured' };
  }

  const fromName = process.env.EMAIL_FROM_NAME || 'TKD Tournament Manager';
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USER || 'noreply@example.com';

  try {
    await t.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to,
      subject,
      html,
    });
    return { success: true };
  } catch (err: any) {
    console.error('Failed to send email:', err);
    return { success: false, error: err.message || 'Failed to send email' };
  }
}
