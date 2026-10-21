import type {
  InventoryLedger,
  InventoryRuntime,
  InventorySnapshot,
  Reservation,
  ReserveResult,
  SaleConfig,
} from "./contracts";
import { SALE_CONFIG } from "./saleConfig";

const browserRuntime: InventoryRuntime = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancel: (handle) => window.clearTimeout(handle),
};

export function inventoryInvariantHolds(snapshot: InventorySnapshot): boolean {
  const counts = [snapshot.available, snapshot.reserved, snapshot.sold];
  return (
    counts.every((count) => Number.isInteger(count) && count >= 0) &&
    counts[0] + counts[1] + counts[2] === snapshot.initialStock
  );
}

function validateConfig(config: SaleConfig): void {
  if (
    !Number.isInteger(config.initialStock) ||
    config.initialStock < 0 ||
    config.priceVnd < 0 ||
    config.saleDurationMs <= 0 ||
    config.reservationDurationMs <= 0
  ) {
    throw new RangeError("Sale configuration contains an invalid value.");
  }
}

/**
 * Browser-local inventory ledger. Each async operation yields once before its
 * mutation, then checks and updates the shared ledger synchronously.
 */
export class InMemoryInventoryService implements InventoryLedger {
  readonly saleEndsAt: number;
  protected readonly runtime: InventoryRuntime;
  protected readonly config: SaleConfig;
  protected readonly reservations = new Map<string, Reservation>();
  protected readonly listeners = new Set<(snapshot: InventorySnapshot) => void>();
  protected snapshot: InventorySnapshot;

  constructor(
    config: SaleConfig = SALE_CONFIG,
    runtime: InventoryRuntime = browserRuntime,
  ) {
    validateConfig(config);
    this.config = config;
    this.runtime = runtime;
    this.saleEndsAt = runtime.now() + config.saleDurationMs;
    this.snapshot = Object.freeze({
      initialStock: config.initialStock,
      available: config.initialStock,
      reserved: 0,
      sold: 0,
      version: 0,
    });
  }

  getSnapshot(): InventorySnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: InventorySnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async reserve(requestId: string): Promise<ReserveResult> {
    // This yield makes calls truly asynchronous at the API boundary. Everything
    // below the await is one uninterrupted read/check/write critical section.
    await Promise.resolve();
    const now = this.runtime.now();
    const existing = this.reservations.get(requestId);
    if (existing) {
      if (existing.status === "reserved") {
        return { ok: true, reservation: existing, snapshot: this.snapshot };
      }
      return {
        ok: false,
        reason: "request-id-used",
        message: "This reservation request has already been processed.",
        snapshot: this.snapshot,
      };
    }
    if (now >= this.saleEndsAt) {
      return {
        ok: false,
        reason: "sale-ended",
        message: "The flash sale has ended. New reservations are closed.",
        snapshot: this.snapshot,
      };
    }
    if (this.snapshot.available < this.config.unitsPerPurchase) {
      return {
        ok: false,
        reason: "sold-out",
        message: "This item has sold out.",
        snapshot: this.snapshot,
      };
    }

    const reservation: Reservation = Object.freeze({
      id: requestId,
      createdAt: now,
      expiresAt: now + this.config.reservationDurationMs,
      status: "reserved",
    });
    this.reservations.set(reservation.id, reservation);
    this.writeSnapshot({
      available: this.snapshot.available - this.config.unitsPerPurchase,
      reserved: this.snapshot.reserved + this.config.unitsPerPurchase,
      sold: this.snapshot.sold,
    });
    return { ok: true, reservation, snapshot: this.snapshot };
  }

  protected writeSnapshot(
    counts: Pick<InventorySnapshot, "available" | "reserved" | "sold">,
  ): void {
    this.snapshot = Object.freeze({
      ...this.snapshot,
      ...counts,
      version: this.snapshot.version + 1,
    });
    if (!inventoryInvariantHolds(this.snapshot)) {
      throw new Error("Inventory invariant failed after an atomic update.");
    }
    for (const listener of [...this.listeners]) listener(this.snapshot);
  }
}
