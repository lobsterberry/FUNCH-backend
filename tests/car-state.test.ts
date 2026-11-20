import test from 'node:test';
import assert from 'node:assert/strict';
import { carState, resolveOperationalStatus } from '../src/lib/car-state.js';
import { canSchedule } from '../src/lib/car-inventory.js';

const now = new Date('2030-01-01T10:00:00Z');
const car = { isAvailable: true, operationalStatus: 'AVAILABLE' as const, availableFrom: null, locationId: 'A', bookings: [] };
test('inventory status distinguishes future reservations, preparation, closed cars and overdue returns', () => {
  assert.equal(carState(car, now).inventoryStatus, 'AVAILABLE');
  assert.equal(carState({ ...car, availableFrom: new Date('2030-01-01T11:00:00Z') }, now).inventoryStatus, 'CLEANING');
  assert.equal(carState({ ...car, isAvailable: false }, now).inventoryStatus, 'INACTIVE');
  assert.equal(carState({ ...car, locationId: null }, now).inventoryStatus, 'UNASSIGNED');
  const booking = { status: 'APPROVED', startDateTime: new Date('2030-01-01T12:00:00Z'), endDateTime: new Date('2030-01-01T14:00:00Z') };
  assert.equal(carState({ ...car, bookings: [booking] }, now).inventoryStatus, 'RESERVED');
  assert.equal(carState({ ...car, bookings: [{ ...booking, startDateTime: new Date('2030-01-01T09:00:00Z') }] }, now).inventoryStatus, 'IN_USE');
  const overdue = { ...booking, startDateTime: new Date('2030-01-01T07:00:00Z'), endDateTime: new Date('2030-01-01T09:00:00Z') };
  assert.equal(carState({ ...car, bookings: [overdue] }, now).inventoryStatus, 'OVERDUE');
  assert.equal(carState({ ...car, bookings: [{ ...overdue, status: 'COMPLETED' }] }, now).inventoryStatus, 'AVAILABLE');
  assert.equal(carState({ ...car, operationalStatus: 'MAINTENANCE', bookings: [overdue] }, now).hasBookings, true);
});
test('legacy availability changes preserve reasons until reopening', () => {
  assert.equal(resolveOperationalStatus(false), 'INACTIVE');
  assert.equal(resolveOperationalStatus(false, undefined, 'MAINTENANCE'), 'MAINTENANCE');
  assert.equal(resolveOperationalStatus(true, undefined, 'CLEANING'), 'AVAILABLE');
  assert.equal(resolveOperationalStatus(false, 'CLEANING'), 'CLEANING');
});
test('an unresolved past rental cannot be allocated again without a return', () => {
  const dates = { pickupLocationId: 'A', dropoffLocationId: 'A', turnaroundMinutes: 0 };
  assert.equal(canSchedule('A', [{ ...dates, startDateTime: new Date('2000-01-01'), endDateTime: new Date('2000-01-02') }],
    { ...dates, startDateTime: new Date('2090-01-01'), endDateTime: new Date('2090-01-02') }), false);
});
