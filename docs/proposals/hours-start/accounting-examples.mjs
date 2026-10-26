// Executable PROPOSAL examples only. No runtime imports, IO, SQL, writes or authorization.
// Tenths are exact integers. Policy parameters in tests are fixtures, NOT approval.
export function tenths(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d)?$/.test(raw)) throw new Error('INVALID_HOURS_OR_PRECISION');
  const [whole, fraction = '0'] = raw.split('.');
  return BigInt(whole) * 10n + BigInt(fraction);
}
export function hours(ticks) {
  if (ticks === null) return null;
  const negative = ticks < 0n;
  const n = negative ? -ticks : ticks;
  return `${negative ? '-' : ''}${n / 10n}.${n % 10n}`;
}
export function evaluateCounter({ reference, segments, metric, basis, aircraftId, subjectId, overhaulEpisodeId, coverageKnown = true }) {
  const pending = (code) => ({ value: null, issue: code });
  if (!coverageKnown) return pending('COVERAGE_UNKNOWN');
  const opening = tenths(reference);
  if (opening === null) return pending('REFERENCE_UNKNOWN');
  if (basis === 'DECLARED_ONLY') return pending('NO_COMPATIBLE_USAGE_BASIS');
  if (!['AIRFRAME_TIS','TSN','TSO'].includes(metric) || !['TIS','ENGINE_RUNTIME'].includes(basis) || (metric === 'AIRFRAME_TIS' && basis !== 'TIS')) return pending('INCOMPATIBLE_BASIS');
  if (metric === 'TSO' && !overhaulEpisodeId) return pending('OVERHAUL_EPISODE_MISMATCH');
  const seen = new Set();
  let total = opening;
  for (const segment of segments) {
    if (segment.aircraftId !== aircraftId || segment.subjectId !== subjectId) return pending('SCOPE_MISMATCH');
    if (segment.basis !== basis) return pending('INCOMPATIBLE_BASIS');
    if (segment.datePrecision !== 'DATE' || !segment.applicable) return pending('AMBIGUOUS_PERIOD');
    if (!segment.current || segment.status !== 'ACTIVE') return pending('STALE_INPUT');
    if (metric === 'TSO' && (!overhaulEpisodeId || segment.overhaulEpisodeId !== overhaulEpisodeId)) return pending('OVERHAUL_EPISODE_MISMATCH');
    const identity = `${segment.flightRevisionId}:${segment.installationId}:${basis}`;
    if (seen.has(identity)) return pending('DUPLICATE_ATTRIBUTION');
    seen.add(identity);
    const delta = tenths(segment.hours);
    if (delta === null) return pending('USAGE_UNKNOWN');
    total += delta;
  }
  return { value: hours(total), issue: null };
}
export function reviewImportRows(rows, { aircraftId, accountedIdentities = new Set() }) {
  const seen = new Set();
  return rows.map((row) => {
    if (row.aircraftId !== aircraftId) return { ...row, disposition: 'REQUIRES_REVIEW', issue: 'SCOPE_MISMATCH' };
    // identity must be an independently verified external/canonical identity, not date/name similarity.
    if (row.verifiedIdentity && accountedIdentities.has(row.verifiedIdentity)) return { ...row, disposition: 'EXCLUDE_VERIFIED_DUPLICATE', issue: null };
    if (row.verifiedIdentity && seen.has(row.verifiedIdentity)) return { ...row, disposition: 'REQUIRES_REVIEW', issue: 'DUPLICATE_IN_FILE' };
    if (row.verifiedIdentity) seen.add(row.verifiedIdentity);
    if (row.datePrecision !== 'DATE') return { ...row, disposition: 'REQUIRES_REVIEW', issue: 'INCOMPLETE_DATE' };
    if (row.possibleDuplicate) return { ...row, disposition: 'REQUIRES_REVIEW', issue: 'POSSIBLE_DUPLICATE' };
    return { ...row, disposition: 'INCLUDE', issue: null };
  });
}
export function assessAcceptance({ derived, observed, policy, issues = [], explicitlyReviewed = false, discrepancyAcknowledged = false }) {
  const a = tenths(derived), b = tenths(observed);
  if (a === null || b === null) return { confirmable: false, difference: null, issue: 'UNKNOWN_REFERENCE_OR_TOTAL' };
  const difference = a - b;
  if (!policy?.approvalReference || !policy.version || policy.toleranceHours === undefined || policy.toleranceHours === null) {
    return { confirmable: false, difference: hours(difference), issue: 'POLICY_NOT_APPROVED' };
  }
  if (issues.length) return { confirmable: false, difference: hours(difference), issue: 'UNRESOLVED_ISSUES' };
  const tolerance = tenths(policy.toleranceHours);
  if ((difference < 0n ? -difference : difference) > tolerance) return { confirmable: false, difference: hours(difference), issue: 'DISCREPANCY' };
  if (!explicitlyReviewed) return { confirmable: false, difference: hours(difference), issue: 'EXPLICIT_REVIEW_REQUIRED' };
  if (difference !== 0n && !discrepancyAcknowledged) return { confirmable: false, difference: hours(difference), issue: 'DISCREPANCY_ACK_REQUIRED' };
  return { confirmable: true, difference: hours(difference), issue: null };
}
export function acceptanceIsCurrent(snapshot, current) {
  const hashes = ['installationHash','referenceHash','mappingHash','episodeHash','adjustmentHash','sourceHash','algorithmVersion','policyVersion'];
  if (!Array.isArray(snapshot.revisionStatusPairs) || !Array.isArray(current.revisionStatusPairs)
    || hashes.some((key) => typeof snapshot[key] !== 'string' || !snapshot[key] || snapshot[key] !== current[key])) return false;
  const ordered = (items) => JSON.stringify([...items].sort());
  return snapshot.aircraftId === current.aircraftId && ordered(snapshot.revisionStatusPairs) === ordered(current.revisionStatusPairs);
}
export function proposeSuccessor({ aircraftId, head, predecessorId, sequence, runId }) {
  if (!head && (sequence !== 1 || predecessorId !== null)) throw new Error('INVALID_FIRST_ACCEPTANCE');
  if (head && (head.aircraftId !== aircraftId || predecessorId !== head.id || sequence !== head.sequence + 1)) throw new Error('STALE_OR_CROSS_AIRCRAFT_HEAD');
  return { aircraftId, predecessorId, sequence, runId };
}
export function confirmationReplay(existing, request) {
  if (!existing) return 'CREATE_ONCE_IN_TRANSACTION';
  if (existing.aircraftId !== request.aircraftId || existing.actorId !== request.actorId
    || existing.runId !== request.runId || existing.payloadHash !== request.payloadHash) throw new Error('IDEMPOTENCY_CONFLICT');
  return existing.result;
}
