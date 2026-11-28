import 'dotenv/config';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { closeDatabasePool } from '../src/lib/db.js';

test('car search and locations return data from the database', { skip: !process.env.AUTH_TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.AUTH_TEST_DATABASE_URL;
  const { createApp } = await import('../src/app.js');
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const carsRes = await fetch(`${base}/api/cars/search`);
    assert.equal(carsRes.status, 200);
    const carsBody = await carsRes.json();
    assert.equal(carsBody.success, true);
    assert.ok(Array.isArray(carsBody.data));
    assert.ok(carsBody.data.length > 0);

    const firstCar = carsBody.data[0];
    assert.ok(firstCar.id);
    assert.ok(firstCar.name);
    assert.ok(firstCar.day > 0);
    assert.ok(firstCar.hour > 0);
    assert.ok(firstCar.steering === 'right' || firstCar.steering === 'left');

    const jpCarsRes = await fetch(`${base}/api/cars/search?country=JP`);
    assert.equal(jpCarsRes.status, 200);
    const jpCarsBody = await jpCarsRes.json();
    assert.equal(jpCarsBody.success, true);
    assert.ok(jpCarsBody.data.length > 0);
    assert.ok(jpCarsBody.data.every((c: any) => c.country === 'JP'));

    const locRes = await fetch(`${base}/api/locations`);
    assert.equal(locRes.status, 200);
    const locBody = await locRes.json();
    assert.equal(locBody.success, true);
    assert.ok(locBody.data.length >= 10);

    const englishFilter = await fetch(`${base}/api/locations?countryCode=jp&city=tOkYo`);
    const thaiFilter = await fetch(`${base}/api/locations?countryCode=JP&city=${encodeURIComponent('โตเกียว')}`);
    assert.equal(englishFilter.status, 200);
    assert.equal(thaiFilter.status, 200);
    const filtered = await englishFilter.json();
    assert.equal(filtered.count, filtered.data.length);
    assert.equal(filtered.data[0].id, 'seed-location-haneda');
    assert.equal(filtered.data[0].country.code, 'JP');
    assert.deepEqual(await thaiFilter.json(), filtered);

    const station = filtered.data.find((location: { id: string }) => location.id === 'seed-location-tokyo-station');
    assert.ok(station);
    assert.equal(station.airportCode, null);
    assert.equal(station.label, `${station.cityTh} - ${station.nameTh}`);
    const detail = await fetch(`${base}/api/locations/seed-location-tokyo-station`);
    assert.equal(detail.status, 200);
    assert.deepEqual(await detail.json(), { success: true, data: station });
    assert.equal((await fetch(`${base}/api/locations/missing-location`)).status, 404);

    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).database, 'connected');
  } finally {
    server.close();
    await once(server, 'close');
    await closeDatabasePool();
  }
});
