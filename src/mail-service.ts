import nodemailer, { type Transporter } from "nodemailer";
import { config } from "./config.js";

let transporter: Transporter | null = null;

export type EmailSendResult = {
  sent: true;
  messageId: string;
};

export function isEmailConfigured(recipient?: string | null): boolean {
  return Boolean(
    config.SMTP_ENABLED &&
      config.SMTP_USER &&
      config.SMTP_AUTH_CODE &&
      (recipient || config.SMTP_DEFAULT_TO),
  );
}

function getTransporter(): Transporter {
  if (transporter) return transporter;
  if (!config.SMTP_USER || !config.SMTP_AUTH_CODE) {
    throw new Error("邮件服务尚未配置，请联系管理员设置 QQ 邮箱授权码。");
  }

  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_AUTH_CODE,
    },
    tls: {
      minVersion: "TLSv1.2",
    },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return transporter;
}

export async function sendConfiguredEmail(input: {
  subject: string;
  body: string;
}, recipient?: string | null): Promise<EmailSendResult> {
  const targetRecipient = recipient || config.SMTP_DEFAULT_TO;
  if (!isEmailConfigured(targetRecipient) || !config.SMTP_USER || !targetRecipient) {
    throw new Error("邮件服务尚未配置，请联系管理员设置 QQ 邮箱授权码和收件人。");
  }

  try {
    const result = await getTransporter().sendMail({
      from: {
        name: config.SMTP_FROM_NAME,
        address: config.SMTP_USER,
      },
      to: targetRecipient,
      subject: input.subject,
      text: input.body,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    return {
      sent: true,
      messageId: result.messageId,
    };
  } catch (error) {
    console.error(
      "[email] SMTP delivery failed",
      error instanceof Error ? error.message : "unknown error",
    );
    throw new Error("邮件发送失败，请检查 SMTP 配置或稍后重试。");
  }
}
