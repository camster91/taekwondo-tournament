export function buildResolvedScoreboardPath(tournamentId: string, publicKey: string): string {
  return `/display/${encodeURIComponent(tournamentId)}?key=${encodeURIComponent(publicKey)}`;
}

export function buildScoreboardApiUrl(tournamentId: string, publicKey: string | null): string {
  const base = `/api/public/tournaments/${encodeURIComponent(tournamentId)}/scoreboard`;
  return publicKey ? `${base}?key=${encodeURIComponent(publicKey)}` : base;
}
