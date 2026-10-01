export function shouldQueueOfflineMutation({
  isOfflineSession,
  navigatorOnline,
}: {
  isOfflineSession: boolean;
  navigatorOnline: boolean;
}): boolean {
  return isOfflineSession || !navigatorOnline;
}

export function buildCheckInRequestPayload(weight?: number): {
  checkedIn: true;
  checkInWeight?: number;
} {
  return weight === undefined ? { checkedIn: true } : { checkedIn: true, checkInWeight: weight };
}

/** Undo a check-in: clears the server-stamped time and the weigh-in. */
export function buildUndoCheckInRequestPayload(): { checkedIn: false; checkInWeight: null } {
  return { checkedIn: false, checkInWeight: null };
}

/**
 * User-facing message for a failed check-in request. A TypeError from
 * fetch means the venue connection failed; anything else carries the
 * server's own explanation (validation, permissions, conflicts).
 */
export function describeCheckInFailure(error: unknown, connectionMessage: string): string {
  if (error instanceof TypeError) return connectionMessage;
  if (error instanceof Error && error.message.trim()) return error.message;
  return connectionMessage;
}
