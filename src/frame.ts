import {
  type Frame,
  type JsonObject,
  type JsonValue,
  type Status,
  isTerminalStatus,
  validateFrame
} from "muninn-frames-ts";

import type { ErrorCode } from "./errors.js";

export { isTerminalStatus };
export type { Frame, JsonObject, JsonValue, Status };

export interface FrameInit {
  id?: string;
  parent_id?: string;
  created_ms?: number;
  expires_in?: number;
  from?: string;
  call: string;
  status?: Status;
  trace?: JsonValue;
  data?: JsonObject;
}

export class FrameBuilder {
  constructor(readonly frame: Frame) {}

  item(data: JsonObject): Frame {
    return responseFrom(this.frame, "item", data);
  }

  bulk(data: JsonObject): Frame {
    return responseFrom(this.frame, "bulk", data);
  }

  done(data: JsonObject = {}): Frame {
    return responseFrom(this.frame, "done", data);
  }

  error(message: string): Frame {
    return responseFrom(this.frame, "error", {
      code: "E_INTERNAL",
      message,
      retryable: false
    });
  }

  errorFrom(error: ErrorCode): Frame {
    return responseFrom(this.frame, "error", {
      code: error.errorCode(),
      message: error.message,
      retryable: error.retryable?.() ?? false
    });
  }

  cancel(): Frame {
    return responseFrom(this.frame, "cancel", {});
  }

  withFrom(from: string): Frame {
    return { ...this.frame, from };
  }

  withTrace(trace: JsonValue): Frame {
    return { ...this.frame, trace };
  }

  withData(key: string, value: JsonValue): Frame {
    return { ...this.frame, data: { ...this.frame.data, [key]: value } };
  }
}

export function frame(frameValue: Frame): FrameBuilder {
  validateFrame(frameValue);
  return new FrameBuilder(frameValue);
}

export function request(call: string, data: JsonObject = {}): FrameBuilder {
  return frame({
    id: crypto.randomUUID(),
    created_ms: Date.now(),
    expires_in: 0,
    call,
    status: "request",
    data
  });
}

export function makeFrame(init: FrameInit): Frame {
  const frameValue: Frame = {
    id: init.id ?? crypto.randomUUID(),
    created_ms: init.created_ms ?? Date.now(),
    expires_in: init.expires_in ?? 0,
    call: init.call,
    status: init.status ?? "request",
    data: init.data ?? {}
  };

  if (init.parent_id !== undefined) {
    frameValue.parent_id = init.parent_id;
  }
  if (init.from !== undefined) {
    frameValue.from = init.from;
  }
  if (init.trace !== undefined) {
    frameValue.trace = init.trace;
  }

  validateFrame(frameValue);
  return frameValue;
}

export function prefixOf(call: string): string {
  return call.split(":", 1)[0] ?? call;
}

export function verbOf(call: string): string {
  return call.split(":")[1] ?? "";
}

export function responseFrom(
  requestFrame: Frame,
  status: Exclude<Status, "request">,
  data: JsonObject
): Frame {
  const response: Frame = {
    id: crypto.randomUUID(),
    parent_id: requestFrame.id,
    created_ms: Date.now(),
    expires_in: requestFrame.expires_in,
    call: requestFrame.call,
    status,
    data
  };

  if (requestFrame.trace !== undefined) {
    response.trace = requestFrame.trace;
  }

  validateFrame(response);
  return response;
}
