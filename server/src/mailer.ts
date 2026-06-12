import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * Envío de correo. Con SMTP_HOST configurado usa SMTP real; sin él, registra
 * el correo en consola (y lo guarda para el endpoint de desarrollo, que usan
 * las pruebas para extraer el enlace de verificación).
 */
let transport: Transporter | null = null;

if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === '1',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

export interface DevMail {
  to: string;
  subject: string;
  text: string;
  at: string;
}

const devOutbox: DevMail[] = [];

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (transport) {
    await transport.sendMail({
      from: process.env.SMTP_FROM ?? 'Ajedrez de Batalla <no-reply@localhost>',
      to,
      subject,
      text,
    });
    return;
  }
  console.log(`[mailer] (sin SMTP) Para: ${to}\n  Asunto: ${subject}\n  ${text.replaceAll('\n', '\n  ')}`);
  devOutbox.push({ to, subject, text, at: new Date().toISOString() });
  if (devOutbox.length > 50) devOutbox.shift();
}

export function devMails(): DevMail[] {
  return devOutbox;
}
