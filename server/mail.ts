import nodemailer from "nodemailer";
import { z } from "zod";
import { AppError } from "./policy";

type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  auth?: { user: string; pass: string };
};

type ResendSettings = { apiKey: string; from: string };

export function resendSettings(): ResendSettings | null {
  const { RESEND_API_KEY, RESEND_FROM } = process.env;
  if (!RESEND_API_KEY && !RESEND_FROM) return null;
  if (
    !RESEND_API_KEY?.trim() ||
    !z.string().email().safeParse(RESEND_FROM).success
  )
    throw new AppError(
      503,
      "Email delivery is not configured correctly. Check Resend settings.",
    );
  return { apiKey: RESEND_API_KEY, from: RESEND_FROM! };
}

const invitationText = (companyName: string, url: string) =>
  `${companyName} invited you to join their DevTrack workspace.\n\nAccept your invitation: ${url}\n\nThis link expires in 48 hours and can be used once. If you did not expect this invitation, you can ignore this email.`;

export async function sendInvitationViaResend(
  settings: ResendSettings,
  to: string,
  companyName: string,
  url: string,
) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: settings.from,
      to: [to],
      subject: "You're invited to DevTrack",
      text: invitationText(companyName, url),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error("Resend did not accept the invitation email.");
}

export function smtpSettings(): SmtpSettings | null {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_FROM,
    SMTP_USER,
    SMTP_PASSWORD,
  } = process.env;
  if (
    ![
      SMTP_HOST,
      SMTP_PORT,
      SMTP_SECURE,
      SMTP_FROM,
      SMTP_USER,
      SMTP_PASSWORD,
    ].some(Boolean)
  )
    return null;
  const port = Number(SMTP_PORT || 587);
  if (
    !SMTP_HOST ||
    !SMTP_FROM ||
    !z.string().email().safeParse(SMTP_FROM).success ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    (SMTP_SECURE !== undefined && !["true", "false"].includes(SMTP_SECURE)) ||
    Boolean(SMTP_USER) !== Boolean(SMTP_PASSWORD)
  )
    throw new AppError(
      503,
      "Email delivery is not configured correctly. Check the SMTP settings.",
    );
  return {
    host: SMTP_HOST,
    port,
    secure: SMTP_SECURE === "true",
    from: SMTP_FROM,
    auth:
      SMTP_USER && SMTP_PASSWORD
        ? { user: SMTP_USER, pass: SMTP_PASSWORD }
        : undefined,
  };
}

export async function sendInvitationEmail(
  settings: SmtpSettings,
  to: string,
  companyName: string,
  url: string,
) {
  const local = ["127.0.0.1", "localhost", "::1"].includes(settings.host);
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: settings.auth,
    requireTLS: !settings.secure && !local,
    ignoreTLS: !settings.secure && local,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    await transport.sendMail({
      from: settings.from,
      to,
      subject: "You're invited to DevTrack",
      text: invitationText(companyName, url),
    });
  } finally {
    transport.close();
  }
}
