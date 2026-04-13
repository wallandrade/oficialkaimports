import { db, ordersTable, productsTable } from "../../lib/db/src/index";
import { inArray } from "drizzle-orm";

async function patchOrdersCostPrice() {
  // Busca todos os pedidos
  // Corrige apenas pedidos pagos ou completed
  const orders = await db.select().from(ordersTable).where(
    (row) => ["paid", "completed"].includes(row.status)
  );
  for (const order of orders) {
    let products = [];
    // Tenta parsear products mesmo se mal formatado
    if (typeof order.products === "string") {
      try {
        const parsed = JSON.parse(order.products);
        if (Array.isArray(parsed)) products = parsed;
        else if (parsed && typeof parsed === "object") products = [parsed];
        else products = [];
      } catch {
        products = [];
      }
    } else if (Array.isArray(order.products)) {
      products = order.products;
    } else {
      products = [];
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
    // Atualiza o campo costPrice de cada produto, força array de objetos válidos
    const patchedProducts = products.map((p) => ({
      id: p.id,
      name: p.name,
      quantity: Number(p.quantity) || 0,
      price: Number(p.price) || 0,
      costPrice: productCostMap.get(String(p.id)) ?? 0,
    }));
    // Atualiza o pedido no banco se necessário
    await db.update(ordersTable)
      .set({ products: JSON.stringify(patchedProducts) })
      .where(ordersTable.id, "=", order.id);
    console.log(`Pedido ${order.id} corrigido.`);
  }
  console.log("Todos os pedidos pagos/completed foram corrigidos.");
}

patchOrdersCostPrice().then(() => process.exit(0));
