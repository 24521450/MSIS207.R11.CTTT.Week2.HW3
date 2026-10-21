export type ReservationStatus = "reserved" | "expired" | "completed" | "released";

export interface Reservation {
  readonly id: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly status: ReservationStatus;
}

export interface InventorySnapshot {
  readonly initialStock: number;
  readonly available: number;
  readonly reserved: number;
  readonly sold: number;
  readonly version: number;
}

export type SaleState =
  | { readonly tag: "idle" }
  | {
      readonly tag: "reserving";
      readonly requestId: string;
      readonly startedAt: number;
      readonly optimisticExpiresAt: number;
      readonly inventoryVersion: number;
    }
  | { readonly tag: "reserved"; readonly reservation: Reservation }
  | {
      readonly tag: "checkingOut";
      readonly reservation: Reservation;
      readonly attemptId: string;
    }
  | {
      readonly tag: "completed";
      readonly reservationId: string;
      readonly completedAt: number;
    }
  | {
      readonly tag: "expired";
      readonly reservationId: string;
      readonly expiredAt: number;
      readonly message: string;
    }
  | {
      readonly tag: "error";
      readonly operation: "reserve" | "checkout";
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
      readonly requestId?: string;
      readonly reservation?: Reservation;
    };

export type SaleEvent =
  | {
      readonly type: "RESERVE_REQUESTED";
      readonly requestId: string;
      readonly startedAt: number;
      readonly optimisticExpiresAt: number;
      readonly inventoryVersion: number;
    }
  | {
      readonly type: "RESERVE_CONFIRMED";
      readonly requestId: string;
      readonly reservation: Reservation;
    }
  | {
      readonly type: "RESERVE_REJECTED";
      readonly requestId: string;
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
    }
  | {
      readonly type: "CHECKOUT_REQUESTED";
      readonly reservationId: string;
      readonly attemptId: string;
    }
  | {
      readonly type: "CHECKOUT_CONFIRMED";
      readonly reservationId: string;
      readonly attemptId: string;
      readonly completedAt: number;
    }
  | {
      readonly type: "CHECKOUT_REJECTED";
      readonly reservationId: string;
      readonly attemptId: string;
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
      readonly expiredAt: number;
    }
  | {
      readonly type: "RESERVATION_EXPIRED";
      readonly reservationId: string;
      readonly expiredAt: number;
      readonly message: string;
    };

export interface SaleConfig {
  readonly productName: string;
  readonly priceVnd: number;
  readonly initialStock: number;
  readonly unitsPerPurchase: 1;
  readonly saleDurationMs: number;
  readonly reservationDurationMs: number;
}

export type ReserveResult =
  | {
      readonly ok: true;
      readonly reservation: Reservation;
      readonly snapshot: InventorySnapshot;
    }
  | {
      readonly ok: false;
      readonly reason: "sale-ended" | "sold-out";
      readonly message: string;
      readonly snapshot: InventorySnapshot;
    };

export type CheckoutResult =
  | {
      readonly ok: true;
      readonly reservation: Reservation;
      readonly snapshot: InventorySnapshot;
    }
  | {
      readonly ok: false;
      readonly reason: "reservation-expired" | "reservation-not-found";
      readonly message: string;
      readonly reservation?: Reservation;
      readonly snapshot: InventorySnapshot;
    };

export interface ExpiryResult {
  readonly changed: boolean;
  readonly reservation: Reservation | null;
  readonly snapshot: InventorySnapshot;
}

export interface InventoryRuntime {
  readonly now: () => number;
  readonly schedule: (callback: () => void, delayMs: number) => number;
  readonly cancel: (handle: number) => void;
}

export interface InventoryService {
  readonly saleEndsAt: number;
  getSnapshot(): InventorySnapshot;
  subscribe(listener: (snapshot: InventorySnapshot) => void): () => void;
  reserve(requestId: string): Promise<ReserveResult>;
  releaseReservation(reservationId: string): InventorySnapshot;
  expireReservation(reservationId: string): ExpiryResult;
  checkout(reservationId: string, attemptId: string): Promise<CheckoutResult>;
}

export interface DeadlineTimerRuntime {
  readonly now?: () => number;
  readonly requestFrame: (callback: (timestamp: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly subscribeVisibility?: (listener: () => void) => () => void;
}
