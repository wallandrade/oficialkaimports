#!/usr/bin/env node
// Daily backup orchestrator. The DigitalOcean run command stays:
//   node --max-old-space-size=192 scripts/src/db-backup-r2.mjs
//
// 1. MySQL dump -> gzip -> multipart upload under mysql/ (this file).
// 2. Incremental media mirror into media/ (scripts/src/media-backup-r2.mjs).
// A failure in one part does not skip the other. Then it writes backup_last_status
// on site_settings for tenant_loja1 and, if anything failed, sends one Z-API
// send-text. Exit code 1 when either part or the heartbeat failed.
//
// Streams: MySQL rows -> SQL text -> gzip -> 8 MiB multipart parts -> R2.
// Memory stays bounded, including four in-flight media copies on a 192 MB heap.
//
// Required env:
//   DATABASE_URL                     mysql://user:pass@host:port/db?ssl-mode=REQUIRED
//   BACKUP_R2_ACCESS_KEY_ID          R2 token scoped to the backup bucket (Object Read & Write)
//   BACKUP_R2_SECRET_ACCESS_KEY
//   BACKUP_R2_BUCKET                 e.g. kaimports-db-backups
//   CLOUDFLARE_R2_ACCOUNT_ID         (or BACKUP_S3_ENDPOINT for any S3-compatible target)
//   CLOUDFLARE_R2_ACCESS_KEY_ID      source media bucket (read)
//   CLOUDFLARE_R2_SECRET_ACCESS_KEY
//   CLOUDFLARE_R2_BUCKET_NAME        e.g. oficialkaimports-media
// Optional env:
//   DATABASE_CA_CERT                 PEM; when set, TLS is verified against it
//   BACKUP_KEY_PREFIX                default "mysql/"
//   BACKUP_TIME_ZONE                 default TZ or America/Sao_Paulo (used in the object key)
//   BACKUP_OUTPUT_FILE               local dump only: skips media, heartbeat and alert
//   BACKUP_ALERT_PHONES              comma-separated digits starting with 55
//   ZAPI_MAIN_INSTANCE_ID            direct send-text when a part fails
//   ZAPI_MAIN_TOKEN
//   ZAPI_CLIENT_TOKEN
//   WHATSAPP_ZAPI_DRY_RUN            1/true/yes: do not call Z-API
//   WHATSAPP_ZAPI_FAKE_ONLY          1/true/yes: only phones starting with 550000
//
// Restore:  gunzip -c FILE.sql.gz | mysql -h HOST -P PORT -u USER -p --ssl-mode=REQUIRED DBNAME

import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import mysql from "mysql2";
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { runMediaBackup } from "./media-backup-r2.mjs";
import {
  claimBackupAlertDate,
  clipBackupError,
  finishBackupAlertClaim,
  formatBackupAlertText,
  parseBackupAlertPhones,
  saoPauloParts,
  sendBackupAlert,
} from "./backup-alert.mjs";

const BACKUP_TENANT_ID = "tenant_loja1";
const BACKUP_STATUS_KEY = "backup_last_status";

const PART_SIZE = 8 * 1024 * 1024; // R2: all parts except the last must be the same size
const MAX_STMT_BYTES = 1024 * 1024; // max size of one multi-row INSERT

const log = (...a) => console.log(`[db-backup] ${new Date().toISOString()}`, ...a);
const fail = (msg) => {
  throw new Error(msg);
};
const env = (k, required = true) => {
  const v = process.env[k];
  if (required && !v) fail(`Missing env var ${k}`);
  return v;
};
let activeRowStream = null; // destroyed on connection loss so the dump loop throws
const fmtBytes = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB (${n} bytes)`;

function objectKey() {
  const tz = process.env.BACKUP_TIME_ZONE || process.env.TZ || "America/Sao_Paulo";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  const prefix = process.env.BACKUP_KEY_PREFIX ?? "mysql/";
  return `${prefix}${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}.sql.gz`;
}

function connectionOptions() {
  const url = new URL(env("DATABASE_URL"));
  const sslMode = (url.searchParams.get("ssl-mode") || url.searchParams.get("sslmode") || "").toUpperCase();
  const ca = process.env.DATABASE_CA_CERT;
  let ssl;
  if (ca) ssl = { ca, rejectUnauthorized: true };
  else if (sslMode && sslMode !== "DISABLED") ssl = { rejectUnauthorized: false };
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    ssl,
    charset: "utf8mb4_unicode_ci",
    timezone: "Z",
    dateStrings: true, // keep DATE/DATETIME/TIMESTAMP exactly as stored
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    rowsAsArray: true,
    multipleStatements: false,
    connectTimeout: 30000,
    // JSON columns: keep the raw text instead of parsing into objects.
    typeCast: (field, next) => (field.type === "JSON" ? field.string("utf8") : next()),
  };
}

const qid = (name) => "`" + String(name).replace(/`/g, "``") + "`";
const stripDefiner = (sql) => sql.replace(/\sDEFINER=`[^`]*`@`[^`]*`/g, "");

function sqlValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (Buffer.isBuffer(v)) return v.length ? "0x" + v.toString("hex") : "''";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return v.toString();
  return mysql.escape(String(v));
}

/** Async generator yielding the SQL dump as text chunks. */
async function* dumpSql(conn, stats) {
  const q = (sql, params) => conn.promise().query({ sql, values: params, rowsAsArray: false });
  const [[{ db, ver }]] = await q("SELECT DATABASE() AS db, VERSION() AS ver");
  log(`connected to ${db} (MySQL ${ver})`);

  await q("SET SESSION time_zone = '+00:00'");
  await q("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await q("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");

  yield [
    `-- KA Imports MySQL backup of \`${db}\``,
    `-- Server version: ${ver}`,
    `-- Started: ${new Date().toISOString()}`,
    "SET NAMES utf8mb4;",
    "SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;",
    "SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;",
    "SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO';",
    "SET @OLD_TIME_ZONE=@@TIME_ZONE, TIME_ZONE='+00:00';",
    "",
  ].join("\n") + "\n";

  const [tables] = await q(
    "SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME",
  );
  const baseTables = tables.filter((t) => t.type === "BASE TABLE").map((t) => t.name);
  const views = tables.filter((t) => t.type === "VIEW").map((t) => t.name);

  for (const table of baseTables) {
    const [[create]] = await q(`SHOW CREATE TABLE ${qid(table)}`);
    yield `--\n-- Table ${qid(table)}\n--\nDROP TABLE IF EXISTS ${qid(table)};\n${create["Create Table"]};\n\n`;

    const [cols] = await q(
      "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND EXTRA NOT LIKE '%GENERATED%' ORDER BY ORDINAL_POSITION",
      [table],
    );
    const colList = cols.map((c) => qid(c.name)).join(", ");
    const head = `INSERT INTO ${qid(table)} (${colList}) VALUES\n`;
    let batch = [];
    let batchBytes = 0;
    let rows = 0;
    const stream = conn
      .query({ sql: `SELECT ${colList} FROM ${qid(table)}`, rowsAsArray: true })
      .stream({ highWaterMark: 500 });
    activeRowStream = stream;
    for await (const row of stream) {
      const tuple = "(" + row.map(sqlValue).join(",") + ")";
      batch.push(tuple);
      batchBytes += tuple.length + 2;
      rows++;
      if (batchBytes >= MAX_STMT_BYTES) {
        yield head + batch.join(",\n") + ";\n";
        batch = [];
        batchBytes = 0;
      }
    }
    activeRowStream = null;
    if (batch.length) yield head + batch.join(",\n") + ";\n";
    yield "\n";
    stats.tables++;
    stats.rows += rows;
    log(`  ${table}: ${rows} rows`);
  }

  for (const view of views) {
    const [[v]] = await q(`SHOW CREATE VIEW ${qid(view)}`);
    yield `DROP VIEW IF EXISTS ${qid(view)};\n${stripDefiner(v["Create View"])};\n\n`;
    stats.views++;
  }

  const [triggers] = await q("SHOW TRIGGERS");
  for (const t of triggers) {
    const [[tc]] = await q(`SHOW CREATE TRIGGER ${qid(t.Trigger)}`);
    yield `DROP TRIGGER IF EXISTS ${qid(t.Trigger)};\nDELIMITER ;;\n${stripDefiner(tc["SQL Original Statement"])};;\nDELIMITER ;\n\n`;
    stats.triggers++;
  }

  const [[{ n: routines }]] = await q(
    "SELECT COUNT(*) AS n FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()",
  );
  if (Number(routines) > 0) log(`WARNING: ${routines} stored routines exist and are NOT included in this dump`);

  await q("COMMIT");
  yield [
    "SET TIME_ZONE=@OLD_TIME_ZONE;",
    "SET SQL_MODE=@OLD_SQL_MODE;",
    "SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;",
    "SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;",
    `-- Dump completed: ${new Date().toISOString()}`,
    "",
  ].join("\n");
}

/** Writable that uploads to S3/R2 with fixed-size multipart parts. */
function multipartSink({ client, bucket, key, stats }) {
  let uploadId;
  let partNumber = 0;
  const parts = [];
  let pending = [];
  let pendingBytes = 0;
  const hash = createHash("sha256");

  async function ensureUpload() {
    if (uploadId) return;
    const res = await client.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: "application/gzip" }),
    );
    uploadId = res.UploadId || fail("CreateMultipartUpload returned no UploadId");
  }
  async function sendPart(body) {
    await ensureUpload();
    partNumber++;
    const res = await client.send(
      new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, Body: body }),
    );
    if (!res.ETag) fail(`UploadPart ${partNumber} returned no ETag`);
    parts.push({ ETag: res.ETag, PartNumber: partNumber });
    log(`  uploaded part ${partNumber} (${fmtBytes(body.length)})`);
  }

  const sink = new Writable({
    highWaterMark: 1024 * 1024,
    write(chunk, _enc, cb) {
      hash.update(chunk);
      stats.compressedBytes += chunk.length;
      pending.push(chunk);
      pendingBytes += chunk.length;
      (async () => {
        while (pendingBytes >= PART_SIZE) {
          const all = Buffer.concat(pending, pendingBytes);
          const body = all.subarray(0, PART_SIZE);
          const rest = all.subarray(PART_SIZE);
          pending = rest.length ? [Buffer.from(rest)] : [];
          pendingBytes = rest.length;
          await sendPart(Buffer.from(body));
        }
      })().then(() => cb(), cb);
    },
    final(cb) {
      (async () => {
        const last = Buffer.concat(pending, pendingBytes);
        pending = [];
        if (last.length || partNumber === 0) await sendPart(last);
        await client.send(
          new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: { Parts: parts },
          }),
        );
        stats.sha256 = hash.digest("hex");
      })().then(() => cb(), cb);
    },
  });
  sink.abort = async () => {
    if (!uploadId) return;
    try {
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
      log("multipart upload aborted");
    } catch (e) {
      log(`could not abort multipart upload: ${e.message}`);
    }
  };
  return sink;
}

async function runDatabaseBackup() {
  const started = Date.now();
  const stats = { tables: 0, views: 0, triggers: 0, rows: 0, rawBytes: 0, compressedBytes: 0, sha256: "" };
  const outFile = process.env.BACKUP_OUTPUT_FILE;
  const key = objectKey();

  let client, bucket, sink;
  if (outFile) {
    log(`writing to local file ${outFile}`);
    const hash = createHash("sha256");
    const file = createWriteStream(outFile);
    sink = new Writable({
      write(chunk, _e, cb) {
        hash.update(chunk);
        stats.compressedBytes += chunk.length;
        file.write(chunk) ? cb() : file.once("drain", cb);
      },
      final(cb) {
        stats.sha256 = hash.digest("hex");
        file.end(cb);
      },
    });
  } else {
    bucket = env("BACKUP_R2_BUCKET");
    const endpoint =
      process.env.BACKUP_S3_ENDPOINT || `https://${env("CLOUDFLARE_R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
    client = new S3Client({
      region: process.env.BACKUP_S3_REGION || "auto",
      endpoint,
      forcePathStyle: Boolean(process.env.BACKUP_S3_ENDPOINT),
      credentials: {
        accessKeyId: env("BACKUP_R2_ACCESS_KEY_ID"),
        secretAccessKey: env("BACKUP_R2_SECRET_ACCESS_KEY"),
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    log(`uploading to ${bucket}/${key}`);
    sink = multipartSink({ client, bucket, key, stats });
  }

  const conn = mysql.createConnection(connectionOptions());
  let source;
  let connError;
  conn.on("error", (e) => {
    connError = e;
    log(`connection error: ${clipBackupError(e?.message)}`);
    activeRowStream?.destroy(e);
    source?.destroy(e);
  });
  // A lost connection can end the row stream without an error event; make sure that
  // can never look like success.
  conn.on("end", () => {
    if (!finishedDump) {
      connError ??= new Error("MySQL connection ended before the dump finished");
      activeRowStream?.destroy(connError);
      source?.destroy(connError);
    }
  });
  let finishedDump = false;
  try {
    source = Readable.from(
      (async function* () {
        for await (const text of dumpSql(conn, stats)) {
          const buf = Buffer.from(text, "utf8");
          stats.rawBytes += buf.length;
          yield buf;
        }
        if (connError) throw connError;
        finishedDump = true;
      })(),
    );
    await pipeline(source, createGzip({ level: 6 }), sink);
    if (connError || !finishedDump) throw connError || new Error("dump did not finish");
  } catch (err) {
    if (sink.abort) await sink.abort();
    throw err;
  } finally {
    conn.destroy();
  }

  if (client) {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (Number(head.ContentLength) !== stats.compressedBytes) {
      fail(`size mismatch: uploaded ${head.ContentLength} bytes, expected ${stats.compressedBytes}`);
    }
  }
  if (stats.tables === 0) fail("dump contains 0 tables; refusing to call this a successful backup");

  log(
    `OK ${outFile || `${bucket}/${key}`}: ${stats.tables} tables, ${stats.views} views, ${stats.triggers} triggers, ` +
      `${stats.rows} rows; raw ${fmtBytes(stats.rawBytes)}, gzip ${fmtBytes(stats.compressedBytes)}, ` +
      `sha256 ${stats.sha256}, ${((Date.now() - started) / 1000).toFixed(1)}s, max RSS ${Math.round(process.resourceUsage().maxRSS / 1024)} MiB`,
  );
  return { key: outFile ? null : key, bytes: stats.compressedBytes };
}

function mediaStats(err) {
  return {
    copied: Number(err?.copied) || 0,
    total: Number(err?.total) || 0,
    bytes: Number(err?.bytes) || 0,
  };
}

async function writeHeartbeat(payload) {
  const conn = mysql.createConnection(connectionOptions());
  conn.on("error", () => {});
  const json = JSON.stringify(payload);
  try {
    const [rows] = await conn.promise().query(
      "SELECT tenant_id AS tenantId FROM site_settings WHERE `key` = ? LIMIT 1",
      [BACKUP_STATUS_KEY],
    );
    const current = Array.isArray(rows) && rows[0] ? String(rows[0].tenantId || "").trim() : "";
    if (Array.isArray(rows) && rows.length > 0 && current && current !== BACKUP_TENANT_ID) {
      throw new Error("status de backup pertence a outra loja");
    }
    if (Array.isArray(rows) && rows.length > 0) {
      const [updated] = await conn.promise().query(
        "UPDATE site_settings SET `value` = ?, tenant_id = ?, updated_at = UTC_TIMESTAMP() WHERE `key` = ? AND (tenant_id = ? OR tenant_id IS NULL OR tenant_id = '')",
        [json, BACKUP_TENANT_ID, BACKUP_STATUS_KEY, BACKUP_TENANT_ID],
      );
      if (!updated || Number(updated.affectedRows) < 1) {
        throw new Error("não gravou o status do backup");
      }
      return;
    }
    await conn.promise().query(
      "INSERT INTO site_settings (`key`, `value`, tenant_id, updated_at) VALUES (?, ?, ?, UTC_TIMESTAMP())",
      [BACKUP_STATUS_KEY, json, BACKUP_TENANT_ID],
    );
  } finally {
    conn.destroy();
  }
}

async function withMysql(fn) {
  const conn = mysql.createConnection(connectionOptions());
  conn.on("error", () => {});
  try {
    return await fn((sql, params) => conn.promise().query(sql, params));
  } finally {
    conn.destroy();
  }
}

async function orchestrate() {
  if (process.env.BACKUP_OUTPUT_FILE) {
    log("arquivo local: só o dump, sem mídia e sem alerta");
    await runDatabaseBackup();
    return false;
  }

  const startedAt = new Date();
  const startedClock = saoPauloParts(startedAt);
  try {
    await writeHeartbeat({
      status: "running",
      dateSP: startedClock.dateSP,
      startedAt: startedAt.toISOString(),
    });
    log("heartbeat status=running");
  } catch (err) {
    const message = err instanceof Error ? err.message : "não gravou o status do backup";
    log(`registro FALHOU: ${clipBackupError(message)}`);
  }

  const failures = [];
  let db = { ok: false, key: null, bytes: null };
  try {
    const dumped = await runDatabaseBackup();
    db = { ok: true, key: dumped.key, bytes: dumped.bytes };
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro no banco";
    db = { ok: false, key: null, bytes: null };
    failures.push({ stage: "banco", error: message });
    log(`banco FALHOU: ${clipBackupError(message)}`);
  }

  let media = { ok: false, copied: 0, total: 0 };
  try {
    const copied = await runMediaBackup();
    media = { ok: true, copied: copied.copied, total: copied.total };
  } catch (err) {
    const stats = mediaStats(err);
    const message = err instanceof Error ? err.message : "erro na mídia";
    media = { ok: false, copied: stats.copied, total: stats.total };
    failures.push({ stage: "mídia", error: message });
    log(`mídia FALHOU: ${clipBackupError(message)}`);
  }

  const finishedAt = new Date();
  const clock = saoPauloParts(finishedAt);
  let heartbeatOk = true;
  try {
    await writeHeartbeat({
      status: failures.length ? "failed" : "ok",
      dateSP: clock.dateSP,
      dbOk: db.ok,
      dumpKey: db.ok ? db.key : null,
      dumpBytes: db.ok ? db.bytes : null,
      mediaOk: media.ok,
      copied: media.copied,
      total: media.total,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    });
    log(`heartbeat dbOk=${db.ok} mediaOk=${media.ok}`);
  } catch (err) {
    heartbeatOk = false;
    const message = err instanceof Error ? err.message : "não gravou o status do backup";
    failures.push({ stage: "registro", error: message });
    log(`registro FALHOU: ${clipBackupError(message)}`);
  }

  log(`fim banco=${db.ok ? "ok" : "falha"} midia=${media.ok ? "ok" : "falha"} registro=${heartbeatOk ? "ok" : "falha"}`);
  if (failures.length === 0) return false;

  const phones = parseBackupAlertPhones(process.env.BACKUP_ALERT_PHONES);
  if (phones.length === 0) {
    log("aviso: BACKUP_ALERT_PHONES ausente; alerta não enviado");
    return true;
  }
  const message = formatBackupAlertText({
    stages: failures.map((failure) => failure.stage),
    details: failures,
    now: finishedAt,
  });
  let claim = null;
  try {
    claim = await withMysql((query) => claimBackupAlertDate(query, clock.dateSP));
  } catch (err) {
    const detail = err instanceof Error ? err.message : "erro";
    log(`aviso: não registrei o alerta: ${clipBackupError(detail)}`);
    return true;
  }
  if (!claim) {
    log("alerta já registrado hoje");
    return true;
  }
  let delivered = false;
  try {
    const sent = await sendBackupAlert({ env: process.env, phones, message, log });
    delivered = Boolean(sent?.dryRun) || Number(sent?.sent) > 0;
  } catch {
    log("aviso: alerta não saiu");
  }
  try {
    await withMysql((query) => finishBackupAlertClaim(query, clock.dateSP, claim, delivered ? "sent" : "failed"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : "erro";
    log(`aviso: não fechei o alerta: ${clipBackupError(detail)}`);
  }
  return true;
}

// Anything that ends the process without reaching the success path is a failure.
process.exitCode = 1;
let finished = false;
process.on("beforeExit", () => {
  if (!finished) console.error("[db-backup] FAILED: process ended before the backup completed");
});

orchestrate().then(
  (failed) => {
    finished = true;
    process.exit(failed ? 1 : 0);
  },
  (err) => {
    finished = true;
    const message = err instanceof Error ? err.message : "erro";
    console.error(`[db-backup] FAILED: ${clipBackupError(message)}`);
    process.exit(1);
  },
);
