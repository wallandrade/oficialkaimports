import { db, ordersTable, productsTable } from "../../lib/db/src/index";
import { eq } from "drizzle-orm";
import { inArray } from "drizzle-orm";

async function patchOrdersCostPrice() {
  // Corrige apenas pedidos pagos/concluidos e seleciona somente colunas necessarias.
  // Evita falhas em deploy quando novas colunas ainda nao existem no banco.
  const orders = await db
    .select({
      id: ordersTable.id,
      products: ordersTable.products,
    })
    .from(ordersTable)
    .where(inArray(ordersTable.status, ["paid", "completed"]));
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
      .set({ products: patchedProducts })
      .where(eq(ordersTable.id, order.id));
    console.log(`Pedido ${order.id} corrigido.`);
  }
  console.log("Todos os pedidos pagos/completed foram corrigidos.");
}

patchOrdersCostPrice().then(() => process.exit(0));
