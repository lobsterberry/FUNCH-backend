import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { PrismaClient, type VehicleStatus } from '@prisma/client';
import { bookings, cars, countries, featureLabels, locations, pricingExamples, users } from './seed-data.js';
import { attachLegacyCar, lockFleet } from '../src/lib/fleet.js';
import { expandDemoFleet, fleetExpansionPlan } from './fleet-seed.js';

function validateData() {
  for (const rows of [countries.map((row) => row.code), locations.map((row) => row.id), cars.map((row) => row.id), users.map((row) => row.id), bookings.map((row) => row.bookingNumber)]) {
    assert.equal(new Set(rows).size, rows.length, 'Seed identifiers must be unique');
  }
  assert.equal(cars.filter((row) => row.isFeatured).length, 6, 'Home wireframe has six featured cars');
  assert.equal(cars.filter((row) => row.locationId === 'seed-location-haneda' && row.isAvailable).length, 18, 'Search wireframe has 18 Tokyo/Haneda cars');
  assert.equal(new Set(bookings.map((row) => row.status)).size, 5, 'All booking statuses must be represented');
  for (const location of locations) {
    assert(countries.some((country) => country.code === location.countryCode));
    new Intl.DateTimeFormat('en', { timeZone: location.timeZone }).format(new Date());
  }
  for (const vehicle of cars) {
    const location = locations.find((row) => row.id === vehicle.locationId);
    assert(location && location.countryCode === vehicle.country, 'Car and pickup location countries must match');
    assert(Number(vehicle.hourlyRate) > 0 && Number(vehicle.dailyRate) > 0);
    assert(vehicle.currencyCode === 'THB');
    assert(Array.isArray(vehicle.featureCodes) && vehicle.featureCodes.every((code) => code in featureLabels));
  }
  for (const booking of bookings) {
    const vehicle = cars.find((row) => row.id === booking.carId);
    assert(vehicle && users.some((row) => row.id === booking.userId));
    assert(new Date(booking.endDateTime) > new Date(booking.startDateTime));
    assert.equal(Number(booking.totalPrice), Number(booking.calculatedDays) * Number(booking.dailyRate) + Number(booking.calculatedHours) * Number(booking.hourlyRate));
    const pickup = locations.find((row) => row.id === booking.pickupLocationId);
    const dropoff = locations.find((row) => row.id === booking.dropoffLocationId);
    assert(pickup && dropoff && pickup.countryCode === dropoff.countryCode);
    assert.equal(booking.timeZone, pickup.timeZone);
    const requiresAdmin = ['APPROVED', 'REJECTED', 'COMPLETED'].includes(booking.status!);
    assert.equal(Boolean(booking.approvedById && booking.reviewedAt), requiresAdmin);
  }
  for (const example of pricingExamples) {
    assert.equal(example.total, example.days * 2200 + example.hours * 280);
  }
}

async function main() {
  validateData();
  const summary = { countries: countries.length, locations: locations.length,
    cars: cars.length + fleetExpansionPlan.reduce((total, group) => total + group.units.length, 0),
    users: users.length, bookings: bookings.length };
  if (process.argv.includes('--dry-run')) {
    console.log('Seed data validated (no database writes):', summary);
    console.table(pricingExamples.map(({ key, days, hours, total }) => ({ example: key, days, hours, THB: total })));
    return;
  }

  const seedPassword = process.env.SEED_USER_PASSWORD;
  assert(seedPassword && seedPassword.length >= 12, 'Set SEED_USER_PASSWORD to at least 12 characters before seeding demo users');
  const prisma = new PrismaClient();
  try {
    // Stable IDs + upsert refresh only demo rows. Never delete application data.
    const expansion = await prisma.$transaction(async (tx) => {
      await lockFleet(tx);
      for (const country of countries) {
        await tx.country.upsert({ where: { code: country.code }, create: country, update: country });
      }
      for (const location of locations) {
        await tx.location.upsert({ where: { id: location.id }, create: location, update: location });
      }
      for (const user of users) {
        const salt = randomBytes(16).toString('hex');
        const password = `scrypt$${salt}$${scryptSync(seedPassword, salt, 64).toString('hex')}`;
        const firstBooking = bookings.filter((row) => row.userId === user.id)
          .map((row) => new Date(row.createdAt!).getTime()).sort((a, b) => a - b)[0];
        const createdAt = user.id === 'seed-user-new-member' ? new Date(firstBooking) : new Date('2026-09-01T00:00:00Z');
        // Preserve existing password hashes on reruns.
        await tx.user.upsert({ where: { id: user.id }, create: { ...user, password, createdAt }, update: user });
      }
      for (const vehicle of cars) {
        const values = { ...vehicle, operationalStatus: (vehicle.isAvailable ? 'AVAILABLE' : 'INACTIVE') as VehicleStatus };
        const saved = await tx.car.upsert({ where: { id: vehicle.id }, create: values, update: values });
        await attachLegacyCar(tx, saved);
      }
      for (const booking of bookings) {
        await tx.booking.upsert({ where: { id: booking.id }, create: booking, update: booking });
      }
      return expandDemoFleet(tx);
    }, { timeout: 60000 });
    console.log('Seed complete:', summary, expansion);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
