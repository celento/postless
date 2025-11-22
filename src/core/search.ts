import type {RequestRecord} from './types.js';

function score(value: string, query: string): number {
  const haystack = value.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (!needle) return 0;
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return direct + (haystack.length - needle.length) * 0.01;
  let at = 0;
  let gaps = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, at);
    if (found < 0) return Number.POSITIVE_INFINITY;
    gaps += found - at;
    at = found + 1;
  }
  return 100 + gaps;
}

export function fuzzySearch(records: RequestRecord[], query: string): RequestRecord[] {
  if (!query.trim()) return records;
  return records.map((record) => ({
    record,
    score: Math.min(score(`${record.folder}/${record.name}`, query), score(record.request?.url ?? '', query)),
  })).filter(({score}) => Number.isFinite(score)).sort((a, b) => a.score - b.score).map(({record}) => record);
}
