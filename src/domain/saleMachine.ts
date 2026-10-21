import type { Reservation, SaleEvent, SaleState } from "./contracts";

const isReservableState = (state: SaleState): boolean => {
  if (state.tag === "idle" || state.tag === "expired") return true;
  return state.tag === "error" && state.reservation === undefined;
};

const errorForReservation = (
  state: SaleState,
  reservationId: string,
): Reservation | undefined => {
  if (state.tag === "reserved" && state.reservation.id === reservationId) {
    return state.reservation;
  }
  if (
    state.tag === "checkingOut" &&
    state.reservation.id === reservationId
  ) {
    return state.reservation;
  }
  if (
    state.tag === "error" &&
    state.reservation?.id === reservationId
  ) {
    return state.reservation;
  }
  return undefined;
};

export function transition(state: SaleState, event: SaleEvent): SaleState {
  switch (event.type) {
    case "RESERVE_REQUESTED":
      if (!isReservableState(state)) return state;
      return {
        tag: "reserving",
        requestId: event.requestId,
        startedAt: event.startedAt,
        optimisticExpiresAt: event.optimisticExpiresAt,
        inventoryVersion: event.inventoryVersion,
      };

    case "RESERVE_CONFIRMED":
      if (
        state.tag !== "reserving" ||
        state.requestId !== event.requestId ||
        event.reservation.status !== "reserved"
      ) {
        return state;
      }
      return { tag: "reserved", reservation: event.reservation };

    case "RESERVE_REJECTED":
      if (state.tag !== "reserving" || state.requestId !== event.requestId) {
        return state;
      }
      return {
        tag: "error",
        operation: "reserve",
        code: event.code,
        message: event.message,
        retryable: event.retryable,
        requestId: event.requestId,
      };

    case "CHECKOUT_REQUESTED": {
      let reservation: Reservation | undefined;
      if (state.tag === "reserved") {
        reservation = state.reservation;
      } else if (state.tag === "error" && state.retryable) {
        reservation = state.reservation;
      }
      if (
        reservation?.id !== event.reservationId ||
        reservation.status !== "reserved"
      ) {
        return state;
      }
      return {
        tag: "checkingOut",
        reservation,
        attemptId: event.attemptId,
      };
    }

    case "CHECKOUT_CONFIRMED":
      if (
        state.tag !== "checkingOut" ||
        state.reservation.id !== event.reservationId ||
        state.attemptId !== event.attemptId
      ) {
        return state;
      }
      return {
        tag: "completed",
        reservationId: event.reservationId,
        completedAt: event.completedAt,
      };

    case "CHECKOUT_REJECTED":
      if (
        state.tag !== "checkingOut" ||
        state.reservation.id !== event.reservationId ||
        state.attemptId !== event.attemptId
      ) {
        return state;
      }
      if (event.code === "reservation-expired") {
        return {
          tag: "expired",
          reservationId: event.reservationId,
          expiredAt: event.expiredAt,
          message: event.message,
        };
      }
      return {
        tag: "error",
        operation: "checkout",
        code: event.code,
        message: event.message,
        retryable: event.retryable,
        reservation: state.reservation,
      };

    case "RESERVATION_EXPIRED": {
      const reservation = errorForReservation(state, event.reservationId);
      if (!reservation || reservation.status !== "reserved") return state;
      return {
        tag: "expired",
        reservationId: event.reservationId,
        expiredAt: event.expiredAt,
        message: event.message,
      };
    }
  }
}
