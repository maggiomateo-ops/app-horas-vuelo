// Offline contract examples only. Not imported by runtime; no storage or authorization.
const SCALE = 1000000n;
const UNITS = { HOURS: 3600n, MINUTES: 60n, SECONDS: 1n };
export function observation(raw, unit, resolution = null) {
  if (raw === null) return { raw, unit, resolution, micros: null };
  if (typeof raw !== 'string' || raw.length > 40) throw new Error('INVALID_SOURCE');
  let micros;
  if (unit === 'HH_MM') {
    const m = /^(\d{1,12}):([0-5]\d)$/.exec(raw);
    if (!m) throw new Error('INVALID_HH_MM');
    micros = (BigInt(m[1]) * 3600n + BigInt(m[2]) * 60n) * SCALE;
  } else {
    if (!UNITS[unit] || !/^\d{1,12}(?:\.\d{1,6})?$/.test(raw)) throw new Error('UNSUPPORTED_PRECISION_OR_UNIT');
    const [whole, fraction = ''] = raw.split('.');
    micros = (BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'))) * UNITS[unit];
  }
  return { raw, unit, resolution, micros };
}
export function canonicalFlightTenths(source) {
  if (source.micros === null) return null;
  // D-024/D-098: HALF_UP per record, never binary float or rounding the sum.
  const tenth = 360n * SCALE;
  return (source.micros + tenth / 2n) / tenth;
}
export function compareEvidence(a, b, { basisA, basisB, coverageKnown = true, roundingEvidence = false } = {}) {
  if (!basisA || basisA !== basisB || basisA === 'DECLARED_ONLY') return { cause: 'INCOMPATIBLE_BASIS', differenceMicros: null };
  if (!coverageKnown || a.micros === null || b.micros === null) return { cause: 'INSUFFICIENT_EVIDENCE', differenceMicros: null };
  const differenceMicros = a.micros - b.micros;
  return { cause: differenceMicros === 0n ? 'EXACT_EQUIVALENCE' : roundingEvidence ? 'DOCUMENTED_ROUNDING' : 'REAL_DIFFERENCE', differenceMicros };
}
export function exactAcceptance(comparison, { approvalReference, reviewed = false, unresolved = [] } = {}) {
  return Boolean(approvalReference && reviewed && !unresolved.length && comparison.cause === 'EXACT_EQUIVALENCE' && comparison.differenceMicros === 0n);
}
export function sumUniqueUsage(rows) {
  let total = 0n;
  const seen = new Set();
  for (const row of rows) {
    // Identity verified against canonical lineage, not inferred from timestamp/name.
    if (!row.identity || seen.has(row.identity)) throw new Error('DUPLICATE_OR_UNVERIFIED_USAGE');
    seen.add(row.identity);
    if (row.micros === null) return null;
    total += row.micros;
  }
  return total;
}
export function checkXlsxEnvelope({ bytes, sheets, rows, cells, expandedBytes, entries }) {
  return Number.isSafeInteger(bytes) && bytes > 0 && bytes <= 10 * 1024 * 1024
    && Number.isSafeInteger(sheets) && sheets > 0 && sheets <= 20
    && Number.isSafeInteger(rows) && rows >= 0 && rows <= 10000
    && Number.isSafeInteger(cells) && cells >= 0 && cells <= 200000
    && Number.isSafeInteger(expandedBytes) && expandedBytes >= 0 && expandedBytes <= 100 * 1024 * 1024
    && Number.isSafeInteger(entries) && entries > 0 && entries <= 2000;
}
