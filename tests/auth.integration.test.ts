import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

test('Auth.js HTTP flow with PostgreSQL', { skip: !process.env.AUTH_TEST_DATABASE_URL }, async (t) => {
  process.env.DATABASE_URL = process.env.AUTH_TEST_DATABASE_URL;
  process.env.AUTH_SECRET = 'integration-test-secret-only-1234567890';
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('../src/app.js');
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { hashPassword, verifyPassword } = await import('../src/utils/password.js');
  const runId = randomUUID();
  const email = `auth-${runId}@funch.example`;
  const adminEmail = `admin-${runId}@funch.example`;
  const guestEmail = `guest-${runId}@funch.example`;
  const password = 'ExamplePassword123!';
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const clients = () => {
    const cookies = new Map<string, string>();
    return {
      cookies,
      async request(path: string, method = 'GET', body?: unknown, extraHeaders: Record<string, string> = {}) {
        const response = await fetch(base + path, {
          method, redirect: 'manual',
          headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
            ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extraHeaders },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        for (const cookie of response.headers.getSetCookie()) {
          const [pair] = cookie.split(';');
          const separator = pair.indexOf('=');
          cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
        }
        const text = await response.text();
        let data: any;
        try { data = JSON.parse(text); } catch { data = text; }
        return { response, data };
      },
      async login(loginEmail: string, loginPassword: string, path = '/api/auth/login') {
        const csrf = await this.request('/api/auth/csrf');
        return this.request(path, 'POST', { email: loginEmail, password: loginPassword, csrfToken: csrf.data.csrfToken },
          { 'x-auth-return-redirect': '1' });
      },
    };
  };
  const member = clients();
  const otherDevice = clients();
  const anonymous = clients();
  let memberId: string;
  try {
    await t.test('anonymous access and forged cross-origin requests are rejected', async () => {
      assert.equal((await anonymous.request('/api/auth/me')).response.status, 401);
      assert.equal((await anonymous.request('/api/bookings')).response.status, 401);
      assert.equal((await anonymous.request('/api/auth/change-password', 'POST', {})).response.status, 401);
      assert.equal((await anonymous.request('/api/auth/register', 'POST', {}, { origin: 'https://attacker.example' })).response.status, 403);
      assert.equal((await anonymous.request('/api/auth/register', 'POST')).response.status, 415);
    });
    await t.test('registration validates fields, normalizes email, hashes passwords and rejects duplicate accounts', async () => {
      assert.equal((await member.request('/api/auth/register', 'POST', { email, name: 'Test', password: 'short' })).response.status, 400);
      assert.equal((await member.request('/api/auth/register', 'POST', { email, name: 'Test', password, role: 'ADMIN' })).response.status, 400);
      const result = await member.request('/api/auth/register', 'POST', { email: `  ${email.toUpperCase()}  `, name: 'Test Member', password });
      assert.equal(result.response.status, 201);
      assert.equal(result.data.data.email, email);
      assert.equal(result.data.data.role, 'USER');
      assert.equal('password' in result.data.data, false);
      memberId = result.data.data.id;
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: memberId } });
      assert.notEqual(stored.password, password);
      assert.equal(await verifyPassword(password, stored.password), true);
      assert.equal((await member.request('/api/auth/register', 'POST', { email, name: 'Test', password })).response.status, 409);
    });
    await t.test('login enforces Auth.js CSRF checks and rejects wrong credentials', async () => {
      const missing = await anonymous.request('/api/auth/login', 'POST', { email, password });
      assert.match(missing.data.url, /MissingCSRF/);
      assert.match((await anonymous.login(email, 'wrong-password')).data.url, /CredentialsSignin/);
      assert.equal((await anonymous.request('/api/auth/me')).response.status, 401);
    });
    await t.test('aliases and native Credentials callback issue HttpOnly cookies and valid sessions', async () => {
      const result = await member.login(email, password);
      assert.equal(result.response.status, 200);
      assert.doesNotMatch(result.data.url, /error=/);
      assert.match(result.response.headers.getSetCookie().join(';'), /HttpOnly/i);
      assert.equal((await member.request('/api/auth/me')).data.data.id, memberId);
      const session = await member.request('/api/auth/session');
      assert.equal(session.data.user.id, memberId);
      assert.equal(session.data.user.role, 'USER');
      assert.equal('sessionVersion' in session.data.user, false);
      assert.equal('password' in session.data.user, false);
      const second = await otherDevice.login(email, password, '/api/auth/callback/credentials');
      assert.doesNotMatch(second.data.url, /error=/);
      assert.equal((await otherDevice.request('/api/auth/me')).response.status, 200);
    });
    await t.test('tampered cookies cannot impersonate an authenticated user', async () => {
      const attacker = clients();
      for (const [name, value] of member.cookies) attacker.cookies.set(name, value);
      const sessionCookie = [...attacker.cookies.keys()].find((name) => name.includes('session-token'))!;
      attacker.cookies.set(sessionCookie, 'invalid-session-token');
      assert.equal((await attacker.request('/api/auth/me')).response.status, 401);
    });
    await t.test('members cannot access admin routes or impersonate another member', async () => {
      assert.equal((await member.request('/api/bookings')).response.status, 403);
      assert.equal((await member.request('/api/cars', 'POST', {})).response.status, 403);
      assert.equal((await member.request('/api/bookings/fake/status', 'PATCH', { status: 'APPROVED' })).response.status, 403);
      const input = { carId: 'fake', userId: 'another-user', startDateTime: '2026-12-01T10:00:00Z', endDateTime: '2026-12-01T12:00:00Z' };
      assert.equal((await member.request('/api/bookings', 'POST', input)).response.status, 403);
      assert.equal((await anonymous.request('/api/bookings', 'POST', input)).response.status, 401);
    });
    await t.test('admin privileges, role changes and inactive accounts are read from the database', async () => {
      await prisma.user.create({ data: { email: adminEmail, name: 'Test Admin', password: await hashPassword(password), role: 'ADMIN' } });
      const admin = clients();
      await admin.login(adminEmail, password);
      assert.equal((await admin.request('/api/bookings')).response.status, 200);
      await prisma.user.update({ where: { email: adminEmail }, data: { role: 'USER' } });
      assert.equal((await admin.request('/api/bookings')).response.status, 403);
      await prisma.user.update({ where: { email: adminEmail }, data: { isActive: false } });
      assert.equal((await admin.request('/api/auth/me')).response.status, 401);
      assert.match((await clients().login(adminEmail, password)).data.url, /CredentialsSignin/);
    });
    await t.test('changing password checks the old password and revokes both existing sessions', async () => {
      assert.equal((await member.request('/api/auth/change-password', 'POST', { currentPassword: 'incorrect', newPassword: 'NewPassword123!' })).response.status, 400);
      assert.equal((await member.request('/api/auth/change-password', 'POST', { currentPassword: password, newPassword: password })).response.status, 400);
      const changed = await member.request('/api/auth/change-password', 'POST', { currentPassword: password, newPassword: 'NewPassword123!' });
      assert.equal(changed.response.status, 200);
      assert.equal((await member.request('/api/auth/me')).response.status, 401);
      assert.equal((await otherDevice.request('/api/auth/me')).response.status, 401);
      assert.equal((await member.request('/api/auth/session')).data, null);
      assert.match((await member.login(email, password)).data.url, /CredentialsSignin/);
      assert.doesNotMatch((await member.login(email, 'NewPassword123!')).data.url, /error=/);
      assert.equal((await member.request('/api/auth/me')).response.status, 200);
    });
    await t.test('logout requires CSRF and clears the active session', async () => {
      assert.match((await member.request('/api/auth/logout', 'POST', {})).data.url, /MissingCSRF/);
      assert.equal((await member.request('/api/auth/me')).response.status, 200);
      const csrf = await member.request('/api/auth/csrf');
      assert.equal((await member.request('/api/auth/logout', 'POST', { csrfToken: csrf.data.csrfToken })).response.status, 200);
      assert.equal((await member.request('/api/auth/me')).response.status, 401);
    });
    await t.test('register-and-book hashes the guest password and assigns the booking owner', async () => {
      const car = await prisma.car.findFirstOrThrow({ where: { isAvailable: true } });
      const result = await anonymous.request('/api/bookings', 'POST', {
        carId: car.id, startDateTime: '2026-12-01T10:00:00Z', endDateTime: '2026-12-01T12:00:00Z',
        registerUser: { email: guestEmail, name: 'Test Guest', password },
      });
      assert.equal(result.response.status, 201);
      assert.equal(result.data.data.user.email, guestEmail);
      assert.equal(result.data.data.source, 'REGISTER_AND_BOOK');
      const guest = await prisma.user.findUniqueOrThrow({ where: { email: guestEmail } });
      assert.equal(await verifyPassword(password, guest.password), true);
      assert.doesNotMatch((await anonymous.login(guestEmail, password)).data.url, /error=/);
      const booked = await anonymous.request('/api/bookings', 'POST', {
        carId: car.id, startDateTime: '2026-12-02T10:00:00Z', endDateTime: '2026-12-02T12:00:00Z',
      });
      assert.equal(booked.response.status, 201);
      assert.equal(booked.data.data.userId, guest.id);
      assert.equal(booked.data.data.source, 'EXISTING_MEMBER');
    });
    await t.test('sensitive endpoints reject excessive requests with 429', async () => {
      const limitedServer = createApp().listen(0, '127.0.0.1');
      await once(limitedServer, 'listening');
      try {
        const url = `http://127.0.0.1:${(limitedServer.address() as AddressInfo).port}/api/auth/register`;
        for (let i = 0; i < 30; i++) {
          const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
          assert.equal(response.status, 400);
          await response.text();
        }
        const blocked = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        assert.equal(blocked.status, 429);
        assert.ok(blocked.headers.has('retry-after'));
        await blocked.text();
      } finally {
        limitedServer.close();
        await once(limitedServer, 'close');
      }
    });
  } finally {
    // Delete only accounts unique to this test run and their bookings.
    const testUsers = await prisma.user.findMany({ where: { email: { in: [email, adminEmail, guestEmail] } }, select: { id: true } });
    const ids = testUsers.map((user) => user.id);
    await prisma.booking.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    server.close();
    await once(server, 'close');
    await prisma.$disconnect();
  }
});
