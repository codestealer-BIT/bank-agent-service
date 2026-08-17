import { config } from "./config.js";
import {
  decryptMailAuthCode,
  encryptMailAuthCode,
  hasMailCredentialEncryptionKey,
} from "./credential-crypto.js";
import { pool } from "./database.js";

type MailAccountRow = {
  id: string;
  email: string | null;
  encrypted_auth_code: string | null;
};

async function getMailAccount(userId: string): Promise<MailAccountRow | null> {
  const result = await pool.query<MailAccountRow>(
    `SELECT account.id, account.email, credential.encrypted_auth_code
     FROM user_accounts account
     LEFT JOIN user_mail_credentials credential ON credential.user_id = account.id
     WHERE account.id = $1 AND account.enabled = true`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function getUserMailStatus(userId: string): Promise<{
  email: string | null;
  authCodeConfigured: boolean;
}> {
  const account = await getMailAccount(userId);
  const legacyConfigured = Boolean(
    account?.email &&
      config.SMTP_USER &&
      config.SMTP_AUTH_CODE &&
      account.email.toLowerCase() === config.SMTP_USER.toLowerCase(),
  );
  return {
    email: account?.email ?? null,
    authCodeConfigured: Boolean(account?.encrypted_auth_code || legacyConfigured),
  };
}

export async function saveUserMailAuthCode(
  userId: string,
  authCode: string,
): Promise<void> {
  const account = await getMailAccount(userId);
  if (!account?.email) throw new Error("当前账号尚未绑定发件邮箱");
  if (!hasMailCredentialEncryptionKey()) {
    throw new Error("服务端尚未配置邮件授权码加密密钥");
  }
  const encrypted = encryptMailAuthCode(authCode.trim(), userId, account.email);
  await pool.query(
    `INSERT INTO user_mail_credentials(user_id, encrypted_auth_code, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE
     SET encrypted_auth_code = EXCLUDED.encrypted_auth_code, updated_at = now()`,
    [userId, encrypted],
  );
}

export async function loadUserMailCredentials(userId: string): Promise<{
  email: string;
  authCode: string;
}> {
  const account = await getMailAccount(userId);
  if (!account?.email) throw new Error("当前账号尚未绑定发件邮箱");
  if (account.encrypted_auth_code) {
    return {
      email: account.email,
      authCode: decryptMailAuthCode(
        account.encrypted_auth_code,
        userId,
        account.email,
      ),
    };
  }
  if (
    config.SMTP_USER &&
    config.SMTP_AUTH_CODE &&
    account.email.toLowerCase() === config.SMTP_USER.toLowerCase()
  ) {
    return { email: account.email, authCode: config.SMTP_AUTH_CODE };
  }
  throw new Error("当前账号尚未配置发件邮箱授权码");
}
