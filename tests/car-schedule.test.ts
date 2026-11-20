import test from 'node:test';
import assert from 'node:assert/strict';
import { canSchedule } from '../src/lib/car-inventory.js';

const time = (hour: number) => new Date(Date.UTC(2030, 0, 1, hour));
const rental = (start: number, end: number, pickup = 'A', dropoff = 'A', turnaroundMinutes = 0) => ({
  startDateTime: time(start), endDateTime: time(end), pickupLocationId: pickup, dropoffLocationId: dropoff, turnaroundMinutes,
});
test('availability requires one physical car to cover the entire rental', () => {
  const request = rental(9, 17);
  assert.equal(canSchedule('A', [rental(8, 12)], request), false);
  assert.equal(canSchedule('A', [rental(13, 18)], request), false);
  assert.equal(canSchedule('A', [rental(7, 9), rental(17, 19)], request), true);
});
test('one-way allocation follows positions and preserves the next pickup', () => {
  const journey = rental(9, 11, 'A', 'B', 60);
  assert.equal(canSchedule('A', [journey], rental(12, 14, 'B', 'B')), true);
  assert.equal(canSchedule('A', [journey], rental(11, 14, 'B', 'B')), false);
  assert.equal(canSchedule('A', [journey], rental(12, 14, 'A', 'A')), false);
  assert.equal(canSchedule('A', [rental(15, 17)], journey), false);
  assert.equal(canSchedule('A', [journey], rental(12, 14, 'B', 'A')), true);
});
test('completed return preparation and missing locations are respected', () => {
  assert.equal(canSchedule('B', [], rental(12, 14, 'B', 'B'), time(13)), false);
  assert.equal(canSchedule('B', [], rental(13, 14, 'B', 'B'), time(13)), true);
  assert.equal(canSchedule(null, [], rental(13, 14)), false);
});
