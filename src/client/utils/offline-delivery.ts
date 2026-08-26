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
