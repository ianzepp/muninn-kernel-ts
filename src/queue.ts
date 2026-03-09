export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private readonly resolvers: Array<(result: IteratorResult<T>) => void> = [];
  private readonly drainWaiters: Array<() => void> = [];
  private closed = false;

  get size(): number {
    return this.items.length;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  push(value: T): void {
    if (this.closed) {
      return;
    }

    const resolve = this.resolvers.shift();
    if (resolve !== undefined) {
      resolve({ value, done: false });
      return;
    }

    this.items.push(value);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;

    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift();
      resolve?.({ value: undefined, done: true });
    }

    this.notifyDrained();
  }

  async next(): Promise<IteratorResult<T>> {
    const value = this.items.shift();
    if (value !== undefined) {
      this.notifyDrained();
      return { value, done: false };
    }

    if (this.closed) {
      return { value: undefined, done: true };
    }

    return new Promise<IteratorResult<T>>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  async recv(): Promise<T | undefined> {
    const result = await this.next();
    return result.done ? undefined : result.value;
  }

  async waitForBelow(limit: number, timeoutMs: number): Promise<boolean> {
    if (this.size <= limit || this.closed) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const index = this.drainWaiters.indexOf(check);
        if (index >= 0) {
          this.drainWaiters.splice(index, 1);
        }
        resolve(false);
      }, timeoutMs);

      const check = () => {
        if (this.size <= limit || this.closed) {
          clearTimeout(timer);
          const index = this.drainWaiters.indexOf(check);
          if (index >= 0) {
            this.drainWaiters.splice(index, 1);
          }
          resolve(true);
        }
      };

      this.drainWaiters.push(check);
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next()
    };
  }

  private notifyDrained(): void {
    for (const waiter of [...this.drainWaiters]) {
      waiter();
    }
  }
}
