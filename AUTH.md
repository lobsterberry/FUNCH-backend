# Authentication API

ใช้ Auth.js (`@auth/express`) แบบ Credentials กับ Prisma User เดิม และ JWT session ใน HttpOnly cookie อายุ 24 ชั่วโมง รองรับ scrypt hash ของบัญชี seed เดิม โดยไม่ต้องใช้ Prisma adapter หรือสร้างตาราง OAuth

## เริ่มใช้งาน

1. ติดตั้งด้วย `npm install` และคัดลอก `.env.example` เป็น `.env` หากยังไม่มีไฟล์
2. ตั้ง `AUTH_SECRET` เป็นค่าสุ่มอย่างน้อย 32 ตัวอักษร สร้างได้ด้วย `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` อย่า commit secret
3. ตั้ง `AUTH_URL=http://localhost:5000` และ `FRONTEND_URL=http://localhost:3000` ให้ตรงกับ origin ที่ใช้จริง
4. ตั้ง `DATABASE_URL` ให้ตรงกับ PostgreSQL และรัน `npm run prisma:deploy` ตามด้วย `npm run dev` หรือ `npm run build` และ `npm start`

ติดตั้งใน workspace นี้ได้สร้าง secret ใน `.env` และใช้ migration เพิ่ม `users.sessionVersion` แล้ว ฐานข้อมูลอื่นต้อง deploy migration ด้วย หาก schema เดิมมาจาก `prisma db push` ให้ทำตาม [คู่มือ Prisma](prisma/README.md) ก่อนใช้ migrations; ห้าม reset ฐานข้อมูลที่ต้องเก็บไว้

สำหรับ Node.js บนเครื่องกับ PostgreSQL ใน Docker ให้ใช้ host `localhost` ใน `DATABASE_URL`; สำหรับ backend ใน Docker ให้ใช้ `postgres` โดย Docker Compose ส่งค่า Auth ให้ backend แล้ว และยัง sync schema ด้วย `prisma db push` ตามโฟลว์ development เดิม

Production ต้องใช้ HTTPS และตั้ง `AUTH_URL` ให้เป็น public origin เพื่อเปิด Secure cookie ถ้าอยู่หลัง reverse proxy ให้ตั้ง `TRUST_PROXY_HOPS` ตามจำนวน proxy ที่เชื่อถือได้ (เช่น `1`); หากใช้ Docker ให้ส่ง environment variable นี้เข้า container ด้วย กำหนด frontend/backend บน site เดียวกัน เช่น `app.example.com` / `api.example.com` เพื่อใช้ SameSite=Lax cookie

## Endpoints

ทุก custom POST ใช้ `Content-Type: application/json` และ frontend ต้องส่ง `credentials: 'include'` เพื่อรับและส่ง cookie

| Method | Path | การใช้งาน |
| --- | --- | --- |
| POST | `/api/auth/register` | สมัครสมาชิกใหม่ |
| GET | `/api/auth/csrf` | รับ CSRF token พร้อม cookie ก่อน login/logout |
| POST | `/api/auth/login` | เข้าสู่ระบบผ่าน Auth.js Credentials |
| POST | `/api/auth/logout` | ออกจากระบบบน browser ปัจจุบัน |
| GET | `/api/auth/session` | Auth.js session หรือ `null` เมื่อไม่ได้ login |
| GET | `/api/auth/me` | ข้อมูลบัญชีปัจจุบัน ต้อง login |
| POST | `/api/auth/change-password` | ตรวจรหัสผ่านเดิม เปลี่ยนรหัสผ่าน และยกเลิก session ทุกอุปกรณ์ |

Auth.js native endpoints ยังใช้ได้ เช่น `/api/auth/providers`, `/api/auth/callback/credentials` และ `/api/auth/signout`

### สมัครสมาชิก

```http
POST /api/auth/register
Content-Type: application/json

{
  "name": "Somchai Jaidee",
  "email": "somchai@example.com",
  "password": "ExamplePassword123!",
  "phoneNumber": "+66812345678"
}
```

`name`, `email`, `password` เป็น required; `phoneNumber`, `firstName`, `lastName` เป็น optional รหัสผ่าน 8–128 ตัวอักษร ระบบ trim/lowercase email และกำหนด role เป็น `USER` เสมอ ไม่รับ `role` หรือ `isActive` จาก client

สำเร็จ: HTTP 201 `{ "success": true, "data": { "id": "...", "email": "...", "name": "...", "role": "USER", ... } }` ไม่มี password/hash ใน response สมัครเสร็จให้เรียก login อีกครั้ง

### Login / session / logout จาก frontend

```js
const API = 'http://localhost:5000';

async function csrfToken() {
  const response = await fetch(`${API}/api/auth/csrf`, { credentials: 'include' });
  return (await response.json()).csrfToken;
}

const loginResponse = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'somchai@example.com',
    password: 'ExamplePassword123!',
    csrfToken: await csrfToken(),
  }),
});
if (!loginResponse.ok) throw new Error('Login request failed');
const loginResult = await loginResponse.json();
// Auth.js ส่ง HTTP 200 พร้อม { url } แม้ credentials/CSRF ไม่ถูกต้อง
const error = new URL(loginResult.url).searchParams.get('error');
if (error) throw new Error(error);

const meResponse = await fetch(`${API}/api/auth/me`, { credentials: 'include' });
const me = await meResponse.json();

await fetch(`${API}/api/auth/logout`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ csrfToken: await csrfToken() }),
});
```

Login/logout aliases คืนค่า `{ "url": "..." }` ตาม Auth.js contract; ต้องตรวจ `error` ใน URL เช่น `CredentialsSignin` หรือ `MissingCSRF` และห้ามใช้ HTTP 200 เพียงอย่างเดียวเพื่อตัดสินว่า login สำเร็จ ไม่มี bearer token ใน JSON; ใช้ session cookie

เมื่อใช้ native `/callback/credentials` หรือ `/signout` ให้ส่ง header `X-Auth-Return-Redirect: 1` เพื่อรับ JSON แทน HTTP redirect

### เปลี่ยนรหัสผ่าน

```http
POST /api/auth/change-password
Content-Type: application/json
Cookie: <session cookie จาก login>

{
  "currentPassword": "ExamplePassword123!",
  "newPassword": "NewPassword456!"
}
```

สำเร็จ HTTP 200 `{ "success": true, "message": "Password changed. Please sign in again on all devices." }` ระบบเพิ่ม `sessionVersion` และ session เก่าทุกอุปกรณ์จะใช้เข้าถึง API ไม่ได้อีก ต้อง login ใหม่ด้วยรหัสใหม่

รหัสใหม่ต้องต่างจากรหัสเดิม endpoint นี้ใช้เมื่อทราบรหัสผ่านเดิม ไม่ใช่โฟลว์ลืมรหัสผ่านผ่านอีเมล

### Errors ของ custom API

| HTTP | ความหมาย |
| --- | --- |
| 400 | validation ไม่ผ่าน / รหัสผ่านเดิมไม่ถูกต้อง |
| 401 | ยังไม่ได้ login / session หมดอายุหรือถูกยกเลิก |
| 403 | origin ไม่ได้รับอนุญาต / ไม่มีสิทธิ์ |
| 409 | email ซ้ำ / เปลี่ยนรหัสผ่านพร้อมกัน |
| 413 | body เกิน 16 KB |
| 415 | custom POST ไม่ได้ส่ง JSON |
| 429 | เกิน 30 ครั้งต่อ IP ภายใน 15 นาทีในกลุ่ม endpoint ที่จำกัด |

ตัวอย่าง `{ "success": false, "message": "..." }`; validation มี `errors` เพิ่มเติม ตารางนี้ไม่แทน error contract ของ Auth.js native login/logout ที่อธิบายด้านบน

## เชื่อมกับการจองและสิทธิ์แอดมิน

- `POST /api/bookings`: สมาชิกใช้ ID จาก session; ไม่ต้องส่ง `userId` และห้ามส่ง ID ของคนอื่น
- ผู้ที่ยังไม่ login สมัครพร้อมจองได้ด้วย `registerUser: { name, email, password, phoneNumber? }` และข้อมูลการจองเดิม โดยบันทึก user + booking ใน transaction เดียว รหัสผ่าน hash ด้วย scrypt และสมัครเสร็จยังต้อง login เพื่อรับ session
- `GET /api/bookings`, `PATCH /api/bookings/:id/status` และ `POST /api/cars` ต้องเป็น `ADMIN`
- การอนุมัติใช้ ID แอดมินจาก session โดย body ส่งเฉพาะ `{ status, adminNote? }` ไม่รับ `adminId`
- บัญชี `isActive=false` และ session version เก่าจะถูกปฏิเสธ และตรวจ role ล่าสุดจากฐานข้อมูลทุกครั้ง
- การจองรับ `driverName`, `internationalDrivingPermit`, `pickupLocationId`, `dropoffLocationId` เพิ่มเติม จุดรับต้องตรงกับรถ จุดคืนต้องอยู่ในประเทศเดียวกัน และวันรับรถต้องเป็นอนาคต
- ระบบคำนวณราคาตาม IANA time zone ของจุดรับรถและเก็บ time zone/สถานที่/ข้อมูลผู้ขับขี่เป็นรายการจองจริง
- คำขอ PENDING และ APPROVED กันรถในช่วง `[startDateTime, endDateTime)` โดยล็อกแถวรถระหว่าง transaction เพื่อกันจองซ้อนจากคำขอพร้อมกัน หากขัดแย้งคืน HTTP 409 และ rollback บัญชีที่สมัครพร้อมจองด้วย
- Frontend proxy `/api/auth/:action`, `/api/bookings`, `/api/bookings/calculate` ส่งต่อ cookie ให้ Backend และคง Set-Cookie หลายค่า พร้อมตรวจ origin และไม่ cache session

## ทดสอบ

```powershell
npm run build
npm test
npm run prisma:seed:check

# Integration tests ใช้ PostgreSQL ที่ migrate + seed แล้ว
# สร้างบัญชีและรายการจองเฉพาะการทดสอบ จากนั้นลบข้อมูลทดสอบเหล่านั้น
$env:AUTH_TEST_DATABASE_URL = '<connection URL ของฐานข้อมูลสำหรับทดสอบ>'
npm test
```

หากไม่ตั้ง `AUTH_TEST_DATABASE_URL` จะรัน unit tests และ skip integration suite ครอบคลุม registration, login จริงผ่าน Auth.js, CSRF, session cookie, สิทธิ์ admin, บัญชี inactive, การเปลี่ยนรหัสผ่าน/ยกเลิก session, logout, rate limit และสมัครพร้อมจอง

เอกสารอ้างอิง: [Auth.js Express](https://authjs.dev/reference/express), [Credentials provider](https://authjs.dev/getting-started/authentication/credentials) ปัจจุบัน `@auth/express` ระบุสถานะ experimental ในเอกสารทางการ
