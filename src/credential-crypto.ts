import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { config } from "./config.js";

const VERSION = "v1";

function configuredKey(): Buffer {
  const encoded = config.MAIL_CREDENTIAL_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error("MAIL_CREDENTIAL_ENCRYPTION_KEY is not configured");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("MAIL_CREDENTIAL_ENCRYPTION_KEY must be 32 bytes in base64");
  }
  return key;
}

export function hasMailCredentialEncryptionKey(): boolean {
  if (!config.MAIL_CREDENTIAL_ENCRYPTION_KEY) return false;
  return Buffer.from(config.MAIL_CREDENTIAL_ENCRYPTION_KEY, "base64").length === 32;
}

export function encryptMailAuthCode(
  authCode: string,
  userId: string,
  email: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", configuredKey(), iv);
  cipher.setAAD(Buffer.from(`${userId}:${email}`, "utf8"));
  const encrypted = Buffer.concat([
    cipher.update(authCode, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, encrypted]
    .map((part) => (typeof part === "string" ? part : part.toString("base64")))
    .join(".");
}

export function decryptMailAuthCode(
  payload: string,
  userId: string,
  email: string,
): string {
  const [version, ivEncoded, tagEncoded, encryptedEncoded] = payload.split(".");
  if (version !== VERSION || !ivEncoded || !tagEncoded || !encryptedEncoded) {
    throw new Error("Unsupported encrypted mail credential format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    configuredKey(),
    Buffer.from(ivEncoded, "base64"),
  );
  decipher.setAAD(Buffer.from(`${userId}:${email}`, "utf8"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
