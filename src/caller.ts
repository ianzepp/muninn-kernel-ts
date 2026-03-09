import type { Frame } from "muninn-frames-ts";
import { isTerminalStatus } from "muninn-frames-ts";

import { AsyncQueue } from "./queue.js";
import { responseFrom } from "./frame.js";
import type { Kernel } from "./kernel.js";

export interface CallOptions {
  signal?: AbortSignal;
}

export class CallStream implements AsyncIterable<Frame> {
  private closed = false;
  private readonly cleanupCallbacks = new Set<() => void>();

  constructor(
    readonly request: Frame,
    private readonly queue: AsyncQueue<Frame>,
    private readonly closeHandler: () => void
  ) {}

  next(): Promise<IteratorResult<Frame>> {
    return this.queue.next();
  }

  recv(): Promise<Frame | undefined> {
    return this.queue.recv();
  }

  async collect(): Promise<Frame[]> {
    const frames: Frame[] = [];
    for await (const frame of this) {
      frames.push(frame);
      if (isTerminalStatus(frame.status)) {
        break;
      }
    }
    return frames;
  }

  onClose(callback: () => void): void {
    if (this.closed) {
      callback();
      return;
    }

    this.cleanupCallbacks.add(callback);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.queue.close();
    this.closeHandler();

    for (const callback of this.cleanupCallbacks) {
      callback();
    }
    this.cleanupCallbacks.clear();
  }

  [Symbol.asyncIterator](): AsyncIterator<Frame> {
    return {
      next: () => this.next()
    };
  }
}

export class Caller {
  constructor(private readonly kernel: Kernel) {}

  call(frame: Frame, options: CallOptions = {}): CallStream {
    const queue = new AsyncQueue<Frame>();
    const stream = new CallStream(frame, queue, () => {
      this.kernel.unregisterPending(frame.id);
    });

    this.kernel.registerPending(frame.id, queue, stream);
    void this.kernel.dispatch(frame);

    if (options.signal !== undefined) {
      const onAbort = () => {
        void this.kernel.dispatch(responseFrom(frame, "cancel", {}));
      };

      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener("abort", onAbort, { once: true });
        stream.onClose(() => {
          options.signal?.removeEventListener("abort", onAbort);
        });
      }
    }

    return stream;
  }

  async collect(frame: Frame, options: CallOptions = {}): Promise<Frame[]> {
    return this.call(frame, options).collect();
  }

  async first(frame: Frame, options: CallOptions = {}): Promise<Frame | undefined> {
    const stream = this.call(frame, options);
    const first = await stream.recv();
    stream.close();
    return first;
  }
}
