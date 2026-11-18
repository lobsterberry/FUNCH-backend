import { createHash } from 'node:crypto';
import { BookingSource, BookingStatus, CarCategory, DrivingSide, Prisma, SteeringSide, TransmissionType } from '@prisma/client';

// All prices are THB, matching the wireframes. Local currency is metadata only;
// this dataset intentionally does not invent exchange rates.
export const countries = [
  { code: 'JP', name: 'Japan', nameTh: 'ญี่ปุ่น', flag: '🇯🇵', currencyCode: 'JPY', drivingSide: DrivingSide.LEFT },
  { code: 'TH', name: 'Thailand', nameTh: 'ไทย', flag: '🇹🇭', currencyCode: 'THB', drivingSide: DrivingSide.LEFT },
  { code: 'DE', name: 'Germany', nameTh: 'เยอรมนี', flag: '🇩🇪', currencyCode: 'EUR', drivingSide: DrivingSide.RIGHT },
  { code: 'GB', name: 'United Kingdom', nameTh: 'สหราชอาณาจักร', flag: '🇬🇧', currencyCode: 'GBP', drivingSide: DrivingSide.LEFT },
  { code: 'US', name: 'United States', nameTh: 'สหรัฐอเมริกา', flag: '🇺🇸', currencyCode: 'USD', drivingSide: DrivingSide.RIGHT },
  { code: 'SG', name: 'Singapore', nameTh: 'สิงคโปร์', flag: '🇸🇬', currencyCode: 'SGD', drivingSide: DrivingSide.LEFT },
] satisfies Prisma.CountryCreateManyInput[];

export const locations = [
  { id: 'seed-location-haneda', name: 'Haneda Airport', nameTh: 'สนามบินฮาเนดะ', city: 'Tokyo', cityTh: 'โตเกียว', countryCode: 'JP', timeZone: 'Asia/Tokyo', airportCode: 'HND' },
  { id: 'seed-location-narita', name: 'Narita Airport', nameTh: 'สนามบินนาริตะ', city: 'Tokyo', cityTh: 'โตเกียว', countryCode: 'JP', timeZone: 'Asia/Tokyo', airportCode: 'NRT' },
  { id: 'seed-location-shinjuku', name: 'Shinjuku Station', nameTh: 'สถานีชินจูกุ', city: 'Tokyo', cityTh: 'โตเกียว', countryCode: 'JP', timeZone: 'Asia/Tokyo', airportCode: null },
  { id: 'seed-location-tokyo-station', name: 'Tokyo Station', nameTh: 'สถานีโตเกียว', city: 'Tokyo', cityTh: 'โตเกียว', countryCode: 'JP', timeZone: 'Asia/Tokyo', airportCode: null },
  { id: 'seed-location-kansai', name: 'Kansai International Airport', nameTh: 'สนามบินคันไซ', city: 'Osaka', cityTh: 'โอซาก้า', countryCode: 'JP', timeZone: 'Asia/Tokyo', airportCode: 'KIX' },
  { id: 'seed-location-fukuoka', name: 'Fukuoka Airport', nameTh: 'สนามบินฟุกุโอกะ', city: 'Fukuoka', cityTh: 'ฟุกุโอกะ', countryCode: 'JP', timeZone: 'Asia/Tokyo', airportCode: 'FUK' },
  { id: 'seed-location-chitose', name: 'New Chitose Airport', nameTh: 'สนามบินนิวชิโตเสะ', city: 'Hokkaido', cityTh: 'ฮอกไกโด', countryCode: 'JP', timeZone: 'Asia/Tokyo', airportCode: 'CTS' },
  { id: 'seed-location-bangkok', name: 'Suvarnabhumi Airport', nameTh: 'สนามบินสุวรรณภูมิ', city: 'Bangkok', cityTh: 'กรุงเทพฯ', countryCode: 'TH', timeZone: 'Asia/Bangkok', airportCode: 'BKK' },
  { id: 'seed-location-phuket', name: 'Phuket International Airport', nameTh: 'สนามบินภูเก็ต', city: 'Phuket', cityTh: 'ภูเก็ต', countryCode: 'TH', timeZone: 'Asia/Bangkok', airportCode: 'HKT' },
  { id: 'seed-location-frankfurt', name: 'Frankfurt Airport', nameTh: 'สนามบินแฟรงก์เฟิร์ต', city: 'Frankfurt', cityTh: 'แฟรงก์เฟิร์ต', countryCode: 'DE', timeZone: 'Europe/Berlin', airportCode: 'FRA' },
  { id: 'seed-location-heathrow', name: 'Heathrow Airport', nameTh: 'สนามบินฮีทโธรว์', city: 'London', cityTh: 'ลอนดอน', countryCode: 'GB', timeZone: 'Europe/London', airportCode: 'LHR' },
  { id: 'seed-location-los-angeles', name: 'Los Angeles International Airport', nameTh: 'สนามบินลอสแอนเจลิส', city: 'Los Angeles', cityTh: 'ลอสแอนเจลิส', countryCode: 'US', timeZone: 'America/Los_Angeles', airportCode: 'LAX' },
  { id: 'seed-location-changi', name: 'Changi Airport', nameTh: 'สนามบินชางงี', city: 'Singapore', cityTh: 'สิงคโปร์', countryCode: 'SG', timeZone: 'Asia/Singapore', airportCode: 'SIN' },
] satisfies Prisma.LocationCreateManyInput[];

export const featureLabels = {
  GPS_EN: 'ระบบนำทาง GPS รองรับภาษาอังกฤษ',
  CARPLAY_ANDROID_AUTO: 'Apple CarPlay / Android Auto',
  CAMERA_360: 'กล้องมองรอบทิศทาง 360°',
  ETC_CARD: 'บัตรทางด่วน ETC ฟรี',
  ETC_READER: 'เครื่องอ่านบัตรทางด่วน ETC',
  BASIC_INSURANCE: 'รวมประกันภัยพื้นฐาน',
  ZERO_EXCESS_INSURANCE: 'ประกันชั้น 1 ไม่มีค่าเสียหายส่วนแรก',
  CHILD_SEAT: 'เบาะเด็กฟรี',
  PROPILOT: 'ProPILOT 2.0',
  POWER_SLIDING_DOORS: 'ประตูสไลด์ไฟฟ้าอัตโนมัติ',
  AUTOPILOT: 'Autopilot',
  FREE_SUPERCHARGING: 'ฟรีชาร์จ Supercharger',
  TOUCHSCREEN: 'จอทัชสกรีน 15.4 นิ้ว',
  SAFETY_SENSE: 'Toyota Safety Sense',
  REAR_CAMERA: 'กล้องมองหลัง',
  HONDA_SENSING: 'Honda SENSING',
  EFFICIENT_278: 'ประหยัดน้ำมัน 27.8 กม./ลิตร',
  VIGNETTE: 'รวมค่าทางด่วน Vignette',
  EUROPE_NAV: 'ระบบนำทางยุโรป',
  M_SPORT: 'M Sport Package',
  HARMAN_KARDON: 'Harman Kardon',
  PANORAMIC_ROOF: 'หลังคาพาโนรามา',
  WIRELESS_CHARGER: 'Wireless Charger',
} as const;

type FeatureCode = keyof typeof featureLabels;
type CarSpec = {
  id: string; brand: string; model: string; location: string;
  hourlyRate: number; dailyRate: number; categories: CarCategory[];
  features?: FeatureCode[]; seats?: number; luggageCapacity?: number;
  fuelType?: string; transmission?: string; transmissionType?: TransmissionType;
  description?: string; providerName?: string; categoryLabel?: string;
  rating?: number; reviewCount?: number; badge?: string;
  featuredOrder?: number; recommendationOrder?: number; isAvailable?: boolean;
};

const demoExteriorColors = ['ขาวมุก', 'ดำ', 'เงิน', 'เทาเข้ม', 'น้ำเงิน', 'แดง', 'เขียวเข้ม'];

export function demoVehicleDetails(id: string) {
  const hash = createHash('sha256').update(id).digest('hex');
  const sample = Number.parseInt(hash.slice(-8), 16);
  return {
    exteriorColor: demoExteriorColors[sample % demoExteriorColors.length],
    vin: `FUNCH${hash.slice(0, 12).toUpperCase()}`,
    odometerKm: 8_000 + (sample % 48_000),
  };
}

function car(spec: CarSpec, index: number) {
  const id = `seed-car-${spec.id}`;
  const location = locations.find((item) => item.id === `seed-location-${spec.location}`)!;
  const country = countries.find((item) => item.code === location.countryCode)!;
  const features = spec.features ?? ['GPS_EN', 'CARPLAY_ANDROID_AUTO', 'BASIC_INSURANCE'];
  return {
    id, brand: spec.brand, model: spec.model, year: 2024,
    ...demoVehicleDetails(id),
    licensePlate: `DEMO-${country.code}-${String(index + 1).padStart(3, '0')}`,
    country: country.code, locationId: location.id,
    hourlyRate: spec.hourlyRate, dailyRate: spec.dailyRate, currencyCode: 'THB',
    categories: spec.categories, categoryLabel: spec.categoryLabel ?? spec.categories[0],
    steeringSide: country.drivingSide === DrivingSide.LEFT ? SteeringSide.RHD : SteeringSide.LHD,
    seats: spec.seats ?? 5, luggageCapacity: spec.luggageCapacity ?? 3,
    fuelType: spec.fuelType ?? 'Hybrid', transmission: spec.transmission ?? 'E-CVT',
    transmissionType: spec.transmissionType ?? TransmissionType.AUTOMATIC,
    description: spec.description ?? `${spec.brand} ${spec.model} สำหรับการเดินทางใน${location.cityTh}`,
    providerName: spec.providerName ?? `FUNCH ${location.city} Demo Rental`,
    featureCodes: features, options: features.map((code) => ({ code, label: featureLabels[code], included: true })),
    rating: spec.rating ?? 4.7, reviewCount: spec.reviewCount ?? 24,
    badge: spec.badge ?? null, isFeatured: spec.featuredOrder !== undefined,
    recommendationOrder: spec.featuredOrder ?? spec.recommendationOrder ?? 100 + index,
    isAvailable: spec.isAvailable ?? true,
    createdAt: new Date('2026-10-01T00:00:00Z'),
  } satisfies Prisma.CarUncheckedCreateInput;
}

// The first four rows reproduce search.html. The six featured rows reproduce index.html.
const carSpecs: CarSpec[] = [
  { id: 'tokyo-harrier', brand: 'Toyota', model: 'Harrier Hybrid 2.5', location: 'haneda', hourlyRate: 280, dailyRate: 2200, categories: ['SUV'], categoryLabel: 'SUV Premium', rating: 4.9, reviewCount: 142, featuredOrder: 1, providerName: 'Times Car Rental Haneda', transmission: 'Automatic E-Four', badge: 'อนุมัติไว ไม่ต้องรอนาน', description: 'เครื่องยนต์ไฮบริด 2.5L นั่งสบาย พื้นที่เก็บสัมภาระกว้างขวาง', features: ['GPS_EN', 'CARPLAY_ANDROID_AUTO', 'CAMERA_360', 'ETC_READER', 'BASIC_INSURANCE', 'ZERO_EXCESS_INSURANCE'] },
  { id: 'tokyo-serena', brand: 'Nissan', model: 'Serena e-POWER Highway Star', location: 'haneda', hourlyRate: 320, dailyRate: 2600, categories: ['MPV'], seats: 8, luggageCapacity: 4, rating: 4.88, reviewCount: 96, recommendationOrder: 2, providerName: 'Orix Rent-A-Car Tokyo', transmission: 'Automatic e-POWER', description: 'รถตู้ครอบครัว 7-8 ที่นั่ง ประตูสไลด์ไฟฟ้าคู่', features: ['PROPILOT', 'POWER_SLIDING_DOORS', 'CHILD_SEAT', 'BASIC_INSURANCE'] },
  { id: 'tokyo-model3', brand: 'Tesla', model: 'Model 3 Highland Long Range', location: 'haneda', hourlyRate: 390, dailyRate: 3100, categories: ['SEDAN', 'EV'], fuelType: 'EV', transmission: 'Automatic AWD', rating: 4.96, reviewCount: 180, recommendationOrder: 3, providerName: 'EV Car Rental Tokyo', description: 'ชาร์จเต็มวิ่งไกล 629 กม. เทคโนโลยีล้ำสมัย ขับขี่เงียบสบาย', features: ['AUTOPILOT', 'FREE_SUPERCHARGING', 'TOUCHSCREEN', 'ZERO_EXCESS_INSURANCE'] },
  { id: 'tokyo-corolla-cross', brand: 'Toyota', model: 'Corolla Cross Hybrid', location: 'haneda', hourlyRate: 220, dailyRate: 1800, categories: ['SUV', 'ECO'], rating: 4.85, reviewCount: 115, recommendationOrder: 4, providerName: 'Nippon Rent-A-Car', description: 'คล่องตัวในเมือง ประหยัดน้ำมัน 24 กม./ลิตร พร้อมระบบความปลอดภัยครบ', features: ['SAFETY_SENSE', 'CARPLAY_ANDROID_AUTO', 'REAR_CAMERA', 'BASIC_INSURANCE'] },
  { id: 'tokyo-rav4', brand: 'Toyota', model: 'RAV4 Hybrid', location: 'haneda', hourlyRate: 270, dailyRate: 2100, categories: ['SUV'], features: ['GPS_EN', 'CARPLAY_ANDROID_AUTO', 'ETC_CARD', 'CAMERA_360', 'ZERO_EXCESS_INSURANCE'] },
  { id: 'tokyo-cx5', brand: 'Mazda', model: 'CX-5', location: 'haneda', hourlyRate: 260, dailyRate: 2000, categories: ['SUV'], fuelType: 'Diesel', transmission: 'Automatic 6-Speed' },
  { id: 'tokyo-forester', brand: 'Subaru', model: 'Forester', location: 'haneda', hourlyRate: 290, dailyRate: 2300, categories: ['SUV'], fuelType: 'Gasoline', transmission: 'Lineartronic CVT' },
  { id: 'tokyo-xtrail', brand: 'Nissan', model: 'X-Trail e-POWER', location: 'haneda', hourlyRate: 300, dailyRate: 2400, categories: ['SUV'], transmission: 'Automatic e-4ORCE', features: ['GPS_EN', 'CARPLAY_ANDROID_AUTO', 'ETC_CARD', 'BASIC_INSURANCE'] },
  { id: 'tokyo-prius', brand: 'Toyota', model: 'Prius HEV', location: 'haneda', hourlyRate: 200, dailyRate: 1600, categories: ['SEDAN', 'ECO'], features: ['GPS_EN', 'CARPLAY_ANDROID_AUTO', 'ETC_CARD', 'BASIC_INSURANCE'] },
  { id: 'tokyo-camry', brand: 'Toyota', model: 'Camry Hybrid', location: 'haneda', hourlyRate: 280, dailyRate: 2200, categories: ['SEDAN'] },
  { id: 'tokyo-civic', brand: 'Honda', model: 'Civic e:HEV', location: 'haneda', hourlyRate: 250, dailyRate: 1900, categories: ['SEDAN', 'ECO'] },
  { id: 'tokyo-mazda3', brand: 'Mazda', model: '3 Skyactiv', location: 'haneda', hourlyRate: 210, dailyRate: 1700, categories: ['SEDAN'], fuelType: 'Gasoline', transmission: 'Automatic 6-Speed' },
  { id: 'tokyo-voxy', brand: 'Toyota', model: 'Voxy Hybrid', location: 'haneda', hourlyRate: 300, dailyRate: 2400, categories: ['MPV'], seats: 7, luggageCapacity: 4, features: ['GPS_EN', 'POWER_SLIDING_DOORS', 'CHILD_SEAT', 'BASIC_INSURANCE'] },
  { id: 'tokyo-alphard', brand: 'Toyota', model: 'Alphard Executive Lounge', location: 'haneda', hourlyRate: 650, dailyRate: 5200, categories: ['MPV', 'LUXURY'], seats: 7, luggageCapacity: 5, features: ['GPS_EN', 'CAMERA_360', 'POWER_SLIDING_DOORS', 'ZERO_EXCESS_INSURANCE'] },
  { id: 'tokyo-fit', brand: 'Honda', model: 'Fit e:HEV', location: 'haneda', hourlyRate: 130, dailyRate: 1000, categories: ['ECO'], luggageCapacity: 2 },
  { id: 'tokyo-note', brand: 'Nissan', model: 'Note e-POWER', location: 'haneda', hourlyRate: 140, dailyRate: 1100, categories: ['ECO'], luggageCapacity: 2 },
  { id: 'tokyo-swift', brand: 'Suzuki', model: 'Swift Sport', location: 'haneda', hourlyRate: 150, dailyRate: 1200, categories: ['ECO'], fuelType: 'Gasoline', transmission: 'Manual 6-Speed', transmissionType: TransmissionType.MANUAL, luggageCapacity: 2 },
  { id: 'tokyo-leaf', brand: 'Nissan', model: 'Leaf e+', location: 'haneda', hourlyRate: 230, dailyRate: 1800, categories: ['EV', 'ECO'], fuelType: 'EV', transmission: 'Automatic Single-Speed' },
  { id: 'bangkok-city', brand: 'Honda', model: 'City e:HEV RS', location: 'bangkok', hourlyRate: 150, dailyRate: 1200, categories: ['SEDAN', 'ECO'], categoryLabel: 'Eco Sedan', rating: 4.8, reviewCount: 98, featuredOrder: 2, badge: 'ยอดนิยมในไทย', luggageCapacity: 2, description: 'คล่องตัว ขับง่ายในเมือง พร้อม Honda SENSING ครบครัน', features: ['HONDA_SENSING', 'EFFICIENT_278', 'GPS_EN', 'BASIC_INSURANCE'] },
  { id: 'frankfurt-modely', brand: 'Tesla', model: 'Model Y Long Range', location: 'frankfurt', hourlyRate: 420, dailyRate: 3400, categories: ['SUV', 'EV'], categoryLabel: 'EV 100%', fuelType: 'EV', transmission: 'Automatic AWD', rating: 4.95, reviewCount: 210, featuredOrder: 3, badge: 'ชาร์จฟรี Supercharger', luggageCapacity: 4, description: 'ระยะทาง 533 กม./ชาร์จ ขับบน Autobahn สบายด้วย Autopilot', features: ['AUTOPILOT', 'FREE_SUPERCHARGING', 'VIGNETTE', 'EUROPE_NAV', 'BASIC_INSURANCE'] },
  { id: 'osaka-serena', brand: 'Nissan', model: 'Serena e-POWER (7 Seats)', location: 'kansai', hourlyRate: 320, dailyRate: 2600, categories: ['MPV'], categoryLabel: 'Family 7 ที่นั่ง', seats: 7, luggageCapacity: 5, rating: 4.88, reviewCount: 160, featuredOrder: 4, transmission: 'Automatic e-POWER', badge: 'ประตูสไลด์ไฟฟ้า', description: 'เหมาะสำหรับครอบครัว เดินทางพร้อมสัมภาระขนาดใหญ่', features: ['PROPILOT', 'POWER_SLIDING_DOORS', 'ETC_CARD', 'CHILD_SEAT', 'BASIC_INSURANCE'] },
  { id: 'london-bmw', brand: 'BMW', model: '320d M Sport Touring', location: 'heathrow', hourlyRate: 510, dailyRate: 4100, categories: ['WAGON', 'LUXURY'], categoryLabel: 'Luxury Wagon', fuelType: 'Diesel', transmission: 'Steptronic 8-Speed', rating: 4.92, reviewCount: 85, featuredOrder: 5, badge: 'พรีเมียมคลาส', description: 'สมรรถนะยอดเยี่ยม เดินทางในชนบทอังกฤษได้อย่างคล่องตัว', features: ['M_SPORT', 'HARMAN_KARDON', 'EUROPE_NAV', 'BASIC_INSURANCE'] },
  { id: 'phuket-yaris-cross', brand: 'Toyota', model: 'Yaris Cross HEV Premium', location: 'phuket', hourlyRate: 190, dailyRate: 1500, categories: ['SUV', 'ECO'], categoryLabel: 'Compact Crossover', rating: 4.87, reviewCount: 104, featuredOrder: 6, badge: 'พร้อมส่งที่สนามบิน', description: 'ยกสูงทัศนวิสัยดี ประหยัดน้ำมัน ขับขึ้นเขาลงเกาะได้สบาย', features: ['PANORAMIC_ROOF', 'SAFETY_SENSE', 'WIRELESS_CHARGER', 'BASIC_INSURANCE'] },
  { id: 'fukuoka-yaris', brand: 'Toyota', model: 'Yaris Hybrid', location: 'fukuoka', hourlyRate: 130, dailyRate: 1000, categories: ['ECO'], luggageCapacity: 2 },
  { id: 'hokkaido-rav4', brand: 'Toyota', model: 'RAV4 Adventure AWD', location: 'chitose', hourlyRate: 280, dailyRate: 2200, categories: ['SUV'], fuelType: 'Gasoline', transmission: 'Automatic AWD' },
  { id: 'la-model3', brand: 'Tesla', model: 'Model 3 Long Range', location: 'los-angeles', hourlyRate: 400, dailyRate: 3200, categories: ['SEDAN', 'EV'], fuelType: 'EV', transmission: 'Automatic AWD', features: ['AUTOPILOT', 'GPS_EN', 'BASIC_INSURANCE'] },
  { id: 'singapore-sienta', brand: 'Toyota', model: 'Sienta Hybrid', location: 'changi', hourlyRate: 260, dailyRate: 2100, categories: ['MPV'], seats: 7, features: ['GPS_EN', 'CHILD_SEAT', 'POWER_SLIDING_DOORS', 'BASIC_INSURANCE'] },
  { id: 'bangkok-maintenance', brand: 'Toyota', model: 'Commuter', location: 'bangkok', hourlyRate: 350, dailyRate: 2800, categories: ['MPV'], seats: 12, luggageCapacity: 6, fuelType: 'Diesel', transmission: 'Manual 5-Speed', transmissionType: TransmissionType.MANUAL, isAvailable: false, badge: 'อยู่ระหว่างบำรุงรักษา' },
];

export const cars = carSpecs.map(car);

export const users = [
  { id: 'seed-user-admin', email: 'admin@funch.example', name: 'FUNCH Admin', firstName: 'FUNCH', lastName: 'Admin', phoneNumber: '+66000000001', role: 'ADMIN', isActive: true },
  { id: 'seed-user-somchai', email: 'somchai@funch.example', name: 'สมชาย ใจดี (Somchai Jaidee)', firstName: 'Somchai', lastName: 'Jaidee', phoneNumber: '+66000000002', role: 'USER', isActive: true },
  { id: 'seed-user-emily', email: 'emily@funch.example', name: 'Emily Carter', firstName: 'Emily', lastName: 'Carter', phoneNumber: '+440000000003', role: 'USER', isActive: true },
  { id: 'seed-user-new-member', email: 'new.member@funch.example', name: 'Narin Suksan', firstName: 'Narin', lastName: 'Suksan', phoneNumber: '+66000000004', role: 'USER', isActive: true },
  { id: 'seed-user-inactive', email: 'inactive@funch.example', name: 'Inactive Demo Member', firstName: 'Inactive', lastName: 'Member', phoneNumber: null, role: 'USER', isActive: false },
] satisfies Omit<Prisma.UserCreateManyInput, 'password'>[];

// Explicit expected allocations are fixtures from the assignment, not calculated
// by the current API's server-local pricing helper. Dates include destination offsets.
export const pricingExamples = [
  { key: 'two-hours', start: '2026-11-20T10:00:00+09:00', end: '2026-11-20T12:00:00+09:00', days: 0, hours: 2, total: 560, reason: '10:00–12:00 = 2 ชั่วโมง' },
  { key: 'exact-cutoff', start: '2026-11-20T10:00:00+09:00', end: '2026-11-20T14:00:00+09:00', days: 0, hours: 4, total: 1120, reason: 'คืนตรง 14:00 ยังไม่เกินเวลาตัดรอบ' },
  { key: 'after-cutoff', start: '2026-11-20T10:00:00+09:00', end: '2026-11-20T15:00:00+09:00', days: 1, hours: 0, total: 2200, reason: '10:00–15:00 = 1 วัน' },
  { key: 'eight-hours', start: '2026-11-20T06:00:00+09:00', end: '2026-11-20T14:00:00+09:00', days: 0, hours: 8, total: 2240, reason: 'ครบ 8 ชั่วโมง ยังไม่เกิน 8 ชั่วโมง (ไม่มีการ cap ราคาที่โจทย์ไม่ได้ระบุ)' },
  { key: 'over-eight-hours', start: '2026-11-20T04:00:00+09:00', end: '2026-11-20T13:00:00+09:00', days: 1, hours: 0, total: 2200, reason: 'เกิน 8 ชั่วโมง แม้คืนก่อน 14:00 = 1 วัน' },
  { key: 'next-day-hour', start: '2026-11-20T10:00:00+09:00', end: '2026-11-21T11:00:00+09:00', days: 1, hours: 1, total: 2480, reason: 'รับ 10:00 คืน 11:00 วันถัดไป = 1 วัน 1 ชั่วโมง' },
  { key: 'wireframe-trip', start: '2026-11-20T10:00:00+09:00', end: '2026-11-22T15:00:00+09:00', days: 3, hours: 0, total: 6600, reason: 'ทริปใน wireframe 2 วัน 5 ชั่วโมง คิดเป็น 3 วันเต็ม' },
] as const;

type BookingSpec = {
  number: string; car: string; user: string; start: string; end: string;
  days: number; hours: number; status: BookingStatus; reason: string;
  source?: BookingSource; dropoff?: string; note?: string;
};

const bookingSpecs: BookingSpec[] = [
  { number: 'FUNCH-DEMO-001', car: 'tokyo-harrier', user: 'somchai', start: '2026-11-24T10:00:00+09:00', end: '2026-11-26T15:00:00+09:00', days: 3, hours: 0, status: 'PENDING', reason: 'คืนหลัง 14:00 คิดเป็น 3 วันเต็ม' },
  { number: 'FUNCH-DEMO-002', car: 'tokyo-serena', user: 'new-member', start: '2026-11-27T10:00:00+09:00', end: '2026-11-29T15:00:00+09:00', days: 3, hours: 0, status: 'PENDING', source: 'REGISTER_AND_BOOK', reason: 'สมาชิกใหม่พร้อมจอง รอแอดมินอนุมัติ' },
  { number: 'FUNCH-DEMO-003', car: 'tokyo-model3', user: 'emily', start: '2026-11-27T10:00:00+09:00', end: '2026-11-28T11:00:00+09:00', days: 1, hours: 1, status: 'APPROVED', reason: '1 วัน 1 ชั่วโมง', note: 'ตรวจสอบเอกสารแล้ว อนุมัติโดยแอดมิน' },
  { number: 'FUNCH-DEMO-004', car: 'bangkok-city', user: 'somchai', start: '2026-11-10T10:00:00+07:00', end: '2026-11-10T12:00:00+07:00', days: 0, hours: 2, status: 'COMPLETED', reason: '10:00–12:00 = 2 ชั่วโมง', note: 'คืนรถเรียบร้อย' },
  { number: 'FUNCH-DEMO-005', car: 'phuket-yaris-cross', user: 'new-member', start: '2026-11-28T10:00:00+07:00', end: '2026-11-28T15:00:00+07:00', days: 1, hours: 0, status: 'REJECTED', source: 'REGISTER_AND_BOOK', reason: 'คืนเกิน 14:00 = 1 วัน', note: 'ข้อมูลใบขับขี่ไม่ครบถ้วน' },
  { number: 'FUNCH-DEMO-006', car: 'london-bmw', user: 'emily', start: '2026-11-28T10:00:00+00:00', end: '2026-11-29T11:00:00+00:00', days: 1, hours: 1, status: 'CANCELLED', reason: '1 วัน 1 ชั่วโมง', note: 'ลูกค้ายกเลิกก่อนการอนุมัติ' },
  { number: 'FUNCH-DEMO-007', car: 'frankfurt-modely', user: 'emily', start: '2026-11-05T04:00:00+01:00', end: '2026-11-05T13:00:00+01:00', days: 1, hours: 0, status: 'COMPLETED', reason: '9 ชั่วโมง = 1 วัน แม้คืนก่อน 14:00', note: 'คืนรถเรียบร้อย' },
  { number: 'FUNCH-DEMO-008', car: 'la-model3', user: 'emily', start: '2026-11-30T10:00:00-08:00', end: '2026-11-30T15:00:00-08:00', days: 1, hours: 0, status: 'APPROVED', reason: 'ใช้เวลา 15:00 ของ Los Angeles สำหรับกฎตัดรอบ', note: 'ตรวจสอบใบขับขี่แล้ว' },
  { number: 'FUNCH-DEMO-009', car: 'singapore-sienta', user: 'somchai', start: '2026-12-01T10:00:00+08:00', end: '2026-12-01T14:00:00+08:00', days: 0, hours: 4, status: 'PENDING', reason: 'คืนตรง 14:00 ยังคิดรายชั่วโมง' },
  { number: 'FUNCH-DEMO-010', car: 'tokyo-harrier', user: 'somchai', start: '2026-11-01T10:00:00+09:00', end: '2026-11-03T15:00:00+09:00', days: 3, hours: 0, status: 'COMPLETED', reason: 'ทริป 2 วัน 5 ชั่วโมง คิด 3 วันเต็ม', note: 'คืนรถเรียบร้อย' },
  { number: 'FUNCH-DEMO-011', car: 'tokyo-corolla-cross', user: 'somchai', start: '2026-12-02T10:00:00+09:00', end: '2026-12-02T12:00:00+09:00', days: 0, hours: 2, status: 'PENDING', reason: 'ตัวอย่างรับและคืนต่างสถานที่ในเมืองเดียวกัน', dropoff: 'tokyo-station' },
];

export const bookings: Prisma.BookingUncheckedCreateInput[] = bookingSpecs.map((spec) => {
  const vehicle = cars.find((item) => item.id === `seed-car-${spec.car}`)!;
  const location = locations.find((item) => item.id === vehicle.locationId)!;
  const reviewed = ['APPROVED', 'REJECTED', 'COMPLETED'].includes(spec.status);
  const hourlyRate = Number(vehicle.hourlyRate);
  const dailyRate = Number(vehicle.dailyRate);
  const totalPrice = spec.days * dailyRate + spec.hours * hourlyRate;
  const startDateTime = new Date(spec.start);
  const createdAt = new Date(Math.min(startDateTime.getTime() - 86400000 * 7, Date.parse('2026-11-16T03:00:00Z')));
  return {
    id: `seed-booking-${spec.number}`, bookingNumber: spec.number,
    userId: `seed-user-${spec.user}`, carId: vehicle.id!,
    startDateTime, endDateTime: new Date(spec.end),
    calculatedDays: spec.days, calculatedHours: spec.hours, totalPrice,
    hourlyRate, dailyRate, currencyCode: 'THB', timeZone: location.timeZone,
    pickupLocationId: location.id, dropoffLocationId: spec.dropoff ? `seed-location-${spec.dropoff}` : location.id,
    driverName: users.find((item) => item.id === `seed-user-${spec.user}`)!.name,
    internationalDrivingPermit: spec.user === 'somchai' ? 'IDP-TH-2026-9842' : 'IDP-DEMO-2026-0001',
    source: spec.source ?? BookingSource.EXISTING_MEMBER,
    pricingDetails: {
      reason: spec.reason, timeZone: location.timeZone, currencyCode: 'THB',
      startLocal: spec.start, endLocal: spec.end, hourlyRate, dailyRate,
      days: spec.days, hours: spec.hours, totalPrice,
      hourlyThreshold: 8, returnCutoffLocal: '14:00',
    },
    status: spec.status, approvedById: reviewed ? 'seed-user-admin' : null,
    reviewedAt: reviewed ? new Date(createdAt.getTime() + 900000) : null,
    adminNote: spec.note ?? null, createdAt,
  };
});
