import 'dotenv/config';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { closeDatabasePool } from '../src/lib/db.js';

test('GET /api/countries returns countries and locations from database', { skip: !process.env.AUTH_TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.AUTH_TEST_DATABASE_URL;
  const { createApp } = await import('../src/app.js');
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const res = await fetch(`${base}/api/countries`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length >= 6);

    assert.equal(body.count, body.data.length);
    const [jp] = body.data;
    assert.equal(jp.code, 'JP');
    assert.equal(jp.name, 'ญี่ปุ่น');
    assert.equal(jp.steering, 'right');
    assert.ok(jp.cities.includes('โตเกียว'));
    assert.equal(jp.locations[0].airportCode, 'HND');

    // Test GET /api/countries/:code
    const singleRes = await fetch(`${base}/api/countries/th`);
    assert.equal(singleRes.status, 200);
    const singleBody = await singleRes.json();
    assert.equal(singleBody.success, true);
    assert.equal(singleBody.data.code, 'TH');
    assert.equal(singleBody.data.name, 'ไทย');
    assert.ok(singleBody.data.cities.includes('กรุงเทพฯ'));

    // Test 404 for unknown country
    const notFoundRes = await fetch(`${base}/api/countries/XX`);
    assert.equal(notFoundRes.status, 404);
    const longCodeRes = await fetch(`${base}/api/countries/THX`);
    assert.equal(longCodeRes.status, 404);
  } finally {
    server.close();
    await once(server, 'close');
    await closeDatabasePool();
  }
});
