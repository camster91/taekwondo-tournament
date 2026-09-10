import { describe, it, expect } from 'vitest';
import {
  getSearchParam,
  getBooleanSearchParam,
  getIntSearchParam,
  getArraySearchParam,
  updateSearchParams,
  parseCheckInFilters,
  serializeCheckInFilters,
  parseDivisionFilters,
  serializeDivisionFilters,
  parseTournamentListFilters,
  serializeTournamentListFilters,
  parseDirectorDashboardFilters,
  serializeDirectorDashboardFilters,
  parseScorekeeperFilters,
  serializeScorekeeperFilters,
} from './url-state';

describe('url-state utilities', () => {
  describe('getSearchParam', () => {
    it('returns value when present', () => {
      const params = new URLSearchParams('foo=bar&baz=qux');
      expect(getSearchParam(params, 'foo')).toBe('bar');
      expect(getSearchParam(params, 'baz')).toBe('qux');
    });

    it('returns null when not present', () => {
      const params = new URLSearchParams('foo=bar');
      expect(getSearchParam(params, 'missing')).toBeNull();
    });
  });

  describe('getBooleanSearchParam', () => {
    it('returns true when param is present without value', () => {
      const params = new URLSearchParams('flag');
      expect(getBooleanSearchParam(params, 'flag')).toBe(true);
    });

    it('returns true when param is "true"', () => {
      const params = new URLSearchParams('flag=true');
      expect(getBooleanSearchParam(params, 'flag')).toBe(true);
    });

    it('returns false when param is "false"', () => {
      const params = new URLSearchParams('flag=false');
      expect(getBooleanSearchParam(params, 'flag')).toBe(false);
    });

    it('returns false when param is not present', () => {
      const params = new URLSearchParams('other=value');
      expect(getBooleanSearchParam(params, 'flag')).toBe(false);
    });
  });

  describe('getIntSearchParam', () => {
    it('returns parsed integer when valid', () => {
      const params = new URLSearchParams('count=42');
      expect(getIntSearchParam(params, 'count')).toBe(42);
    });

    it('returns default value when not present', () => {
      const params = new URLSearchParams('other=value');
      expect(getIntSearchParam(params, 'count', 10)).toBe(10);
    });

    it('returns default value when invalid', () => {
      const params = new URLSearchParams('count=invalid');
      expect(getIntSearchParam(params, 'count', 10)).toBe(10);
    });

    it('returns undefined when not present and no default', () => {
      const params = new URLSearchParams('other=value');
      expect(getIntSearchParam(params, 'count')).toBeUndefined();
    });
  });

  describe('getArraySearchParam', () => {
    it('returns array from comma-separated values', () => {
      const params = new URLSearchParams('tags=foo,bar,baz');
      expect(getArraySearchParam(params, 'tags')).toEqual(['foo', 'bar', 'baz']);
    });

    it('returns empty array when not present', () => {
      const params = new URLSearchParams('other=value');
      expect(getArraySearchParam(params, 'tags')).toEqual([]);
    });

    it('filters empty strings from array', () => {
      const params = new URLSearchParams('tags=foo,,bar');
      expect(getArraySearchParam(params, 'tags')).toEqual(['foo', 'bar']);
    });
  });

  describe('updateSearchParams', () => {
    it('adds new params', () => {
      const params = new URLSearchParams('existing=value');
      const updated = updateSearchParams(params, { new: 'param' });
      expect(updated.get('existing')).toBe('value');
      expect(updated.get('new')).toBe('param');
    });

    it('updates existing params', () => {
      const params = new URLSearchParams('existing=old');
      const updated = updateSearchParams(params, { existing: 'new' });
      expect(updated.get('existing')).toBe('new');
    });

    it('deletes params with null value', () => {
      const params = new URLSearchParams('keep=yes&remove=no');
      const updated = updateSearchParams(params, { remove: null });
      expect(updated.has('remove')).toBe(false);
      expect(updated.get('keep')).toBe('yes');
    });

    it('deletes params with undefined value', () => {
      const params = new URLSearchParams('keep=yes&remove=no');
      const updated = updateSearchParams(params, { remove: undefined });
      expect(updated.has('remove')).toBe(false);
    });

    it('deletes params with empty string value', () => {
      const params = new URLSearchParams('keep=yes&remove=no');
      const updated = updateSearchParams(params, { remove: '' });
      expect(updated.has('remove')).toBe(false);
    });

    it('handles array values', () => {
      const params = new URLSearchParams();
      const updated = updateSearchParams(params, { tags: ['foo', 'bar'] });
      expect(updated.get('tags')).toBe('foo,bar');
    });

    it('deletes params with empty array', () => {
      const params = new URLSearchParams('tags=foo,bar');
      const updated = updateSearchParams(params, { tags: [] });
      expect(updated.has('tags')).toBe(false);
    });

    it('handles boolean values', () => {
      const params = new URLSearchParams();
      const updated = updateSearchParams(params, { flag: true, other: false });
      expect(updated.get('flag')).toBe('true');
      expect(updated.get('other')).toBe('false');
    });

    it('handles number values', () => {
      const params = new URLSearchParams();
      const updated = updateSearchParams(params, { count: 42 });
      expect(updated.get('count')).toBe('42');
    });
  });

  describe('check-in filters', () => {
    it('parses check-in filters from URL params', () => {
      const params = new URLSearchParams('search=john&showCheckedIn=true&eventFilter=sparring');
      const filters = parseCheckInFilters(params);
      expect(filters).toEqual({
        search: 'john',
        showCheckedIn: true,
        showUnchecked: false,
        eventFilter: 'sparring',
      });
    });

    it('uses defaults for missing params', () => {
      const params = new URLSearchParams();
      const filters = parseCheckInFilters(params);
      expect(filters).toEqual({
        showCheckedIn: false,
        showUnchecked: false,
        eventFilter: 'all',
      });
    });

    it('serializes check-in filters to URL params', () => {
      const filters = {
        search: 'jane',
        showCheckedIn: true,
        showUnchecked: false,
        eventFilter: 'patterns' as const,
      };
      const serialized = serializeCheckInFilters(filters);
      expect(serialized).toEqual({
        search: 'jane',
        showCheckedIn: 'true',
        showUnchecked: null,
        eventFilter: 'patterns',
      });
    });

    it('omits default values in serialization', () => {
      const filters = {
        eventFilter: 'all' as const,
      };
      const serialized = serializeCheckInFilters(filters);
      expect(serialized.eventFilter).toBeNull();
    });
  });

  describe('division filters', () => {
    it('parses division filters from URL params', () => {
      const params = new URLSearchParams('eventType=sparring&gender=male&beltLevel=BB&search=black');
      const filters = parseDivisionFilters(params);
      expect(filters).toEqual({
        eventType: 'sparring',
        gender: 'male',
        beltLevel: 'BB',
        search: 'black',
      });
    });

    it('uses defaults for missing params', () => {
      const params = new URLSearchParams();
      const filters = parseDivisionFilters(params);
      expect(filters).toEqual({
        eventType: 'all',
        gender: 'all',
      });
    });

    it('serializes division filters to URL params', () => {
      const filters = {
        eventType: 'patterns' as const,
        gender: 'female' as const,
        beltLevel: 'CB',
        search: 'yellow',
      };
      const serialized = serializeDivisionFilters(filters);
      expect(serialized).toEqual({
        eventType: 'patterns',
        gender: 'female',
        beltLevel: 'CB',
        search: 'yellow',
      });
    });
  });

  describe('tournament list filters', () => {
    it('parses tournament list filters from URL params', () => {
      const params = new URLSearchParams('status=in_progress&search=spring&trash=true');
      const filters = parseTournamentListFilters(params);
      expect(filters).toEqual({
        status: 'in_progress',
        search: 'spring',
        trash: true,
      });
    });

    it('uses defaults for missing params', () => {
      const params = new URLSearchParams();
      const filters = parseTournamentListFilters(params);
      expect(filters).toEqual({
        status: 'all',
        trash: false,
      });
    });

    it('serializes tournament list filters to URL params', () => {
      const filters = {
        status: 'completed' as const,
        search: 'championship',
        trash: false,
      };
      const serialized = serializeTournamentListFilters(filters);
      expect(serialized).toEqual({
        status: 'completed',
        search: 'championship',
        trash: null,
      });
    });
  });

  describe('director dashboard filters', () => {
    it('parses director dashboard filters from URL params', () => {
      const params = new URLSearchParams('ring=Ring 1&alertsOnly=true');
      const filters = parseDirectorDashboardFilters(params);
      expect(filters).toEqual({
        ring: 'Ring 1',
        alertsOnly: true,
      });
    });

    it('uses defaults for missing params', () => {
      const params = new URLSearchParams();
      const filters = parseDirectorDashboardFilters(params);
      expect(filters).toEqual({
        alertsOnly: false,
      });
    });

    it('serializes director dashboard filters to URL params', () => {
      const filters = {
        ring: 'Ring 2',
        alertsOnly: true,
      };
      const serialized = serializeDirectorDashboardFilters(filters);
      expect(serialized).toEqual({
        ring: 'Ring 2',
        alertsOnly: 'true',
      });
    });
  });

  describe('scorekeeper filters', () => {
    it('parses scorekeeper filters from URL params', () => {
      const params = new URLSearchParams('ring=Ring 3&division=div-123');
      const filters = parseScorekeeperFilters(params);
      expect(filters).toEqual({
        ring: 'Ring 3',
        division: 'div-123',
      });
    });

    it('uses defaults for missing params', () => {
      const params = new URLSearchParams();
      const filters = parseScorekeeperFilters(params);
      expect(filters).toEqual({});
    });

    it('serializes scorekeeper filters to URL params', () => {
      const filters = {
        ring: 'Ring 1',
        division: 'div-456',
      };
      const serialized = serializeScorekeeperFilters(filters);
      expect(serialized).toEqual({
        ring: 'Ring 1',
        division: 'div-456',
      });
    });
  });
});
