# FUNCH Backend API & Database (Docker Setup)

Authentication (Auth.js): ดู [คู่มือ Auth API](AUTH.md) สำหรับ login, สมัครสมาชิก, เปลี่ยนรหัสผ่าน, session/logout และการตั้งค่า `AUTH_SECRET` ที่ต้องใช้ก่อนเปิด backend

ระบบ Backend พัฒนาด้วย **Node.js Express + TypeScript + Prisma ORM + PostgreSQL + pgAdmin 4 (PGPage)** ตามข้อกำหนดใน [Assignment.md](Assignment.md)

Frontend แยกอยู่ใน repository `FUNCH-frontend` ตั้งรหัสผ่านของแต่ละบริการใน `.env` ของเครื่องที่รัน ไฟล์ `.env` จริงไม่รวมอยู่ใน Git

Schema และ seed ตาม wireframe: ดู [คู่มือ Prisma](prisma/README.md) สำหรับข้อมูลตัวอย่าง วิธี migrate/seed และขอบเขตของ API ปัจจุบัน

---

## 🚀 บริการใน Docker Compose (`docker-compose.yml`)

| บริการ | Container Name | Port | คำอธิบาย |
|--------|----------------|------|----------|
| **Backend API** | `funch_backend` | `5000` | Node.js Express + TypeScript + Prisma พร้อม Hot Reload |
| **PostgreSQL** | `funch_postgres` | `5432` | ฐานข้อมูลหลัก (PostgreSQL 16) พร้อม Persistent Volume |
| **PGPage (pgAdmin 4)** | `funch_pgadmin` | `5050` | หน้า Web GUI จัดการฐานข้อมูล PostgreSQL (image: `dpage/pgadmin4`) |

---

## 📋 ข้อมูลสำหรับการเข้าใช้งาน (Credentials)

### 1. Backend API
- **URL**: `http://localhost:5000`
- **Health Check**: `http://localhost:5000/health`

### 2. pgAdmin 4 (PGPage Web GUI)
- **URL**: `http://localhost:5050`
- **Email**: ค่าที่ตั้งใน `PGADMIN_DEFAULT_EMAIL`
- **Password**: ค่าที่ตั้งใน `PGADMIN_DEFAULT_PASSWORD`
> *ระบบตั้งค่า auto-connect ผ่าน `servers.json` ไว้ให้แล้ว เมื่อเข้าใช้งานจะพบเซิร์ฟเวอร์ `FUNCH PostgreSQL` ทันที*

### 3. PostgreSQL Database
- **Host**: `localhost` (ภายนอก) หรือ `postgres` (ภายใน docker network)
- **Port**: `5432`
- **Username**: `postgres`
- **Password**: ค่าที่ตั้งใน `POSTGRES_PASSWORD`
- **Database**: `funch_db`
- **Connection URL**: ตั้ง `DATABASE_URL` โดยใช้รหัสผ่านเดียวกับ `POSTGRES_PASSWORD` และ URL-encode อักขระพิเศษในรหัสผ่าน

---

## 🛠️ วิธีการรันระบบด้วย Docker Compose

### 1. เริ่มต้นระบบทั้งหมด
เปิด Terminal ที่โฟลเดอร์ repository นี้ คัดลอก `.env.example` เป็น `.env` และตั้ง `AUTH_SECRET`, `POSTGRES_PASSWORD`, `PGADMIN_DEFAULT_EMAIL`, `PGADMIN_DEFAULT_PASSWORD` และ `DATABASE_URL` ของเครื่องที่รันก่อนเริ่ม ดู [คู่มือ Auth API](AUTH.md) สำหรับการสร้าง secret และตั้ง `SEED_USER_PASSWORD` อย่างน้อย 12 ตัวอักษรหากต้องการ seed บัญชีทดลอง:
```bash
docker compose up -d --build
```
หรือผ่าน npm script:
```bash
npm run docker:up
```

> **หมายเหตุ**: Container Backend รัน `prisma generate` และ `prisma migrate deploy` ก่อนเริ่ม API เพื่อปรับ schema และ backfill ข้อมูลตาม migration

### 2. ดู Logs การทำงาน
```bash
docker compose logs -f
```
หรือดูเฉพาะ backend:
```bash
docker compose logs -f backend
```

### 3. ปิดการทำงานของระบบ
```bash
docker compose down
```
หากต้องการลบข้อมูล volume ทั้งหมดเพื่อเริ่มใหม่:
```bash
docker compose down -v
```

---

## 💻 การพัฒนาแบบ Local (โดยไม่ต้องเปิด Docker Backend)

หากเปิด PostgreSQL ผ่าน Docker ไว้แล้ว และต้องการรัน Backend บนเครื่องตัวเอง:
1. ติดตั้ง Dependencies:
   ```bash
   npm install
   ```
2. ตั้ง `DATABASE_URL` ใน `.env` ให้ใช้ host `localhost` และรหัสผ่านของฐานข้อมูลที่ตั้งไว้ (URL-encode อักขระพิเศษในรหัสผ่าน)
3. Generate Prisma Client & Push Database:
   ```bash
   npm run prisma:generate
   npm run prisma:push
   npm run prisma:seed
   ```
4. เริ่มต้นเซิร์ฟเวอร์แบบ Development (Hot-Reload):
   ```bash
   npm run dev
   ```

---

## 🗄️ โครงสร้างฐานข้อมูล (Prisma Models)

- **`User`**: ข้อมูลสมาชิกและแอดมิน (`USER`, `ADMIN`)
- **`Car`**: ข้อมูลรถยนต์ รองรับการแบ่งตามประเทศ (`country`), ค่าบริการรายชั่วโมง (`hourlyRate`), ค่าบริการรายวัน (`dailyRate`), option ต่างๆ
- **`Booking`**: ข้อมูลการจองรถยนต์, เวลาเริ่ม-คืน, ผลการคำนวณราคาตาม Pricing Rules, สถานะการอนุมัติ (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `COMPLETED`), และผู้ดูแลที่อนุมัติ

---

## 🏷️ Pricing Rules ตามโจทย์ (`Assignment.md`)

ฟังก์ชันคำนวณราคาอยู่ใน `src/utils/pricing.ts`:
1. คำนวณเป็น **รายชั่วโมง** และ **รายวัน**
2. ใช้งานเกิน **8 ชั่วโมง** ปรับนับเป็น **1 วัน**
3. หากคืนรถ **เกิน 14:00 น.** จะคิดค่าบริการของวันนั้นเป็น **1 วันทันที**
4. หากใช้งานข้ามวัน จะเริ่มนับรอบชั่วโมงใหม่หลังจากพ้นรอบ 24 ชั่วโมงจากเวลาเริ่มต้น

# รถหลายคันต่อรุ่นและหลายสาขา

ดู [คู่มือ Fleet และการย้ายข้อมูล](docs/fleet.md) สำหรับโครงสร้างใหม่ API วิธีสำรอง/ย้ายข้อมูล และคำสั่งทดสอบแบบแยกฐานข้อมูล

## จัดการสมาชิกสำหรับผู้ดูแลระบบ

ทุก endpoint ใช้ Auth.js session และตรวจสิทธิ์ `ADMIN` โดยไม่ส่ง password hash หรือ session version กลับในข้อมูลสมาชิก

| Method | Endpoint | การทำงาน |
| --- | --- | --- |
| GET | `/api/admin/members` | รายชื่อและสถิติ รองรับ `search`, `role=all/USER/ADMIN`, `status=all/active/suspended`, `page`, `pageSize` (1–100) |
| POST | `/api/admin/members` | สร้างบัญชีด้วย `name`, `email`, `phoneNumber` (หรือ `null`), `role`, `isActive`, `password` (8–128 ตัวอักษร) |
| GET | `/api/admin/members/:id` | ข้อมูลสมาชิกและประวัติการจอง แบ่งหน้าด้วย `page`, `pageSize` |
| PATCH | `/api/admin/members/:id` | แก้ไขข้อมูลติดต่อ สิทธิ์ หรือสถานะ โดยส่งเฉพาะฟิลด์ที่ต้องการแก้ไข |

ยอดรวมคิดจากรายการจองสถานะ `APPROVED` และ `COMPLETED` เท่านั้น การเปลี่ยนสิทธิ์หรือระงับบัญชีจะเพิ่ม `sessionVersion` เพื่อยกเลิกเซสชันเดิมทุกอุปกรณ์ และไม่ยกเลิกประวัติหรือรายการจอง สมาชิกที่เปิดใช้งานใหม่ต้องเข้าสู่ระบบอีกครั้ง ไม่สามารถลดสิทธิ์หรือระงับบัญชีของตนเองได้ และตรวจสิทธิ์ผู้แก้ไขซ้ำใน transaction หลังรอการแก้ไขจากแอดมินคนอื่น

หน้าเว็บอยู่ที่ `/admin/members` ใช้ schema เดิม จึงไม่มี migration เพิ่ม ทดสอบ HTTP flow รวมการเพิกถอนเซสชันและคำขอพร้อมกันใน `tests/admin-members.integration.test.ts` ผ่าน `npm run test:fleet` ซึ่งแยก schema ทดสอบและลบหลังทดสอบเสร็จ
