// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SalePage } from "./App";
import { InMemoryInventoryService } from "./domain/inventoryService";
import type { CheckoutResult, InventoryRuntime, ReserveResult, SaleConfig } from "./domain/contracts";

const testConfig: SaleConfig = {
  productName: "Demo headphones",
  priceVnd: 1_290_000,
  initialStock: 5,
  unitsPerPurchase: 1,
  saleDurationMs: 120_000,
  reservationDurationMs: 15_000,
};

class ControlledRuntime implements InventoryRuntime {
  nextHandle = 1;
  timers = new Map<number, { at: number; callback: () => void }>();
  nowValue: number;

  constructor(nowValue: number) {
    this.nowValue = nowValue;
  }

  now = (): number => this.nowValue;

  schedule = (callback: () => void, delayMs: number): number => {
    const handle = this.nextHandle++;
    this.timers.set(handle, { at: this.nowValue + delayMs, callback });
    return handle;
  };

  cancel = (handle: number): void => {
    this.timers.delete(handle);
  };

  advanceTo(time: number): void {
    this.nowValue = time;
  }

  runDue(): void {
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= this.nowValue)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) return;
      this.timers.delete(due[0]);
      due[1].callback();
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function delayNextReserveResponse(service: InMemoryInventoryService): () => ReserveResult {
  const reserve = service.reserve.bind(service);
  let response: ReserveResult | undefined;
  let deliver!: (response: ReserveResult) => void;
  const delayedResponse = new Promise<ReserveResult>((resolve) => {
    deliver = resolve;
  });

  vi.spyOn(service, "reserve").mockImplementationOnce(async (requestId) => {
    response = await reserve(requestId);
    return delayedResponse;
  });

  return () => {
    if (response === undefined) throw new Error("The reservation has not committed yet.");
    deliver(response);
    return response;
  };
}

let runtime: ControlledRuntime;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let originalRequestFrame: typeof window.requestAnimationFrame;
let originalCancelFrame: typeof window.cancelAnimationFrame;
let operationNumber: number;

beforeEach(() => {
  runtime = new ControlledRuntime(100_000);
  vi.spyOn(Date, "now").mockImplementation(() => runtime.nowValue);
  frames = new Map();
  nextFrame = 1;
  operationNumber = 0;
  originalRequestFrame = window.requestAnimationFrame;
  originalCancelFrame = window.cancelAnimationFrame;
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback): number => {
      const handle = nextFrame++;
      frames.set(handle, callback);
      return handle;
    },
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: (handle: number): void => {
      frames.delete(handle);
    },
  });
  vi.stubGlobal("crypto", {
    randomUUID: () => `operation-${++operationNumber}`,
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: originalRequestFrame,
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: originalCancelFrame,
  });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Mega-Sale UI", () => {
  it("holds one unit and completes checkout in React StrictMode", async () => {
    const service = new InMemoryInventoryService(testConfig, runtime);
    render(
      <StrictMode>
        <SalePage service={service} />
      </StrictMode>,
    );
    const user = userEvent.setup();

    expect(screen.getByRole("heading", { name: "Săn deal chớp nhoáng. Giữ hàng kịp lúc." })).toBeTruthy();
    expect(screen.getByText(/1\.290\.000\s*₫/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Mua ngay" }));
    await screen.findByRole("button", { name: "Thanh toán" });
    expect(screen.getByText("1", { selector: ".inventory-cell strong" })).toBeTruthy();
    expect(screen.getByText("4", { selector: ".inventory-cell strong" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Thanh toán" }));
    await screen.findByText("Đặt hàng thành công");

    expect(service.getSnapshot()).toMatchObject({ available: 4, reserved: 0, sold: 1 });
    expect(screen.getByText("0", { selector: ".inventory-cell strong" })).toBeTruthy();
    expect(screen.getByText("1", { selector: ".inventory-cell strong" })).toBeTruthy();
  });

  it("shows an expired hold and restored stock when a backgrounded tab resumes", async () => {
    const service = new InMemoryInventoryService(testConfig, runtime);
    render(<SalePage service={service} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Mua ngay" }));
    await screen.findByRole("button", { name: "Thanh toán" });
    const reservation = service.getSnapshot();
    expect(reservation.reserved).toBe(1);

    runtime.advanceTo(runtime.nowValue + testConfig.reservationDurationMs);
    runtime.runDue();
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() =>
      expect(screen.getByText("Thời gian giữ hàng đã hết; sản phẩm được trả lại kho.")).toBeTruthy(),
    );
    expect(service.getSnapshot()).toMatchObject({ available: 5, reserved: 0, sold: 0 });
    expect(screen.getByRole("button", { name: "Mua ngay" }).hasAttribute("disabled")).toBe(false);
  });

  it("recovers from a response delayed beyond the hold deadline and can buy again in StrictMode", async () => {
    const service = new InMemoryInventoryService(testConfig, runtime);
    const deliverResponse = delayNextReserveResponse(service);
    render(
      <StrictMode>
        <SalePage service={service} />
      </StrictMode>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Mua ngay" }));
    expect(screen.getByRole("button", { name: "Đang giữ hàng…" }).hasAttribute("disabled")).toBe(true);
    expect(service.getSnapshot()).toMatchObject({ available: 4, reserved: 1, sold: 0 });

    await act(async () => {
      runtime.advanceTo(runtime.nowValue + 16_000);
      runtime.runDue();
      document.dispatchEvent(new Event("visibilitychange"));
      deliverResponse();
    });

    expect(screen.getByText("Thời gian giữ hàng đã hết trước khi giao diện xác nhận.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mua ngay" }).hasAttribute("disabled")).toBe(false);
    expect(service.getSnapshot()).toMatchObject({ available: 5, reserved: 0, sold: 0, version: 2 });

    await user.click(screen.getByRole("button", { name: "Mua ngay" }));
    await screen.findByRole("button", { name: "Thanh toán" });
    expect(service.getSnapshot()).toMatchObject({ available: 4, reserved: 1, sold: 0, version: 3 });
    expect(service.expireReservation("operation-1").changed).toBe(false);
    expect(service.getSnapshot()).toMatchObject({ available: 4, reserved: 1, sold: 0, version: 3 });

    await user.click(screen.getByRole("button", { name: "Thanh toán" }));
    await screen.findByText("Đặt hàng thành công");
    expect(service.getSnapshot()).toMatchObject({ available: 4, reserved: 0, sold: 1, version: 4 });
  });

  it("ignores an old expired response after remounting and starting a newer reservation", async () => {
    const service = new InMemoryInventoryService(testConfig, runtime);
    const deliverOldResponse = delayNextReserveResponse(service);
    const firstView = render(
      <StrictMode>
        <SalePage service={service} />
      </StrictMode>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Mua ngay" }));

    await act(async () => {
      runtime.advanceTo(runtime.nowValue + 16_000);
      runtime.runDue();
    });
    firstView.unmount();
    render(
      <StrictMode>
        <SalePage service={service} />
      </StrictMode>,
    );
    await user.click(screen.getByRole("button", { name: "Mua ngay" }));
    await screen.findByRole("button", { name: "Thanh toán" });
    const newerSnapshot = service.getSnapshot();

    await act(async () => {
      deliverOldResponse();
    });

    expect(screen.getByText("Đã giữ sản phẩm cho bạn. Hãy thanh toán trước khi hết giờ.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Thanh toán" }).hasAttribute("disabled")).toBe(false);
    expect(service.getSnapshot()).toEqual(newerSnapshot);
    expect(service.getSnapshot()).toMatchObject({ available: 4, reserved: 1, sold: 0, version: 3 });

    await user.click(screen.getByRole("button", { name: "Thanh toán" }));
    await screen.findByText("Đặt hàng thành công");
    expect(service.getSnapshot()).toMatchObject({ available: 4, reserved: 0, sold: 1 });
  });

  it("releases a successful response delivered after unmount without restarting UI work", async () => {
    const service = new InMemoryInventoryService(testConfig, runtime);
    const deliverResponse = delayNextReserveResponse(service);
    const view = render(
      <StrictMode>
        <SalePage service={service} />
      </StrictMode>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Mua ngay" }));
    expect(service.getSnapshot()).toMatchObject({ available: 4, reserved: 1, sold: 0 });

    view.unmount();
    expect(frames.size).toBe(0);
    await act(async () => {
      deliverResponse();
    });

    expect(service.getSnapshot()).toMatchObject({ available: 5, reserved: 0, sold: 0, version: 2 });
    expect(runtime.timers.size).toBe(0);
    expect(frames.size).toBe(0);
    expect(view.container.childElementCount).toBe(0);
  });

  it("ignores a reserve rejection delivered after unmount", async () => {
    const service = new InMemoryInventoryService(testConfig, runtime);
    const lateResponse = deferred<ReserveResult>();
    vi.spyOn(service, "reserve").mockImplementationOnce(() => lateResponse.promise);
    const view = render(
      <StrictMode>
        <SalePage service={service} />
      </StrictMode>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Mua ngay" }));
    view.unmount();
    await act(async () => {
      lateResponse.reject(new Error("late reserve rejection"));
      await lateResponse.promise.catch(() => undefined);
    });

    expect(service.getSnapshot()).toMatchObject({ available: 5, reserved: 0, sold: 0 });
    expect(runtime.timers.size).toBe(0);
    expect(frames.size).toBe(0);
    expect(view.container.childElementCount).toBe(0);
  });

  it("ignores a successful checkout response delivered after unmount", async () => {
    const service = new InMemoryInventoryService(testConfig, runtime);
    const actualCheckout = service.checkout.bind(service);
    const responseCommitted = deferred<CheckoutResult>();
    const lateResponse = deferred<CheckoutResult>();
    vi.spyOn(service, "checkout").mockImplementationOnce(async (reservationId, attemptId) => {
      const result = await actualCheckout(reservationId, attemptId);
      responseCommitted.resolve(result);
      return lateResponse.promise;
    });
    const view = render(
      <StrictMode>
        <SalePage service={service} />
      </StrictMode>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Mua ngay" }));
    await screen.findByRole("button", { name: "Thanh toán" });
    await user.click(screen.getByRole("button", { name: "Thanh toán" }));
    const committedResult = await responseCommitted.promise;
    expect(committedResult).toMatchObject({ ok: true });
    expect(service.getSnapshot()).toMatchObject({ available: 4, reserved: 0, sold: 1 });

    view.unmount();
    expect(frames.size).toBe(0);
    expect(runtime.timers.size).toBe(0);
    await act(async () => {
      lateResponse.resolve(committedResult);
      await lateResponse.promise;
    });

    expect(service.getSnapshot()).toMatchObject({ available: 4, reserved: 0, sold: 1 });
    expect(view.container.childElementCount).toBe(0);
  });

  it("ignores an expired checkout result delivered after unmount", async () => {
    const service = new InMemoryInventoryService(testConfig, runtime);
    const actualCheckout = service.checkout.bind(service);
    const checkoutStarted = deferred<void>();
    const allowServiceDecision = deferred<void>();
    const lateResponse = deferred<CheckoutResult>();
    vi.spyOn(service, "checkout").mockImplementationOnce(async (reservationId, attemptId) => {
      checkoutStarted.resolve();
      await allowServiceDecision.promise;
      const result = await actualCheckout(reservationId, attemptId);
      lateResponse.resolve(result);
      return result;
    });
    const view = render(
      <StrictMode>
        <SalePage service={service} />
      </StrictMode>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Mua ngay" }));
    await screen.findByRole("button", { name: "Thanh toán" });
    await user.click(screen.getByRole("button", { name: "Thanh toán" }));
    await checkoutStarted.promise;
    view.unmount();

    runtime.advanceTo(runtime.nowValue + testConfig.reservationDurationMs);
    runtime.runDue();
    expect(service.getSnapshot()).toMatchObject({ available: 5, reserved: 0, sold: 0 });
    await act(async () => {
      allowServiceDecision.resolve();
      const result = await lateResponse.promise;
      expect(result).toMatchObject({ ok: false, reason: "reservation-expired" });
    });

    expect(service.getSnapshot()).toMatchObject({ available: 5, reserved: 0, sold: 0 });
    expect(runtime.timers.size).toBe(0);
    expect(frames.size).toBe(0);
    expect(view.container.childElementCount).toBe(0);
  });

  it("ignores checkout promise rejection after unmount while the service-owned hold timer still expires", async () => {
    const service = new InMemoryInventoryService(testConfig, runtime);
    const lateResponse = deferred<CheckoutResult>();
    vi.spyOn(service, "checkout").mockImplementationOnce(() => lateResponse.promise);
    const view = render(
      <StrictMode>
        <SalePage service={service} />
      </StrictMode>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Mua ngay" }));
    await screen.findByRole("button", { name: "Thanh toán" });
    await user.click(screen.getByRole("button", { name: "Thanh toán" }));
    view.unmount();

    expect(frames.size).toBe(0);
    expect(runtime.timers.size).toBe(1);
    await act(async () => {
      lateResponse.reject(new Error("late checkout rejection"));
      await lateResponse.promise.catch(() => undefined);
    });
    expect(service.getSnapshot()).toMatchObject({ available: 4, reserved: 1, sold: 0 });

    runtime.advanceTo(runtime.nowValue + testConfig.reservationDurationMs);
    runtime.runDue();
    expect(service.getSnapshot()).toMatchObject({ available: 5, reserved: 0, sold: 0 });
    expect(runtime.timers.size).toBe(0);
    expect(frames.size).toBe(0);
    expect(view.container.childElementCount).toBe(0);
  });

  it("cleans the active animation frame on unmount", () => {
    const service = new InMemoryInventoryService(testConfig, runtime);
    const view = render(<SalePage service={service} />);
    expect(frames.size).toBe(1);

    view.unmount();

    expect(frames.size).toBe(0);
  });
});
