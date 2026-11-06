import { db } from "../database/connection.js";

export interface BookingBill {
  bookingId: string;
  reference: string;
  status: string;

  accommodationTotal: number;
  adultEntranceTotal: number;
  childEntranceTotal: number;
  servicesTotal: number;
  foodTotal: number;

  subtotal: number;
  verifiedPayments: number;
  submittedPayments: number;
  remainingBalance: number;
  availableToSubmit: number;
}

export function getBookingBill(bookingId: string): BookingBill {
  const booking = db.prepare(`
    SELECT
      id,
      reference,
      status,
      total,
      accommodation_total,
      adult_entrance_total,
      child_entrance_total,
      services_total
    FROM bookings
    WHERE id = ?
  `).get(bookingId) as any;

  if (!booking) {
    throw new Error("Booking not found");
  }

  // Food orders are included unless they are cancelled.
  const foodResult = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS total
    FROM food_orders
    WHERE booking_id = ?
      AND status != 'CANCELLED'
  `).get(bookingId) as { total: number };

  // Only verified payments count as money received.
  const paymentResult = db.prepare(`
    SELECT
      COALESCE(SUM(
        CASE WHEN status = 'VERIFIED' THEN amount ELSE 0 END
      ), 0) AS verified,
      COALESCE(SUM(
        CASE WHEN status = 'SUBMITTED' THEN amount ELSE 0 END
      ), 0) AS submitted
    FROM payments
    WHERE booking_id = ?
  `).get(bookingId) as {
    verified: number;
    submitted: number;
  };

  const accommodationTotal = Number(booking.accommodation_total ?? 0);
  const adultEntranceTotal = Number(booking.adult_entrance_total ?? 0);
  const childEntranceTotal = Number(booking.child_entrance_total ?? 0);
  const servicesTotal = Number(booking.services_total ?? 0);
  const foodTotal = Number(foodResult.total ?? 0);

  // bookings.total already contains the original booking charges.
  // Add food orders to create the consolidated bill.
  const subtotal = Number(booking.total) + foodTotal;

  const verifiedPayments = Number(paymentResult.verified);
  const submittedPayments = Number(paymentResult.submitted);

  // Submitted GCash payments are NOT considered paid.
  const remainingBalance = Math.max(
    0,
    subtotal - verifiedPayments
  );

  // Prevent customers from submitting overlapping payments
  // that together exceed the outstanding balance.
  const availableToSubmit = Math.max(
    0,
    remainingBalance - submittedPayments
  );

  return {
    bookingId: booking.id,
    reference: booking.reference,
    status: booking.status,

    accommodationTotal,
    adultEntranceTotal,
    childEntranceTotal,
    servicesTotal,
    foodTotal,

    subtotal: Math.round(subtotal * 100) / 100,
    verifiedPayments: Math.round(verifiedPayments * 100) / 100,
    submittedPayments: Math.round(submittedPayments * 100) / 100,
    remainingBalance: Math.round(remainingBalance * 100) / 100,
    availableToSubmit: Math.round(availableToSubmit * 100) / 100,
  };
}