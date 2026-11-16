# Prisma และข้อมูลตัวอย่าง FUNCH

อ้างอิง [Assignment.md](../Assignment.md) และ wireframes ใน `docs/wireframes` ของ repository `FUNCH-frontend`

## รันกับ PostgreSQL

จากโฟลเดอร์ repository ให้กำหนด `DATABASE_URL` ใน `.env` ให้ตรงกับฐานข้อมูลที่จะใช้ และตั้ง `SEED_USER_PASSWORD` อย่างน้อย 12 ตัวอักษรก่อนสร้างบัญชีทดลอง หากรัน Node.js บนเครื่องและ PostgreSQL ใน Docker ให้ใช้ host `localhost` (host `postgres` ใช้ภายใน Docker network)

```bash
docker compose up -d postgres
npm run prisma:generate
npm run prisma:deploy
npm run prisma:seed
```

หากเปิด backend ผ่าน Docker Compose อยู่แล้ว ซึ่งมีคำสั่ง `prisma db push` ตอนเริ่มต้น ให้ seed ผ่าน container:

```bash
docker compose exec backend npm run prisma:seed
```

Migration `20261116000000_initial_rental_schema` สำหรับฐานข้อมูลว่าง หากมีตารางจาก `prisma db push` เดิมอยู่แล้ว ให้ตรวจสอบและปรับ schema ด้วย `npm run prisma:push` ก่อน seed; อย่ารัน initial migration ทับตารางเดิมหรือ reset ฐานข้อมูลที่ต้องเก็บไว้ การเพิ่ม foreign key ประเทศและ unique ทะเบียนรถอาจต้องแก้ข้อมูลเก่าที่ไม่ตรงข้อกำหนดก่อน

ตรวจข้อมูลตัวอย่างโดยไม่เชื่อมต่อหรือเขียนฐานข้อมูล:

```bash
npm run prisma:seed:check
```

`seed.ts` ใช้ transaction และ upsert ตาม ID ที่ขึ้นต้น `seed-` จึงรันซ้ำได้โดยไม่เพิ่มแถวซ้ำหรือสั่งลบข้อมูลอื่น การรันซ้ำจะคืนค่าฟิลด์ของแถวตัวอย่างตามไฟล์ seed และคง password hash เดิมไว้

## ข้อมูลที่เตรียมไว้

| ข้อมูล | จำนวน / รายละเอียด |
| --- | --- |
| ประเทศ | 6: JP, TH, DE, GB, US, SG พร้อมสกุลเงินท้องถิ่นและฝั่งการจราจร |
| จุดรับ/คืน | 13: สนามบินและสถานี พร้อมชื่อเมือง รหัสสนามบิน และ IANA time zone |
| รถ | 28: รถฮาเนดะพร้อมบริการ 18 คัน, เมืองอื่น 9 คัน, รถบำรุงรักษา 1 คัน |
| รถแนะนำ | 6 คันตามหน้าแรก พร้อมรุ่น ราคา รีวิว ออปชั่น และลำดับแนะนำ |
| บัญชี | แอดมิน 1, สมาชิกใช้งาน 3, สมาชิกปิดใช้งาน 1 |
| การจอง | 11 รายการ ครบ PENDING, APPROVED, REJECTED, CANCELLED, COMPLETED |

รถสี่คันแรกของหน้าค้นหาเป็น Harrier (280/2,200 บาท), Serena (320/2,600), Model 3 (390/3,100), Corolla Cross (220/1,800) ตามลำดับชั่วโมง/วัน ทริปวันที่ 20 พ.ย. 2026 เวลา 10:00 ถึง 22 พ.ย. เวลา 15:00 ในญี่ปุ่นคิดเป็น 3 วัน ได้ยอด 6,600 / 7,800 / 9,300 / 5,400 บาทตาม wireframe

รายการจองตัวอย่างไม่ทับช่วงค้นหาดังกล่าว เพื่อให้ยังมีรถฮาเนดะว่าง 18 คัน ตัวเลขจำนวนรถทั่วโลกและจำนวนรถของแต่ละ facet ใน wireframe เป็นข้อความ mockup จึงไม่ได้สร้างรถหลายร้อยคันเพื่อให้ครบตัวเลขเหล่านั้น ให้ UI นับจากฐานข้อมูลจริง

บัญชีทดลองใช้โดเมน `.example` และรหัสผ่านที่ตั้งใน `SEED_USER_PASSWORD` เก็บเป็น `scrypt$salt$hash` ไม่มีรหัสผ่าน plaintext ในฐานข้อมูล ใช้ login ผ่าน Auth.js ได้ตาม [คู่มือ Auth API](../AUTH.md) เช่น `admin@funch.example` สำหรับแอดมิน และ `somchai@funch.example` สำหรับสมาชิก การรัน seed ซ้ำคง password hash ของบัญชีเดิมไว้ ค่ารหัสผ่านใหม่นี้ใช้เฉพาะการสร้างบัญชีที่ยังไม่มี

## การนำข้อมูลไปใช้

- `Car.country` ยังใช้ country code เหมือน API เดิม และมี relation `countryInfo` สำหรับชื่อประเทศ/กฎจราจร
- `location` ใช้ดึงเมือง สนามบิน และ `timeZone`; ประเทศเดียวกันอาจมีหลายเขตเวลา จึงไม่เก็บเขตเวลาไว้ที่ Country
- `steeringSide` คือพวงมาลัย RHD/LHD ส่วน `Country.drivingSide` คือฝั่งถนน LEFT/RIGHT
- `categories` เป็น enum array เพื่อรองรับรถที่อยู่ได้หลายกลุ่ม เช่น SUV + EV หรือ SEDAN + ECO
- `transmissionType` ใช้กรอง AUTOMATIC/MANUAL ส่วน `transmission` ใช้แสดงชื่อเกียร์ เช่น E-CVT
- `featureCodes` ใช้ Prisma `hasEvery`/`hasSome` กรองออปชั่น; `options` เป็น JSON array ของ `{ code, label, included }` สำหรับแสดงรายละเอียด ดูรายการ code ใน `seed-data.ts`
- `rating`, `reviewCount` เป็นค่าสรุปจำลองจาก wireframe ไม่ใช่รีวิวจากผู้ใช้จริง
- `isAvailable` หมายถึงเปิดให้เช่า การค้นหารถว่างตามวันต้องตรวจ booking ที่ทับช่วงเวลาเพิ่มเติม (`start < requestedEnd` และ `end > requestedStart`) โดยกำหนดนโยบายว่าจะกันรถสำหรับ PENDING ด้วยหรือไม่
- `isFeatured` และ `recommendationOrder` ใช้จัดหน้าแรก/เรียงผลแนะนำ; ราคาและ rating ใช้เรียงผลค้นหาได้
- `Booking.source` แยกสมาชิกเดิมกับสมัครพร้อมจอง มีชื่อผู้ขับขี่ ใบขับขี่ จุดรับ/คืน และข้อมูลแอดมินผู้พิจารณา โดยคำขอใหม่เป็น PENDING
- การจองเก็บ rate, currency และ time zone snapshot พร้อม `pricingDetails` และเวลา UTC (`DateTime`) โดยข้อความเวลาใน `pricingDetails` มี offset ของปลายทาง
- ราคาเก็บด้วย `Decimal(12,2)` ป้องกันความคลาดเคลื่อนของ floating point; Prisma ส่ง Decimal ใน JSON เป็น string ส่วน API คำนวณเดิมแปลง rate เป็น number ก่อนเรียก utility
- ราคาทั้งหมดเป็น THB ตาม wireframe ค่า `Country.currencyCode` เป็นข้อมูลสกุลเงินท้องถิ่น ไม่มี FX rate หรือการแปลงสกุลเงินจำลอง
- `imageUrl` เป็น null เพราะ wireframe ใช้ภาพแทน ไม่มีไฟล์รูปจริงให้ seed

## ตัวอย่างการกรองด้วย Prisma

```ts
const cars = await prisma.car.findMany({
  where: {
    country: 'JP',
    location: { city: 'Tokyo' },
    isAvailable: true,
    categories: { hasSome: ['SUV', 'SEDAN'] },
    transmissionType: 'AUTOMATIC',
    steeringSide: 'RHD',
    dailyRate: { gte: 1000, lte: 4000 },
    featureCodes: { hasEvery: ['GPS_EN', 'CARPLAY_ANDROID_AUTO', 'ETC_CARD'] },
  },
  include: { countryInfo: true, location: true },
  orderBy: [{ recommendationOrder: 'asc' }, { id: 'asc' }],
  skip: 0,
  take: 4,
});
```

## ขอบเขตของงานนี้

งาน schema, migration และ seed รองรับ [Auth.js API และสิทธิ์แอดมิน](../AUTH.md) แล้ว API รถยังกรองได้เฉพาะประเทศ/สถานะพร้อมให้บริการ ยังต้องเชื่อมตัวกรองอื่น การป้องกันจองซ้อน และการส่งอีเมลในงาน API ต่อไป

`pricingExamples` เป็น expected fixtures ตามโจทย์ รวมตรง 8 ชั่วโมง ตรง 14:00 เกิน 8 ชั่วโมง และข้ามวัน ตัว seed ไม่ใช้ `src/utils/pricing.ts` เพราะ utility เดิมยังใช้เขตเวลาของ server และมีการ cap ราคารายชั่วโมงที่โจทย์ไม่ได้ระบุ จึงยังต้องปรับ utility ก่อนนำไปคำนวณจริงทั่วโลก การทดสอบ seed ไม่ได้ยืนยันว่า pricing API เดิมผ่านทุกกฎนี้แล้ว
