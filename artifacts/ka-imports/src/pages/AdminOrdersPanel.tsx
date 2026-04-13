import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Package, CreditCard, QrCode, Tag, CheckCircle, XCircle, Upload, Eye, CheckCircle2, Copy, Pencil, ChevronUp, ChevronDown, MessageCircle } from "lucide-react";
import { formatCurrency, formatDateBR } from "@/lib/utils";
import { orderToText } from "./Admin";
import { toast } from "sonner";

export default function OrdersPanel({
  orders, statusUpdating, expandedOrder, setExpandedOrder,
  updateOrderStatus, setProofModal, setProofViewer, openWhatsApp,
  onOpenCardPaidModal, updateOrderObservation, isPrimary, onEditOrder, onOpenKycModal,
}) {
  const [copiedOrderId, setCopiedOrderId] = useState(null);

  const copyOrder = (order) => {
    navigator.clipboard.writeText(orderToText(order)).then(() => {
      setCopiedOrderId(order.id);
      toast.success("Dados copiados!");
      setTimeout(() => setCopiedOrderId(null), 2500);
    }).catch(() => toast.error("Não foi possível copiar."));
  };

  if (orders.length === 0) return (
    <div className="text-center py-16 bg-muted/30 rounded-2xl border border-dashed">
      <Package className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
      <p className="font-semibold text-lg">Nenhum pedido encontrado</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* ...restante do código do painel de pedidos... */}
      {/* Copie o conteúdo do OrdersPanel daqui para cá, mantendo os hooks apenas no topo */}
    </div>
  );
}
