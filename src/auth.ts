import 'dotenv/config';
import type { ExpressAuthConfig } from '@auth/express';
import Credentials from '@auth/express/providers/credentials';
import { z } from 'zod';
import prisma from './lib/prisma.js';
import { emailSchema } from './lib/registration.js';
import { hashPassword, verifyPassword } from './utils/password.js';

const credentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  scope: z.enum(['admin']).optional(),
});
// Equalize the expensive password check for missing, inactive and valid users.
const dummyPassword = hashPassword('unused-password');

export function createAuthConfig(): ExpressAuthConfig {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('Set AUTH_SECRET to a random value of at least 32 characters before starting the backend.');
  }
  const authUrl = new URL(process.env.AUTH_URL || 'http://localhost:5000');
  return {
    secret,
    basePath: '/api/auth',
    trustHost: true,
    useSecureCookies: authUrl.protocol === 'https:',
    session: { strategy: 'jwt', maxAge: 60 * 60 * 24 },
    providers: [Credentials({
      credentials: { email: { type: 'email' }, password: { type: 'password' }, scope: { type: 'text' } },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
        const valid = await verifyPassword(parsed.data.password, user?.password ?? await dummyPassword);
        if (!user || !user.isActive || !valid) return null;
        if (parsed.data.scope === 'admin' && user.role !== 'ADMIN') return null;
        return {
          id: user.id, email: user.email, name: user.name,
          role: user.role, sessionVersion: user.sessionVersion,
        };
      },
    })],
    callbacks: {
      async jwt({ token, user }) {
        if (user) {
          token.sub = user.id;
          token.role = user.role;
          token.sessionVersion = user.sessionVersion;
        }
        if (!token.sub) return null;
        const current = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { isActive: true, sessionVersion: true, role: true, name: true, email: true },
        });
        if (!current?.isActive || current.sessionVersion !== token.sessionVersion) return null;
        token.role = current.role;
        token.name = current.name;
        token.email = current.email;
        return token;
      },
      session({ session, token }) {
        session.user.id = token.sub!;
        session.user.role = token.role;
        return session;
      },
      redirect({ url }) {
        // Never derive redirect destinations from an untrusted Host header.
        const target = new URL(url, authUrl.origin);
        return target.origin === authUrl.origin ? target.href : authUrl.origin;
      },
    },
  };
}
