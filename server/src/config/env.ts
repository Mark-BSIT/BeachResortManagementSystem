
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_FILE: z.string().default('./data/resort.sqlite'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must contain at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('2h'),
  CORS_ORIGINS: z.string().default('http://localhost:8081,http://localhost:19006'),
  ADMIN_EMAIL: z.string().email().default('admin@beachresort.local'),
  ADMIN_PASSWORD: z.string().min(12).default('ChangeMe_12345!'),

  // PayMongo configuration
  PAYMONGO_SECRET_KEY: z.string().optional(),
  PAYMONGO_PUBLIC_KEY: z.string().optional(),
  PAYMONGO_WEBHOOK_SECRET: z.string().optional(),
});

export const env = schema.parse(process.env);
