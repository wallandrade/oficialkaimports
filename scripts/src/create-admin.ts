// Script para criar um admin diretamente no banco usando Drizzle ORM
// Basta rodar: pnpm tsx scripts/src/create-admin.ts

import { db, adminUsersTable } from "../../lib/db/src/index";
import crypto from "crypto";

async function main() {
  const username = "jorge2306@gmail.com";
  const password = "@Gh230600";
  const isPrimary = true;
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = crypto.createHash("sha256").update(password + salt).digest("hex");
  const id = crypto.randomBytes(8).toString("hex");

  await db.insert(adminUsersTable).values({
    id,
    username,
    passwordHash,
    salt,
    isPrimary,
    createdBy: null,
    createdAt: new Date(),
  });
  console.log("Usuário admin criado com sucesso:", username);
}

main().catch((err) => {
  console.error("Erro ao criar admin:", err);
  process.exit(1);
});
