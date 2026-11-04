import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { db } from '../database/connection.js';

export interface AuthUser { id:string; email:string; role:'ADMIN'|'CUSTOMER'; fullName:string }
declare global { namespace Express { interface Request { user?: AuthUser } } }
export function authenticate(req:Request,res:Response,next:NextFunction):void {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  if (!token) { res.status(401).json({error:'Authentication required'}); return; }
  try {
    const payload = jwt.verify(token,env.JWT_SECRET) as jwt.JwtPayload;
    const user = db.prepare('SELECT id,email,role,full_name AS fullName FROM users WHERE id=? AND is_active=1').get(payload.sub) as AuthUser|undefined;
    if (!user) { res.status(401).json({error:'Session is no longer valid'}); return; }
    req.user=user; next();
  } catch { res.status(401).json({error:'Invalid or expired session'}); }
}
export function requireRole(...roles:Array<'ADMIN'|'CUSTOMER'>) {
  return (req:Request,res:Response,next:NextFunction):void => {
    if (!req.user || !roles.includes(req.user.role)) { res.status(403).json({error:'You are not allowed to perform this action'}); return; }
    next();
  };
}
