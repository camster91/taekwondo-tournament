type OrganizationCreateResult =
  | { ok: true; data: { name: string; slug: string } }
  | { ok: false; error: string };

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function normalizeOrganizationCreateInput(
  body: Record<string, unknown>,
): OrganizationCreateResult {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 100) {
    return { ok: false, error: 'Organization name must be between 2 and 100 characters.' };
  }
  const sourceSlug = typeof body.slug === 'string' && body.slug.trim() ? body.slug : name;
  const slug = slugify(sourceSlug);
  if (slug.length < 2) {
    return { ok: false, error: 'Organization name must contain letters or numbers.' };
  }
  return { ok: true, data: { name, slug } };
}

type PlanChangeResult =
  | { ok: true; data: { plan: PlanName; reason: string } }
  | { ok: false; error: string };

export function normalizePlanChangeInput(body: Record<string, unknown>): PlanChangeResult {
  const plan = typeof body.plan === 'string' ? body.plan : '';
  if (!(PLAN_NAMES as readonly string[]).includes(plan)) {
    return { ok: false, error: 'Plan must be free, pilot, starter, or pro.' };
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 500) {
    return { ok: false, error: 'A plan-change reason between 5 and 500 characters is required.' };
  }
  return { ok: true, data: { plan: plan as PlanName, reason } };
}
import { PLAN_NAMES, type PlanName } from '../services/entitlements.js';
