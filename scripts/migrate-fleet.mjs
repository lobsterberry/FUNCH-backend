// Local upgrade with an application-data backup and a field-by-field preservation check.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Use the deployment backup procedure for a remote database');
const db = new PrismaClient();
try {
  const cars = await db.$queryRaw`SELECT to_jsonb(c) AS data FROM cars c ORDER BY id`;
  const bookings = await db.$queryRaw`SELECT to_jsonb(b) AS data FROM bookings b ORDER BY id`;
  mkdirSync('backups', { recursive: true });
  const backup = `backups/fleet-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.json`;
  writeFileSync(backup, JSON.stringify({ createdAt: new Date().toISOString(), cars, bookings }, null, 2), { flag: 'wx' });
  console.log(`Saved ${cars.length} cars and ${bookings.length} bookings to ${backup}`);
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'inherit', env: process.env });
  assert.equal(result.status, 0, 'Migration failed; retain the backup and inspect migration status');
  for (const [table, before] of [['cars', cars], ['bookings', bookings]]) {
    const after = table === 'cars' ? await db.$queryRaw`SELECT to_jsonb(c) AS data FROM cars c ORDER BY id` :
      await db.$queryRaw`SELECT to_jsonb(b) AS data FROM bookings b ORDER BY id`;
    assert.equal(after.length, before.length, `${table} row count changed`);
    for (let i = 0; i < before.length; i++) for (const [key, value] of Object.entries(before[i].data)) {
      if (table === 'cars' && key === 'imageUrl' && !(key in after[i].data)) continue;
      assert.deepEqual(after[i].data[key], value, `${table}/${before[i].data.id}: ${key} changed`);
    }
  }
  console.log('Verified all retained car and booking fields are unchanged.');
  console.log({ models: await db.carModel.count(), offers: await db.carModelLocation.count(),
    assignedCars: await db.car.count({ where: { carModelLocationId: { not: null } } }),
    unassignedCars: await db.car.count({ where: { carModelLocationId: null } }) });
} finally { await db.$disconnect(); }
