// Correo del código de acceso por Amazon SES (us-west-2, configuration set luka-cash).
// Plantilla aprobada por el owner el 27-oct (misma estructura que el correo de código de Luka).
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

let _ses: SESv2Client | null = null;
function ses(): SESv2Client {
  if (_ses) return _ses;
  const id = process.env["MAIL_ACCESS_KEY_ID"];
  const secret = process.env["MAIL_SECRET_ACCESS_KEY"];
  if (!id || !secret) throw new Error("correo_no_configurado");
  _ses = new SESv2Client({
    region: process.env["MAIL_REGION"] ?? "us-west-2",
    credentials: { accessKeyId: id, secretAccessKey: secret },
  });
  return _ses;
}

export function mailConfigurado(): boolean {
  return Boolean(process.env["MAIL_ACCESS_KEY_ID"] && process.env["MAIL_SECRET_ACCESS_KEY"]);
}

const ISOTIPO_URL = () => process.env["MAIL_ISOTIPO_URL"] ?? "https://api.luka.cash/brand/luka-cash-isotipo-email.png";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function lineaNombre(nombre: string | null | undefined): string {
  const n = nombre?.trim().split(/\s+/)[0];
  return n ? `${n}, este es tu código` : "Este es tu código";
}

export function correoCodigoHtml(codigo: string, nombre: string | null | undefined): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tu código de Luka Cash</title></head><body style="margin:0;padding:0;background:#F4F7FC;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FC;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#FBFCFF;border:1px solid #D8DEEA;border-radius:16px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <tr><td style="padding-bottom:20px;">
      <img src="${esc(ISOTIPO_URL())}" alt="Luka Cash" width="82" height="82" style="display:block;border:0;outline:none;text-decoration:none;width:82px;height:82px;">
    </td></tr>
    <tr><td style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#545E72;padding-bottom:16px;">Luka Cash</td></tr>
    <tr><td style="font-size:19px;font-weight:600;color:#07194E;padding-bottom:8px;">${esc(lineaNombre(nombre))}</td></tr>
    <tr><td style="font-size:14px;line-height:1.6;color:#545E72;padding-bottom:22px;">Vence en 10 minutos y sirve una sola vez.</td></tr>
    <tr><td align="center" style="padding-bottom:22px;">
      <div style="display:inline-block;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:.24em;color:#0E1220;background:#D6F9F9;border:1px solid #A6EFEE;border-radius:12px;padding:16px 22px 16px 30px;">${esc(codigo)}</div>
    </td></tr>
    <tr><td style="font-size:12.5px;line-height:1.6;color:#545E72;border-top:1px solid #D8DEEA;padding-top:18px;">
      Si no fuiste tú quien lo pidió, no hagas nada: sin el código nadie entra.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

export function correoCodigoTexto(codigo: string, nombre: string | null | undefined): string {
  return `${lineaNombre(nombre)} de Luka Cash: ${codigo}\n\nVence en 10 minutos y sirve una sola vez.\n\nSi no fuiste tú quien lo pidió, no hagas nada: sin el código nadie entra.\n`;
}

export async function enviarCodigo(to: string, codigo: string, nombre: string | null | undefined): Promise<void> {
  const from = process.env["MAIL_FROM"] ?? "codigos@luka.cash";
  await ses().send(
    new SendEmailCommand({
      FromEmailAddress: `Luka Cash <${from}>`,
      Destination: { ToAddresses: [to] },
      ConfigurationSetName: process.env["MAIL_CONFIGURATION_SET"] ?? "luka-cash",
      Content: {
        Simple: {
          Subject: { Data: `${codigo}, tu código para entrar a Luka Cash`, Charset: "UTF-8" },
          Body: {
            Html: { Data: correoCodigoHtml(codigo, nombre), Charset: "UTF-8" },
            Text: { Data: correoCodigoTexto(codigo, nombre), Charset: "UTF-8" },
          },
        },
      },
    }),
  );
}


/** Aviso interno a ventas por cada interesado nuevo (pre-onboarding) de la landing o del acceso anticipado. No bloquea la respuesta. */
export async function avisarPreonboarding(v: { tipo: string; empresa: string; nombre: string; whatsapp: string; email: string; origen: string; rif?: string | null; proveedores?: string[] }): Promise<void> {
  if (!mailConfigurado()) return;
  const to = process.env["MAIL_AVISOS_TO"] ?? "ventas@somosluka.com";
  const from = process.env["MAIL_FROM"] ?? "codigos@luka.cash";
  const tipo = v.tipo === "proveedor" ? "Proveedor" : "Comercio";
  const texto = `Nuevo interesado en Luka Cash (pre-onboarding)\n\nTipo: ${tipo}\nEmpresa: ${v.empresa}\nNombre: ${v.nombre}\nWhatsApp: ${v.whatsapp}\nCorreo: ${v.email}\nOrigen: ${v.origen === "landing" ? "luka.cash" : "acceso anticipado"}\n${v.rif ? `RIF: ${v.rif}\n` : ""}${v.proveedores?.length ? `Proveedores a los que paga: ${v.proveedores.join(", ")}\n` : ""}`;
  await ses().send(new SendEmailCommand({
    FromEmailAddress: `Luka Cash <${from}>`,
    Destination: { ToAddresses: [to] },
    ReplyToAddresses: [v.email],
    ConfigurationSetName: process.env["MAIL_CONFIGURATION_SET"] ?? "luka-cash",
    Content: { Simple: { Subject: { Data: `Nuevo interesado (${tipo}): ${v.empresa}`, Charset: "UTF-8" }, Body: { Text: { Data: texto, Charset: "UTF-8" } } } },
  }));
}
