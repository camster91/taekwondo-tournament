import { describe, expect, it, vi } from 'vitest';
import {
  assertSafeSupportProviderUrl,
  isPrivateNetworkAddress,
  readSupportConfigAuditTrail,
  testSupportProviderConnection,
} from './support-provider.js';

describe('support provider network safety', () => {
  it('rejects local and private provider targets', async () => {
    await expect(assertSafeSupportProviderUrl('http://api.example.com/v1')).rejects.toThrow('HTTPS');
    await expect(assertSafeSupportProviderUrl('https://localhost/v1')).rejects.toThrow('private host');
    await expect(assertSafeSupportProviderUrl('https://provider.example/v1', async () => ['10.2.3.4']))
      .rejects.toThrow('private network');
    expect(isPrivateNetworkAddress('127.0.0.1')).toBe(true);
    expect(isPrivateNetworkAddress('169.254.169.254')).toBe(true);
    expect(isPrivateNetworkAddress('8.8.8.8')).toBe(false);
  });

  it('tests a public HTTPS provider without following redirects', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const result = await testSupportProviderConnection(
      { openAiApiKey: 'secret-test-key', openAiModel: 'test-model', openAiBaseUrl: 'https://provider.example/v1' },
      { fetchImpl, resolveHost: async () => ['203.0.113.10'] },
    );
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('https://provider.example/v1/chat/completions'),
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('returns actionable provider error categories without response bodies', async () => {
    const result = await testSupportProviderConnection(
      { openAiApiKey: 'bad-key', openAiModel: 'test-model', openAiBaseUrl: 'https://provider.example/v1' },
      {
        fetchImpl: vi.fn().mockResolvedValue(new Response('sensitive provider detail', { status: 401 })),
        resolveHost: async () => ['203.0.113.10'],
      },
    );
    expect(result).toEqual({ ok: false, category: 'authentication', message: 'The provider rejected the API key.' });
    expect(result.message).not.toContain('sensitive provider detail');
  });
});

describe('support configuration audit trail', () => {
  it('accepts only bounded, secret-free audit metadata', () => {
    const entries = readSupportConfigAuditTrail([
      {
        id: 'change-1',
        action: 'settings_updated',
        changedFields: ['openAiApiKey'],
        changedByUserId: 'admin-1',
        at: '2026-08-23T00:00:00.000Z',
      },
      { id: 'invalid' },
    ]);
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain('secret');
  });
});
