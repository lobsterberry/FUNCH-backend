import { getSession, type ExpressAuthConfig } from "@auth/express";
import type { RequestHandler } from "express";

export function loadSession(config: ExpressAuthConfig): RequestHandler {
  return async (req, res, next) => {
    try {
      res.locals.session = await getSession(req, config);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireAuth: RequestHandler = (_req, res, next) => {
  if (!res.locals.session?.user?.id) {
    res
      .status(401)
      .json({ success: false, message: "Authentication required" });
    return;
  }
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  requireAuth(req, res, () => {
    if (res.locals.session.user.role !== "ADMIN") {
      res
        .status(403)
        .json({ success: false, message: "Admin access required" });
      return;
    }
    next();
  });
};

// Requiring JSON also prevents cross-site HTML form submissions on custom routes.
export const requireJson: RequestHandler = (req, res, next) => {
  if (!req.is("application/json")) {
    res
      .status(415)
      .json({
        success: false,
        message: "Content-Type must be application/json",
      });
    return;
  }
  next();
};
