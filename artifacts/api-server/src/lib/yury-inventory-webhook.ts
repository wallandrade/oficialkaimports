import { isYuryEventAlreadyProcessed, markYuryEventProcessed } from "./motoboy-yury-webhook";
import { parseYuryInventoryChangedEvent } from "./yury-inventory";
import { upsertYuryInventoryFromWebhook } from "./yury-inventory-sync";

export async function handleYuryInventoryEvent(raw: unknown): Promise<{ ok: true; duplicate?: boolean; ignored?: boolean }> {
  const event = parseYuryInventoryChangedEvent(raw);
  if (!event) {
    if (raw && typeof raw === "object" && "eventId" in raw && "eventType" in raw) {
      const eventId = String((raw as { eventId?: unknown }).eventId || "").trim();
      const eventType = String((raw as { eventType?: unknown }).eventType || "").trim();
      if (eventId && eventType && eventType !== "inventory.changed") {
        if (await isYuryEventAlreadyProcessed(eventId)) {
          return { ok: true, duplicate: true };
        }
        await markYuryEventProcessed(eventId, eventType);
        return { ok: true, ignored: true };
      }
    }
    throw new Error("INVALID_EVENT");
  }

  if (await isYuryEventAlreadyProcessed(event.eventId)) {
    return { ok: true, duplicate: true };
  }

  await upsertYuryInventoryFromWebhook({
    productId: event.data.productId,
    productName: event.data.productName,
    balances: event.data.balances,
  });
  await markYuryEventProcessed(event.eventId, event.eventType);
  console.log("[YuryInventory] event processed", {
    eventId: event.eventId,
    productId: event.data.productId,
    motoboy: event.data.balances.motoboy,
    minas: event.data.balances.minas,
  });
  return { ok: true };
}
