import { describe, expect, it, vi } from 'vitest';
import { fetchAuthenticatedBlob } from './authenticated-export.js';

describe('authenticated export transport', () => {
  it('returns a non-empty blob with the expected content type', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Blob(['%PDF-test'], { type: 'application/pdf' }), {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    }));
    const blob = await fetchAuthenticatedBlob(fetcher, '/export', 'application/pdf', { Authorization: 'Bearer test' });
    expect(blob.size).toBe(9);
    expect(fetcher).toHaveBeenCalledWith('/export', { headers: { Authorization: 'Bearer test' } });
  });

  it('accepts a valid JSON export', async () => {
    const response = new Response(new Blob(['{"organization":"test"}'], { type: 'application/json' }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
    const blob = await fetchAuthenticatedBlob(vi.fn().mockResolvedValue(response), '/export', 'application/json', {});
    expect(JSON.parse(await blob.text())).toEqual({ organization: 'test' });
  });

  it('accepts a ZIP export', async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    const response = new Response(new Blob([zip]), { status: 200, headers: { 'content-type': 'application/zip' } });
    const blob = await fetchAuthenticatedBlob(vi.fn().mockResolvedValue(response), '/export', 'application/zip', {});
    expect(blob.size).toBe(7);
  });

  it.each([
    [new Response(new Blob(['not a zip']), { status: 200, headers: { 'content-type': 'application/zip' } }), 'application/zip', 'valid ZIP'],
    [new Response('{"error":"Export unavailable"}', { status: 503, headers: { 'content-type': 'application/json' } }), 'application/pdf', 'Export unavailable'],
    [new Response('', { status: 200, headers: { 'content-type': 'application/pdf' } }), 'application/pdf', 'empty'],
    [new Response('<html>proxy</html>', { status: 200, headers: { 'content-type': 'text/html' } }), 'application/pdf', 'unexpected'],
    [new Response(new Blob(['not a pdf'], { type: 'application/pdf' }), { status: 200, headers: { 'content-type': 'application/pdf' } }), 'application/pdf', 'valid PDF'],
    [new Response(new Blob(['not json'], { type: 'application/json' }), { status: 200, headers: { 'content-type': 'application/json' } }), 'application/json', 'valid JSON'],
  ])('rejects an invalid export response', async (response, expectedContentType, message) => {
    await expect(fetchAuthenticatedBlob(vi.fn().mockResolvedValue(response), '/export', expectedContentType, {}))
      .rejects.toThrow(message);
  });
});
