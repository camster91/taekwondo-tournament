import { describe, expect, it, vi } from 'vitest';
import { collectAdminPages, readAdminOperationError } from './admin-operation-error';

describe('readAdminOperationError', () => {
  it('preserves a useful server error message', async () => {
    const response = new Response(JSON.stringify({ error: 'Competitor is assigned to an active bracket' }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    });

    await expect(readAdminOperationError(response, 'Delete failed')).resolves.toBe(
      'Competitor is assigned to an active bracket',
    );
  });

  it('uses the safe fallback for malformed or empty error bodies', async () => {
    const response = new Response('<html>proxy failure</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    });

    await expect(readAdminOperationError(response, 'Export failed')).resolves.toBe('Export failed');
  });
});

describe('collectAdminPages', () => {
  it('collects every declared record across pages', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [{ id: 'a' }], total: 2 })
      .mockResolvedValueOnce({ items: [{ id: 'b' }], total: 2 });

    await expect(collectAdminPages(fetchPage)).resolves.toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 1);
  });

  it('rejects a progressless page before claiming a complete export', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [{ id: 'a' }], total: 2 })
      .mockResolvedValueOnce({ items: [], total: 2 });

    await expect(collectAdminPages(fetchPage)).rejects.toThrow('Export returned incomplete competitor data');
  });
});
