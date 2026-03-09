import type { Frame } from "muninn-frames-ts";
import { isTerminalStatus, validateFrame } from "muninn-frames-ts";

import { CallStream, Caller } from "./caller.js";
import { KernelError, toKernelError } from "./errors.js";
import { prefixOf, responseFrom, verbOf } from "./frame.js";
import { normalizeResponse } from "./normalize.js";
import { PipeEnd } from "./pipe.js";
import { AsyncQueue } from "./queue.js";
import { SigcallRegistry } from "./sigcall.js";
import { Subscriber } from "./subscriber.js";
import { SubscriberRegistry } from "./subscriptions.js";
import type { BackpressureConfig, Syscall } from "./types.js";
import { DEFAULT_BACKPRESSURE } from "./types.js";

interface PendingEntry {
  queue: AsyncQueue<Frame>;
  stream: CallStream;
}

interface ActiveRequest {
  request: Frame;
  cancel: AbortController;
  route: "syscall" | "pipe" | "sigcall";
  pipe?: AsyncQueue<Frame>;
}

export class Kernel {
  private readonly syscalls = new Map<string, Syscall>();
  private readonly pipes = new Map<string, AsyncQueue<Frame>>();
  private readonly pending = new Map<string, PendingEntry>();
  private readonly active = new Map<string, ActiveRequest>();
  private readonly backpressure: BackpressureConfig;
  private readonly sigcallRegistry: SigcallRegistry;
  private readonly subscribers = new SubscriberRegistry();

  static create(config: { backpressure?: Partial<BackpressureConfig> } = {}): Kernel {
    return new Kernel(config);
  }

  constructor(config: { backpressure?: Partial<BackpressureConfig> } = {}) {
    this.backpressure = {
      ...DEFAULT_BACKPRESSURE,
      ...config.backpressure
    };
    this.sigcallRegistry = new SigcallRegistry(this);
  }

  register(syscall: Syscall): void {
    this.syscalls.set(syscall.prefix(), syscall);
  }

  registerPrefix(prefix: string): PipeEnd {
    const queue = new AsyncQueue<Frame>();
    this.pipes.set(prefix, queue);
    return new PipeEnd(this, queue);
  }

  caller(): Caller {
    return new Caller(this);
  }

  sigcalls(): SigcallRegistry {
    return this.sigcallRegistry;
  }

  subscribe(): Subscriber {
    return this.subscribers.subscribe(this.backpressure);
  }

  registerPending(requestId: string, queue: AsyncQueue<Frame>, stream: CallStream): void {
    this.pending.set(requestId, { queue, stream });
  }

  unregisterPending(requestId: string): void {
    const entry = this.pending.get(requestId);
    if (entry === undefined) {
      return;
    }

    this.pending.delete(requestId);
    entry.queue.close();
  }

  async dispatch(frame: Frame): Promise<void> {
    validateFrame(frame);

    switch (frame.status) {
      case "request":
        await this.routeRequest(frame);
        break;
      case "cancel":
        await this.routeCancel(frame);
        break;
      default:
        await this.emitResponse(frame);
        break;
    }
  }

  private async routeRequest(frame: Frame): Promise<void> {
    const prefix = prefixOf(frame.call);
    if (prefix === "sigcall") {
      await this.handleSigcallManagement(frame);
      return;
    }

    const syscall = this.syscalls.get(prefix);
    if (syscall !== undefined) {
      const cancel = new AbortController();
      this.active.set(frame.id, { request: frame, cancel, route: "syscall" });
      const caller = this.caller();
      void this.runSyscall(syscall, frame, caller, cancel);
      return;
    }

    const pipe = this.pipes.get(prefix);
    if (pipe !== undefined) {
      this.active.set(frame.id, { request: frame, cancel: new AbortController(), route: "pipe", pipe });
      pipe.push(frame);
      return;
    }

    const sigcall = this.sigcallRegistry.lookup(frame.call);
    if (sigcall !== undefined) {
      this.active.set(frame.id, {
        request: frame,
        cancel: new AbortController(),
        route: "sigcall",
        pipe: sigcall
      });
      sigcall.push(frame);
      return;
    }

    await this.emitResponse(responseFrom(frame, "error", KernelError.noRoute(`no route for prefix: ${prefix}`).toData()));
  }

  private async runSyscall(
    syscall: Syscall,
    request: Frame,
    caller: Caller,
    cancel: AbortController
  ): Promise<void> {
    let sentTerminal = false;

    try {
      for await (const response of syscall.dispatch(request, caller, cancel.signal)) {
        const normalized = normalizeResponse(request, response);
        await this.emitResponse(normalized);
        if (isTerminalStatus(normalized.status)) {
          sentTerminal = true;
          break;
        }
      }

      if (!sentTerminal && !cancel.signal.aborted) {
        await this.emitResponse(
          responseFrom(
            request,
            "error",
            KernelError.internal("handler exited without terminal frame").toData()
          )
        );
      }
    } catch (error) {
      await this.emitResponse(
        responseFrom(request, "error", toKernelError(error).toData())
      );
    } finally {
      this.active.delete(request.id);
    }
  }

  private async routeCancel(frame: Frame): Promise<void> {
    const targetId = frame.parent_id;
    if (targetId === undefined) {
      return;
    }

    const active = this.active.get(targetId);
    if (active === undefined) {
      return;
    }

    active.cancel.abort();

    if (active.route === "pipe" || active.route === "sigcall") {
      active.pipe?.push(frame);
    }

    this.active.delete(targetId);
    await this.emitResponse(responseFrom(active.request, "cancel", {}));
  }

  private async emitResponse(frame: Frame): Promise<void> {
    const parentId = frame.parent_id;
    if (parentId !== undefined) {
      const pending = this.pending.get(parentId);
      if (pending !== undefined) {
        pending.queue.push(frame);
        if (isTerminalStatus(frame.status)) {
          pending.stream.close();
        }
      }
    }

    await this.subscribers.deliver(frame);

    if (isTerminalStatus(frame.status) && parentId !== undefined) {
      this.active.delete(parentId);
      this.pending.delete(parentId);
    }
  }

  private async handleSigcallManagement(frame: Frame): Promise<void> {
    const verb = verbOf(frame.call);

    switch (verb) {
      case "list":
        for (const entry of this.sigcallRegistry.list()) {
          await this.emitResponse(responseFrom(frame, "item", {
            name: entry.name,
            owner: entry.owner
          }));
        }
        await this.emitResponse(responseFrom(frame, "done", {}));
        return;
      case "register":
      case "unregister":
        await this.emitResponse(responseFrom(frame, "error", {
          code: "E_INTERNAL",
          message: "sigcall:register and sigcall:unregister must be called through the SigcallRegistry API directly",
          retryable: false
        }));
        return;
      default:
        await this.emitResponse(responseFrom(frame, "error", {
          code: "E_INTERNAL",
          message: `unknown sigcall operation: ${verb}`,
          retryable: false
        }));
      }
  }
}
