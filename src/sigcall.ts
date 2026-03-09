import type { Frame } from "muninn-frames-ts";

import { PipeEnd } from "./pipe.js";
import { AsyncQueue } from "./queue.js";
import { SigcallError } from "./errors.js";
import type { Kernel } from "./kernel.js";

interface Registration {
  owner: string;
  queue: AsyncQueue<Frame>;
}

export class SigcallRegistry {
  private readonly registrations = new Map<string, Registration>();

  constructor(private readonly kernel: Kernel) {}

  register(name: string, owner: string): PipeEnd {
    if (name.startsWith("sigcall:")) {
      throw SigcallError.reserved(name);
    }

    const existing = this.registrations.get(name);
    if (existing !== undefined && existing.owner !== owner) {
      throw SigcallError.alreadyRegistered(name, existing.owner);
    }

    const queue = new AsyncQueue<Frame>();
    this.registrations.set(name, { owner, queue });
    return new PipeEnd(this.kernel, queue);
  }

  unregister(name: string, owner: string): void {
    const existing = this.registrations.get(name);
    if (existing === undefined) {
      throw SigcallError.notRegistered(name);
    }

    if (existing.owner !== owner) {
      throw SigcallError.notOwner(name, existing.owner, owner);
    }

    existing.queue.close();
    this.registrations.delete(name);
  }

  unregisterAll(owner: string): void {
    for (const [name, registration] of this.registrations) {
      if (registration.owner === owner) {
        registration.queue.close();
        this.registrations.delete(name);
      }
    }
  }

  lookup(name: string): AsyncQueue<Frame> | undefined {
    return this.registrations.get(name)?.queue;
  }

  list(): Array<{ name: string; owner: string }> {
    return [...this.registrations.entries()].map(([name, registration]) => ({
      name,
      owner: registration.owner
    }));
  }

  len(): number {
    return this.registrations.size;
  }

  isEmpty(): boolean {
    return this.registrations.size === 0;
  }
}
