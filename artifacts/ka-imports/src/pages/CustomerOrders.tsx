import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { clearCustomerToken, fetchCustomerProfile, getCustomerAuthHeaders } from "@/lib/customer-auth";
import { formatCurrency, formatDateBR, getActiveWhatsApp } from "@/lib/utils";
import { Copy, DollarSign, Gift, Loader2, LogOut, Package, Save, Ticket, Users, CheckCircle2, Clock, AlertCircle, MessageCircle, Truck, X } from "lucide-react";
import { toast } from "sonner";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type TrackingEvent = {
  at?: string;
  status?: string;
  location?: string | null;
  description?: string | null;
};

type CustomerOrder = {
  id: string;
  orderNumber?: number | null;
  total: number;
  status: string;
  enviado?: boolean;
  paymentMethod: string;
  createdAt: string;
  clientName?: string;
  clientPhone?: string;
  products?: Array<{ name: string; quantity: number; price: number }>;
  subtotal?: number;
  shippingCost?: number;
  insuranceAmount?: number;
  shippingType?: string;
  trackingCode?: string | null;
  envioecomShipmentId?: number | null;
  envioecomStatus?: string | null;
  envioecomDeliveryMode?: string | null;
  envioecomBarcode?: string | null;
  envioecomStatusHistory?: TrackingEvent[];
};

type AccountSection = "orders" | "affiliate" | "raffle";

type AffiliateDashboardResponse = {
  summary: {
    commissionsReleased: number;
    commissionsPending: number;
    referralsActive: number;
    referralsInactive: number;
  };
  affiliate: {
    code: string;
    referralLink: string;
    facebookPixelId: string;
  };
};

function getOrderDisplayId(order: { id: string; orderNumber?: number | null }): string {
  const numeric = Number(order.orderNumber);
  if (Number.isFinite(numeric) && numeric > 0) {
    return String(Math.trunc(numeric));
  }
  return String(order.id || "-");
}

function resolveStoreReferralLink(link: string, code: string): string {
  if (typeof window === "undefined") {
    return link;
  }

  const fallback = code ? `${window.location.origin}/?ref=${code}` : link;
  if (!link) {
    return fallback;
  }

  try {
    const parsed = new URL(link);
    const isLocalApiOrigin =
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") && parsed.port === "5000";

    if (isLocalApiOrigin) {
      return fallback;
    }

    return link;
  } catch {
    return fallback;
  }
}

const statusLabel: Record<string, string> = {
  enviado: "Enviado",
  pending: "Pendente",
  awaiting_payment: "Aguardando pagamento",
  paid: "Pago",
  completed: "Concluído",
  cancelled: "Cancelado",
};

function getStatusColor(status: string): string {
  switch (status) {
    case "enviado":
      return "bg-blue-100 text-blue-800 border border-blue-300";
    case "paid":
    case "completed":
      return "bg-green-100 text-green-800 border border-green-300";
    case "awaiting_payment":
    case "pending":
      return "bg-yellow-100 text-yellow-800 border border-yellow-300";
    case "cancelled":
      return "bg-red-100 text-red-800 border border-red-300";
    default:
      return "bg-gray-100 text-gray-800 border border-gray-300";
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "enviado":
      return <Truck className="w-5 h-5" />;
    case "paid":
    case "completed":
      return <CheckCircle2 className="w-5 h-5" />;
    case "awaiting_payment":
    case "pending":
      return <Clock className="w-5 h-5" />;
    case "cancelled":
      return <X className="w-5 h-5" />;
    default:
      return <Package className="w-5 h-5" />;
  }
}

function normalizeTrackingText(value?: string | null): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isOpenEnvioEcomTracking(status?: string | null): boolean {
  const normalized = normalizeTrackingText(status);
  if (!normalized) return true;
  return !normalized.includes("cancelad") && !normalized.includes("entregue");
}

function isPackingBeforePostStatus(status?: string | null): boolean {
  const normalized = normalizeTrackingText(status);
  if (!normalized) return false;
  if (normalized.includes("cancelad") || normalized.includes("aguardando pagamento")) return false;
  if (["coletado", "em transito", "postado", "saiu para entrega", "entregue"].some((marker) => normalized.includes(marker))) {
    return false;
  }
  return [
    "pronto para envio",
    "etiqueta",
    "processando envio",
    "aguardando expedicao",
    "dc-e",
    "dce",
    "envio criado",
    "aguardando postagem",
  ].some((marker) => normalized.includes(marker));
}

function toCustomerFriendlyShippingLabel(status?: string | null): string {
  const raw = String(status || "").trim();
  if (!raw) return raw;
  const normalized = normalizeTrackingText(raw);
  if (isPackingBeforePostStatus(raw)) return "Estamos embalando seu pedido";
  if (normalized.includes("aguardando pagamento")) return "Preparando envio";
  if (normalized.includes("saiu para entrega") || normalized.includes("em rota")) return "Saiu para entrega";
  if (normalized.includes("entregue")) return "Entregue";
  return raw;
}

function customerShippingHint(status?: string | null): string | null {
  if (!isPackingBeforePostStatus(status)) return null;
  return "Em breve ele será despachado. Aguarde a atualização do rastreio.";
}

function getCustomerSituation(order: CustomerOrder, displayStatus: string): string {
  if (order.envioecomStatus) {
    return toCustomerFriendlyShippingLabel(order.envioecomStatus);
  }
  if (displayStatus === "completed") return "Entregue";
  if (displayStatus === "paid") return "Processando";
  return statusLabel[displayStatus] || displayStatus;
}

function hasEnvioEcomTracking(order: CustomerOrder): boolean {
  return !!(order.envioecomShipmentId || order.envioecomBarcode || order.envioecomStatus);
}

function usefulTrackingLocation(event: TrackingEvent): string | null {
  const location = String(event.location || "").trim();
  if (!location) return null;
  if (normalizeTrackingText(location) === normalizeTrackingText(event.status)) return null;
  return location;
}

function usefulTrackingDescription(event: TrackingEvent): string | null {
  const description = String(event.description || "").trim();
  if (!description) return null;
  const normalized = normalizeTrackingText(description);
  if (normalized.includes("status atualizado ao consultar") || normalized.includes("consultando rastreio")) return null;
  if (normalized === normalizeTrackingText(event.status) || normalized === normalizeTrackingText(event.location)) return null;
  return description;
}

function TrackingTimeline({ events }: { events: TrackingEvent[] }) {
  const items = [...events].reverse();
  if (!items.length) return null;
  return (
    <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
      {items.map((event, index) => {
        const location = usefulTrackingLocation(event);
        const description = usefulTrackingDescription(event);
        return (
          <div key={`${event.at}-${event.status}-${index}`} className="border-l-2 border-emerald-300 pl-3 py-1">
            <p className="text-sm font-semibold text-foreground">{toCustomerFriendlyShippingLabel(event.status) || event.status}</p>
            {location && <p className="text-xs text-muted-foreground">{location}</p>}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
            {event.at && <p className="text-[11px] text-muted-foreground">{formatDateBR(event.at)}</p>}
          </div>
        );
      })}
    </div>
  );
}

export default function CustomerOrders() {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState("");
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [activeSection, setActiveSection] = useState<AccountSection>("orders");
  const [affiliateLoading, setAffiliateLoading] = useState(true);
  const [affiliateData, setAffiliateData] = useState<AffiliateDashboardResponse | null>(null);
  const [pixelIdInput, setPixelIdInput] = useState("");
  const [isSavingPixel, setIsSavingPixel] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [loadingDetails, setLoadingDetails] = useState<string | null>(null);
  const [refreshingTrackingId, setRefreshingTrackingId] = useState<string | null>(null);

  const affiliateSummary = useMemo(() => {
    return affiliateData?.summary || {
      commissionsReleased: 0,
      commissionsPending: 0,
      referralsActive: 0,
      referralsInactive: 0,
    };
  }, [affiliateData]);

  useEffect(() => {
    let active = true;

    async function load() {
      const profile = await fetchCustomerProfile(BASE);
      if (!profile) {
        if (active) setLocation("/login");
        return;
      }

      try {
        const [ordersRes, affiliateRes] = await Promise.all([
          fetch(`${BASE}/api/me/orders`, {
            headers: getCustomerAuthHeaders(),
          }),
          fetch(`${BASE}/api/me/affiliate/dashboard`, {
            headers: getCustomerAuthHeaders(),
          }),
        ]);

        if (ordersRes.status === 401 || affiliateRes.status === 401) {
          clearCustomerToken();
          if (active) setLocation("/login");
          return;
        }

        if (!ordersRes.ok) {
          throw new Error("Falha ao carregar pedidos");
        }

        const ordersData = (await ordersRes.json()) as { orders?: CustomerOrder[] };
        const affiliatePayload = affiliateRes.ok
          ? ((await affiliateRes.json()) as AffiliateDashboardResponse)
          : null;

        const normalizedAffiliatePayload = affiliatePayload
          ? {
              ...affiliatePayload,
              affiliate: {
                ...affiliatePayload.affiliate,
                referralLink: resolveStoreReferralLink(
                  affiliatePayload.affiliate.referralLink,
                  affiliatePayload.affiliate.code,
                ),
              },
            }
          : null;

        if (!active) return;

        setProfileName(profile.name);
        setOrders(ordersData.orders || []);
        setAffiliateData(normalizedAffiliatePayload);
        setPixelIdInput(normalizedAffiliatePayload?.affiliate?.facebookPixelId || "");
      } catch {
        toast.error("Não foi possível carregar seus pedidos.");
      } finally {
        if (active) {
          setLoading(false);
          setAffiliateLoading(false);
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [setLocation]);

  const openTrackingKey = useMemo(
    () => orders
      .filter((order) => hasEnvioEcomTracking(order) && isOpenEnvioEcomTracking(order.envioecomStatus))
      .map((order) => order.id)
      .sort()
      .join(","),
    [orders],
  );

  useEffect(() => {
    if (loading || !openTrackingKey) return;
    let cancelled = false;

    async function syncOpenTracking() {
      try {
        const res = await fetch(`${BASE}/api/me/orders/tracking-sync`, {
          method: "POST",
          headers: getCustomerAuthHeaders(),
          body: JSON.stringify({}),
        });
        if (!res.ok) return;
        const data = await res.json() as {
          orders?: Array<{
            id: string;
            enviado?: boolean;
            status?: string;
            envioecomStatus?: string | null;
            envioecomDeliveryMode?: string | null;
            envioecomBarcode?: string | null;
            trackingCode?: string | null;
            envioecomStatusHistory?: TrackingEvent[];
          }>;
        };
        if (cancelled || !Array.isArray(data.orders) || !data.orders.length) return;
        setOrders((prev) => prev.map((item) => {
          const next = data.orders?.find((order) => order.id === item.id);
          if (!next) return item;
          return {
            ...item,
            enviado: next.enviado ?? item.enviado,
            status: next.status || item.status,
            envioecomStatus: next.envioecomStatus ?? item.envioecomStatus,
            envioecomDeliveryMode: next.envioecomDeliveryMode ?? item.envioecomDeliveryMode,
            envioecomBarcode: next.envioecomBarcode ?? item.envioecomBarcode,
            trackingCode: next.trackingCode ?? item.trackingCode,
            envioecomStatusHistory: next.envioecomStatusHistory ?? item.envioecomStatusHistory,
          };
        }));
      } catch {
        // soft-sync: a lista local continua válida
      }
    }

    void syncOpenTracking();
    const timer = window.setInterval(() => void syncOpenTracking(), 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loading, openTrackingKey]);

  function handleLogout() {
    clearCustomerToken();
    toast.success("Você saiu da conta.");
    setLocation("/");
  }

  async function handleCopyReferralLink() {
    const link = affiliateData?.affiliate?.referralLink || "";
    if (!link) {
      toast.error("Seu link ainda não está disponível.");
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link de divulgação copiado!");
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  }

  async function handleSavePixel() {
    setIsSavingPixel(true);
    try {
      const res = await fetch(`${BASE}/api/me/affiliate/facebook-pixel`, {
        method: "PATCH",
        headers: getCustomerAuthHeaders(),
        body: JSON.stringify({ pixelId: pixelIdInput }),
      });

      if (!res.ok) {
        throw new Error("Falha ao salvar pixel");
      }

      const payload = (await res.json()) as { facebookPixelId?: string };
      setAffiliateData((prev) => prev ? {
        ...prev,
        affiliate: {
          ...prev.affiliate,
          facebookPixelId: payload.facebookPixelId || "",
        },
      } : prev);

      toast.success("Pixel salvo com sucesso.");
    } catch {
      toast.error("Não foi possível salvar o pixel.");
    } finally {
      setIsSavingPixel(false);
    }
  }

  async function handleExpandOrder(orderId: string) {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
      return;
    }

    setExpandedOrderId(orderId);
    const existingOrder = orders.find((o) => o.id === orderId);
    if (existingOrder?.products) {
      return;
    }

    setLoadingDetails(orderId);
    try {
      const res = await fetch(`${BASE}/api/me/orders/${orderId}`, {
        headers: getCustomerAuthHeaders(),
      });

      if (!res.ok) {
        throw new Error("Falha ao carregar detalhes");
      }

      const data = (await res.json()) as { order?: CustomerOrder };
      const orderDetails = data.order;

      if (orderDetails) {
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, ...orderDetails } : o))
        );
      }
    } catch (err) {
      console.error("Erro ao carregar detalhes:", err);
      toast.error("Não foi possível carregar os detalhes do pedido.");
    } finally {
      setLoadingDetails(null);
    }
  }

  async function handleRefreshTracking(order: CustomerOrder) {
    setRefreshingTrackingId(order.id);
    try {
      const res = await fetch(`${BASE}/api/me/orders/${order.id}/tracking`, {
        headers: getCustomerAuthHeaders(),
      });
      if (!res.ok) throw new Error("Falha ao atualizar rastreio");
      const data = await res.json() as {
        envioecomStatus?: string | null;
        deliveryMode?: string | null;
        barcode?: string | null;
        history?: TrackingEvent[];
      };
      setOrders((prev) => prev.map((item) => item.id === order.id ? {
        ...item,
        envioecomStatus: data.envioecomStatus || item.envioecomStatus,
        envioecomDeliveryMode: data.deliveryMode || item.envioecomDeliveryMode,
        envioecomBarcode: data.barcode || item.envioecomBarcode,
        trackingCode: data.barcode || item.trackingCode,
        envioecomStatusHistory: data.history || item.envioecomStatusHistory,
      } : item));
    } catch {
      toast.error("Não foi possível atualizar o rastreio agora.");
    } finally {
      setRefreshingTrackingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:py-10">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white border border-border rounded-3xl p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Minha conta</h1>
              <p className="text-sm text-muted-foreground mt-1">{profileName ? `Olá, ${profileName}` : "Área da sua conta"}</p>
            </div>
            <Button variant="outline" className="rounded-xl" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              Sair
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
            <aside className="border border-border rounded-2xl p-3 h-fit bg-slate-50/60">
              <p className="text-xs uppercase tracking-wide text-muted-foreground px-2 pb-2">Menu da conta</p>
              <div className="flex lg:flex-col gap-2 overflow-auto pb-1 lg:pb-0">
                <button
                  type="button"
                  onClick={() => setActiveSection("orders")}
                  className={`flex items-center gap-2 min-w-fit lg:min-w-0 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${activeSection === "orders" ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}
                >
                  <Package className="w-4 h-4" />
                  Meus pedidos
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection("affiliate")}
                  className={`flex items-center gap-2 min-w-fit lg:min-w-0 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${activeSection === "affiliate" ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}
                >
                  <Users className="w-4 h-4" />
                  Afiliação
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection("raffle")}
                  className={`flex items-center gap-2 min-w-fit lg:min-w-0 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${activeSection === "raffle" ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}
                >
                  <Ticket className="w-4 h-4" />
                  Rifa
                </button>
              </div>
            </aside>

            <section>
              {activeSection === "orders" && (
                <>
                  <h2 className="font-semibold text-foreground mb-4">Seus pedidos</h2>
                  
                  {/* Summary Cards */}
                  {!loading && orders.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                      <div className="rounded-xl border border-border p-3 bg-slate-50/60">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total de pedidos</p>
                        <p className="text-2xl font-bold text-foreground mt-1">{orders.length}</p>
                      </div>
                      <div className="rounded-xl border border-border p-3 bg-slate-50/60">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Valor total</p>
                        <p className="text-2xl font-bold text-foreground mt-1">
                          {formatCurrency(orders.reduce((sum, o) => sum + Number(o.total), 0))}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border p-3 bg-slate-50/60">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Entregues</p>
                        <p className="text-2xl font-bold text-green-600 mt-1">
                          {orders.filter((o) => o.status === "completed" || o.enviado).length}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border p-3 bg-slate-50/60">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Pendentes</p>
                        <p className="text-2xl font-bold text-yellow-600 mt-1">
                          {orders.filter((o) => o.status === "pending" || o.status === "awaiting_payment").length}
                        </p>
                      </div>
                    </div>
                  )}
                  {loading ? (
                    <div className="py-14 flex items-center justify-center text-muted-foreground border border-border rounded-2xl">
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      Carregando pedidos...
                    </div>
                  ) : orders.length === 0 ? (
                    <div className="py-14 text-center border border-dashed border-border rounded-2xl">
                      <Package className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                      <p className="font-semibold text-foreground">Você ainda não tem pedidos vinculados à sua conta.</p>
                      <p className="text-sm text-muted-foreground mt-1">Faça sua compra e acompanhe tudo por aqui.</p>
                      <Link href="/" className="inline-block mt-4 text-sm font-semibold text-primary hover:underline">
                        Ir para a loja
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {orders.map((order) => {
                        const displayStatus = order.enviado ? "enviado" : order.status;
                        const displaySituation = getCustomerSituation(order, displayStatus);
                        const packingHint = customerShippingHint(order.envioecomStatus);
                        const displayOrderId = getOrderDisplayId(order);

                        return (
                        <div key={order.id} className="border border-border rounded-2xl p-5 bg-white hover:shadow-md transition-shadow">
                          {/* Header: ID, Status Badge, Data */}
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                            <div className="flex items-start gap-3">
                              <div className={`mt-0.5 p-2.5 rounded-xl ${displayStatus === "completed" || displayStatus === "paid" ? "bg-green-100" : displayStatus === "enviado" ? "bg-blue-100" : displayStatus === "cancelled" ? "bg-red-100" : "bg-yellow-100"}`}>
                                {getStatusIcon(displayStatus)}
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Pedido ID</p>
                                <p className="text-lg font-bold text-foreground">#{displayOrderId}</p>
                              </div>
                            </div>
                            <div className="flex flex-col sm:items-end gap-2">
                              <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap ${getStatusColor(displayStatus)}`}>
                                {getStatusIcon(displayStatus)}
                                {statusLabel[displayStatus] || displayStatus}
                              </span>
                              <p className="text-xs text-muted-foreground">{formatDateBR(order.createdAt)}</p>
                            </div>
                          </div>

                          {/* Details: Total, Payment, Status */}
                          <div className="grid grid-cols-3 gap-3 mb-4 pb-4 border-t border-border/50 pt-4">
                            <div>
                              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Valor Total</p>
                              <p className="text-xl font-bold text-foreground mt-1">{formatCurrency(Number(order.total || 0))}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Pagamento</p>
                              <p className="text-sm font-semibold text-foreground mt-1 capitalize">
                                {order.paymentMethod === "card_simulation" ? "Cartão" : "PIX"}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Situação</p>
                              <p className="text-sm font-semibold text-foreground mt-1">
                                {displaySituation}
                              </p>
                            </div>
                          </div>

                          {hasEnvioEcomTracking(order) && (
                            <div className="mb-4 pb-4 border-t border-border/50 pt-4">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Rastreio</p>
                                {(order.envioecomBarcode || order.trackingCode) && (
                                  <p className="text-xs font-mono text-muted-foreground">{order.envioecomBarcode || order.trackingCode}</p>
                                )}
                              </div>
                              {order.envioecomDeliveryMode && (
                                <p className="text-xs text-muted-foreground mt-1">{order.envioecomDeliveryMode}</p>
                              )}
                              {(order.envioecomStatusHistory || []).length > 0 ? (
                                <TrackingTimeline events={order.envioecomStatusHistory || []} />
                              ) : (
                                <p className="text-sm font-semibold text-foreground mt-2">{displaySituation}</p>
                              )}
                              {packingHint && (
                                <p className="text-xs text-muted-foreground mt-1">{packingHint}</p>
                              )}
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border/50">
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-lg text-xs"
                              onClick={() => {
                                const phone = getActiveWhatsApp();
                                window.open(
                                  `https://wa.me/${phone}?text=${encodeURIComponent(`Olá! Gostaria de informações sobre o pedido #${displayOrderId}`)}`,
                                  "_blank",
                                  "noopener,noreferrer"
                                );
                              }}
                            >
                              <MessageCircle className="w-3.5 h-3.5 mr-1.5" />
                              Suporte
                            </Button>
                            {(order.enviado || order.status === "completed" || hasEnvioEcomTracking(order) || order.trackingCode) && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-lg text-xs"
                                onClick={() => void handleRefreshTracking(order)}
                                disabled={refreshingTrackingId === order.id}
                              >
                                {refreshingTrackingId === order.id ? (
                                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                ) : (
                                  <Truck className="w-3.5 h-3.5 mr-1.5" />
                                )}
                                Atualizar rastreio
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-lg text-xs ml-auto"
                              onClick={() => handleExpandOrder(order.id)}
                              disabled={loadingDetails === order.id}
                            >
                              {loadingDetails === order.id ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                  Carregando...
                                </>
                              ) : (
                                <>
                                  {expandedOrderId === order.id ? "Ocultar" : "Ver"} detalhes
                                </>
                              )}
                            </Button>
                          </div>

                          {/* Expanded Details */}
                          {expandedOrderId === order.id && (
                            <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
                              {/* Products */}
                              {order.products && order.products.length > 0 && (
                                <div>
                                  <p className="text-sm font-semibold text-foreground mb-3">Produtos do Pedido</p>
                                  <div className="space-y-2 max-h-60 overflow-y-auto">
                                    {order.products.map((product, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30"
                                      >
                                        <div className="flex-1 min-w-0">
                                          <p className="font-medium text-foreground text-sm truncate">
                                            {product.quantity}x {product.name}
                                          </p>
                                        </div>
                                        <p className="font-semibold text-foreground ml-3">
                                          {formatCurrency(product.price * product.quantity)}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {(order.envioecomStatus || order.envioecomBarcode || order.trackingCode) && (
                                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                                  <p className="text-sm font-semibold text-emerald-900 mb-1">Envio / Rastreio</p>
                                  <p className="text-sm font-semibold text-emerald-900">
                                    {toCustomerFriendlyShippingLabel(order.envioecomStatus) || "Em preparação"}
                                  </p>
                                  {packingHint && <p className="text-xs text-emerald-800 mt-1">{packingHint}</p>}
                                  {order.envioecomDeliveryMode && <p className="text-xs text-emerald-800">{order.envioecomDeliveryMode}</p>}
                                  {(order.envioecomBarcode || order.trackingCode) && (
                                    <p className="text-xs font-mono text-emerald-800 mt-1">{order.envioecomBarcode || order.trackingCode}</p>
                                  )}
                                </div>
                              )}

                              {/* Breakdown */}
                              {(order.subtotal || order.shippingCost || order.insuranceAmount) && (
                                <div className="space-y-2 p-3 rounded-lg bg-slate-50/60 border border-border/30">
                                  <p className="text-sm font-semibold text-foreground mb-2">Resumo Financeiro</p>
                                  {order.subtotal && (
                                    <div className="flex justify-between text-sm">
                                      <span className="text-muted-foreground">Subtotal:</span>
                                      <span className="font-medium">{formatCurrency(order.subtotal)}</span>
                                    </div>
                                  )}
                                  {order.shippingCost && (
                                    <div className="flex justify-between text-sm">
                                      <span className="text-muted-foreground">
                                        Frete ({order.shippingType === "express" ? "Expresso" : "Normal"}):
                                      </span>
                                      <span className="font-medium">{formatCurrency(order.shippingCost)}</span>
                                    </div>
                                  )}
                                  {order.insuranceAmount && order.insuranceAmount > 0 && (
                                    <div className="flex justify-between text-sm">
                                      <span className="text-muted-foreground">Seguro:</span>
                                      <span className="font-medium">{formatCurrency(order.insuranceAmount)}</span>
                                    </div>
                                  )}
                                  <div className="flex justify-between text-sm font-semibold pt-2 border-t border-border/30">
                                    <span>Total:</span>
                                    <span className="text-primary">{formatCurrency(Number(order.total))}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                      })}
                    </div>
                  )}
                </>
              )}

              {activeSection === "affiliate" && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border p-5 bg-slate-50/60">
                    <h2 className="text-lg font-semibold text-foreground">Programa de indicações</h2>
                  </div>

                  {affiliateLoading ? (
                    <div className="py-12 flex items-center justify-center text-muted-foreground border border-border rounded-2xl bg-white">
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      Carregando dados da afiliação...
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                        <div className="rounded-2xl border border-border p-4 bg-white">
                          <p className="text-sm text-muted-foreground">Comissões liberadas</p>
                          <p className="text-3xl font-bold mt-1">{formatCurrency(affiliateSummary.commissionsReleased)}</p>
                        </div>
                        <div className="rounded-2xl border border-border p-4 bg-white">
                          <p className="text-sm text-muted-foreground">Comissões pendentes</p>
                          <p className="text-3xl font-bold mt-1">{formatCurrency(affiliateSummary.commissionsPending)}</p>
                        </div>
                        <div className="rounded-2xl border border-border p-4 bg-white">
                          <p className="text-sm text-muted-foreground">Indicações ativas</p>
                          <p className="text-3xl font-bold mt-1">{affiliateSummary.referralsActive}</p>
                        </div>
                        <div className="rounded-2xl border border-border p-4 bg-white">
                          <p className="text-sm text-muted-foreground">Indicações inativas</p>
                          <p className="text-3xl font-bold mt-1">{affiliateSummary.referralsInactive}</p>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-border p-5 bg-white space-y-3">
                        <h3 className="text-xl font-semibold">Link de divulgação</h3>
                        <p className="text-sm text-muted-foreground">Ganhe 1% de comissão nas compras aprovadas de produtos da loja.</p>
                        <div className="flex flex-col sm:flex-row gap-3">
                          <input
                            readOnly
                            value={affiliateData?.affiliate?.referralLink || ""}
                            className="flex-1 h-11 rounded-xl border border-input bg-muted px-3 text-sm"
                          />
                          <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={handleCopyReferralLink}>
                            <Copy className="w-4 h-4 mr-2" />
                            Copiar
                          </Button>
                        </div>
                        {affiliateData?.affiliate?.code && (
                          <p className="text-xs text-muted-foreground">Código de afiliado: <strong>{affiliateData.affiliate.code}</strong></p>
                        )}
                      </div>

                      <div className="rounded-2xl border border-border p-5 bg-white space-y-3">
                        <h3 className="text-xl font-semibold">Pixel do Facebook</h3>
                        <p className="text-sm text-muted-foreground">Adicione seu Pixel para rastrear as conversões geradas pelas suas indicações.</p>
                        <input
                          value={pixelIdInput}
                          onChange={(e) => setPixelIdInput(e.target.value)}
                          placeholder="Ex.: 123456789012345"
                          className="w-full h-11 rounded-xl border border-input bg-white px-3 text-sm"
                        />
                      </div>

                      <div className="flex justify-end">
                        <Button type="button" className="rounded-xl" onClick={handleSavePixel} disabled={isSavingPixel}>
                          {isSavingPixel ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                          Salvar alterações
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeSection === "raffle" && (
                <div className="border border-dashed border-border rounded-2xl p-8 text-center">
                  <Gift className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                  <h2 className="text-lg font-semibold text-foreground">Rifa</h2>
                  <p className="text-sm text-muted-foreground mt-2">Em breve esta aba vai mostrar seus números, sorteios e resultados.</p>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
