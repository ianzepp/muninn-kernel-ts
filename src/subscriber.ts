import type { Frame } from "muninn-frames-ts";

import { AsyncQueue } from "./queue.js";

export interface SubscriberCollectOptions {
  until?: (frame: Frame) => boolean;
  signal?: AbortSignal;
}

export class Subscriber implements AsyncIterable<Frame> {
  constructor(private readonly queue: AsyncQueue<Frame>) {}

  next(): Promise<IteratorResult<Frame>> {
    return this.queue.next();
  }

  recv(): Promise<Frame | undefined> {
    return this.queue.recv();
  }

  async collect(options: SubscriberCollectOptions = {}): Promise<Frame[]> {
    const frames: Frame[] = [];

    for await (const frame of abortable(this, options.signal)) {
      frames.push(frame);
      if (options.until?.(frame) ?? false) {
        break;
      }
    }

    return frames;
  }

  [Symbol.asyncIterator](): AsyncIterator<Frame> {
    return {
      next: () => this.next()
    };
  }
}

async function* abortable(
  iterable: AsyncIterable<Frame>,
  signal?: AbortSignal
): AsyncIterable<Frame> {
  if (signal?.aborted) {
    return;
  }

  for await (const frame of iterable) {
    if (signal?.aborted) {
      return;
    }

    yield frame;
  }
}
