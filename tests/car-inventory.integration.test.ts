import { count, execute, fixtureUser, row, rows } from './fixtures.js';
import { closeDatabasePool } from '../src/lib/db.js';
import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

test('model inventory, allocation and one-way schedules work through HTTP', { skip: !process.env.AUTH_TEST_DATABASE_URL }, async (t) => {
  process.env.DATABASE_URL = process.env.AUTH_TEST_DATABASE_URL;
  process.env.AUTH_SECRET = 'cars-integration-secret-1234567890';
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('../src/app.js');
  const { hashPassword } = await import('../src/utils/password.js');
  const run = randomUUID();
  const password = 'CarsIntegration123!';
  const email = `cars-${run}@funch.example`;
  const guestEmail = `cars-guest-${run}@funch.example`;
  await fixtureUser({ email, name: 'Car administrator', password: await hashPassword(password), role: 'ADMIN' });
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookies = new Map<string, string>();
  async function request(path: string, method = 'GET', body?: unknown, authenticated = true) {
    const response = await fetch(base + path, { method, headers: {
      ...(authenticated ? { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    }, body: body ? JSON.stringify(body) : undefined });
    if (authenticated) for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]; const split = pair.indexOf('='); cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    return { status: response.status, body: await response.json() };
  }
  const csrf = await request('/api/auth/csrf');
  await request('/api/auth/login', 'POST', { email, password, csrfToken: csrf.body.csrfToken });
  const locations = await rows('SELECT * FROM locations WHERE "countryCode" = $1 ORDER BY id LIMIT $2', ['JP', 2]);
  const [a, b] = locations;
  let modelId = '';
  let offerA: any, offerB: any;
  const carIds: string[] = [];
  const start = new Date(Date.now() + 120 * 86_400_000); start.setUTCHours(1, 0, 0, 0);
  const range = (days = 0) => ({ startDateTime: new Date(start.getTime() + days * 86_400_000).toISOString(),
    endDateTime: new Date(start.getTime() + days * 86_400_000 + 2 * 3_600_000).toISOString() });
  const search = async (locationId: string, dates = range(), dropoffLocationId = locationId) => {
    const result = await request(`/api/cars/search?${new URLSearchParams({ locationId, dropoffLocationId, ...dates })}`, 'GET', undefined, false);
    assert.equal(result.status, 200);
    return result.body.data.filter((row: any) => row.carModelId === modelId);
  };
  try {
    const modelInput = { brand: 'Cars Integration', model: run, year: 2026, seats: 5, luggageCapacity: 2,
      transmission: 'Automatic', transmissionType: 'AUTOMATIC', fuelType: 'Hybrid', steeringSide: 'RHD',
      categories: ['SEDAN'], categoryLabel: 'Sedan', featureCodes: ['GPS_EN'], options: [{ code: 'GPS_EN', label: 'GPS', included: true }] };
    await t.test('catalog and mutations require administrators; one model opens in several locations', async () => {
      assert.equal((await request('/api/cars/catalog', 'GET', undefined, false)).status, 401);
      assert.equal((await request('/api/cars/models', 'POST', modelInput, false)).status, 401);
      const created = await request('/api/cars/models', 'POST', modelInput);
      assert.equal(created.status, 201); modelId = created.body.data.id;
      for (const [location, rate] of [[a, 1000], [b, 1500]] as const) {
        const result = await request('/api/cars/offers', 'POST', { carModelId: modelId, locationId: location.id,
          providerName: run, hourlyRate: 100, dailyRate: rate, isActive: true, turnaroundMinutes: 60 });
        assert.equal(result.status, 201);
        if (location.id === a.id) offerA = result.body.data; else offerB = result.body.data;
      }
      for (const [index, offer, active] of [[0, offerA, true], [1, offerA, true], [2, offerA, false], [3, offerB, true]] as const) {
        const createdCar = await request('/api/cars', 'POST', { carModelLocationId: offer.id,
          licensePlate: `${run}-${index}`, year: 2026, isAvailable: active });
        assert.equal(createdCar.status, 201); carIds.push(createdCar.body.data.id);
      }
      const results = await search(a.id);
      assert.equal(results.length, 1); assert.equal(results[0].availableCount, 2);
      assert.equal(results[0].day, 1000); assert.equal(results[0].licensePlate, undefined);
      assert.equal((await search(b.id))[0].availableCount, 1); assert.equal((await search(b.id))[0].day, 1500);
      assert.equal((await request('/api/cars/search?startDateTime=invalid', 'GET', undefined, false)).status, 400);
      assert.equal((await fetch(base + '/api/fleet/search')).status, 404);
    });
    let bookings: any[] = [];
    await t.test('three simultaneous bookings allocate only two distinct cars and roll back guest registration', async () => {
      const body = { carModelLocationId: offerA.id, pickupLocationId: a.id, dropoffLocationId: a.id, ...range() };
      const results = await Promise.all([request('/api/bookings', 'POST', body), request('/api/bookings', 'POST', body), request('/api/bookings', 'POST', body)]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 201, 409]);
      bookings = results.filter((result) => result.status === 201).map((result) => result.body.data);
      assert.equal(new Set(bookings.map((booking) => booking.carId)).size, 2);
      assert.equal((await search(a.id)).length, 0);
      const guest = await request('/api/bookings', 'POST', { ...body, registerUser: { email: guestEmail, name: 'Guest', password } }, false);
      assert.equal(guest.status, 409); assert.equal(await count('SELECT count(*) AS count FROM users WHERE "email" = $1', [guestEmail]), 0);
    });
    await t.test('cancellation releases capacity and restoring a replaced reservation cannot double-book', async () => {
      assert.equal((await request(`/api/bookings/${bookings[0].id}/status`, 'PATCH', { status: 'CANCELLED' })).status, 200);
      assert.equal((await search(a.id))[0].availableCount, 1);
      const replacement = await request('/api/bookings', 'POST', { carModelLocationId: offerA.id, ...range() });
      assert.equal(replacement.status, 201);
      assert.equal((await request(`/api/bookings/${bookings[0].id}/status`, 'PATCH', { status: 'APPROVED' })).status, 409);
      assert.equal((await request(`/api/cars/${bookings[1].carId}`, 'PATCH', { carModelLocationId: offerB.id, licensePlate: 'blocked', year: 2026, isAvailable: true })).status, 409);
      assert.equal((await request(`/api/cars/models/${modelId}`, 'PATCH', { ...modelInput, seats: 7 })).status, 409);
      for (const booking of [bookings[1], replacement.body.data]) assert.equal((await request(`/api/bookings/${booking.id}/status`, 'PATCH', { status: 'CANCELLED' })).status, 200);
    });
    let journey: any, followup: any;
    await t.test('one-way trips project future positions, buffers and dependent pickups', async () => {
      await execute(`UPDATE cars SET "isAvailable" = $2, "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC' WHERE "id" = ANY($1::text[])`, [[carIds[1], carIds[3]], false]);
      const created = await request('/api/bookings', 'POST', { carModelLocationId: offerA.id, dropoffLocationId: b.id, ...range(10) });
      assert.equal(created.status, 201); journey = created.body.data;
      const after = { startDateTime: new Date(Date.parse(journey.endDateTime) + 3_600_000).toISOString(),
        endDateTime: new Date(Date.parse(journey.endDateTime) + 5 * 3_600_000).toISOString() };
      assert.equal((await search(a.id, after)).length, 0); assert.equal((await search(b.id, after))[0].availableCount, 1);
      const tooEarly = { ...after, startDateTime: journey.endDateTime };
      assert.equal((await search(b.id, tooEarly)).length, 0);
      const createdFollowup = await request('/api/bookings', 'POST', { carModelLocationId: offerB.id, ...after });
      assert.equal(createdFollowup.status, 201); followup = createdFollowup.body.data;
      assert.equal(followup.carId, journey.carId);
      assert.equal((await request(`/api/bookings/${journey.id}/status`, 'PATCH', { status: 'CANCELLED' })).status, 409);
      assert.equal((await request(`/api/bookings/${followup.id}/status`, 'PATCH', { status: 'CANCELLED' })).status, 200);
      const foreign = await row('SELECT * FROM locations WHERE "countryCode" = $1 ORDER BY id LIMIT 1', ['US']);
      assert.equal((await request('/api/bookings', 'POST', { carModelLocationId: offerA.id, dropoffLocationId: foreign.id, ...range(20) })).status, 400);
    });
    await t.test('price edits preserve snapshots and completed returns record the actual location', async () => {
      const offerInput = { carModelId: modelId, locationId: a.id, providerName: run, hourlyRate: 300, dailyRate: 3000, isActive: true, turnaroundMinutes: 90 };
      assert.equal((await request(`/api/cars/offers/${offerA.id}`, 'PATCH', offerInput)).status, 200);
      const preserved = await row('SELECT * FROM bookings WHERE "id" = $1', [journey.id]);
      assert.equal(Number(preserved.hourlyRate), 100); assert.equal(preserved.turnaroundMinutes, 60);
      assert.equal((preserved.carSnapshot as any).model, run);
      assert.equal((await request(`/api/bookings/${journey.id}/status`, 'PATCH', { status: 'APPROVED' })).status, 200);
      assert.equal((await request(`/api/bookings/${journey.id}/status`, 'PATCH', { status: 'COMPLETED' })).status, 409);
      await execute(`UPDATE bookings SET "startDateTime" = $2, "endDateTime" = $3, "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC' WHERE "id" = $1`, [journey.id, new Date(Date.now() - 5 * 3_600_000), new Date(Date.now() - 2 * 3_600_000)]);
      assert.equal((await request(`/api/bookings/${journey.id}/status`, 'PATCH', { status: 'COMPLETED' })).status, 200);
      const returned = await row('SELECT * FROM cars WHERE "id" = $1', [journey.carId]);
      assert.equal(returned.locationId, b.id); assert.ok(returned.availableFrom!.getTime() > Date.now());
      assert.equal(await count('SELECT count(*) AS count FROM car_movements WHERE "bookingId" = $1', [journey.id]), 1);
      assert.equal((await request(`/api/bookings/${journey.id}/status`, 'PATCH', { status: 'COMPLETED' })).status, 200);
      assert.equal(await count('SELECT count(*) AS count FROM car_movements WHERE "bookingId" = $1', [journey.id]), 1);
      assert.equal((await request(`/api/cars/${journey.carId}/schedule`)).status, 200);
      assert.equal((await request(`/api/bookings/${journey.id}/status`, 'PATCH', { status: 'APPROVED' })).status, 409);
    });
    await t.test('explicit transfers retain history and stale quotes cannot silently change the total', async () => {
      const moved = await row('SELECT * FROM cars WHERE "id" = $1', [journey.carId]);
      const body = { carModelLocationId: offerA.id, year: 2026, licensePlate: moved.licensePlate, isAvailable: true };
      // Saving maintenance flags preserves the real return location.
      assert.equal((await request(`/api/cars/${moved.id}`, 'PATCH', body)).status, 200);
      assert.equal((await row('SELECT * FROM cars WHERE "id" = $1', [moved.id])).locationId, b.id);
      assert.equal((await request(`/api/cars/${moved.id}`, 'PATCH', { ...body, transfer: true })).status, 200);
      assert.equal((await row('SELECT * FROM cars WHERE "id" = $1', [moved.id])).locationId, a.id);
      assert.equal(await count('SELECT count(*) AS count FROM car_movements WHERE "carId" = $1', [moved.id]), 2);
      const stale = await request('/api/bookings', 'POST', { carModelLocationId: offerA.id, ...range(30), quotedTotal: 1 });
      assert.equal(stale.status, 409); assert.equal(stale.body.message, 'PRICE_CHANGED');
      assert.equal((await request('/api/cars', 'POST', { ...body, licensePlate: `wrong-year-${run}`, year: 2025 })).status, 400);
      assert.equal((await request('/api/cars', 'POST', body)).status, 409);
      const closed = await request(`/api/cars/offers/${offerB.id}`, 'PATCH', { carModelId: modelId, locationId: b.id,
        providerName: run, hourlyRate: 100, dailyRate: 1500, isActive: false, turnaroundMinutes: 60 });
      assert.equal(closed.status, 200);
      assert.equal((await search(a.id, range(30), b.id)).length, 0);
      assert.equal((await request('/api/bookings', 'POST', { carModelLocationId: offerA.id, ...range(30), dropoffLocationId: b.id })).status, 400);
    });
    await t.test('one model and branch accept many registrations atomically and expose correct stock totals', async () => {
      const before = await request('/api/cars/catalog');
      const baseline = before.body.data.locationInventory.find((row: any) => row.locationId === a.id).totalCars;
      const body = { carModelLocationId: offerA.id, year: 2026, isAvailable: true,
        licensePlates: [1, 2, 3].map((unit) => `bulk-${run}-${unit}`) };
      assert.equal((await request('/api/cars/bulk', 'POST', body, false)).status, 401);
      const batch = await request('/api/cars/bulk', 'POST', body);
      assert.equal(batch.status, 201); assert.equal(batch.body.count, 3);
      assert.deepEqual(batch.body.data.map((row: any) => row.licensePlate), body.licensePlates);
      for (const car of batch.body.data) { assert.equal(car.locationId, a.id); assert.equal(car.carModelId, modelId); carIds.push(car.id); }
      const catalog = (await request('/api/cars/catalog')).body.data;
      assert.equal(catalog.models.find((row: any) => row.id === modelId).totalCars, carIds.length);
      assert.equal(catalog.models.find((row: any) => row.id === modelId).locationCount, 2);
      assert.equal(catalog.locationInventory.find((row: any) => row.locationId === a.id).totalCars, baseline + 3);
      assert.equal(catalog.offers.find((row: any) => row.id === offerA.id).inventoryCount, 6);
      const countBefore = await count('SELECT count(*) AS count FROM cars WHERE "carModelLocationId" IN (SELECT id FROM car_model_locations WHERE "carModelId" = $1)', [modelId]);
      assert.equal((await request('/api/cars/bulk', 'POST', { ...body, licensePlates: [`new-${run}`, body.licensePlates[0]] })).status, 409);
      assert.equal(await count('SELECT count(*) AS count FROM cars WHERE "licensePlate" = $1', [`new-${run}`]), 0);
      assert.equal((await request('/api/cars/bulk', 'POST', { ...body, licensePlates: [' repeat ', 'repeat'] })).status, 400);
      assert.equal((await request('/api/cars/bulk', 'POST', { ...body, licensePlates: [] })).status, 400);
      assert.equal((await request('/api/cars/bulk', 'POST', { ...body, licensePlates: Array.from({ length: 101 }, (_, i) => `too-many-${i}`) })).status, 400);
      assert.equal((await request('/api/cars/bulk', 'POST', { ...body, year: 2025 })).status, 400);
      assert.equal(await count('SELECT count(*) AS count FROM cars WHERE "carModelLocationId" IN (SELECT id FROM car_model_locations WHERE "carModelId" = $1)', [modelId]), countBefore);
      assert.equal((await search(a.id, range(40)))[0].availableCount, 4);
      const reservations = await Promise.all(Array.from({ length: 5 }, () => request('/api/bookings', 'POST', { carModelLocationId: offerA.id, ...range(40) })));
      assert.deepEqual(reservations.map((result) => result.status).sort(), [201, 201, 201, 201, 409]);
      assert.equal(new Set(reservations.filter((result) => result.status === 201).map((result) => result.body.data.carId)).size, 4);
    });
    await t.test('V2 metadata, preparation status, transfer rules and catalog state persist through HTTP', async () => {
      const body = { carModelLocationId: offerA.id, year: 2026, licensePlate: `v2-${run}`, isAvailable: true,
        operationalStatus: 'AVAILABLE', exteriorColor: 'Pearl White', odometerKm: 12500, vin: `CHASSIS-${run}` };
      const created = await request('/api/cars', 'POST', body);
      assert.equal(created.status, 201);
      const id = created.body.data.id; carIds.push(id);
      assert.equal(created.body.data.exteriorColor, 'Pearl White');
      assert.equal(created.body.data.odometerKm, 12500); assert.equal(created.body.data.vin, body.vin);
      await execute(`UPDATE cars SET "locationId" = $2, "availableFrom" = $3, "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC' WHERE "id" = $1`, [id, b.id, new Date(Date.now() + 3600000)]);
      const returnedUnit = (await request('/api/cars/catalog')).body.data.units.find((unit: any) => unit.id === id);
      assert.equal(returnedUnit.homeLocationId, a.id); assert.equal(returnedUnit.locationId, b.id);
      assert.equal(returnedUnit.day, 1500); assert.equal(returnedUnit.inventoryStatus, 'CLEANING');
      await execute(`UPDATE cars SET "locationId" = $2, "availableFrom" = $3, "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC' WHERE "id" = $1`, [id, a.id, null]);
      assert.equal((await request(`/api/cars/${id}`, 'PATCH', { ...body, odometerKm: -1 })).status, 400);
      assert.equal((await request(`/api/cars/${id}`, 'PATCH', { ...body, operationalStatus: 'MAINTENANCE' })).status, 400);
      assert.equal((await request('/api/cars/bulk', 'POST', { carModelLocationId: offerA.id, year: 2026,
        licensePlates: [`vin-bulk-${run}`], isAvailable: true, vin: 'shared-vin' })).status, 400);
      const before = (await search(a.id, range(65)))[0].availableCount;
      assert.equal((await request(`/api/cars/${id}`, 'PATCH', { ...body, isAvailable: false, operationalStatus: 'CLEANING' })).status, 200);
      assert.equal((await search(a.id, range(65)))[0].availableCount, before - 1);
      assert.equal((await request('/api/bookings', 'POST', { carId: id, ...range(65) })).status, 409);
      const catalog = (await request('/api/cars/catalog')).body.data;
      assert.equal(catalog.units.find((unit: any) => unit.id === id).inventoryStatus, 'CLEANING');
      assert.equal(catalog.summary.total, catalog.units.length);
      assert.equal(catalog.summary.available, catalog.units.filter((unit: any) => unit.inventoryStatus === 'AVAILABLE').length);
      assert.equal((await request(`/api/cars/${id}`, 'PATCH', body)).status, 200);
      // The destination is closed from the preceding test.
      assert.equal((await request(`/api/cars/${id}`, 'PATCH', { ...body, carModelLocationId: offerB.id, transfer: true })).status, 409);
      assert.equal((await request(`/api/cars/offers/${offerB.id}`, 'PATCH', { carModelId: modelId, locationId: b.id,
        providerName: run, hourlyRate: 100, dailyRate: 1500, isActive: true, turnaroundMinutes: 60 })).status, 200);
      const otherProvider = await request('/api/cars/offers', 'POST', { carModelId: modelId, locationId: b.id,
        providerName: `${run}-other`, hourlyRate: 100, dailyRate: 1500, isActive: true, turnaroundMinutes: 60 });
      assert.equal((await request(`/api/cars/${id}`, 'PATCH', { ...body, carModelLocationId: otherProvider.body.data.id, transfer: true })).status, 409);
      const foreign = await row('SELECT * FROM locations WHERE "countryCode" = $1 ORDER BY id LIMIT 1', ['US']);
      const foreignOffer = await request('/api/cars/offers', 'POST', { carModelId: modelId, locationId: foreign.id,
        providerName: run, hourlyRate: 100, dailyRate: 1500, isActive: true, turnaroundMinutes: 60 });
      assert.equal((await request(`/api/cars/${id}`, 'PATCH', { ...body, carModelLocationId: foreignOffer.body.data.id, transfer: true })).status, 409);
      const moved = await request(`/api/cars/${id}`, 'PATCH', { ...body, carModelLocationId: offerB.id, transfer: true, transferNote: 'Balance branch stock' });
      assert.equal(moved.status, 200); assert.equal(moved.body.data.locationId, b.id);
      const history = (await request(`/api/cars/${id}/schedule`)).body.data;
      assert.equal(history.movements[0].note, 'Balance branch stock');
      const booking = await request('/api/bookings', 'POST', { carId: id, ...range(65) });
      assert.equal(booking.status, 201);
      const nextBooking = await request('/api/bookings', 'POST', { carId: id, ...range(70) });
      assert.equal(nextBooking.status, 201);
      assert.equal((await request(`/api/bookings/${nextBooking.body.data.id}/status`, 'PATCH', { status: 'CANCELLED' })).status, 200);
      const current = { ...body, carModelLocationId: offerB.id };
      assert.equal((await request(`/api/cars/${id}`, 'PATCH', { ...current, isAvailable: false, operationalStatus: 'MAINTENANCE' })).status, 409);
      await execute(`UPDATE bookings SET "startDateTime" = $2, "endDateTime" = $3, "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC' WHERE "id" = $1`, [booking.body.data.id, new Date(Date.now() - 7200000), new Date(Date.now() - 3600000)]);
      const overdue = (await request('/api/cars/catalog')).body.data.units.find((unit: any) => unit.id === id);
      assert.equal(overdue.inventoryStatus, 'OVERDUE'); assert.equal(overdue.hasBookings, true);
      assert.equal((await request('/api/bookings', 'POST', { carId: id, ...range(70) })).status, 409);
      assert.equal((await request(`/api/bookings/${nextBooking.body.data.id}/status`, 'PATCH', { status: 'PENDING' })).status, 409);
      await execute(`UPDATE bookings SET "status" = $2, "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC' WHERE "id" = $1`, [booking.body.data.id, 'CANCELLED']);
    });
  } finally {
    await execute('DELETE FROM car_movements WHERE "carId" = ANY($1::text[])', [carIds]);
    await execute('DELETE FROM bookings WHERE "carId" = ANY($1::text[])', [carIds]);
    await execute('DELETE FROM cars WHERE "id" = ANY($1::text[])', [carIds]);
    await execute('DELETE FROM car_model_locations WHERE "carModelId" = $1', [modelId]);
    if (modelId) await execute('DELETE FROM car_models WHERE "id" = $1', [modelId]);
    await execute('DELETE FROM users WHERE "email" = ANY($1::text[])', [[email, guestEmail]]);
    server.close(); await once(server, 'close'); await closeDatabasePool();
  }
});
