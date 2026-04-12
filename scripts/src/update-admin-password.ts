// Script para atualizar a senha do admin existente
// Basta rodar: pnpm tsx scripts/src/update-admin-password.ts

import { db, adminUsersTable } from "../../lib/db/src/index";
import { sql } from "drizzle-orm";
import crypto from "crypto";

async function main() {
  const username = "jorge2306@gmail.com";
  const password = "@Gh230600";
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = crypto.createHash("sha256").update(password + salt).digest("hex");

  // Busca ignorando case e espaços
  const [user] = await db.select().from(adminUsersTable)
    .where(sql`LOWER(TRIM(${adminUsersTable.username})) = LOWER(TRIM(${username}))`).limit(1);

  if (!user) {
    console.log("Usuário não encontrado para atualizar.");
    return;
  }

  const updated = await db.update(adminUsersTable)
    .set({ passwordHash, salt })
    .where(sql`id = ${user.id}`);

  console.log("Senha do admin atualizada com sucesso!");
}

main().catch((err) => {
  console.error("Erro ao atualizar senha:", err);
  process.exit(1);
});
