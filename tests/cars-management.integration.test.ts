import { count, execute, fixtureBooking, fixtureUser, inventoryCar, row } from './fixtures.js';
import { closeDatabasePool, withTransaction } from '../src/lib/db.js';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

test('admin login and car management HTTP flow', { skip: !process.env.AUTH_TEST_DATABASE_URL }, async (t) => {
  process.env.DATABASE_URL = process.env.AUTH_TEST_DATABASE_URL;
  process.env.AUTH_SECRET = 'admin-integration-test-secret-1234567890';
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('../src/app.js');
  const { hashPassword } = await import('../src/utils/password.js');
  const runId = randomUUID();
  const password = 'AdminTestPassword123!';
  const adminEmail = `cars-admin-${runId}@funch.example`;
  const memberEmail = `cars-member-${runId}@funch.example`;
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
        return { status: response.status, data: await response.json() };
      },
      async login(email: string, scope?: 'admin') {
        const csrf = await this.request('/api/auth/csrf');
        return this.request('/api/auth/login', 'POST', { email, password, scope, csrfToken: csrf.data.csrfToken });
      },
    };
  }
  const admin = client(); const member = client(); const anonymous = client();
  let carId = '';
  let userId = '';
  try {
    const hash = await hashPassword(password);
    await fixtureUser({ email: adminEmail, name: 'Car Test Admin', password: hash, role: 'ADMIN' });
    userId = (await fixtureUser({ email: memberEmail, name: 'Car Test Member', password: hash })).id;
    const location = await row('SELECT * FROM locations WHERE "countryCode" = $1 ORDER BY id LIMIT 1', ['JP']);
    const input = {
      brand: 'Integration', model: 'Test Car', year: 2026, licensePlate: `test-${runId}`, country: 'JP',
      hourlyRate: 123.45, dailyRate: 999.99, seats: 5, luggageCapacity: 3,
      transmission: 'Automatic', transmissionType: 'AUTOMATIC', fuelType: 'Hybrid', steeringSide: 'RHD',
      locationId: location.id, categories: ['SUV', 'ECO'], categoryLabel: 'Test SUV',
      providerName: 'Integration Cars', isAvailable: false, featureCodes: ['GPS_EN'],
      options: [{ code: 'GPS_EN', label: 'GPS ภาษาอังกฤษ', included: true }],
    };
    await t.test('admin-scoped login rejects members and accepts active admins', async () => {
      const rejected = await client().login(memberEmail, 'admin');
      assert.match(rejected.data.url, /CredentialsSignin/);
      assert.doesNotMatch((await admin.login(adminEmail, 'admin')).data.url, /error=/);
      assert.equal((await admin.request('/api/auth/session')).data.user.role, 'ADMIN');
      assert.doesNotMatch((await member.login(memberEmail)).data.url, /error=/);
    });
    await t.test('anonymous users and members cannot list, add or modify inventory', async () => {
      for (const [actor, status] of [[anonymous, 401], [member, 403]] as const) {
        assert.equal((await actor.request('/api/cars/catalog')).status, status);
        assert.equal((await actor.request('/api/cars', 'POST', input)).status, status);
        assert.equal((await actor.request('/api/cars/missing', 'PATCH', input)).status, status);
      }
    });
    await t.test('create persists rates, multi-category specs, features and maintenance status', async () => {
      const created = await admin.request('/api/cars', 'POST', input);
      assert.equal(created.status, 201);
      carId = created.data.data.id;
      const saved = await row('SELECT *, categories::text[] AS categories FROM cars WHERE id = $1', [carId]);
      assert.equal(saved.dailyRate.toString(), '999.99');
      assert.equal(saved.hourlyRate.toString(), '123.45');
      assert.equal(saved.isAvailable, false);
      assert.deepEqual(saved.featureCodes, ['GPS_EN']);
      assert.deepEqual(saved.categories, ['SUV', 'ECO']);
      const catalog = await admin.request('/api/cars/catalog');
      assert.equal(catalog.status, 200);
      const unit = catalog.data.data.units.find((car: { id: string }) => car.id === carId);
      assert.ok(unit);
      assert.equal(unit.rawModel, 'Test Car');
      assert.equal(unit.year, 2026);
      assert.equal(unit.rentalStatus, 'IDLE');
      assert.equal('bookings' in unit, false);
      assert.equal((await admin.request('/api/cars', 'POST', input)).status, 409);
    });
    await t.test('invalid rates, fields and country/location combinations cannot be saved', async () => {
      const mixedInput = { ...input, carModelLocationId: 'existing-offer' };
      assert.equal((await admin.request('/api/cars', 'POST', mixedInput)).status, 400);
      assert.equal((await admin.request(`/api/cars/${carId}`, 'PATCH', mixedInput)).status, 400);
      for (const change of [{ hourlyRate: -1 }, { dailyRate: 1.001 }, { seats: 0 }, { categories: ['INVALID'] }, { country: 'TH' }, { role: 'ADMIN' }]) {
        assert.equal((await admin.request(`/api/cars/${carId}`, 'PATCH', { ...input, ...change })).status, 400);
      }
      assert.equal((await admin.request('/api/cars/missing', 'PATCH', input)).status, 404);
      assert.equal((await row('SELECT * FROM cars WHERE "id" = $1', [carId])).hourlyRate.toString(), '123.45');
    });
    await t.test('editing updates public results while retaining unrelated vehicle data', async () => {
      await execute(`UPDATE cars SET "description" = $2, "rating" = $3, "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC' WHERE "id" = $1`, [carId, 'Preserve this', 4.9]);
      const { carModelLocation } = await inventoryCar(carId);
      assert.ok(carModelLocation);
      const imageUrl = 'https://example.com/model.jpg';
      const { licensePlate, country, hourlyRate, dailyRate, locationId, providerName, isAvailable, ...specification } = input;
      const model = await admin.request(`/api/cars/models/${carModelLocation.carModelId}`, 'PATCH', { ...specification, imageUrl });
      assert.equal(model.status, 200);
      assert.equal(model.data.data.imageUrl, imageUrl);
      const updated = await admin.request(`/api/cars/${carId}`, 'PATCH', { ...input, model: 'Updated', dailyRate: 1500, isAvailable: true });
      assert.equal(updated.status, 200);
      const saved = await inventoryCar(carId);
      assert.equal(saved.carModelLocation?.carModel.imageUrl, imageUrl);
      const search = await anonymous.request(`/api/cars/search?${new URLSearchParams({ locationId })}`);
      assert.equal(search.status, 200);
      const offer = search.data.data.find((car: { id: string }) => car.id === saved.carModelLocationId);
      assert.ok(offer);
      assert.equal(offer.name, 'Integration Updated');
      assert.equal(offer.day, 1500);
      assert.equal(offer.isAvailable, true);
      assert.equal(offer.description, 'Preserve this');
      assert.equal(offer.rating, 4.9);
    });
    await t.test('booking status is derived from live bookings and moving booked cars is rejected', async () => {
      const now = Date.now();
      const booking = await fixtureBooking({
        userId, carId, status: 'PENDING', startDateTime: new Date(now + 86400000), endDateTime: new Date(now + 172800000), totalPrice: 1500,
      });
      const state = async () => {
        const catalog = await admin.request('/api/cars/catalog');
        assert.equal(catalog.status, 200);
        const unit = catalog.data.data.units.find((car: { id: string }) => car.id === carId);
        assert.ok(unit);
        return unit.rentalStatus;
      };
      assert.equal(await state(), 'RESERVED');
      await execute(`UPDATE bookings SET "startDateTime" = $2, "status" = $3, "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC' WHERE "id" = $1`, [booking.id, new Date(now - 3600000), 'APPROVED']);
      assert.equal(await state(), 'IN_USE');
      assert.equal((await admin.request(`/api/cars/${carId}`, 'PATCH', { ...input, locationId: null })).status, 409);
      await execute(`UPDATE bookings SET "status" = $2, "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC' WHERE "id" = $1`, [booking.id, 'CANCELLED']);
      assert.equal(await state(), 'IDLE');
    });
    await t.test('a concurrent admin edit invalidates booking data read before the row lock', async () => {
      let unlock!: () => void;
      let acquired!: () => void;
      const locked = new Promise<void>((resolve) => { acquired = resolve; });
      const release = new Promise<void>((resolve) => { unlock = resolve; });
      const edit = withTransaction(async (tx) => {
        await tx.query("SELECT id FROM cars WHERE id = $1 FOR UPDATE", [carId]);
        acquired();
        await release;
        await execute(`UPDATE cars SET "isAvailable" = $2, "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC' WHERE "id" = $1`, [carId, false], tx);
      }, { timeoutMs: 10000 });
      await locked;
      const startDateTime = new Date(Date.now() + 86400000 * 10).toISOString();
      const pending = member.request('/api/bookings', 'POST', {
        carId, startDateTime, endDateTime: new Date(Date.now() + 86400000 * 11).toISOString(),
      });
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const locks = await count(`SELECT count(*) AS count FROM pg_stat_activity
            WHERE wait_event_type = $1 AND query LIKE $2`, ["Lock", "SELECT id FROM cars%"]);
          if (locks > 0) { waiting = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(waiting, true, 'booking must reach the locked car before the edit commits');
      } finally { unlock(); await edit; }
      const result = await pending;
      assert.equal(result.status, 409);
      assert.equal(result.data.message, 'Car details changed; please refresh and try again');
      assert.equal(await count('SELECT count(*) AS count FROM bookings WHERE "carId" = $1 AND "startDateTime" = $2', [carId, new Date(startDateTime)]), 0);
    });
    await t.test('revoked admin rights apply to existing sessions', async () => {
      await execute(`UPDATE users SET "role" = $2, "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC' WHERE "email" = $1`, [adminEmail, 'USER']);
      assert.equal((await admin.request('/api/cars/catalog')).status, 403);
      assert.equal((await admin.request(`/api/cars/${carId}`, 'PATCH', input)).status, 403);
    });
  } finally {
    if (carId) {
      await execute('DELETE FROM bookings WHERE "carId" = $1', [carId]);
      await execute('DELETE FROM cars WHERE "id" = $1', [carId]);
    }
    await execute('DELETE FROM users WHERE "email" = ANY($1::text[])', [[adminEmail, memberEmail]]);
    server.close(); await closeDatabasePool();
  }
});
