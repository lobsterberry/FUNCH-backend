# Schema และข้อมูลตัวอย่าง FUNCH

ข้อมูลตัวอย่างอ้างอิง [Assignment.md](../Assignment.md) และ wireframes ใน `docs/wireframes` ของ repository `FUNCH-frontend`

## ตั้งค่าฐานข้อมูลสำหรับพัฒนา

รันคำสั่งจากโฟลเดอร์ `backend` คัดลอก [`.env.example`](../.env.example) เป็น `.env` แล้วตั้งค่าฐานข้อมูลตามวิธีที่ใช้รัน backend

- เมื่อรัน Node.js บนเครื่อง ให้ตั้ง `DATABASE_URL` ให้ชี้ไปที่ `localhost` และพอร์ต `POSTGRES_PORT` หากใช้ PostgreSQL จาก Docker Compose
- เมื่อรัน backend ใน Docker Compose ให้ตั้ง `DOCKER_DATABASE_URL` ให้ชี้ไปที่ `postgres:5432` ค่าผู้ใช้ รหัสผ่าน และชื่อฐานข้อมูลใน URL ต้องตรงกับ `POSTGRES_USER`, `POSTGRES_PASSWORD` และ `POSTGRES_DB` ให้ URL-encode อักขระพิเศษในรหัสผ่านเมื่อใส่ใน URL
- หากต้องการล็อกอินด้วยบัญชีสมาชิกตัวอย่าง ให้ตั้ง `SEED_USER_PASSWORD` อย่างน้อย 12 ตัวอักษรก่อนสร้างบัญชีครั้งแรก หากเว้นว่าง seed จะสุ่มรหัสผ่านให้ ดูค่าที่ Docker Compose ใช้ใน [คู่มือ backend](../README.md)

### เตรียมฐานข้อมูลบนเครื่อง

สำหรับฐานข้อมูลพัฒนาที่สร้างใหม่ ให้ใช้ `db:migrate` สร้างตารางจาก [SQL migrations](../db/migrations/) แล้วรัน seed หากมี PostgreSQL ทำงานอยู่แล้ว ให้ข้ามคำสั่ง `docker compose up`

```bash
npm ci
docker compose up -d --wait postgres
npm run db:migrate
npm run seed
```

### เตรียมฐานข้อมูลใน Docker Compose

สำหรับฐานข้อมูล Docker ที่สร้างใหม่ ให้เตรียมตารางก่อน แล้วรัน seed ผ่าน `pg`

```bash
docker compose run --rm --build backend npm run db:migrate
docker compose run --rm backend npm run seed
docker compose up -d backend
```

## รันและตรวจสอบ seed

คำสั่ง migration และ seed ใช้ `pg` และอ่าน `DATABASE_URL`

- `npm run seed` รัน [`seed.ts`](../scripts/seed/seed.ts) ใน transaction เพื่อสร้างหรืออัปเดตประเทศ สาขา บัญชี รถต้นแบบ และรายการจองตัวอย่าง แล้วเพิ่มรถตามแผนใน [`car-seed.ts`](../scripts/seed/car-seed.ts) การรันซ้ำอัปเดตฟิลด์ของข้อมูลต้นแบบตามชุด seed คง password hash เดิม และเติมสีรถ เลขตัวถัง (VIN) หรือเลขไมล์เฉพาะค่าที่ยังว่างของรถตัวอย่าง
- `npm run seed:check` ตรวจข้อมูลใน [`seed-data.ts`](../scripts/seed/seed-data.ts) และพิมพ์ตัวอย่างการคิดราคาโดยไม่เชื่อมต่อฐานข้อมูล
- `npm run seed:cars -- --dry-run` แสดงแผนเพิ่มรถ 106 คันจากรถต้นแบบ 28 คัน ครอบคลุม 13 สาขา ตัวเลขเป็นขนาดของแผน ตัวคำสั่งไม่อ่านข้อมูลในฐานข้อมูล
- `npm run seed:cars` ใช้เมื่อมีรถต้นแบบที่เชื่อมกับข้อเสนอรายสาขาแล้ว เพิ่มเฉพาะรถและข้อเสนอที่ยังขาดตาม ID คงที่ โดยคงข้อมูลรถและรายการจองเดิม

## ข้อมูลตัวอย่าง

| ข้อมูล | จำนวน / รายละเอียด |
| --- | --- |
| ประเทศ | 6 ประเทศ ได้แก่ JP, TH, DE, GB, US และ SG พร้อมสกุลเงินท้องถิ่นและฝั่งการจราจร |
| จุดรับและคืนรถ | 13 สาขาที่สนามบินหรือสถานี แต่ละสาขาเก็บเขตเวลาแบบ IANA |
| รถ | 134 คันใน 28 รุ่น จากรถต้นแบบ 28 คันและรถเพิ่มเติม 106 คัน ทะเบียนตัวอย่างขึ้นต้นด้วย `DEMO-` |
| รุ่นแนะนำ | 6 รุ่นจากชุดตัวอย่างสำหรับหน้าแรก พร้อมราคา รีวิวจำลอง และลำดับแนะนำ |
| บัญชี | แอดมิน 1 บัญชี สมาชิกที่เปิดใช้งาน 3 บัญชี และสมาชิกที่ปิดใช้งาน 1 บัญชี |
| การจอง | 11 รายการ ครบทั้ง `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED` และ `COMPLETED` รวมตัวอย่างรับรถที่ฮาเนดะและคืนที่สถานีโตเกียว |

บัญชีแอดมินตัวอย่าง `admin@funch.example` มี Role `ADMIN` และใช้รหัสผ่าน `FunchDemo2026!` เมื่อสร้างครั้งแรก ส่วนบัญชีสมาชิก เช่น `somchai@funch.example` ใช้รหัสผ่านจาก `SEED_USER_PASSWORD` หากกำหนดไว้ตอนสร้างบัญชี รหัสผ่านถูกเก็บเป็นแฮชรูปแบบ `scrypt$salt$hash` ดู [คู่มือ Auth API](../AUTH.md)

ชุดข้อมูลฮาเนดะมีรถต้นแบบพร้อมบริการ 18 รุ่น ตัวอย่างทริปวันที่ 20 พ.ย. 2026 เวลา 10:00 ถึง 22 พ.ย. เวลา 15:00 ตามเวลาญี่ปุ่น คิดเป็น 3 วัน ราคา Harrier, Serena, Model 3 และ Corolla Cross คือ 6,600, 7,800, 9,300 และ 5,400 บาทตามลำดับ

## โครงสร้างรุ่นรถและการจอง

| โมเดล | ข้อมูลที่เก็บ |
| --- | --- |
| `CarModel` | สเปกร่วมของรุ่น หมวดหมู่ `categories` รหัสอุปกรณ์ `featureCodes` และลำดับแนะนำ รูปอยู่ใน `CarModel.imageUrl` ซึ่งเว้นว่างได้ |
| `CarModelLocation` | ข้อเสนอของรุ่นตามสาขาและผู้ให้บริการ เก็บราคาต่อชั่วโมง ราคาต่อวัน สกุลเงิน สถานะเปิดบริการ และเวลาเตรียมรถหลังคืน |
| `Car` | รถรายคันพร้อมทะเบียน สี เลขตัวถัง เลขไมล์ และสถานะ `AVAILABLE`, `CLEANING`, `MAINTENANCE` หรือ `INACTIVE` โดย `carModelLocationId` ระบุข้อเสนอประจำรถ และ `locationId` ระบุตำแหน่งจริงล่าสุด |
| `Booking` | ผูกกับรถจริงผ่าน `carId` รายการที่สร้างผ่าน API เก็บข้อมูลรถและสาขาตอนจองใน `carSnapshot` พร้อมราคา สกุลเงิน เขตเวลาสาขารับรถ และเวลาเตรียมรถ |
| `CarMovement` | ประวัติการย้ายรถระหว่างสาขา รวมถึงการคืนรถต่างสาขา |

`GET /api/cars/search` ส่งผลตามข้อเสนอรายสาขาพร้อม `availableCount` เมื่อส่งช่วงเวลา ระบบนับรถที่พร้อมใช้งานโดยดูตำแหน่งรถ รายการจอง `PENDING` และ `APPROVED` รวมถึงเวลาเตรียมรถหลังคืน การสร้างรายการจองจะตรวจความว่างอีกครั้งและจัดสรรรถจริงใน transaction ดู [Cars API](../docs/cars.md#api)

ราคาตัวอย่างใช้ THB โดย `Country.currencyCode` เก็บสกุลเงินท้องถิ่นเป็นข้อมูลอ้างอิง API คำนวณราคาตามเขตเวลาของสาขารับรถ และจำกัดยอดค่าเช่าส่วนที่คิดรายชั่วโมงไว้ที่ราคาหนึ่งวัน ส่วน `pricingExamples` เป็นผลที่คาดไว้ตามโจทย์ เช่น Harrier เช่า 8 ชั่วโมงมีราคาในชุดตัวอย่าง 2,240 บาท และ API คิด 2,200 บาทตามเพดานรายวัน ดู [ตัวคำนวณราคา](../src/utils/pricing.ts) และ [ชุดทดสอบราคา](../tests/pricing.test.ts)

## ตัวอย่างการกรองข้อเสนอด้วย pg

ตัวอย่างนี้ค้นข้อเสนอที่เปิดบริการในฮาเนดะสำหรับรถ SUV หรือ SEDAN เกียร์อัตโนมัติ พวงมาลัยขวา และมีอุปกรณ์ทั้งสองรายการ หากต้องการจำนวนรถว่างตามช่วงเวลา ให้ใช้ `GET /api/cars/search`

```ts
const { rows: offers } = await databasePool().query(
  `SELECT o.id, o."carModelId", o."locationId", o."dailyRate", m.brand, m.model
   FROM car_model_locations o
   JOIN car_models m ON m.id = o."carModelId"
   WHERE o."locationId" = $1 AND o."isActive"
     AND o."dailyRate" BETWEEN $2 AND $3
     AND m.categories && $4::"CarCategory"[]
     AND m."transmissionType" = $5 AND m."steeringSide" = $6
     AND m."featureCodes" @> $7::text[]
   ORDER BY m."recommendationOrder", o.id
   LIMIT $8`,
  ['seed-location-haneda', 1000, 4000, ['SUV', 'SEDAN'], 'AUTOMATIC',
    'RHD', ['GPS_EN', 'CARPLAY_ANDROID_AUTO'], 4],
);
```
