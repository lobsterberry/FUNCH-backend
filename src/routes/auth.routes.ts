import { ExpressAuth, type ExpressAuthConfig } from "@auth/express";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import {
  registrationData,
  registrationSchema,
  passwordSchema,
} from "../lib/registration.js";
import { changePassword, createUser, publicUser, publicUserById, userPassword } from "../lib/users.js";
import { loadSession, requireAuth, requireJson } from "../middleware/auth.js";
import { hashPassword, verifyPassword } from "../utils/password.js";

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .strict()
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must differ from current password",
    path: ["newPassword"],
  });

export function createAuthRoutes(config: ExpressAuthConfig) {
  const router = Router();
  const sensitiveLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      success: false,
      message: "Too many attempts. Please try again later.",
    },
  });
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(
    ["/register", "/login", "/callback/credentials", "/change-password"],
    sensitiveLimiter,
  );

  router.post("/register", requireJson, async (req, res, next) => {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({
          success: false,
          message: "Invalid registration data",
          errors: parsed.error.flatten(),
        });
      return;
    }
    try {
      const user = await createUser(await registrationData(parsed.data));
      res.status(201).json({ success: true, data: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/me",
    loadSession(config),
    requireAuth,
    async (_req, res, next) => {
      try {
        const user = await publicUserById(res.locals.session.user.id);
        res.json({ success: true, data: user });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/change-password",
    requireJson,
    loadSession(config),
    requireAuth,
    async (req, res, next) => {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({
            success: false,
            message: "Invalid password data",
            errors: parsed.error.flatten(),
          });
        return;
      }
      try {
        const user = await userPassword(res.locals.session.user.id);
        if (
          !user?.isActive ||
          !(await verifyPassword(parsed.data.currentPassword, user.password))
        ) {
          res
            .status(400)
            .json({ success: false, message: "Current password is incorrect" });
          return;
        }
        // Compare-and-swap prevents concurrent requests from reusing the old password.
        const changed = await changePassword(user, await hashPassword(parsed.data.newPassword));
        if (!changed) {
          res
            .status(409)
            .json({
              success: false,
              message: "Password changed concurrently. Please sign in again.",
            });
          return;
        }
        res.json({
          success: true,
          message: "Password changed. Please sign in again on all devices.",
        });
      } catch (error) {
        next(error);
      }
    },
  );

  const authHandler = ExpressAuth(config);
  // Friendly aliases preserve Auth.js CSRF checks, cookies and response contract.
  for (const [alias, action] of [
    ["login", "callback/credentials"],
    ["logout", "signout"],
  ]) {
    router.post(`/${alias}`, (req, _res, next) => {
      req.url = `/${action}`;
      req.originalUrl = `/api/auth/${action}`;
      req.headers["x-auth-return-redirect"] = "1";
      next();
    });
  }
  router.use("/*", authHandler);
  return router;
}
