import type { Frame } from "muninn-frames-ts";
import { isTerminalStatus } from "muninn-frames-ts";

import { AsyncQueue } from "./queue.js";
import { Subscriber } from "./subscriber.js";
import type { BackpressureConfig } from "./types.js";

interface SubscriberEntry {
  queue: AsyncQueue<Frame>;
  config: BackpressureConfig;
}

export class SubscriberRegistry {
  private readonly subscribers = new Set<SubscriberEntry>();

  subscribe(config: BackpressureConfig): Subscriber {
    const queue = new AsyncQueue<Frame>();
    this.subscribers.add({ queue, config });
    return new Subscriber(queue);
  }

  async deliver(frame: Frame): Promise<void> {
    for (const subscriber of [...this.subscribers]) {
      const delivered = await deliverToSubscriber(subscriber, frame);
      if (!delivered) {
        subscriber.queue.close();
        this.subscribers.delete(subscriber);
      }
    }
  }
}

async function deliverToSubscriber(
  subscriber: SubscriberEntry,
  frame: Frame
): Promise<boolean> {
  if (!isTerminalStatus(frame.status) && subscriber.queue.size >= subscriber.config.highWatermark) {
    const drained = await subscriber.queue.waitForBelow(
      subscriber.config.lowWatermark,
      subscriber.config.stallTimeoutMs
    );
    if (!drained) {
      return false;
    }
  }

  subscriber.queue.push(frame);
  return true;
}
