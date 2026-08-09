export async function readAdminOperationError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    return typeof body.error === 'string' && body.error.trim() ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export async function collectAdminPages<T>(
  fetchPage: (offset: number) => Promise<{ items: T[]; total: number }>,
): Promise<T[]> {
  const items: T[] = [];
  let total = Number.POSITIVE_INFINITY;
  while (items.length < total) {
    const page = await fetchPage(items.length);
    if (!Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0) {
      throw new Error('Export returned invalid competitor data');
    }
    total = page.total;
    if (page.items.length === 0 && items.length < total) {
      throw new Error('Export returned incomplete competitor data');
    }
    items.push(...page.items);
  }
  return items;
}
