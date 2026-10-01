import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export const secretMatches = (a, b) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(Buffer.from(tokenHash(a), 'hex'), Buffer.from(tokenHash(b), 'hex'));
export const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function text(value, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new Error('Invalid field');
  return value.trim();
}
export function email(value) {
  const result = text(value, 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new Error('Invalid email');
  return result;
}
export function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw new Error('Password must contain 12 to 128 characters');
  return value;
}
export function eventDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date');
  const date = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid date');
  return value;
}
export async function hashPassword(value) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password(value), salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt1:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(value, stored) {
  if (typeof value !== 'string' || value.length > 128) return false;
  const parts = String(stored).split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt1' || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  const actual = await derive(value, parts[1], 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(parts[2], 'hex'));
}
