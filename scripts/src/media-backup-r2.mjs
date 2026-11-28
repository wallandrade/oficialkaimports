// Incremental mirror of store media into the backup bucket.
// Lists the destination once, copies only missing keys or a different size,
// and never deletes. Streams the body so four copies stay inside a 192 MB heap.

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import {
  MEDIA_COPY_CONCURRENCY,
  MEDIA_DEST_PREFIX,
  MEDIA_SOURCE_PREFIXES,
  planMediaCopy,
} from "./media-backup-plan.mjs";

const PART_SIZE = 8 * 1024 * 1024;

const defaultLog = (...parts) => console.log(`[db-backup] ${new Date().toISOString()}`, ...parts);

function requiredEnv(env, name) {
  const value = String(env[name] || "").trim();
  if (!value) {
    const err = new Error(`falta ${name}`);
    err.copied = 0;
    err.total = 0;
    err.bytes = 0;
    err.missing = 0;
    throw err;
  }
  return value;
}

function r2Client({ accountId, endpoint, region, accessKeyId, secretAccessKey, forcePathStyle }) {
  return new S3Client({
    region: region || "auto",
    endpoint: endpoint || `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: Boolean(forcePathStyle),
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

async function listAll(client, bucket, prefix) {
  const out = [];
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: token,
      MaxKeys: 1000,
    }));
    for (const item of res.Contents || []) {
      if (!item.Key || item.Key.endsWith("/")) continue;
      out.push({ key: item.Key, size: Number(item.Size || 0) });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function* chunksOf(stream, partSize) {
  let pending = Buffer.alloc(0);
  for await (const piece of stream) {
    const buf = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
    pending = pending.length === 0 ? buf : Buffer.concat([pending, buf], pending.length + buf.length);
    while (pending.length >= partSize) {
      yield Buffer.from(pending.subarray(0, partSize));
      pending = Buffer.from(pending.subarray(partSize));
    }
  }
  if (pending.length > 0) yield pending;
}

async function putBody(client, bucket, key, body, size, contentType) {
  const typeFields = contentType ? { ContentType: contentType } : {};
  if (size <= PART_SIZE) {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: size === 0 ? Buffer.alloc(0) : body,
      ContentLength: size,
      ...typeFields,
    }));
    return;
  }

  let uploadId;
  try {
    const created = await client.send(new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ...typeFields,
    }));
    uploadId = created.UploadId;
    if (!uploadId) throw new Error("upload sem id");
    const parts = [];
    let partNumber = 0;
    for await (const chunk of chunksOf(body, PART_SIZE)) {
      partNumber += 1;
      const uploaded = await client.send(new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: chunk,
      }));
      if (!uploaded.ETag) throw new Error("parte sem ETag");
      parts.push({ ETag: uploaded.ETag, PartNumber: partNumber });
    }
    if (partNumber === 0) throw new Error("objeto sem corpo");
    await client.send(new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }));
    uploadId = undefined;
  } catch (err) {
    if (uploadId) {
      await client.send(new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
      })).catch(() => {});
    }
    throw err;
  }
}

async function copyOnce(source, dest, sourceBucket, destBucket, item) {
  if (item.size === 0) {
    await putBody(dest, destBucket, item.destKey, null, 0);
    return;
  }
  const got = await source.send(new GetObjectCommand({ Bucket: sourceBucket, Key: item.key }));
  const body = got.Body;
  if (!body) throw new Error("objeto sem corpo");
  try {
    await putBody(dest, destBucket, item.destKey, body, item.size, got.ContentType);
  } catch (err) {
    if (typeof body.destroy === "function") body.destroy();
    throw err;
  }
}

async function copyOne(source, dest, sourceBucket, destBucket, item) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await copyOnce(source, dest, sourceBucket, destBucket, item);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function copyPlanned(items, copyOneItem) {
  let cursor = 0;
  let copied = 0;
  let bytes = 0;
  const failures = [];
  const workers = Array.from({ length: Math.min(MEDIA_COPY_CONCURRENCY, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      try {
        await copyOneItem(item);
        copied += 1;
        bytes += item.size;
      } catch (err) {
        failures.push({
          key: String(item?.key || ""),
          message: err instanceof Error ? err.message : "erro ao copiar",
        });
      }
    }
  });
  if (items.length) await Promise.all(workers);
  return { copied, bytes, failures };
}

export function formatMediaCopyFailure(failures) {
  const keys = failures.map((failure) => failure.key).filter(Boolean).slice(0, 5);
  const count = failures.length;
  if (!keys.length) return `falha ao copiar ${count} chave(s)`;
  return `falha ao copiar ${count} chave(s): ${keys.join(", ")}`;
}

function statsError(message, stats) {
  const err = new Error(message);
  err.copied = stats.copied;
  err.total = stats.total;
  err.bytes = stats.bytes;
  err.missing = stats.missing;
  return err;
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, sourceClient?: import("@aws-sdk/client-s3").S3Client, destClient?: import("@aws-sdk/client-s3").S3Client, log?: (...args: unknown[]) => void }} [options]
 */
export async function runMediaBackup(options = {}) {
  const env = options.env || process.env;
  const log = options.log || defaultLog;
  const sourceBucket = requiredEnv(env, "CLOUDFLARE_R2_BUCKET_NAME");
  const destBucket = requiredEnv(env, "BACKUP_R2_BUCKET");
  const accountId = requiredEnv(env, "CLOUDFLARE_R2_ACCOUNT_ID");
  const ownSource = !options.sourceClient;
  const ownDest = !options.destClient;
  let source;
  let dest;
  try {
    source = options.sourceClient || r2Client({
      accountId,
      accessKeyId: requiredEnv(env, "CLOUDFLARE_R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv(env, "CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
    });
    const destEndpoint = String(env.BACKUP_S3_ENDPOINT || "").trim();
    dest = options.destClient || r2Client({
      accountId,
      endpoint: destEndpoint || undefined,
      region: env.BACKUP_S3_REGION || "auto",
      forcePathStyle: Boolean(destEndpoint),
      accessKeyId: requiredEnv(env, "BACKUP_R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv(env, "BACKUP_R2_SECRET_ACCESS_KEY"),
    });
    const sourceObjects = [];
    for (const prefix of MEDIA_SOURCE_PREFIXES) {
      sourceObjects.push(...await listAll(source, sourceBucket, prefix));
    }
    const destination = await listAll(dest, destBucket, MEDIA_DEST_PREFIX);
    const plan = planMediaCopy(sourceObjects, destination);
    if (plan.total === 0) {
      log("mídia copiados=0 faltando=0 bytes=0 total=0 falhas=1");
      throw statsError("origem da mídia veio vazia", { copied: 0, total: 0, bytes: 0, missing: 0 });
    }
    const result = await copyPlanned(plan.copy, (item) => copyOne(source, dest, sourceBucket, destBucket, item));
    const failed = result.failures.length;
    const examples = result.failures.slice(0, 5).map((failure) => failure.key).filter(Boolean);
    log(
      `mídia copiados=${result.copied} faltando=${plan.missing} bytes=${result.bytes} total=${plan.total} falhas=${failed}` +
        (examples.length ? ` exemplos=${examples.join(",")}` : ""),
    );
    if (failed > 0) {
      throw statsError(formatMediaCopyFailure(result.failures), {
        copied: result.copied,
        total: plan.total,
        bytes: result.bytes,
        missing: plan.missing,
      });
    }
    return { copied: result.copied, missing: plan.missing, bytes: result.bytes, total: plan.total };
  } finally {
    if (ownSource && source) source.destroy();
    if (ownDest && dest) dest.destroy();
  }
}
