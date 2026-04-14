import 'dotenv/config';
import { db, ordersTable, sellersTable } from "../../lib/db/src/index";
import { eq } from "drizzle-orm";
import { inArray } from "drizzle-orm";

async function auditOrdersMissingCommission() {
  // Busca todos os pedidos pagos ou completed
  const orders = await db.select().from(ordersTable).where(
    (row) => ["paid", "completed"].includes(row.status)
  );
  let count = 0;
  for (const order of orders) {
    const sellerCode = order.sellerCode;
    const commissionSnapshot = Number(order.sellerCommissionRateSnapshot || 0);
    if (!sellerCode) continue; // ignora pedidos sem vendedor
    if (commissionSnapshot > 0) continue; // ignora pedidos já com comissão
    // Busca vendedor
    const [seller] = await db
      .select({
        hasCommission: sellersTable.hasCommission,
        commissionRate: sellersTable.commissionRate,
      })
      .from(sellersTable)
      .where(eq(sellersTable.slug, String(sellerCode).toLowerCase()));
    if (!seller) {
      console.log(`Pedido ${order.id}: sellerCode=${sellerCode} (vendedor não encontrado)`);
      count++;
      continue;
    }
    if (!seller.hasCommission || Number(seller.commissionRate) <= 0) {
      // Vendedor não tem comissão cadastrada
      continue;
    }
    // Pedido deveria ter comissão, mas está zerado
    console.log(`Pedido ${order.id}: sellerCode=${sellerCode}, vendedor com comissão ${seller.commissionRate}% mas pedido está zerado!`);
    count++;
  }
  console.log(`Total de pedidos pagos/completed com comissão zerada e vendedor com comissão: ${count}`);
}

auditOrdersMissingCommission().then(() => process.exit(0));
