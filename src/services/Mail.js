import nodemailer from 'nodemailer';
import { buildBatteryReport } from './BatteryReport.js';

class Mail {
  static async sendBatteryReport(devices) {
    if (devices.length === 0) return { sent: false, reason: 'no_low_battery' };

    const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, MAIL_FROM } = process.env;
    if (!SMTP_HOST || !MAIL_FROM) {
      throw new Error('Configurer SMTP_HOST et MAIL_FROM pour envoyer le rapport des piles ESL');
    }
    if (Boolean(SMTP_USER) !== Boolean(SMTP_PASSWORD)) {
      throw new Error('Configurer SMTP_USER et SMTP_PASSWORD ensemble');
    }
    const port = Number(process.env.SMTP_PORT || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('SMTP_PORT invalide');
    }
    const transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === undefined ? port === 465 : process.env.SMTP_SECURE === 'true',
      ...(SMTP_USER ? { auth: { user: SMTP_USER, pass: SMTP_PASSWORD } } : {}),
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000
    });
    const to = process.env.ESL_BATTERY_EMAIL_TO || 'logistique@materiel-levage.com';
    const info = await transport.sendMail({
      from: MAIL_FROM,
      to,
      ...buildBatteryReport(devices)
    });
    if (!info.accepted?.length || info.rejected?.length) {
      throw new Error('Le serveur SMTP a refusé le destinataire du rapport ESL');
    }
    return { sent: true, to, messageId: info.messageId };
  }
}

export default Mail;
