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

  now = (): number => this.nowValue;
  schedule = (callback: () => void, delayMs: number): number => {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, { at: this.nowValue + delayMs, callback });
    return handle;
  };
  cancel = (handle: number): void => {
    this.callbacks.delete(handle);
  };

  setTime(time: number): void {
    this.nowValue = time;
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
    expect(observedVersions).toEqual([1]);
    expect(inventoryInvariantHolds(service.getSnapshot())).toBe(true);
  });
});
