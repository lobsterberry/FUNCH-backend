# FUNCH Backend

REST API สำหรับระบบเช่ารถ FUNCH ใช้ Express, TypeScript, PostgreSQL ผ่าน `pg` และ Auth.js รองรับการค้นหารถตามสาขา คำนวณราคา จองรถ ดูประวัติการจอง และจัดการรถ การจอง สมาชิก และรายงานสำหรับผู้ดูแลระบบ

รันคำสั่งในคู่มือนี้จากโฟลเดอร์ `backend` ส่วน Next.js frontend อยู่ในโฟลเดอร์ `frontend` ข้างกันใน workspace นี้ และตั้งค่าแยกตาม [คู่มือ frontend](../frontend/README.md)

## ตั้งค่า `.env`

คัดลอก [`.env.example`](.env.example) เป็น `.env` แล้วกำหนดค่าตามวิธีที่รัน backend

| ตัวแปร | การตั้งค่า |
| --- | --- |
| `AUTH_SECRET` | ค่าสุ่มอย่างน้อย 32 ตัวอักษร สร้างได้ด้วย `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` |
| `AUTH_URL` | URL ภายนอกของ backend ค่าเริ่มต้น `http://localhost:5000` ตั้งให้ตรงกับพอร์ตที่เปิด และใช้ `https://` เมื่อให้บริการผ่าน HTTPS เพื่อเปิดใช้ Secure cookie |
| `FRONTEND_URL` | Origin ของ frontend ที่อนุญาตให้เรียก API ค่าเริ่มต้น `http://localhost:3000` |
| `DATABASE_URL` | ใช้เมื่อรัน backend, migration หรือ seed บนเครื่อง เช่น `postgresql://postgres:ENCODED_PASSWORD@localhost:5432/funch_db?schema=public` หากใช้ Compose ให้ใช้พอร์ตที่ตั้งใน `POSTGRES_PORT` |
| `DOCKER_DATABASE_URL` | ใช้เมื่อรัน backend ใน Compose เช่น `postgresql://postgres:ENCODED_PASSWORD@postgres:5432/funch_db?schema=public` หากเว้นไว้ Compose จะใช้ `DATABASE_URL` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | บัญชีและฐานข้อมูล PostgreSQL ของ Compose ค่าเริ่มต้นของผู้ใช้และฐานข้อมูลคือ `postgres` และ `funch_db` ให้ตั้งรหัสผ่านและใช้ค่าเดียวกันใน URL โดย URL-encode อักขระพิเศษในรหัสผ่าน |
| `PGADMIN_DEFAULT_EMAIL`, `PGADMIN_DEFAULT_PASSWORD` | บัญชี pgAdmin ที่ Compose ใช้ ควรกำหนดทั้งสองค่าแม้จะเปิดเฉพาะบริการ `postgres` เพราะ Compose อ่านค่าจากไฟล์เดียวกัน |
| `SEED_USER_PASSWORD` | รหัสผ่านสำหรับบัญชีสมาชิกตัวอย่างที่สร้างใหม่ ตั้งอย่างน้อย 12 ตัวอักษร หากเว้นว่าง seed จะสุ่มรหัสผ่านให้ |

## รันด้วย Docker Compose

| บริการ | ค่าเริ่มต้นบนเครื่อง |
| --- | --- |
| `backend` (Node.js 20) | `http://localhost:5000` ปรับพอร์ตด้วย `PORT` |
| `postgres` (PostgreSQL 16) | `localhost:5432` ปรับพอร์ตด้วย `POSTGRES_PORT` |
| `pgadmin` (pgAdmin 4) | `http://localhost:5050` ปรับพอร์ตด้วย `PGADMIN_PORT` |

สำหรับฐานข้อมูลพัฒนาใหม่ ให้เปิด PostgreSQL และ pgAdmin ใช้ [initial migration](db/migrations/20261124000000_initial_rental_schema.sql) เพื่อสร้างตาราง แล้วรัน API แบบ hot reload

```bash
docker compose up -d --wait postgres pgadmin
docker compose run --rm --build --no-deps backend npm run db:migrate
docker compose up -d --build backend
```

`db:migrate` ใช้ `pg` รันไฟล์ SQL และบันทึกประวัติพร้อม checksum ใน `schema_migrations` ฐานข้อมูลที่ใช้ migration ชุดเดิมครบและมี schema ตรงกับรุ่นแรกจะรับประวัติ initial ได้โดยเก็บข้อมูลเดิมไว้ หากยังรัน migration ชุดเดิมไม่ครบ ให้ทำตาม [คู่มืออัปเกรดข้อมูลรถ](docs/cars.md)

เปิด `http://localhost:5000/health` เพื่อตรวจการเชื่อมต่อ PostgreSQL ซึ่งตอบ HTTP 200 เมื่อเชื่อมต่อได้ หรือ 503 เมื่อเชื่อมต่อไม่ได้ ใช้ `docker compose ps` ตรวจบริการที่เปิดด้วย Compose

ดู log ด้วย `docker compose logs -f backend` และหยุดบริการด้วย `docker compose down`

pgAdmin ใช้บัญชีจาก `PGADMIN_DEFAULT_EMAIL` และ `PGADMIN_DEFAULT_PASSWORD` รายการเซิร์ฟเวอร์ `FUNCH PostgreSQL` ใน [`servers.json`](servers.json) ใช้ `postgres:5432` พร้อมชื่อผู้ใช้และฐานข้อมูลค่าเริ่มต้น กรอก `POSTGRES_PASSWORD` ตอนเชื่อมต่อ และปรับการตั้งค่าเซิร์ฟเวอร์หากเปลี่ยนชื่อผู้ใช้หรือชื่อฐานข้อมูล

## รัน backend บนเครื่อง

ตั้ง `DATABASE_URL` ให้ชี้ไปที่ PostgreSQL ที่เข้าถึงได้จากเครื่อง หากจะใช้ PostgreSQL จาก Compose ให้รัน `docker compose up -d --wait postgres` ก่อน

```bash
npm ci
npm run db:migrate
npm run dev
```

ตั้ง `DATABASE_URL` ให้ชี้ไปยัง PostgreSQL database และ schema ที่เตรียมไว้ `db:migrate` ใช้กับฐานข้อมูลใหม่และฐานที่ต้องอัปเกรด เมื่อ schema พร้อมแล้วให้เริ่มด้วย `npm run dev` หรือใช้ `npm run build` ตามด้วย `npm start`

Frontend เรียก backend ผ่าน Next.js API routes ตั้ง `BACKEND_URL` ฝั่ง frontend เป็น URL ที่ Next.js server เข้าถึงได้ เช่น `http://localhost:5000` เมื่อรันบนเครื่อง หรือ `http://host.docker.internal:5000` เมื่อรัน frontend ใน Docker Desktop

## ข้อมูลตัวอย่าง

คำสั่ง seed ใช้ `pg` และอ่าน `DATABASE_URL` หลังเตรียมตารางแล้ว ให้รันคำสั่งตามสภาพแวดล้อมที่ใช้

| สภาพแวดล้อม | คำสั่ง |
| --- | --- |
| Docker Compose | `docker compose run --rm --no-deps backend npm run seed` |
| Node.js บนเครื่อง | `npm run seed` |

seed สร้างบัญชี `admin@funch.example` ด้วย Role `ADMIN` และรหัสผ่านเริ่มต้น `FunchDemo2026!` สำหรับฐานข้อมูลพัฒนา ตั้ง `SEED_USER_PASSWORD` ก่อนสร้างบัญชีสมาชิกตัวอย่างครั้งแรกหากต้องการล็อกอินด้วยบัญชีอย่าง `somchai@funch.example` การรัน seed ซ้ำจะเก็บรหัสผ่านเดิมของบัญชีที่มีอยู่แล้ว ดูรายการข้อมูลตัวอย่างและคำสั่ง seed เฉพาะรถใน [คู่มือ seed](docs/seed.md)

## API

| Method และ Endpoint | สิทธิ์ | การทำงาน |
| --- | --- | --- |
| `GET /health` | สาธารณะ | ตรวจการเชื่อมต่อ PostgreSQL |
| `GET /api/countries`, `GET /api/countries/:code` | สาธารณะ | รายการและรายละเอียดประเทศ |
| `GET /api/locations`, `GET /api/locations/:id` | สาธารณะ | รายการและรายละเอียดสาขา กรองรายการได้ด้วย `countryCode` และ `city` |
| `GET /api/cars`, `GET /api/cars/:id`, `GET /api/cars/meta` | สาธารณะ | รายการรถ รายละเอียดรถ และข้อมูลตัวกรอง |
| `GET /api/cars/search` | สาธารณะ | ค้นหาข้อเสนอของรุ่นรถตามสาขา พร้อมจำนวนรถว่างเมื่อส่งช่วงเวลา |
| `POST /api/bookings/calculate` | สาธารณะ | คำนวณราคาตามข้อเสนอและช่วงเช่า |
| `POST /api/bookings` | ผู้เข้าสู่ระบบหรือสมัครพร้อมจอง | ตรวจความว่างและสร้างการจองสถานะ `PENDING` |
| `GET /api/bookings/mine` | ผู้เข้าสู่ระบบ | ประวัติการจองของบัญชีใน session |
| `GET /api/bookings`, `PATCH /api/bookings/:id/status` | `ADMIN` | ดูและพิจารณารายการจอง |
| `GET /api/cars/admin`, `GET /api/cars/catalog`, `GET /api/cars/:id/schedule` | `ADMIN` | ดูรถ รุ่น ข้อเสนอ ตารางจอง และประวัติการย้ายรถ |
| `POST /api/cars`, `PATCH /api/cars/:id`, `POST /api/cars/bulk` | `ADMIN` | เพิ่มหรือแก้ไขรถรายคัน และเพิ่มหลายคันพร้อมกัน |
| `POST /api/cars/models`, `PATCH /api/cars/models/:id`, `POST /api/cars/offers`, `PATCH /api/cars/offers/:id` | `ADMIN` | จัดการรุ่นและข้อเสนอรายสาขา |
| `GET /api/admin/members`, `POST /api/admin/members`, `GET /api/admin/members/:id`, `PATCH /api/admin/members/:id` | `ADMIN` | จัดการสมาชิกและดูประวัติการจอง |
| `GET /api/admin/reports` | `ADMIN` | สรุปยอดจองและส่งออก CSV |

ดูขั้นตอนเข้าสู่ระบบ สมัครสมาชิก เปลี่ยนรหัสผ่าน และส่ง session cookie ใน [คู่มือ Auth API](AUTH.md) และดูพารามิเตอร์สำหรับงานรถรายคัน รุ่น และข้อเสนอรายสาขาใน [Cars API](docs/cars.md#api)

### การจองและการคำนวณราคา

- การคำนวณราคาและการสร้างรายการจองรับ `carModelLocationId` หรือ `carId` อย่างใดอย่างหนึ่ง พร้อม `startDateTime` และ `endDateTime` แบบ ISO 8601 ที่มี offset เช่น `+09:00` หรือ `Z` ระบบใช้เขตเวลาของสาขารับรถในการคิดราคา
- ระบบปัดเศษระยะเวลาเช่าขึ้นเป็นชั่วโมง คิดรอบละ 24 ชั่วโมงจากเวลารับรถ และคิดเป็นหนึ่งวันเมื่อช่วงที่เหลือเกิน 8 ชั่วโมงหรือคืนหลัง 14:00 น. ตามเวลาท้องถิ่น ค่าเช่าส่วนรายชั่วโมงมีเพดานเท่าราคารายวัน ดู [โค้ดคำนวณราคา](src/utils/pricing.ts)
- เมื่อจองผ่านข้อเสนอ ระบบจัดสรรรถจริงใน transaction โดยพิจารณาตำแหน่งรถ รายการ `PENDING` และ `APPROVED` และเวลาเตรียมรถหลังคืน การคืนต่างสาขาต้องมีข้อเสนอที่เปิดบริการสำหรับรุ่นและผู้ให้บริการเดียวกันในประเทศเดียวกัน
- หากส่ง `quotedTotal` แล้วราคาปัจจุบันต่างจากยอดที่ลูกค้าเห็น API ส่ง HTTP 409 `PRICE_CHANGED` ผู้ที่สมัครพร้อมจองส่ง `registerUser` เพื่อสร้างบัญชีและการจองใน transaction เดียว
- `GET /api/bookings/mine` ใช้ ID ผู้ใช้จาก session และคืน `{ success: true, data: [...] }` เรียงจากรายการที่สร้างล่าสุด พร้อมเลขจอง สถานะ วันรับ–คืน ยอดและสกุลเงิน ข้อมูลรถที่บันทึกตอนจอง และข้อมูลสาขา เมื่อไม่มีรายการ `data` เป็นอาร์เรย์ว่าง ผลลัพธ์ใช้ `Cache-Control: no-store` และคำขอที่ไม่มี session ที่ใช้ได้จะได้รับ HTTP 401 หน้า `/bookings` ของ frontend ใช้ endpoint นี้
- `GET /api/bookings` สำหรับแอดมินรองรับ `search`, `status`, `country`, `sort` (`newest`, `pickup`, `value`) และการแบ่งหน้าด้วย `page`, `pageSize` (สูงสุด 100 ต่อหน้า) ผลลัพธ์มีจำนวนรายการตามตัวกรองและสรุปจำนวนรวมตามสถานะ
- `PATCH /api/bookings/:id/status` รับ `status`, `adminNote` และ `expectedUpdatedAt` โดยสองฟิลด์หลังเป็นทางเลือก ส่ง `updatedAt` จากรายการเดิมมาใน `expectedUpdatedAt` เพื่อตรวจว่ารายการถูกแก้ไขระหว่างพิจารณาหรือไม่ หากเปลี่ยนแล้ว API ส่ง HTTP 409 `BOOKING_CHANGED`

### จัดการสมาชิก

- `GET /api/admin/members` รับ `search`, `role` (`all`, `USER`, `ADMIN`), `status` (`all`, `active`, `suspended`), `page` และ `pageSize` (สูงสุด 100 ต่อหน้า)
- `POST /api/admin/members` รับ `name`, `email`, `phoneNumber` (รับ `null`), `role`, `isActive` และ `password` (8–128 ตัวอักษร) ส่วน `PATCH /api/admin/members/:id` รับเฉพาะฟิลด์ข้อมูลติดต่อ สิทธิ์ หรือสถานะที่ต้องการแก้ไข
- `GET /api/admin/members/:id` คืนข้อมูลสมาชิกและประวัติการจอง แบ่งหน้าด้วย `page` และ `pageSize` ยอดรวมคิดจากรายการ `APPROVED` และ `COMPLETED`
- การเปลี่ยน role หรือระงับบัญชีจะเพิกถอน session เดิมทุกอุปกรณ์และเก็บรายการจองเดิมไว้ แอดมินที่แก้ไขบัญชีของตนเองต้องคงสิทธิ์ `ADMIN` และสถานะเปิดใช้งาน

### รายงานสรุปยอดจอง

| Query | ค่า |
| --- | --- |
| `start`, `end` | `YYYY-MM-DD` ช่วง 1–366 วัน รวมวันสิ้นสุดตาม `Asia/Bangkok` ค่าเริ่มต้นคือ 30 วันล่าสุด |
| `basis` | `createdAt` (ค่าเริ่มต้น) หรือ `startDateTime` |
| `comparison` | `previous` (ค่าเริ่มต้น ใช้ช่วงก่อนหน้าที่ยาวเท่ากัน), `year` (ช่วงเดียวกันในปีก่อน โดยปรับ 29 ก.พ. เป็น 28 ก.พ.) หรือ `none` |
| `country` | `all` หรือรหัสประเทศของจุดรับรถ รายการเดิมที่ไม่มีจุดรับใช้ประเทศของรถ |
| `category` | `all`, `SUV`, `SEDAN`, `MPV`, `EV`, `ECO`, `LUXURY`, `WAGON` ตามหมวดหมู่รถปัจจุบัน |
| `currency` | `all` หรือรหัสสกุลเงิน 3 ตัว เช่น `THB` |
| `page`, `pageSize` | การแบ่งหน้ารายละเอียด ค่าเริ่มต้นหน้า 1 ขนาด 10 รายการ สูงสุด 100 ต่อหน้า |
| `format` | `json` (ค่าเริ่มต้น) หรือ `csv` ซึ่งส่งออกทุกรายการตามตัวกรอง |

JSON คืน `summary`, `comparison`, `trend`, `countries`, `topCars`, `sources`, `pricing`, `bookings`, `pagination`, `filters`, `options`, `timeZone` และ `generatedAt` จำนวนคำขอนับทุกสถานะ ยอดยืนยันและมูลค่าเฉลี่ยต่อรายการคิดจากราคาที่บันทึกตอนจองของรายการที่ปัจจุบันเป็น `APPROVED` หรือ `COMPLETED` โดยแยกตามสกุลเงิน ค่าที่เป็นจำนวนเงินส่งเป็น string และรายงานใช้ `Cache-Control: no-store`

## โครงสร้างข้อมูล

| โมเดล | ข้อมูล |
| --- | --- |
| `Country`, `Location` | ประเทศ สกุลเงิน สาขา และเขตเวลาของสาขา |
| `User` | สมาชิกและผู้ดูแลระบบ สถานะบัญชี และเวอร์ชัน session |
| `CarModel`, `CarModelLocation` | สเปกและรูปประจำรุ่น ข้อเสนอรายสาขาตามผู้ให้บริการ ราคา สกุลเงิน และเวลาเตรียมรถ |
| `Car`, `CarMovement` | รถรายคัน ตำแหน่งล่าสุด สถานะการให้บริการ และประวัติการย้ายรถ |
| `Booking` | รถที่จัดสรรให้ผู้จอง วันรับ–คืน ราคา ข้อมูลรถและสาขาตอนจอง และสถานะ `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `COMPLETED` |

ดู [ER diagram](docs/ER_DIAGRAM.md) และ [ข้อกำหนดโครงการ](Assignment.md)

## ตรวจสอบและทดสอบ

```bash
npm run build
npm test
npm run seed:check
```

`npm test` รัน unit tests และข้าม integration tests เมื่อเว้น `AUTH_TEST_DATABASE_URL` ไว้ หากต้องการทดสอบกับ PostgreSQL ให้กำหนดค่านี้ใน environment หรือ `.env` ให้ชี้ไปที่ฐานข้อมูลทดสอบที่เตรียม schema และ seed แล้ว รันชุดทดสอบทีละไฟล์เพื่อลดการชนกันระหว่างสร้างและล้างข้อมูลทดสอบ

```bash
node --import tsx --test --test-concurrency=1 tests/*.test.ts
```

`npm run test:cars` สร้าง schema ชั่วคราวบน PostgreSQL ที่ `localhost` หรือ `127.0.0.1` ตรวจการรัน seed ซ้ำและรันชุดทดสอบทั้งหมด แล้วลบ schema ที่สร้างขึ้นเมื่อจบ

ใช้ `npm run test:cars -- --legacy` เพื่อทดสอบการรับประวัติจาก migration ชุดเดิมและตรวจว่าข้อมูลรถเดิมยังอยู่
