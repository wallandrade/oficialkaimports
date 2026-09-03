export type OrderEventActorType = "admin" | "customer" | "system" | "webhook";

export type OrderEventRecord = {
  id: string;
  orderId: string;
  action: string;
  actorType: OrderEventActorType;
  actorUsername: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

function asPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function mapOrderEventRow(row: {
  id: string;
  orderId: string;
  action: string;
  actorType: string | null;
  actorUsername: string | null;
  payload: unknown;
  createdAt: Date | string | null;
}): OrderEventRecord {
  const createdAt = row.createdAt instanceof Date
    ? row.createdAt.toISOString()
    : String(row.createdAt || new Date().toISOString());
  const actorType = String(row.actorType || "admin").trim().toLowerCase();
  const allowed: OrderEventActorType[] = ["admin", "customer", "system", "webhook"];
  return {
    id: row.id,
    orderId: row.orderId,
    action: String(row.action || "").trim(),
    actorType: (allowed.includes(actorType as OrderEventActorType) ? actorType : "admin") as OrderEventActorType,
    actorUsername: String(row.actorUsername || "").trim() || null,
    payload: asPayload(row.payload),
    createdAt,
  };
}

export function actionFromStatusChange(fromStatus: string, toStatus: string): string {
  const from = String(fromStatus || "").trim().toLowerCase();
  const to = String(toStatus || "").trim().toLowerCase();
  if (to === "paid" || to === "completed") {
    if (from !== "paid" && from !== "completed") return "marked_paid";
  }
  if (to === "cancelled") return "cancelled";
  return "status_changed";
}

function compactProducts(raw: unknown): Array<{ id: string; name: string; quantity: number; price: number }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      id: String(row.id || "").trim(),
      name: String(row.name || "").trim(),
      quantity: Number(row.quantity) || 0,
      price: Number(row.price) || 0,
    };
  }).filter((item) => item.id || item.name);
}

export function buildOrderEditPayload(before: {
  clientName?: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
  clientDocument?: string | null;
  addressCep?: string | null;
  addressStreet?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  addressNeighborhood?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  products?: unknown;
  discountAmount?: unknown;
  total?: unknown;
  status?: string | null;
}, after: {
  clientName?: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
  clientDocument?: string | null;
  addressCep?: string | null;
  addressStreet?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  addressNeighborhood?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  products?: unknown;
  discountAmount?: unknown;
  total?: unknown;
  status?: string | null;
}): Record<string, unknown> {
  const fields: string[] = [];
  const same = (a: unknown, b: unknown) => String(a ?? "").trim() === String(b ?? "").trim();
  if (!same(before.clientName, after.clientName)) fields.push("nome");
  if (!same(before.clientPhone, after.clientPhone)) fields.push("telefone");
  if (!same(before.clientEmail, after.clientEmail)) fields.push("e-mail");
  if (!same(before.clientDocument, after.clientDocument)) fields.push("CPF");
  const beforeAddr = [before.addressStreet, before.addressNumber, before.addressComplement, before.addressNeighborhood, before.addressCity, before.addressState, before.addressCep].map((v) => String(v ?? "").trim()).join("|");
  const afterAddr = [after.addressStreet, after.addressNumber, after.addressComplement, after.addressNeighborhood, after.addressCity, after.addressState, after.addressCep].map((v) => String(v ?? "").trim()).join("|");
  if (beforeAddr !== afterAddr) fields.push("endereço");
  if (JSON.stringify(compactProducts(before.products)) !== JSON.stringify(compactProducts(after.products))) {
    fields.push("itens");
  }
  const beforeDiscount = Number(before.discountAmount || 0);
  const afterDiscount = Number(after.discountAmount || 0);
  if (Math.abs(beforeDiscount - afterDiscount) > 0.009) fields.push("desconto");
  const fromTotal = Number(before.total || 0);
  const toTotal = Number(after.total || 0);
  if (Math.abs(fromTotal - toTotal) > 0.009) fields.push("total");
  const fromStatus = String(before.status || "").trim();
  const toStatus = String(after.status || "").trim();
  if (fromStatus !== toStatus) fields.push("status");
  const summaryParts = [...fields];
  if (Math.abs(fromTotal - toTotal) > 0.009) {
    summaryParts.push(`R$ ${fromTotal.toFixed(2)} → R$ ${toTotal.toFixed(2)}`);
  }
  if (fromStatus && toStatus && fromStatus !== toStatus) {
    summaryParts.push(`De ${fromStatus} para ${toStatus}`);
  }
  return {
    fields,
    summary: summaryParts.join(" · ") || "Pedido editado",
    fromStatus: fromStatus || null,
    toStatus: toStatus || null,
    fromTotal,
    toTotal,
  };
}
