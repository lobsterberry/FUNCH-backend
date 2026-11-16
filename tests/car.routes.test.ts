import 'dotenv/config';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

test('GET /api/cars and /api/locations return data from database', async () => {
  const { createApp } = await import('../src/app.js');
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    // 1. Test GET /api/cars
    const carsRes = await fetch(`${base}/api/cars`);
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

    // 2. Test GET /api/cars?country=JP
    const jpCarsRes = await fetch(`${base}/api/cars?country=JP`);
    assert.equal(jpCarsRes.status, 200);
    const jpCarsBody = await jpCarsRes.json();
    assert.equal(jpCarsBody.success, true);
    assert.ok(jpCarsBody.data.every((c: any) => c.country === 'JP'));

    // 3. Test GET /api/cars/meta
    const metaRes = await fetch(`${base}/api/cars/meta`);
    assert.equal(metaRes.status, 200);
    const metaBody = await metaRes.json();
    assert.equal(metaBody.success, true);
    assert.ok(metaBody.data.categories.length > 0);
    assert.ok(metaBody.data.fuels.length > 0);
    assert.ok(metaBody.data.features.length > 0);

    // 4. Test GET /api/locations
    const locRes = await fetch(`${base}/api/locations`);
    assert.equal(locRes.status, 200);
    const locBody = await locRes.json();
    assert.equal(locBody.success, true);
    assert.ok(locBody.data.length >= 10);
  } finally {
    server.close();
  }
});
