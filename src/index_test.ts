import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import type { Frame } from "muninn-frames-ts";

import {
  Caller,
  Kernel,
  SigcallError,
  type Syscall,
  frame,
  makeFrame,
  request,
  verbOf
} from "./index.js";

class EchoSyscall implements Syscall {
  prefix(): string {
    return "echo";
  }

  async *dispatch(frameValue: Frame): AsyncIterable<Frame> {
    yield frame(frameValue).item({ verb: verbOf(frameValue.call) });
    yield frame(frameValue).done({ ok: true });
  }
}

class SlowSyscall implements Syscall {
  prefix(): string {
    return "slow";
  }

  async *dispatch(frameValue: Frame, _caller: Caller, cancel: AbortSignal): AsyncIterable<Frame> {
    await delay(50);

    if (cancel.aborted) {
      return;
    }

    yield frame(frameValue).item({ step: 1 });
    await delay(200);

    if (cancel.aborted) {
      return;
    }

    yield frame(frameValue).done({ ok: true });
  }
}

test("frame builder preserves correlation and trace", () => {
  const req = frame(request("echo:ping").frame).withTrace({ span: "abc" });
  const item = frame(req).item({ ok: true });

  assert.equal(item.parent_id, req.id);
  assert.equal(item.call, "echo:ping");
  assert.deepEqual(item.trace, { span: "abc" });
  assert.equal(item.status, "item");
});

test("caller collects streamed syscall responses", async () => {
  const kernel = Kernel.create();
  kernel.register(new EchoSyscall());

  const frames = await kernel.caller().collect(request("echo:ping").frame);

  assert.equal(frames.length, 2);
  assert.equal(frames[0]?.status, "item");
  assert.deepEqual(frames[0]?.data, { verb: "ping" });
  assert.equal(frames[1]?.status, "done");
  assert.deepEqual(frames[1]?.data, { ok: true });
});

test("unknown routes return a terminal error frame", async () => {
  const kernel = Kernel.create();

  const frames = await kernel.caller().collect(request("missing:verb").frame);
  const terminal = frames.at(-1);

  assert.equal(terminal?.status, "error");
  assert.equal(terminal?.data.code, "E_NO_ROUTE");
});

test("subscriber sees outbound responses", async () => {
  const kernel = Kernel.create();
  kernel.register(new EchoSyscall());

  const subscriber = kernel.subscribe();
  const callPromise = kernel.caller().collect(request("echo:stream").frame);

  const seen = await subscriber.collect({
    until: (frameValue) => frameValue.status === "done"
  });

  await callPromise;

  assert.equal(seen.length, 2);
  assert.equal(seen[0]?.status, "item");
  assert.equal(seen[1]?.status, "done");
});

test("abort signal emits cancel terminal frame", async () => {
  const kernel = Kernel.create();
  kernel.register(new SlowSyscall());

  const controller = new AbortController();
  const collectPromise = kernel.caller().collect(
    request("slow:work").frame,
    { signal: controller.signal }
  );

  await delay(75);
  controller.abort();

  const frames = await collectPromise;
  const terminal = frames.at(-1);

  assert.equal(frames[0]?.status, "item");
  assert.equal(terminal?.status, "cancel");
});

test("raw prefix registration can receive requests and send responses", async () => {
  const kernel = Kernel.create();
  const pipe = kernel.registerPrefix("pipe");

  const collectPromise = kernel.caller().collect(request("pipe:work").frame);
  const inbound = await pipe.recv();
  assert.ok(inbound);

  await pipe.send(frame(inbound).done({ handled: true }));

  const frames = await collectPromise;
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.status, "done");
  assert.deepEqual(frames[0]?.data, { handled: true });
});

test("makeFrame builds validated explicit frames", () => {
  const explicit = makeFrame({
    id: "frame-1",
    parent_id: "parent-1",
    created_ms: 1,
    expires_in: 0,
    call: "echo:ping",
    status: "item",
    data: { ok: true }
  });

  assert.equal(explicit.id, "frame-1");
  assert.equal(explicit.parent_id, "parent-1");
});

test("sigcall routes to registered external handler", async () => {
  const kernel = Kernel.create();
  const handler = kernel.sigcalls().register("custom:op", "plugin-1");

  const collectPromise = kernel.caller().collect(request("custom:op").frame);
  const inbound = await handler.recv();

  assert.ok(inbound);
  await handler.send(frame(inbound).done({ ok: true }));

  const frames = await collectPromise;
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.status, "done");
  assert.deepEqual(frames[0]?.data, { ok: true });
});

test("sigcall:list returns registered handlers", async () => {
  const kernel = Kernel.create();
  kernel.sigcalls().register("custom:a", "owner-1");
  kernel.sigcalls().register("custom:b", "owner-2");

  const frames = await kernel.caller().collect(request("sigcall:list").frame);

  const items = frames.filter((frameValue) => frameValue.status === "item");
  const terminal = frames.at(-1);

  assert.equal(items.length, 2);
  assert.equal(terminal?.status, "done");
});

test("sigcall registry enforces ownership and reserved names", () => {
  const kernel = Kernel.create();
  kernel.sigcalls().register("custom:a", "owner-1");

  assert.throws(
    () => kernel.sigcalls().register("custom:a", "owner-2"),
    SigcallError
  );
  assert.throws(
    () => kernel.sigcalls().register("sigcall:register", "owner-1"),
    SigcallError
  );
});
