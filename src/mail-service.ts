import nodemailer from "nodemailer";
import { config } from "./config.js";
import { loadUserMailCredentials } from "./user-mail-service.js";

export type EmailSendResult = {
  sent: true;
  messageId: string;
};

export async function sendUserEmail(
  userId: string,
  input: { subject: string; body: string },
  recipient?: string | null,
): Promise<EmailSendResult> {
  const targetRecipient = recipient || config.SMTP_DEFAULT_TO;
  if (!config.SMTP_ENABLED || !targetRecipient) {
    throw new Error("邮件服务尚未启用，或未设置收件人");
  }

  const { email, authCode } = await loadUserMailCredentials(userId);
  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: { user: email, pass: authCode },
    tls: { minVersion: "TLSv1.2" },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

  try {
    const result = await transporter.sendMail({
      from: { name: config.SMTP_FROM_NAME, address: email },
      to: targetRecipient,
      subject: input.subject,
      text: input.body,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    return { sent: true, messageId: result.messageId };
  } catch (error) {
    console.error(
      "[email] SMTP delivery failed",
      error instanceof Error ? error.message : "unknown error",
    );
    throw new Error("邮件发送失败，请检查当前账号的邮箱授权码后重试");
  } finally {
    transporter.close();
  }
}
