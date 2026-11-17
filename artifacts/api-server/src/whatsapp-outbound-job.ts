import { runWhatsappOutboundTick } from "./lib/whatsapp-outbound-queue";

const TICK_MS = 60_000;

export function startWhatsappOutboundJob(): void {
  let ticking = false;
  const tick = () => {
    if (ticking) return;
    ticking = true;
    void runWhatsappOutboundTick()
      .catch(() => {
        console.warn("[WhatsApp fila] ciclo falhou");
      })
      .finally(() => {
        ticking = false;
      });
  };
  setInterval(tick, TICK_MS);
  console.info("[WhatsApp fila] conferência a cada 60s. No máximo 1 envio a cada 10 min e 10 por hora, por número.");
}
