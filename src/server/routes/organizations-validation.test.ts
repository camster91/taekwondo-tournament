import { describe, expect, it } from 'vitest';
import { normalizeOrganizationCreateInput, normalizePlanChangeInput } from './organizations-validation.js';

describe('normalizeOrganizationCreateInput', () => {
  it('normalizes a customer-facing name into a stable URL slug', () => {
    expect(normalizeOrganizationCreateInput({ name: " Cameron's TKD  " })).toEqual({
      ok: true,
      data: { name: "Cameron's TKD", slug: 'camerons-tkd' },
    });
  });

  it('normalizes an explicitly requested slug', () => {
    expect(normalizeOrganizationCreateInput({ name: 'Newton Championship', slug: ' Newton 2026! ' })).toEqual({
      ok: true,
      data: { name: 'Newton Championship', slug: 'newton-2026' },
    });
  });

  it('rejects missing, oversized, or slugless names', () => {
    expect(normalizeOrganizationCreateInput({}).ok).toBe(false);
    expect(normalizeOrganizationCreateInput({ name: 'a'.repeat(101) }).ok).toBe(false);
    expect(normalizeOrganizationCreateInput({ name: '!!!' }).ok).toBe(false);
  });
});

describe('normalizePlanChangeInput', () => {
  it('accepts a supported plan with an audit reason', () => {
    expect(normalizePlanChangeInput({ plan: 'pilot', reason: 'Approved supervised event' })).toEqual({
      ok: true,
      data: { plan: 'pilot', reason: 'Approved supervised event' },
    });
  });

  it('rejects unknown plans and missing audit reasons', () => {
    expect(normalizePlanChangeInput({ plan: 'enterprise', reason: 'Requested' }).ok).toBe(false);
    expect(normalizePlanChangeInput({ plan: 'pilot', reason: ' ' }).ok).toBe(false);
  });
});
