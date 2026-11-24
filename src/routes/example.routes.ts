import { Router } from "express";
import { databasePool, queryOne, queryRows } from "../lib/db.js";
import { requireAdmin } from "../middleware/auth.js";
import type { BookingStatus } from "../lib/db-types.js";

type Booking = {
  id: string;
  bookingNumber: string;
  carId: string;
  userId: string;
  status: BookingStatus;
  startDateTime: Date;
  endDateTime: Date;
  totalPrice: string;
  currencyCode: string;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
};

const router = Router();

router.get("/", requireAdmin, async (_req, res, next) => {
  try {
    const bookings = await queryRows<Booking>(
      databasePool(),
      'SELECT * FROM bookings ORDER BY "createdAt" DESC LIMIT 100',
    );
    res.json({ success: true, data: bookings, count: bookings.length });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const booking = await queryOne<Booking>(
      databasePool(),
      "SELECT * FROM bookings WHERE id = $1",
      [id],
    );
    if (!booking) {
      res.status(404).json({ success: false, message: "Booking not found" });
      return;
    }
    res.json({ success: true, data: booking });
  } catch (error) {
    next(error);
  }
});

export default router;
