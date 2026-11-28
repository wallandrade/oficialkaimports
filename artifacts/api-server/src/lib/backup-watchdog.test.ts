import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BACKUP_ALERT_DATE_KEY,
  BACKUP_RUNNING_GRACE_MS,
  BACKUP_STATUS_KEY,
  backupAlertClaimBlocks,
  clipBackupError,
  decideBackupWatchdog,
  formatBackupAlertText,
  nextBackupAlertClaim,
  parseBackupAlertPhones,
  parseBackupLastStatus,
} from "./backup-watchdog";

const TODAY = new Date("2026-11-28T15:00:00.000Z"); // 12:00 SP
const BEFORE = new Date("2026-11-28T06:59:00.000Z"); // 03:59 SP
const OPEN = new Date("2026-11-28T07:00:00.000Z"); // 04:00 SP
const SIX = new Date("2026-11-28T09:00:00.000Z"); // 06:00 SP
const AFTER = new Date("2026-11-28T15:01:00.000Z"); // 12:01 SP

const okStatus = {
  dateSP: "2026-11-28",
  dbOk: true,
  mediaOk: true,
  dumpKey: "mysql/2026-11-28_0300.sql.gz",
  dumpBytes: 10,
  copied: 0,
  total: 4,
  finishedAt: "2026-11-28T06:10:00.000Z",
};

test("telefones do alerta: só dígitos com 55 e 12 ou 13 posições", () => {
  assert.deepEqual(
    parseBackupAlertPhones("5511999991234, +55 (21) 98888-7777, 11999991234, abc, 5511999991234"),
    ["5511999991234", "5521988887777"],
  );
  assert.deepEqual(parseBackupAlertPhones(""), []);
  assert.deepEqual(parseBackupAlertPhones(null), []);
  assert.deepEqual(parseBackupAlertPhones("55, 5511999"), []);
});

test("texto do alerta corta o erro em 200 e tira segredo, SQL e número longo", () => {
  const long = "x".repeat(250);
  const clipped = clipBackupError(long);
  assert.equal(clipped.length, 200);
  assert.equal(clipBackupError("mysql://user:secret@host/db falhou"), "[redacted] falhou");
  assert.equal(clipBackupError("INSERT INTO site_settings (key) VALUES ('x')"), "erro no banco");
  assert.equal(clipBackupError("falha 5511999991234"), "falha [numero]");
  const text = formatBackupAlertText({
    stages: ["banco", "mídia"],
    details: [{ stage: "banco", error: long }, { stage: "mídia", error: "origem da mídia veio vazia" }],
    now: OPEN,
  });
  assert.equal(text.startsWith("[Ka Imports] Backup falhou\nEtapa: banco, mídia\n"), true);
  assert.equal(text.includes("x".repeat(201)), false);
  assert.equal(text.endsWith("Hora: 28/11/2026 04:00"), true);
  assert.equal(text.includes("origem da mídia veio vazia"), true);
});

test("watchdog fica quieto fora da janela e quando o backup de hoje está ok", () => {
  assert.equal(decideBackupWatchdog({ now: BEFORE, status: null, lastAlertDateSP: null }).alert, false);
  assert.equal(decideBackupWatchdog({ now: AFTER, status: "unreachable", lastAlertDateSP: null }).reason, "outside_window");
  assert.equal(decideBackupWatchdog({ now: OPEN, status: okStatus, lastAlertDateSP: null }).reason, "ok");
  assert.equal(decideBackupWatchdog({ now: TODAY, status: okStatus, lastAlertDateSP: null }).reason, "ok");
});

test("watchdog alerta sem status de hoje, com falha ou com banco inacessível, uma vez por dia", () => {
  const earlyMissing = decideBackupWatchdog({ now: OPEN, status: null, lastAlertDateSP: null });
  assert.equal(earlyMissing.alert, false);
  assert.equal(earlyMissing.reason, "running");

  const missing = decideBackupWatchdog({ now: SIX, status: null, lastAlertDateSP: null });
  assert.equal(missing.alert, true);
  if (missing.alert) assert.equal(missing.error, "backup de hoje não encontrado");

  const earlyStale = decideBackupWatchdog({
    now: OPEN,
    status: { ...okStatus, dateSP: "2026-11-27" },
    lastAlertDateSP: null,
  });
  assert.equal(earlyStale.alert, false);

  const stale = decideBackupWatchdog({
    now: SIX,
    status: { ...okStatus, dateSP: "2026-11-27" },
    lastAlertDateSP: null,
  });
  assert.equal(stale.alert, true);
  if (stale.alert) assert.equal(stale.reason, "stale");

  const dbFailed = decideBackupWatchdog({
    now: OPEN,
    status: { ...okStatus, dbOk: false },
    lastAlertDateSP: null,
  });
  assert.equal(dbFailed.alert, true);
  if (dbFailed.alert) assert.equal(dbFailed.stage, "banco");

  const mediaFailed = decideBackupWatchdog({
    now: OPEN,
    status: { ...okStatus, mediaOk: false },
    lastAlertDateSP: null,
  });
  assert.equal(mediaFailed.alert, true);
  if (mediaFailed.alert) assert.equal(mediaFailed.stage, "mídia");

  const both = decideBackupWatchdog({
    now: OPEN,
    status: { ...okStatus, dbOk: false, mediaOk: false },
    lastAlertDateSP: null,
  });
  assert.equal(both.alert, true);
  if (both.alert) assert.equal(both.stage, "banco, mídia");

  const earlyDown = decideBackupWatchdog({ now: OPEN, status: "unreachable", lastAlertDateSP: null });
  assert.equal(earlyDown.alert, false);
  const down = decideBackupWatchdog({ now: SIX, status: "unreachable", lastAlertDateSP: null });
  assert.equal(down.alert, true);
  if (down.alert) assert.equal(down.error, "banco inacessível");

  const again = decideBackupWatchdog({
    now: OPEN,
    status: "unreachable",
    lastAlertDateSP: "2026-11-28",
  });
  assert.equal(again.reason, "already_alerted");
  assert.equal(parseBackupLastStatus("{"), null);
  assert.equal(parseBackupLastStatus("null"), null);
  assert.equal(parseBackupLastStatus('{"dateSP":"2026-11-28"}')?.dateSP, "2026-11-28");
});

test("running de hoje dentro de 3h não alerta; depois de 3h avisa travado", () => {
  const fresh = decideBackupWatchdog({
    now: OPEN,
    status: {
      status: "running",
      dateSP: "2026-11-28",
      startedAt: new Date(OPEN.getTime() - 60 * 60 * 1000).toISOString(),
    },
    lastAlertDateSP: null,
  });
  assert.equal(fresh.alert, false);
  assert.equal(fresh.reason, "running");

  const stuck = decideBackupWatchdog({
    now: OPEN,
    status: {
      status: "running",
      dateSP: "2026-11-28",
      startedAt: new Date(OPEN.getTime() - BACKUP_RUNNING_GRACE_MS).toISOString(),
    },
    lastAlertDateSP: null,
  });
  assert.equal(stuck.alert, true);
  if (stuck.alert) {
    assert.equal(stuck.reason, "stuck");
    assert.equal(stuck.error, "backup travado");
  }

  const yesterdayEarly = decideBackupWatchdog({
    now: OPEN,
    status: { status: "running", dateSP: "2026-11-27", startedAt: "2026-11-27T06:00:00.000Z" },
    lastAlertDateSP: null,
  });
  assert.equal(yesterdayEarly.reason, "running");
  const yesterday = decideBackupWatchdog({
    now: SIX,
    status: { status: "running", dateSP: "2026-11-27", startedAt: "2026-11-27T06:00:00.000Z" },
    lastAlertDateSP: null,
  });
  assert.equal(yesterday.reason, "stale");

  const now = 1_700_000_000_000;
  assert.equal(nextBackupAlertClaim("2026-11-28", "2026-11-28", now), null);
  assert.deepEqual(nextBackupAlertClaim("2026-11-28#2", "2026-11-28", now), {
    next: `2026-11-28@3@${now}`,
    failedValue: "2026-11-28#3",
  });
  assert.equal(nextBackupAlertClaim("2026-11-28#3", "2026-11-28", now), null);
  assert.equal(nextBackupAlertClaim(`2026-11-28@1@${now - 1000}`, "2026-11-28", now), null);
  assert.equal(nextBackupAlertClaim(`2026-11-28@1@${now - 16 * 60 * 1000}`, "2026-11-28", now)?.next, `2026-11-28@1@${now}`);
  assert.equal(backupAlertClaimBlocks("2026-11-28@1@1", "2026-11-28"), false);
  assert.equal(backupAlertClaimBlocks("2026-11-28#1", "2026-11-28"), false);
  assert.equal(
    clipBackupError("Access denied for user 'doadmin'@'db-mysql-nyc3-1.ondigitalocean.com'"),
    "Access denied for user '[redacted]'@'[redacted]'",
  );
});

test("as chaves do backup não entram na vitrine nem no allowlist do admin", () => {
  const settings = readFileSync(new URL("../routes/settings.ts", import.meta.url), "utf8");
  const publicBlock = settings.slice(settings.indexOf("const PUBLIC_KEYS"), settings.indexOf("const ALLOWED_KEYS"));
  const allowedBlock = settings.slice(settings.indexOf("const ALLOWED_KEYS"), settings.indexOf("const IMAGE_SETTING_KEYS"));
  assert.equal(publicBlock.includes(BACKUP_STATUS_KEY), false);
  assert.equal(publicBlock.includes(BACKUP_ALERT_DATE_KEY), false);
  assert.equal(allowedBlock.includes(BACKUP_STATUS_KEY), false);
  assert.equal(allowedBlock.includes(BACKUP_ALERT_DATE_KEY), false);
  const storefront = readFileSync(new URL("../../../ka-imports/src/lib/public-settings.ts", import.meta.url), "utf8");
  assert.equal(storefront.includes(BACKUP_STATUS_KEY), false);
  assert.equal(storefront.includes(BACKUP_ALERT_DATE_KEY), false);
});
