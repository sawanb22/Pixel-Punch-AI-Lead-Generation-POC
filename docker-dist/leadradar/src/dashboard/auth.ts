import passport from "passport";
import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
import type { Express, RequestHandler } from "express";
import type { DB } from "../db/database.js";
import {
  upsertUser,
  findUserByEmail,
  isAllowlisted,
  type User,
} from "../users/users.repo.js";

export interface AuthUser {
  email: string;
  name: string | null;
}

declare global {
  namespace Express {
    interface User extends AuthUser {}
  }
}

export interface AuthOptions {
  db: DB;
  allowlist: string[];
  clientID?: string;
  clientSecret?: string;
  callbackURL?: string;
}

/** True when LEADRADAR_AUTH_BYPASS=1 */
export function authBypassEnabled(): boolean {
  return process.env.LEADRADAR_AUTH_BYPASS === "1";
}

export function configureAuth(app: Express, options: AuthOptions): void {
  const {
    db,
    allowlist,
    clientID = process.env.GOOGLE_CLIENT_ID,
    clientSecret = process.env.GOOGLE_CLIENT_SECRET,
    callbackURL = process.env.GOOGLE_CALLBACK_URL ?? "/auth/google/callback",
  } = options;

  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user, done) => {
    done(null, (user as AuthUser).email);
  });

  passport.deserializeUser((email: string, done) => {
    try {
      const row = findUserByEmail(db, email);
      if (!row) {
        return done(null, false as unknown as AuthUser);
      }
      done(null, { email: row.email, name: row.name } satisfies AuthUser);
    } catch (err) {
      done(err as Error);
    }
  });

  if (clientID && clientSecret) {
    passport.use(
      new GoogleStrategy(
        {
          clientID,
          clientSecret,
          callbackURL,
        },
        (
          _accessToken: string,
          _refreshToken: string,
          profile: Profile,
          done: (err: Error | null, user?: AuthUser | false) => void
        ) => {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error("Google profile missing email"));
          }
          if (!isAllowlisted(email, allowlist)) {
            return done(null, false);
          }
          const name = profile.displayName ?? null;
          const user = upsertUser(db, { email, name });
          return done(null, { email: user.email, name: user.name });
        }
      )
    );
  }

  app.get(
    "/auth/google",
    passport.authenticate("google", { scope: ["email", "profile"] })
  );

  app.get(
    "/auth/google/callback",
    passport.authenticate("google", {
      failureRedirect: "/login?error=not_allowed",
      successRedirect: "/",
    })
  );

  app.get("/auth/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.redirect("/login");
    });
  });

  app.get("/login", (_req, res) => {
    if (authBypassEnabled()) {
      res.redirect("/");
      return;
    }
    const hasGoogle = Boolean(clientID && clientSecret);
    res.type("html").send(`<!DOCTYPE html>
<html><head><title>LeadRadar Login</title>
<link rel="stylesheet" href="/styles.css"></head>
<body class="login">
  <h1>LeadRadar</h1>
  <p>Sign in to continue.</p>
  ${
    hasGoogle
      ? `<p><a class="btn" href="/auth/google">Sign in with Google</a></p>`
      : `<p class="muted">Google OAuth is not configured. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, or use LEADRADAR_AUTH_BYPASS=1 for local dev.</p>`
  }
</body></html>`);
  });
}

/** Injects a fake user when LEADRADAR_AUTH_BYPASS=1. */
export function authBypassMiddleware(db: DB): RequestHandler {
  return (req, _res, next) => {
    if (!authBypassEnabled()) return next();
    const email = "dev@local";
    const name = "Dev";
    upsertUser(db, { email, name });
    req.user = { email, name };
    // Mark as authenticated for passport-style checks
    (req as { isAuthenticated?: () => boolean }).isAuthenticated = () => true;
    next();
  };
}

export type { User };
