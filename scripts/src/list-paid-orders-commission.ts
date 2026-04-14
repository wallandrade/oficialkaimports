import { db, ordersTable } from "../../lib/db/src/index";
import { and, gte, lte, inArray } from "drizzle-orm";
import 'dotenv/config';
// Adiciona log detalhado para CSV
import fs from 'fs';

async function listPaidOrdersWithCommission(dateFrom: string, dateTo: string) {
  // Função para converter data local (BRT) para UTC
  function toUTC(dateStr: string, hour: string, minute: string, second: string) {
    const local = new Date(`${dateStr}T${hour}:${minute}:${second}-03:00`);
    return new Date(local.toISOString());
  }
  const conditions = [];
  if (dateFrom) conditions.push(gte(ordersTable.createdAt, toUTC(dateFrom, "00", "00", "00")));
  if (dateTo) conditions.push(lte(ordersTable.createdAt, toUTC(dateTo, "23", "59", "59")));
  conditions.push(inArray(ordersTable.status, ["paid", "completed"]));
  const orders = await db.select().from(ordersTable).where(and(...conditions));

  const output: string[] = [
    'id,total,status,sellerCode,sellerCommissionRateSnapshot,sellerCommissionRate,commission',
  ];
  for (const order of orders) {
    const total = parseFloat(order.total || "0");
    let rate = 0;
    if (order.sellerCommissionRateSnapshot !== undefined && order.sellerCommissionRateSnapshot !== null) {
      rate = Number(order.sellerCommissionRateSnapshot) || 0;
    } else if (order.sellerCommissionRate !== undefined && order.sellerCommissionRate !== null) {
      rate = Number(order.sellerCommissionRate) || 0;
    }
    const commission = total * (rate / 100);
    output.push([
      order.id,
      total,
      order.status,
      order.sellerCode,
      order.sellerCommissionRateSnapshot,
      order.sellerCommissionRate,
      commission.toFixed(2),
    ].join(','));
  }
  fs.writeFileSync('paid-orders-commission.csv', output.join('\n'), 'utf8');
  console.log('Arquivo paid-orders-commission.csv gerado com sucesso!');
}

// Exemplo de uso: datas do período desejado
listPaidOrdersWithCommission("2026-04-10", "2026-04-14").then(() => process.exit(0));
