import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { useCart } from "@/store/use-cart";
import { MessageCircle, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";
import { fetchAndCacheSellerWhatsApp, makeWhatsAppLink, formatCurrency } from "@/lib/utils";

interface OrderInfo {
  orderId?: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  clientDocument?: string;
  address?: {
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    cep?: string;
  };
  products?: Array<{ name: string; quantity: number; price: number }>;
  shippingType?: string;
  shippingCost?: number;
  includeInsurance?: boolean;
  insuranceAmount?: number;
  subtotal?: number;
  discountAmount?: number;
  couponCode?: string;
  total?: number;
}

function buildTrackingMessage(info: OrderInfo): string {
  const lines: string[] = [];

  lines.push(`✅ *Pedido Confirmado — KA Imports*`);
  lines.push(``);

  if (info.orderId)  lines.push(`*Nº do Pedido:* ${info.orderId}`);
  if (info.clientName) lines.push(`*Nome:* ${info.clientName}`);
  if (info.clientPhone) lines.push(`*Telefone:* ${info.clientPhone}`);
  if (info.clientEmail) lines.push(`*E-mail:* ${info.clientEmail}`);
  if (info.clientDocument) lines.push(`*CPF:* ${info.clientDocument}`);

  if (info.address) {
    const a = info.address;
    const parts = [
      a.street && a.number ? `${a.street}, ${a.number}` : a.street,
      a.complement,
      a.neighborhood,
      a.city && a.state ? `${a.city}/${a.state}` : a.city,
      a.cep ? `CEP ${a.cep}` : undefined,
    ].filter(Boolean);
    if (parts.length > 0) {
      lines.push(``);
      lines.push(`*Endereço de Entrega:*`);
      lines.push(`  ${parts.join(", ")}`);
    }
  }

  if (info.products && info.products.length > 0) {
    lines.push(``);
    lines.push(`*Produtos:*`);
    for (const p of info.products) {
      lines.push(`  • ${p.quantity}x ${p.name} — ${formatCurrency(p.price * p.quantity)}`);
    }
  }

  lines.push(``);
  lines.push(`*Resumo Financeiro:*`);
  if (info.subtotal != null) lines.push(`  Subtotal: ${formatCurrency(info.subtotal)}`);
  if (info.shippingCost != null) {
    const label = info.shippingType === "express" ? "Expresso" : "Normal";
    lines.push(`  Frete (${label}): ${formatCurrency(info.shippingCost)}`);
  }
  if (info.includeInsurance && info.insuranceAmount) {
    lines.push(`  Seguro de Envio: +${formatCurrency(info.insuranceAmount)}`);
  }
  if (info.discountAmount && info.discountAmount > 0) {
    const couponLabel = info.couponCode ? ` (cupom: ${info.couponCode})` : "";
    lines.push(`  Desconto${couponLabel}: -${formatCurrency(info.discountAmount)}`);
  }
  if (info.total != null) lines.push(`  *Total Pago: ${formatCurrency(info.total)}*`);

  lines.push(``);
  lines.push(`Quero acompanhar meu pedido. Obrigado!`);

  return lines.join("\n");
}

export default function Success() {
  const [, setLocation] = useLocation();
  const { clearCart } = useCart();
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);

  useEffect(() => {
    clearCart();
    const raw = localStorage.getItem("successOrder");
    if (raw) {
      try { setOrderInfo(JSON.parse(raw)); } catch { /* ignore */ }
    }
    localStorage.removeItem("currentPix");
    localStorage.removeItem("successOrder");
  }, [clearCart]);

  useEffect(() => {
    const sellerCode =
      sessionStorage.getItem("sellerCode") || localStorage.getItem("sellerCode");
    if (sellerCode && !sessionStorage.getItem("sellerWhatsapp")) {
      fetchAndCacheSellerWhatsApp(sellerCode);
    }
  }, []);

  const handleTrackingClick = () => {
    const msg = orderInfo
      ? buildTrackingMessage(orderInfo)
      : `Olá! Gostaria de acompanhar meu pedido.`;
    window.open(makeWhatsAppLink(msg), "_blank", "noopener,noreferrer");
  };

  return (
    <AppLayout minimal>
      <div className="flex-1 flex items-center justify-center p-4">
        <div
          className="bg-card max-w-md w-full rounded-3xl shadow-2xl border border-border/50 p-8 md:p-12 text-center relative overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-700"
        >
          <div className="absolute -top-10 -left-10 w-32 h-32 bg-green-500/10 rounded-full blur-3xl"></div>
          <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-primary/10 rounded-full blur-3xl"></div>

          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: "spring", damping: 12 }}
            className="relative w-32 h-32 mx-auto mb-8"
          >
            <div className="absolute inset-0 bg-green-100 rounded-full animate-pulse"></div>
            <div className="w-full h-full flex items-center justify-center relative z-10">
              <CheckCircle className="w-20 h-20 text-green-500" />
            </div>
          </motion.div>

          <h1 className="text-3xl font-display font-bold text-foreground mb-4">
            Pagamento Recebido!
          </h1>
          <p className="text-muted-foreground text-lg mb-2 leading-relaxed">
            Muito obrigado pela sua compra na KA Imports.
          </p>
          <p className="text-muted-foreground mb-8 leading-relaxed">
            Seu pedido já está sendo processado e em breve entraremos em contato.
          </p>

          <div className="space-y-4">
            <Button
              size="lg"
              className="w-full text-lg shadow-xl shadow-green-500/20 bg-green-500 hover:bg-green-600 border-none text-white"
              onClick={handleTrackingClick}
            >
              <MessageCircle className="w-5 h-5 mr-2" />
              Acompanhar Pedido via WhatsApp
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="w-full text-lg"
              onClick={() => setLocation("/")}
            >
              Voltar à Loja
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
