import 'dotenv/config';
import assert from 'node:assert/strict';
import { closeDatabasePool, queryRows, withTransaction } from '../src/lib/db.js';
import { lockCarInventory } from '../src/lib/inventory-queries.js';
import { expandDemoCars, carExpansionPlan } from './seed/car-seed.js';

if (process.argv.includes('--dry-run')) {
  console.log({ additionalCars: carExpansionPlan.reduce((total, group) => total + group.units.length, 0),
    locations: new Set(carExpansionPlan.map((group) => group.locationId)).size,
    models: new Set(carExpansionPlan.map((group) => group.sourceId)).size });
} else {
  try {
    const { expansion, totals } = await withTransaction(async (tx) => {
      await lockCarInventory(tx);
      const readCars = () => queryRows<{ id: string; data: string }>(
        tx, 'SELECT id, to_jsonb(c)::text AS data FROM cars c ORDER BY id',
      );
      const readBookings = () => queryRows<{ id: string; data: string }>(
        tx, 'SELECT id, to_jsonb(b)::text AS data FROM bookings b ORDER BY id',
      );
      const originalCars = await readCars();
      const originalBookings = await readBookings();
      const expansion = await expandDemoCars(tx);
      const afterCars = await readCars();
      const afterBookings = await readBookings();
      const byId = new Map(afterCars.map(({ id, data }) => [id, data]));
      for (const { id, data } of originalCars) {
        assert.ok(byId.get(id) === data, `Existing car was changed: ${id}`);
      }
      assert.ok(
        originalBookings.length === afterBookings.length &&
          originalBookings.every(({ data }, index) => afterBookings[index].data === data),
        'Existing bookings were changed',
      );
      return { expansion, totals: { totalCars: afterCars.length, bookings: afterBookings.length } };
    }, { timeoutMs: 60_000 });
    console.log('Demo car inventory expanded; all original cars and bookings are unchanged.', expansion);
    console.log(totals);
  } finally {
    await closeDatabasePool();
  }
}
