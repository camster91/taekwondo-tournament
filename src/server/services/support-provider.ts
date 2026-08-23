import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface SupportProviderConfig {
  openAiApiKey: string;
  openAiModel: string;
  openAiBaseUrl: string;
}

export interface SupportConfigAuditEntry {
  id: string;
  action: 'settings_updated';
  changedFields: string[];
  changedByUserId: string;
  at: string;
}

export type SupportConnectionResult =
  | { ok: true; category: 'connected'; message: string }
  | {
      ok: false;
      category: 'configuration' | 'authentication' | 'model' | 'rate_limit' | 'timeout' | 'network' | 'provider';
      message: string;
    };

type HostResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((result) => result.address);
};

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateNetworkAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  const version = isIP(normalized);
  if (version === 4) return isPrivateIpv4(normalized);
  if (version !== 6) return true;
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
}

export async function assertSafeSupportProviderUrl(
  baseUrl: string,
  resolveHost: HostResolver = defaultResolver,
): Promise<URL> {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:') throw new Error('Provider base URL must use HTTPS.');
  if (url.username || url.password) throw new Error('Provider base URL cannot contain credentials.');

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Provider base URL cannot target a private host.');
  }

  const literalVersion = isIP(hostname);
  const addresses = literalVersion ? [hostname] : await resolveHost(hostname);
  if (!addresses.length || addresses.some(isPrivateNetworkAddress)) {
    throw new Error('Provider base URL cannot resolve to a private network.');
  }
  return url;
}

export async function testSupportProviderConnection(
  config: SupportProviderConfig,
  dependencies: { fetchImpl?: typeof fetch; resolveHost?: HostResolver; timeoutMs?: number } = {},
): Promise<SupportConnectionResult> {
  if (!config.openAiApiKey) {
    return { ok: false, category: 'configuration', message: 'Add an API key before testing the connection.' };
  }

  let baseUrl: URL;
  try {
    baseUrl = await assertSafeSupportProviderUrl(config.openAiBaseUrl, dependencies.resolveHost);
  } catch (error) {
    return {
      ok: false,
      category: 'configuration',
      message: error instanceof Error ? error.message : 'Provider URL is invalid.',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 12_000);
  try {
    const endpoint = new URL(`${baseUrl.pathname.replace(/\/$/, '')}/chat/completions`, baseUrl.origin);
    const response = await (dependencies.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openAiApiKey}`,
      },
      body: JSON.stringify({
        model: config.openAiModel,
        max_tokens: 8,
        temperature: 0,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      }),
    });

    if (response.ok) return { ok: true, category: 'connected', message: 'Provider connection succeeded.' };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, category: 'authentication', message: 'The provider rejected the API key.' };
    }
    if (response.status === 404) {
      return { ok: false, category: 'model', message: 'The provider endpoint or model was not found.' };
    }
    if (response.status === 429) {
      return { ok: false, category: 'rate_limit', message: 'The provider rate limit or quota was reached.' };
    }
    return { ok: false, category: 'provider', message: `The provider returned HTTP ${response.status}.` };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, category: 'timeout', message: 'The provider connection timed out.' };
    }
    return { ok: false, category: 'network', message: 'The provider could not be reached securely.' };
  } finally {
    clearTimeout(timeout);
  }
}

export function readSupportConfigAuditTrail(value: unknown): SupportConfigAuditEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      record.action !== 'settings_updated' ||
      !Array.isArray(record.changedFields) ||
      !record.changedFields.every((field) => typeof field === 'string') ||
      typeof record.changedByUserId !== 'string' ||
      typeof record.at !== 'string'
    ) return [];
    return [record as unknown as SupportConfigAuditEntry];
  }).slice(0, 25);
}
