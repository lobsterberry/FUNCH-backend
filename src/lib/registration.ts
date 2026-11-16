import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { hashPassword } from '../utils/password.js';

export const emailSchema = z.string().trim().email().max(254).transform((email) => email.toLowerCase());
export const passwordSchema = z.string().min(8).max(128);
export const registrationSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100),
  phoneNumber: z.string().trim().min(1).max(30).optional(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
}).strict();

export const publicUserSelect = {
  id: true, email: true, name: true, phoneNumber: true,
  firstName: true, lastName: true, role: true, createdAt: true,
} satisfies Prisma.UserSelect;

export async function registrationData(input: z.infer<typeof registrationSchema>) {
  return { ...input, password: await hashPassword(input.password), role: 'USER' as const };
}
