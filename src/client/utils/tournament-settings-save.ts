type RequestLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function requireSuccess(response: Response, fallback: string): Promise<void> {
  if (response.ok) return;
  const body = await response.json().catch(() => ({})) as { error?: string };
  throw new Error(body.error || fallback);
}

export async function saveTournamentSettingsRequest<T extends { weightClasses: unknown[] }>(
  request: RequestLike,
  tournamentId: string,
  settings: T,
  authHeaders: HeadersInit,
): Promise<unknown> {
  const headers = new Headers(authHeaders);
  headers.set('Content-Type', 'application/json');
  const settingsResponse = await request(`/api/tournaments/${tournamentId}/settings`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ settings, weightClasses: settings.weightClasses }),
  });
  await requireSuccess(settingsResponse, 'Failed to save tournament settings');
  return settingsResponse.json();
}
