import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

test('admin booking approval lists real data and prevents stale reviews', { skip: !process.env.AUTH_TEST_DATABASE_URL }, async (t) => {
  process.env.DATABASE_URL = process.env.AUTH_TEST_DATABASE_URL;
  process.env.AUTH_SECRET = 'booking-approval-test-secret-1234567890';
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('../src/app.js');
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { hashPassword } = await import('../src/utils/password.js');
  const tag = `approval-${randomUUID()}`;
  const password = 'ApprovalTestPassword123!';
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  function client() {
    const cookies = new Map<string, string>();
    return {
      async request(path: string, method = 'GET', body?: unknown) {
        const response = await fetch(base + path, { method, redirect: 'manual', headers: {
          cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        }, body: body === undefined ? undefined : JSON.stringify(body) });
        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(';')[0]; const split = pair.indexOf('=');
          cookies.set(pair.slice(0, split), pair.slice(split + 1));
        }
        return { status: response.status, headers: response.headers, body: await response.json() };
      },
      async login(email: string) {
        const csrf = await this.request('/api/auth/csrf');
        const result = await this.request('/api/auth/login', 'POST', { email, password, csrfToken: csrf.body.csrfToken });
        assert.doesNotMatch(result.body.url, /error=/);
      },
    };
  }
  const admin = client(); const member = client(); const anonymous = client();
  let carId = '';
  try {
    const hash = await hashPassword(password);
    const actor = await prisma.user.create({ data: { email: `${tag}-admin@funch.example`, name: `${tag} Admin`, password: hash, role: 'ADMIN' } });
    const user = await prisma.user.create({ data: { email: `${tag}-user@funch.example`, name: `${tag} Customer`, phoneNumber: '+66 89 123 4567', password: hash } });
    await admin.login(actor.email); await member.login(user.email);
    const location = await prisma.location.findFirstOrThrow({ where: { timeZone: 'Asia/Tokyo' } });
    const car = await prisma.car.create({ data: { brand: 'Approval', model: 'Test vehicle', year: 2026,
      licensePlate: tag, country: location.countryCode, locationId: location.id, hourlyRate: 100, dailyRate: 1000 } });
    carId = car.id;
    const statuses = ['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED'] as const;
    const bookings = [];
    for (const [index, status] of statuses.entries()) {
      const start = new Date(Date.now() + (90 + index * 2) * 86_400_000);
      bookings.push(await prisma.booking.create({ data: {
        bookingNumber: `${tag}-${status}`, userId: user.id, carId: car.id, status,
        startDateTime: start, endDateTime: new Date(start.getTime() + 3_600_000),
        pickupLocationId: location.id, dropoffLocationId: location.id, timeZone: location.timeZone,
        totalPrice: (index + 1) * 100, calculatedHours: index + 1, hourlyRate: 100, dailyRate: 1000,
        driverName: 'Approval Driver', internationalDrivingPermit: 'APPROVAL-IDP-123',
        carSnapshot: { brand: 'Historical Brand', model: 'Historical Model', licensePlate: 'HISTORY-001',
          pickupLocationName: 'Historical pickup', pickupTimeZone: 'Asia/Tokyo' },
      } }));
    }
    const prefix = '/api/bookings';
    const filtered = `${prefix}?search=${tag}&page=1`;
    await t.test('only admins can list and review bookings', async () => {
      for (const [who, status] of [[anonymous, 401], [member, 403]] as const) {
        assert.equal((await who.request(filtered)).status, status);
        assert.equal((await who.request(`${prefix}/${bookings[0].id}/status`, 'PATCH', { status: 'APPROVED' })).status, status);
      }
    });
    await t.test('pagination, filters, summary and snapshots come from persisted bookings', async () => {
      const result = await admin.request(`${filtered}&pageSize=2&sort=pickup`);
      assert.equal(result.status, 200);
      assert.equal(result.body.count, 5);
      assert.equal(result.body.data.length, 2);
      assert.equal(result.body.pagination.totalPages, 3);
      assert.equal(result.body.data[0].id, bookings[0].id);
      assert.equal(result.body.data[0].carSnapshot.brand, 'Historical Brand');
      assert.equal(result.body.data[0].internationalDrivingPermit, 'APPROVAL-IDP-123');
      for (const status of statuses) assert.ok(result.body.summary[status] >= 1);
      assert.ok(result.body.countries.some((country: { code: string }) => country.code === location.countryCode));
      assert.match(result.headers.get('cache-control')!, /no-store/);
      assert.equal(JSON.stringify(result.body).includes('password'), false);
      assert.equal(JSON.stringify(result.body).includes('sessionVersion'), false);
      const pending = await admin.request(`${filtered}&status=PENDING&country=${location.countryCode}`);
      assert.equal(pending.body.data.length, 1);
      assert.equal(pending.body.data[0].status, 'PENDING');
      const wrongCountry = await admin.request(`${filtered}&country=ZZ`);
      assert.equal(wrongCountry.body.pagination.total, 0);
      const highest = await admin.request(`${filtered}&sort=value`);
      assert.equal(highest.body.data[0].id, bookings[4].id);
      const last = await admin.request(`${prefix}?search=${tag}&page=999&pageSize=2`);
      assert.equal(last.status, 200);
      assert.equal(last.body.pagination.page, 3);
      assert.equal(last.body.data.length, 1);
      const legacy = await admin.request(`${prefix}?search=${tag}`);
      assert.equal(legacy.body.data.length, 5);
    });
    await t.test('invalid filters and review input cannot change booking records', async () => {
      for (const query of ['page=0', 'pageSize=101', 'sort=invalid', 'status=invalid', 'country=invalid', 'search=' + 'a'.repeat(255)]) {
        assert.equal((await admin.request(`${prefix}?${query}`)).status, 400);
      }
      for (const input of [{ status: 'invalid' }, { status: 'APPROVED', adminNote: 'a'.repeat(2001) },
        { status: 'APPROVED', expectedUpdatedAt: 'invalid' }, { status: 'APPROVED', approvedById: user.id }]) {
        assert.equal((await admin.request(`${prefix}/${bookings[0].id}/status`, 'PATCH', input)).status, 400);
      }
      assert.equal((await admin.request(`${prefix}/missing/status`, 'PATCH', { status: 'APPROVED' })).status, 404);
    });
    await t.test('concurrent reviews apply once, preserve prices, and record the reviewer', async () => {
      const booking = bookings[0];
      const reviews = await Promise.all(['APPROVED', 'REJECTED'].map((status) => admin.request(`${prefix}/${booking.id}/status`, 'PATCH', {
        status, adminNote: `  Review ${status}  `, expectedUpdatedAt: booking.updatedAt.toISOString(),
      })));
      assert.deepEqual(reviews.map((result) => result.status).sort(), [200, 409]);
      assert.equal(reviews.find((result) => result.status === 409)!.body.message, 'BOOKING_CHANGED');
      const saved = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      assert.equal(saved.approvedById, actor.id);
      assert.ok(saved.reviewedAt);
      assert.equal(saved.adminNote, `Review ${saved.status}`);
      assert.equal(saved.totalPrice.toString(), booking.totalPrice.toString());
      assert.equal(saved.timeZone, 'Asia/Tokyo');
      assert.deepEqual(saved.carSnapshot, booking.carSnapshot);
      const latest = await admin.request(`${prefix}?search=${booking.bookingNumber}&page=1`);
      assert.equal(latest.body.data[0].approvedBy.name, actor.name);
    });
    await t.test('completed bookings cannot be approved again', async () => {
      assert.equal((await admin.request(`${prefix}/${bookings[2].id}/status`, 'PATCH', { status: 'APPROVED' })).status, 409);
    });
  } finally {
    if (carId) {
      await prisma.booking.deleteMany({ where: { carId } });
      await prisma.car.delete({ where: { id: carId } });
    }
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
    server.close(); await once(server, 'close');
    await prisma.$disconnect();
  }
});
