/**
 * Pricing Rules ตาม Assignment.md:
 * 1. แบ่งเป็นรายชั่วโมง และรายวัน
 * 2. หากนับเวลาใช้งานเกิน 8 ชั่วโมง จะนับเป็น 1 วัน
 * 3. หากเวลานำส่งรถคืนเกินเวลา 14:00 น. จะนับค่าบริการของวันนั้นเท่ากับ 1 วันทันที (เช่น 10.00 - 15.00 เท่ากับ 1 วัน)
 * 4. เมื่อใช้งานเกิน 8 ชั่วโมง แล้วนับเป็น 1 วันแล้ว จะเริ่มนับรายชั่วโมงอีกครั้งเมื่อถึงเวลารับรถของอีกวัน
 *    (เช่น เช่า 10 โมง คืน 11 โมงของอีกวัน = 1 วัน 1 ชั่วโมง)
 */

export interface PricingInput {
  startDateTime: Date | string;
  endDateTime: Date | string;
  hourlyRate: number;
  dailyRate: number;
  timeZone?: string;
}

export interface PricingResult {
  days: number;
  hours: number;
  totalPrice: number;
  breakdown: string;
}

export function calculateCarRentalPrice(input: PricingInput): PricingResult {
  const start = new Date(input.startDateTime);
  const end = new Date(input.endDateTime);

  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start
  ) {
    throw new Error("End date/time must be after start date/time");
  }

  const diffMs = end.getTime() - start.getTime();
  const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));

  let days = 0;
  let hours = 0;

  const clock = (value: Date) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: input.timeZone || "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(value)
        .map(({ type, value }) => [type, value]),
    );
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      hour: Number(parts.hour) + Number(parts.minute) / 60,
    };
  };
  const localStart = clock(start);
  const localEnd = clock(end);
  // Apply the 14:00 rule at the pickup location, independent of server timezone.
  const isSameDay = localStart.date === localEnd.date;

  if (isSameDay) {
    const endHour = localEnd.hour;
    // Rule: คืนเกิน 14.00 น. หรือ เกิน 8 ชม. นับเป็น 1 วัน
    if (endHour > 14 || diffHours > 8) {
      days = 1;
      hours = 0;
    } else {
      days = 0;
      hours = diffHours;
    }
  } else {
    // ข้ามวัน: คำนวณจำนวนรอบวัน (24 ชม. ต่อวันนับจากเวลารับรถ)
    const fullDays = Math.floor(diffHours / 24);
    const remainingHours = diffHours % 24;

    days = fullDays;

    // ตรวจสอบเศษชั่วโมงที่เหลือหลังจากรอบวันรับรถ
    if (remainingHours > 8) {
      days += 1;
      hours = 0;
    } else {
      // ตรวจสอบเวลาคืนในวันสุดท้าย ถ้าเกิน 14.00 น. นับเป็น 1 วัน
      const endHour = localEnd.hour;
      if (endHour > 14 && remainingHours > 0) {
        days += 1;
        hours = 0;
      } else {
        hours = remainingHours;
      }
    }
  }

  // คำนวณราคารวม (หากคิดแบบรายชั่วโมงแล้วแพงกว่ารายวัน ให้ capped ที่ราคารายวัน)
  const hourCost = Math.min(hours * input.hourlyRate, input.dailyRate);
  const totalPrice = days * input.dailyRate + hourCost;

  return {
    days,
    hours,
    totalPrice,
    breakdown: `${days} วัน (${days * input.dailyRate} บาท) + ${hours} ชั่วโมง (${hourCost} บาท) = ${totalPrice} บาท`,
  };
}
