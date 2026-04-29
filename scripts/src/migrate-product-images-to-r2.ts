import "dotenv/config";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db, productsTable } from "../../lib/db/src/index";

const R2_ACCOUNT_ID = String(process.env.CLOUDFLARE_R2_ACCOUNT_ID || "").trim();
const R2_ACCESS_KEY_ID = String(process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || "").trim();
const R2_SECRET_ACCESS_KEY = String(process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || "").trim();
const R2_BUCKET_NAME = String(process.env.CLOUDFLARE_R2_BUCKET_NAME || "").trim();
const R2_PUBLIC_BASE_URL = String(process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
const PRODUCT_IDS = String(process.env.PRODUCT_IMAGE_MIGRATION_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function assertR2Config(): void {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !R2_PUBLIC_BASE_URL) {
    throw new Error(
      "Defina CLOUDFLARE_R2_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, CLOUDFLARE_R2_BUCKET_NAME e CLOUDFLARE_R2_PUBLIC_BASE_URL antes de rodar a migração.",
    );
  }
}

function getR2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

function parseImageDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string; extension: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Imagem não está em data URL válida.");
  }

  const mimeType = match[1].toLowerCase();
  const extension = mimeType === "image/png"
    ? "png"
    : mimeType === "image/webp"
      ? "webp"
      : mimeType === "image/gif"
        ? "gif"
        : "jpg";

  return {
    buffer: Buffer.from(match[2], "base64"),
    mimeType,
    extension,
  };
}

async function main() {
  assertR2Config();
  const r2 = getR2Client();

  const allProducts = await db.select().from(productsTable);
  const candidates = allProducts.filter((product) => {
    const image = String(product.image || "").trim();
    if (!image.startsWith("data:image/")) return false;
    if (PRODUCT_IDS.length === 0) return true;
    return PRODUCT_IDS.includes(product.id);
  });

  if (candidates.length === 0) {
    console.log("Nenhuma imagem legada em base64 encontrada para migrar.");
    return;
  }

  console.log(`Migrando ${candidates.length} produto(s) para o Cloudflare R2...`);

  let migrated = 0;
  for (const product of candidates) {
    const image = String(product.image || "").trim();
    const { buffer, mimeType, extension } = parseImageDataUrl(image);
    const objectKey = `products/${product.id}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension}`;
    const imageUrl = `${R2_PUBLIC_BASE_URL}/${objectKey}`;

    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: objectKey,
      Body: buffer,
      ContentType: mimeType,
      CacheControl: "public, max-age=31536000, immutable",
    }));

    await db
      .update(productsTable)
      .set({ image: imageUrl, updatedAt: new Date() })
      .where(eq(productsTable.id, product.id));

    migrated += 1;
    console.log(`[${migrated}/${candidates.length}] ${product.id} -> ${imageUrl}`);
  }

  console.log(`Migração concluída. ${migrated} produto(s) atualizados.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Falha na migração de imagens de produto para R2:", error);
    process.exit(1);
  });