import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLog } from './structured-logger.js';

describe('structured-logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('emits a single-line JSON object with the event name and timestamp', () => {
    auditLog({ event: 'test.event', registrationId: 'abcd1234' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]?.[0] as string;
    expect(typeof line).toBe('string');
    expect(line).not.toContain('\n');

    const parsed = JSON.parse(line);
    expect(parsed.event).toBe('test.event');
    expect(parsed.registrationId).toBe('abcd1234');
    expect(parsed.level).toBe('info');
    expect(typeof parsed.ts).toBe('string');
    // ISO 8601 sanity check.
    expect(Number.isFinite(Date.parse(parsed.ts))).toBe(true);
  });

  it('preserves the caller-supplied level when provided', () => {
    auditLog({ event: 'test.warn', level: 'warn', foo: 1 });
    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(parsed.level).toBe('warn');
  });

  it('drops functions from the payload (refuses to serialize credentials)', () => {
    const secret = vi.fn();
    auditLog({ event: 'test.event', secret });

    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(parsed.secret).toBeUndefined();
  });

  it('handles circular references without throwing', () => {
    type Node = { name: string; self?: Node };
    const a: Node = { name: 'a' };
    a.self = a;
    expect(() => auditLog({ event: 'test.cycle', node: a })).not.toThrow();
    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(parsed.node.name).toBe('a');
    expect(parsed.node.self).toBe('[Circular]');
  });

  it('serializes bigints safely', () => {
    auditLog({ event: 'test.big', value: 10n ** 30n });
    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(parsed.value).toBe('1000000000000000000000000000000');
  });

  it('warns and refuses to emit when the event name is missing', () => {
    // Cast to bypass the TS check that would otherwise reject the bad call —
    // we want to verify the runtime safety net.
    auditLog({ event: '' } as unknown as { event: string });
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(warnSpy.mock.calls[0]?.[0] as string);
    expect(parsed.event).toBe('audit_log.missing_event');
  });
});
