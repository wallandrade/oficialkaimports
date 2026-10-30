import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import crypto from "crypto";
import { inlinePdfContentDisposition } from "./shipment-label-filename";

const R2_ACCOUNT_ID = String(process.env.CLOUDFLARE_R2_ACCOUNT_ID || "").trim();
const R2_ACCESS_KEY_ID = String(process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || "").trim();
const R2_SECRET_ACCESS_KEY = String(process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || "").trim();
const R2_BUCKET_NAME = String(process.env.CLOUDFLARE_R2_BUCKET_NAME || "").trim();
const R2_PUBLIC_BASE_URL = String(process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function getR2Client(): S3Client {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !R2_PUBLIC_BASE_URL) {
    throw new Error("CLOUDFLARE_R2_NOT_CONFIGURED");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

function getExtensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

export function isR2Configured(): boolean {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME && R2_PUBLIC_BASE_URL);
}

export function getR2MissingConfig(): string[] {
  const missing: string[] = [];
  if (!R2_ACCOUNT_ID) missing.push("CLOUDFLARE_R2_ACCOUNT_ID");
  if (!R2_ACCESS_KEY_ID) missing.push("CLOUDFLARE_R2_ACCESS_KEY_ID");
  if (!R2_SECRET_ACCESS_KEY) missing.push("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  if (!R2_BUCKET_NAME) missing.push("CLOUDFLARE_R2_BUCKET_NAME");
  if (!R2_PUBLIC_BASE_URL) missing.push("CLOUDFLARE_R2_PUBLIC_BASE_URL");
  return missing;
}

export function parseImageDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("INVALID_IMAGE_DATA_URL");
  }

  const mimeType = match[1].toLowerCase();
  if (!allowedMimeTypes.has(mimeType)) {
    throw new Error("UNSUPPORTED_IMAGE_TYPE");
  }

  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    throw new Error("EMPTY_IMAGE");
  }

  return { buffer, mimeType };
}

export async function uploadProductImageToR2(input: { dataUrl: string; productId?: string | null }): Promise<string> {
  const client = getR2Client();
  const { buffer, mimeType } = parseImageDataUrl(input.dataUrl);
  const extension = getExtensionFromMimeType(mimeType);
  const productPrefix = String(input.productId || "unassigned").trim() || "unassigned";
  const objectKey = `products/${productPrefix}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension}`;

  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: objectKey,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: "public, max-age=31536000, immutable",
  }));

  return `${R2_PUBLIC_BASE_URL}/${objectKey}`;
}

export async function uploadOrderTrackingLabelToR2(input: { dataUrl: string; orderId?: string | null }): Promise<string> {
  const client = getR2Client();
  const { buffer, mimeType } = parseImageDataUrl(input.dataUrl);
  const extension = getExtensionFromMimeType(mimeType);
  const orderPrefix = String(input.orderId || "unassigned").trim() || "unassigned";
  const objectKey = `tracking-labels/${orderPrefix}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension}`;

  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: objectKey,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: "public, max-age=31536000, immutable",
  }));

  return `${R2_PUBLIC_BASE_URL}/${objectKey}`;
}

const SHIPMENT_LABEL_PDF_MAX_BYTES = 15 * 1024 * 1024;

export async function uploadShipmentLabelPdfToR2(input: {
  buffer: Buffer;
  orderId?: string | null;
  downloadFilename?: string | null;
}): Promise<string> {
  const client = getR2Client();
  const orderPrefix = String(input.orderId || "unassigned").trim() || "unassigned";
  const objectKey = `tracking-labels/${orderPrefix}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.pdf`;
  const downloadFilename = String(input.downloadFilename || "").trim();

  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: objectKey,
    Body: input.buffer,
    ContentType: "application/pdf",
    CacheControl: "public, max-age=31536000, immutable",
    ...(downloadFilename ? { ContentDisposition: inlinePdfContentDisposition(downloadFilename) } : {}),
  }));

  return `${R2_PUBLIC_BASE_URL}/${objectKey}`;
}

/** Lê o PDF já gravado. Só aceita data URL ou o bucket público desta loja. */
export async function readStoredShipmentLabelPdf(url: string): Promise<Buffer | null> {
  const value = String(url || "").trim();
  if (!value) return null;
  const data = value.match(/^data:application\/pdf;base64,([a-z0-9+/=\s]+)$/i);
  if (data) {
    const buffer = Buffer.from(data[1].replace(/\s/g, ""), "base64");
    if (!buffer.length || buffer.length > SHIPMENT_LABEL_PDF_MAX_BYTES) return null;
    return buffer.slice(0, 4).toString() === "%PDF" ? buffer : null;
  }
  const base = R2_PUBLIC_BASE_URL;
  if (!base || !value.startsWith(`${base}/`)) return null;
  const res = await fetch(value);
  if (!res.ok || !res.url.startsWith(`${base}/`)) return null;
  const declared = Number(res.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > SHIPMENT_LABEL_PDF_MAX_BYTES) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length || buffer.length > SHIPMENT_LABEL_PDF_MAX_BYTES) return null;
  return buffer.slice(0, 4).toString() === "%PDF" ? buffer : null;
}

const WHATSAPP_GROUP_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export async function uploadWhatsappGroupImageToR2(input: { dataUrl: string }): Promise<string> {
  const client = getR2Client();
  const { buffer, mimeType } = parseImageDataUrl(input.dataUrl);
  if (buffer.length > WHATSAPP_GROUP_IMAGE_MAX_BYTES) {
    throw new Error("IMAGE_TOO_LARGE");
  }
  const extension = getExtensionFromMimeType(mimeType);
  const objectKey = `whatsapp-groups/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension}`;

  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: objectKey,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: "public, max-age=31536000, immutable",
  }));

  return `${R2_PUBLIC_BASE_URL}/${objectKey}`;
}

export async function uploadSiteSettingImageToR2(input: { dataUrl: string; settingKey: string }): Promise<string> {
  const client = getR2Client();
  const { buffer, mimeType } = parseImageDataUrl(input.dataUrl);
  const extension = getExtensionFromMimeType(mimeType);
  const safeSettingKey = String(input.settingKey || "unassigned").trim() || "unassigned";
  const objectKey = `site-settings/${safeSettingKey}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension}`;

  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: objectKey,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: "public, max-age=31536000, immutable",
  }));

  return `${R2_PUBLIC_BASE_URL}/${objectKey}`;
}