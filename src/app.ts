import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { z } from "zod";
import { databasePool, isUniqueViolation } from "./lib/db.js";
import { createAuthConfig } from "./auth.js";
import { createAuthRoutes } from "./routes/auth.routes.js";
import { loadSession } from "./middleware/auth.js";
import carRoutes from "./routes/car.routes.js";
import bookingRoutes from "./routes/booking.routes.js";
import countryRoutes from "./routes/country.routes.js";
import locationRoutes from "./routes/location.routes.js";
import memberRoutes from "./routes/member.routes.js";
import reportRoutes from "./routes/report.routes.js";
import exampleRoutes from "./routes/example.routes.js";

export function createApp() {
  const app = express();
  const config = createAuthConfig();
  const frontendOrigin = new URL(
    process.env.FRONTEND_URL || "http://localhost:3000",
  ).origin;
  const backendOrigin = new URL(process.env.AUTH_URL || "http://localhost:5000")
    .origin;
  const allowedOrigins = new Set([frontendOrigin, backendOrigin]);
  app.disable("x-powered-by");
  app.use(cors({ origin: [...allowedOrigins], credentials: true }));
  app.use((req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      !allowedOrigins.has(req.headers.origin)
    ) {
      res.status(403).json({ success: false, message: "Origin not allowed" });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.use("/api/auth", createAuthRoutes(config));

  app.get("/health", async (_req, res) => {
    try {
      await databasePool().query("SELECT 1");
      res.json({
        status: "ok",
        service: "funch-backend",
        timestamp: new Date().toISOString(),
        database: "connected",
      });
    } catch {
      res
        .status(503)
        .json({
          status: "error",
          service: "funch-backend",
          database: "disconnected",
        });
    }
  });
  app.use("/api/cars", loadSession(config), carRoutes);
  app.use("/api/admin/members", loadSession(config), memberRoutes);
  app.use("/api/admin/reports", loadSession(config), reportRoutes);
  app.use("/api/bookings", loadSession(config), bookingRoutes);
  app.use("/api/example", loadSession(config), exampleRoutes);
  app.use("/api/exampe", loadSession(config), exampleRoutes);
  app.use("/api/countries", countryRoutes);
  app.use("/api/locations", locationRoutes);
  app.get("/", (_req, res) => {
    res.json({
      message: "Welcome to FUNCH Car Rental Backend API",
      endpoints: {
        health: "/health",
        countries: "/api/countries",
        locations: "/api/locations",
        cars: "/api/cars/search",
        bookings: "/api/bookings",
        calculatePrice: "POST /api/bookings/calculate",
        register: "POST /api/auth/register",
        login: "POST /api/auth/login",
        logout: "POST /api/auth/logout",
        session: "GET /api/auth/session",
        me: "GET /api/auth/me",
        changePassword: "POST /api/auth/change-password",
        csrf: "GET /api/auth/csrf",
      },
    });
  });
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({
          success: false,
          message: "Invalid request data",
          errors: error.flatten(),
        });
    } else if (isUniqueViolation(error)) {
      res
        .status(409)
        .json({
          success: false,
          message: "A record with these details already exists",
        });
    } else if (
      [
        "HAS_ACTIVE_BOOKINGS",
        "OFFER_IDENTITY",
        "SCHEDULE_CONFLICT",
        "INVALID_TRANSITION",
        "CAR_CHANGED",
        "INVALID_TRANSFER",
      ].includes(error?.message)
    ) {
      res.status(409).json({ success: false, message: error.message });
    } else if (error?.message === "INVALID_OFFER") {
      res.status(400).json({ success: false, message: "Invalid offer" });
    } else if (error?.type === "entity.parse.failed") {
      res.status(400).json({ success: false, message: "Invalid JSON body" });
    } else if (error?.type === "entity.too.large") {
      res
        .status(413)
        .json({ success: false, message: "Request body too large" });
    } else {
      console.error("Request failed:", error);
      res
        .status(500)
        .json({ success: false, message: "Internal server error" });
    }
  };
  app.use(errorHandler);
  return app;
}
