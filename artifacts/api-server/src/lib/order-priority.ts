import { pool } from "@workspace/db";

export async function clearOrderManualPriority(orderId: string): Promise<void> {
  const id = String(orderId || "").trim();
  if (!id) return;

  try {
    await pool.query(
      "UPDATE orders SET is_prioridade = 0, updated_at = NOW() WHERE id = ? AND is_prioridade <> 0",
      [id],
    );
  } catch (err) {
    const message = String((err as { message?: string })?.message || "").toLowerCase();
    if (message.includes("unknown column") || message.includes("is_prioridade")) return;
    throw err;
  }
}
