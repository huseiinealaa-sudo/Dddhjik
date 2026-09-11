import { DEFAULT_SETTINGS } from './Defaults';
import { Store } from './Store';
import type { SimSettings } from './Types';

const STORAGE_KEY = 'fpv-sim.settings.v1';

/** Deep-merge persisted settings over the defaults so new options keep working after an update. */
function mergeSettings(base: SimSettings, patch: unknown): SimSettings {
  if (!patch || typeof patch !== 'object') return base;
  const result: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (!(key in result)) continue;
    const current = result[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      result[key] = mergeSettings(current as SimSettings, value);
    } else if (typeof value === typeof current) {
      result[key] = value;
    }
  }
  return result as unknown as SimSettings;
}

function loadSettings(): SimSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return mergeSettings(DEFAULT_SETTINGS, JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const settingsStore = new Store<SimSettings>(loadSettings());

let persistHandle: number | undefined;

function persist(settings: SimSettings): void {
  if (typeof localStorage === 'undefined') return;
  if (persistHandle !== undefined) clearTimeout(persistHandle);
  persistHandle = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* storage can be unavailable in private mode — the sim still works */
    }
  }, 250) as unknown as number;
}

/** Patch one or more settings, persisting the result. */
export function updateSettings(patch: Partial<SimSettings>): void {
  settingsStore.update((prev) => {
    const next = { ...prev, ...patch };
    persist(next);
    return next;
  });
}

export function resetSettings(): void {
  settingsStore.set(DEFAULT_SETTINGS);
  persist(DEFAULT_SETTINGS);
}

export function getSettings(): SimSettings {
  return settingsStore.getSnapshot();
}
