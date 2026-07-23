import express, { type Express } from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DB } from "../db/database.js";
import type { Scorer } from "../scoring/scorer.js";
import { MockScorer } from "../scoring/mock-scorer.js";
import { HermesScorer } from "../scoring/hermes-scorer.js";
import { configureAuth, authBypassMiddleware, authBypassEnabled } from "./auth.js";
import { requireAuth } from "./middleware.js";
import { createApiRouter, type ApiOptions } from "./api.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");

export interface CreateAppOptions {
  db: DB;
  scorer?: Scorer;
  allowlist?: string[];
  sessionSecret?: string;
  mxResolver?: import("../validation/email-check.js").MxResolver;
  ingestFetch?: ApiOptions["ingestFetch"];
  enrichFetch?: ApiOptions["enrichFetch"];
  ingestEnv?: ApiOptions["ingestEnv"];
  createConfiguredSourcesFn?: ApiOptions["createConfiguredSourcesFn"];
  apifyClient?: ApiOptions["apifyClient"];
  leadPlanner?: ApiOptions["leadPlanner"];
}

export function resolveScorer(override?: Scorer): Scorer {
  if (override) return override;
  if (process.env.SCORE_MOCK === "1") return new MockScorer();
  return new HermesScorer();
}

export function parseAllowlist(raw?: string): string[] {
  const source = raw ?? process.env.LEADRADAR_ALLOWLIST ?? "";
  return source
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function createApp(options: CreateAppOptions): Express {
  const {
    db,
    scorer = resolveScorer(),
    allowlist = parseAllowlist(),
    sessionSecret = process.env.SESSION_SECRET ?? "leadradar-dev-secret",
    mxResolver,
    ingestFetch,
    enrichFetch,
    ingestEnv,
    createConfiguredSourcesFn,
    apifyClient,
    leadPlanner,
  } = options;

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
    })
  );

  // Bypass before passport so tests never need Google
  app.use(authBypassMiddleware(db));
  configureAuth(app, { db, allowlist });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, bypass: authBypassEnabled() });
  });

  app.use(
    "/api",
    requireAuth,
    createApiRouter({
      db,
      scorer,
      mxResolver,
      ingestFetch,
      enrichFetch,
      ingestEnv,
      createConfiguredSourcesFn,
      apifyClient,
      leadPlanner,
    })
  );

  app.use(express.static(publicDir));

  app.get("/", requireAuth, (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}
