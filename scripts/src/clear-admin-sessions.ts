// Script para limpar todas as sessões admin e garantir ambiente limpo
import { db, adminSessionsTable } from "../../lib/db/src/index";

async function main() {
  await db.delete(adminSessionsTable);
  console.log("Todas as sessões admin foram removidas.");
}

main().catch((err) => {
  console.error("Erro ao limpar sessões:", err);
  process.exit(1);
});
