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
  const settingsResponse = await request(`/api/tournaments/${tournamentId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ settings }),
  });
  await requireSuccess(settingsResponse, 'Failed to save tournament settings');
  const savedTournament = await settingsResponse.json();

  // Always send the desired list. An empty list is meaningful: it clears
  // previously persisted classes instead of leaving stale DB rows behind.
  const weightsResponse = await request(`/api/tournaments/${tournamentId}/weight-classes`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ weightClasses: settings.weightClasses }),
  });
  await requireSuccess(weightsResponse, 'Failed to save weight classes');

  return savedTournament;
}
