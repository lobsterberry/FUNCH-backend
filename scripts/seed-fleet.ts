import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { expandDemoFleet, fleetExpansionPlan } from '../prisma/fleet-seed.js';

if (process.argv.includes('--dry-run')) {
  console.log({ additionalCars: fleetExpansionPlan.reduce((total, group) => total + group.units.length, 0),
    locations: new Set(fleetExpansionPlan.map((group) => group.locationId)).size,
    models: new Set(fleetExpansionPlan.map((group) => group.sourceId)).size });
} else {
  const db = new PrismaClient();
  try {
    const originalCars = await db.$queryRaw<{ data: Record<string, unknown> }[]>`SELECT to_jsonb(c) AS data FROM cars c ORDER BY id`;
    const originalBookings = await db.$queryRaw<{ data: Record<string, unknown> }[]>`SELECT to_jsonb(b) AS data FROM bookings b ORDER BY id`;
    const result = await db.$transaction(expandDemoFleet, { timeout: 60_000 });
    const afterCars = await db.$queryRaw<{ data: Record<string, unknown> }[]>`SELECT to_jsonb(c) AS data FROM cars c ORDER BY id`;
    const afterBookings = await db.$queryRaw<{ data: Record<string, unknown> }[]>`SELECT to_jsonb(b) AS data FROM bookings b ORDER BY id`;
    const byId = new Map(afterCars.map(({ data }) => [data.id, data]));
    for (const { data } of originalCars) assert.deepEqual(byId.get(data.id), data, `Existing car was changed: ${data.id}`);
    assert.deepEqual(afterBookings, originalBookings, 'Existing bookings were changed');
    console.log('Demo fleet expanded; all original cars and bookings are unchanged.', result);
    console.log({ totalCars: afterCars.length, bookings: afterBookings.length });
  } finally { await db.$disconnect(); }
}
