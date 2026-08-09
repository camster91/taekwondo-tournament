export type OperationalQueryIntent =
  | { kind: 'blocked_divisions' }
  | { kind: 'next_competitors'; windowMinutes: number }
  | { kind: 'ring_delay'; ring: number }
  | { kind: 'schools_need_checkin' }
  | { kind: 'unsupported' };

export interface OperationalQueryAnswer {
  answer: string;
  generatedAt: string;
  evidence: Array<{ label: string; href: string; observedAt: string }>;
}

const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * This intentionally recognizes a small, read-only vocabulary. It is not an
 * LLM prompt or a command parser: anything outside these questions is refused
 * so an operational query can never be mistaken for a mutation request.
 */
export function parseOperationalQuery(question: string): OperationalQueryIntent {
  const value = normalized(question);
  if (!value) return { kind: 'unsupported' };
  if (/\bdivisions?\b/.test(value) && /\bblocked?\b/.test(value)) return { kind: 'blocked_divisions' };
  if (/\bschools?\b/.test(value) && /\bcheck\s*-?in\b/.test(value)) return { kind: 'schools_need_checkin' };

  const next = value.match(/\bnext\s+(\d{1,3})\s+minutes?\b/);
  if (/\b(?:who|which athletes?|competitors?)\b/.test(value) && next) {
    const windowMinutes = Number(next[1]);
    if (Number.isInteger(windowMinutes) && windowMinutes >= 1 && windowMinutes <= 240) return { kind: 'next_competitors', windowMinutes };
  }

  const ring = value.match(/\bring\s+(\d{1,2})\b/);
  if (ring && /\b(?:late|behind|delay(?:ed)?)\b/.test(value)) {
    const ringNumber = Number(ring[1]);
    if (Number.isInteger(ringNumber) && ringNumber >= 1) return { kind: 'ring_delay', ring: ringNumber };
  }
  return { kind: 'unsupported' };
}

export function buildUnsupportedOperationalAnswer(now = new Date()): OperationalQueryAnswer {
  return {
    answer: 'I can answer: which divisions are blocked, who competes in the next number of minutes, why a ring is late, or which schools need check-in.',
    generatedAt: now.toISOString(),
    evidence: [],
  };
}
