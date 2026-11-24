import { count, execute, fixtureCar, row } from './fixtures.js';
import { closeDatabasePool } from '../src/lib/db.js';
import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

test('real bookings persist driver details and reject overlapping concurrent reservations', { skip: !process.env.AUTH_TEST_DATABASE_URL }, async (t) => {
  process.env.DATABASE_URL = process.env.AUTH_TEST_DATABASE_URL;
  process.env.AUTH_SECRET = 'booking-integration-test-only-1234567890';
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('../src/app.js');
  const run = randomUUID();
  const emails = [0, 1, 2, 3].map((i) => `booking-${run}-${i}@funch.example`);
  const location = await row('SELECT * FROM locations WHERE "timeZone" = $1 ORDER BY id LIMIT 1', ['Asia/Tokyo']);
  const car = await fixtureCar({
    brand: 'Audit', model: 'Temporary test car', year: 2026, licensePlate: `audit-${run}`,
    country: location.countryCode, locationId: location.id, hourlyRate: 100, dailyRate: 1000,
  });
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const start = new Date(Date.now() + 90 * 86_400_000);
  start.setUTCHours(1, 0, 0, 0);
  const end = new Date(start.getTime() + 5 * 3_600_000);
  const input = {
    carId: car.id, startDateTime: start.toISOString(), endDateTime: end.toISOString(),
    pickupLocationId: location.id, dropoffLocationId: location.id,
    driverName: 'Audit Driver', internationalDrivingPermit: 'AUDIT-IDP-1234',
  };
  const guest = (index: number) => ({ name: 'Booking Audit', email: emails[index], password: 'AuditPassword123!' });
  const post = async (body: unknown, path = '/api/bookings') => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    await t.test('quote and persisted booking agree on destination timezone and price', async () => {
      const quote = await post(input, '/api/bookings/calculate');
      assert.equal(quote.status, 200);
      assert.equal(quote.body.data.calculation.totalPrice, 1000);
      const created = await post({ ...input, registerUser: guest(0) });
      assert.equal(created.status, 201);
      const saved = await row('SELECT * FROM bookings WHERE "id" = $1', [created.body.data.id]);
      assert.equal(saved.status, 'PENDING');
      assert.equal(saved.timeZone, 'Asia/Tokyo');
      assert.equal(saved.driverName, input.driverName);
      assert.equal(saved.internationalDrivingPermit, input.internationalDrivingPermit);
      assert.equal(saved.pickupLocationId, location.id);
      assert.equal(saved.dropoffLocationId, location.id);
      assert.equal(Number(saved.totalPrice), quote.body.data.calculation.totalPrice);
      assert.equal(saved.startDateTime.toISOString(), input.startDateTime);
    });
    await t.test('conflict rolls back registration and adjacent bookings remain allowed', async () => {
      assert.equal((await post({ ...input, registerUser: guest(1) })).status, 409);
      assert.equal(await count('SELECT count(*) AS count FROM users WHERE "email" = $1', [emails[1]]), 0);
      const adjacent = await post({ ...input, startDateTime: end.toISOString(), endDateTime: new Date(end.getTime() + 3_600_000).toISOString(), registerUser: guest(1) });
      assert.equal(adjacent.status, 201);
    });
    await t.test('simultaneous requests produce only one booking and one new account', async () => {
      const range = { ...input, startDateTime: new Date(start.getTime() + 4 * 86_400_000).toISOString(), endDateTime: new Date(end.getTime() + 4 * 86_400_000).toISOString() };
      const results = await Promise.all([post({ ...range, registerUser: guest(2) }), post({ ...range, registerUser: guest(3) })]);
      assert.deepEqual(results.map((value) => value.status).sort(), [201, 409]);
      assert.equal(await count('SELECT count(*) AS count FROM users WHERE "email" = ANY($1::text[])', [emails.slice(2)]), 1);
    });
    await t.test('invalid pickup, dropoff and past pickup cannot create records', async () => {
      for (const extra of [
        { pickupLocationId: 'missing' }, { dropoffLocationId: 'missing' },
        { startDateTime: '2020-01-01T01:00:00Z', endDateTime: '2020-01-01T03:00:00Z' },
      ]) assert.equal((await post({ ...input, ...extra, registerUser: guest(0) })).status, 400);
    });
  } finally {
    await execute('DELETE FROM bookings WHERE "carId" = $1', [car.id]);
    await execute('DELETE FROM cars WHERE "id" = $1', [car.id]);
    await execute('DELETE FROM users WHERE "email" = ANY($1::text[])', [emails]);
    server.close();
    await once(server, 'close');
    await closeDatabasePool();
  }
});
