import 'dotenv/config';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

test('GET /api/countries returns countries and locations from database', async () => {
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

    // Verify Japan is first (or has correct structure)
    const jp = body.data.find((c: any) => c.code === 'JP');
    assert.ok(jp);
    assert.equal(jp.name, 'ญี่ปุ่น');
    assert.equal(jp.steering, 'right');
    assert.ok(jp.cities.includes('โตเกียว'));
    assert.ok(jp.locations.length > 0);

    // Test GET /api/countries/:code
    const singleRes = await fetch(`${base}/api/countries/TH`);
    assert.equal(singleRes.status, 200);
    const singleBody = await singleRes.json();
    assert.equal(singleBody.success, true);
    assert.equal(singleBody.data.code, 'TH');
    assert.equal(singleBody.data.name, 'ไทย');
    assert.ok(singleBody.data.cities.includes('กรุงเทพฯ'));

    // Test 404 for unknown country
    const notFoundRes = await fetch(`${base}/api/countries/XX`);
    assert.equal(notFoundRes.status, 404);
  } finally {
    server.close();
  }
});
