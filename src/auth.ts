import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { pool } from "./database.js";
import {
  createSessionToken,
  hashSessionToken,
  verifyPassword,
} from "./security.js";

export type AuthenticatedUser = {
  id: string;
  username: string;
  display_name: string;
};

type AccountRow = AuthenticatedUser & {
  password_hash: string;
  password_salt: string;
  enabled: boolean;
};

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      // Ignore malformed cookies.
    }
  }
  return cookies;
}

function sessionCookie(value: string, maxAgeSeconds: number): string {
  return [
    `${config.SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    config.COOKIE_SECURE ? "Secure" : "",
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function unauthorized(): Error {
  return Object.assign(new Error("Authentication required"), {
    statusCode: 401,
  });
}

export async function authenticateCredentials(
  username: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  const normalized = username.trim().toLowerCase();
  const result = await pool.query<AccountRow>(
    `SELECT id, username, display_name, password_hash, password_salt, enabled
     FROM user_accounts
     WHERE username = $1`,
    [normalized],
  );
  const account = result.rows[0];
  if (!account?.enabled) return null;
  const valid = await verifyPassword(
    password,
    account.password_salt,
    account.password_hash,
  );
  if (!valid) return null;
  return {
    id: account.id,
    username: account.username,
    display_name: account.display_name,
  };
}

export async function createAuthenticatedSession(
  userId: string,
  reply: FastifyReply,
): Promise<void> {
  const token = createSessionToken();
  const ttlSeconds = config.SESSION_TTL_HOURS * 60 * 60;
  await pool.query(
    `INSERT INTO auth_sessions(token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
    [hashSessionToken(token), userId, ttlSeconds],
  );
  reply.header("Set-Cookie", sessionCookie(token, ttlSeconds));
}

export async function destroyAuthenticatedSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = parseCookies(request.headers.cookie).get(
    config.SESSION_COOKIE_NAME,
  );
  if (token) {
    await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [
      hashSessionToken(token),
    ]);
  }
  reply.header("Set-Cookie", sessionCookie("", 0));
}

export async function getAuthenticatedUser(
  request: FastifyRequest,
): Promise<AuthenticatedUser> {
  const token = parseCookies(request.headers.cookie).get(
    config.SESSION_COOKIE_NAME,
  );
  if (!token) throw unauthorized();

  const result = await pool.query<AuthenticatedUser>(
    `SELECT account.id, account.username, account.display_name
     FROM auth_sessions session
     JOIN user_accounts account ON account.id = session.user_id
     WHERE session.token_hash = $1
       AND session.expires_at > now()
       AND account.enabled = true`,
    [hashSessionToken(token)],
  );
  const user = result.rows[0];
  if (!user) throw unauthorized();
  return user;
}

export async function getAuthenticatedUserId(
  request: FastifyRequest,
): Promise<string> {
  return (await getAuthenticatedUser(request)).id;
}
