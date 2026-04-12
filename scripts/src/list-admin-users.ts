// Script para listar todos os usuários admin cadastrados
// Basta rodar: pnpm tsx scripts/src/list-admin-users.ts

import { db, adminUsersTable } from "../../lib/db/src/index";

async function main() {
  const users = await db.select().from(adminUsersTable);
  console.log("Usuários admin cadastrados:");
  for (const user of users) {
    console.log("- username:", user.username);
  }
}

main().catch((err) => {
  console.error("Erro ao listar usuários:", err);
  process.exit(1);
});
