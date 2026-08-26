export interface BulkCheckInResult {
  succeededIds: string[];
  rejected: Array<{ id: string; error: string }>;
  deliveryUncertainIds: string[];
}

export async function runBulkCheckInRequests(
  registrationIds: string[],
  send: (registrationId: string) => Promise<Response>,
): Promise<BulkCheckInResult> {
  const results = await Promise.allSettled(registrationIds.map(async (id) => ({ id, response: await send(id) })));
  const succeededIds: string[] = [];
  const rejected: Array<{ id: string; error: string }> = [];
  const deliveryUncertainIds: string[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result.status === 'fulfilled' && result.value.response.ok) succeededIds.push(result.value.id);
    else if (result.status === 'fulfilled') {
      const body = await result.value.response.json().catch(() => null) as { error?: unknown } | null;
      rejected.push({
        id: registrationIds[index],
        error: typeof body?.error === 'string' && body.error.trim() ? body.error : `Request failed (${result.value.response.status})`,
      });
    }
    else deliveryUncertainIds.push(registrationIds[index]);
  }
  return { succeededIds, rejected, deliveryUncertainIds };
}

export function reconcileBulkCheckInResult(
  result: BulkCheckInResult,
  registrations: Array<{ id: string; checkedIn: boolean }>,
): Pick<BulkCheckInResult, 'rejected' | 'deliveryUncertainIds'> {
  const confirmedIds = new Set(registrations.filter((registration) => registration.checkedIn).map((registration) => registration.id));
  return {
    rejected: result.rejected.filter(({ id }) => !confirmedIds.has(id)),
    deliveryUncertainIds: result.deliveryUncertainIds.filter((id) => !confirmedIds.has(id)),
  };
}
