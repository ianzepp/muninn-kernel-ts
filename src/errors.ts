import type { JsonObject } from "muninn-frames-ts";

export interface ErrorCode extends Error {
  errorCode(): string;
  retryable?(): boolean;
}

export class SigcallError extends Error {
  static alreadyRegistered(name: string, owner: string): SigcallError {
    return new SigcallError(`sigcall ${JSON.stringify(name)} already registered by ${JSON.stringify(owner)}`);
  }

  static notRegistered(name: string): SigcallError {
    return new SigcallError(`sigcall ${JSON.stringify(name)} not registered`);
  }

  static notOwner(name: string, owner: string, caller: string): SigcallError {
    return new SigcallError(
      `sigcall ${JSON.stringify(name)} owned by ${JSON.stringify(owner)}, not ${JSON.stringify(caller)}`
    );
  }

  static reserved(name: string): SigcallError {
    return new SigcallError(`cannot register reserved prefix: ${JSON.stringify(name)}`);
  }
}

export class KernelError extends Error implements ErrorCode {
  readonly code: string;
  readonly retryableFlag: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "KernelError";
    this.code = code;
    this.retryableFlag = retryable;
  }

  static invalidArgs(message: string): KernelError {
    return new KernelError("E_INVALID_ARGS", message);
  }

  static notFound(message: string): KernelError {
    return new KernelError("E_NOT_FOUND", message);
  }

  static forbidden(message: string): KernelError {
    return new KernelError("E_FORBIDDEN", message);
  }

  static cancelled(message = "operation cancelled"): KernelError {
    return new KernelError("E_CANCELLED", message);
  }

  static timeout(message: string): KernelError {
    return new KernelError("E_TIMEOUT", message, true);
  }

  static internal(message: string): KernelError {
    return new KernelError("E_INTERNAL", message);
  }

  static noRoute(message: string): KernelError {
    return new KernelError("E_NO_ROUTE", message);
  }

  errorCode(): string {
    return this.code;
  }

  retryable(): boolean {
    return this.retryableFlag;
  }

  toData(): JsonObject {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryableFlag
    };
  }
}

export function toKernelError(error: unknown): KernelError {
  if (error instanceof KernelError) {
    return error;
  }

  if (error instanceof Error) {
    if (hasErrorCode(error)) {
      return new KernelError(
        error.errorCode(),
        error.message,
        error.retryable?.() ?? false
      );
    }

    return KernelError.internal(error.message);
  }

  return KernelError.internal("unknown error");
}

function hasErrorCode(error: Error): error is ErrorCode {
  return typeof (error as Partial<ErrorCode>).errorCode === "function";
}
