export type Role = "USER" | "ADMIN";

export const bookingStatuses = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "COMPLETED",
] as const;
export type BookingStatus = (typeof bookingStatuses)[number];
export type BookingSource = "EXISTING_MEMBER" | "REGISTER_AND_BOOK";
export type VehicleStatus = "AVAILABLE" | "CLEANING" | "MAINTENANCE" | "INACTIVE";
