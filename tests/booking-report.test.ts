import assert from 'node:assert/strict';
import test from 'node:test';
import { bookingRow, buildReport, comparisonRange, dayBoundary, reportCsv, reportDay, reportQuery, reportSummary, type ReportBooking } from '../src/lib/booking-report.js';

function booking(changes: Partial<ReportBooking> = {}): ReportBooking {
  return { id: 'one', bookingNumber: 'BOOK-1', createdAt: new Date('2026-10-31T17:00:00Z'),
    startDateTime: new Date('2026-11-02T03:00:00Z'), endDateTime: new Date('2026-11-03T03:00:00Z'),
    totalPrice: '0.10', currencyCode: 'THB', status: 'APPROVED', source: 'EXISTING_MEMBER',
    timeZone: 'Asia/Tokyo', carId: 'car-1', carSnapshot: { brand: 'Original', model: 'Model', licensePlate: 'OLD-1' },
    calculatedDays: 1, calculatedHours: 0, pickupLocation: { nameTh: 'โตเกียว', country: { code: 'JP', nameTh: 'ญี่ปุ่น', flag: 'JP' } },
    car: { brand: 'Edited', model: 'Edited', licensePlate: 'NEW-1', country: 'TH', countryInfo: { code: 'TH', nameTh: 'ไทย', flag: 'TH' } }, ...changes };
}

test('reports preserve decimal cents, separate currencies and exclude unconfirmed bookings from confirmed values', () => {
  const report = reportSummary([
    booking(), booking({ status: 'COMPLETED', totalPrice: '0.20' }),
    booking({ status: 'PENDING', totalPrice: '10' }),
    booking({ status: 'CANCELLED', totalPrice: '20' }),
    booking({ status: 'REJECTED', totalPrice: '30' }),
    booking({ currencyCode: 'USD', totalPrice: '99.99' }),
  ]);
  assert.equal(report.total, 6); assert.equal(report.confirmedCount, 3); assert.equal(report.approvalRate, 50);
  assert.deepEqual(report.currencies[0], { currency: 'THB', total: '60.30', approved: '0.10', completed: '0.20', pending: '10.00', excluded: '50.00', confirmed: '0.30', average: '0.15' });
  assert.equal(report.currencies[1].confirmed, '99.99');
  assert.equal(reportSummary([]).approvalRate, 0);
});

test('calendar validation, Bangkok midnight boundaries and comparison ranges handle leap years', () => {
  const schema = reportQuery(new Date('2026-11-16T18:00:00Z'));
  assert.equal(schema.parse({}).end, '2026-11-17');
  assert.equal(schema.parse({}).start, '2026-10-19');
  for (const input of [{ start: '2026-02-30' }, { start: 'bad' }, { start: '2026-11-18', end: '2026-11-17' },
    { start: '2025-01-01', end: '2026-01-02' }, { category: 'unknown' }, { pageSize: '101' }]) assert.equal(schema.safeParse(input).success, false);
  assert.equal(dayBoundary('2026-11-01').toISOString(), '2026-10-31T17:00:00.000Z');
  assert.equal(reportDay(new Date('2026-10-31T16:59:59Z')), '2026-10-31');
  assert.equal(reportDay(new Date('2026-10-31T17:00:00Z')), '2026-11-01');
  assert.deepEqual(comparisonRange({ start: '2026-11-01', end: '2026-11-17', comparison: 'previous' }), { start: '2026-10-15', end: '2026-10-31' });
  assert.deepEqual(comparisonRange({ start: '2024-02-29', end: '2024-03-01', comparison: 'year' }), { start: '2023-02-28', end: '2023-03-01' });
});

test('trends fill empty days, use requested date basis, and rankings and snapshots retain booking identities', () => {
  const input = reportQuery().parse({ start: '2026-11-01', end: '2026-11-03', pageSize: 1, page: 999 });
  const bookings = [booking(), booking({ id: 'two', status: 'PENDING', calculatedDays: 0, source: 'REGISTER_AND_BOOK' })];
  const report = buildReport(bookings, input);
  assert.deepEqual(report.trend.map((item) => item.bookings), [2, 0, 0]);
  assert.equal(report.trend[0].amounts.THB, '0.10'); assert.deepEqual(report.trend[1].amounts, {});
  assert.equal(report.countries[0].code, 'JP'); assert.equal(report.countries[0].count, 2);
  assert.equal(report.topCars[0].count, 1); assert.equal(report.topCars[0].name, 'Original Model');
  assert.equal(report.pagination.page, 2); assert.equal(report.bookings[0].id, 'two');
  assert.deepEqual(report.pricing, { daily: 1, hourlyOnly: 1 });
  assert.deepEqual(report.sources, { EXISTING_MEMBER: 1, REGISTER_AND_BOOK: 1 });
  assert.deepEqual(buildReport(bookings, { ...input, basis: 'startDateTime' }).trend.map((item) => item.bookings), [0, 2, 0]);
  assert.equal(buildReport([], { ...input, end: '2026-12-31' }).interval, 'day');
  assert.equal(buildReport([], { ...input, end: '2027-01-31' }).interval, 'month');
  assert.equal(bookingRow(booking({ carSnapshot: null, pickupLocation: null })).country.code, 'TH');
});

test('CSV includes every filtered booking independent of pagination, quotes text, and blocks spreadsheet formulas', () => {
  const bookings = Array.from({ length: 12 }, (_, index) => booking({ bookingNumber: `BOOK-${index}`, carSnapshot: { brand: '=DANGER', model: 'A,"B"' } }));
  const csv = reportCsv(bookings, reportQuery().parse({ start: '2026-11-01', end: '2026-11-03', pageSize: 1 }));
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"BOOK-11"'));
  assert.ok(csv.includes('"\'=DANGER A,""B"""'));
  assert.ok(csv.includes('Asia/Tokyo'));
  assert.ok(csv.includes('0.10'));
});
