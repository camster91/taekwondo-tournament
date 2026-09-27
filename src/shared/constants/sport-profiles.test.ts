import { describe, expect, it } from 'vitest';
import {
  SPORT_PROFILES,
  getEventForSlot,
  getEventTypeLabel,
  getEventTypeLabels,
} from './sport-profiles';

describe('event slot labels', () => {
  it('maps the stored slots by position: eventTypes[0] = patterns, eventTypes[1] = sparring', () => {
    for (const profile of SPORT_PROFILES) {
      expect(getEventTypeLabel(profile.slug, 'patterns')).toBe(profile.eventTypes[0]?.name ?? 'Patterns');
      expect(getEventTypeLabel(profile.slug, 'sparring')).toBe(profile.eventTypes[1]?.name ?? 'Sparring');
    }
  });

  it('keeps the slot order even when the first event is a combat event (regression)', () => {
    // Registration stores Judo Randori (eventTypes[0]) in the 'patterns'
    // slot; labelling by isCombat used to swap the two names.
    expect(getEventTypeLabels('judo')).toEqual({ patterns: 'Randori', sparring: 'Kata' });
    expect(getEventTypeLabels('muay-thai')).toEqual({ patterns: 'Sparring', sparring: 'Wai Kru' });
    expect(getEventTypeLabels('kickboxing')).toEqual({ patterns: 'Bout', sparring: 'Forms' });
  });

  it('uses sport-specific names and falls back to Taekwondo for unknown or missing sports', () => {
    expect(getEventTypeLabels('karate')).toEqual({ patterns: 'Kata', sparring: 'Kumite' });
    expect(getEventTypeLabels(undefined)).toEqual({ patterns: 'Patterns', sparring: 'Sparring' });
    expect(getEventTypeLabels(null)).toEqual({ patterns: 'Patterns', sparring: 'Sparring' });
    expect(getEventTypeLabels('curling')).toEqual({ patterns: 'Patterns', sparring: 'Sparring' });
  });

  it('falls back to the generic name for the unused slot of a single-event sport', () => {
    expect(getEventTypeLabels('boxing')).toEqual({ patterns: 'Bout', sparring: 'Sparring' });
    expect(getEventForSlot('boxing', 'sparring')).toBeUndefined();
  });

  it('returns non-slot values unchanged', () => {
    expect(getEventTypeLabel('karate', 'team')).toBe('team');
  });

  it('exposes the slot event so callers can read isCombat', () => {
    expect(getEventForSlot('judo', 'patterns')?.isCombat).toBe(true);
    expect(getEventForSlot('taekwondo', 'patterns')?.isCombat).toBe(false);
    expect(getEventForSlot('taekwondo', 'sparring')?.isCombat).toBe(true);
  });
});
