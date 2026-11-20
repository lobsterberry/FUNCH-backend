// Run the full suite in a fresh PostgreSQL schema, including a legacy-data migration rehearsal.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const schema = `cars_test_${randomUUID().replaceAll('-', '')}`;
const folder = resolve(`.cars-test-${schema}`);
const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'This runner only creates test schemas on local PostgreSQL');
url.searchParams.set('schema', schema);
const testUrl = url.toString();
const env = { ...process.env, DATABASE_URL: testUrl, AUTH_TEST_DATABASE_URL: testUrl,
  NODE_ENV: 'test', SEED_USER_PASSWORD: 'CarsTestSeedPassword123!' };
// Windows can have the default engine loaded by a separate running development process.
if (existsSync('node_modules/@prisma/engines/funch-query-engine.dll.node')) {
  env.PRISMA_QUERY_ENGINE_LIBRARY = resolve('node_modules/@prisma/engines/funch-query-engine.dll.node');
}
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });
function run(args) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  assert.equal(result.status, 0, `Command failed: ${args[0]}`);
}
const prisma = (...args) => run(['node_modules/prisma/build/index.js', ...args]);
try {
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  mkdirSync(`${folder}/migrations`, { recursive: true });
  cpSync('prisma/schema.prisma', `${folder}/schema.prisma`);
  cpSync('prisma/migrations/migration_lock.toml', `${folder}/migrations/migration_lock.toml`);
  const migrations = readdirSync('prisma/migrations').filter((name) => /^\d/.test(name)).sort();
  const carLocationsMigration = migrations.indexOf('20261117000000_model_fleet_locations');
  assert.ok(carLocationsMigration > 0);
  for (const migration of migrations.slice(0, carLocationsMigration)) cpSync(`prisma/migrations/${migration}`, `${folder}/migrations/${migration}`, { recursive: true });
  prisma('migrate', 'deploy', '--schema', `${folder}/schema.prisma`);
  await db.$executeRaw`INSERT INTO countries (code,name,"nameTh",flag,"currencyCode","drivingSide") VALUES ('ZZ','Migration fixture','Migration fixture','ZZ','THB','LEFT')`;
  await db.$executeRaw`INSERT INTO locations (id,name,"nameTh",city,"cityTh","countryCode","timeZone") VALUES ('legacy-A','A','A','Test','Test','ZZ','UTC'), ('legacy-B','B','B','Test','Test','ZZ','UTC')`;
  await db.$executeRaw`INSERT INTO users (id,email,password,name,"updatedAt") VALUES ('legacy-user','legacy@migration.example','fixture','Migration',NOW())`;
  for (const [id, location, rate, steering] of [['legacy-1','legacy-A',100,'RHD'],['legacy-2','legacy-A',100,'RHD'],['legacy-3','legacy-B',200,'RHD'],['legacy-4','legacy-B',100,'LHD'],['legacy-unassigned',null,100,'RHD']]) {
    await db.$executeRaw`INSERT INTO cars (id,brand,model,year,"licensePlate",country,"hourlyRate","dailyRate","locationId","steeringSide","updatedAt") VALUES (${id},'Migration','Same name',2026,${id},'ZZ',${rate},1000,${location},${steering}::"SteeringSide",NOW())`;
  }
  const photo = 'https://example.com/legacy-car.jpg';
  await db.$executeRaw`UPDATE cars SET "imageUrl" = ${photo} WHERE "locationId" IS NOT NULL`;
  await db.$executeRaw`INSERT INTO bookings (id,"bookingNumber","userId","carId","startDateTime","endDateTime","totalPrice","hourlyRate","dailyRate","pickupLocationId","dropoffLocationId","updatedAt") VALUES ('legacy-booking','legacy-number','legacy-user','legacy-1','2030-01-01T09:00:00Z','2030-01-01T17:00:00Z',1234.50,100,1000,'legacy-A','legacy-A',NOW())`;
  await db.$executeRaw`UPDATE cars SET "isAvailable" = false WHERE id = 'legacy-unassigned'`;
  const [before] = await db.$queryRaw`SELECT to_jsonb(b) AS data FROM bookings b WHERE id='legacy-booking'`;
  for (const migration of migrations.slice(carLocationsMigration)) cpSync(`prisma/migrations/${migration}`, `${folder}/migrations/${migration}`, { recursive: true });
  prisma('migrate', 'deploy', '--schema', `${folder}/schema.prisma`);
  const saved = await db.booking.findUniqueOrThrow({ where: { id: 'legacy-booking' } });
  assert.equal(saved.carId, 'legacy-1'); assert.equal(saved.totalPrice.toString(), '1234.5');
  const [after] = await db.$queryRaw`SELECT to_jsonb(b) AS data FROM bookings b WHERE id='legacy-booking'`;
  for (const [key, value] of Object.entries(before.data)) assert.deepEqual(after.data[key], value, `Historical booking changed: ${key}`);
  const cars = await db.car.findMany({ where: { country: 'ZZ' }, include: { carModelLocation: { include: { carModel: true } } }, orderBy: { id: 'asc' } });
  assert.equal(cars[0].carModelLocationId, cars[1].carModelLocationId);
  assert.equal(cars[0].carModelLocation.carModelId, cars[2].carModelLocation.carModelId);
  assert.notEqual(cars[0].carModelLocationId, cars[2].carModelLocationId);
  assert.notEqual(cars[0].carModelLocation.carModelId, cars[3].carModelLocation.carModelId);
  assert.equal(cars[4].carModelLocationId, null);
  assert.equal(cars[4].operationalStatus, 'INACTIVE');
  assert.equal(cars[0].operationalStatus, 'AVAILABLE');
  assert.equal(cars[0].exteriorColor, null); assert.equal(cars[0].odometerKm, null); assert.equal(cars[0].vin, null);
  assert.equal(cars[0].carModelLocation.carModel.imageUrl, photo);
  assert.deepEqual(await db.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = 'cars' AND column_name = 'imageUrl'`, []);
  console.log('Legacy migration preserved all booking fields, registrations, rates, variants and unassigned cars.');
  run(['--import', 'tsx', 'prisma/seed.ts']);
  const counts = [await db.carModel.count(), await db.carModelLocation.count(), await db.car.count()];
  const demoCars = await db.car.findMany({ where: { id: { startsWith: 'seed-car-' } },
    select: { id: true, exteriorColor: true, vin: true, odometerKm: true } });
  assert.equal(demoCars.length, 134);
  assert.equal(new Set(demoCars.map(({ vin }) => vin)).size, demoCars.length);
  for (const car of demoCars) {
    assert.ok(car.exteriorColor);
    assert.match(car.vin, /^FUNCH[0-9A-F]{12}$/);
    assert.ok(Number.isInteger(car.odometerKm) && car.odometerKm > 0);
  }
  const baseDemo = demoCars.find(({ id }) => id === 'seed-car-tokyo-harrier');
  const expandedDemo = demoCars.find(({ id }) => id === 'seed-car-tokyo-harrier-fleet-1-1');
  await db.car.update({ where: { id: baseDemo.id }, data: { exteriorColor: 'สีที่แก้ไข', vin: null, odometerKm: 0 } });
  await db.car.update({ where: { id: expandedDemo.id }, data: { exteriorColor: null, vin: 'EDITED-VIN', odometerKm: 12345 } });
  run(['--import', 'tsx', 'prisma/seed.ts']);
  assert.deepEqual([await db.carModel.count(), await db.carModelLocation.count(), await db.car.count()], counts, 'Seed must be idempotent');
  const readDetails = (id) => db.car.findUniqueOrThrow({ where: { id },
    select: { id: true, exteriorColor: true, vin: true, odometerKm: true } });
  assert.deepEqual(await readDetails(baseDemo.id), { ...baseDemo, exteriorColor: 'สีที่แก้ไข', odometerKm: 0 });
  assert.deepEqual(await readDetails(expandedDemo.id), { ...expandedDemo, vin: 'EDITED-VIN', odometerKm: 12345 });
  assert.deepEqual(await readDetails('legacy-1'), { id: 'legacy-1', exteriorColor: null, vin: null, odometerKm: null });
  const sources = await db.car.findMany({ where: { id: { startsWith: 'seed-car-' }, NOT: { id: { contains: '-fleet-' } } }, select: { carModelLocation: true } });
  for (const source of sources) {
    assert.ok(await db.car.count({ where: { carModelLocation: { carModelId: source.carModelLocation.carModelId } } }) >= 3, 'Each seeded model must have several physical cars');
  }
  for (const location of await db.location.findMany({ where: { id: { startsWith: 'seed-location-' } } })) {
    assert.ok(await db.car.count({ where: { locationId: location.id } }) >= 2, 'Each seeded location must hold several cars');
  }
  const edited = await db.car.findFirstOrThrow({ where: { id: { contains: '-fleet-' } } });
  await db.car.update({ where: { id: edited.id }, data: { licensePlate: 'EDITED-DEMO-REGISTRATION', isAvailable: false } });
  const editedBefore = await db.car.findUniqueOrThrow({ where: { id: edited.id } });
  run(['--import', 'tsx', 'scripts/seed-cars.ts']);
  assert.deepEqual(await db.car.findUniqueOrThrow({ where: { id: edited.id } }), editedBefore, 'Additive car seeding must retain edits');
  run(['--import', 'tsx', '--test', ...readdirSync('tests').filter((name) => name.endsWith('.test.ts')).map((name) => `tests/${name}`)]);
} finally {
  // Only the randomly generated schema above can reach this cleanup.
  assert.match(schema, /^cars_test_[a-f0-9]{32}$/);
  await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await db.$disconnect();
  assert.equal(folder, resolve(`.cars-test-${schema}`));
  rmSync(folder, { recursive: true, force: true });
}
