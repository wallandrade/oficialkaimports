import {
  buildYuryInventoryExitBody,
  interpretYuryInventoryExitResponse,
  mapKaItemsToYuryExitItems,
  type YuryInventoryExitItem,
  type YuryInventoryPool,
} from "./yury-inventory";
import {
  getYuryInventorySyncToken,
  getYuryMotoboyApiBase,
  isYuryInventorySyncConfigured,
} from "./motoboy-yury-config";
import { listYuryInventoryBalances } from "./yury-inventory-sync";

export class YuryInventoryExitError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "YuryInventoryExitError";
    this.code = code;
  }
}

async function postYuryInventoryExit(input: {
  pool: YuryInventoryPool;
  items: YuryInventoryExitItem[];
  referenceId: string;
  reason?: string;
}): Promise<{ alreadyDebited: boolean }> {
  const token = getYuryInventorySyncToken();
  if (!token) {
    throw new YuryInventoryExitError(
      "YURY_SYNC_DISABLED",
      "Configure YURY_MOTOBOY_SYNC_TOKEN para baixar estoque Motoboy/Minas na Yury.",
    );
  }

  const body = buildYuryInventoryExitBody(input);
  const url = `${getYuryMotoboyApiBase()}/api/integrations/inventory/exit`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Api-Key": token,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  let raw: unknown = null;
  try {
    raw = await response.json();
  } catch {
    raw = null;
  }

  const interpreted = interpretYuryInventoryExitResponse(response.status, raw);
  if (!interpreted.ok) {
    throw new YuryInventoryExitError(interpreted.code, interpreted.message);
  }
  return { alreadyDebited: interpreted.alreadyDebited };
}

export async function debitYuryInventoryForKaOrder(input: {
  referenceId: string;
  pool: YuryInventoryPool;
  items: Array<{ productId: string | null; productName: string; quantity: number }>;
}): Promise<{ alreadyDebited: boolean; itemCount: number }> {
  if (!isYuryInventorySyncConfigured()) {
    throw new YuryInventoryExitError(
      "YURY_SYNC_DISABLED",
      "Configure YURY_MOTOBOY_SYNC_TOKEN para baixar estoque Motoboy/Minas na Yury.",
    );
  }

  const mapped = mapKaItemsToYuryExitItems(input.items, await listYuryInventoryBalances());
  if (!mapped.ok) {
    throw new YuryInventoryExitError(
      "INVENTORY_PRODUCT_MAPPING_ERROR",
      `Não foi possível mapear os produtos no estoque Yury: ${mapped.missing.join(", ")}.`,
    );
  }
  if (mapped.items.length === 0) {
    return { alreadyDebited: false, itemCount: 0 };
  }

  const result = await postYuryInventoryExit({
    pool: input.pool,
    items: mapped.items,
    referenceId: input.referenceId,
    reason: `baixa pelo KA pedido ${input.referenceId}`,
  });
  console.info("[YuryInventory] exit", {
    pool: input.pool,
    referenceId: input.referenceId,
    itemCount: mapped.items.length,
    alreadyDebited: result.alreadyDebited,
  });
  return { alreadyDebited: result.alreadyDebited, itemCount: mapped.items.length };
}
