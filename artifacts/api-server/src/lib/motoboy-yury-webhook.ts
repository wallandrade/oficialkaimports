import { eq } from "drizzle-orm";
import { db, yuryWebhookEventsProcessedTable } from "@workspace/db";
import {
  coverageYuryIdFromEventData,
  parseYuryCoverageEvent,
} from "./motoboy-yury-coverage";
import {
  deactivateYuryCepRange,
  deactivateYuryNeighborhood,
  pullYuryMotoboyCoverage,
  upsertYuryCepRange,
  upsertYuryNeighborhood,
} from "./motoboy-yury-sync";

export async function isYuryEventAlreadyProcessed(eventId: string): Promise<boolean> {
  const [row] = await db
    .select({ eventId: yuryWebhookEventsProcessedTable.eventId })
    .from(yuryWebhookEventsProcessedTable)
    .where(eq(yuryWebhookEventsProcessedTable.eventId, eventId))
    .limit(1);
  return Boolean(row);
}

export async function markYuryEventProcessed(eventId: string, eventType: string): Promise<void> {
  await db.insert(yuryWebhookEventsProcessedTable).values({
    eventId,
    eventType,
    processedAt: new Date(),
  }).onDuplicateKeyUpdate({
    set: { eventType, processedAt: new Date() },
  });
}

export async function handleYuryMotoboyCoverageEvent(raw: unknown): Promise<{ ok: true; duplicate?: boolean; ignored?: boolean }> {
  const event = parseYuryCoverageEvent(raw);
  if (!event) {
    throw new Error("INVALID_EVENT");
  }

  if (await isYuryEventAlreadyProcessed(event.eventId)) {
    return { ok: true, duplicate: true };
  }

  switch (event.eventType) {
    case "motoboy.neighborhood.upserted":
      await upsertYuryNeighborhood(event.data);
      break;
    case "motoboy.neighborhood.deactivated":
      await deactivateYuryNeighborhood(coverageYuryIdFromEventData(event.data), false);
      break;
    case "motoboy.neighborhood.deleted":
      await deactivateYuryNeighborhood(coverageYuryIdFromEventData(event.data), true);
      break;
    case "motoboy.cep_range.upserted":
      await upsertYuryCepRange(event.data);
      break;
    case "motoboy.cep_range.deactivated":
      await deactivateYuryCepRange(coverageYuryIdFromEventData(event.data), false);
      break;
    case "motoboy.cep_range.deleted":
      await deactivateYuryCepRange(coverageYuryIdFromEventData(event.data), true);
      break;
    case "motoboy.coverage.full_sync_requested":
      await pullYuryMotoboyCoverage();
      break;
    default:
      await markYuryEventProcessed(event.eventId, event.eventType);
      return { ok: true, ignored: true };
  }

  await markYuryEventProcessed(event.eventId, event.eventType);
  console.log("[YuryMotoboy] event processed", {
    eventId: event.eventId,
    eventType: event.eventType,
    yuryId: coverageYuryIdFromEventData(event.data) || null,
  });
  return { ok: true };
}
