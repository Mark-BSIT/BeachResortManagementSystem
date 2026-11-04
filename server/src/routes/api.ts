import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from '../database/connection.js';
import { env } from '../config/env.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { bookingService } from '../services/booking.service.js';
import { enqueueEvent } from '../services/outbox.service.js';

export const api = Router();
const asyncRoute = (fn:(req:any,res:any)=>unknown) => (req:any,res:any,next:any) => Promise.resolve(fn(req,res)).catch(next);
const registerSchema=z.object({email:z.string().email().max(254),password:z.string().min(8).max(72),fullName:z.string().trim().min(2).max(100),phone:z.string().max(30).optional()});
const loginSchema=z.object({email:z.string().email(),password:z.string().min(1).max(72)});
const bookingSchema=z.object({accommodationId:z.string().min(1),kind:z.enum(['DAY_USE','OVERNIGHT']),startAt:z.string().datetime(),endAt:z.string().datetime(),adults:z.number().int().min(1).max(100),children:z.number().int().min(0).max(100),serviceIds:z.array(z.string()).max(10).optional(),specialRequest:z.string().max(500).optional()});
const idSchema=z.string().uuid();

api.get('/health',(_req,res)=>res.json({status:'ok',service:'beach-resort-api',time:new Date().toISOString()}));
const authLimiter=rateLimit({windowMs:15*60_000,limit:12,standardHeaders:true,legacyHeaders:false,message:{error:'Too many authentication attempts. Try again later.'}});
api.post('/auth/register',authLimiter,asyncRoute(async(req,res)=>{
 const data=registerSchema.parse(req.body); const exists=db.prepare('SELECT id FROM users WHERE email=?').get(data.email);
 if(exists){res.status(409).json({error:'Email is already registered'});return;}
 const id=randomUUID(); const hash=await bcrypt.hash(data.password,12);
 db.prepare("INSERT INTO users(id,email,password_hash,role,full_name,phone) VALUES(?,?,?,'CUSTOMER',?,?)").run(id,data.email,hash,data.fullName,data.phone??null);
 enqueueEvent('userRegistered',{userId:id,email:data.email}); res.status(201).json({message:'Account created. You can now sign in.'});
}));
api.post('/auth/login',authLimiter,asyncRoute(async(req,res)=>{
 const data=loginSchema.parse(req.body); const user=db.prepare('SELECT * FROM users WHERE email=? AND is_active=1').get(data.email) as any;
 if(!user || !(await bcrypt.compare(data.password,user.password_hash))){res.status(401).json({error:'Email or password is incorrect'});return;}
 const token=jwt.sign({role:user.role},env.JWT_SECRET,{subject:user.id,expiresIn:env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn']});
 enqueueEvent('userLoggedIn',{userId:user.id}); res.json({token,user:{id:user.id,email:user.email,role:user.role,fullName:user.full_name}});
}));
api.post('/auth/logout',authenticate,(req,res)=>{enqueueEvent('userLoggedOut',{userId:req.user!.id});res.json({message:'Logged out. Remove the token from secure storage.'});});
api.get('/auth/me',authenticate,(req,res)=>res.json({user:req.user}));

api.get('/accommodations',(req,res)=>{
 const category=typeof req.query.category==='string'?req.query.category:null;
 const rows=category?db.prepare('SELECT * FROM accommodations WHERE is_active=1 AND category=? ORDER BY name').all(category):db.prepare('SELECT * FROM accommodations WHERE is_active=1 ORDER BY name').all();
 res.json({data:rows});
});
api.get('/accommodations/:id',(req,res)=>{const row=db.prepare('SELECT * FROM accommodations WHERE id=? AND is_active=1').get(req.params.id);if(!row){res.status(404).json({error:'Accommodation not found'});return;}res.json({data:row});});
api.get('/services',(_req,res)=>res.json({data:db.prepare('SELECT * FROM services WHERE is_active=1 ORDER BY name').all()}));

api.get('/bookings/availability',(req,res)=>{
 const q=z.object({accommodationId:z.string().min(1),startAt:z.string().datetime(),endAt:z.string().datetime()}).parse(req.query);
 if(new Date(q.startAt)>=new Date(q.endAt)){res.status(400).json({error:'Invalid reservation date range'});return;}
 db.prepare("UPDATE bookings SET status='EXPIRED' WHERE status='PENDING' AND hold_expires_at IS NOT NULL AND hold_expires_at < ?").run(new Date().toISOString());
 const accommodation=db.prepare('SELECT id FROM accommodations WHERE id=? AND is_active=1').get(q.accommodationId);
 if(!accommodation){res.status(404).json({error:'Accommodation not found or unavailable'});return;}
 const conflict=db.prepare("SELECT id FROM bookings WHERE accommodation_id=? AND status IN ('PENDING','CONFIRMED','CHECKED_IN') AND start_at < ? AND end_at > ? LIMIT 1").get(q.accommodationId,q.endAt,q.startAt);
 res.json({available:!conflict});
});
api.post('/bookings',authenticate,requireRole('CUSTOMER'),(req,res)=>{
 const data=bookingSchema.parse(req.body); const result=bookingService.create({...data,customerId:req.user!.id});res.status(201).json({data:result});
});
api.get('/bookings/mine',authenticate,requireRole('CUSTOMER'),(req,res)=>{
 const rows=db.prepare('SELECT b.*,a.name AS accommodation_name FROM bookings b JOIN accommodations a ON a.id=b.accommodation_id WHERE b.customer_id=? ORDER BY b.created_at DESC').all(req.user!.id);res.json({data:rows});
});
api.get('/bookings/:id',authenticate,(req,res)=>{
 const row=db.prepare('SELECT b.*,a.name AS accommodation_name FROM bookings b JOIN accommodations a ON a.id=b.accommodation_id WHERE b.id=?').get(req.params.id) as any;
 if(!row){res.status(404).json({error:'Booking not found'});return;}if(req.user!.role!=='ADMIN'&&row.customer_id!==req.user!.id){res.status(404).json({error:'Booking not found'});return;}res.json({data:row});
});
api.post('/bookings/:id/cancel',authenticate,requireRole('CUSTOMER'),(req,res)=>{
 const row=db.prepare('SELECT customer_id FROM bookings WHERE id=?').get(req.params.id) as any;
 if(!row||row.customer_id!==req.user!.id){res.status(404).json({error:'Booking not found'});return;}res.json({data:bookingService.setStatus(req.params.id,'CANCELLED',req.user!.id)});
});

api.get('/notifications',authenticate,(req,res)=>res.json({data:db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(req.user!.id)}));
api.patch('/notifications/:id/read',authenticate,(req,res)=>{const result=db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').run(req.params.id,req.user!.id);if(!result.changes){res.status(404).json({error:'Notification not found'});return;}enqueueEvent('notificationRead',{notificationId:req.params.id,userId:req.user!.id});res.json({message:'Notification marked as read'});});

api.post('/payments',authenticate,requireRole('CUSTOMER'),(req,res)=>{
 const schema=z.object({bookingId:z.string().min(1),method:z.enum(['GCASH','BANK_TRANSFER','CASH_ON_ARRIVAL']),amount:z.number().positive(),referenceNumber:z.string().max(100).optional(),proofPath:z.string().max(500).optional()});
 const d=schema.parse(req.body);
 const tx=db.transaction(()=>{
  const booking=db.prepare('SELECT * FROM bookings WHERE id=? AND customer_id=?').get(d.bookingId,req.user!.id) as any;
  if(!booking||!['PENDING','CONFIRMED'].includes(booking.status))throw new Error('Eligible booking not found');
  const paid=Number((db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE booking_id=? AND status IN ('SUBMITTED','VERIFIED')").get(d.bookingId) as any).total);
  if(d.amount>Math.max(0,Number(booking.total)-paid))throw new Error('Payment exceeds the remaining balance');
  const id=randomUUID();
  db.prepare("INSERT INTO payments(id,booking_id,customer_id,method,amount,reference_number,proof_path,status) VALUES(?,?,?,?,?,?,?,'SUBMITTED')").run(id,d.bookingId,req.user!.id,d.method,d.amount,d.referenceNumber??null,d.proofPath??null);
  enqueueEvent('paymentSubmitted',{paymentId:id,bookingId:d.bookingId});
  const admins=db.prepare("SELECT id FROM users WHERE role='ADMIN' AND is_active=1").all() as Array<{id:string}>;
  const notify=db.prepare('INSERT INTO notifications(id,user_id,title,message,type) VALUES(?,?,?,?,?)');
  for(const admin of admins)notify.run(randomUUID(),admin.id,'Payment submitted',`A payment for booking ${booking.reference} needs review.`,'PAYMENT');
  return {id,status:'SUBMITTED',message:'Payment submitted for manual review'};
 });
 res.status(201).json({data:tx.immediate()});
});
api.get('/payments/mine',authenticate,requireRole('CUSTOMER'),(req,res)=>res.json({data:db.prepare('SELECT * FROM payments WHERE customer_id=? ORDER BY created_at DESC').all(req.user!.id)}));

api.use('/admin',authenticate,requireRole('ADMIN'));
api.get('/admin/dashboard',(_req,res)=>{
 const count=(sql:string)=>Number((db.prepare(sql).get() as any).count);
 res.json({data:{totalBookings:count('SELECT COUNT(*) count FROM bookings'),pendingBookings:count("SELECT COUNT(*) count FROM bookings WHERE status='PENDING'"),confirmedBookings:count("SELECT COUNT(*) count FROM bookings WHERE status='CONFIRMED'"),customers:count("SELECT COUNT(*) count FROM users WHERE role='CUSTOMER'"),accommodations:count('SELECT COUNT(*) count FROM accommodations WHERE is_active=1'),verifiedRevenue:Number((db.prepare("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE status='VERIFIED'").get() as any).total)}});
});
api.get('/admin/bookings',(req,res)=>{const status=typeof req.query.status==='string'?req.query.status:null;const rows=status?db.prepare('SELECT b.*,u.full_name AS customer_name,a.name AS accommodation_name FROM bookings b JOIN users u ON u.id=b.customer_id JOIN accommodations a ON a.id=b.accommodation_id WHERE b.status=? ORDER BY b.created_at DESC').all(status):db.prepare('SELECT b.*,u.full_name AS customer_name,a.name AS accommodation_name FROM bookings b JOIN users u ON u.id=b.customer_id JOIN accommodations a ON a.id=b.accommodation_id ORDER BY b.created_at DESC').all();res.json({data:rows});});
api.patch('/admin/bookings/:id/status',(req,res)=>{const d=z.object({status:z.enum(['CONFIRMED','REJECTED','CANCELLED'])}).parse(req.body);res.json({data:bookingService.setStatus(req.params.id,d.status,req.user!.id)});});
api.get('/admin/payments',(_req,res)=>res.json({data:db.prepare('SELECT p.*,u.full_name AS customer_name,b.reference AS booking_reference FROM payments p JOIN users u ON u.id=p.customer_id JOIN bookings b ON b.id=p.booking_id ORDER BY p.created_at DESC').all()}));
api.patch('/admin/payments/:id/status',(req,res)=>{
 const d=z.object({status:z.enum(['VERIFIED','REJECTED'])}).parse(req.body);const tx=db.transaction(()=>{const p=db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id) as any;if(!p)throw new Error('Payment not found');if(p.status!=='SUBMITTED')throw new Error('Payment has already been reviewed');db.prepare('UPDATE payments SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?').run(d.status,req.user!.id,p.id);enqueueEvent(d.status==='VERIFIED'?'paymentVerified':'paymentRejected',{paymentId:p.id,bookingId:p.booking_id});db.prepare('INSERT INTO notifications(id,user_id,title,message,type) VALUES(?,?,?,?,?)').run(randomUUID(),p.customer_id,d.status==='VERIFIED'?'Payment verified':'Payment needs attention',`Your payment submission has been ${d.status.toLowerCase()}.`,'PAYMENT');return {id:p.id,status:d.status};});res.json({data:tx.immediate()});
});
api.get('/admin/customers',(req,res)=>{const q=typeof req.query.q==='string'?`%${req.query.q}%`:'%';res.json({data:db.prepare("SELECT id,email,full_name,phone,is_active,created_at FROM users WHERE role='CUSTOMER' AND (email LIKE ? OR full_name LIKE ?) ORDER BY created_at DESC LIMIT 100").all(q,q)});});
api.post('/admin/accommodations',(req,res)=>{const d=z.object({name:z.string().min(2),category:z.string().min(2),description:z.string().default(''),capacityAdults:z.number().int().positive(),capacityChildren:z.number().int().nonnegative(),dayPrice:z.number().nonnegative(),nightPrice:z.number().nonnegative(),extraAdultFee:z.number().nonnegative().default(0),extraChildFee:z.number().nonnegative().default(0),imageUrl:z.string().url().optional()}).parse(req.body);const id=randomUUID();db.prepare('INSERT INTO accommodations(id,name,category,description,capacity_adults,capacity_children,day_price,night_price,extra_adult_fee,extra_child_fee,image_url) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,d.name,d.category,d.description,d.capacityAdults,d.capacityChildren,d.dayPrice,d.nightPrice,d.extraAdultFee,d.extraChildFee,d.imageUrl??null);enqueueEvent('accommodationCreated',{accommodationId:id});res.status(201).json({data:{id}});});
api.patch('/admin/accommodations/:id',(req,res)=>{const d=z.object({name:z.string().min(2).optional(),description:z.string().optional(),dayPrice:z.number().nonnegative().optional(),nightPrice:z.number().nonnegative().optional(),isActive:z.boolean().optional()}).parse(req.body);const row=db.prepare('SELECT id FROM accommodations WHERE id=?').get(req.params.id);if(!row){res.status(404).json({error:'Accommodation not found'});return;}const fields:{[k:string]:unknown}={name:d.name,description:d.description,day_price:d.dayPrice,night_price:d.nightPrice,is_active:d.isActive===undefined?undefined:Number(d.isActive)};const entries=Object.entries(fields).filter(([,v])=>v!==undefined);if(entries.length)db.prepare(`UPDATE accommodations SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`).run(...entries.map(([,v])=>v),req.params.id);enqueueEvent('accommodationUpdated',{accommodationId:req.params.id});res.json({message:'Accommodation updated'});});
api.delete('/admin/accommodations/:id',(req,res)=>{const result=db.prepare('UPDATE accommodations SET is_active=0 WHERE id=?').run(req.params.id);if(!result.changes){res.status(404).json({error:'Accommodation not found'});return;}enqueueEvent('accommodationDeactivated',{accommodationId:req.params.id});res.json({message:'Accommodation deactivated'});});
api.get('/admin/reports/revenue',(_req,res)=>res.json({data:db.prepare("SELECT strftime('%Y-%m',p.reviewed_at) AS month,SUM(p.amount) AS revenue FROM payments p WHERE p.status='VERIFIED' GROUP BY month ORDER BY month DESC LIMIT 12").all()}));
api.get('/admin/reports/bookings',(_req,res)=>res.json({data:db.prepare('SELECT status,kind,COUNT(*) AS count FROM bookings GROUP BY status,kind').all()}));
api.get('/admin/reports/occupancy',(_req,res)=>res.json({data:db.prepare('SELECT a.id,a.name,COUNT(b.id) AS booking_count FROM accommodations a LEFT JOIN bookings b ON b.accommodation_id=a.id AND b.status IN (\'CONFIRMED\',\'CHECKED_IN\') GROUP BY a.id ORDER BY booking_count DESC').all()}));
api.post('/admin/bookings/:id/check-in',(req,res)=>{const tx=db.transaction(()=>{const b=db.prepare("SELECT * FROM bookings WHERE id=? AND status='CONFIRMED'").get(req.params.id) as any;if(!b)throw new Error('Only confirmed bookings can check in');const paid=Number((db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE booking_id=? AND status='VERIFIED'").get(b.id) as any).total);if(paid+0.001<Number(b.total))throw new Error('Verified payments must cover the full booking total before check-in');db.prepare("UPDATE bookings SET status='CHECKED_IN' WHERE id=?").run(b.id);db.prepare('INSERT INTO check_in_out(id,booking_id,checked_in_by,checked_in_at) VALUES(?,?,?,CURRENT_TIMESTAMP)').run(randomUUID(),b.id,req.user!.id);enqueueEvent('customerCheckedIn',{bookingId:b.id});return {status:'CHECKED_IN'};});res.json({data:tx.immediate()});});
api.post('/admin/bookings/:id/check-out',(req,res)=>{const extra=z.object({extraCharge:z.number().nonnegative().default(0)}).parse(req.body);const tx=db.transaction(()=>{const b=db.prepare("SELECT * FROM bookings WHERE id=? AND status='CHECKED_IN'").get(req.params.id) as any;if(!b)throw new Error('Booking is not checked in');db.prepare("UPDATE bookings SET status='COMPLETED' WHERE id=?").run(b.id);db.prepare('UPDATE check_in_out SET checked_out_by=?,checked_out_at=CURRENT_TIMESTAMP,extra_charge=? WHERE booking_id=?').run(req.user!.id,extra.extraCharge,b.id);enqueueEvent('customerCheckedOut',{bookingId:b.id,extraCharge:extra.extraCharge});return {status:'COMPLETED'};});res.json({data:tx.immediate()});});

api.post('/reviews',authenticate,requireRole('CUSTOMER'),(req,res)=>{const d=z.object({bookingId:z.string(),rating:z.number().int().min(1).max(5),comment:z.string().max(1000).default('')}).parse(req.body);const b=db.prepare("SELECT id FROM bookings WHERE id=? AND customer_id=? AND status='COMPLETED'").get(d.bookingId,req.user!.id);if(!b){res.status(400).json({error:'Only customers with completed bookings can review'});return;}const id=randomUUID();db.prepare('INSERT INTO reviews(id,booking_id,customer_id,rating,comment) VALUES(?,?,?,?,?)').run(id,d.bookingId,req.user!.id,d.rating,d.comment);enqueueEvent('reviewSubmitted',{reviewId:id,bookingId:d.bookingId});res.status(201).json({data:{id}});});
api.get('/reviews',(_req,res)=>res.json({data:db.prepare('SELECT r.*,u.full_name AS customer_name FROM reviews r JOIN users u ON u.id=r.customer_id ORDER BY r.created_at DESC LIMIT 100').all()}));

api.use((err:unknown,_req:any,res:any,_next:any)=>{
 if(err instanceof z.ZodError){res.status(400).json({error:'Validation failed',details:err.issues.map(i=>({path:i.path.join('.'),message:i.message}))});return;}
 const message=err instanceof Error?err.message:'Unexpected server error';
 const status=/not found/i.test(message)?404:/not allowed|cannot|invalid|exceeds|expired|unavailable|already|must/i.test(message)?400:500;
 res.status(status).json({error:env.NODE_ENV==='production'&&status===500?'Internal server error':message});
});
