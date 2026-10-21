import type {
  CheckoutResult,
  InventoryRuntime,
  InventoryService,
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
export class InMemoryInventoryService implements InventoryService {
  readonly saleEndsAt: number;
  protected readonly runtime: InventoryRuntime;
  protected readonly config: SaleConfig;
  protected readonly reservations = new Map<string, Reservation>();
  protected readonly expiryHandles = new Map<string, number>();
  protected readonly successfulAttempts = new Map<string, Reservation>();
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
    this.expireDue(this.runtime.now());
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
    this.expireDue(now);
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
    this.scheduleExpiry(reservation);
    return { ok: true, reservation, snapshot: this.snapshot };
  }

  releaseReservation(reservationId: string): InventorySnapshot {
    const now = this.runtime.now();
    this.expireDue(now);
    const reservation = this.reservations.get(reservationId);
    if (!reservation || reservation.status !== "reserved") return this.snapshot;

    this.cancelExpiry(reservationId);
    this.reservations.set(
      reservationId,
      Object.freeze({ ...reservation, status: "released" }),
    );
    this.writeSnapshot({
      available: this.snapshot.available + this.config.unitsPerPurchase,
      reserved: this.snapshot.reserved - this.config.unitsPerPurchase,
      sold: this.snapshot.sold,
    });
    return this.snapshot;
  }

  expireReservation(reservationId: string): {
    changed: boolean;
    reservation: Reservation | null;
    snapshot: InventorySnapshot;
  } {
    return this.expireReservationAt(reservationId, this.runtime.now());
  }

  protected expireDue(now: number): void {
    for (const [reservationId, reservation] of this.reservations) {
      if (reservation.status === "reserved" && now >= reservation.expiresAt) {
        this.expireReservationAt(reservationId, now);
      }
    }
  }

  protected expireReservationAt(
    reservationId: string,
    now: number,
  ): {
    changed: boolean;
    reservation: Reservation | null;
    snapshot: InventorySnapshot;
  } {
    const reservation = this.reservations.get(reservationId) ?? null;
    if (
      !reservation ||
      reservation.status !== "reserved" ||
      now < reservation.expiresAt
    ) {
      return { changed: false, reservation, snapshot: this.snapshot };
    }

    this.cancelExpiry(reservationId);
    const expired: Reservation = Object.freeze({ ...reservation, status: "expired" });
    this.reservations.set(reservationId, expired);
    this.writeSnapshot({
      available: this.snapshot.available + this.config.unitsPerPurchase,
      reserved: this.snapshot.reserved - this.config.unitsPerPurchase,
      sold: this.snapshot.sold,
    });
    return { changed: true, reservation: expired, snapshot: this.snapshot };
  }

  protected scheduleExpiry(reservation: Reservation): void {
    let handle = -1;
    handle = this.runtime.schedule(() => {
      if (this.expiryHandles.get(reservation.id) !== handle) return;
      this.expiryHandles.delete(reservation.id);
      const result = this.expireReservationAt(
        reservation.id,
        this.runtime.now(),
      );
      if (!result.changed && result.reservation?.status === "reserved") {
        this.scheduleExpiry(result.reservation);
      }
    }, Math.max(0, reservation.expiresAt - this.runtime.now()));
    this.expiryHandles.set(reservation.id, handle);
  }

  protected cancelExpiry(reservationId: string): void {
    const handle = this.expiryHandles.get(reservationId);
    if (handle === undefined) return;
    this.runtime.cancel(handle);
    this.expiryHandles.delete(reservationId);
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
    for (const listener of [...this.listeners]) {
      try {
        listener(this.snapshot);
      } catch {
        // Observer failures cannot change the result of an already committed mutation.
      }
    }
  }

  async checkout(
    reservationId: string,
    attemptId: string,
  ): Promise<CheckoutResult> {
    await Promise.resolve();

    const previousAttempt = this.successfulAttempts.get(attemptId);
    if (previousAttempt) {
      if (previousAttempt.id === reservationId) {
        return { ok: true, reservation: previousAttempt, snapshot: this.snapshot };
      }
      return {
        ok: false,
        reason: "attempt-id-used",
        message: "This checkout attempt ID already belongs to another reservation.",
        snapshot: this.snapshot,
      };
    }

    const now = this.runtime.now();
    this.expireDue(now);
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      return {
        ok: false,
        reason: "reservation-not-found",
        message: "This reservation could not be found.",
        snapshot: this.snapshot,
      };
    }
    if (reservation.status === "completed") {
      this.successfulAttempts.set(attemptId, reservation);
      return { ok: true, reservation, snapshot: this.snapshot };
    }
    if (reservation.status === "expired") {
      return {
        ok: false,
        reason: "reservation-expired",
        message: "The reservation hold expired before checkout completed.",
        reservation,
        snapshot: this.snapshot,
      };
    }
    if (reservation.status !== "reserved") {
      return {
        ok: false,
        reason: "reservation-not-found",
        message: "This reservation is no longer available for checkout.",
        reservation,
        snapshot: this.snapshot,
      };
    }

    this.cancelExpiry(reservationId);
    const completed: Reservation = Object.freeze({
      ...reservation,
      status: "completed",
    });
    this.reservations.set(reservationId, completed);
    this.successfulAttempts.set(attemptId, completed);
    this.writeSnapshot({
      available: this.snapshot.available,
      reserved: this.snapshot.reserved - this.config.unitsPerPurchase,
      sold: this.snapshot.sold + this.config.unitsPerPurchase,
    });
    return { ok: true, reservation: completed, snapshot: this.snapshot };
  }
}
