import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCarRentalPrice } from '../src/utils/pricing.js';

test('late return uses destination timezone instead of the server clock', () => {
  const input = { startDateTime: '2026-12-01T01:00:00Z', endDateTime: '2026-12-01T06:00:00Z', hourlyRate: 100, dailyRate: 1000 };
  assert.equal(calculateCarRentalPrice({ ...input, timeZone: 'Asia/Tokyo' }).totalPrice, 1000);
  assert.equal(calculateCarRentalPrice({ ...input, timeZone: 'UTC' }).totalPrice, 500);
});

test('14:00 boundary and exact days preserve hourly and daily rules', () => {
  const input = { startDateTime: '2026-12-01T01:00:00Z', hourlyRate: 100, dailyRate: 1000, timeZone: 'Asia/Tokyo' };
  assert.equal(calculateCarRentalPrice({ ...input, endDateTime: '2026-12-01T05:00:00Z' }).totalPrice, 400);
  assert.equal(calculateCarRentalPrice({ ...input, endDateTime: '2026-12-01T05:01:00Z' }).totalPrice, 1000);
  assert.equal(calculateCarRentalPrice({ ...input, endDateTime: '2026-12-02T01:00:00Z' }).totalPrice, 1000);
  assert.throws(() => calculateCarRentalPrice({ ...input, endDateTime: 'invalid' }));
});
