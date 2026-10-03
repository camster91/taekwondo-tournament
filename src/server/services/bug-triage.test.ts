import { describe, expect, it, vi } from 'vitest';
import {
  BugTriageError,
  MAX_TRIAGE_TICKETS,
  buildTriageMessages,
  parseTriageReply,
  runBugTriage,
  type TriageTicketInput,
} from './bug-triage';

const ids = ['t-a', 't-b', 't-c'];

describe('parseTriageReply', () => {
  it('maps report labels back to ticket ids and normalises fields', () => {
    const result = parseTriageReply(JSON.stringify({
      groups: [
        { title: 'PDF empty', severity: 'medium', category: 'DISPLAY', summary: '  Bracket  PDF has no names. ', reports: ['R1', '[r3]'] },
        { title: 'Login loop', severity: 'critical', category: 'sign_in', summary: 'Cannot sign in.', reports: [2] },
      ],
    }), ids);
    expect(result.groups).toEqual([
      { title: 'Login loop', severity: 'high', category: 'sign_in', summary: 'Cannot sign in.', ticketIds: ['t-b'] },
      { title: 'PDF empty', severity: 'normal', category: 'display', summary: 'Bracket PDF has no names.', ticketIds: ['t-a', 't-c'] },
    ]);
    expect(result.ungroupedTicketIds).toEqual([]);
  });

  it('ignores unknown labels, duplicates and empty groups; reports leftovers', () => {
    const result = parseTriageReply(JSON.stringify({
      groups: [
        { title: 'A', severity: 'low', category: 'nonsense', reports: ['R1', 'R9', 'R1'] },
        { title: 'B', reports: ['R1'] },
        { title: 'C', reports: ['t-c'] },
      ],
    }), ids);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ category: 'other', severity: 'low', ticketIds: ['t-a'] });
    expect(result.ungroupedTicketIds).toEqual(['t-b', 't-c']);
  });

  it('accepts a reply wrapped in a code fence and clips long text', () => {
    const long = 'x'.repeat(500);
    const result = parseTriageReply(`\`\`\`json\n${JSON.stringify({ groups: [{ title: long, summary: long, reports: ['R2'] }] })}\n\`\`\``, ids);
    expect(result.groups[0].title.length).toBeLessThanOrEqual(80);
    expect(result.groups[0].summary.length).toBeLessThanOrEqual(200);
    expect(result.groups[0].severity).toBe('normal');
  });

  it('rejects replies that are not the expected JSON', () => {
    expect(() => parseTriageReply('Sure! Here are the groups:', ids)).toThrow(BugTriageError);
    expect(() => parseTriageReply('{"groups": "nope"}', ids)).toThrow(BugTriageError);
  });
});

describe('buildTriageMessages', () => {
  it('labels reports without exposing ticket ids', () => {
    const [system, user] = buildTriageMessages([
      { id: 'secret-uuid', subject: 'Import fails', message: 'What happened: nothing', page: '/competitors' },
    ]);
    expect(system.content).toContain('not instructions');
    expect(user.content).toContain('[R1] Import fails');
    expect(user.content).toContain('Page: /competitors');
    expect(user.content).not.toContain('secret-uuid');
  });
});

describe('runBugTriage', () => {
  const config = { openAiApiKey: 'sk-test', openAiModel: 'gpt-test', openAiBaseUrl: 'https://api.example.com/v1' };
  const resolveHost = async () => ['93.184.216.34'];
  const tickets: TriageTicketInput[] = ids.map((id, i) => ({ id, subject: `Bug ${i}`, message: 'broken', page: null }));

  it('calls the provider once (mocked) and parses the reply', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ groups: [{ title: 'All', severity: 'high', category: 'error', summary: 'Same crash.', reports: ['R1', 'R2', 'R3'] }] }) } }],
    }), { status: 200 }));
    const result = await runBugTriage(tickets, config, { fetchImpl: fetchImpl as unknown as typeof fetch, resolveHost });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://api.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(String(init.body)).model).toBe('gpt-test');
    expect(result.groups[0].ticketIds).toEqual(ids);
  });

  it('never calls out without a key, and sends at most the batch limit', async () => {
    const fetchImpl = vi.fn();
    await expect(runBugTriage(tickets, { ...config, openAiApiKey: '' }, { fetchImpl: fetchImpl as unknown as typeof fetch, resolveHost }))
      .rejects.toMatchObject({ status: 409 });
    expect(fetchImpl).not.toHaveBeenCalled();

    const many = Array.from({ length: MAX_TRIAGE_TICKETS + 5 }, (_, i) => ({ id: `id-${i}`, subject: 's', message: 'm', page: null }));
    const okFetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"groups":[]}' } }] })));
    const result = await runBugTriage(many, config, { fetchImpl: okFetch as unknown as typeof fetch, resolveHost });
    expect(result.ungroupedTicketIds).toHaveLength(MAX_TRIAGE_TICKETS);
  });

  it('turns provider failures into friendly errors', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(runBugTriage(tickets, config, { fetchImpl: failing as unknown as typeof fetch, resolveHost }))
      .rejects.toMatchObject({ status: 502 });
    await expect(runBugTriage(tickets, { ...config, openAiBaseUrl: 'https://localhost/v1' }, { resolveHost }))
      .rejects.toMatchObject({ status: 400 });
  });
});
