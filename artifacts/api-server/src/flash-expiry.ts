import { expireFlashReservations } from "./lib/flash-offers";

const EXPIRY_CHECK_INTERVAL_MS = 60 * 1000;

async function expireStaleReservations(): Promise<void> {
  try {
    const affected = await expireFlashReservations();
    if (affected > 0) {
      console.log(`[FlashOffer] Liberou ${affected} vaga(s) expirada(s).`);
    }
  } catch (err) {
    console.error("[FlashOffer] Erro ao expirar reservas:", err);
  }
}

export function startFlashExpiryJob(): void {
  setTimeout(() => void expireStaleReservations(), 15_000);
  setInterval(() => void expireStaleReservations(), EXPIRY_CHECK_INTERVAL_MS);
  console.log("[FlashOffer] Job de expiração iniciado (a cada 1 min).");
}
