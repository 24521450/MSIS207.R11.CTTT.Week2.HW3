import type { DeadlineTimerRuntime } from "../domain/contracts";

const browserRuntime: DeadlineTimerRuntime = {
  now: () => Date.now(),
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  subscribeVisibility: (listener) => {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

/** Drives presentation from an absolute deadline; elapsed time is never accumulated. */
export function createDeadlineTimer(
  targetTime: number,
  onTick: (remainingMs: number) => void,
  runtime: DeadlineTimerRuntime = browserRuntime,
): () => void {
  const now = runtime.now ?? Date.now;
  let active = true;
  let frameHandle: number | null = null;
  let generation = 0;

  const cancelPendingFrame = (): void => {
    generation += 1;
    if (frameHandle !== null) {
      runtime.cancelFrame(frameHandle);
      frameHandle = null;
    }
  };

  const scheduleNextFrame = (): void => {
    if (!active || frameHandle !== null) return;

    const scheduledGeneration = ++generation;
    frameHandle = runtime.requestFrame(() => {
      if (!active || scheduledGeneration !== generation) return;
      frameHandle = null;
      publishAndContinue();
    });
  };

  const publishAndContinue = (): void => {
    if (!active) return;
    const remainingMs = Math.max(0, targetTime - now());
    onTick(remainingMs);
    if (remainingMs > 0) scheduleNextFrame();
  };

  const refreshAfterVisibilityChange = (): void => {
    if (!active) return;
    cancelPendingFrame();
    publishAndContinue();
  };

  const unsubscribeVisibility = runtime.subscribeVisibility?.(refreshAfterVisibilityChange);
  publishAndContinue();

  return () => {
    if (!active) return;
    active = false;
    cancelPendingFrame();
    unsubscribeVisibility?.();
  };
}
