import type { GhostData } from './ghost';

export interface TrackRecord {
  bestLap: number | null;
  bestRace: number | null;
  /** Split times (from lap start) at each gate of the best lap. */
  bestSplits: number[];
  ghost: GhostData | null;
  date: number;
}

const KEY = 'fpv-sim.records.v2';

type RecordTable = Record<string, TrackRecord>;

function read(): RecordTable {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RecordTable) : {};
  } catch {
    return {};
  }
}

function write(table: RecordTable): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(table));
  } catch {
    // Quota exceeded: drop the ghosts (the heavy part) and keep the times.
    try {
      const slim: RecordTable = {};
      for (const [k, v] of Object.entries(table)) slim[k] = { ...v, ghost: null };
      localStorage.setItem(KEY, JSON.stringify(slim));
    } catch {
      /* storage unavailable */
    }
  }
}

export const recordKey = (trackId: string, quadId: string): string => `${trackId}:${quadId}`;

export function getRecord(trackId: string, quadId: string): TrackRecord | null {
  return read()[recordKey(trackId, quadId)] ?? null;
}

export function saveRecord(trackId: string, quadId: string, rec: TrackRecord): void {
  const table = read();
  table[recordKey(trackId, quadId)] = rec;
  write(table);
}

export function clearRecords(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
