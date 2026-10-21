import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  InventoryService,
  InventorySnapshot,
  Reservation,
  SaleState,
} from "../domain/contracts";
import { SALE_CONFIG } from "../domain/saleConfig";
import { saleInventory } from "../domain/saleSession";
import { transition } from "../domain/saleMachine";
import { useDeadlineCountdown } from "./useDeadlineCountdown";

function newOperationId(): string {
  return crypto.randomUUID();
}

function reservationInState(state: SaleState): Reservation | null {
  if (state.tag === "reserved" || state.tag === "checkingOut") {
    return state.reservation;
  }
  if (state.tag === "error") return state.reservation ?? null;
  return null;
}

export interface SaleController {
  readonly inventory: InventorySnapshot;
  readonly saleRemainingMs: number;
  readonly reservationRemainingMs: number;
  readonly state: SaleState;
  readonly buy: () => Promise<void>;
  readonly checkout: () => Promise<void>;
}

export function useSaleController(
  service: InventoryService = saleInventory,
): SaleController {
  const [state, dispatch] = useReducer(transition, { tag: "idle" });
  const [inventory, setInventory] = useState(() => service.getSnapshot());
  const latestVersion = useRef(inventory.version);
  const inventoryRef = useRef(inventory);
  const mounted = useRef(false);
  const activeReserveRequest = useRef<string | null>(null);
  const activeCheckoutAttempt = useRef<string | null>(null);

  const acceptSnapshot = useCallback((snapshot: InventorySnapshot): void => {
    if (snapshot.version < latestVersion.current) return;
    latestVersion.current = snapshot.version;
    inventoryRef.current = snapshot;
    setInventory(snapshot);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = service.subscribe(acceptSnapshot);
    acceptSnapshot(service.getSnapshot());
    return () => {
      mounted.current = false;
      activeReserveRequest.current = null;
      activeCheckoutAttempt.current = null;
      unsubscribe();
    };
  }, [acceptSnapshot, service]);

  const saleRemainingMs = useDeadlineCountdown(service.saleEndsAt);
  const reservation = reservationInState(state);
  const reservationRemainingMs = useDeadlineCountdown(
    reservation?.expiresAt ?? null,
  );

  useEffect(() => {
    if (
      !reservation ||
      reservationRemainingMs > 0 ||
      Date.now() < reservation.expiresAt
    ) {
      return;
    }
    const result = service.expireReservation(reservation.id);
    acceptSnapshot(result.snapshot);
    if (result.reservation?.status === "expired") {
      dispatch({
        type: "RESERVATION_EXPIRED",
        reservationId: reservation.id,
        expiredAt: result.reservation.expiresAt,
        message: "Thời gian giữ hàng đã hết; sản phẩm được trả lại kho.",
      });
    }
  }, [acceptSnapshot, reservation, reservationRemainingMs, service]);

  const buy = useCallback(async (): Promise<void> => {
    if (activeReserveRequest.current !== null) return;
    if (state.tag === "completed" || state.tag === "reserved" || state.tag === "checkingOut") return;
    if (state.tag === "error" && state.reservation !== undefined) return;

    const requestId = newOperationId();
    const startedAt = Date.now();
    activeReserveRequest.current = requestId;
    dispatch({
      type: "RESERVE_REQUESTED",
      requestId,
      startedAt,
      optimisticExpiresAt: startedAt + SALE_CONFIG.reservationDurationMs,
      inventoryVersion: inventoryRef.current.version,
    });

    if (startedAt >= service.saleEndsAt) {
      activeReserveRequest.current = null;
      dispatch({
        type: "RESERVE_REJECTED",
        requestId,
        code: "sale-ended",
        message: "Phiên flash sale đã kết thúc; không thể giữ thêm sản phẩm.",
        retryable: false,
      });
      return;
    }

    try {
      const result = await service.reserve(requestId);
      if (!mounted.current || activeReserveRequest.current !== requestId) {
        if (result.ok) {
          const released = service.releaseReservation(result.reservation.id);
          if (mounted.current) acceptSnapshot(released);
        }
        return;
      }
      activeReserveRequest.current = null;
      acceptSnapshot(result.snapshot);
      if (result.ok) {
        if (Date.now() >= result.reservation.expiresAt) {
          const expiry = service.expireReservation(result.reservation.id);
          acceptSnapshot(expiry.snapshot);
          dispatch({
            type: "RESERVE_EXPIRED",
            requestId,
            reservationId: result.reservation.id,
            expiredAt: result.reservation.expiresAt,
            message: "Thời gian giữ hàng đã hết trước khi giao diện xác nhận.",
          });
          return;
        }
        dispatch({
          type: "RESERVE_CONFIRMED",
          requestId,
          reservation: result.reservation,
        });
      } else {
        dispatch({
          type: "RESERVE_REJECTED",
          requestId,
          code: result.reason,
          message: result.message,
          retryable: false,
        });
      }
    } catch {
      if (activeReserveRequest.current !== requestId) return;
      activeReserveRequest.current = null;
      dispatch({
        type: "RESERVE_REJECTED",
        requestId,
        code: "reservation-unavailable",
        message: "Chưa thể xác nhận giữ hàng. Bạn có thể thử lại khi phiên sale còn mở.",
        retryable: true,
      });
    }
  }, [acceptSnapshot, service, state]);

  const checkout = useCallback(async (): Promise<void> => {
    if (activeCheckoutAttempt.current !== null) return;
    if (state.tag === "checkingOut" || state.tag === "completed") return;
    if (state.tag === "error" && !state.retryable) return;
    const currentReservation = reservationInState(state);
    if (!currentReservation) return;

    if (Date.now() >= currentReservation.expiresAt) {
      const expiry = service.expireReservation(currentReservation.id);
      acceptSnapshot(expiry.snapshot);
      if (expiry.reservation?.status === "expired") {
        dispatch({
          type: "RESERVATION_EXPIRED",
          reservationId: currentReservation.id,
          expiredAt: expiry.reservation.expiresAt,
          message: "Thời gian giữ hàng đã hết; không thể thanh toán.",
        });
      }
      return;
    }

    const attemptId = newOperationId();
    activeCheckoutAttempt.current = attemptId;
    dispatch({
      type: "CHECKOUT_REQUESTED",
      reservationId: currentReservation.id,
      attemptId,
    });
    try {
      const result = await service.checkout(currentReservation.id, attemptId);
      if (!mounted.current || activeCheckoutAttempt.current !== attemptId) return;
      activeCheckoutAttempt.current = null;
      acceptSnapshot(result.snapshot);
      if (result.ok) {
        dispatch({
          type: "CHECKOUT_CONFIRMED",
          reservationId: currentReservation.id,
          attemptId,
          completedAt: Date.now(),
        });
      } else {
        dispatch({
          type: "CHECKOUT_REJECTED",
          reservationId: currentReservation.id,
          attemptId,
          code: result.reason,
          message: result.message,
          retryable: false,
          expiredAt: Date.now(),
        });
      }
    } catch {
      if (activeCheckoutAttempt.current !== attemptId) return;
      activeCheckoutAttempt.current = null;
      dispatch({
        type: "CHECKOUT_REJECTED",
        reservationId: currentReservation.id,
        attemptId,
        code: "checkout-unavailable",
        message: "Chưa thể xác nhận thanh toán mô phỏng. Hãy thử lại trước khi giữ hàng hết hạn.",
        retryable: Date.now() < currentReservation.expiresAt,
        expiredAt: Date.now(),
      });
    }
  }, [acceptSnapshot, service, state]);

  return {
    inventory,
    saleRemainingMs,
    reservationRemainingMs,
    state,
    buy,
    checkout,
  };
}
