import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GROUP_MODERATION_LOG_INSERT,
  clearGroupModerationCache,
  detectGroupInvite,
  groupModerationAllowed,
  handleGroupModeration,
  isGroupModerationCandidate,
  moderationMode,
  parseModerationGroupIds,
  type GroupModerationLogRow,
} from "./whatsapp-group-moderation";

const GROUP = "120363000000000001-group";
const OTHER = "120363000000000002-group";
const MEMBER = "5511988887777";
const STORE = "5535992119139";
const ADMIN = "5511977776666";
const ALLOW = "5511966665555";
const CREDS = {
  ZAPI_MAIN_INSTANCE_ID: "inst",
  ZAPI_MAIN_TOKEN: "tok",
  ZAPI_CLIENT_TOKEN: "cli",
};

type Call = { method: string; suffix: string; body: unknown };

function inviteBody(overrides: Record<string, unknown> = {}) {
  return {
    type: "ReceivedCallback",
    isGroup: true,
    fromMe: false,
    phone: GROUP,
    participantPhone: MEMBER,
    connectedPhone: STORE,
    messageId: "msg-1",
    chatName: "nome qualquer",
    text: { message: "entra aqui https://chat.whatsapp.com/ABC123" },
    ...overrides,
  };
}

function metadata(extraAdmins: string[] = []) {
  return {
    owner: STORE,
    participants: [
      { phone: MEMBER, isAdmin: false },
      { phone: STORE, isAdmin: true },
      ...extraAdmins.map((phone) => ({ phone, isAdmin: true })),
    ],
  };
}

function mockFetch(extraAdmins: string[] = [], metadataStatus = 200) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const afterToken = url.split("/token/")[1] || "";
    const suffix = `/${afterToken.split("/").slice(1).join("/")}`;
    let body: unknown = null;
    if (typeof init?.body === "string") body = JSON.parse(init.body) as unknown;
    calls.push({ method: String(init?.method || "GET"), suffix, body });
    if (suffix.startsWith("/group-metadata/")) {
      return new Response(JSON.stringify(metadata(extraAdmins)), { status: metadataStatus });
    }
    return new Response("{}", { status: 200 });
  };
  return { calls, fetchImpl };
}

function memoryLog() {
  const rows: GroupModerationLogRow[] = [];
  return {
    rows,
    claimLog: async (row: GroupModerationLogRow) => {
      if (rows.some((item) => item.messageId === row.messageId)) return "duplicate" as const;
      rows.push({ ...row });
      return "claimed" as const;
    },
    finishLog: async (messageId: string, action: string) => {
      const row = rows.find((item) => item.messageId === messageId);
      if (row) row.action = action;
    },
  };
}

async function run(body: unknown, options: {
  env?: NodeJS.ProcessEnv;
  settings?: Record<string, string>;
  extraAdmins?: string[];
  metadataStatus?: number;
} = {}) {
  clearGroupModerationCache();
  const log = memoryLog();
  const zapi = mockFetch(options.extraAdmins, options.metadataStatus);
  const result = await handleGroupModeration(body, {
    env: { ...CREDS, ...options.env },
    settings: options.settings ?? {},
    fetchImpl: zapi.fetchImpl,
    claimLog: log.claimLog,
    finishLog: log.finishLog,
  });
  return { result, calls: zapi.calls, rows: log.rows };
}

function methods(calls: Call[]): string[] {
  return calls.map((call) => call.method);
}

test("o modo nasce desligado e o dry run ganha da remoção", () => {
  assert.equal(moderationMode({}), "off");
  assert.equal(moderationMode({ enabledSetting: "1" }), "enforce");
  assert.equal(moderationMode({ enabledEnv: "0", enabledSetting: "1" }), "off");
  assert.equal(moderationMode({ dryEnv: "1" }), "dry_run");
  assert.equal(moderationMode({ enabledEnv: "1", dryEnv: "1" }), "dry_run");
  assert.equal(parseModerationGroupIds("Ka imports 1").ok, false);
});

test("convite no grupo da lista apaga a mensagem e remove a pessoa", async () => {
  const { result, calls, rows } = await run(inviteBody(), {
    env: { WHATSAPP_GROUP_MODERATION_ENABLED: "1", WHATSAPP_GROUP_MODERATION_GROUP_IDS: GROUP },
  });
  assert.equal(result.action, "deleted_and_removed");
  assert.equal(result.ok, true);
  assert.deepEqual(methods(calls), ["GET", "DELETE", "POST"]);
  assert.equal(calls[0]?.suffix.startsWith("/group-metadata/"), true);
  assert.match(calls[1]?.suffix || "", /\/messages\?/);
  assert.match(calls[1]?.suffix || "", /owner=false/);
  assert.equal(calls[2]?.suffix, "/remove-participant");
  assert.deepEqual(calls[2]?.body, { groupId: GROUP, phones: [MEMBER] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.reason, "invite");
  assert.equal(rows[0]?.action, "deleted_and_removed");
  assert.equal(rows[0]?.participantTail, "7777");
  const dumped = JSON.stringify(rows);
  assert.equal(dumped.includes(MEMBER), false);
  assert.equal(dumped.includes("chat.whatsapp"), false);
  assert.equal(dumped.includes("nome qualquer"), false);
});

test("legenda com convite também entra e link comum não remove", async () => {
  const caption = await run(inviteBody({
    text: undefined,
    image: { caption: "grupo chat.whatsapp.com/XYZ", imageUrl: "https://api.z-api.io/file.jpg" },
  }), {
    env: { WHATSAPP_GROUP_MODERATION_ENABLED: "1", WHATSAPP_GROUP_MODERATION_GROUP_IDS: GROUP },
  });
  assert.equal(caption.result.action, "deleted_and_removed");
  assert.equal(JSON.stringify(caption.rows).includes("imageUrl"), false);

  const common = await run(inviteBody({ text: { message: "https://wa.me/5511999999999 e https://ka-imports.com" } }), {
    env: { WHATSAPP_GROUP_MODERATION_ENABLED: "1", WHATSAPP_GROUP_MODERATION_GROUP_IDS: GROUP },
  });
  assert.equal(common.result.reason, "clean");
  assert.equal(common.calls.length, 0);
  assert.equal(common.rows.length, 0);
  assert.equal(detectGroupInvite("https://t.me/grupo"), false);
});

test("admin, loja e allowlist não são removidos", async () => {
  const env = { WHATSAPP_GROUP_MODERATION_ENABLED: "1", WHATSAPP_GROUP_MODERATION_GROUP_IDS: GROUP };
  const admin = await run(inviteBody({ participantPhone: ADMIN }), {
    env,
    extraAdmins: [ADMIN],
  });
  assert.equal(admin.result.reason, "admin");
  assert.deepEqual(methods(admin.calls), ["GET"]);
  assert.equal(admin.rows.length, 0);

  const store = await run(inviteBody({ participantPhone: "55 35 99211-9139" }), { env });
  assert.equal(store.result.reason, "store");
  assert.equal(store.calls.length, 0);

  const fromStore = await run(inviteBody({ fromMe: true }), { env });
  assert.equal(fromStore.result.reason, "from_me");
  assert.equal(fromStore.calls.length, 0);

  const allowed = await run(inviteBody({ participantPhone: ALLOW }), {
    env: { ...env, WHATSAPP_GROUP_MODERATION_ALLOW_PHONES: "+55 (11) 96666-5555" },
  });
  assert.equal(allowed.result.reason, "allowlist");
  assert.equal(allowed.calls.length, 0);
  assert.equal(allowed.rows.length, 0);
});

test("grupo fora da lista e lista vazia não chamam a Z-API", async () => {
  const outside = await run(inviteBody({ phone: OTHER, chatName: "Ka imports 1" }), {
    env: { WHATSAPP_GROUP_MODERATION_ENABLED: "1", WHATSAPP_GROUP_MODERATION_GROUP_IDS: GROUP },
  });
  assert.equal(outside.result.reason, "out_of_scope");
  assert.equal(outside.calls.length, 0);

  const empty = await run(inviteBody(), {
    env: { WHATSAPP_GROUP_MODERATION_ENABLED: "1" },
    settings: { whatsapp_group_moderation_group_ids: "" },
  });
  assert.equal(empty.result.reason, "no_groups");
  assert.equal(empty.calls.length, 0);

  const bySetting = await run(inviteBody(), {
    env: { WHATSAPP_GROUP_MODERATION_ENABLED: "1" },
    settings: { whatsapp_group_moderation_group_ids: OTHER },
  });
  assert.equal(bySetting.result.reason, "out_of_scope");
});

test("desligado não faz nada, mesmo com convite", async () => {
  const off = await run(inviteBody(), {
    settings: { whatsapp_group_moderation_group_ids: GROUP, whatsapp_group_moderation_enabled: "0" },
  });
  assert.equal(off.result.reason, "disabled");
  assert.equal(off.calls.length, 0);
  assert.equal(off.rows.length, 0);

  const forced = await run(inviteBody(), {
    env: { WHATSAPP_GROUP_MODERATION_ENABLED: "0", WHATSAPP_GROUP_MODERATION_DRY_RUN: "0" },
    settings: { whatsapp_group_moderation_enabled: "1", whatsapp_group_moderation_group_ids: GROUP },
  });
  assert.equal(forced.result.reason, "disabled");
  assert.equal(forced.calls.length, 0);
});

test("dry run só registra e não apaga nem remove", async () => {
  const { result, calls, rows } = await run(inviteBody(), {
    env: { WHATSAPP_GROUP_MODERATION_DRY_RUN: "1", WHATSAPP_GROUP_MODERATION_GROUP_IDS: GROUP },
  });
  assert.equal(result.action, "dry_run");
  assert.equal(result.skipped, true);
  assert.deepEqual(methods(calls), ["GET"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.action, "dry_run");
  assert.equal(rows[0]?.participantTail, "7777");
  assert.equal(JSON.stringify(rows).includes(MEMBER), false);

  const both = await run(inviteBody({ messageId: "msg-2" }), {
    env: {
      WHATSAPP_GROUP_MODERATION_ENABLED: "1",
      WHATSAPP_GROUP_MODERATION_DRY_RUN: "1",
      WHATSAPP_GROUP_MODERATION_GROUP_IDS: GROUP,
    },
  });
  assert.equal(both.result.action, "dry_run");
  assert.equal(both.calls.some((call) => call.method !== "GET"), false);
});

test("a mesma mensagem não apaga duas vezes", async () => {
  clearGroupModerationCache();
  const log = memoryLog();
  const zapi = mockFetch();
  const deps = {
    env: { ...CREDS, WHATSAPP_GROUP_MODERATION_ENABLED: "1", WHATSAPP_GROUP_MODERATION_GROUP_IDS: GROUP },
    settings: {},
    fetchImpl: zapi.fetchImpl,
    claimLog: log.claimLog,
    finishLog: log.finishLog,
  };
  const first = await handleGroupModeration(inviteBody(), deps);
  const second = await handleGroupModeration(inviteBody(), deps);
  assert.equal(first.action, "deleted_and_removed");
  assert.equal(second.reason, "duplicate");
  assert.equal(zapi.calls.filter((call) => call.method === "DELETE").length, 1);
  assert.equal(zapi.calls.filter((call) => call.method === "POST").length, 1);
});

test("sem a lista de admins não remove", async () => {
  const { result, calls, rows } = await run(inviteBody(), {
    env: { WHATSAPP_GROUP_MODERATION_ENABLED: "1", WHATSAPP_GROUP_MODERATION_GROUP_IDS: GROUP },
    metadataStatus: 500,
  });
  assert.equal(result.reason, "admins_unknown");
  assert.deepEqual(methods(calls), ["GET"]);
  assert.equal(rows.length, 0);
});

test("conversa 1:1, filial e instância poly ficam fora", async () => {
  const direct = {
    type: "ReceivedCallback",
    isGroup: false,
    fromMe: false,
    phone: MEMBER,
    messageId: "msg-direct",
    text: { message: "https://chat.whatsapp.com/ABC123" },
  };
  assert.equal(isGroupModerationCandidate(direct), false);
  const handled = await run(direct, {
    env: { WHATSAPP_GROUP_MODERATION_ENABLED: "1", WHATSAPP_GROUP_MODERATION_GROUP_IDS: GROUP },
  });
  assert.equal(handled.result.reason, "not_group");
  assert.equal(handled.calls.length, 0);
  assert.equal(handled.rows.length, 0);

  assert.equal(groupModerationAllowed({
    tenantId: "tenant_fh",
    instanceId: "",
    polyInstanceId: "",
    mainInstanceId: "inst",
  }), false);
  assert.equal(groupModerationAllowed({
    tenantId: "tenant_loja1",
    instanceId: "poly-inst",
    polyInstanceId: "poly-inst",
    mainInstanceId: "inst",
  }), false);
  assert.equal(groupModerationAllowed({
    tenantId: "tenant_loja1",
    instanceId: "outra",
    polyInstanceId: "",
    mainInstanceId: "inst",
  }), false);
  assert.equal(groupModerationAllowed({
    tenantId: "tenant_loja1",
    instanceId: "inst",
    polyInstanceId: "poly-inst",
    mainInstanceId: "inst",
  }), true);

  const support = readFileSync(new URL("./whatsapp-support.ts", import.meta.url), "utf8");
  const gate = support.indexOf("if (isGroupModerationCandidate(body))");
  const menu = support.indexOf("Olá! Você entrou em contato com o atendimento.");
  const groupReturn = support.indexOf("if (truthy(body.fromMe) || truthy(body.isGroup) || truthy(body.isNewsletter)) return { status: 200 };");
  assert.ok(gate > 0 && menu > gate);
  assert.ok(groupReturn > gate);
  assert.equal(support.includes("whatsapp_outbound_queue"), false);
});

test("a tabela de log não leva telefone nem texto e a criação é idempotente", () => {
  assert.match(GROUP_MODERATION_LOG_INSERT, /INSERT IGNORE/);
  assert.equal(GROUP_MODERATION_LOG_INSERT.includes("participant_phone"), false);
  assert.equal(GROUP_MODERATION_LOG_INSERT.includes("snippet"), false);
  const source = readFileSync(new URL("./whatsapp-group-moderation.ts", import.meta.url), "utf8");
  assert.equal(source.includes("whatsapp_outbound_queue"), false);
  assert.equal(source.includes("sendZapiMessage"), false);
  assert.equal(source.includes("send-text"), false);

  const runtime = readFileSync(new URL("../runtime-schema.ts", import.meta.url), "utf8");
  const createAt = runtime.indexOf("CREATE TABLE whatsapp_group_moderation_log");
  assert.ok(createAt > 0);
  const guard = runtime.lastIndexOf("tableExists(\"whatsapp_group_moderation_log\"", createAt);
  assert.ok(guard > 0 && guard < createAt);
  assert.equal(runtime.includes("participant_phone"), false);
});
