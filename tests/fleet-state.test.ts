import test from 'node:test';
import assert from 'node:assert/strict';
import { fleetState, inventoryStatus } from '../src/lib/fleet-state.js';
import { canSchedule } from '../src/lib/fleet.js';

const now = new Date('2030-01-01T10:00:00Z');
const car = { isAvailable: true, operationalStatus: 'AVAILABLE' as const, availableFrom: null, locationId: 'A', bookings: [] };
test('fleet status distinguishes future reservations, preparation, closed cars and overdue returns', () => {
  assert.equal(fleetState(car, now).fleetStatus, 'AVAILABLE');
  assert.equal(fleetState({ ...car, availableFrom: new Date('2030-01-01T11:00:00Z') }, now).fleetStatus, 'CLEANING');
  assert.equal(fleetState({ ...car, isAvailable: false }, now).fleetStatus, 'INACTIVE');
  assert.equal(fleetState({ ...car, locationId: null }, now).fleetStatus, 'UNASSIGNED');
  const booking = { status: 'APPROVED', startDateTime: new Date('2030-01-01T12:00:00Z'), endDateTime: new Date('2030-01-01T14:00:00Z') };
  assert.equal(fleetState({ ...car, bookings: [booking] }, now).fleetStatus, 'RESERVED');
  assert.equal(fleetState({ ...car, bookings: [{ ...booking, startDateTime: new Date('2030-01-01T09:00:00Z') }] }, now).fleetStatus, 'IN_USE');
  const overdue = { ...booking, startDateTime: new Date('2030-01-01T07:00:00Z'), endDateTime: new Date('2030-01-01T09:00:00Z') };
  assert.equal(fleetState({ ...car, bookings: [overdue] }, now).fleetStatus, 'OVERDUE');
  assert.equal(fleetState({ ...car, bookings: [{ ...overdue, status: 'COMPLETED' }] }, now).fleetStatus, 'AVAILABLE');
  assert.equal(fleetState({ ...car, operationalStatus: 'MAINTENANCE', bookings: [overdue] }, now).hasBookings, true);
});
test('legacy availability changes preserve reasons until reopening', () => {
  assert.equal(inventoryStatus(false), 'INACTIVE');
  assert.equal(inventoryStatus(false, undefined, 'MAINTENANCE'), 'MAINTENANCE');
  assert.equal(inventoryStatus(true, undefined, 'CLEANING'), 'AVAILABLE');
  assert.equal(inventoryStatus(false, 'CLEANING'), 'CLEANING');
});
test('an unresolved past rental cannot be allocated again without a return', () => {
  const dates = { pickupLocationId: 'A', dropoffLocationId: 'A', turnaroundMinutes: 0 };
  assert.equal(canSchedule('A', [{ ...dates, startDateTime: new Date('2000-01-01'), endDateTime: new Date('2000-01-02') }],
    { ...dates, startDateTime: new Date('2090-01-01'), endDateTime: new Date('2090-01-02') }), false);
});
