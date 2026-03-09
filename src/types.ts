import type { Frame } from "muninn-frames-ts";

import type { Caller } from "./caller.js";

export interface Syscall {
  prefix(): string;
  dispatch(
    frame: Frame,
    caller: Caller,
    cancel: AbortSignal
  ): AsyncIterable<Frame>;
}

export interface BackpressureConfig {
  highWatermark: number;
  lowWatermark: number;
  stallTimeoutMs: number;
}

export const DEFAULT_BACKPRESSURE: BackpressureConfig = {
  highWatermark: 1000,
  lowWatermark: 100,
  stallTimeoutMs: 5000
};
