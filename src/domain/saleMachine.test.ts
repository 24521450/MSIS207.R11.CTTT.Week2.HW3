import { describe, expect, it } from "vitest";
import type { Reservation, SaleEvent, SaleState } from "./contracts";
import { transition } from "./saleMachine";

const activeReservation: Reservation = {
  id: "reservation-1",
  createdAt: 1_000,
  expiresAt: 16_000,
  status: "reserved",
};

const requestEvent = (requestId: string): SaleEvent => ({
  type: "RESERVE_REQUESTED",
  requestId,
  startedAt: 1_000,
  optimisticExpiresAt: 16_000,
  inventoryVersion: 0,
});

describe("sale state transitions", () => {
  it("moves through optimistic reserve, confirmed hold, and checkout", () => {
    let state: SaleState = { tag: "idle" };
    state = transition(state, requestEvent("request-1"));
    expect(state.tag).toBe("reserving");

    state = transition(state, {
      type: "RESERVE_CONFIRMED",
      requestId: "request-1",
      reservation: activeReservation,
    });
    expect(state).toEqual({ tag: "reserved", reservation: activeReservation });

    state = transition(state, {
      type: "CHECKOUT_REQUESTED",
      reservationId: activeReservation.id,
      attemptId: "attempt-1",
    });
    expect(state.tag).toBe("checkingOut");

    state = transition(state, {
      type: "CHECKOUT_CONFIRMED",
      reservationId: activeReservation.id,
      attemptId: "attempt-1",
      completedAt: 2_000,
    });
    expect(state).toEqual({
      tag: "completed",
      reservationId: activeReservation.id,
      completedAt: 2_000,
    });
  });

  it("ignores reserve responses from an older request", () => {
    let state: SaleState = { tag: "idle" };
    state = transition(state, requestEvent("new-request"));

    const afterOldResponse = transition(state, {
      type: "RESERVE_CONFIRMED",
      requestId: "old-request",
      reservation: activeReservation,
    });

    expect(afterOldResponse).toBe(state);
    expect(afterOldResponse.tag).toBe("reserving");
  });

  it("expires a matching reserve response that arrives after its hold deadline and permits retry", () => {
    const reserving = transition({ tag: "idle" }, requestEvent("request-1"));
    const expired = transition(reserving, {
      type: "RESERVE_EXPIRED",
      requestId: "request-1",
      reservationId: activeReservation.id,
      expiredAt: activeReservation.expiresAt,
      message: "The hold expired before confirmation.",
    });

    expect(expired).toEqual({
      tag: "expired",
      reservationId: activeReservation.id,
      expiredAt: activeReservation.expiresAt,
      message: "The hold expired before confirmation.",
    });
    expect(transition(expired, requestEvent("request-2"))).toMatchObject({
      tag: "reserving",
      requestId: "request-2",
    });
  });

  it("ignores an old expired response while a newer request or reservation is active", () => {
    const oldExpiry: SaleEvent = {
      type: "RESERVE_EXPIRED",
      requestId: "old-request",
      reservationId: "old-reservation",
      expiredAt: 16_000,
      message: "Old delayed response.",
    };
    const newerRequest = transition({ tag: "idle" }, requestEvent("new-request"));
    expect(transition(newerRequest, oldExpiry)).toBe(newerRequest);

    const newerReservation: SaleState = {
      tag: "reserved",
      reservation: { ...activeReservation, id: "new-reservation" },
    };
    expect(transition(newerReservation, oldExpiry)).toBe(newerReservation);

    const completed: SaleState = {
      tag: "completed",
      reservationId: "new-reservation",
      completedAt: 17_000,
    };
    expect(transition(completed, oldExpiry)).toBe(completed);
  });

  it("retains actionable checkout errors, allows retry, and ignores old attempts", () => {
    let state: SaleState = { tag: "reserved", reservation: activeReservation };
    state = transition(state, {
      type: "CHECKOUT_REQUESTED",
      reservationId: activeReservation.id,
      attemptId: "attempt-old",
    });
    state = transition(state, {
      type: "CHECKOUT_REJECTED",
      reservationId: activeReservation.id,
      attemptId: "attempt-old",
      code: "network",
      message: "Connection interrupted. Try again while the hold is active.",
      retryable: true,
      expiredAt: 1_500,
    });
    expect(state.tag).toBe("error");

    const staleResult = transition(state, {
      type: "CHECKOUT_CONFIRMED",
      reservationId: activeReservation.id,
      attemptId: "attempt-old",
      completedAt: 3_000,
    });
    expect(staleResult).toBe(state);

    state = transition(state, {
      type: "CHECKOUT_REQUESTED",
      reservationId: activeReservation.id,
      attemptId: "attempt-new",
    });
    expect(state.tag).toBe("checkingOut");
  });

  it("expires only the matching active reservation and never rewinds completion", () => {
    const reserved: SaleState = { tag: "reserved", reservation: activeReservation };
    const expired = transition(reserved, {
      type: "RESERVATION_EXPIRED",
      reservationId: activeReservation.id,
      expiredAt: 16_000,
      message: "The hold expired.",
    });
    expect(expired.tag).toBe("expired");

    const newer = transition({ tag: "reserved", reservation: { ...activeReservation, id: "new-id" } }, {
      type: "RESERVATION_EXPIRED",
      reservationId: activeReservation.id,
      expiredAt: 16_000,
      message: "Old timer callback.",
    });
    expect(newer.tag).toBe("reserved");

    const completed: SaleState = {
      tag: "completed",
      reservationId: activeReservation.id,
      completedAt: 5_000,
    };
    expect(transition(completed, {
      type: "RESERVATION_EXPIRED",
      reservationId: activeReservation.id,
      expiredAt: 16_000,
      message: "Late expiry callback.",
    })).toBe(completed);
  });
});
