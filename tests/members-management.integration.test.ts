import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

test('admin member management with PostgreSQL and Auth.js', { skip: !process.env.AUTH_TEST_DATABASE_URL }, async (t) => {
  process.env.DATABASE_URL = process.env.AUTH_TEST_DATABASE_URL;
  process.env.AUTH_SECRET = 'member-integration-test-secret-1234567890';
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('../src/app.js');
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { hashPassword, verifyPassword } = await import('../src/utils/password.js');
  const tag = `members-${randomUUID()}`;
  const password = 'MemberTestPassword123!';
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  function client() {
    const cookies = new Map<string, string>();
    return {
      async request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
        const response = await fetch(base + path, { method, redirect: 'manual', headers: {
          cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers,
        }, body: body === undefined ? undefined : JSON.stringify(body) });
        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(';')[0]; const split = pair.indexOf('=');
          cookies.set(pair.slice(0, split), pair.slice(split + 1));
        }
        return { status: response.status, headers: response.headers, data: await response.json() };
      },
      async login(email: string) {
        const csrf = await this.request('/api/auth/csrf');
        const result = await this.request('/api/auth/login', 'POST', { email, password, csrfToken: csrf.data.csrfToken });
        assert.doesNotMatch(result.data.url, /error=/);
      },
    };
  }
  const admin = client(); const member = client(); const anonymous = client();
  const prefix = '/api/admin/members';
  let memberId = ''; let carId = '';
  try {
    const hash = await hashPassword(password);
    const actor = await prisma.user.create({ data: { email: `${tag}-admin@funch.example`, name: `${tag} admin`, password: hash, role: 'ADMIN' } });
    await admin.login(actor.email);
    const input = { email: `${tag}-user@funch.example`, name: `${tag} Customer`, phoneNumber: '+66 81 234 5678',
      role: 'USER', isActive: true, password };
    const ordinary = await prisma.user.create({ data: { email: `${tag}-ordinary@funch.example`, name: `${tag} Ordinary`, password: hash } });
    await member.login(ordinary.email);

    await t.test('anonymous and non-admin users cannot read or write member information', async () => {
      for (const [who, status] of [[anonymous, 401], [member, 403]] as const) {
        for (const [path, method, body] of [[prefix, 'GET', undefined], [prefix, 'POST', input],
          [`${prefix}/${actor.id}`, 'GET', undefined], [`${prefix}/${actor.id}`, 'PATCH', { name: 'Unauthorized' }]] as const) {
          assert.equal((await who.request(path, method, body)).status, status);
        }
      }
    });
    await t.test('creation normalizes email, hashes password and only returns public fields', async () => {
      const created = await admin.request(prefix, 'POST', { ...input, email: input.email.toUpperCase() });
      assert.equal(created.status, 201);
      memberId = created.data.data.id;
      assert.equal(created.data.data.email, input.email);
      assert.equal('password' in created.data.data, false);
      assert.equal('sessionVersion' in created.data.data, false);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: memberId } });
      assert.notEqual(stored.password, password);
      assert.equal(await verifyPassword(password, stored.password), true);
      assert.equal((await admin.request(prefix, 'POST', input)).status, 409);
    });
    await t.test('invalid fields, short passwords, duplicate emails and cross-origin writes are rejected', async () => {
      for (const change of [{ name: ' ' }, { email: 'invalid' }, { password: 'short' }, { role: 'ROOT' },
        { isActive: 'true' }, { sessionVersion: 123 }]) {
        assert.equal((await admin.request(prefix, 'POST', { ...input, ...change })).status, 400);
      }
      assert.equal((await admin.request(`${prefix}/${memberId}`, 'PATCH', { password: 'UnexpectedPassword123' })).status, 400);
      assert.equal((await admin.request(`${prefix}/${memberId}`, 'PATCH', {})).status, 400);
      assert.equal((await admin.request(`${prefix}/${memberId}`, 'PATCH', { email: actor.email })).status, 409);
      assert.equal((await admin.request(`${prefix}/${memberId}`, 'PATCH', { name: 'Changed' }, { origin: 'https://attacker.example' })).status, 403);
      assert.equal((await admin.request(prefix, 'POST')).status, 415);
      assert.equal((await admin.request(`${prefix}/missing`, 'GET')).status, 404);
      assert.equal((await admin.request(`${prefix}/missing`, 'PATCH', { name: 'Missing' })).status, 404);
    });
    await t.test('search, role and status filters paginate consistently without leaking credentials', async () => {
      const list = await admin.request(`${prefix}?search=${tag}&pageSize=1`);
      assert.equal(list.status, 200);
      assert.equal(list.data.pagination.total, 3);
      assert.equal(list.data.pagination.totalPages, 3);
      assert.equal(list.data.data.length, 1);
      assert.match(list.headers.get('cache-control')!, /no-store/);
      assert.equal(JSON.stringify(list.data).includes('password'), false);
      assert.equal(JSON.stringify(list.data).includes('sessionVersion'), false);
      const admins = await admin.request(`${prefix}?search=${tag}&role=ADMIN`);
      assert.deepEqual(admins.data.data.map((item: { id: string }) => item.id), [actor.id]);
      assert.equal((await admin.request(`${prefix}?search=234%205678`)).data.data[0].id, memberId);
      assert.equal((await admin.request(`${prefix}?search=${tag}&status=suspended`)).data.pagination.total, 0);
      assert.equal((await admin.request(`${prefix}?search=${tag}&page=999&pageSize=1`)).data.pagination.page, 3);
      assert.equal((await admin.request(`${prefix}?page=-1`)).status, 400);
      assert.equal((await admin.request(`${prefix}?pageSize=101`)).status, 400);
    });
    await t.test('history retains booking snapshots and spending excludes pending, rejected and cancelled bookings', async () => {
      carId = (await prisma.car.create({ data: { brand: 'History', model: 'Current', year: 2026,
        licensePlate: tag, country: 'JP', hourlyRate: 100, dailyRate: 1000 } })).id;
      for (const [status, price] of [['APPROVED', 1500], ['COMPLETED', 2000], ['PENDING', 500], ['REJECTED', 700], ['CANCELLED', 900]] as const) {
        await prisma.booking.create({ data: { userId: memberId, carId, status, totalPrice: price,
          startDateTime: new Date('2026-10-01T00:00:00Z'), endDateTime: new Date('2026-10-02T00:00:00Z'),
          carSnapshot: { brand: 'Original', model: 'Snapshot', licensePlate: 'ORIGINAL' },
          timeZone: 'Asia/Tokyo', driverName: 'Original Driver', internationalDrivingPermit: 'TEST-IDP' } });
      }
      const detail = await admin.request(`${prefix}/${memberId}?pageSize=2`);
      assert.equal(detail.data.data.bookingCount, 5);
      assert.equal(detail.data.data.totalSpend, '3500');
      assert.equal(detail.data.data.pagination.totalPages, 3);
      assert.equal(detail.data.data.bookings.length, 2);
      assert.equal(detail.data.data.bookings[0].carSnapshot.brand, 'Original');
      assert.equal(detail.data.data.bookings[0].internationalDrivingPermit, 'TEST-IDP');
      const list = await admin.request(`${prefix}?search=${input.email}`);
      assert.equal(list.data.data[0].totalSpend, '3500');
      assert.equal(list.data.data[0].bookingCount, 5);
    });
    await t.test('profile edits preserve password and self-protection prevents admin lockout', async () => {
      const before = await prisma.user.findUniqueOrThrow({ where: { id: memberId } });
      assert.equal((await admin.request(`${prefix}/${memberId}`, 'PATCH', { name: 'Updated Customer', phoneNumber: '' })).status, 200);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: memberId } });
      assert.equal(after.name, 'Updated Customer'); assert.equal(after.phoneNumber, null);
      assert.equal(after.password, before.password); assert.equal(after.sessionVersion, before.sessionVersion);
      assert.equal((await admin.request(`${prefix}/${actor.id}`, 'PATCH', { role: 'USER' })).status, 409);
      assert.equal((await admin.request(`${prefix}/${actor.id}`, 'PATCH', { isActive: false })).status, 409);
      assert.equal((await admin.request(`${prefix}/${actor.id}`, 'PATCH', { name: `${tag} Renamed Admin` })).status, 200);
    });
    await t.test('suspension invalidates sessions permanently and reactivation preserves bookings', async () => {
      const device = client(); const secondDevice = client();
      await device.login(input.email); await secondDevice.login(input.email);
      const before = await prisma.user.findUniqueOrThrow({ where: { id: memberId } });
      assert.equal((await admin.request(`${prefix}/${memberId}`, 'PATCH', { isActive: false })).status, 200);
      assert.equal((await device.request('/api/auth/me')).status, 401);
      assert.equal((await secondDevice.request('/api/auth/me')).status, 401);
      const suspended = await prisma.user.findUniqueOrThrow({ where: { id: memberId } });
      assert.equal(suspended.sessionVersion, before.sessionVersion + 1);
      assert.equal((await admin.request(`${prefix}/${memberId}`, 'PATCH', { isActive: true })).status, 200);
      assert.equal((await device.request('/api/auth/me')).status, 401);
      await device.login(input.email);
      assert.equal((await device.request('/api/auth/me')).status, 200);
      assert.equal(await prisma.booking.count({ where: { userId: memberId } }), 5);
    });
    await t.test('role changes invalidate existing sessions and apply on fresh login', async () => {
      const device = client(); await device.login(input.email);
      assert.equal((await admin.request(`${prefix}/${memberId}`, 'PATCH', { role: 'ADMIN' })).status, 200);
      assert.equal((await device.request(prefix)).status, 401);
      await device.login(input.email);
      assert.equal((await device.request(prefix)).status, 200);
      assert.equal((await admin.request(`${prefix}/${memberId}`, 'PATCH', { role: 'USER' })).status, 200);
      assert.equal((await device.request(prefix)).status, 401);
    });
    await t.test('concurrent admins cannot revoke one another using stale authorization', async () => {
      const a = await prisma.user.create({ data: { email: `${tag}-a@funch.example`, name: tag, password: hash, role: 'ADMIN' } });
      const b = await prisma.user.create({ data: { email: `${tag}-b@funch.example`, name: tag, password: hash, role: 'ADMIN' } });
      const first = client(); const second = client(); await first.login(a.email); await second.login(b.email);
      const results = await Promise.all([
        first.request(`${prefix}/${b.id}`, 'PATCH', { role: 'USER' }),
        second.request(`${prefix}/${a.id}`, 'PATCH', { role: 'USER' }),
      ]);
      assert.equal(results.filter((result) => result.status === 200).length, 1);
      assert.equal(results.filter((result) => [401, 403].includes(result.status)).length, 1);
      assert.equal(await prisma.user.count({ where: { id: { in: [a.id, b.id] }, role: 'ADMIN', isActive: true } }), 1);
    });
  } finally {
    if (carId) { await prisma.booking.deleteMany({ where: { carId } }); await prisma.car.deleteMany({ where: { id: carId } }); }
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
    server.close(); await prisma.$disconnect();
  }
});
