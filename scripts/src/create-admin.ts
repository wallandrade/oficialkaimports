
// Script para criar um admin diretamente no banco usando Drizzle ORM
// Basta rodar: pnpm tsx scripts/src/create-admin.ts



import { db, adminUsersTable } from "../../lib/db/src/index";
import crypto from "crypto";

async function main() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
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
