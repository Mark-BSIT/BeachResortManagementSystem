import { Router } from "express";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { db } from "../database/connection.js";
import { env } from "../config/env.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { bookingService } from "../services/booking.service.js";
import { enqueueEvent } from "../services/outbox.service.js";
import { getBookingBill } from "../services/billing.service.js";
export const api = Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const registerSchema = z.object({
    email: z.string().email().max(254),
    password: z.string().min(8).max(72),
    fullName: z.string().trim().min(2).max(100),
    phone: z.string().max(30).optional(),
});
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1).max(72),
});
const bookingSchema = z.object({
    accommodationId: z.string().min(1),
    kind: z.enum(["DAY_USE", "OVERNIGHT"]),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    adults: z.number().int().min(1).max(100),
    children: z.number().int().min(0).max(100),
    serviceIds: z.array(z.string()).max(10).optional(),
    specialRequest: z.string().max(500).optional(),
});
const idSchema = z.string().uuid();
api.get("/health", (_req, res) => res.json({
    status: "ok",
    service: "beach-resort-api",
    time: new Date().toISOString(),
}));
const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many authentication attempts. Try again later." },
});
api.post("/auth/register", authLimiter, asyncRoute(async (req, res) => {
    const data = registerSchema.parse(req.body);
    const exists = db
        .prepare("SELECT id FROM users WHERE email=?")
        .get(data.email);
    if (exists) {
        res.status(409).json({ error: "Email is already registered" });
        return;
    }
    const id = randomUUID();
    const hash = await bcrypt.hash(data.password, 12);
    db.prepare("INSERT INTO users(id,email,password_hash,role,full_name,phone) VALUES(?,?,?,'CUSTOMER',?,?)").run(id, data.email, hash, data.fullName, data.phone ?? null);
    enqueueEvent("userRegistered", { userId: id, email: data.email });
    res.status(201).json({ message: "Account created. You can now sign in." });
}));
api.post("/auth/login", authLimiter, asyncRoute(async (req, res) => {
    const data = loginSchema.parse(req.body);
    const user = db
        .prepare("SELECT * FROM users WHERE email=? AND is_active=1")
        .get(data.email);
    if (!user || !(await bcrypt.compare(data.password, user.password_hash))) {
        res.status(401).json({ error: "Email or password is incorrect" });
        return;
    }
    const token = jwt.sign({ role: user.role }, env.JWT_SECRET, {
        subject: user.id,
        expiresIn: env.JWT_EXPIRES_IN,
    });
    enqueueEvent("userLoggedIn", { userId: user.id });
    res.json({
        token,
        user: {
            id: user.id,
            email: user.email,
            role: user.role,
            fullName: user.full_name,
        },
    });
}));
api.post("/auth/logout", authenticate, (req, res) => {
    enqueueEvent("userLoggedOut", { userId: req.user.id });
    res.json({ message: "Logged out. Remove the token from secure storage." });
});
api.get("/auth/me", authenticate, (req, res) => res.json({ user: req.user }));
api.get("/accommodations", (req, res) => {
    const category = typeof req.query.category === "string" ? req.query.category : null;
    const rows = category
        ? db
            .prepare("SELECT * FROM accommodations WHERE is_active=1 AND category=? ORDER BY name")
            .all(category)
        : db
            .prepare("SELECT * FROM accommodations WHERE is_active=1 ORDER BY name")
            .all();
    res.json({ data: rows });
});
api.get("/accommodations/:id", (req, res) => {
    const row = db
        .prepare("SELECT * FROM accommodations WHERE id=? AND is_active=1")
        .get(req.params.id);
    if (!row) {
        res.status(404).json({ error: "Accommodation not found" });
        return;
    }
    res.json({ data: row });
});
api.get("/services", (_req, res) => res.json({
    data: db
        .prepare("SELECT * FROM services WHERE is_active=1 ORDER BY name")
        .all(),
}));
const functionHallDate = (value) => new Date(value).toISOString().slice(0, 19).replace("T", " ");
const functionHallReservationSchema = z.object({
    functionHallId: z.string().min(1),
    eventType: z.string().trim().min(2).max(100),
    guestCount: z.number().int().min(1).max(1000),
    rentalType: z.enum(["HOURLY", "WHOLE_DAY"]),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    specialRequest: z.string().max(500).optional(),
});
// List active Function Halls
api.get("/function-halls", (_req, res) => {
    const rows = db
        .prepare("SELECT * FROM function_halls WHERE is_active=1 ORDER BY name")
        .all();
    res.json({ data: rows });
});
// Check Function Hall availability
api.get("/function-halls/:id/availability", (req, res) => {
    const query = z
        .object({
        startAt: z.string().datetime(),
        endAt: z.string().datetime(),
    })
        .parse(req.query);
    const start = new Date(query.startAt);
    const end = new Date(query.endAt);
    if (start >= end || start <= new Date()) {
        res.status(400).json({ error: "Invalid reservation date range" });
        return;
    }
    const hall = db
        .prepare("SELECT id FROM function_halls WHERE id=? AND is_active=1")
        .get(req.params.id);
    if (!hall) {
        res.status(404).json({ error: "Function Hall not found or unavailable" });
        return;
    }
    const conflict = db
        .prepare(`
      SELECT id
      FROM function_hall_bookings
      WHERE function_hall_id=?
        AND status IN ('PENDING', 'CONFIRMED')
        AND start_at < ?
        AND end_at > ?
      LIMIT 1
    `)
        .get(req.params.id, functionHallDate(query.endAt), functionHallDate(query.startAt));
    res.json({ available: !conflict });
});
// Customer submits a Function Hall reservation
api.post("/function-hall-bookings", authenticate, requireRole("CUSTOMER"), (req, res) => {
    const d = functionHallReservationSchema.parse(req.body);
    const start = new Date(d.startAt);
    const end = new Date(d.endAt);
    const durationHours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);
    if (start <= new Date() || end <= start) {
        res.status(400).json({ error: "Please select a valid future schedule" });
        return;
    }
    if (d.rentalType === "WHOLE_DAY" && durationHours !== 8) {
        res.status(400).json({
            error: "Whole-day Function Hall rental must be exactly 8 hours",
        });
        return;
    }
    if (d.rentalType === "HOURLY" &&
        (!Number.isInteger(durationHours) || durationHours < 1)) {
        res.status(400).json({
            error: "Hourly rental must be at least 1 hour in whole-hour increments",
        });
        return;
    }
    const tx = db.transaction(() => {
        const hall = db
            .prepare("SELECT * FROM function_halls WHERE id=? AND is_active=1")
            .get(d.functionHallId);
        if (!hall) {
            throw new Error("Function Hall not found or unavailable");
        }
        if (d.guestCount > Number(hall.capacity)) {
            throw new Error("Guest count exceeds Function Hall capacity");
        }
        const startAt = functionHallDate(d.startAt);
        const endAt = functionHallDate(d.endAt);
        const conflict = db
            .prepare(`
          SELECT id
          FROM function_hall_bookings
          WHERE function_hall_id=?
            AND status IN ('PENDING', 'CONFIRMED')
            AND start_at < ?
            AND end_at > ?
          LIMIT 1
        `)
            .get(d.functionHallId, endAt, startAt);
        if (conflict) {
            throw new Error("Function Hall is not available for this schedule");
        }
        const hourlyRate = Number(hall.hourly_rate);
        const wholeDayRate = Number(hall.whole_day_rate);
        const total = d.rentalType === "WHOLE_DAY"
            ? wholeDayRate
            : hourlyRate * durationHours;
        const id = randomUUID();
        const reference = `FH-${randomUUID().slice(0, 8).toUpperCase()}`;
        db.prepare(`
        INSERT INTO function_hall_bookings (
          id, reference, customer_id, function_hall_id,
          event_type, guest_count, rental_type,
          start_at, end_at, hourly_rate, whole_day_rate,
          total, special_request, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
      `).run(id, reference, req.user.id, d.functionHallId, d.eventType, d.guestCount, d.rentalType, startAt, endAt, hourlyRate, wholeDayRate, total, d.specialRequest ?? null);
        enqueueEvent("functionHallBookingSubmitted", {
            bookingId: id,
            customerId: req.user.id,
            functionHallId: d.functionHallId,
        });
        const admins = db
            .prepare("SELECT id FROM users WHERE role='ADMIN' AND is_active=1")
            .all();
        const notify = db.prepare(`
        INSERT INTO notifications (id, user_id, title, message, type)
        VALUES (?, ?, ?, ?, 'BOOKING')
      `);
        for (const admin of admins) {
            notify.run(randomUUID(), admin.id, "New Function Hall reservation", `Function Hall reservation ${reference} needs your approval.`);
        }
        return {
            id,
            reference,
            status: "PENDING",
            total,
            message: "Function Hall reservation submitted for admin approval",
        };
    });
    res.status(201).json({ data: tx.immediate() });
});
// Customer views their Function Hall reservations
api.get("/function-hall-bookings/mine", authenticate, requireRole("CUSTOMER"), (req, res) => {
    const rows = db
        .prepare(`
        SELECT b.*, h.name AS function_hall_name
        FROM function_hall_bookings b
        JOIN function_halls h ON h.id=b.function_hall_id
        WHERE b.customer_id=?
        ORDER BY b.created_at DESC
      `)
        .all(req.user.id);
    res.json({ data: rows });
});
api.get("/bookings/availability", (req, res) => {
    const q = z
        .object({
        accommodationId: z.string().min(1),
        startAt: z.string().datetime(),
        endAt: z.string().datetime(),
    })
        .parse(req.query);
    if (new Date(q.startAt) >= new Date(q.endAt)) {
        res.status(400).json({ error: "Invalid reservation date range" });
        return;
    }
    const accommodation = db
        .prepare("SELECT id FROM accommodations WHERE id=? AND is_active=1")
        .get(q.accommodationId);
    if (!accommodation) {
        res.status(404).json({ error: "Accommodation not found or unavailable" });
        return;
    }
    const conflict = db
        .prepare("SELECT id FROM bookings WHERE accommodation_id=? AND status IN ('PENDING','CONFIRMED','CHECKED_IN') AND start_at < ? AND end_at > ? LIMIT 1")
        .get(q.accommodationId, q.endAt, q.startAt);
    res.json({ available: !conflict });
});
api.post("/bookings", authenticate, requireRole("CUSTOMER"), (req, res) => {
    const data = bookingSchema.parse(req.body);
    const result = bookingService.create({ ...data, customerId: req.user.id });
    res.status(201).json({ data: result });
});
api.get("/bookings/mine", authenticate, requireRole("CUSTOMER"), (req, res) => {
    const rows = db
        .prepare("SELECT b.*,a.name AS accommodation_name FROM bookings b JOIN accommodations a ON a.id=b.accommodation_id WHERE b.customer_id=? ORDER BY b.created_at DESC")
        .all(req.user.id);
    res.json({ data: rows });
});
api.get("/bookings/:id", authenticate, (req, res) => {
    const row = db
        .prepare("SELECT b.*,a.name AS accommodation_name FROM bookings b JOIN accommodations a ON a.id=b.accommodation_id WHERE b.id=?")
        .get(req.params.id);
    if (!row) {
        res.status(404).json({ error: "Booking not found" });
        return;
    }
    if (req.user.role !== "ADMIN" && row.customer_id !== req.user.id) {
        res.status(404).json({ error: "Booking not found" });
        return;
    }
    res.json({ data: row });
});
// Get consolidated bill for a booking
api.get("/bookings/:id/bill", authenticate, (req, res) => {
    const booking = db
        .prepare("SELECT id, customer_id FROM bookings WHERE id = ?")
        .get(req.params.id);
    if (!booking ||
        (req.user.role !== "ADMIN" && booking.customer_id !== req.user.id)) {
        res.status(404).json({ error: "Booking not found" });
        return;
    }
    const bill = getBookingBill(booking.id);
    res.json({ data: bill });
});
api.post("/bookings/:id/cancel", authenticate, requireRole("CUSTOMER"), (req, res) => {
    const bookingId = req.params.id;
    if (typeof bookingId !== "string" || !bookingId) {
        res.status(400).json({ error: "Invalid booking ID" });
        return;
    }
    const row = db
        .prepare("SELECT customer_id FROM bookings WHERE id=?")
        .get(bookingId);
    if (!row || row.customer_id !== req.user.id) {
        res.status(404).json({ error: "Booking not found" });
        return;
    }
    res.json({
        data: bookingService.setStatus(bookingId, "CANCELLED", req.user.id),
    });
});
api.get("/notifications", authenticate, (req, res) => res.json({
    data: db
        .prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100")
        .all(req.user.id),
}));
api.patch("/notifications/:id/read", authenticate, (req, res) => {
    const result = db
        .prepare("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?")
        .run(req.params.id, req.user.id);
    if (!result.changes) {
        res.status(404).json({ error: "Notification not found" });
        return;
    }
    enqueueEvent("notificationRead", {
        notificationId: req.params.id,
        userId: req.user.id,
    });
    res.json({ message: "Notification marked as read" });
});
api.post("/payments", authenticate, requireRole("CUSTOMER"), (req, res) => {
    const schema = z.object({
        bookingId: z.string().min(1),
        method: z.literal("GCASH"),
        amount: z.number().positive(),
        referenceNumber: z.string().min(1).max(100),
        proofPath: z.string().max(500).optional(),
    });
    const d = schema.parse(req.body);
    const tx = db.transaction(() => {
        const booking = db
            .prepare("SELECT * FROM bookings WHERE id=? AND customer_id=?")
            .get(d.bookingId, req.user.id);
        if (!booking || !["PENDING", "CONFIRMED"].includes(booking.status)) {
            throw new Error("Eligible booking not found");
        }
        const bill = getBookingBill(d.bookingId);
        if (d.amount > bill.availableToSubmit + 0.001) {
            throw new Error("Payment exceeds the available balance");
        }
        if (d.amount <= 0) {
            throw new Error("Payment amount must be greater than zero");
        }
        const id = randomUUID();
        db.prepare(`
      INSERT INTO payments (
        id,
        booking_id,
        customer_id,
        method,
        amount,
        reference_number,
        proof_path,
        status
      )
      VALUES (?, ?, ?, 'GCASH', ?, ?, ?, 'SUBMITTED')
    `).run(id, d.bookingId, req.user.id, d.amount, d.referenceNumber, d.proofPath ?? null);
        enqueueEvent("paymentSubmitted", {
            paymentId: id,
            bookingId: d.bookingId,
        });
        const admins = db
            .prepare("SELECT id FROM users WHERE role='ADMIN' AND is_active=1")
            .all();
        const notify = db.prepare(`
      INSERT INTO notifications (
        id, user_id, title, message, type
      )
      VALUES (?, ?, ?, ?, ?)
    `);
        for (const admin of admins) {
            notify.run(randomUUID(), admin.id, "Payment submitted", `A GCash payment for booking ${booking.reference} needs review.`, "PAYMENT");
        }
        return {
            id,
            status: "SUBMITTED",
            message: "GCash payment submitted for manual verification",
        };
    });
    res.status(201).json({ data: tx.immediate() });
});
api.get("/payments/mine", authenticate, requireRole("CUSTOMER"), (req, res) => res.json({
    data: db
        .prepare("SELECT * FROM payments WHERE customer_id=? ORDER BY created_at DESC")
        .all(req.user.id),
}));
// Function Hall bill calculation
function getFunctionHallBill(bookingId) {
    const booking = db
        .prepare(`
      SELECT id, reference, customer_id, total, status
      FROM function_hall_bookings
      WHERE id=?
    `)
        .get(bookingId);
    if (!booking) {
        throw new Error("Function Hall booking not found");
    }
    const payments = db
        .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status='VERIFIED' THEN amount ELSE 0 END), 0)
          AS verifiedPayments,
        COALESCE(SUM(CASE WHEN status='SUBMITTED' THEN amount ELSE 0 END), 0)
          AS submittedPayments
      FROM function_hall_payments
      WHERE function_hall_booking_id=?
    `)
        .get(bookingId);
    const total = Number(booking.total);
    const verifiedPayments = Number(payments.verifiedPayments);
    const submittedPayments = Number(payments.submittedPayments);
    const remainingBalance = Math.max(0, total - verifiedPayments);
    return {
        bookingId,
        reference: booking.reference,
        status: booking.status,
        total,
        verifiedPayments,
        submittedPayments,
        remainingBalance,
        availableToSubmit: Math.max(0, remainingBalance - submittedPayments),
    };
}
// Customer views Function Hall bill
api.get("/function-hall-bookings/:id/bill", authenticate, (req, res) => {
    const booking = db
        .prepare("SELECT id, customer_id FROM function_hall_bookings WHERE id=?")
        .get(req.params.id);
    if (!booking ||
        (req.user.role !== "ADMIN" &&
            booking.customer_id !== req.user.id)) {
        res.status(404).json({ error: "Function Hall booking not found" });
        return;
    }
    res.json({ data: getFunctionHallBill(booking.id) });
});
// Customer submits GCash or Bank Transfer payment
api.post("/function-hall-bookings/:id/payments", authenticate, requireRole("CUSTOMER"), (req, res) => {
    const d = z
        .object({
        method: z.enum(["GCASH", "BANK_TRANSFER"]),
        amount: z.number().positive(),
        referenceNumber: z.string().trim().min(1).max(100),
        proofPath: z.string().trim().min(1).max(500),
    })
        .parse(req.body);
    const tx = db.transaction(() => {
        const booking = db
            .prepare(`
          SELECT *
          FROM function_hall_bookings
          WHERE id=? AND customer_id=?
        `)
            .get(req.params.id, req.user.id);
        if (!booking ||
            !["PENDING", "CONFIRMED"].includes(booking.status)) {
            throw new Error("Eligible Function Hall booking not found");
        }
        const bill = getFunctionHallBill(booking.id);
        if (d.amount > bill.availableToSubmit + 0.001) {
            throw new Error("Payment exceeds the available balance");
        }
        const id = randomUUID();
        db.prepare(`
        INSERT INTO function_hall_payments (
          id,
          function_hall_booking_id,
          customer_id,
          method,
          amount,
          reference_number,
          proof_path,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'SUBMITTED')
      `).run(id, booking.id, req.user.id, d.method, d.amount, d.referenceNumber, d.proofPath);
        enqueueEvent("functionHallPaymentSubmitted", {
            paymentId: id,
            bookingId: booking.id,
            customerId: req.user.id,
        });
        const admins = db
            .prepare("SELECT id FROM users WHERE role='ADMIN' AND is_active=1")
            .all();
        const notify = db.prepare(`
        INSERT INTO notifications (
          id, user_id, title, message, type
        )
        VALUES (?, ?, ?, ?, 'PAYMENT')
      `);
        for (const admin of admins) {
            notify.run(randomUUID(), admin.id, "Function Hall payment submitted", `Payment for reservation ${booking.reference} needs verification.`);
        }
        return {
            id,
            status: "SUBMITTED",
            message: "Payment submitted for admin verification",
        };
    });
    res.status(201).json({ data: tx.immediate() });
});
// Customer views their Function Hall payment history
api.get("/function-hall-payments/mine", authenticate, requireRole("CUSTOMER"), (req, res) => {
    const rows = db
        .prepare(`
        SELECT p.*, b.reference AS booking_reference
        FROM function_hall_payments p
        JOIN function_hall_bookings b
          ON b.id=p.function_hall_booking_id
        WHERE p.customer_id=?
        ORDER BY p.created_at DESC
      `)
        .all(req.user.id);
    res.json({ data: rows });
});
api.use("/admin", authenticate, requireRole("ADMIN"));
/* =========================================
   ADMIN — FUNCTION HALL MANAGEMENT
========================================= */
// View all Function Halls
api.get("/admin/function-halls", (_req, res) => {
    const rows = db
        .prepare(`
      SELECT *
      FROM function_halls
      ORDER BY created_at DESC
    `)
        .all();
    res.json({ data: rows });
});
// Add a Function Hall
api.post("/admin/function-halls", (req, res) => {
    const d = z
        .object({
        name: z.string().trim().min(2).max(100),
        description: z.string().max(1000).default(""),
        capacity: z.number().int().positive(),
        hourlyRate: z.number().nonnegative(),
        wholeDayRate: z.number().nonnegative(),
        imageUrl: z.string().url().optional(),
    })
        .parse(req.body);
    const id = randomUUID();
    db.prepare(`
    INSERT INTO function_halls (
      id,
      name,
      description,
      capacity,
      hourly_rate,
      whole_day_rate,
      whole_day_hours,
      image_url,
      is_active
    )
    VALUES (?, ?, ?, ?, ?, ?, 8, ?, 1)
  `).run(id, d.name, d.description, d.capacity, d.hourlyRate, d.wholeDayRate, d.imageUrl ?? null);
    res.status(201).json({
        data: { id },
        message: "Function Hall created successfully",
    });
});
// Update Function Hall details and pricing
api.patch("/admin/function-halls/:id", (req, res) => {
    const id = req.params.id;
    if (!id) {
        res.status(400).json({ error: "Invalid Function Hall ID" });
        return;
    }
    const d = z
        .object({
        name: z.string().trim().min(2).max(100).optional(),
        description: z.string().max(1000).optional(),
        capacity: z.number().int().positive().optional(),
        hourlyRate: z.number().nonnegative().optional(),
        wholeDayRate: z.number().nonnegative().optional(),
        imageUrl: z.string().url().nullable().optional(),
        isActive: z.boolean().optional(),
    })
        .refine((data) => Object.values(data).some((value) => value !== undefined), { message: "Provide at least one field to update" })
        .parse(req.body);
    const existing = db
        .prepare("SELECT id FROM function_halls WHERE id=?")
        .get(id);
    if (!existing) {
        res.status(404).json({ error: "Function Hall not found" });
        return;
    }
    const fields = {
        name: d.name,
        description: d.description,
        capacity: d.capacity,
        hourly_rate: d.hourlyRate,
        whole_day_rate: d.wholeDayRate,
        image_url: d.imageUrl,
        is_active: d.isActive === undefined ? undefined : Number(d.isActive),
    };
    const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
    db.prepare(`
    UPDATE function_halls
    SET ${entries.map(([key]) => `${key}=?`).join(", ")}
    WHERE id=?
  `).run(...entries.map(([, value]) => value), id);
    res.json({ message: "Function Hall updated successfully" });
});
// Deactivate Function Hall (preserve existing bookings)
api.delete("/admin/function-halls/:id", (req, res) => {
    const id = req.params.id;
    if (!id) {
        res.status(400).json({ error: "Invalid Function Hall ID" });
        return;
    }
    const result = db
        .prepare(`
      UPDATE function_halls
      SET is_active=0
      WHERE id=?
    `)
        .run(id);
    if (!result.changes) {
        res.status(404).json({ error: "Function Hall not found" });
        return;
    }
    res.json({
        message: "Function Hall deactivated successfully",
    });
});
/* =========================================
   ADMIN — FUNCTION HALL RESERVATIONS
========================================= */
// View and filter Function Hall reservations
api.get("/admin/function-hall-bookings", (req, res) => {
    const statusSchema = z.enum([
        "PENDING",
        "CONFIRMED",
        "REJECTED",
        "CANCELLED",
        "COMPLETED",
    ]);
    const status = typeof req.query.status === "string"
        ? statusSchema.parse(req.query.status)
        : null;
    const rows = status
        ? db.prepare(`
        SELECT
          b.*,
          h.name AS function_hall_name,
          u.full_name AS customer_name,
          u.email AS customer_email,
          u.phone AS customer_phone
        FROM function_hall_bookings b
        JOIN function_halls h ON h.id=b.function_hall_id
        JOIN users u ON u.id=b.customer_id
        WHERE b.status=?
        ORDER BY b.created_at DESC
      `).all(status)
        : db.prepare(`
        SELECT
          b.*,
          h.name AS function_hall_name,
          u.full_name AS customer_name,
          u.email AS customer_email,
          u.phone AS customer_phone
        FROM function_hall_bookings b
        JOIN function_halls h ON h.id=b.function_hall_id
        JOIN users u ON u.id=b.customer_id
        ORDER BY b.created_at DESC
      `).all();
    res.json({ data: rows });
});
// Approve, reject, or cancel a Function Hall reservation
api.patch("/admin/function-hall-bookings/:id/status", (req, res) => {
    const id = req.params.id;
    if (!id) {
        res.status(400).json({ error: "Invalid reservation ID" });
        return;
    }
    const d = z
        .object({
        status: z.enum(["CONFIRMED", "REJECTED", "CANCELLED"]),
    })
        .parse(req.body);
    const tx = db.transaction(() => {
        const booking = db
            .prepare(`
        SELECT *
        FROM function_hall_bookings
        WHERE id=?
      `)
            .get(id);
        if (!booking) {
            throw new Error("Function Hall reservation not found");
        }
        if (!["PENDING", "CONFIRMED"].includes(booking.status)) {
            throw new Error("This reservation can no longer be updated");
        }
        if (d.status === "CONFIRMED") {
            const conflict = db
                .prepare(`
          SELECT id
          FROM function_hall_bookings
          WHERE function_hall_id=?
            AND id != ?
            AND status='CONFIRMED'
            AND start_at < ?
            AND end_at > ?
          LIMIT 1
        `)
                .get(booking.function_hall_id, booking.id, booking.end_at, booking.start_at);
            if (conflict) {
                throw new Error("Cannot approve: another confirmed reservation overlaps this schedule");
            }
        }
        db.prepare(`
      UPDATE function_hall_bookings
      SET status=?
      WHERE id=?
    `).run(d.status, id);
        const eventName = d.status === "CONFIRMED"
            ? "functionHallBookingApproved"
            : d.status === "REJECTED"
                ? "functionHallBookingRejected"
                : "functionHallBookingCancelled";
        enqueueEvent(eventName, {
            bookingId: booking.id,
            customerId: booking.customer_id,
            functionHallId: booking.function_hall_id,
        });
        const messages = {
            CONFIRMED: {
                title: "Function Hall reservation approved",
                message: `Your reservation ${booking.reference} has been approved.`,
            },
            REJECTED: {
                title: "Function Hall reservation rejected",
                message: `Your reservation ${booking.reference} was rejected. Please contact the resort for details.`,
            },
            CANCELLED: {
                title: "Function Hall reservation cancelled",
                message: `Your reservation ${booking.reference} has been cancelled.`,
            },
        };
        const notification = messages[d.status];
        db.prepare(`
      INSERT INTO notifications (
        id, user_id, title, message, type
      )
      VALUES (?, ?, ?, ?, 'BOOKING')
    `).run(randomUUID(), booking.customer_id, notification.title, notification.message);
        return {
            id: booking.id,
            reference: booking.reference,
            status: d.status,
            message: notification.message,
        };
    });
    res.json({ data: tx.immediate() });
});
/* =========================================
   ADMIN — FUNCTION HALL PAYMENTS
========================================= */
// View and filter Function Hall payments
api.get("/admin/function-hall-payments", (req, res) => {
    const statusSchema = z.enum([
        "SUBMITTED",
        "VERIFIED",
        "REJECTED",
    ]);
    const status = typeof req.query.status === "string"
        ? statusSchema.parse(req.query.status)
        : null;
    const baseQuery = `
    SELECT
      p.*,
      u.full_name AS customer_name,
      u.email AS customer_email,
      b.reference AS booking_reference,
      b.event_type,
      h.name AS function_hall_name
    FROM function_hall_payments p
    JOIN users u ON u.id = p.customer_id
    JOIN function_hall_bookings b
      ON b.id = p.function_hall_booking_id
    JOIN function_halls h
      ON h.id = b.function_hall_id
  `;
    const rows = status
        ? db.prepare(`
        ${baseQuery}
        WHERE p.status = ?
        ORDER BY p.created_at DESC
      `).all(status)
        : db.prepare(`
        ${baseQuery}
        ORDER BY p.created_at DESC
      `).all();
    res.json({ data: rows });
});
// Verify or reject a Function Hall payment
api.patch("/admin/function-hall-payments/:id/status", (req, res) => {
    const d = z.object({
        status: z.enum(["VERIFIED", "REJECTED"]),
    }).parse(req.body);
    const tx = db.transaction(() => {
        const payment = db.prepare(`
        SELECT *
        FROM function_hall_payments
        WHERE id = ?
      `).get(req.params.id);
        if (!payment) {
            throw new Error("Function Hall payment not found");
        }
        if (payment.status !== "SUBMITTED") {
            throw new Error("This payment has already been reviewed");
        }
        if (d.status === "VERIFIED") {
            const bill = getFunctionHallBill(payment.function_hall_booking_id);
            if (payment.amount > bill.remainingBalance + 0.001) {
                throw new Error("Payment exceeds the remaining Function Hall balance");
            }
        }
        db.prepare(`
        UPDATE function_hall_payments
        SET
          status = ?,
          reviewed_by = ?,
          reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(d.status, req.user.id, payment.id);
        const eventName = d.status === "VERIFIED"
            ? "functionHallPaymentVerified"
            : "functionHallPaymentRejected";
        enqueueEvent(eventName, {
            paymentId: payment.id,
            bookingId: payment.function_hall_booking_id,
            customerId: payment.customer_id,
        });
        db.prepare(`
        INSERT INTO notifications (
          id, user_id, title, message, type
        )
        VALUES (?, ?, ?, ?, 'PAYMENT')
      `).run(randomUUID(), payment.customer_id, d.status === "VERIFIED"
            ? "Function Hall payment verified"
            : "Function Hall payment rejected", d.status === "VERIFIED"
            ? "Your Function Hall payment has been verified."
            : "Your Function Hall payment was rejected. Please contact the resort.");
        return {
            id: payment.id,
            status: d.status,
            message: d.status === "VERIFIED"
                ? "Function Hall payment verified successfully"
                : "Function Hall payment rejected successfully",
        };
    });
    res.json({ data: tx.immediate() });
});
// Record cash actually collected for a Function Hall reservation
api.post("/admin/function-hall-payments/cash-collection", (req, res) => {
    const d = z.object({
        bookingId: z.string().min(1),
        amount: z.number().positive(),
        referenceNumber: z.string().max(100).optional(),
    }).parse(req.body);
    const tx = db.transaction(() => {
        const booking = db.prepare(`
        SELECT *
        FROM function_hall_bookings
        WHERE id = ?
      `).get(d.bookingId);
        if (!booking || booking.status !== "CONFIRMED") {
            throw new Error("Only confirmed Function Hall reservations can receive cash");
        }
        const bill = getFunctionHallBill(booking.id);
        if (d.amount > bill.availableToSubmit + 0.001) {
            throw new Error("Cash collection exceeds the available balance. Review submitted payments first.");
        }
        const id = randomUUID();
        db.prepare(`
        INSERT INTO function_hall_payments (
          id,
          function_hall_booking_id,
          customer_id,
          method,
          amount,
          reference_number,
          status,
          reviewed_by,
          reviewed_at
        )
        VALUES (?, ?, ?, 'CASH_ON_ARRIVAL', ?, ?, 'VERIFIED', ?, CURRENT_TIMESTAMP)
      `).run(id, booking.id, booking.customer_id, d.amount, d.referenceNumber ?? null, req.user.id);
        enqueueEvent("functionHallCashPaymentCollected", {
            paymentId: id,
            bookingId: booking.id,
            customerId: booking.customer_id,
            amount: d.amount,
        });
        db.prepare(`
        INSERT INTO notifications (
          id, user_id, title, message, type
        )
        VALUES (?, ?, ?, ?, 'PAYMENT')
      `).run(randomUUID(), booking.customer_id, "Function Hall cash payment received", `Your cash payment of ₱${d.amount.toFixed(2)} has been recorded.`);
        return {
            id,
            method: "CASH_ON_ARRIVAL",
            amount: d.amount,
            status: "VERIFIED",
            message: "Function Hall cash collection recorded successfully",
        };
    });
    res.status(201).json({ data: tx.immediate() });
});
api.get("/admin/dashboard", (_req, res) => {
    const count = (sql) => Number(db.prepare(sql).get().count);
    res.json({
        data: {
            totalBookings: count("SELECT COUNT(*) count FROM bookings"),
            pendingBookings: count("SELECT COUNT(*) count FROM bookings WHERE status='PENDING'"),
            confirmedBookings: count("SELECT COUNT(*) count FROM bookings WHERE status='CONFIRMED'"),
            customers: count("SELECT COUNT(*) count FROM users WHERE role='CUSTOMER'"),
            accommodations: count("SELECT COUNT(*) count FROM accommodations WHERE is_active=1"),
            verifiedRevenue: Number(db
                .prepare("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE status='VERIFIED'")
                .get().total),
        },
    });
});
// Admin Analytics — uses actual SQLite records
// Admin Analytics — regular bookings + Function Hall
api.get("/admin/analytics", (req, res) => {
    const dateSchema = z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    });
    const filters = dateSchema.parse(req.query);
    const today = new Date().toISOString().slice(0, 10);
    const defaultFrom = new Date(Date.now() - 29 * 86400000)
        .toISOString()
        .slice(0, 10);
    const from = filters.from ?? defaultFrom;
    const to = filters.to ?? today;
    if (from > to) {
        res.status(400).json({
            error: "Start date cannot be later than end date",
        });
        return;
    }
    const dateRange = (column) => `date(${column}) BETWEEN date(?) AND date(?)`;
    // Regular accommodation bookings
    const summary = db.prepare(`
    SELECT
      COUNT(*) AS totalBookings,
      SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pendingBookings,
      SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmedBookings,
      SUM(CASE WHEN status = 'CHECKED_IN' THEN 1 ELSE 0 END) AS checkedInBookings,
      SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completedBookings,
      SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelledBookings
    FROM bookings
    WHERE ${dateRange("created_at")}
  `).get(from, to);
    // Function Hall reservations
    const functionHallSummary = db.prepare(`
    SELECT
      COUNT(*) AS totalBookings,
      SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pendingBookings,
      SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmedBookings,
      SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completedBookings,
      SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejectedBookings,
      SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelledBookings
    FROM function_hall_bookings
    WHERE ${dateRange("created_at")}
  `).get(from, to);
    // Regular booking verified revenue
    const regularRevenue = db.prepare(`
    SELECT
      COALESCE(SUM(amount), 0) AS totalRevenue,
      COUNT(*) AS verifiedPayments
    FROM payments
    WHERE status = 'VERIFIED'
      AND ${dateRange("reviewed_at")}
  `).get(from, to);
    // Function Hall verified revenue
    const functionHallRevenue = db.prepare(`
    SELECT
      COALESCE(SUM(amount), 0) AS totalRevenue,
      COUNT(*) AS verifiedPayments
    FROM function_hall_payments
    WHERE status = 'VERIFIED'
      AND ${dateRange("reviewed_at")}
  `).get(from, to);
    // New customers
    const customers = db.prepare(`
    SELECT COUNT(*) AS total
    FROM users
    WHERE role = 'CUSTOMER'
      AND ${dateRange("created_at")}
  `).get(from, to);
    // Regular accommodation booking categories
    const bookingsByKind = db.prepare(`
    SELECT kind, COUNT(*) AS count
    FROM bookings
    WHERE ${dateRange("created_at")}
    GROUP BY kind
  `).all(from, to);
    // Regular accommodation booking statuses
    const bookingsByStatus = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM bookings
    WHERE ${dateRange("created_at")}
    GROUP BY status
    ORDER BY count DESC
  `).all(from, to);
    // Function Hall booking statuses
    const functionHallBookingsByStatus = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM function_hall_bookings
    WHERE ${dateRange("created_at")}
    GROUP BY status
    ORDER BY count DESC
  `).all(from, to);
    // Combine verified payment methods from both systems
    const paymentsByMethod = db.prepare(`
    SELECT
      method,
      COUNT(*) AS count,
      COALESCE(SUM(amount), 0) AS total
    FROM (
      SELECT method, amount
      FROM payments
      WHERE status = 'VERIFIED'
        AND ${dateRange("reviewed_at")}

      UNION ALL

      SELECT method, amount
      FROM function_hall_payments
      WHERE status = 'VERIFIED'
        AND ${dateRange("reviewed_at")}
    )
    GROUP BY method
    ORDER BY total DESC
  `).all(from, to, from, to);
    // Combined daily revenue trend
    const revenueTrend = db.prepare(`
    SELECT
      date(payment_date) AS date,
      COALESCE(SUM(amount), 0) AS revenue
    FROM (
      SELECT reviewed_at AS payment_date, amount
      FROM payments
      WHERE status = 'VERIFIED'
        AND ${dateRange("reviewed_at")}

      UNION ALL

      SELECT reviewed_at AS payment_date, amount
      FROM function_hall_payments
      WHERE status = 'VERIFIED'
        AND ${dateRange("reviewed_at")}
    )
    GROUP BY date(payment_date)
    ORDER BY date ASC
  `).all(from, to, from, to);
    // Top accommodations
    const topAccommodations = db.prepare(`
    SELECT
      a.id,
      a.name,
      a.category,
      COUNT(b.id) AS bookingCount
    FROM accommodations a
    LEFT JOIN bookings b
      ON b.accommodation_id = a.id
      AND ${dateRange("b.created_at")}
    WHERE a.is_active = 1
    GROUP BY a.id, a.name, a.category
    ORDER BY bookingCount DESC, a.name ASC
    LIMIT 5
  `).all(from, to);
    const regularTotalRevenue = Number(regularRevenue.totalRevenue ?? 0);
    const hallTotalRevenue = Number(functionHallRevenue.totalRevenue ?? 0);
    res.json({
        data: {
            period: { from, to },
            // Combined totals
            summary: {
                totalBookings: Number(summary.totalBookings ?? 0),
                pendingBookings: Number(summary.pendingBookings ?? 0),
                confirmedBookings: Number(summary.confirmedBookings ?? 0),
                checkedInBookings: Number(summary.checkedInBookings ?? 0),
                completedBookings: Number(summary.completedBookings ?? 0),
                cancelledBookings: Number(summary.cancelledBookings ?? 0),
                totalFunctionHallBookings: Number(functionHallSummary.totalBookings ?? 0),
                combinedTotalBookings: Number(summary.totalBookings ?? 0) +
                    Number(functionHallSummary.totalBookings ?? 0),
                totalRevenue: regularTotalRevenue + hallTotalRevenue,
                verifiedPayments: Number(regularRevenue.verifiedPayments ?? 0) +
                    Number(functionHallRevenue.verifiedPayments ?? 0),
                newCustomers: Number(customers.total ?? 0),
            },
            // Function Hall specific analytics
            functionHall: {
                totalBookings: Number(functionHallSummary.totalBookings ?? 0),
                pendingBookings: Number(functionHallSummary.pendingBookings ?? 0),
                confirmedBookings: Number(functionHallSummary.confirmedBookings ?? 0),
                completedBookings: Number(functionHallSummary.completedBookings ?? 0),
                rejectedBookings: Number(functionHallSummary.rejectedBookings ?? 0),
                cancelledBookings: Number(functionHallSummary.cancelledBookings ?? 0),
                totalRevenue: hallTotalRevenue,
                verifiedPayments: Number(functionHallRevenue.verifiedPayments ?? 0),
                bookingsByStatus: functionHallBookingsByStatus,
            },
            // Combined analytics
            bookingsByKind,
            bookingsByStatus,
            paymentsByMethod,
            revenueTrend,
            // Accommodation-specific analytics
            topAccommodations,
        },
    });
});
api.get("/admin/bookings", (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const rows = status
        ? db
            .prepare("SELECT b.*,u.full_name AS customer_name,a.name AS accommodation_name FROM bookings b JOIN users u ON u.id=b.customer_id JOIN accommodations a ON a.id=b.accommodation_id WHERE b.status=? ORDER BY b.created_at DESC")
            .all(status)
        : db
            .prepare("SELECT b.*,u.full_name AS customer_name,a.name AS accommodation_name FROM bookings b JOIN users u ON u.id=b.customer_id JOIN accommodations a ON a.id=b.accommodation_id ORDER BY b.created_at DESC")
            .all();
    res.json({ data: rows });
});
api.patch("/admin/bookings/:id/status", (req, res) => {
    const d = z
        .object({ status: z.enum(["CONFIRMED", "REJECTED", "CANCELLED"]) })
        .parse(req.body);
    res.json({
        data: bookingService.setStatus(req.params.id, d.status, req.user.id),
    });
});
api.get("/admin/payments", (_req, res) => res.json({
    data: db
        .prepare("SELECT p.*,u.full_name AS customer_name,b.reference AS booking_reference FROM payments p JOIN users u ON u.id=p.customer_id JOIN bookings b ON b.id=p.booking_id ORDER BY p.created_at DESC")
        .all(),
}));
// Admin verifies or rejects a submitted payment
api.patch("/admin/payments/:id/status", (req, res) => {
    const d = z
        .object({
        status: z.enum(["VERIFIED", "REJECTED"]),
    })
        .parse(req.body);
    const tx = db.transaction(() => {
        const payment = db
            .prepare("SELECT * FROM payments WHERE id = ?")
            .get(req.params.id);
        if (!payment) {
            throw new Error("Payment not found");
        }
        if (payment.status !== "SUBMITTED") {
            throw new Error("This payment has already been reviewed");
        }
        db.prepare(`
      UPDATE payments
      SET status = ?,
          reviewed_by = ?,
          reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(d.status, req.user.id, payment.id);
        enqueueEvent(d.status === "VERIFIED" ? "paymentVerified" : "paymentRejected", {
            paymentId: payment.id,
            bookingId: payment.booking_id,
            customerId: payment.customer_id,
        });
        db.prepare(`
      INSERT INTO notifications (
        id, user_id, title, message, type
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), payment.customer_id, d.status === "VERIFIED"
            ? "Payment verified"
            : "Payment rejected", d.status === "VERIFIED"
            ? "Your payment has been verified by the resort."
            : "Your payment was rejected. Please contact the resort or submit a valid payment.", "PAYMENT");
        return {
            id: payment.id,
            status: d.status,
            message: d.status === "VERIFIED"
                ? "Payment verified successfully"
                : "Payment rejected successfully",
        };
    });
    res.json({ data: tx.immediate() });
});
// Record cash actually collected by the resort
api.post("/admin/payments/cash-collection", (req, res) => {
    const schema = z.object({
        bookingId: z.string().min(1),
        amount: z.number().positive(),
        referenceNumber: z.string().max(100).optional(),
    });
    const d = schema.parse(req.body);
    const tx = db.transaction(() => {
        const booking = db
            .prepare("SELECT * FROM bookings WHERE id = ?")
            .get(d.bookingId);
        if (!booking || !["CONFIRMED", "CHECKED_IN"].includes(booking.status)) {
            throw new Error("Only confirmed or checked-in bookings can receive cash");
        }
        const bill = getBookingBill(d.bookingId);
        if (d.amount > bill.availableToSubmit + 0.001) {
            throw new Error("Cash collection exceeds the available balance. Review pending GCash submissions first.");
        }
        const id = randomUUID();
        db.prepare(`
      INSERT INTO payments (
        id,
        booking_id,
        customer_id,
        method,
        amount,
        reference_number,
        status,
        reviewed_by,
        reviewed_at
      )
      VALUES (?, ?, ?, 'CASH_ON_ARRIVAL', ?, ?, 'VERIFIED', ?, CURRENT_TIMESTAMP)
    `).run(id, d.bookingId, booking.customer_id, d.amount, d.referenceNumber ?? null, req.user.id);
        enqueueEvent("cashPaymentCollected", {
            paymentId: id,
            bookingId: d.bookingId,
            amount: d.amount,
        });
        db.prepare(`
      INSERT INTO notifications (
        id, user_id, title, message, type
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), booking.customer_id, "Cash payment received", `Your cash payment of ₱${d.amount.toFixed(2)} has been recorded.`, "PAYMENT");
        return {
            id,
            method: "CASH_ON_ARRIVAL",
            amount: d.amount,
            status: "VERIFIED",
            message: "Cash collection recorded successfully",
        };
    });
    res.status(201).json({ data: tx.immediate() });
});
api.get("/admin/customers", (req, res) => {
    const q = typeof req.query.q === "string" ? `%${req.query.q}%` : "%";
    res.json({
        data: db
            .prepare("SELECT id,email,full_name,phone,is_active,created_at FROM users WHERE role='CUSTOMER' AND (email LIKE ? OR full_name LIKE ?) ORDER BY created_at DESC LIMIT 100")
            .all(q, q),
    });
});
api.get("/admin/accommodations", (_req, res) => {
    const rows = db
        .prepare("SELECT * FROM accommodations ORDER BY created_at DESC")
        .all();
    res.json({ data: rows });
});
api.post("/admin/accommodations", (req, res) => {
    const d = z
        .object({
        name: z.string().min(2),
        category: z.string().min(2),
        description: z.string().default(""),
        capacityAdults: z.number().int().positive(),
        capacityChildren: z.number().int().nonnegative(),
        dayPrice: z.number().nonnegative(),
        nightPrice: z.number().nonnegative(),
        extraAdultFee: z.number().nonnegative().default(0),
        extraChildFee: z.number().nonnegative().default(0),
        imageUrl: z.string().url().optional(),
    })
        .parse(req.body);
    const id = randomUUID();
    db.prepare("INSERT INTO accommodations(id,name,category,description,capacity_adults,capacity_children,day_price,night_price,extra_adult_fee,extra_child_fee,image_url) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id, d.name, d.category, d.description, d.capacityAdults, d.capacityChildren, d.dayPrice, d.nightPrice, d.extraAdultFee, d.extraChildFee, d.imageUrl ?? null);
    enqueueEvent("accommodationCreated", { accommodationId: id });
    res.status(201).json({ data: { id } });
});
api.patch("/admin/accommodations/:id", (req, res) => {
    const d = z
        .object({
        name: z.string().trim().min(2).optional(),
        category: z.string().trim().min(2).optional(),
        description: z.string().max(1000).optional(),
        capacityAdults: z.number().int().positive().optional(),
        capacityChildren: z.number().int().nonnegative().optional(),
        dayPrice: z.number().nonnegative().optional(),
        nightPrice: z.number().nonnegative().optional(),
        extraAdultFee: z.number().nonnegative().optional(),
        extraChildFee: z.number().nonnegative().optional(),
        imageUrl: z.string().url().nullable().optional(),
        isActive: z.boolean().optional(),
    })
        .refine((data) => Object.values(data).some((value) => value !== undefined), { message: "Provide at least one field to update" })
        .parse(req.body);
    const row = db
        .prepare("SELECT id FROM accommodations WHERE id=?")
        .get(req.params.id);
    if (!row) {
        res.status(404).json({ error: "Accommodation not found" });
        return;
    }
    const fields = {
        name: d.name,
        category: d.category,
        description: d.description,
        capacity_adults: d.capacityAdults,
        capacity_children: d.capacityChildren,
        day_price: d.dayPrice,
        night_price: d.nightPrice,
        extra_adult_fee: d.extraAdultFee,
        extra_child_fee: d.extraChildFee,
        image_url: d.imageUrl,
        is_active: d.isActive === undefined ? undefined : Number(d.isActive),
    };
    const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
    db.prepare(`UPDATE accommodations
     SET ${entries.map(([key]) => `${key}=?`).join(", ")}
     WHERE id=?`).run(...entries.map(([, value]) => value), req.params.id);
    enqueueEvent("accommodationUpdated", {
        accommodationId: req.params.id,
    });
    res.json({ message: "Accommodation updated successfully" });
});
api.delete("/admin/accommodations/:id", (req, res) => {
    const result = db
        .prepare("UPDATE accommodations SET is_active=0 WHERE id=?")
        .run(req.params.id);
    if (!result.changes) {
        res.status(404).json({ error: "Accommodation not found" });
        return;
    }
    enqueueEvent("accommodationDeactivated", { accommodationId: req.params.id });
    res.json({ message: "Accommodation deactivated" });
});
api.get("/admin/reports/revenue", (_req, res) => res.json({
    data: db
        .prepare("SELECT strftime('%Y-%m',p.reviewed_at) AS month,SUM(p.amount) AS revenue FROM payments p WHERE p.status='VERIFIED' GROUP BY month ORDER BY month DESC LIMIT 12")
        .all(),
}));
api.get("/admin/reports/bookings", (_req, res) => res.json({
    data: db
        .prepare("SELECT status,kind,COUNT(*) AS count FROM bookings GROUP BY status,kind")
        .all(),
}));
api.get("/admin/reports/occupancy", (_req, res) => res.json({
    data: db
        .prepare("SELECT a.id,a.name,COUNT(b.id) AS booking_count FROM accommodations a LEFT JOIN bookings b ON b.accommodation_id=a.id AND b.status IN ('CONFIRMED','CHECKED_IN') GROUP BY a.id ORDER BY booking_count DESC")
        .all(),
}));
api.post("/admin/bookings/:id/check-in", (req, res) => {
    const tx = db.transaction(() => {
        const b = db
            .prepare("SELECT * FROM bookings WHERE id=? AND status='CONFIRMED'")
            .get(req.params.id);
        if (!b)
            throw new Error("Only confirmed bookings can check in");
        const paid = Number(db
            .prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE booking_id=? AND status='VERIFIED'")
            .get(b.id).total);
        if (paid + 0.001 < Number(b.total))
            throw new Error("Verified payments must cover the full booking total before check-in");
        db.prepare("UPDATE bookings SET status='CHECKED_IN' WHERE id=?").run(b.id);
        db.prepare("INSERT INTO check_in_out(id,booking_id,checked_in_by,checked_in_at) VALUES(?,?,?,CURRENT_TIMESTAMP)").run(randomUUID(), b.id, req.user.id);
        enqueueEvent("customerCheckedIn", { bookingId: b.id });
        return { status: "CHECKED_IN" };
    });
    res.json({ data: tx.immediate() });
});
api.post("/admin/bookings/:id/check-out", (req, res) => {
    const extra = z
        .object({ extraCharge: z.number().nonnegative().default(0) })
        .parse(req.body);
    const tx = db.transaction(() => {
        const b = db
            .prepare("SELECT * FROM bookings WHERE id=? AND status='CHECKED_IN'")
            .get(req.params.id);
        if (!b)
            throw new Error("Booking is not checked in");
        db.prepare("UPDATE bookings SET status='COMPLETED' WHERE id=?").run(b.id);
        db.prepare("UPDATE check_in_out SET checked_out_by=?,checked_out_at=CURRENT_TIMESTAMP,extra_charge=? WHERE booking_id=?").run(req.user.id, extra.extraCharge, b.id);
        enqueueEvent("customerCheckedOut", {
            bookingId: b.id,
            extraCharge: extra.extraCharge,
        });
        return { status: "COMPLETED" };
    });
    res.json({ data: tx.immediate() });
});
api.post("/reviews", authenticate, requireRole("CUSTOMER"), (req, res) => {
    const d = z
        .object({
        bookingId: z.string(),
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(1000).default(""),
    })
        .parse(req.body);
    const b = db
        .prepare("SELECT id FROM bookings WHERE id=? AND customer_id=? AND status='COMPLETED'")
        .get(d.bookingId, req.user.id);
    if (!b) {
        res
            .status(400)
            .json({ error: "Only customers with completed bookings can review" });
        return;
    }
    const id = randomUUID();
    db.prepare("INSERT INTO reviews(id,booking_id,customer_id,rating,comment) VALUES(?,?,?,?,?)").run(id, d.bookingId, req.user.id, d.rating, d.comment);
    enqueueEvent("reviewSubmitted", { reviewId: id, bookingId: d.bookingId });
    res.status(201).json({ data: { id } });
});
api.get("/reviews", (_req, res) => res.json({
    data: db
        .prepare("SELECT r.*,u.full_name AS customer_name FROM reviews r JOIN users u ON u.id=r.customer_id ORDER BY r.created_at DESC LIMIT 100")
        .all(),
}));
api.use((err, _req, res, _next) => {
    if (err instanceof z.ZodError) {
        res
            .status(400)
            .json({
            error: "Validation failed",
            details: err.issues.map((i) => ({
                path: i.path.join("."),
                message: i.message,
            })),
        });
        return;
    }
    const message = err instanceof Error ? err.message : "Unexpected server error";
    const status = /not found/i.test(message)
        ? 404
        : /not allowed|cannot|invalid|exceeds|expired|unavailable|already|must/i.test(message)
            ? 400
            : 500;
    res
        .status(status)
        .json({
        error: env.NODE_ENV === "production" && status === 500
            ? "Internal server error"
            : message,
    });
});
