import { sendNextRecovery } from "./whatsapp-recovery";

const INTERVAL_MS = 3 * 60 * 1000;
const STARTUP_DELAY_MS = 45 * 1000;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await sendNextRecovery();
    if (result.sent) console.log("[WhatsAppRecovery] enviado", result.phone);
  } catch (error) {
    console.error("[WhatsAppRecovery] falha", error);
  } finally {
    running = false;
  }
}

export function startWhatsappRecoveryJob(): void {
  setTimeout(() => void tick(), STARTUP_DELAY_MS);
  setInterval(() => void tick(), INTERVAL_MS);
}
