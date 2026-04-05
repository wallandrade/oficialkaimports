import type { NextFunction, Request, Response } from "express";
import crypto from "crypto";

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

type CustomerSession = {
  token: string;
  userId: string;
  email: string;
  name: string;
  expiresAt: number;
};

const sessions = new Map<string, CustomerSession>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt < now) {
      sessions.delete(token);
    }
  }
}

function readBearerToken(req: Request): string {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return "";
  }
  return auth.slice(7).trim();
}

export function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("hex");
}

export function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function createCustomerSession(input: {
  userId: string;
  email: string;
  name: string;
}): { token: string; expiresInSeconds: number } {
  purgeExpired();

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    token,
    userId: input.userId,
    email: input.email,
    name: input.name,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });

  return { token, expiresInSeconds: TOKEN_TTL_MS / 1000 };
}

export function removeCustomerSession(req: Request): void {
  const token = readBearerToken(req);
  if (!token) {
    return;
  }
  sessions.delete(token);
}

export function getCustomerSession(req: Request): CustomerSession | null {
  purgeExpired();
  const token = readBearerToken(req);
  if (!token) {
    return null;
  }
  return sessions.get(token) || null;
}

export function requireCustomerAuth(req: Request, res: Response, next: NextFunction): void {
  const session = getCustomerSession(req);
  if (!session) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Faça login para acessar esta rota." });
    return;
  }
  next();
}
