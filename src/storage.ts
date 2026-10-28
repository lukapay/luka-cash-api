// Documentos en DigitalOcean Spaces (S3), bucket privado. URL prefirmadas de corta vida.
import { HeadObjectCommand, DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (_s3) return _s3;
  const endpoint = process.env["SPACES_ENDPOINT"];
  const key = process.env["SPACES_KEY"];
  const secret = process.env["SPACES_SECRET"];
  if (!endpoint || !key || !secret) throw new Error("almacenamiento_no_configurado");
  _s3 = new S3Client({
    endpoint,
    region: process.env["SPACES_REGION"] ?? "us-east-1", // Spaces ignora la región, el SDK la exige
    credentials: { accessKeyId: key, secretAccessKey: secret },
    forcePathStyle: false,
  });
  return _s3;
}
const bucket = () => process.env["SPACES_BUCKET"] ?? "luka-cash-docs";

/** URL para subir con PUT, válida 15 minutos. El cliente debe enviar el mismo Content-Type. */
export async function urlSubida(ruta: string, mime: string): Promise<string> {
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: bucket(), Key: ruta, ContentType: mime }), { expiresIn: 900 });
}

/** Tamaño y tipo del objeto subido, o null si no existe. */
export async function infoObjeto(ruta: string): Promise<{ tamano: number; mime: string | null } | null> {
  try {
    const h = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: ruta }));
    return { tamano: Number(h.ContentLength ?? 0), mime: h.ContentType ?? null };
  } catch (e) {
    const code = (e as { name?: string; $metadata?: { httpStatusCode?: number } });
    if (code.name === "NotFound" || code.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

export async function borrarObjeto(ruta: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: ruta }));
}
