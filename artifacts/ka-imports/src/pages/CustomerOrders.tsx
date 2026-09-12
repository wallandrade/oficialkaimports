import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { clearCustomerToken, fetchCustomerProfile, getCustomerAuthHeaders } from "@/lib/customer-auth";
import { formatCurrency, formatDateBR, getActiveWhatsApp } from "@/lib/utils";
import {
  collapseCustomerPackagesForOrder,
  formatCustomerPackageItems,
  getCustomerPackageSituation,
  getCustomerPartialHint,
  getCustomerSplitBadgeStatus,
  getCustomerSplitSituation,
  isCustomerOrderDelivered,
  isCustomerSplitOrder,
  type CustomerPackageKind,
} from "@/lib/customer-split-shipping";
import { ShippingStatusTimeline } from "@/components/ShippingStatusTimeline";
import { Copy, DollarSign, Gift, Loader2, LogOut, Package, Save, Ticket, Users, CheckCircle2, Clock, AlertCircle, MessageCircle, Truck, Wallet, X } from "lucide-react";
import { toast } from "sonner";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type TrackingEvent = {
  at?: string;
  status?: string;
  location?: string | null;
  description?: string | null;
};

type CustomerPackage = {
  id: string;
  inventoryPool?: string;
  enviado?: boolean;
  inventoryReserved?: boolean;
  envioecomShipmentId?: number | null;
  envioecomStatus?: string | null;
  envioecomBarcode?: string | null;
  envioecomDeliveryMode?: string | null;
  envioecomStatusHistory?: TrackingEvent[];
  items?: Array<{ productName?: string; name?: string; quantity?: number }>;
};

type CustomerOrder = {
  id: string;
  orderNumber?: number | null;
  parentOrderId?: string | null;
  parentOrderNumber?: number | null;
  total: number;
  status: string;
  enviado?: boolean;
  paymentMethod: string;
  createdAt: string;
  clientName?: string;
  clientPhone?: string;
  products?: Array<{ name: string; quantity: number; price: number; image?: string | null }>;
  subtotal?: number;
  shippingCost?: number;
  insuranceAmount?: number;
  shippingType?: string;
  motoboyDeliveryDate?: string | null;
  motoboyDeliveryTime?: string | null;
  motoboyDeliveryDurationHours?: number | null;
  trackingCode?: string | null;
  envioecomShipmentId?: number | null;
  envioecomStatus?: string | null;
  envioecomDeliveryMode?: string | null;
  envioecomBarcode?: string | null;
  envioecomStatusHistory?: TrackingEvent[];
  envioecomStatusUpdatedAt?: string | null;
  observation?: string | null;
  packages?: CustomerPackage[];
};

type AccountSection = "orders" | "affiliate" | "raffle" | "wallet";

type WalletEntry = {
  id: string;
  orderId: string | null;
  type: string;
  amount: number;
  note: string | null;
  createdAt: string;
};

function walletTypeLabel(type: string): string {
  switch (type) {
    case "insurance_cashback":
      return "Cashback do seguro";
    case "product_refund":
      return "Estorno do produto";
    case "store_credit_use":
      return "Usado no pedido";
    case "admin_adjust":
      return "Ajuste da loja";
    default:
      return type;
  }
}

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

function isMotoboyShippingType(value: unknown): boolean {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .includes("motoboy");
}

function shippingTypeLabel(order: CustomerOrder): string {
  if (isMotoboyShippingType(order.shippingType)) return "Motoboy";
  if (order.shippingType === "express") return "Expresso";
  return order.shippingType || "Normal";
}

function formatMotoboyDate(value?: string | null): string {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return raw;
}

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
  enviado_parcial: "Enviado parcialmente",
  pending: "Pendente",
  awaiting_payment: "Aguardando pagamento",
  paid: "Pago",
  completed: "Concluído",
  cancelled: "Cancelado",
};

function getStatusIcon(status: string) {
  switch (status) {
    case "enviado":
      return <Truck className="w-5 h-5" />;
    case "enviado_parcial":
      return <Package className="w-5 h-5" />;
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

function packageKindClass(kind: CustomerPackageKind): string {
  switch (kind) {
    case "delivered":
      return "border-green-200 bg-green-50/70";
    case "shipped":
      return "border-blue-200 bg-blue-50/70";
    case "packing":
      return "border-emerald-200 bg-emerald-50/70";
    default:
      return "border-amber-200 bg-amber-50/70";
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

function trackingHistoryMissingLocation(history?: TrackingEvent[] | null): boolean {
  const events = Array.isArray(history) ? history : [];
  if (!events.length) return true;
  return events.some((event) => !String(event.location || "").trim());
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
    "aguardando coleta",
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
  const packages = Array.isArray(order.packages) ? order.packages : [];
  if (packages.length >= 2) {
    return getCustomerSplitSituation(packages, order.enviado);
  }
  if (order.envioecomStatus) {
    return toCustomerFriendlyShippingLabel(order.envioecomStatus);
  }
  if (displayStatus === "completed") return "Entregue";
  if (displayStatus === "enviado") return "Enviado";
  if (displayStatus === "paid") return "Processando";
  return statusLabel[displayStatus] || displayStatus;
}

function hasEnvioEcomTracking(order: CustomerOrder): boolean {
  const packages = Array.isArray(order.packages) ? order.packages : [];
  if (packages.some((pkg) => pkg.envioecomShipmentId || pkg.envioecomBarcode || pkg.envioecomStatus)) return true;
  return !!(order.envioecomShipmentId || order.envioecomBarcode || order.envioecomStatus);
}

function hashObservation(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return String(hash);
}

function observationReadKey(orderId: string, text: string): string {
  return `kaCustomerObsRead:${orderId}:${hashObservation(text)}`;
}

function isObservationRead(orderId: string, text: string): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(observationReadKey(orderId, text)) === "1";
}

function markObservationRead(orderId: string, text: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(observationReadKey(orderId, text), "1");
}

function situationBadgeClass(displayStatus: string, situation: string): string {
  const normalized = situation.toLowerCase();
  if (displayStatus === "cancelled" || normalized.includes("cancelad")) {
    return "bg-red-100 text-red-800 border border-red-300";
  }
  if (displayStatus === "enviado_parcial" || normalized.includes("parcial")) {
    return "bg-orange-100 text-orange-800 border border-orange-300";
  }
  if (normalized.includes("entregue") || displayStatus === "completed") {
    return "bg-green-100 text-green-800 border border-green-300";
  }
  if (normalized.includes("embalando") || normalized.includes("aguardando envio") || normalized.includes("preparação")) {
    return "bg-emerald-100 text-emerald-800 border border-emerald-300";
  }
  if (displayStatus === "pending" || displayStatus === "awaiting_payment" || normalized.includes("pendente") || normalized.includes("aguardando pagamento")) {
    return "bg-yellow-100 text-yellow-800 border border-yellow-300";
  }
  return "bg-blue-100 text-blue-800 border border-blue-300";
}

export default function CustomerOrders() {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState("");
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [activeSection, setActiveSection] = useState<AccountSection>("orders");
  const [affiliateLoading, setAffiliateLoading] = useState(true);
  const [affiliateData, setAffiliateData] = useState<AffiliateDashboardResponse | null>(null);
  const [walletAvailable, setWalletAvailable] = useState(0);
  const [walletEntries, setWalletEntries] = useState<WalletEntry[]>([]);
  const [pixelIdInput, setPixelIdInput] = useState("");
  const [isSavingPixel, setIsSavingPixel] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [loadingDetails, setLoadingDetails] = useState<string | null>(null);
  const [refreshingTrackingId, setRefreshingTrackingId] = useState<string | null>(null);
  const [unreadObservationIds, setUnreadObservationIds] = useState<string[]>([]);

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
        const [ordersRes, affiliateRes, walletRes] = await Promise.all([
          fetch(`${BASE}/api/me/orders`, {
            headers: getCustomerAuthHeaders(),
          }),
          fetch(`${BASE}/api/me/affiliate/dashboard`, {
            headers: getCustomerAuthHeaders(),
          }),
          fetch(`${BASE}/api/me/wallet`, {
            headers: getCustomerAuthHeaders(),
          }),
        ]);

        if (ordersRes.status === 401 || affiliateRes.status === 401 || walletRes.status === 401) {
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

        const walletPayload = walletRes.ok
          ? ((await walletRes.json()) as { availableCredit?: number; entries?: WalletEntry[] })
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
        const unread = (ordersData.orders || []).filter((order) => {
          const text = String(order.observation || "").trim();
          return Boolean(text) && !isObservationRead(order.id, text);
        });
        setUnreadObservationIds(unread.map((order) => order.id));
        if (unread.length > 0) {
          toast.info(unread.length === 1
            ? "A loja deixou um recado no seu pedido."
            : `A loja deixou recados em ${unread.length} pedidos.`);
        }
        setWalletAvailable(Number(walletPayload?.availableCredit || 0));
        setWalletEntries(Array.isArray(walletPayload?.entries) ? walletPayload.entries : []);
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
      .filter((order) => {
        if (!hasEnvioEcomTracking(order)) return false;
        const packages = Array.isArray(order.packages) ? order.packages : [];
        if (isCustomerSplitOrder(packages, order.enviado)) {
          return packages.some((pkg) => (
            isOpenEnvioEcomTracking(pkg.envioecomStatus)
            || trackingHistoryMissingLocation(pkg.envioecomStatusHistory)
          ));
        }
        return isOpenEnvioEcomTracking(order.envioecomStatus)
          || trackingHistoryMissingLocation(order.envioecomStatusHistory);
      })
      .map((order) => order.id)
      .sort()
      .join(","),
    [orders],
  );

  useEffect(() => {
    if (loading || !openTrackingKey || activeSection !== "orders") return;
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
            packages?: CustomerPackage[];
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
            packages: next.packages || item.packages,
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
  }, [loading, openTrackingKey, activeSection]);

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
    if (existingOrder?.observation) {
      markObservationRead(orderId, existingOrder.observation);
      setUnreadObservationIds((prev) => prev.filter((id) => id !== orderId));
    }
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
        packages?: CustomerPackage[];
      };
      setOrders((prev) => prev.map((item) => item.id === order.id ? {
        ...item,
        envioecomStatus: data.envioecomStatus || item.envioecomStatus,
        envioecomDeliveryMode: data.deliveryMode || item.envioecomDeliveryMode,
        envioecomBarcode: data.barcode || item.envioecomBarcode,
        trackingCode: data.barcode || item.trackingCode,
        envioecomStatusHistory: data.history || item.envioecomStatusHistory,
        packages: data.packages || item.packages,
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
              <p className="text-sm font-semibold text-emerald-700 mt-1">Saldo da loja: {formatCurrency(walletAvailable)}</p>
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
                  {unreadObservationIds.length > 0 && (
                    <span className="ml-auto inline-flex min-w-5 h-5 px-1.5 items-center justify-center rounded-full bg-sky-600 text-[11px] font-bold text-white">
                      {unreadObservationIds.length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection("wallet")}
                  className={`flex items-center gap-2 min-w-fit lg:min-w-0 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${activeSection === "wallet" ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}
                >
                  <Wallet className="w-4 h-4" />
                  Saldo do seguro
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
                  {!loading && (
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
                          {orders.filter((o) => isCustomerOrderDelivered(o)).length}
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
                        const rawPackages = Array.isArray(order.packages) ? order.packages : [];
                        const hasReshipmentChild = orders.some((item) => item.parentOrderId === order.id);
                        const hideParentTracking = Boolean(order.enviado && hasReshipmentChild);
                        const visiblePackages = collapseCustomerPackagesForOrder(rawPackages, order.enviado);
                        const isSplit = !hideParentTracking && isCustomerSplitOrder(rawPackages, order.enviado);
                        const displayStatus = hideParentTracking
                          ? "enviado"
                          : isSplit
                            ? getCustomerSplitBadgeStatus(rawPackages, order.status, order.enviado)
                            : (order.enviado ? "enviado" : order.status);
                        const displaySituation = hideParentTracking
                          ? "Enviado"
                          : getCustomerSituation(order, displayStatus);
                        const packingHint = customerShippingHint(order.envioecomStatus);
                        const partialHint = isSplit ? getCustomerPartialHint(rawPackages, order.enviado) : null;
                        const displayOrderId = getOrderDisplayId(order);
                        const parentNumber = Number(order.parentOrderNumber);
                        const reshipmentLabel = order.parentOrderId
                          ? (Number.isFinite(parentNumber) && parentNumber > 0
                            ? `Reenvio do pedido #${Math.trunc(parentNumber)}`
                            : "Reenvio")
                          : null;
                        const observationUnread = Boolean(order.observation) && unreadObservationIds.includes(order.id);
                        const thumbs = (order.products || []).map((product) => String(product.image || "").trim()).filter(Boolean).slice(0, 4);
                        const showTracking = !hideParentTracking && (isSplit || hasEnvioEcomTracking(order));
                        const collapsedPkg = !isSplit && visiblePackages.length === 1 && rawPackages.length >= 2
                          ? visiblePackages[0]
                          : null;

                        return (
                        <div key={order.id} className="border border-border rounded-2xl p-5 bg-white hover:shadow-md transition-shadow">
                          {/* Header: ID, Status Badge, Data */}
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                            <div className="flex items-start gap-3">
                              <div className={`mt-0.5 p-2.5 rounded-xl ${displayStatus === "completed" || displayStatus === "paid" ? "bg-green-100" : displayStatus === "enviado" ? "bg-blue-100" : displayStatus === "enviado_parcial" ? "bg-orange-100" : displayStatus === "cancelled" ? "bg-red-100" : "bg-yellow-100"}`}>
                                {getStatusIcon(displayStatus)}
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Pedido</p>
                                <p className="text-lg font-bold text-foreground">#{displayOrderId}</p>
                                {reshipmentLabel && (
                                  <span className="inline-flex mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-violet-100 text-violet-800">
                                    {reshipmentLabel}
                                  </span>
                                )}
                                {observationUnread && (
                                  <span className="inline-flex mt-1 ml-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-100 text-sky-800">
                                    Nova mensagem
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-col sm:items-end gap-2">
                              <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap ${situationBadgeClass(displayStatus, displaySituation)}`}>
                                {getStatusIcon(displayStatus)}
                                {displaySituation}
                              </span>
                              <p className="text-xs text-muted-foreground">{formatDateBR(order.createdAt)}</p>
                            </div>
                          </div>

                          {thumbs.length > 0 && (
                            <div className="flex items-center gap-2 mb-4">
                              {thumbs.map((src) => (
                                <img key={src} src={src} alt="" className="h-12 w-12 rounded-xl object-cover border border-border" />
                              ))}
                              {(order.products || []).length > thumbs.length && (
                                <span className="text-xs text-muted-foreground">+{(order.products || []).length - thumbs.length}</span>
                              )}
                            </div>
                          )}

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

                          {partialHint && (
                            <p className="text-sm text-orange-800 bg-orange-50 border border-orange-100 rounded-xl px-3 py-2 mb-4">{partialHint}</p>
                          )}

                          {isSplit ? (
                            <div className="mb-4 pb-4 border-t border-border/50 pt-4 space-y-3">
                              <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Envio / Rastreio</p>
                              {visiblePackages.map((pkg, index) => {
                                const situation = getCustomerPackageSituation(pkg);
                                const itemLines = formatCustomerPackageItems(pkg);
                                const showCode = situation.kind !== "waiting" && pkg.envioecomBarcode;
                                const showTimeline = situation.kind !== "waiting" && (pkg.envioecomStatusHistory || []).length > 0;
                                return (
                                  <div key={pkg.id} className={`rounded-xl border p-3 ${packageKindClass(situation.kind)}`}>
                                    <div className="flex items-start justify-between gap-2">
                                      <p className="text-sm font-semibold text-foreground">Envio {index + 1}</p>
                                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${situation.kind === "shipped" || situation.kind === "delivered" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}`}>
                                        {situation.label}
                                      </span>
                                    </div>
                                    {itemLines.length > 0 && (
                                      <ul className="mt-2 space-y-0.5">
                                        {itemLines.map((line) => (
                                          <li key={line} className="text-sm text-foreground/90">{line}</li>
                                        ))}
                                      </ul>
                                    )}
                                    {showCode && (
                                      <p className="text-xs font-mono text-muted-foreground mt-2">{pkg.envioecomBarcode}</p>
                                    )}
                                    {situation.kind !== "waiting" && pkg.envioecomDeliveryMode && (
                                      <p className="text-xs text-muted-foreground mt-1">{pkg.envioecomDeliveryMode}</p>
                                    )}
                                    {showTimeline ? (
                                      <ShippingStatusTimeline
                                        events={pkg.envioecomStatusHistory || []}
                                        className="mt-3 max-h-72 overflow-y-auto"
                                      />
                                    ) : situation.hint ? (
                                      <p className="text-xs text-muted-foreground mt-2">{situation.hint}</p>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          ) : showTracking && (
                            <div className="mb-4 pb-4 border-t border-border/50 pt-4">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Rastreio</p>
                                {(collapsedPkg?.envioecomBarcode || order.envioecomBarcode || order.trackingCode) && (
                                  <p className="text-xs font-mono text-muted-foreground">{collapsedPkg?.envioecomBarcode || order.envioecomBarcode || order.trackingCode}</p>
                                )}
                              </div>
                              {(collapsedPkg?.envioecomDeliveryMode || order.envioecomDeliveryMode) && (
                                <p className="text-xs text-muted-foreground mt-1">{collapsedPkg?.envioecomDeliveryMode || order.envioecomDeliveryMode}</p>
                              )}
                              {((collapsedPkg?.envioecomStatusHistory || order.envioecomStatusHistory || []).length > 0) ? (
                                <ShippingStatusTimeline
                                  events={collapsedPkg?.envioecomStatusHistory || order.envioecomStatusHistory || []}
                                  className="mt-3 max-h-72 overflow-y-auto"
                                />
                              ) : (
                                <p className="text-sm font-semibold text-foreground mt-2">{displaySituation}</p>
                              )}
                              {packingHint && !collapsedPkg && (
                                <p className="text-xs text-muted-foreground mt-1">{packingHint}</p>
                              )}
                            </div>
                          )}

                          {order.observation && (
                            <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-3">
                              <p className="text-xs uppercase tracking-wide font-semibold text-sky-800">Recado da loja</p>
                              <p className="text-sm text-sky-950 whitespace-pre-wrap mt-1">{order.observation}</p>
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
                            {(order.enviado || order.status === "completed" || hasEnvioEcomTracking(order) || order.trackingCode) && !hideParentTracking && (
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
                              {isSplit ? (
                                <div className="space-y-3">
                                  <p className="text-sm font-semibold text-foreground">Produtos por envio</p>
                                  {visiblePackages.map((pkg, index) => (
                                    <div key={pkg.id} className="p-3 rounded-lg bg-muted/30 border border-border/30">
                                      <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">Envio {index + 1}</p>
                                      <ul className="space-y-1">
                                        {formatCustomerPackageItems(pkg).map((line) => (
                                          <li key={line} className="text-sm font-medium text-foreground">{line}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ))}
                                </div>
                              ) : order.products && order.products.length > 0 && (
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

                              {isMotoboyShippingType(order.shippingType) && order.motoboyDeliveryDate && (
                                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                                  <p className="text-sm font-semibold text-emerald-900 mb-1">Entrega por motoboy</p>
                                  <p className="text-sm text-emerald-800">
                                    {formatMotoboyDate(order.motoboyDeliveryDate)} às {order.motoboyDeliveryTime || "-"}
                                    {order.motoboyDeliveryDurationHours ? ` · intervalo de ${order.motoboyDeliveryDurationHours}h` : ""}
                                  </p>
                                </div>
                              )}

                              {!isSplit && !hideParentTracking && (order.envioecomStatus || order.envioecomBarcode || order.trackingCode) && (
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
                                        Frete ({shippingTypeLabel(order)}):
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

              {activeSection === "wallet" && (
                <div>
                  <h2 className="font-semibold text-foreground mb-4">Saldo do seguro</h2>
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 mb-4">
                    <p className="text-xs uppercase tracking-wide text-emerald-800 font-medium">Disponível para a próxima compra</p>
                    <p className="text-3xl font-bold text-emerald-800 mt-1">{formatCurrency(walletAvailable)}</p>
                    <p className="text-sm text-emerald-900/80 mt-2">
                      Entra o cashback do seguro completo na entrega. No checkout, com a conta logada, dá para abater o pedido.
                    </p>
                    <Link href="/checkout" className="inline-block mt-3 text-sm font-semibold text-primary hover:underline">
                      Ir para o checkout
                    </Link>
                  </div>
                  {walletEntries.length === 0 ? (
                    <div className="py-10 text-center border border-dashed border-border rounded-2xl">
                      <Wallet className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                      <p className="font-semibold text-foreground">Nenhum movimento ainda</p>
                      <p className="text-sm text-muted-foreground mt-1">Quando o pedido com seguro completo for entregue, o saldo aparece aqui.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {walletEntries.map((entry) => (
                        <div key={entry.id} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-white p-4">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">{walletTypeLabel(entry.type)}</p>
                            {entry.note && <p className="text-xs text-muted-foreground mt-0.5">{entry.note}</p>}
                            <p className="text-xs text-muted-foreground mt-1">{formatDateBR(entry.createdAt)}</p>
                          </div>
                          <p className={`text-sm font-bold shrink-0 ${entry.amount >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {entry.amount >= 0 ? "+" : ""}{formatCurrency(entry.amount)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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
