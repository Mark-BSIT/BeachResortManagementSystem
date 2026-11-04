import { randomBytes, randomUUID } from 'node:crypto';
import { db } from '../database/connection.js';
import { calculatePrice } from '../domain/pricing.js';
import { enqueueEvent } from './outbox.service.js';

export interface CreateBookingInput {
  customerId: string; accommodationId: string; kind: 'DAY_USE'|'OVERNIGHT';
  startAt: string; endAt: string; adults: number; children: number;
  serviceIds?: string[]; specialRequest?: string;
}

export class BookingService {
  create(input: CreateBookingInput) {
    const start = new Date(input.startAt); const end = new Date(input.endAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) throw new Error('Invalid reservation date or time range');
    if (start < new Date(Date.now() - 60_000)) throw new Error('Reservation must be in the future');
    if (!Number.isInteger(input.adults) || input.adults < 1 || !Number.isInteger(input.children) || input.children < 0) throw new Error('Invalid guest count');
    const create = db.transaction(() => {
      // Expired pending holds are released before checking inventory.
      db.prepare("UPDATE bookings SET status='EXPIRED' WHERE status='PENDING' AND hold_expires_at IS NOT NULL AND hold_expires_at < ?").run(new Date().toISOString());
      const accommodation = db.prepare('SELECT * FROM accommodations WHERE id=? AND is_active=1').get(input.accommodationId) as any;
      if (!accommodation) throw new Error('Accommodation not found or unavailable');
      if (input.adults > accommodation.capacity_adults || input.children > accommodation.capacity_children) throw new Error('Guest count exceeds accommodation capacity');
      const conflict = db.prepare(`SELECT id FROM bookings WHERE accommodation_id=? AND status IN ('PENDING','CONFIRMED','CHECKED_IN') AND start_at < ? AND end_at > ? LIMIT 1`)
        .get(input.accommodationId, input.endAt, input.startAt);
      if (conflict) throw new Error('Selected accommodation is no longer available for that schedule');
      const services = (input.serviceIds ?? []).map(id => {
        const row = db.prepare('SELECT id,name,price FROM services WHERE id=? AND is_active=1').get(id) as any;
        if (!row) throw new Error(`Service ${id} is unavailable`);
        return row;
      });
      const nights = input.kind === 'OVERNIGHT' ? Math.ceil((end.getTime()-start.getTime()) / 86_400_000) : 1;
      if (input.kind === 'OVERNIGHT' && nights < 1) throw new Error('Overnight reservation must be at least one night');
      const serviceTotal = services.reduce((sum, item) => sum + Number(item.price), 0);
      const total = calculatePrice({ kind: input.kind, basePrice: input.kind === 'DAY_USE' ? accommodation.day_price : accommodation.night_price,
        nights, extraAdultCount: Math.max(0,input.adults-2), extraChildCount: input.children,
        extraAdultFee: accommodation.extra_adult_fee, extraChildFee: accommodation.extra_child_fee, serviceTotal });
      const id = randomUUID(); const reference = `BR-${new Date().getFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
      const holdExpiresAt = new Date(Date.now()+30*60_000).toISOString();
      db.prepare(`INSERT INTO bookings(id,reference,customer_id,accommodation_id,kind,start_at,end_at,adults,children,special_request,status,total,hold_expires_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,'PENDING',?,?)`).run(id,reference,input.customerId,input.accommodationId,input.kind,input.startAt,input.endAt,input.adults,input.children,input.specialRequest ?? '',total,holdExpiresAt);
      const insertService = db.prepare('INSERT INTO booking_services(booking_id,service_id,quantity,unit_price) VALUES(?,?,1,?)');
      for (const service of services) insertService.run(id,service.id,service.price);
      enqueueEvent('bookingSubmitted',{bookingId:id,reference,customerId:input.customerId,total});
      const admins = db.prepare("SELECT id FROM users WHERE role='ADMIN' AND is_active=1").all() as Array<{id:string}>;
      const notify = db.prepare('INSERT INTO notifications(id,user_id,title,message,type) VALUES(?,?,?,?,?)');
      for (const admin of admins) notify.run(randomUUID(),admin.id,'New reservation',`Booking ${reference} needs review.`,'BOOKING');
      return db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
    });
    return create.immediate();
  }

  setStatus(id: string, status: 'CONFIRMED'|'REJECTED'|'CANCELLED', actorId: string) {
    const tx = db.transaction(() => {
      const booking = db.prepare('SELECT * FROM bookings WHERE id=?').get(id) as any;
      if (!booking) throw new Error('Booking not found');
      if (status === 'CONFIRMED' && booking.status !== 'PENDING') throw new Error('Only pending bookings can be approved');
      if (status === 'REJECTED' && booking.status !== 'PENDING') throw new Error('Only pending bookings can be rejected');
      if (status === 'CANCELLED' && !['PENDING','CONFIRMED'].includes(booking.status)) throw new Error('This booking cannot be cancelled');
      if (status === 'CONFIRMED' && booking.hold_expires_at && booking.hold_expires_at < new Date().toISOString()) throw new Error('Booking hold expired; ask customer to submit again');
      db.prepare('UPDATE bookings SET status=?,hold_expires_at=NULL WHERE id=?').run(status,id);
      const event = status==='CONFIRMED'?'bookingApproved':status==='REJECTED'?'bookingRejected':'bookingCancelled';
      enqueueEvent(event,{bookingId:id,customerId:booking.customer_id,actorId});
      db.prepare('INSERT INTO notifications(id,user_id,title,message,type) VALUES(?,?,?,?,?)').run(randomUUID(),booking.customer_id,
        status==='CONFIRMED'?'Reservation confirmed':status==='REJECTED'?'Reservation rejected':'Reservation cancelled',
        `Your booking ${booking.reference} is ${status.toLowerCase()}.`,'BOOKING');
      return db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
    });
    return tx.immediate();
  }
}
export const bookingService = new BookingService();
