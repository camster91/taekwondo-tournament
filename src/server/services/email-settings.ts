// Mailgun settings a root admin saves in the app. Stored in PlatformSetting
// as AES-256-GCM-encrypted JSON (key derived from JWT_SECRET), loaded into
// the email service at startup and after every change.
import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { setSavedEmailConfig, type EmailConfig } from './email.js';

export const EMAIL_SETTINGS_KEY = 'email.mailgun';

export const MAILGUN_BASE_URLS = {
  us: 'https://api.mailgun.net/v3',
  eu: 'https://api.eu.mailgun.net/v3',
} as const;

export type MailgunRegion = keyof typeof MAILGUN_BASE_URLS;

export interface SavedEmailSettings {
  apiKey: string;
  domain: string;
  region: MailgunRegion;
  fromName: string;
  fromAddress: string;
}

function encryptionKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required to store email settings');
  return crypto.createHash('sha256').update(`${secret}:platform-settings`).digest();
}

export function encryptSetting(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

/** Null when the value can't be read (e.g. JWT_SECRET changed since it was saved). */
export function decryptSetting(stored: string): string | null {
  try {
    const [version, iv, tag, data] = stored.split(':');
    if (version !== 'v1' || !iv || !tag || !data) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function toEmailConfig(settings: SavedEmailSettings): Omit<EmailConfig, 'source'> {
  return {
    apiKey: settings.apiKey,
    domain: settings.domain,
    baseUrl: MAILGUN_BASE_URLS[settings.region],
    fromName: settings.fromName,
    fromAddress: settings.fromAddress,
  };
}

export async function readEmailSettings(prisma: PrismaClient): Promise<{ settings: SavedEmailSettings | null; unreadable: boolean }> {
  const row = await prisma.platformSetting.findUnique({ where: { key: EMAIL_SETTINGS_KEY } });
  if (!row) return { settings: null, unreadable: false };
  const plain = decryptSetting(row.value);
  if (!plain) return { settings: null, unreadable: true };
  try {
    return { settings: JSON.parse(plain) as SavedEmailSettings, unreadable: false };
  } catch {
    return { settings: null, unreadable: true };
  }
}

export async function saveEmailSettings(prisma: PrismaClient, settings: SavedEmailSettings, userId: string): Promise<void> {
  const value = encryptSetting(JSON.stringify(settings));
  await prisma.platformSetting.upsert({
    where: { key: EMAIL_SETTINGS_KEY },
    create: { key: EMAIL_SETTINGS_KEY, value, updatedById: userId },
    update: { value, updatedById: userId },
  });
  setSavedEmailConfig(toEmailConfig(settings));
}

export async function clearEmailSettings(prisma: PrismaClient): Promise<void> {
  await prisma.platformSetting.deleteMany({ where: { key: EMAIL_SETTINGS_KEY } });
  setSavedEmailConfig(null);
}

/** Load saved settings into the email service (startup). Never throws. */
export async function loadSavedEmailSettings(prisma: PrismaClient): Promise<void> {
  try {
    const { settings, unreadable } = await readEmailSettings(prisma);
    if (unreadable) console.error('[email] saved email settings could not be decrypted; re-enter them under Email delivery');
    setSavedEmailConfig(settings ? toEmailConfig(settings) : null);
  } catch (err) {
    console.error('[email] could not load saved email settings:', err);
  }
}
