import type { Frame } from "muninn-frames-ts";

import { AsyncQueue } from "./queue.js";
import { Caller } from "./caller.js";
import type { Kernel } from "./kernel.js";

export class PipeEnd {
  constructor(
    private readonly kernel: Kernel,
    private readonly inbound: AsyncQueue<Frame>
  ) {}

  async send(frame: Frame): Promise<void> {
    await this.kernel.dispatch(frame);
  }

  recv(): Promise<Frame | undefined> {
    return this.inbound.recv();
  }

  caller(): Caller {
    return this.kernel.caller();
  }
}
