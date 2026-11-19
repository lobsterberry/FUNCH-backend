import { z } from "zod";

const rate = z
  .number()
  .finite()
  .positive()
  .max(9999999999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.0001);

export const carInputSchema = z
  .object({
    brand: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(150),
    year: z.number().int().min(1900).max(2100),
    licensePlate: z.string().trim().min(1).max(50),
    country: z
      .string()
      .length(2)
      .transform((value) => value.toUpperCase()),
    hourlyRate: rate,
    dailyRate: rate,
    seats: z.number().int().min(1).max(60),
    luggageCapacity: z.number().int().min(0).max(60),
    featureCodes: z.array(z.string().trim().min(1).max(100)).max(50),
    options: z
      .array(
        z.object({
          code: z.string().min(1).max(100),
          label: z.string().min(1).max(150),
          included: z.boolean(),
        }),
      )
      .max(50),
    transmission: z.string().trim().min(1).max(50),
    transmissionType: z.enum(["AUTOMATIC", "MANUAL"]),
    fuelType: z.enum(["Gasoline", "Diesel", "Hybrid", "EV"]),
    steeringSide: z.enum(["RHD", "LHD"]),
    locationId: z.string().min(1).max(100).nullable(),
    categories: z
      .array(z.enum(["SUV", "SEDAN", "MPV", "EV", "ECO", "LUXURY", "WAGON"]))
      .min(1)
      .max(7),
    categoryLabel: z.string().trim().min(1).max(100),
    providerName: z.string().trim().max(150),
    isAvailable: z.boolean(),
  })
  .strict();
