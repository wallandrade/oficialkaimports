import 'dotenv/config';
import { db, ordersTable, sellersTable } from "../../lib/db/src/index";
import { eq } from "drizzle-orm";
import { inArray } from "drizzle-orm";

async function patchOrdersCommissionRate() {
  // Busca todos os pedidos pagos ou completed
  const orders = await db.select().from(ordersTable).where(
    (row) => ["paid", "completed"].includes(row.status)
  );
  let patched = 0;
  for (const order of orders) {
    // Corrige apenas se o campo está vazio, nulo ou zero
    const current = order.sellerCommissionRateSnapshot;
    if (current !== undefined && current !== null && Number(current) > 0) continue;
    const sellerCode = order.sellerCode;
    if (!sellerCode) continue;
    // Busca a comissão atual do vendedor
    const [seller] = await db
      .select({
        hasCommission: sellersTable.hasCommission,
        commissionRate: sellersTable.commissionRate,
      })
      .from(sellersTable)
      .where(eq(sellersTable.slug, String(sellerCode).toLowerCase()));
    if (!seller?.hasCommission) continue;
    const commissionRate = Number(seller.commissionRate ?? 0);
    if (commissionRate <= 0) continue;
    // Atualiza o pedido
    await db.update(ordersTable)
      .set({ sellerCommissionRateSnapshot: String(commissionRate) })
      .where(eq(ordersTable.id, order.id));
    patched++;
    console.log(`Pedido ${order.id} corrigido: sellerCode=${sellerCode}, commissionRate=${commissionRate}`);
  }
  console.log(`Total de pedidos corrigidos: ${patched}`);
}

patchOrdersCommissionRate().then(() => process.exit(0));
