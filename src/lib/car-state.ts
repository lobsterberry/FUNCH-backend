import type { VehicleStatus } from "@prisma/client";

type UnitState = {
  isAvailable: boolean;
  operationalStatus: VehicleStatus;
  availableFrom: Date | null;
  locationId: string | null;
  bookings: { status: string; startDateTime: Date; endDateTime: Date }[];
};

export function carState(car: UnitState, now = new Date()) {
  const bookings = car.bookings.filter((booking) =>
    ["PENDING", "APPROVED"].includes(booking.status),
  );
  const overdue = bookings.some((booking) => booking.endDateTime <= now);
  const rentalStatus = bookings.some((booking) => booking.startDateTime <= now)
    ? "IN_USE"
    : bookings.length
      ? "RESERVED"
      : "IDLE";
  const inventoryStatus =
    car.operationalStatus !== "AVAILABLE"
      ? car.operationalStatus
      : !car.isAvailable
        ? "INACTIVE"
        : overdue
          ? "OVERDUE"
          : rentalStatus !== "IDLE"
            ? rentalStatus
            : car.availableFrom && car.availableFrom > now
              ? "CLEANING"
              : !car.locationId
                ? "UNASSIGNED"
                : "AVAILABLE";
  return {
    rentalStatus,
    inventoryStatus,
    overdue,
    hasBookings: bookings.length > 0,
  };
}

// Old clients can still send just the service flag without losing an existing reason.
export function resolveOperationalStatus(
  isAvailable: boolean,
  status?: VehicleStatus,
  previous?: VehicleStatus,
): VehicleStatus {
  return (
    status ??
    (isAvailable
      ? "AVAILABLE"
      : previous && previous !== "AVAILABLE"
        ? previous
        : "INACTIVE")
  );
}
