/**
 * Minimal observable store designed for React's `useSyncExternalStore`.
 *
 * The simulator runs outside of React and pushes snapshots into these stores;
 * React only re-renders when a new immutable snapshot is published, which keeps
 * the render loop completely independent from the 60 fps draw loop.
 */
export class Store<T> {
  private state: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.state = initial;
    this.subscribe = this.subscribe.bind(this);
    this.getSnapshot = this.getSnapshot.bind(this);
  }

  getSnapshot(): T {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  set(next: T): void {
    if (Object.is(next, this.state)) return;
    this.state = next;
    this.emit();
  }

  update(updater: (previous: T) => T): void {
    this.set(updater(this.state));
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
