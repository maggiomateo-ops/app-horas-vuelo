// Offline executable policy examples, not wired to APIs, clocks, SQL or storage.
export function visibleStaging(batch, { owner, aircraftId, now }) {
  return owner === true && batch.aircraftId === aircraftId &&
    (batch.state === 'CONFIRMED' || (batch.state === 'OPEN' && now < batch.stageExpiresAt));
}
export function purgeDecision(batch, { now, hasConfirmation = false }) {
  if (batch.state === 'CONFIRMED' || hasConfirmation) return 'DENY_ACCEPTED';
  if (batch.state === 'PURGED') return 'ALREADY_PURGED';
  return batch.cancelledAt !== null || now >= batch.stageExpiresAt ? 'PURGE_TEMPORARY_GRAPH' : 'DENY_LIVE';
}
export function cleanupClaim(batch, { now, token }) {
  if (batch.rawDeletedAt !== null) return null;
  if (batch.rawExpiresAt > now && !['CANCELLED','EXPIRED','PURGED','CONFIRMED'].includes(batch.state)) return null;
  if (batch.leaseUntil > now || batch.retryAt > now) return null;
  if (!token) throw new Error('TOKEN_REQUIRED');
  return { ...batch, token, leaseUntil: now + 120000, attempts: batch.attempts + 1 };
}
export function cleanupFinish(batch, { now, token, verifiedAbsent }) {
  if (batch.rawDeletedAt !== null) return batch;
  if (!token || batch.token !== token || batch.leaseUntil <= now) throw new Error('STALE_LEASE');
  return { ...batch, token: null, leaseUntil: null, retryAt: verifiedAbsent ? null : now + 300000,
    rawDeletedAt: verifiedAbsent ? now : null, storageKey: verifiedAbsent ? null : batch.storageKey };
}
export function fencedMutation({ actualGeneration, expectedGeneration, snapshotGeneration }) {
  if (snapshotGeneration !== actualGeneration) throw new Error('40001');
  if (expectedGeneration !== null && expectedGeneration !== actualGeneration) throw new Error('STALE_PREVIEW');
  return actualGeneration + 1;
}
export function confirmationGeneration(runGeneration, fencedGeneration) {
  return Number.isSafeInteger(runGeneration) && Number.isSafeInteger(fencedGeneration)
    && runGeneration >= 0 && runGeneration === fencedGeneration - 1;
}
