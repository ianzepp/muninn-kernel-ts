import type { Frame } from "muninn-frames-ts";
import { validateFrame } from "muninn-frames-ts";

import { KernelError } from "./errors.js";

export function normalizeResponse(request: Frame, response: Frame): Frame {
  if (response.status === "request") {
    throw KernelError.internal("syscall yielded request status");
  }

  const normalized: Frame = {
    ...response,
    parent_id: response.parent_id ?? request.id,
    call: response.call.length > 0 ? response.call : request.call
  };

  if (normalized.trace === undefined && request.trace !== undefined) {
    normalized.trace = request.trace;
  }

  validateFrame(normalized);
  return normalized;
}
