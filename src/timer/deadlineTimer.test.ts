import { describe, expect, it } from "vitest";
import type { DeadlineTimerRuntime } from "../domain/contracts";
import { createDeadlineTimer } from "./deadlineTimer";

class FakeTimerRuntime implements DeadlineTimerRuntime {
  nowValue = 0;
  nextHandle = 1;
  callbacks = new Map<number, (timestamp: number) => void>();
  cancelled: number[] = [];
  visibilityListeners = new Set<() => void>();

  now = (): number => this.nowValue;

  requestFrame = (callback: (timestamp: number) => void): number => {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  };

  cancelFrame = (handle: number): void => {
    this.cancelled.push(handle);
    this.callbacks.delete(handle);
  };

  subscribeVisibility = (listener: () => void): (() => void) => {
    this.visibilityListeners.add(listener);
    return () => this.visibilityListeners.delete(listener);
  };

  advanceTo(time: number): void {
    this.nowValue = time;
  }

  paint(): void {
    const pending = [...this.callbacks.entries()][0];
    if (!pending) throw new Error("No animation frame is pending");
    const [handle, callback] = pending;
    this.callbacks.delete(handle);
    callback(this.nowValue);
  }

  becomeVisible(): void {
    for (const listener of [...this.visibilityListeners]) listener();
  }
}

describe("createDeadlineTimer", () => {
  it("recomputes from the deadline after jumps and long gaps between frames", () => {
    const runtime = new FakeTimerRuntime();
    runtime.advanceTo(1_000);
    const ticks: number[] = [];
    const cleanup = createDeadlineTimer(3_000, (value) => ticks.push(value), runtime);

    expect(ticks).toEqual([2_000]);
    runtime.advanceTo(1_700);
    runtime.paint();
    expect(ticks.at(-1)).toBe(1_300);

    runtime.advanceTo(8_000);
    runtime.paint();
    expect(ticks.at(-1)).toBe(0);
    expect(ticks.every((value) => value >= 0)).toBe(true);
    expect(runtime.callbacks.size).toBe(0);
    cleanup();
  });

  it("refreshes immediately when the tab becomes visible after the deadline", () => {
    const runtime = new FakeTimerRuntime();
    runtime.advanceTo(10_000);
    const ticks: number[] = [];
    const cleanup = createDeadlineTimer(20_000, (value) => ticks.push(value), runtime);
    const oldFrame = [...runtime.callbacks.keys()][0];

    runtime.advanceTo(25_000);
    runtime.becomeVisible();

    expect(ticks).toEqual([10_000, 0]);
    expect(runtime.cancelled).toContain(oldFrame);
    expect(runtime.callbacks.size).toBe(0);
    cleanup();
  });

  it("cancels the outstanding frame and visibility listener on cleanup", () => {
    const runtime = new FakeTimerRuntime();
    const ticks: number[] = [];
    const cleanup = createDeadlineTimer(2_000, (value) => ticks.push(value), runtime);
    const handle = [...runtime.callbacks.keys()][0];

    cleanup();
    runtime.advanceTo(5_000);
    runtime.becomeVisible();

    expect(runtime.cancelled).toEqual([handle]);
    expect(runtime.callbacks.size).toBe(0);
    expect(runtime.visibilityListeners.size).toBe(0);
    expect(ticks).toEqual([2_000]);
  });
});
