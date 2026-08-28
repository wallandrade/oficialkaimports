import { db, customChargesTable, ordersTable, raffleReservationsTable, tenantSettingsTable } from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { DEFAULT_TENANT_ID } from "./tenant-context";
import {
  pickAppcnpayCredentialPair,
  PIX_GATEWAY_SETTING_KEYS,
} from "./pix-gateway-credentials-core";

export {
  isMaskedGatewaySecret,
  maskGatewaySecret,
  pickAppcnpayCredentialPair,
  PIX_GATEWAY_SETTING_KEYS,
  type AppcnpayCredentialPair,
} from "./pix-gateway-credentials-core";

function buildTenantSettingsWhere(tenantId: string) {
  if (tenantId === DEFAULT_TENANT_ID) {
    return or(
      eq(tenantSettingsTable.tenantId, tenantId),
      isNull(tenantSettingsTable.tenantId),
      eq(tenantSettingsTable.tenantId, ""),
    );
  }
  return eq(tenantSettingsTable.tenantId, tenantId);
}

export async function loadAppcnpayCredentialPair(tenantId?: string | null) {
  const resolvedTenantId = String(tenantId || "").trim() || DEFAULT_TENANT_ID;
  const rows = await db
    .select({ key: tenantSettingsTable.key, value: tenantSettingsTable.value })
    .from(tenantSettingsTable)
    .where(and(
      buildTenantSettingsWhere(resolvedTenantId),
      or(
        eq(tenantSettingsTable.key, PIX_GATEWAY_SETTING_KEYS.publicKey),
        eq(tenantSettingsTable.key, PIX_GATEWAY_SETTING_KEYS.secretKey),
      ),
    ));

  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, string>;
  return pickAppcnpayCredentialPair({
    tenantPublicKey: byKey[PIX_GATEWAY_SETTING_KEYS.publicKey],
    tenantSecretKey: byKey[PIX_GATEWAY_SETTING_KEYS.secretKey],
    envPublicKey: process.env["GATEWAY_IDENTIFIER"],
    envSecretKey: process.env["GATEWAY_SECRET"],
  });
}

export async function getAppcnpayGatewayHeaders(tenantId?: string | null): Promise<Record<string, string>> {
  const pair = await loadAppcnpayCredentialPair(tenantId);
  return {
    "Content-Type": "application/json",
    "x-public-key": pair.publicKey,
    "x-secret-key": pair.secretKey,
  };
}

function asTenantId(value: string | null | undefined): string {
  return String(value || "").trim() || DEFAULT_TENANT_ID;
}

export async function findTenantIdByPixTransactionId(transactionId: string): Promise<string | null> {
  const txId = String(transactionId || "").trim();
  if (!txId) return null;

  const [order] = await db
    .select({ tenantId: ordersTable.tenantId })
    .from(ordersTable)
    .where(eq(ordersTable.transactionId, txId))
    .limit(1);
  if (order) return asTenantId(order.tenantId);

  const [charge] = await db
    .select({ tenantId: customChargesTable.tenantId })
    .from(customChargesTable)
    .where(eq(customChargesTable.transactionId, txId))
    .limit(1);
  if (charge) return asTenantId(charge.tenantId);

  const [reservation] = await db
    .select({ tenantId: raffleReservationsTable.tenantId })
    .from(raffleReservationsTable)
    .where(eq(raffleReservationsTable.transactionId, txId))
    .limit(1);
  if (reservation) return asTenantId(reservation.tenantId);

  return null;
}
