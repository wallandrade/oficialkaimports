import { useEffect, useState, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Copy, CheckCircle2, Clock, AlertCircle, MessageCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useGetPixStatus, useGeneratePix } from "@workspace/api-client-react";
import { fetchAndCacheSellerWhatsApp, makeWhatsAppLink, formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface StoredPix {
  transactionId: string;
  expiresAt: string;
  pixCode: string;
  pixBase64: string;
  pixImage?: string;
  orderId: string;
}

interface PixOrderData {
  client: { name: string; email: string; phone: string; document: string };
  products: Array<{ id: string; name: string; quantity: number; price: number }>;
  amount: number;
  shippingType: string;
  includeInsurance: boolean;
  orderId: string;
}

export default function PixPayment() {
  const [, params] = useRoute("/pix/:id");
  const transactionId = params?.id ?? "";
  const [, setLocation] = useLocation();

  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [storedPix, setStoredPix] = useState<StoredPix | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const { mutate: generatePix } = useGeneratePix();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pixStatusOptions: any = {
    query: {
      enabled: Boolean(transactionId),
      queryKey: ["pixStatus", transactionId],
      refetchInterval: (q: { state: { data?: { status?: string } } }) => {
        const st = (q.state.data?.status || "").toUpperCase();
        if (st === "OK" || st === "PAID" || st === "APPROVED" || st === "CONFIRMED") return false;
        return 2000;
      },
    },
  };
  const { data: statusData } = useGetPixStatus(transactionId, pixStatusOptions);

  useEffect(() => {
    const s = (statusData?.status || "").toUpperCase();
    if (s === "OK" || s === "PAID" || s === "APPROVED" || s === "CONFIRMED") {
      setLocation("/success");
    }
  }, [statusData, setLocation]);

  // Pre-fetch seller WhatsApp if not already in session (e.g. page refresh)
  useEffect(() => {
    const sellerCode =
      sessionStorage.getItem("sellerCode") || localStorage.getItem("sellerCode");
    if (sellerCode && !sessionStorage.getItem("sellerWhatsapp")) {
      fetchAndCacheSellerWhatsApp(sellerCode);
    }
  }, []);

  useEffect(() => {
    if (!transactionId) return;

    const stored = localStorage.getItem("currentPix");

    if (!stored) {
      setLocation("/checkout");
      return;
    }

    let parsed: StoredPix;
    try {
      parsed = JSON.parse(stored) as StoredPix;
    } catch {
      setLocation("/checkout");
      return;
    }

    if (parsed.transactionId !== transactionId) {
      setLocation("/checkout");
      return;
    }

    setStoredPix(parsed);

    const expires = new Date(parsed.expiresAt).getTime();
    const interval = setInterval(() => {
      const diff = Math.max(0, Math.floor((expires - Date.now()) / 1000));
      setTimeLeft(diff);
      if (diff === 0) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  }, [transactionId, setLocation]);

  const handleCopy = async () => {
    if (!storedPix?.pixCode) return;
    try {
      await navigator.clipboard.writeText(storedPix.pixCode);
      setIsCopied(true);
      toast.success("Código PIX copiado!");
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      toast.error("Falha ao copiar código");
    }
  };

  const handleRegenerate = useCallback(async () => {
    const raw = localStorage.getItem("pixOrderData");
    if (!raw) {
      // If no saved data, go back to checkout
      setLocation("/checkout");
      return;
    }

    let orderData: PixOrderData;
    try {
      orderData = JSON.parse(raw) as PixOrderData;
    } catch {
      setLocation("/checkout");
      return;
    }

    setIsRegenerating(true);
    generatePix(
      {
        data: {
          client:          orderData.client,
          products:        orderData.products,
          amount:          orderData.amount,
          shippingType:    orderData.shippingType,
          includeInsurance: orderData.includeInsurance,
          orderId:         orderData.orderId,
        },
      },
      {
        onSuccess: (response) => {
          localStorage.setItem(
            "currentPix",
            JSON.stringify({
              transactionId: response.transactionId,
              expiresAt:     response.expiresAt,
              pixCode:       response.pixCode,
              pixBase64:     response.pixBase64,
              pixImage:      response.pixImage,
              orderId:       orderData.orderId,
            })
          );
          setIsRegenerating(false);
          setLocation(`${BASE}/pix/${response.transactionId}`);
          setTimeout(() => window.location.reload(), 100);
        },
        onError: () => {
          setIsRegenerating(false);
          toast.error("Erro ao gerar novo PIX. Tente novamente.");
        },
      }
    );
  }, [generatePix, setLocation]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleSupportClick = () => {
    let msg = storedPix?.orderId
      ? `Olá! Realizei o pagamento via PIX e gostaria de confirmar.\n*Pedido:* ${storedPix.orderId}`
      : `Olá! Realizei o pagamento via PIX e gostaria de confirmar.`;

    // Try to enrich message with full order details from localStorage
    try {
      const raw = localStorage.getItem("successOrder");
      if (raw) {
        const order = JSON.parse(raw) as {
          orderId: string;
          clientName: string;
          clientPhone: string;
          clientEmail: string;
          clientDocument: string;
          address: { street: string; number: string; complement: string; neighborhood: string; city: string; state: string; cep: string };
          products: Array<{ name: string; quantity: number; price: number }>;
          shippingType: string;
          shippingCost: number;
          includeInsurance: boolean;
          insuranceAmount: number;
          subtotal: number;
          discountAmount: number;
          couponCode: string;
          total: number;
        };

        const addressFull = [
          `${order.address.street}, ${order.address.number}`,
          order.address.complement,
          order.address.neighborhood,
          `${order.address.city}/${order.address.state}`,
          `CEP ${order.address.cep}`,
        ].filter(Boolean).join(", ");

        const itemsText = order.products
          .map((p) => `  • ${p.quantity}x ${p.name} — ${formatCurrency(p.price * p.quantity)}`)
          .join("\n");

        msg =
          `✅ *Pagamento PIX Realizado — KA Imports*\n\n` +
          `*Nº do Pedido:* ${order.orderId}\n` +
          `*Cliente:* ${order.clientName}\n` +
          `*CPF:* ${order.clientDocument}\n` +
          `*Telefone:* ${order.clientPhone}\n` +
          `*E-mail:* ${order.clientEmail}\n\n` +
          `*Endereço de Entrega:*\n  ${addressFull}\n\n` +
          `*Produtos:*\n${itemsText}\n\n` +
          `*Subtotal:* ${formatCurrency(order.subtotal)}\n` +
          `*Frete (${order.shippingType}):* ${formatCurrency(order.shippingCost)}\n` +
          (order.includeInsurance ? `*Seguro de Envio:* Sim (+${formatCurrency(order.insuranceAmount)})\n` : "") +
          (order.discountAmount > 0
            ? `*Desconto${order.couponCode ? ` (${order.couponCode})` : ""}:* -${formatCurrency(order.discountAmount)}\n`
            : "") +
          `*Total Pago:* ${formatCurrency(order.total)}\n\n` +
          `Pagamento realizado via PIX. Aguardo confirmação!`;
      }
    } catch {
      // Fall back to simple message
    }

    window.open(makeWhatsAppLink(msg), "_blank", "noopener,noreferrer");
  };

  const isLoading = timeLeft === null;

  if (isLoading) {
    return (
      <AppLayout minimal>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-muted-foreground font-medium">Carregando pagamento...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  const isExpired = timeLeft === 0;

  const getQRSource = () => {
    if (storedPix?.pixBase64 && storedPix.pixBase64.length > 10) {
      return storedPix.pixBase64.startsWith("data:image")
        ? storedPix.pixBase64
        : `data:image/png;base64,${storedPix.pixBase64}`;
    }
    if (storedPix?.pixImage && storedPix.pixImage.startsWith("http")) {
      return storedPix.pixImage;
    }
    return null;
  };

  const qrSource = getQRSource();

  return (
    <AppLayout minimal>
      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-12">
        <div className="bg-card rounded-3xl shadow-xl border border-border/50 overflow-hidden">
          <div className="bg-primary p-8 text-center text-white">
            <h1 className="text-3xl font-display font-bold mb-2">Pagamento via PIX</h1>
            <p className="text-white/80">Escaneie o QR Code ou copie o código para pagar.</p>
          </div>

          <div className="p-8 md:p-12 flex flex-col items-center">
            {isExpired ? (
              <div className="text-center space-y-6 animate-in fade-in zoom-in duration-500">
                <div className="w-24 h-24 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
                  <AlertCircle className="w-12 h-12 text-destructive" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-foreground">PIX Expirado</h2>
                  <p className="text-muted-foreground mt-2">O tempo limite de 15 minutos foi atingido.</p>
                </div>
                <div className="flex flex-col gap-3 w-full max-w-xs">
                  <Button
                    size="lg"
                    onClick={handleRegenerate}
                    disabled={isRegenerating}
                    className="gap-2"
                  >
                    {isRegenerating ? (
                      <><Loader2 className="w-5 h-5 animate-spin" />Gerando novo PIX...</>
                    ) : (
                      "Gerar Novo PIX"
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="w-full max-w-sm space-y-8 animate-in fade-in zoom-in duration-500">
                {/* Timer */}
                <div className="flex items-center justify-center gap-3 text-secondary font-bold text-2xl bg-secondary/10 py-3 rounded-2xl border border-secondary/20">
                  <Clock className="w-6 h-6 animate-pulse" />
                  <span>{formatTime(timeLeft)}</span>
                </div>

                {/* QR Code */}
                <div className="bg-white p-4 rounded-3xl shadow-md border-2 border-border mx-auto w-64 h-64 flex items-center justify-center overflow-hidden">
                  {qrSource ? (
                    <img src={qrSource} alt="QR Code PIX" className="w-full h-full object-contain" />
                  ) : (
                    <div className="text-center text-muted-foreground flex flex-col items-center gap-2">
                      <svg viewBox="0 0 21 21" className="w-40 h-40 opacity-30" fill="currentColor">
                        <path d="M0 0h9v9H0zm2 2v5h5V2zm1 1h3v3H3zM12 0h9v9h-9zm2 2v5h5V2zm1 1h3v3h-3zM0 12h9v9H0zm2 2v5h5v-5zm1 1h3v3H3zM12 11h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm2 2h2v2h-2zm2-4h2v2h-2zm0 4h2v2h-2zm2-2h2v2h-2z"/>
                      </svg>
                      <p className="text-xs font-medium">QR Code</p>
                    </div>
                  )}
                </div>

                {/* Copy code */}
                {storedPix?.pixCode ? (
                  <div className="space-y-3 w-full">
                    <label className="text-sm font-semibold text-foreground text-center block">Código Copia e Cola</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={storedPix.pixCode}
                        readOnly
                        className="w-full h-14 pl-4 pr-14 rounded-xl border-2 border-border bg-muted/50 text-muted-foreground text-sm font-mono truncate outline-none"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="absolute right-2 top-2 h-10 w-10 bg-white shadow-sm border border-border text-primary hover:text-primary hover:bg-primary/5"
                        onClick={handleCopy}
                      >
                        {isCopied ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                      </Button>
                    </div>
                    <Button className="w-full gap-2" variant={isCopied ? "default" : "outline"} onClick={handleCopy}>
                      {isCopied ? <><CheckCircle2 className="w-4 h-4" />Copiado!</> : <><Copy className="w-4 h-4" />Copiar Código PIX</>}
                    </Button>
                  </div>
                ) : !qrSource ? (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-center space-y-2">
                    <p className="text-sm font-semibold text-amber-800">Código PIX indisponível</p>
                    <p className="text-xs text-amber-700">Use o botão abaixo para falar com o suporte e concluir o pagamento.</p>
                  </div>
                ) : null}

                <p className="text-center text-sm text-muted-foreground">
                  Aguardando confirmação do pagamento. Esta tela será atualizada automaticamente.
                </p>

                <button
                  type="button"
                  onClick={handleSupportClick}
                  className="flex items-center justify-center gap-2 text-sm text-green-700 font-medium hover:text-green-800 transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  Já paguei e não atualizou? Fale conosco
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
