import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCustomCaption,
  customSendKey,
  customSlots,
  formatSpLocal,
  groupWindowContains,
  minuteInGroupWindow,
  parseCustomSchedule,
  parseGroupChats,
  pickCampaignProduct,
  productCaption,
  productSendKey,
  saoPauloClock,
  scheduleIsOpen,
  spLocalToUtc,
  zapiMainCredentials,
  type ScheduleInput,
} from "./whatsapp-group-campaign";

const products = ["a", "b", "c", "d"].map((id) => ({ id, name: id, image: `https://cdn.example/${id}.jpg` }));
const image = "https://cdn.example/whatsapp-groups/a.jpg";

function once(scheduledAt: string): ScheduleInput {
  return { scheduledAt, scheduleMode: "once", scheduleTimes: [], intervalHours: null, durationDays: null };
}

test("grupo 1 ocupa os minutos 0 e 1 e o grupo 6 os minutos 15 e 16", () => {
  assert.equal(minuteInGroupWindow(0, 0), true);
  assert.equal(minuteInGroupWindow(1, 0), true);
  assert.equal(minuteInGroupWindow(2, 0), false);
  assert.equal(minuteInGroupWindow(3, 1), true);
  assert.equal(minuteInGroupWindow(4, 1), true);
  assert.equal(minuteInGroupWindow(15, 5), true);
  assert.equal(minuteInGroupWindow(16, 5), true);
  assert.equal(minuteInGroupWindow(17, 5), false);
  const anchor = spLocalToUtc(2026, 10, 30, 9, 0);
  assert.equal(groupWindowContains(new Date(anchor.getTime() + 30_000), anchor, 0), true);
  assert.equal(groupWindowContains(new Date(anchor.getTime() + 3 * 60_000), anchor, 0), false);
  assert.equal(groupWindowContains(new Date(anchor.getTime() + 3 * 60_000), anchor, 1), true);
});

test("o relógio de São Paulo anda três horas atrás do UTC", () => {
  const clock = saoPauloClock(new Date("2026-10-30T13:00:00.000Z"));
  assert.equal(clock.dateKey, "2026-10-30");
  assert.equal(clock.hour, 10);
  assert.equal(clock.minute, 0);
  assert.equal(spLocalToUtc(2026, 10, 30, 10, 0).toISOString(), "2026-10-30T13:00:00.000Z");
});

test("quatro horários do mesmo dia escolhem quatro produtos e o dia seguinte anda", () => {
  assert.equal(pickCampaignProduct(products, 1, 9)?.id, "b");
  assert.equal(pickCampaignProduct(products, 1, 13)?.id, "c");
  assert.equal(pickCampaignProduct(products, 1, 17)?.id, "d");
  assert.equal(pickCampaignProduct(products, 1, 21)?.id, "a");
  assert.equal(pickCampaignProduct(products, 2, 9)?.id, "c");
  assert.equal(pickCampaignProduct(products, 1, 8), null);
});

test("a legenda do produto leva o nome e o link da loja", () => {
  assert.equal(productCaption("Botox", "p1", "https://www.ka-imports.com"), "Botox\nhttps://www.ka-imports.com/produto/p1");
});

test("o link que já está no texto não repete e a URL da foto fica de fora", () => {
  assert.equal(buildCustomCaption("Veja https://www.ka-imports.com/promo", "", image), "Veja https://www.ka-imports.com/promo");
  assert.equal(buildCustomCaption("Olá", "https://www.ka-imports.com/promo", image), "Olá\nhttps://www.ka-imports.com/promo");
  assert.equal(
    buildCustomCaption("Olá https://www.ka-imports.com/promo", "https://www.ka-imports.com/promo", image),
    "Olá https://www.ka-imports.com/promo",
  );
  assert.equal(buildCustomCaption(`Foto ${image} agora`, image, image).includes(image), false);
  assert.equal(buildCustomCaption("Compre", image, image), "Compre");
});

test("horário passado é recusado e o mesmo horário antigo pode ser salvo de novo", () => {
  const now = new Date("2026-10-30T13:01:00.000Z");
  assert.equal(scheduleIsOpen(once("2026-10-30T10:00"), now), false);
  assert.equal(scheduleIsOpen(once("2026-10-30T10:01"), now), true);
  const created = parseCustomSchedule({ scheduledAt: "2026-10-30T10:00", scheduleMode: "once" }, now, null);
  assert.equal(created.ok, false);
  const edited = parseCustomSchedule({ scheduledAt: "2026-10-30T10:00", scheduleMode: "once" }, now, once("2026-10-30T10:00"));
  assert.equal(edited.ok, true);
});

test("intervalo de 2 horas vai até 23:59 do último dia", () => {
  const slots = customSlots({
    scheduledAt: "2026-10-30T10:00",
    scheduleMode: "interval",
    scheduleTimes: [],
    intervalHours: 2,
    durationDays: 2,
  }).map(formatSpLocal);
  assert.equal(slots[0], "2026-10-30T10:00");
  assert.equal(slots.includes("2026-10-31T22:00"), true);
  assert.equal(slots.includes("2026-11-01T00:00"), false);
  assert.equal(slots.at(-1), "2026-10-31T22:00");
});

test("vários horários se repetem nos dias seguintes", () => {
  const slots = customSlots({
    scheduledAt: "2026-10-30T00:00",
    scheduleMode: "times",
    scheduleTimes: ["09:00", "18:30"],
    intervalHours: null,
    durationDays: 2,
  }).map(formatSpLocal);
  assert.deepEqual(slots, [
    "2026-10-30T09:00",
    "2026-10-30T18:30",
    "2026-10-31T09:00",
    "2026-10-31T18:30",
  ]);
});

test("a chave impede repetir o produto e o aviso", () => {
  assert.equal(productSendKey("2026-10-30", 9, "558187853083-1608664005"), "p:2026-10-30:9:558187853083-1608664005");
  assert.equal(customSendKey("a".repeat(24), "once", "558187853083-1608664005"), `c:${"a".repeat(24)}:558187853083-1608664005`);
  assert.equal(customSendKey("abc", "times", "5581", "2026-10-30T09:00"), "c:abc:times:2026-10-30T09:00:5581");
  assert.equal(customSendKey("abc", "interval", "5581", "2026-10-30T10:00"), "c:abc:interval:2026-10-30T10:00:5581");
});

test("lista vazia não herda grupo de outra loja e a Z-API exige as três variáveis sem barra", () => {
  assert.deepEqual(parseGroupChats(null), { ok: true, chats: [] });
  assert.deepEqual(parseGroupChats([]), { ok: true, chats: [] });
  const saved = parseGroupChats([{ name: "Grupo 1", phone: "120363370084115387-group" }]);
  assert.equal(saved.ok, true);
  if (saved.ok) assert.equal(saved.chats[0]?.phone, "120363370084115387-group");
  assert.equal(parseGroupChats([{ phone: "abc" }]).ok, false);
  assert.equal(zapiMainCredentials({ ZAPI_POLY_INSTANCE_ID: "abc", ZAPI_POLY_TOKEN: "tok", ZAPI_CLIENT_TOKEN: "cli" }), null);
  assert.equal(zapiMainCredentials({ ZAPI_MAIN_INSTANCE_ID: "a/b", ZAPI_MAIN_TOKEN: "tok", ZAPI_CLIENT_TOKEN: "cli" }), null);
  assert.deepEqual(
    zapiMainCredentials({ ZAPI_MAIN_INSTANCE_ID: "inst", ZAPI_MAIN_TOKEN: "tok", ZAPI_CLIENT_TOKEN: "cli" }),
    { instanceId: "inst", token: "tok", clientToken: "cli" },
  );
});
