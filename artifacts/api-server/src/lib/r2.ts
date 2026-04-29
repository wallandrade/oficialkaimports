import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import crypto from "crypto";

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