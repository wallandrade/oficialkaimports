import { eq } from "drizzle-orm";
import { db, marketingExpensesTable } from "@workspace/db";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import { getYuryMotoboyApiBase } from "./motoboy-yury-config";
import {
  META_ADS_CHANNEL,
  META_ADS_NOTE,
  getYuryMetaAdsSyncToken,
  isOwnedMetaAdsExpenseId,
  metaAdsHttpDisposition,
  planMetaAdsSpend,
  yuryMetaAdsSpendUrl,
  type MetaAdsSpendPlan,
} from "./meta-ads-spend";

const FETCH_TIMEOUT_MS = 15_000;

export type MetaAdsPullResult =
  | { action: "idle" }
  | { action: "log"; status: number; error?: string }
  | { action: "keep"; cause: string }
  | { action: "apply"; since: string; until: string; upserted: number; deleted: number };

export async function pullYuryMetaAdsSpend(): Promise<MetaAdsPullResult> {
  const token = getYuryMetaAdsSyncToken();
  if (!token) return { action: "idle" };

  const url = yuryMetaAdsSpendUrl(getYuryMotoboyApiBase());
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { action: "keep", cause: "timeout" };
  }

  const disposition = metaAdsHttpDisposition(response.status);
  if (disposition === "log") {
    return { action: "log", status: response.status, error: await readErrorCode(response) };
  }
  if (disposition !== "parse") {
    return { action: "keep", cause: `http_${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { action: "keep", cause: "invalid_json" };
  }

  const plan = planMetaAdsSpend(body);
  if (!plan) return { action: "keep", cause: "invalid_json" };

  const applied = await applyMetaAdsSpendPlan(plan);
  return { action: "apply", ...applied };
}

export async function applyMetaAdsSpendPlan(plan: MetaAdsSpendPlan): Promise<{
  since: string;
  until: string;
  upserted: number;
  deleted: number;
}> {
  let upserted = 0;
  let deleted = 0;
  await db.transaction(async (tx) => {
    for (const action of plan.actions) {
      if (!isOwnedMetaAdsExpenseId(action.id)) {
        throw new Error("id de gasto automático inválido");
      }
      if (action.action === "delete") {
        await tx.delete(marketingExpensesTable).where(eq(marketingExpensesTable.id, action.id));
        deleted += 1;
        continue;
      }
      await tx.insert(marketingExpensesTable).values({
        id: action.id,
        tenantId: DEFAULT_TENANT_ID,
        sellerCode: null,
        expenseDate: action.start,
        expenseStartDate: action.start,
        expenseEndDate: action.end,
        channel: META_ADS_CHANNEL,
        amount: action.amount,
        note: META_ADS_NOTE,
      }).onDuplicateKeyUpdate({
        set: {
          tenantId: DEFAULT_TENANT_ID,
          sellerCode: null,
          expenseDate: action.start,
          expenseStartDate: action.start,
          expenseEndDate: action.end,
          channel: META_ADS_CHANNEL,
          amount: action.amount,
          note: META_ADS_NOTE,
        },
      });
      upserted += 1;
    }
  });
  return { since: plan.since, until: plan.until, upserted, deleted };
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = await response.json() as { error?: unknown };
    return typeof body?.error === "string" ? body.error : undefined;
  } catch {
    return undefined;
  }
}
