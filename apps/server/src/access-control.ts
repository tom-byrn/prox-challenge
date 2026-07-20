import { createHmac, timingSafeEqual } from "node:crypto";

export const ACCESS_COOKIE_NAME = "arcwell_access";
export const ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface AccessControlConfig {
  required: boolean;
  configured: boolean;
  password: string;
  sessionSecret: string;
}

export function readAccessControlConfig(environment: NodeJS.ProcessEnv = process.env): AccessControlConfig {
  const password = environment.ARCWELL_ACCESS_PASSWORD?.trim() ?? "";
  const sessionSecret = environment.ARCWELL_SESSION_SECRET?.trim() ?? "";
  const required = Boolean(environment.VERCEL || password || sessionSecret);
  return {
    required,
    configured: Boolean(password && sessionSecret),
    password,
    sessionSecret
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isValidAccessPassword(candidate: string, config: AccessControlConfig): boolean {
  return config.configured && constantTimeEqual(candidate, config.password);
}

export function createAccessSessionToken(config: AccessControlConfig): string {
  if (!config.configured) throw new Error("Access control is not configured.");
  return createHmac("sha256", config.sessionSecret).update("arcwell-access-v1").digest("base64url");
}

export function isValidAccessSession(token: string | undefined, config: AccessControlConfig): boolean {
  if (!token || !config.configured) return false;
  return constantTimeEqual(token, createAccessSessionToken(config));
}
