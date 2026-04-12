// Script para criar a tabela raffle_reservations no banco MySQL
// Basta rodar: pnpm tsx scripts/src/create-raffle-reservations-table.ts

import mysql from "mysql2/promise";

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL || "mysql://root:@localhost:3306/oficialkaimports";
  const connection = await mysql.createConnection(DATABASE_URL);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS raffle_reservations (
      id VARCHAR(255) NOT NULL PRIMARY KEY,
      raffle_id VARCHAR(255) NOT NULL,
      numbers TEXT NOT NULL,
      client_name VARCHAR(255) NOT NULL,
      client_email VARCHAR(255) NOT NULL,
      client_phone VARCHAR(255) NOT NULL,
      client_document VARCHAR(32) NULL,
      total_amount DECIMAL(10,2) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'reserved',
      transaction_id VARCHAR(255) NULL,
      pix_code MEDIUMTEXT NULL,
      pix_base64 MEDIUMTEXT NULL,
      pix_expires_at TIMESTAMP NULL,
      expires_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY raffle_reservations_raffle_id_idx (raffle_id),
      KEY raffle_reservations_client_phone_idx (client_phone),
      KEY raffle_reservations_client_document_idx (client_document),
      KEY raffle_reservations_status_idx (status),
      KEY raffle_reservations_transaction_id_idx (transaction_id)
    );
  `);
  await connection.end();
  console.log("Tabela raffle_reservations criada com sucesso!");
}

main().catch((err) => {
  console.error("Erro ao criar tabela:", err);
  process.exit(1);
});
