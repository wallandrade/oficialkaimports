// scripts/fix-orders-missing-id.js
// Script para garantir que todos os pedidos tenham um ID válido
// Use: node scripts/fix-orders-missing-id.js

const mysql = require('mysql2/promise');
const crypto = require('crypto');

async function main() {
  const connection = await mysql.createConnection({
    host: 'localhost', // Altere para seu host
    user: 'root',      // Altere para seu usuário
    password: '',      // Altere para sua senha
    database: 'oficialkaimports' // Altere para seu banco
  });

  // Busca pedidos sem ID ou com ID vazio/nulo
  const [rows] = await connection.execute(
    "SELECT * FROM orders WHERE id IS NULL OR id = ''"
  );

  if (rows.length === 0) {
    console.log('Nenhum pedido sem ID encontrado.');
    await connection.end();
    return;
  }

  for (const order of rows) {
    const newId = crypto.randomBytes(8).toString('hex');
    await connection.execute(
      "UPDATE orders SET id = ? WHERE /* COLOQUE AQUI SUA CHAVE PRIMÁRIA, ex: client_email = ? AND created_at = ? */",
      [newId /*, order.client_email, order.created_at */]
    );
    console.log(`Pedido atualizado: novo id = ${newId}`);
  }

  await connection.end();
  console.log('Processo finalizado.');
}

main().catch(console.error);
