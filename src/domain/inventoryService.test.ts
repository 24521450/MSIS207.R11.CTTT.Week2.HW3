import { describe, expect, it } from "vitest";
import type { InventoryRuntime, SaleConfig } from "./contracts";
import { InMemoryInventoryService, inventoryInvariantHolds } from "./inventoryService";

const config: SaleConfig = {
  productName: "Demo product",
  priceVnd: 500_000,
  initialStock: 5,
  unitsPerPurchase: 1,
  saleDurationMs: 120_000,
  reservationDurationMs: 15_000,
};

class FakeInventoryRuntime implements InventoryRuntime {
  nowValue = 1_000;
  nextHandle = 1;
  callbacks = new Map<number, { at: number; callback: () => void }>();
  history = new Map<number, () => void>();

  now = (): number => this.nowValue;
  schedule = (callback: () => void, delayMs: number): number => {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, { at: this.nowValue + delayMs, callback });
    this.history.set(handle, callback);
    return handle;
  };
  cancel = (handle: number): void => {
    this.callbacks.delete(handle);
  };

  setTime(time: number): void {
    this.nowValue = time;
  }

  runDue(): void {
    while (true) {
      const due = [...this.callbacks.entries()]
        .filter(([, timer]) => timer.at <= this.nowValue)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) return;
      this.callbacks.delete(due[0]);
      due[1].callback();
    }
  }

  invokeHistorical(handle: number): void {
    this.history.get(handle)?.();
  }
}

describe("InMemoryInventoryService reservations", () => {
  it("admits at most five of 100 simultaneous requests and preserves the stock invariant", async () => {
    const runtime = new FakeInventoryRuntime();
    const service = new InMemoryInventoryService(config, runtime);
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, index) => service.reserve(`request-${index}`)),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(5);
    expect(service.getSnapshot()).toMatchObject({
      initialStock: 5,
      available: 0,
      reserved: 5,
      sold: 0,
      version: 5,
    });
    expect(inventoryInvariantHolds(service.getSnapshot())).toBe(true);
  });

  it("treats repeated IDs as one optimistic reservation", async () => {
    const service = new InMemoryInventoryService(config, new FakeInventoryRuntime());
    const results = await Promise.all([
      service.reserve("same-request"),
      service.reserve("same-request"),
      service.reserve("same-request"),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.map((result) => result.ok && result.reservation.id)).toEqual([
      "same-request",
      "same-request",
      "same-request",
    ]);
    expect(service.getSnapshot()).toMatchObject({ available: 4, reserved: 1, sold: 0, version: 1 });
  });

  it("rejects a new reservation at the sale deadline and publishes monotonic versions", async () => {
    const runtime = new FakeInventoryRuntime();
    const service = new InMemoryInventoryService(config, runtime);
    const observedVersions: number[] = [];
    service.subscribe((snapshot) => observedVersions.push(snapshot.version));
    const first = await service.reserve("first");

    runtime.setTime(service.saleEndsAt);
    const second = await service.reserve("second");

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, reason: "sale-ended" });
    expect(observedVersions).toEqual([1, 2]);
    expect(service.getSnapshot()).toMatchObject({ available: 5, reserved: 0, sold: 0 });
    expect(inventoryInvariantHolds(service.getSnapshot())).toBe(true);
  });

  it("returns expired stock once even when callbacks repeat or the clock jumps", async () => {
    const runtime = new FakeInventoryRuntime();
    const service = new InMemoryInventoryService(config, runtime);
    const result = await service.reserve("expires-once");
    if (!result.ok) throw new Error("Expected the reservation to succeed");
    const handle = [...runtime.callbacks.keys()][0];

    runtime.setTime(result.reservation.expiresAt + 20_000);
    runtime.runDue();
    const afterFirstExpiry = service.getSnapshot();
    runtime.invokeHistorical(handle);
    const repeatedExpiry = service.expireReservation(result.reservation.id);

    expect(afterFirstExpiry).toMatchObject({ available: 5, reserved: 0, sold: 0, version: 2 });
    expect(repeatedExpiry.changed).toBe(false);
    expect(repeatedExpiry.snapshot.version).toBe(afterFirstExpiry.version);
    expect(inventoryInvariantHolds(repeatedExpiry.snapshot)).toBe(true);
  });

  it("ignores an old callback after release and a newer reservation", async () => {
    const runtime = new FakeInventoryRuntime();
    const service = new InMemoryInventoryService(config, runtime);
    const old = await service.reserve("old-reservation");
    if (!old.ok) throw new Error("Expected the first reservation to succeed");
    const oldHandle = [...runtime.callbacks.keys()][0];

    service.releaseReservation(old.reservation.id);
    runtime.setTime(2_000);
    const current = await service.reserve("new-reservation");
    if (!current.ok) throw new Error("Expected the newer reservation to succeed");
    const versionBeforeStaleCallback = service.getSnapshot().version;
    runtime.setTime(old.reservation.expiresAt);
    runtime.invokeHistorical(oldHandle);

    expect(service.getSnapshot()).toMatchObject({ available: 4, reserved: 1, sold: 0 });
    expect(service.getSnapshot().version).toBe(versionBeforeStaleCallback);
    expect(inventoryInvariantHolds(service.getSnapshot())).toBe(true);
  });
});
