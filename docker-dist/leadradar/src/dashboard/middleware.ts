import type { RequestHandler } from "express";

export const requireAuth: RequestHandler = (req, res, next) => {
  if (req.user || (typeof req.isAuthenticated === "function" && req.isAuthenticated())) {
    return next();
  }
  if (req.path.startsWith("/api") || req.originalUrl.startsWith("/api")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  res.redirect("/login");
};
