import { execute, fixtureBooking, fixtureCar, fixtureLocation, fixtureUser } from './fixtures.js';
import { closeDatabasePool, databasePool, queryRows } from '../src/lib/db.js';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

test('admin reports aggregate persisted bookings with authorized filters and complete CSV exports', { skip: !process.env.AUTH_TEST_DATABASE_URL }, async (t) => {
  process.env.DATABASE_URL = process.env.AUTH_TEST_DATABASE_URL;
  process.env.AUTH_SECRET = 'report-integration-test-secret-1234567890';
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('../src/app.js');
  const { hashPassword } = await import('../src/utils/password.js');
  const tag = `reports-${randomUUID()}`;
  const password = 'ReportTestPassword123!';
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
        const text = await response.text();
        return { status: response.status, headers: response.headers, text,
          data: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null };
      },
      async login(email: string) {
        const csrf = await this.request('/api/auth/csrf');
        const result = await this.request('/api/auth/login', 'POST', { email, password, csrfToken: csrf.data.csrfToken });
        assert.doesNotMatch(result.data.url, /error=/);
      },
    };
  }
  const admin = client(); const member = client(); const anonymous = client();
  const prefix = '/api/admin/reports';
  let carId = ''; let locationId = ''; const countryCodes: string[] = [];
  try {
    const hash = await hashPassword(password);
    const actor = await fixtureUser({ email: `${tag}-admin@funch.example`, name: 'Report Admin', password: hash, role: 'ADMIN' });
    const customer = await fixtureUser({ email: `${tag}-user@funch.example`, name: 'Report Customer', password: hash });
    await admin.login(actor.email); await member.login(customer.email);
    const countries = await queryRows<{ code: string }>(databasePool(), `
      INSERT INTO countries (code, name, "nameTh", flag, "currencyCode", "drivingSide")
      SELECT candidate.code, $1 || '-' || candidate.code, candidate.code, candidate.code, 'THB', 'LEFT'
      FROM (SELECT chr(a) || chr(b) AS code
        FROM generate_series(65, 90) a CROSS JOIN generate_series(65, 90) b) candidate
      WHERE NOT EXISTS (SELECT 1 FROM countries WHERE code::text = candidate.code)
      ORDER BY random() LIMIT 2 ON CONFLICT (code) DO NOTHING RETURNING code`, [tag]);
    countryCodes.push(...countries.map(({ code }) => code));
    assert.equal(countryCodes.length, 2);
    const [pickupCountry, legacyCountry] = countryCodes;
    const period = '?start=2090-11-01&end=2090-11-02';
    const query = period + '&country=' + pickupCountry;
    locationId = (await fixtureLocation({ name: tag, nameTh: 'Report pickup', city: tag, cityTh: tag, countryCode: pickupCountry, timeZone: 'Asia/Tokyo' })).id;
    carId = (await fixtureCar({ brand: 'Edited', model: 'Current', year: 2026, licensePlate: tag,
      country: legacyCountry, hourlyRate: 100, dailyRate: 1000, categories: ['SUV', 'EV'] })).id;
    const createBooking = (status: 'APPROVED' | 'COMPLETED' | 'PENDING' | 'REJECTED' | 'CANCELLED', totalPrice: string, currencyCode = 'THB', createdAt = '2090-11-01T00:00:00Z', pickupLocationId: string | null = locationId) =>
      fixtureBooking({ userId: customer.id, carId, status, totalPrice, currencyCode, pickupLocationId, createdAt: new Date(createdAt),
        startDateTime: new Date('2090-12-01T00:00:00Z'), endDateTime: new Date('2090-12-02T00:00:00Z'), calculatedDays: 1,
        carSnapshot: { brand: 'Original', model: 'Historical', licensePlate: 'SNAPSHOT' }, timeZone: 'Asia/Tokyo' });
    await createBooking('APPROVED', '0.10', 'THB', '2090-10-31T17:00:00Z');
    await createBooking('COMPLETED', '0.20', 'THB', '2090-11-02T16:59:59.999Z');
    await createBooking('PENDING', '10'); await createBooking('REJECTED', '20'); await createBooking('CANCELLED', '30');
    await createBooking('APPROVED', '99.99', 'USD');
    await createBooking('APPROVED', '5', 'THB', '2090-10-31T16:59:59.999Z');
    await createBooking('APPROVED', '100', 'THB', '2090-11-02T17:00:00Z');
    await createBooking('APPROVED', '999', 'THB', '2090-11-01T00:00:00Z', null);

    await t.test('JSON and CSV require admin rights and responses disable caching', async () => {
      for (const [who, status] of [[anonymous, 401], [member, 403]] as const) {
        for (const format of ['json', 'csv']) assert.equal((await who.request(prefix + query + `&format=${format}`)).status, status);
      }
      const result = await admin.request(prefix + query);
      assert.equal(result.status, 200); assert.match(result.headers.get('cache-control')!, /no-store/);
      assert.equal(JSON.stringify(result.data).includes(customer.email), false);
    });
    await t.test('Bangkok date boundaries, pickup country, status amounts, currencies and comparisons are accurate', async () => {
      const { data: { data } } = await admin.request(prefix + query);
      assert.equal(data.summary.total, 6); assert.equal(data.summary.confirmedCount, 3);
      assert.equal(data.summary.currencies.find((row: { currency: string }) => row.currency === 'THB').confirmed, '0.30');
      assert.equal(data.summary.currencies.find((row: { currency: string }) => row.currency === 'THB').total, '60.30');
      assert.equal(data.summary.currencies.find((row: { currency: string }) => row.currency === 'USD').confirmed, '99.99');
      assert.equal(data.comparison.start, '2090-10-30'); assert.equal(data.comparison.end, '2090-10-31');
      assert.equal(data.comparison.summary.currencies[0].confirmed, '5.00');
      assert.equal(data.bookings[0].carName, 'Original Historical'); assert.equal(data.bookings[0].licensePlate, 'SNAPSHOT');
      assert.equal(data.countries[0].code, pickupCountry);
      assert.equal(data.trend[0].amounts.THB, '0.10'); assert.equal(data.trend[1].amounts.THB, '0.20');
      assert.equal((await admin.request(prefix + query + '&currency=USD')).data.data.summary.total, 1);
      assert.equal((await admin.request(prefix + query + '&category=EV')).data.data.summary.total, 6);
      assert.equal((await admin.request(prefix + query + '&category=SEDAN')).data.data.summary.total, 0);
      assert.equal((await admin.request(prefix + period + '&country=' + legacyCountry)).data.data.summary.total, 1);
      assert.equal((await admin.request(prefix + query + '&basis=startDateTime')).data.data.summary.total, 0);
      assert.equal((await admin.request(prefix + query + '&comparison=none')).data.data.comparison, null);
    });
    await t.test('pagination keeps whole-period totals and CSV exports all records', async () => {
      const page = (await admin.request(prefix + query + '&pageSize=1&page=999')).data.data;
      assert.equal(page.pagination.page, 6); assert.equal(page.bookings.length, 1); assert.equal(page.summary.total, 6);
      const csv = await admin.request(prefix + query + '&pageSize=1&format=csv');
      assert.match(csv.headers.get('content-type')!, /text\/csv/);
      assert.match(csv.headers.get('content-disposition')!, /funch-booking-report-2090-11-01-2090-11-02.csv/);
      assert.equal(csv.text.split('Original Historical').length - 1, 6);
      assert.match(csv.text, /99.99/);
    });
    await t.test('invalid calendar dates, reversed or oversized ranges and unsupported filters return 400', async () => {
      for (const suffix of ['&start=2090-02-30', '&start=2090-12-01', '&start=2080-01-01', '&category=INVALID', '&currency=THBUSD', '&pageSize=101']) {
        const params = new URLSearchParams(query.slice(1));
        for (const [key, value] of new URLSearchParams(suffix.slice(1))) params.set(key, value);
        assert.equal((await admin.request(`${prefix}?${params}`)).status, 400);
      }
    });
  } finally {
    if (carId) { await execute('DELETE FROM bookings WHERE "carId" = $1', [carId]); await execute('DELETE FROM cars WHERE "id" = $1', [carId]); }
    if (locationId) await execute('DELETE FROM locations WHERE "id" = $1', [locationId]);
    await execute('DELETE FROM countries WHERE "code" = ANY($1::text[])', [countryCodes]);
    await execute('DELETE FROM users WHERE starts_with("email", $1)', [tag]);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await closeDatabasePool();
  }
});
