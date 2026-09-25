/**
 * A minimal external store for React's useSyncExternalStore. The game loop
 * mutates plain objects at 1 kHz; the UI is notified at a much lower rate by
 * whoever calls `publish`.
 */
export class Store<T> {
  private listeners = new Set<() => void>();
  private snapshot: T;

  constructor(initial: T) {
    this.snapshot = initial;
  }

  get = (): T => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(next: T): void {
    if (Object.is(next, this.snapshot)) return;
    this.snapshot = next;
    for (const l of this.listeners) l();
  }

  update(patch: Partial<T>): void {
    this.set({ ...this.snapshot, ...patch });
  }
}
