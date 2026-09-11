import { useSyncExternalStore } from 'react';
import type { Store } from '../core/Store';

/** Subscribe a component to one of the simulator's external stores. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
