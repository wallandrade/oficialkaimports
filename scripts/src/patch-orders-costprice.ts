import { db, ordersTable, productsTable } from "../../lib/db/src/index";
import { inArray } from "drizzle-orm";

async function patchOrdersCostPrice() {
  // Busca todos os pedidos
  const orders = await db.select().from(ordersTable);
  for (const order of orders) {
    let products = [];
    if (typeof order.products === "string") {
      try { products = JSON.parse(order.products); } catch { products = []; }
    } else if (Array.isArray(order.products)) {
      products = order.products;
    }
    // Busca os custos dos produtos no banco
    const productIds = Array.from(new Set(products.map((p) => String(p?.id || "")).filter(Boolean)));
    let productCostMap = new Map();
    if (productIds.length > 0) {
      const costRows = await db
        .select({ id: productsTable.id, costPrice: productsTable.costPrice })
        .from(productsTable)
        .where(inArray(productsTable.id, productIds));
      productCostMap = new Map(costRows.map((row) => [row.id, Number(row.costPrice || 0)]));
    }
    // Atualiza o campo costPrice de cada produto
    const patchedProducts = products.map((p) => ({
      ...p,
      costPrice: productCostMap.get(String(p.id)) ?? 0,
    }));
    // Atualiza o pedido no banco se necessário
    await db.update(ordersTable)
      .set({ products: JSON.stringify(patchedProducts) })
      .where(ordersTable.id, "=", order.id);
    console.log(`Pedido ${order.id} corrigido.`);
  }
  console.log("Todos os pedidos foram corrigidos.");
}

patchOrdersCostPrice().then(() => process.exit(0));
