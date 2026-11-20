# Prisma และข้อมูลตัวอย่าง FUNCH

ข้อมูลตัวอย่างอ้างอิง [Assignment.md](../Assignment.md) และ wireframes ใน `docs/wireframes` ของ repository `FUNCH-frontend`

## ตั้งค่าฐานข้อมูลสำหรับพัฒนา

รันคำสั่งจากโฟลเดอร์ `backend` คัดลอก [`.env.example`](../.env.example) เป็น `.env` แล้วตั้งค่าฐานข้อมูลตามวิธีที่ใช้รัน backend

- เมื่อรัน Node.js บนเครื่อง ให้ตั้ง `DATABASE_URL` ให้ชี้ไปที่ `localhost` และพอร์ต `POSTGRES_PORT` หากใช้ PostgreSQL จาก Docker Compose
- เมื่อรัน backend ใน Docker Compose ให้ตั้ง `DOCKER_DATABASE_URL` ให้ชี้ไปที่ `postgres:5432` ค่าผู้ใช้ รหัสผ่าน และชื่อฐานข้อมูลใน URL ต้องตรงกับ `POSTGRES_USER`, `POSTGRES_PASSWORD` และ `POSTGRES_DB` ให้ URL-encode อักขระพิเศษในรหัสผ่านเมื่อใส่ใน URL
- ตั้ง `SEED_USER_PASSWORD` อย่างน้อย 12 ตัวอักษรก่อนรัน seed ทั้งชุด ดูค่าที่ Docker Compose ต้องใช้เพิ่มเติมได้จาก [คู่มือ backend](../README.md)

### รัน Prisma บนเครื่อง

สำหรับฐานข้อมูลพัฒนาที่สร้างใหม่ ให้ใช้ `prisma:push` สร้างตารางจาก [`schema.prisma`](schema.prisma) แล้วรัน seed หากมี PostgreSQL ทำงานอยู่แล้ว ให้ข้ามคำสั่ง `docker compose up`

```bash
npm ci
docker compose up -d --wait postgres
npm run prisma:push
npm run prisma:seed
```

### รัน Prisma ใน Docker Compose

สำหรับฐานข้อมูล Docker ที่สร้างใหม่ ให้เตรียมตารางก่อน แล้วเปิด backend และรัน seed หาก backend ทำงานอยู่และฐานข้อมูลมีตารางพร้อมแล้ว ให้รันเฉพาะคำสั่งสุดท้าย

```bash
docker compose run --rm --build backend npm run prisma:push
docker compose up -d backend
docker compose exec backend npm run prisma:seed
```

## รันและตรวจสอบ seed

- `npm run prisma:seed` รัน [`seed.ts`](seed.ts) ใน transaction เพื่อสร้างหรืออัปเดตประเทศ สาขา บัญชี รถต้นแบบ และรายการจองตัวอย่าง แล้วเพิ่มรถตามแผนใน [`car-seed.ts`](car-seed.ts) การรันซ้ำอัปเดตฟิลด์ของข้อมูลต้นแบบตามชุด seed คง password hash เดิม และเติมสีรถ เลขตัวถัง (VIN) หรือเลขไมล์เฉพาะค่าที่ยังว่างของรถตัวอย่าง
- `npm run prisma:seed:check` ตรวจข้อมูลใน [`seed-data.ts`](seed-data.ts) และพิมพ์ตัวอย่างการคิดราคาโดยไม่เชื่อมต่อฐานข้อมูล หากยังไม่ได้สร้าง Prisma Client ให้รัน `npm run prisma:generate` ก่อน
- `npm run prisma:seed:cars -- --dry-run` แสดงแผนเพิ่มรถ 106 คันจากรถต้นแบบ 28 คัน ครอบคลุม 13 สาขา ตัวเลขเป็นขนาดของแผน ตัวคำสั่งไม่อ่านข้อมูลในฐานข้อมูล
- `npm run prisma:seed:cars` ใช้เมื่อมีรถต้นแบบที่เชื่อมกับข้อเสนอรายสาขาแล้ว เพิ่มเฉพาะรถและข้อเสนอที่ยังขาดตาม ID คงที่ โดยคงข้อมูลรถและรายการจองเดิม

## ข้อมูลตัวอย่าง

| ข้อมูล | จำนวน / รายละเอียด |
| --- | --- |
| ประเทศ | 6 ประเทศ ได้แก่ JP, TH, DE, GB, US และ SG พร้อมสกุลเงินท้องถิ่นและฝั่งการจราจร |
| จุดรับและคืนรถ | 13 สาขาที่สนามบินหรือสถานี แต่ละสาขาเก็บเขตเวลาแบบ IANA |
| รถ | 134 คันใน 28 รุ่น จากรถต้นแบบ 28 คันและรถเพิ่มเติม 106 คัน ทะเบียนตัวอย่างขึ้นต้นด้วย `DEMO-` |
| รุ่นแนะนำ | 6 รุ่นจากชุดตัวอย่างสำหรับหน้าแรก พร้อมราคา รีวิวจำลอง และลำดับแนะนำ |
| บัญชี | แอดมิน 1 บัญชี สมาชิกที่เปิดใช้งาน 3 บัญชี และสมาชิกที่ปิดใช้งาน 1 บัญชี |
| การจอง | 11 รายการ ครบทั้ง `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED` และ `COMPLETED` รวมตัวอย่างรับรถที่ฮาเนดะและคืนที่สถานีโตเกียว |

ใช้ `admin@funch.example` สำหรับแอดมิน หรือ `somchai@funch.example` สำหรับสมาชิก ร่วมกับรหัสผ่านที่ตั้งไว้ตอนสร้างบัญชี รหัสผ่านถูกเก็บเป็นแฮชรูปแบบ `scrypt$salt$hash` ดู [คู่มือ Auth API](../AUTH.md)

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

## ตัวอย่างการกรองข้อเสนอด้วย Prisma

ตัวอย่างนี้ค้นข้อเสนอที่เปิดบริการในฮาเนดะสำหรับรถ SUV หรือ SEDAN เกียร์อัตโนมัติ พวงมาลัยขวา และมีอุปกรณ์ทั้งสองรายการ หากต้องการจำนวนรถว่างตามช่วงเวลา ให้ใช้ `GET /api/cars/search`

```ts
const offers = await prisma.carModelLocation.findMany({
  where: {
    locationId: 'seed-location-haneda',
    isActive: true,
    dailyRate: { gte: 1000, lte: 4000 },
    carModel: {
      categories: { hasSome: ['SUV', 'SEDAN'] },
      transmissionType: 'AUTOMATIC',
      steeringSide: 'RHD',
      featureCodes: { hasEvery: ['GPS_EN', 'CARPLAY_ANDROID_AUTO'] },
    },
  },
  include: { carModel: true, location: true },
  orderBy: [{ carModel: { recommendationOrder: 'asc' } }, { id: 'asc' }],
  take: 4,
});
```
