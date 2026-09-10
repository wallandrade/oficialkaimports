import {
  buildYuryInventoryExitBody,
  interpretYuryInventoryExitResponse,
  interpretYuryInventoryUnlockResponse,
  mapKaItemsToYuryExitItems,
  parseYuryInventoryExitStatus,
  YURY_EXIT_PASSWORD_HINT,
  type YuryInventoryExitItem,
  type YuryInventoryExitStatus,
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
  passwordRequired?: boolean;
  constructor(code: string, message: string, extras?: { passwordRequired?: boolean }) {
    super(message);
    this.name = "YuryInventoryExitError";
    this.code = code;
    if (extras?.passwordRequired) this.passwordRequired = true;
  }
}

function yuryInventoryHeaders(token: string, withJson = false): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "X-Api-Key": token,
    Accept: "application/json",
    ...(withJson ? { "Content-Type": "application/json" } : {}),
  };
}

function requireYuryInventoryToken(): string {
  const token = getYuryInventorySyncToken();
  if (!token) {
    throw new YuryInventoryExitError(
      "YURY_SYNC_DISABLED",
      "Configure YURY_MOTOBOY_SYNC_TOKEN para baixar estoque Motoboy/Minas na Yury.",
    );
  }
  return token;
}

async function readYuryJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function throwInterpretedExit(status: number, raw: unknown): never {
  const interpreted = interpretYuryInventoryExitResponse(status, raw);
  if (interpreted.ok) {
    throw new YuryInventoryExitError("YURY_EXIT_FAILED", "Resposta inesperada da Yury.");
  }
  throw new YuryInventoryExitError(interpreted.code, interpreted.message, {
    passwordRequired: interpreted.passwordRequired,
  });
}

export async function fetchYuryInventoryExitStatus(): Promise<YuryInventoryExitStatus> {
  const token = requireYuryInventoryToken();
  const url = `${getYuryMotoboyApiBase()}/api/integrations/inventory/exit-status`;
  const response = await fetch(url, { headers: yuryInventoryHeaders(token) });
  const raw = await readYuryJson(response);
  if (response.status === 404) {
    throw new YuryInventoryExitError(
      "YURY_EXIT_UNAVAILABLE",
      "Status de senha da baixa Yury indisponível (rota ainda não no ar).",
    );
  }
  if (!response.ok) {
    throwInterpretedExit(response.status, raw);
  }
  const parsed = parseYuryInventoryExitStatus(raw);
  if (!parsed) {
    throw new YuryInventoryExitError("YURY_EXIT_FAILED", "Payload de exit-status Yury inválido.");
  }
  return parsed;
}

export async function unlockYuryInventoryExit(password: string): Promise<YuryInventoryExitStatus> {
  const token = requireYuryInventoryToken();
  const secret = String(password || "").trim();
  if (!secret) {
    throw new YuryInventoryExitError("PASSWORD_REQUIRED", YURY_EXIT_PASSWORD_HINT, {
      passwordRequired: true,
    });
  }
  const url = `${getYuryMotoboyApiBase()}/api/integrations/inventory/unlock`;
  const response = await fetch(url, {
    method: "POST",
    headers: yuryInventoryHeaders(token, true),
    body: JSON.stringify({ password: secret }),
  });
  const raw = await readYuryJson(response);
  const interpreted = interpretYuryInventoryUnlockResponse(response.status, raw);
  if (!interpreted.ok) {
    throw new YuryInventoryExitError(interpreted.code, interpreted.message, {
      passwordRequired: interpreted.passwordRequired,
    });
  }
  return interpreted.status;
}

async function postYuryInventoryExit(input: {
  pool: YuryInventoryPool;
  items: YuryInventoryExitItem[];
  referenceId: string;
  reason?: string;
  password?: string;
}): Promise<{ alreadyDebited: boolean }> {
  const token = requireYuryInventoryToken();
  const body = buildYuryInventoryExitBody(input);
  const url = `${getYuryMotoboyApiBase()}/api/integrations/inventory/exit`;
  const response = await fetch(url, {
    method: "POST",
    headers: yuryInventoryHeaders(token, true),
    body: JSON.stringify(body),
  });

  const raw = await readYuryJson(response);
  const interpreted = interpretYuryInventoryExitResponse(response.status, raw);
  if (!interpreted.ok) {
    throw new YuryInventoryExitError(interpreted.code, interpreted.message, {
      passwordRequired: interpreted.passwordRequired,
    });
  }
  return { alreadyDebited: interpreted.alreadyDebited };
}

export async function debitYuryInventoryForKaOrder(input: {
  referenceId: string;
  pool: YuryInventoryPool;
  items: Array<{ productId: string | null; productName: string; quantity: number }>;
  password?: string;
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

  const password = String(input.password || "").trim();
  if (password) {
    try {
      await unlockYuryInventoryExit(password);
    } catch (error) {
      if (error instanceof YuryInventoryExitError && error.code === "YURY_EXIT_UNAVAILABLE") {
        // Unlock ainda não no ar: a senha segue no POST /exit.
      } else {
        throw error;
      }
    }
  }

  const result = await postYuryInventoryExit({
    pool: input.pool,
    items: mapped.items,
    referenceId: input.referenceId,
    reason: `baixa pelo KA pedido ${input.referenceId}`,
    password: password || undefined,
  });
  console.info("[YuryInventory] exit", {
    pool: input.pool,
    referenceId: input.referenceId,
    itemCount: mapped.items.length,
    alreadyDebited: result.alreadyDebited,
  });
  return { alreadyDebited: result.alreadyDebited, itemCount: mapped.items.length };
}
