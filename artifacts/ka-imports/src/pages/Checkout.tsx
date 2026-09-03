import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ShieldCheck, Truck, CreditCard, QrCode, ArrowLeft,
  MessageCircle, AlertTriangle, MapPin, Loader2, Tag, X, CheckCircle2, Zap, Minus, Plus, ExternalLink, Camera, IdCard, FileText, Clock, Bike, CalendarDays
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { CheckoutLayout } from "@/components/layout/CheckoutLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLiveTracking } from "@/hooks/useLiveTracking";
import { isProductUnavailable, useCart } from "@/store/use-cart";
import { getStoredReferralCode } from "@/lib/affiliate";
import { getCheckoutSecurityHeaders } from "@/lib/checkout-security";
import { getCustomerAuthHeaders, getCustomerToken } from "@/lib/customer-auth";
import { formatCurrency, getActiveWhatsApp } from "@/lib/utils";
import {
  insuranceLinesFromProducts,
  parseInsuranceSettingsFromMap,
  resolveCheckoutInsurance,
  type CheckoutInsuranceSettings,
  type InsurancePlan,
} from "@/lib/checkout-insurance";
import { CheckoutInsuranceOffer } from "@/components/checkout/CheckoutInsuranceOffer";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const LANDER_GOLD_MIN_QTY = 5;

function isLanderGoldCategory(value: string): boolean {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return normalized.includes("lander gold") || normalized.includes("landerlan gold");
}

interface ShippingOption {
  id: string; name: string; description: string | null; price: number;
  sortOrder: number; isActive: boolean;
  motoboyAreaId?: string;
  motoboyAreaType?: "neighborhood" | "cepRange";
}

function genId() {
  return Math.random().toString(36).slice(2, 12);
}

function safeReadStorage(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function formatCPF(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatPhone(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function formatCheckoutOrderNumber(order: { id: string; orderNumber?: number | null }): string {
  const numeric = Number(order.orderNumber);
  if (Number.isFinite(numeric) && numeric > 0) return String(Math.trunc(numeric));
  return order.id;
}

function pluralizeUnit(unit: string, qty: number): string {
  if (qty <= 1) return unit;
  const map: Record<string, string> = {
    unidade: "unidades", caixa: "caixas", frasco: "frascos",
    ampola: "ampolas", caneta: "canetas", par: "pares", kit: "kits",
  };
  return map[unit] ?? unit + "s";
}

function normalizeSelectedVariants(raw: unknown): Array<{ groupName: string; option: string }> {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      const value = item as Record<string, unknown>;
      const groupName = String(value.groupName ?? "").trim();
      const option = String(value.option ?? "").trim();
      if (!groupName || !option) return null;
      return { groupName, option };
    })
    .filter((item): item is { groupName: string; option: string } => Boolean(item));
}

function resolveVariantLabel(item: Record<string, unknown>): string {
  const explicit = String(item.variantLabel ?? "").trim();
  if (explicit) return explicit;
  const selected = normalizeSelectedVariants(item.selectedVariants);
  return selected.map((variant) => `${variant.groupName}: ${variant.option}`).join(" / ");
}

function formatCEP(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

function isSunday(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0;
}

function getSaoPauloNowParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    hour: Number(value.hour),
  };
}

function addDaysYmd(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function getMotoboyCalendarMinDate() {
  const now = getSaoPauloNowParts();
  return now.hour >= 18 ? addDaysYmd(now.date, 1) : now.date;
}

function parseMotoboyEligibleProductIds(raw: unknown): string[] {
  if (raw == null || raw === "") return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "[]") return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return Array.from(new Set(parsed.map((id) => String(id || "").trim()).filter(Boolean)));
}

const checkoutSchema = z.object({
  name: z.string().min(3, "Nome completo é obrigatório"),
  email: z.string().email("E-mail inválido"),
  phone: z.string().min(14, "Telefone inválido (com DDD)"),
  document: z.string().min(14, "CPF inválido (ex: 000.000.000-00)"),
  cep: z.string().min(9, "CEP inválido"),
  street: z.string().min(3, "Rua é obrigatória"),
  number: z.string().min(1, "Número é obrigatório"),
  complement: z.string().optional(),
  neighborhood: z.string().min(2, "Bairro é obrigatório"),
  city: z.string().min(2, "Cidade é obrigatória"),
  state: z.string().min(2, "Estado é obrigatório"),
});

type CheckoutFormData = z.infer<typeof checkoutSchema>;
type RetryAction = "pix" | "whatsapp" | "card";
type LogisticsForecast = {
  availableSlots: number;
  promisedHours: number;
  dispatchDate: string;
  dispatchDeadline: string;
  capacity: number;
};

export default function Checkout() {
  const [, setLocation] = useLocation();
  const { items, getSubtotal, getCardSubtotal, clearCart, addItem, addBumpItem, removeItem, updateQuantity, setIsOpen } = useCart();

  // Garante que o carrinho lateral não abre no checkout
  useEffect(() => { setIsOpen(false); }, [setIsOpen]);

  useLiveTracking("checkout");

  const [pendingCheck, setPendingCheck] = useState(() => !!sessionStorage.getItem("ka_pending_product"));
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
  const [motoboyShippingOption, setMotoboyShippingOption] = useState<ShippingOption | null>(null);
  const [shippingLoading, setShippingLoading] = useState(true);
  const [logisticsForecast, setLogisticsForecast] = useState<LogisticsForecast | null>(null);
  const [selectedShippingId, setSelectedShippingId] = useState<string | null>(null);
  const [motoboyDeliveryDate, setMotoboyDeliveryDate] = useState("");
  const [motoboyDeliveryTime, setMotoboyDeliveryTime] = useState("");
  const [motoboyAvailableSlots, setMotoboyAvailableSlots] = useState<string[]>([]);
  const [motoboyDurationHours, setMotoboyDurationHours] = useState(1);
  const [motoboySlotsLoading, setMotoboySlotsLoading] = useState(false);
  const [insurancePlan, setInsurancePlan] = useState<InsurancePlan>("none");
  const [showCardModal, setShowCardModal] = useState(false);
  const [whatsappModalData, setWhatsappModalData] = useState<{ url: string; displayNumber: string } | null>(null);
  const [isOpeningWhatsApp, setIsOpeningWhatsApp] = useState(false);
  const [cardModalStep, setCardModalStep] = useState<"card_pricing" | "kyc_notice" | "installments" | "kyc_link">("card_pricing");
  const [installments, setInstallments] = useState(1);
  const [kycOrderId, setKycOrderId] = useState("");
  const [kycOrderDisplay, setKycOrderDisplay] = useState("");
  const [kycWhatsAppUrl, setKycWhatsAppUrl] = useState("");
  const [kycVerified, setKycVerified] = useState(false);
  const [cpfDisplay, setCpfDisplay] = useState("");
  const [phoneDisplay, setPhoneDisplay] = useState("");
  const [cepDisplay, setCepDisplay] = useState("");
  const [cepCity, setCepCity] = useState("");
  const [cepLoading, setCepLoading] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string; discountType: string; discountValue: number;
    eligibleProductIds: string[];
  } | null>(null);
  const [affiliateCreditAvailable, setAffiliateCreditAvailable] = useState(0);
  const [affiliateCreditLoading, setAffiliateCreditLoading] = useState(false);
  const [useAffiliateCredit, setUseAffiliateCredit] = useState(false);
  const [storeCreditAvailable, setStoreCreditAvailable] = useState(0);
  const [useStoreCredit, setUseStoreCredit] = useState(false);
  const [insuranceSettings, setInsuranceSettings] = useState<CheckoutInsuranceSettings>(() => parseInsuranceSettingsFromMap({}));
  const [paymentMethods, setPaymentMethods] = useState({ pix: true, card: true, whatsapp: false });
  const [checkoutMode, setCheckoutMode] = useState<"standard" | "fast">("standard");
  const [checkoutModeLoaded, setCheckoutModeLoaded] = useState(false);
  const [fastLookupStatus, setFastLookupStatus] = useState<"idle" | "checking" | "motoboy" | "unsupported">("idle");
  const [fastWhatsappOpening, setFastWhatsappOpening] = useState(false);
  const [freeShippingMinSubtotal, setFreeShippingMinSubtotal] = useState<number | null>(null);
  const [freeShippingMinMotoboy, setFreeShippingMinMotoboy] = useState<number | null>(null);
  const [motoboyEligibleProductIds, setMotoboyEligibleProductIds] = useState<string[]>([]);
  const [pendingCheckoutRetry, setPendingCheckoutRetry] = useState<RetryAction | null>(null);
  const priceSyncRetryCountRef = useRef<Record<RetryAction, number>>({ pix: 0, whatsapp: 0, card: 0 });
  const [productCategoryById, setProductCategoryById] = useState<Map<string, string>>(new Map());
  const [productCatalogById, setProductCatalogById] = useState<Map<string, { id: string; name: string; price: number; promoPrice?: number | null; promoEndsAt?: string | null; image?: string | null; unit?: string; category?: string; description?: string; isActive?: boolean; isSoldOut?: boolean; stock?: number }>>(new Map());

  useEffect(() => {
    if (items.length === 0) {
      setProductCategoryById(new Map());
      setProductCatalogById(new Map());
      return;
    }

    let cancelled = false;
    fetch(`${BASE}/api/products`)
      .then((res) => {
        if (!res.ok) throw new Error("PRODUCTS_FETCH_FAILED");
        return res.json() as Promise<{ products?: Array<{ id: string; category?: string }> }>;
      })
      .then((data) => {
        if (cancelled) return;
        const nextMap = new Map<string, string>();
        const nextCatalog = new Map<string, { id: string; name: string; price: number; promoPrice?: number | null; promoEndsAt?: string | null; image?: string | null; unit?: string; category?: string; description?: string; isActive?: boolean; isSoldOut?: boolean; stock?: number }>();
        for (const product of data.products ?? []) {
          nextMap.set(product.id, String(product.category ?? ""));
          nextCatalog.set(product.id, product);
        }
        setProductCategoryById(nextMap);
        setProductCatalogById(nextCatalog);
      })
      .catch(() => {
        if (!cancelled) {
          setProductCategoryById(new Map());
          setProductCatalogById(new Map());
        }
      });

    return () => {
      cancelled = true;
    };
  }, [items]);

  const validateCartAvailability = useCallback(async () => {
    const nonBumpItems = items.filter((item) => !(item as { isBump?: boolean }).isBump);
    if (nonBumpItems.length === 0) return true;

    try {
      const res = await fetch(`${BASE}/api/products`);
      if (!res.ok) return true;
      const data = await res.json() as { products?: Array<{
        id: string;
        name: string;
        price: number;
        promoPrice?: number | null;
        promoEndsAt?: string | null;
        image?: string | null;
        unit?: string;
        category?: string;
        description?: string;
        isActive?: boolean;
        isSoldOut?: boolean;
        stock?: number;
      }> };

      const byId = new Map((data.products ?? []).map((product) => [product.id, product]));
      const unavailable = nonBumpItems.filter((item) => {
        const product = byId.get(item.id);
        return !product || isProductUnavailable(product as Parameters<typeof isProductUnavailable>[0]);
      });

      if (unavailable.length === 0) return true;

      unavailable.forEach((item) => removeItem(item.id));
      const names = unavailable.map((item) => item.name).slice(0, 3).join(", ");
      toast.error(`Removemos itens indisponiveis do carrinho: ${names}.`);
      return false;
    } catch {
      return true;
    }
  }, [items, removeItem]);

  const syncCartWithLatestProducts = useCallback(async () => {
    const previousItems = [...items];

    try {
      const res = await fetch(`${BASE}/api/products`);
      if (!res.ok) return false;

      const data = await res.json() as { products?: Array<{
        id: string;
        name: string;
        price: number;
        promoPrice?: number | null;
        promoEndsAt?: string | null;
        image?: string | null;
        unit?: string;
        category?: string;
        description?: string;
        isActive?: boolean;
        isSoldOut?: boolean;
        stock?: number;
      }> };

      const byId = new Map((data.products ?? []).map((product) => [product.id, product]));

      clearCart();
      for (const item of previousItems) {
        const isBump = (item as { isBump?: boolean }).isBump === true;
        if (isBump) continue;

        const product = byId.get(item.id);
        if (!product || isProductUnavailable(product as Parameters<typeof isProductUnavailable>[0])) continue;

        addItem(product as Parameters<typeof addItem>[0], { quantity: item.quantity });
      }

      setAppliedCoupon(null);
      return true;
    } catch {
      return false;
    }
  }, [items, clearCart, addItem]);

  // Order bumps for checkout
  interface CheckoutBump {
    id: string; productId: string; offerProductId?: string | null; title: string; cardTitle?: string | null; description?: string | null;
    image?: string | null; discountType: string; discountValue?: number | null;
    buyQuantity?: number | null; getQuantity?: number | null;
    tiers?: Array<{ qty: number; price: number; image?: string }> | null;
    unit?: string | null;
    discountTagType?: string | null;
  }
  const [checkoutBumps, setCheckoutBumps] = useState<CheckoutBump[]>([]);
  useEffect(() => {
    if (items.length === 0) { setCheckoutBumps([]); return; }
    const productIds = new Set(
      items
        .filter((i) => !(i as { isBump?: boolean }).isBump)
        .map((i) => i.id)
    );
    fetch(`${BASE}/api/order-bumps`)
      .then((r) => r.json())
      .then((data: { bumps: CheckoutBump[] }) =>
        setCheckoutBumps((data.bumps || []).filter((b) => productIds.has(b.productId)))
      )
      .catch(() => {});
  }, [items.length]);

  const checkoutOffers = useMemo(() => {
    return checkoutBumps
      .map((bump) => {
        const triggerItem = items.find((item) => item.id === bump.productId);
        if (!triggerItem) return null;

        const offerProduct = productCatalogById.get(bump.offerProductId || bump.productId) ?? null;
        const displayProduct = offerProduct ?? {
          id: triggerItem.id,
          name: triggerItem.name,
          price: triggerItem.price,
          image: (triggerItem as { image?: string }).image ?? null,
        };

        return { bump, triggerItem, offerProduct: displayProduct };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [checkoutBumps, items, productCatalogById]);

  // Auto-apply tier bump when user manually changes cart quantity to match a tier
  const nonBumpSnapshot = useMemo(
    () => items.filter((i) => !(i as { isBump?: boolean }).isBump).map((i) => `${i.id}:${i.quantity}`).join(","),
    [items]
  );
  useEffect(() => {
    if (checkoutBumps.length === 0) return;
    for (const bump of checkoutBumps) {
      if (bump.discountType !== "quantity_tiers" || !bump.tiers?.length) continue;
      const cartItem = items.find((i) => i.id === bump.productId);
      if (!cartItem) continue;
      const bumpCartId = `bump_${bump.id}`;
      const bumpItem = items.find((i) => i.id === bumpCartId);
      const cartQty = cartItem.quantity;

      const regularPrice = (cartItem as { regularPrice?: number }).regularPrice ?? cartItem.price;
      const offerProduct = productCatalogById.get(bump.offerProductId || bump.productId) ?? {
        id: cartItem.id,
        name: cartItem.name,
        price: regularPrice,
        image: (cartItem as { image?: string }).image ?? undefined,
      };
      const bumpProduct = { id: offerProduct.id, name: offerProduct.name, price: offerProduct.price, image: bump.image ?? offerProduct.image ?? undefined };

      if (!bumpItem) {
        // Caso 1: nenhum bump aplicado — auto-aplicar se qty > 1
        if (cartQty <= 1) continue;
        const bestTier = [...bump.tiers].sort((a, b) => b.qty - a.qty).find((t) => t.qty <= cartQty);
        if (!bestTier || bestTier.qty <= 1) continue;
        const baseExtra = bestTier.qty - 1;
        updateQuantity(cartItem.id, 1);
        addBumpItem(bump.id, cartItem.id, bumpProduct, bestTier.price / baseExtra, baseExtra);
        toast.success(`Desconto progressivo aplicado! (${bestTier.qty} ${bump.unit || "unidades"})`);
      } else if (cartQty > 1) {
        // Caso 2: bump já aplicado mas item principal qty > 1 (usuário aumentou fora do checkout)
        // Recomputa o tier correto para o total real (main + bump extras)
        const totalQty = cartQty + bumpItem.quantity;
        const bestTier = [...bump.tiers].sort((a, b) => b.qty - a.qty).find((t) => t.qty <= totalQty);
        removeItem(bumpCartId);
        if (bestTier && bestTier.qty > 1) {
          updateQuantity(cartItem.id, 1);
          const baseExtra = bestTier.qty - 1;
          addBumpItem(bump.id, cartItem.id, bumpProduct, bestTier.price / baseExtra, baseExtra);
          toast.success(`Desconto atualizado! (${bestTier.qty} ${bump.unit || "unidades"})`);
        } else {
          // Abaixo do menor tier — mantém a nova qty sem bump
          updateQuantity(cartItem.id, totalQty);
        }
      }
      // Caso 3: bumpItem existe e cartQty === 1 → tudo correto, nenhuma ação
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonBumpSnapshot, checkoutBumps]);

  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const isLoading = isCreatingOrder || isCheckingOut;

  const createOrderWithSecurity = useCallback(async (payload: Record<string, unknown>) => {
    setIsCreatingOrder(true);
    try {
      const submitOrder = async (forceRefreshToken = false) => {
        const resp = await fetch(`${BASE}/api/orders`, {
          method: "POST",
          headers: await getCheckoutSecurityHeaders(
            getCustomerAuthHeaders() as Record<string, string>,
            forceRefreshToken,
          ),
          body: JSON.stringify(payload),
        });
        const result = await resp.json() as Record<string, unknown>;
        return { resp, result };
      };

      let { resp, result } = await submitOrder(false);
      const invalidToken =
        resp.status === 403 &&
        (result.error === "INVALID_CHECKOUT_TOKEN" || result.message === "Sessão de checkout inválida. Recarregue a página e tente novamente.");

      if (invalidToken) {
        ({ resp, result } = await submitOrder(true));
      }

      if (!resp.ok) {
        const error = new Error(String(result.message || "Erro ao registrar pedido.")) as Error & {
          data?: { error?: string; message?: string };
        };
        error.data = {
          error: typeof result.error === "string" ? result.error : undefined,
          message: typeof result.message === "string" ? result.message : undefined,
        };
        throw error;
      }

      return result as { id: string; orderNumber?: number | null };
    } finally {
      setIsCreatingOrder(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${BASE}/api/settings`);
        if (!res.ok) return;
        const data = await res.json() as Record<string, string>;
        const parseEnabled = (value: string | undefined, defaultValue = true) => {
          if (value == null || value === "") return defaultValue;
          const normalized = String(value).trim().toLowerCase();
          return !["0", "false", "off", "no", "disabled"].includes(normalized);
        };
        const parseCurrency = (value?: string) => {
          const parsed = Number(value ?? "");
          if (!Number.isFinite(parsed) || parsed <= 0) return null;
          return parsed;
        };
        if (!cancelled) {
          setPaymentMethods({
            pix: parseEnabled(data["checkout_enable_pix"]),
            card: parseEnabled(data["checkout_enable_card"]),
            whatsapp: parseEnabled(data["checkout_enable_whatsapp"], false),
          });
          setCheckoutMode(data["checkout_mode"] === "fast" ? "fast" : "standard");
          setFreeShippingMinSubtotal(parseCurrency(data["checkout_free_shipping_min_subtotal"]));
          setFreeShippingMinMotoboy(parseCurrency(data["checkout_free_shipping_min_motoboy"]));
          setMotoboyEligibleProductIds(parseMotoboyEligibleProductIds(data["motoboy_eligible_product_ids"]));
          setInsuranceSettings(parseInsuranceSettingsFromMap(data));
        }
      } catch {
        // Keep defaults enabled on network errors.
      } finally {
        if (!cancelled) setCheckoutModeLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Smart quantity increase — respects order bump tiers
  const handleQtyIncrease = useCallback((item: (typeof items)[0]) => {
    const bump = checkoutBumps.find(
      (b) => b.productId === item.id && b.discountType === "quantity_tiers" && b.tiers?.length
    );
    if (!bump) { updateQuantity(item.id, item.quantity + 1); return; }

    const bumpCartId = `bump_${bump.id}`;
    const bumpItem = items.find((i) => i.id === bumpCartId);
    const currentTotal = (bumpItem ? 1 + (bumpItem.quantity ?? 0) : item.quantity);
    const newTotal = currentTotal + 1;

    const bestTier = [...bump.tiers!].sort((a, b) => b.qty - a.qty).find((t) => t.qty <= newTotal);
    if (bumpItem) removeItem(bumpCartId);
    if (bestTier && bestTier.qty > 1) {
      updateQuantity(item.id, 1);
      const baseExtra = bestTier.qty - 1;
      const regularPrice = (item as { regularPrice?: number }).regularPrice ?? item.price;
      const offerProduct = productCatalogById.get(bump.offerProductId || bump.productId) ?? {
        id: item.id,
        name: item.name,
        price: regularPrice,
        image: (item as { image?: string }).image ?? undefined,
      };
      addBumpItem(bump.id, item.id, { id: offerProduct.id, name: offerProduct.name, price: offerProduct.price, image: offerProduct.image ?? undefined }, bestTier.price / baseExtra, baseExtra);
      toast.success(`${bestTier.qty} ${bump.unit || "unidades"} — desconto aplicado!`);
    } else {
      updateQuantity(item.id, newTotal);
    }
  }, [checkoutBumps, items, updateQuantity, removeItem, addBumpItem]);

  // Smart quantity decrease — respects order bump tiers
  const handleQtyDecrease = useCallback((item: (typeof items)[0]) => {
    const bump = checkoutBumps.find(
      (b) => b.productId === item.id && b.discountType === "quantity_tiers" && b.tiers?.length
    );
    const bumpCartId = bump ? `bump_${bump.id}` : null;
    const bumpItem = bumpCartId ? items.find((i) => i.id === bumpCartId) : null;
    const currentTotal = bump ? (bumpItem ? 1 + (bumpItem.quantity ?? 0) : item.quantity) : item.quantity;
    const newTotal = currentTotal - 1;

    if (newTotal <= 0) { removeItem(item.id); if (bumpItem && bumpCartId) removeItem(bumpCartId); return; }

    if (!bump) { updateQuantity(item.id, newTotal); return; }

    if (bumpItem && bumpCartId) removeItem(bumpCartId);
    const bestTier = [...bump.tiers!].sort((a, b) => b.qty - a.qty).find((t) => t.qty <= newTotal);
    if (bestTier && bestTier.qty > 1) {
      updateQuantity(item.id, 1);
      const baseExtra = bestTier.qty - 1;
      const regularPrice = (item as { regularPrice?: number }).regularPrice ?? item.price;
      const offerProduct = productCatalogById.get(bump.offerProductId || bump.productId) ?? {
        id: item.id,
        name: item.name,
        price: regularPrice,
        image: (item as { image?: string }).image ?? undefined,
      };
      addBumpItem(bump.id, item.id, { id: offerProduct.id, name: offerProduct.name, price: offerProduct.price, image: offerProduct.image ?? undefined }, bestTier.price / baseExtra, baseExtra);
      toast.success(`${bestTier.qty} ${bump.unit || "unidades"} — desconto aplicado!`);
    } else {
      updateQuantity(item.id, newTotal);
    }
  }, [checkoutBumps, items, updateQuantity, removeItem, addBumpItem]);

  // Visible total qty for a non-bump item (main + bump extras)
  const visibleQty = useCallback((item: (typeof items)[0]) => {
    const bump = checkoutBumps.find((b) => b.productId === item.id && b.discountType === "quantity_tiers");
    if (!bump) return item.quantity;
    const bumpItem = items.find((i) => i.id === `bump_${bump.id}`);
    return bumpItem ? 1 + (bumpItem.quantity ?? 0) : item.quantity;
  }, [checkoutBumps, items]);

  // Capture seller from localStorage (set by SellerPage redirect)
  const sellerCode = safeReadStorage("sellerCode") || undefined;
  const normalizedSellerCode = String(sellerCode || "").trim().toLowerCase();
  const sellerHomeHref = normalizedSellerCode ? `/${encodeURIComponent(normalizedSellerCode)}` : "/";

  const resolveSellerWhatsAppStrict = useCallback(async (): Promise<string | null> => {
    const normalizedSeller = String(sellerCode || "").trim().toLowerCase();
    if (!normalizedSeller) return getActiveWhatsApp();

    try {
      const res = await fetch(`${BASE}/api/sellers/${encodeURIComponent(normalizedSeller)}`);
      if (res.ok) {
        const data = (await res.json()) as { whatsapp?: string };
        const whatsapp = String(data?.whatsapp || "").replace(/\D/g, "");
        if (whatsapp) return whatsapp;
      }
    } catch {
      // ignore and fall back below
    }

    const cachedWhatsapp = sessionStorage.getItem("sellerWhatsapp") || "";
    const cachedSlug = (sessionStorage.getItem("sellerWhatsappSlug") || "").toLowerCase();
    if (cachedWhatsapp && cachedSlug === normalizedSeller) {
      const normalizedCached = cachedWhatsapp.replace(/\D/g, "");
      if (normalizedCached) return normalizedCached;
    }

    // Fail closed to avoid routing customer to another seller.
    return null;
  }, [sellerCode]);

  // Load shipping options from API
  useEffect(() => {
    setShippingLoading(true);
    fetch(`${BASE}/api/shipping-options`)
      .then((r) => r.json())
      .then((data: { options?: ShippingOption[] }) => {
        const opts = data.options ?? [];
        setShippingOptions(opts);
        if (opts.length > 0) setSelectedShippingId(opts[0].id);
      })
      .catch(() => {})
      .finally(() => setShippingLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${BASE}/api/shipping-logistics/forecast`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Forecast unavailable");
        return response.json() as Promise<LogisticsForecast>;
      })
      .then(setLogisticsForecast)
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLogisticsForecast(null);
      });
    return () => controller.abort();
  }, []);

  // Handle pending product added via seller checkout link (/{seller}?product={id})
  useEffect(() => {
    const pendingId = sessionStorage.getItem("ka_pending_product");
    if (!pendingId) { setPendingCheck(false); return; }
    sessionStorage.removeItem("ka_pending_product");
    fetch(`${BASE}/api/products`)
      .then((r) => r.json())
      .then((data: { products?: Array<{ id: string; name: string; price: number; promoPrice?: number | null; promoEndsAt?: string | null; image?: string | null; unit?: string; category?: string; description?: string; isActive?: boolean; isSoldOut?: boolean; stock?: number }> }) => {
        const found = data.products?.find((p) => p.id === pendingId);
        if (found && !isProductUnavailable(found as Parameters<typeof isProductUnavailable>[0])) {
          addItem(found as Parameters<typeof addItem>[0]);
          return;
        }
        toast.error("O produto do link de checkout esta indisponivel no momento.");
      })
      .catch(() => {})
      .finally(() => setPendingCheck(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subtotal = getSubtotal();
  const nonBumpItems = useMemo(
    () => items.filter((item) => !(item as { isBump?: boolean }).isBump),
    [items]
  );
  const isLanderGoldItem = useCallback((item: (typeof items)[number]) => {
    const category = (productCategoryById.get(item.id) ?? "").trim().toLowerCase();
    if (isLanderGoldCategory(category)) return true;
    return isLanderGoldCategory(String(item.name ?? ""));
  }, [productCategoryById]);
  const isLanderGoldOnlyCart = nonBumpItems.length > 0 && nonBumpItems.every((item) => isLanderGoldItem(item));
  const landerGoldOnlyQty = nonBumpItems.reduce((acc, item) => (
    isLanderGoldItem(item) ? acc + item.quantity : acc
  ), 0);
  const shouldBlockLanderGoldOnlyCheckout = isLanderGoldOnlyCart && landerGoldOnlyQty < LANDER_GOLD_MIN_QTY;
  const missingLanderGoldQty = Math.max(0, LANDER_GOLD_MIN_QTY - landerGoldOnlyQty);

  const validateLanderGoldRule = useCallback(() => {
    if (!shouldBlockLanderGoldOnlyCheckout) return true;
    const pieceLabel = missingLanderGoldQty === 1 ? "peça" : "peças";
    toast.error(
      `Pedido mínimo para Lander Gold sozinho: ${LANDER_GOLD_MIN_QTY} peças. `
      + `Adicione mais ${missingLanderGoldQty} ${pieceLabel} ou inclua outro produto no carrinho.`
    );
    return false;
  }, [missingLanderGoldQty, shouldBlockLanderGoldOnlyCheckout]);

  const couponProductsPayload = useMemo(
    () => items.map((item) => ({
      id: (item as { bumpProductId?: string }).bumpProductId ?? item.id,
      quantity: item.quantity,
      price: item.price,
      regularPrice: (item as { regularPrice?: number }).regularPrice ?? item.price,
    })),
    [items]
  );
  const eligibleProductSubtotal = useMemo(() => {
    if (!appliedCoupon) return 0;
    if (!appliedCoupon.eligibleProductIds.length) {
      return couponProductsPayload.reduce((acc, p) => acc + p.price * p.quantity, 0);
    }
    const eligibleSet = new Set(appliedCoupon.eligibleProductIds);
    return couponProductsPayload.reduce((acc, p) => (
      eligibleSet.has(p.id) ? acc + p.price * p.quantity : acc
    ), 0);
  }, [appliedCoupon, couponProductsPayload]);
  const eligibleProductSubtotalCard = useMemo(() => {
    if (!appliedCoupon) return 0;
    if (!appliedCoupon.eligibleProductIds.length) {
      return couponProductsPayload.reduce((acc, p) => acc + p.regularPrice * p.quantity, 0);
    }
    const eligibleSet = new Set(appliedCoupon.eligibleProductIds);
    return couponProductsPayload.reduce((acc, p) => (
      eligibleSet.has(p.id) ? acc + p.regularPrice * p.quantity : acc
    ), 0);
  }, [appliedCoupon, couponProductsPayload]);
  const cartProductIds = useMemo(
    () => Array.from(new Set(items.map((item) => String((item as { bumpProductId?: string }).bumpProductId ?? item.id ?? "").trim()).filter(Boolean))),
    [items],
  );
  const isCartMotoboyEligible = motoboyEligibleProductIds.length === 0
    || (cartProductIds.length > 0 && cartProductIds.every((id) => motoboyEligibleProductIds.includes(id)));

  const availableShippingOptions = useMemo(
    () => (motoboyShippingOption && isCartMotoboyEligible ? [...shippingOptions, motoboyShippingOption] : shippingOptions),
    [motoboyShippingOption, shippingOptions, isCartMotoboyEligible],
  );
  const selectedShipping = availableShippingOptions.find((o) => o.id === selectedShippingId) ?? null;
  const isMotoboySelected = Boolean(selectedShippingId?.startsWith("motoboy_"));
  const motoboyNeighborhoodId = isMotoboySelected
    ? selectedShipping?.motoboyAreaId || selectedShippingId!.slice("motoboy_".length)
    : "";
  const motoboyDeliveryAreaType = selectedShipping?.motoboyAreaType || "neighborhood";
  const motoboySchedulePayload = isMotoboySelected
    ? { neighborhoodId: motoboyNeighborhoodId, deliveryAreaType: motoboyDeliveryAreaType, deliveryCep: cepDisplay, deliveryCity: cepCity, date: motoboyDeliveryDate, time: motoboyDeliveryTime }
    : undefined;

  useEffect(() => {
    if (!isMotoboySelected) {
      setMotoboyDeliveryDate("");
      setMotoboyDeliveryTime("");
      setMotoboyAvailableSlots([]);
      return;
    }
    const minDate = getMotoboyCalendarMinDate();
    setMotoboyDeliveryDate((current) => {
      if (!current || current < minDate) return minDate;
      return current;
    });
  }, [isMotoboySelected]);

  useEffect(() => {
    if (isCartMotoboyEligible) return;
    setSelectedShippingId((current) => (current?.startsWith("motoboy_") ? shippingOptions[0]?.id || null : current));
  }, [isCartMotoboyEligible, shippingOptions]);

  useEffect(() => {
    if (!isMotoboySelected || !motoboyNeighborhoodId || !motoboyDeliveryDate) return;
    const controller = new AbortController();
    setMotoboySlotsLoading(true);
    setMotoboyDeliveryTime("");

    fetch(`${BASE}/api/motoboy-delivery/availability?neighborhoodId=${encodeURIComponent(motoboyNeighborhoodId)}&deliveryAreaType=${encodeURIComponent(motoboyDeliveryAreaType)}&date=${encodeURIComponent(motoboyDeliveryDate)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json() as { slots?: string[]; durationHours?: number; message?: string };
        if (!response.ok) throw new Error(result.message || "Erro ao carregar horários.");
        setMotoboyAvailableSlots(result.slots || []);
        setMotoboyDurationHours(result.durationHours || 1);
      })
      .catch((error: Error) => {
        if (error.name === "AbortError") return;
        setMotoboyAvailableSlots([]);
        toast.error(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setMotoboySlotsLoading(false);
      });

    return () => controller.abort();
  }, [isMotoboySelected, motoboyDeliveryAreaType, motoboyDeliveryDate, motoboyNeighborhoodId]);

  const validateMotoboySchedule = useCallback(() => {
    if (!isMotoboySelected || (motoboyDeliveryDate && motoboyDeliveryTime)) return true;
    toast.error("Selecione a data e o horário da entrega por motoboy.");
    return false;
  }, [isMotoboySelected, motoboyDeliveryDate, motoboyDeliveryTime]);
  const shippingBaseCost = selectedShipping ? Number(selectedShipping.price) : 0;
  const activeFreeShippingMin = isMotoboySelected ? freeShippingMinMotoboy : freeShippingMinSubtotal;
  const isFreeByMinimumSubtotal = activeFreeShippingMin != null && subtotal >= activeFreeShippingMin;
  const isSelectedShippingFree = selectedShipping != null && shippingBaseCost <= 0;
  const isFreeShippingEligible = isFreeByMinimumSubtotal || isSelectedShippingFree;
  const freeShippingProgress = isFreeShippingEligible
    ? 100
    : activeFreeShippingMin == null
      ? 0
      : Math.min(100, (subtotal / activeFreeShippingMin) * 100);
  const shippingCost = isFreeShippingEligible ? 0 : shippingBaseCost;
  const shippingSavings = isFreeShippingEligible ? shippingBaseCost : 0;
  const missingForFreeShipping = isFreeShippingEligible || activeFreeShippingMin == null
    ? 0
    : Math.max(0, activeFreeShippingMin - subtotal);
  const discountAmount = appliedCoupon
    ? appliedCoupon.discountType === "percent"
      ? eligibleProductSubtotal * (appliedCoupon.discountValue / 100)
      : Math.min(appliedCoupon.discountValue, eligibleProductSubtotal)
    : 0;
  const insuranceLines = insuranceLinesFromProducts(items.map((item) => ({
    id: (item as { bumpProductId?: string }).bumpProductId ?? item.id,
    quantity: item.quantity,
    price: item.price,
  })));
  const insuranceSnapshot = resolveCheckoutInsurance({
    includeInsurance: insurancePlan !== "none",
    insurancePlan,
    subtotal,
    shippingCost,
    discountAmount,
    lines: insuranceLines,
    settings: insuranceSettings,
  });
  const fullInsuranceQuote = resolveCheckoutInsurance({
    includeInsurance: true,
    insurancePlan: "full",
    subtotal,
    shippingCost: 0,
    lines: insuranceLines,
    settings: { ...insuranceSettings, reducedEnabled: false, fullEnabled: true, enabled: true },
  });
  const insuranceAmount = insuranceSnapshot.insuranceAmount;
  const includeInsurance = insuranceSnapshot.includeInsurance;
  const total = insuranceSnapshot.total;
  const baseTotal = subtotal + shippingCost + insuranceAmount;
  const storeCreditToApply = useStoreCredit ? Math.min(storeCreditAvailable, total) : 0;
  const afterStoreCredit = Math.max(0, total - storeCreditToApply);
  const affiliateCreditToApply = useAffiliateCredit ? Math.min(affiliateCreditAvailable, afterStoreCredit) : 0;
  const payableTotal = Math.max(0, afterStoreCredit - affiliateCreditToApply);

  // Card payment uses regular (non-promo) prices
  const cardSubtotal = getCardSubtotal();
  const cardDiscountAmount = appliedCoupon
    ? appliedCoupon.discountType === "percent"
      ? eligibleProductSubtotalCard * (appliedCoupon.discountValue / 100)
      : Math.min(appliedCoupon.discountValue, eligibleProductSubtotalCard)
    : 0;
  const cardInsuranceSnapshot = resolveCheckoutInsurance({
    includeInsurance,
    insurancePlan,
    subtotal: cardSubtotal,
    shippingCost,
    discountAmount: cardDiscountAmount,
    lines: insuranceLinesFromProducts(items.map((item) => ({
      id: (item as { bumpProductId?: string }).bumpProductId ?? item.id,
      quantity: item.quantity,
      price: (item as { regularPrice?: number }).regularPrice ?? item.price,
    }))),
    settings: insuranceSettings,
  });
  const cardInsuranceAmount = cardInsuranceSnapshot.insuranceAmount;
  const cardBaseTotal = cardSubtotal + shippingCost + cardInsuranceAmount;
  const cardNetTotal = Math.max(0, cardBaseTotal - cardDiscountAmount);

  useEffect(() => {
    const token = getCustomerToken();
    if (!token) {
      setAffiliateCreditAvailable(0);
      setUseAffiliateCredit(false);
      setStoreCreditAvailable(0);
      setUseStoreCredit(false);
      return;
    }

    let active = true;
    setAffiliateCreditLoading(true);
    fetch(`${BASE}/api/me/affiliate/credit-balance`, {
      headers: getCustomerAuthHeaders(),
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { availableCredit?: number };
      })
      .then((data) => {
        if (!active) return;
        const available = Number(data?.availableCredit || 0);
        setAffiliateCreditAvailable(Number.isFinite(available) ? available : 0);
      })
      .catch(() => {
        if (active) setAffiliateCreditAvailable(0);
      })
      .finally(() => {
        if (active) setAffiliateCreditLoading(false);
      });

    fetch(`${BASE}/api/me/wallet`, {
      headers: getCustomerAuthHeaders(),
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { availableCredit?: number };
      })
      .then((data) => {
        if (!active) return;
        const available = Number(data?.availableCredit || 0);
        setStoreCreditAvailable(Number.isFinite(available) ? available : 0);
      })
      .catch(() => {
        if (active) setStoreCreditAvailable(0);
      });

    return () => {
      active = false;
    };
  }, []);

  const applyCoupon = async () => {
    if (!couponInput.trim()) return;
    setCouponLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/coupons/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: couponInput.trim(),
          orderValue: subtotal + shippingCost,
          products: couponProductsPayload.map((p) => ({ id: p.id, quantity: p.quantity, price: p.price })),
        }),
      });
      const data = await res.json() as {
        valid?: boolean;
        code?: string;
        discountType?: string;
        discountValue?: number;
        eligibleProductIds?: string[];
        message?: string;
      };
      if (!res.ok || !data.valid) {
        toast.error(data.message || "Cupom inválido.");
        return;
      }
      setAppliedCoupon({
        code: data.code!,
        discountType: data.discountType!,
        discountValue: data.discountValue!,
        eligibleProductIds: Array.isArray(data.eligibleProductIds) ? data.eligibleProductIds : [],
      });
      setCouponInput("");
      toast.success(`Cupom ${data.code} aplicado!`);
    } catch {
      toast.error("Erro ao validar cupom. Tente novamente.");
    } finally {
      setCouponLoading(false);
    }
  };

  const removeCoupon = () => { setAppliedCoupon(null); };

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<CheckoutFormData>({
    resolver: zodResolver(checkoutSchema),
  });

  const handleCPFChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCPF(e.target.value);
    setCpfDisplay(formatted);
    setValue("document", formatted, { shouldValidate: false });
  }, [setValue]);

  const handlePhoneChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    setPhoneDisplay(formatted);
    setValue("phone", formatted, { shouldValidate: false });
  }, [setValue]);

  const handleCEPChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCEP(e.target.value);
    setCepDisplay(formatted);
    setValue("cep", formatted, { shouldValidate: false });

    const rawCep = formatted.replace(/\D/g, "");
    if (rawCep.length < 8) {
      setCepCity("");
      setFastLookupStatus("idle");
      setMotoboyShippingOption(null);
      setSelectedShippingId((current) => current?.startsWith("motoboy_") ? shippingOptions[0]?.id || null : current);
    }
    if (rawCep.length === 8) {
      setCepCity("");
      setFastLookupStatus("checking");
      setCepLoading(true);
      try {
        const res = await fetch(`https://viacep.com.br/ws/${rawCep}/json/`);
        const data = await res.json() as {
          erro?: boolean;
          logradouro?: string;
          bairro?: string;
          localidade?: string;
          uf?: string;
        };
        if (!data.erro) {
          if (data.logradouro) setValue("street", data.logradouro, { shouldValidate: false });
          if (data.bairro) setValue("neighborhood", data.bairro, { shouldValidate: false });
          if (data.localidade) {
            setValue("city", data.localidade, { shouldValidate: false });
            setCepCity(data.localidade);
          }
          if (data.uf) setValue("state", data.uf, { shouldValidate: false });
          if (!data.logradouro) {
            toast.info("CEP encontrado, mas sem rua cadastrada. Preencha o endereço manualmente.");
          }
          try {
            let option: ShippingOption | null = null;
            if (data.bairro) {
              const lookupParams = new URLSearchParams({ bairro: data.bairro });
              if (data.localidade) lookupParams.set("cidade", data.localidade);
              const lookupRes = await fetch(`${BASE}/api/motoboy-neighborhoods/lookup?${lookupParams}`);
              const lookupData = await lookupRes.json() as {
                neighborhood?: {
                  id: string;
                  neighborhoodName: string;
                  price: string | number;
                  sortOrder: number;
                  notes?: string | null;
                } | null;
              };
              const neighborhood = lookupRes.ok ? lookupData.neighborhood : null;
              if (neighborhood) {
                option = {
                  id: `motoboy_${neighborhood.id}`,
                  name: "Motoboy",
                  description: neighborhood.notes || `Entrega em ${neighborhood.neighborhoodName}`,
                  price: Number(neighborhood.price),
                  sortOrder: neighborhood.sortOrder,
                  isActive: true,
                  motoboyAreaId: neighborhood.id,
                  motoboyAreaType: "neighborhood",
                };
              }
            }

            if (!option) {
              const rangeParams = new URLSearchParams({ cep: rawCep, cidade: data.localidade || "" });
              const rangeRes = await fetch(`${BASE}/api/motoboy-cep-ranges/lookup?${rangeParams}`);
              const rangeData = await rangeRes.json() as {
                cepRange?: {
                  id: string;
                  label: string;
                  price: string | number;
                  intervalHours: number;
                  sortOrder: number;
                  notes?: string | null;
                } | null;
              };
              const cepRange = rangeRes.ok ? rangeData.cepRange : null;
              if (cepRange) {
                option = {
                  id: `motoboy_range_${cepRange.id}`,
                  name: "Motoboy",
                  description: cepRange.notes || `Entrega em ${cepRange.label}`,
                  price: Number(cepRange.price),
                  sortOrder: cepRange.sortOrder,
                  isActive: true,
                  motoboyAreaId: cepRange.id,
                  motoboyAreaType: "cepRange",
                };
              }
            }

            if (option) {
              setMotoboyShippingOption(option);
              if (checkoutMode === "fast" && isCartMotoboyEligible) setSelectedShippingId(option.id);
              if (checkoutMode === "fast" && !isCartMotoboyEligible) {
                setSelectedShippingId((current) => current?.startsWith("motoboy_") ? shippingOptions[0]?.id || null : current);
              }
              setFastLookupStatus("motoboy");
            } else {
              setMotoboyShippingOption(null);
              setSelectedShippingId((current) => current?.startsWith("motoboy_") ? shippingOptions[0]?.id || null : current);
              setFastLookupStatus("unsupported");
            }
          } catch {
            setMotoboyShippingOption(null);
            setSelectedShippingId((current) => current?.startsWith("motoboy_") ? shippingOptions[0]?.id || null : current);
            setFastLookupStatus("idle");
            toast.error("Erro ao consultar a disponibilidade do motoboy. Tente novamente.");
          }
        } else {
          setFastLookupStatus("idle");
          setMotoboyShippingOption(null);
          setSelectedShippingId((current) => current?.startsWith("motoboy_") ? shippingOptions[0]?.id || null : current);
          toast.error("CEP não encontrado. Preencha o endereço manualmente.");
        }
      } catch {
        setFastLookupStatus("idle");
        setMotoboyShippingOption(null);
        setSelectedShippingId((current) => current?.startsWith("motoboy_") ? shippingOptions[0]?.id || null : current);
        toast.error("Erro ao consultar CEP. Preencha o endereço manualmente.");
      } finally {
        setCepLoading(false);
      }
    }
  }, [checkoutMode, isCartMotoboyEligible, setValue, shippingOptions]);

  const handleFastWhatsApp = useCallback(async () => {
    const name = String(getValues("name") || "").trim();
    const cep = String(getValues("cep") || cepDisplay).trim();
    if (name.length < 3) {
      toast.error("Informe seu nome completo.");
      return;
    }
    if (cep.replace(/\D/g, "").length !== 8) {
      toast.error("Informe um CEP válido.");
      return;
    }
    if (!validateLanderGoldRule()) return;
    if (!(await validateCartAvailability())) return;

    const whatsappWindow = window.open("", "_blank");
    if (whatsappWindow) whatsappWindow.opener = null;
    setFastWhatsappOpening(true);
    try {
      const sellerWhatsApp = await resolveSellerWhatsAppStrict();
      if (!sellerWhatsApp) {
        whatsappWindow?.close();
        toast.error("Não foi possível confirmar o WhatsApp da loja. Tente novamente.");
        return;
      }
      const itemsText = items
        .map((item) => `- ${item.quantity}x ${item.name} — ${formatCurrency(item.price * item.quantity)}`)
        .join("\n");
      const message =
        `Olá! Quero finalizar meu pedido via WhatsApp.\n\n` +
        `Cliente: ${name}\n` +
        `CEP: ${cep}\n\n` +
        `Itens:\n${itemsText}\n\n` +
        `Total dos produtos: ${formatCurrency(subtotal)}`;
      const whatsappUrl = `https://wa.me/${sellerWhatsApp}?text=${encodeURIComponent(message)}`;
      if (whatsappWindow) whatsappWindow.location.href = whatsappUrl;
      else window.location.href = whatsappUrl;
    } finally {
      setFastWhatsappOpening(false);
    }
  }, [cepDisplay, getValues, items, resolveSellerWhatsAppStrict, subtotal, validateCartAvailability, validateLanderGoldRule]);

  useEffect(() => {
    if (!pendingCheckoutRetry) return;

    const action = pendingCheckoutRetry;
    setPendingCheckoutRetry(null);

    const timer = window.setTimeout(() => {
      if (action === "pix") {
        void handleSubmit((formData) => handlePixPayment(formData, true))();
        return;
      }
      if (action === "whatsapp") {
        void handleSubmit((formData) => handleWhatsAppPayment(formData, true))();
        return;
      }
      void finalizeCardPayment(true);
    }, 120);

    return () => window.clearTimeout(timer);
  }, [finalizeCardPayment, handleSubmit, handlePixPayment, handleWhatsAppPayment, pendingCheckoutRetry]);

  if (pendingCheck) {
    return (
      <CheckoutLayout>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </CheckoutLayout>
    );
  }

  if (!checkoutModeLoaded) {
    return (
      <CheckoutLayout>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </CheckoutLayout>
    );
  }

  if (items.length === 0) {
    return (
      <CheckoutLayout>
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <h2 className="text-2xl font-bold mb-4">Seu carrinho está vazio</h2>
          <Button onClick={() => setLocation(sellerHomeHref)}>Voltar para loja</Button>
        </div>

        <AnimatePresence>
          {whatsappModalData && (
            <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => setWhatsappModalData(null)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-card w-full max-w-md rounded-3xl shadow-2xl relative z-10 p-8 text-center"
              >
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                </div>

                <h2 className="text-2xl font-bold mb-2">Pedido #{whatsappModalData.displayNumber} criado!</h2>
                <p className="text-muted-foreground mb-6">
                  Seu pedido foi criado com sucesso. Agora, clique no botão abaixo para solicitar a chave PIX ao vendedor.
                </p>

                <div className="space-y-3">
                  <Button
                    className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => {
                      setIsOpeningWhatsApp(true);
                      window.open(whatsappModalData.url, "_blank", "noopener,noreferrer");
                      setTimeout(() => {
                        setWhatsappModalData(null);
                        setIsOpeningWhatsApp(false);
                      }, 500);
                    }}
                    disabled={isOpeningWhatsApp}
                  >
                    <MessageCircle className="w-4 h-4" />
                    {isOpeningWhatsApp ? "Abrindo..." : "Solicitar PIX no WhatsApp"}
                  </Button>

                  <Button
                    variant="ghost"
                    className="w-full"
                    onClick={() => setWhatsappModalData(null)}
                    disabled={isOpeningWhatsApp}
                  >
                    Fechar
                  </Button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </CheckoutLayout>
    );
  }

  async function handlePixPayment(data: CheckoutFormData, autoRetry = false) {
    if (!autoRetry) {
      priceSyncRetryCountRef.current.pix = 0;
    }
    if (!paymentMethods.pix) {
      toast.error("Pagamento via PIX está desativado no momento.");
      return;
    }

    if (!validateLanderGoldRule()) return;
    if (!validateMotoboySchedule()) return;

    const cartAvailable = await validateCartAvailability();
    if (!cartAvailable) return;

    setIsCheckingOut(true);
    try {
      const clientPayload = {
        name: data.name,
        email: data.email,
        phone: data.phone,
        document: data.document,
      };

      const addressPayload = {
        cep: data.cep,
        street: data.street,
        number: data.number,
        complement: data.complement || "",
        neighborhood: data.neighborhood,
        city: data.city,
        state: data.state,
      };

      const productsPayload = items.map((item) => ({
        id: (item as { bumpProductId?: string }).bumpProductId ?? item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        isBump: (item as { isBump?: boolean }).isBump === true,
        selectedVariants: normalizeSelectedVariants((item as Record<string, unknown>).selectedVariants),
        variantLabel: resolveVariantLabel(item as unknown as Record<string, unknown>) || undefined,
      }));

      const affiliateCode = getStoredReferralCode();

      const resp = await fetch(`${BASE}/api/checkout/pix`, {
        method: "POST",
        headers: await getCheckoutSecurityHeaders(getCustomerAuthHeaders() as Record<string, string>),
        body: JSON.stringify({
          client: clientPayload,
          address: addressPayload,
          products: productsPayload,
          shippingType:    selectedShipping?.name ?? "Frete",
          includeInsurance: insuranceSnapshot.includeInsurance,
          insurancePlan: insuranceSnapshot.plan === "none" ? undefined : insuranceSnapshot.plan,
          useStoreCredit,
          subtotal,
          shippingCost,
          insuranceAmount,
          total,
          sellerCode,
          affiliateCode:   affiliateCode || undefined,
          useAffiliateCredit,
          couponCode:      appliedCoupon?.code,
          discountAmount:  discountAmount > 0 ? discountAmount : undefined,
          motoboySchedule: motoboySchedulePayload,
        }),
      });

      const result = await resp.json() as {
        error?: string;
        orderId?: string;
        transactionId?: string;
        status?: string;
        pixCode?: string;
        pixBase64?: string;
        pixImage?: string;
        expiresAt?: string;
        coveredByAffiliateCredit?: boolean;
        affiliateCreditUsed?: number;
        remainingToPay?: number;
        message?: string;
      };

      if (!resp.ok) {
        if (result.error === "PRICE_CHANGED") {
          const synced = await syncCartWithLatestProducts();
          toast.error(result.message || "Os preços mudaram e o carrinho foi atualizado.");
          if (synced && priceSyncRetryCountRef.current.pix < 1) {
            priceSyncRetryCountRef.current.pix += 1;
            toast.info("Valores atualizados. Tentando finalizar novamente...");
            setPendingCheckoutRetry("pix");
            return;
          }
          if (synced) toast.info("Revise os novos valores e finalize novamente.");
          return;
        }
        toast.error(result.message || "Erro ao gerar pagamento PIX. Verifique os dados e tente novamente.");
        return;
      }

      priceSyncRetryCountRef.current.pix = 0;

      if (result.coveredByAffiliateCredit) {
        const coveredOrderId = result.orderId || genId();
        localStorage.setItem(
          "successOrder",
          JSON.stringify({
            orderId: coveredOrderId,
            clientName:     data.name,
            clientPhone:    data.phone,
            clientEmail:    data.email,
            clientDocument: data.document,
            address: {
              street:       data.street,
              number:       data.number,
              complement:   data.complement || "",
              neighborhood: data.neighborhood,
              city:         data.city,
              state:        data.state,
              cep:          data.cep,
            },
            products:        items.map((i) => ({
              name: i.name,
              quantity: i.quantity,
              price: i.price,
              variantLabel: resolveVariantLabel(i as unknown as Record<string, unknown>) || undefined,
            })),
            shippingType:    selectedShipping?.name ?? "Frete",
            motoboyDeliveryDate: isMotoboySelected ? motoboyDeliveryDate : undefined,
            motoboyDeliveryTime: isMotoboySelected ? motoboyDeliveryTime : undefined,
            shippingCost,
            includeInsurance: insuranceSnapshot.includeInsurance,
          insurancePlan: insuranceSnapshot.plan === "none" ? undefined : insuranceSnapshot.plan,
          useStoreCredit,
            insuranceAmount,
            subtotal,
            discountAmount:  discountAmount > 0 ? discountAmount : 0,
            couponCode:      appliedCoupon?.code || "",
            total:           0,
          })
        );
        clearCart();
        setIsOpen(false);
        setLocation("/success");
        return;
      }

      const orderId = result.orderId!;

      localStorage.setItem(
        "currentPix",
        JSON.stringify({
          transactionId: result.transactionId,
          expiresAt:     result.expiresAt,
          pixCode:       result.pixCode,
          pixBase64:     result.pixBase64,
          pixImage:      result.pixImage,
          orderId,
        })
      );
      localStorage.setItem(
        "pixOrderData",
        JSON.stringify({
          client:       clientPayload,
          products:     productsPayload,
          amount:       Number(result.remainingToPay ?? payableTotal),
          shippingType: selectedShipping?.name ?? "Frete",
          includeInsurance: insuranceSnapshot.includeInsurance,
          insurancePlan: insuranceSnapshot.plan === "none" ? undefined : insuranceSnapshot.plan,
          useStoreCredit,
          orderId,
        })
      );
      localStorage.setItem(
        "successOrder",
        JSON.stringify({
          orderId,
          clientName:     data.name,
          clientPhone:    data.phone,
          clientEmail:    data.email,
          clientDocument: data.document,
          address: {
            street:       data.street,
            number:       data.number,
            complement:   data.complement || "",
            neighborhood: data.neighborhood,
            city:         data.city,
            state:        data.state,
            cep:          data.cep,
          },
          products:        items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            price: i.price,
            variantLabel: resolveVariantLabel(i as unknown as Record<string, unknown>) || undefined,
          })),
          shippingType:    selectedShipping?.name ?? "Frete",
          motoboyDeliveryDate: isMotoboySelected ? motoboyDeliveryDate : undefined,
          motoboyDeliveryTime: isMotoboySelected ? motoboyDeliveryTime : undefined,
          shippingCost,
          includeInsurance: insuranceSnapshot.includeInsurance,
          insurancePlan: insuranceSnapshot.plan === "none" ? undefined : insuranceSnapshot.plan,
          useStoreCredit,
          insuranceAmount,
          subtotal,
          discountAmount:  discountAmount > 0 ? discountAmount : 0,
          couponCode:      appliedCoupon?.code || "",
          total,
        })
      );
      clearCart();
      setIsOpen(false);
      setLocation(`/pix/${result.transactionId}`);
    } catch {
      toast.error("Erro de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setIsCheckingOut(false);
    }
  }

  const handleCardPayment = () => {
    if (!paymentMethods.card) {
      toast.error("Pagamento com cartão está desativado no momento.");
      return;
    }

    handleSubmit(async () => {
      if (!validateLanderGoldRule()) return;

      const cartAvailable = await validateCartAvailability();
      if (!cartAvailable) return;

      setKycOrderId("");
      setKycOrderDisplay("");
      setKycWhatsAppUrl("");
      setKycVerified(false);
      // Check if this CPF already has an approved KYC
      const cpf = (getValues("document") as string | undefined)?.replace(/\D/g, "") ?? "";
      if (cpf) {
        try {
          const res = await fetch(`${import.meta.env.BASE_URL}api/kyc/check-cpf/${cpf}`, {
            method: "GET",
            headers: await getCheckoutSecurityHeaders(),
          });
          if (res.ok) {
            const data = (await res.json()) as { approved: boolean };
            if (data.approved) {
              setKycVerified(true);
              const hasPromo = cardSubtotal > subtotal;
              setCardModalStep(hasPromo ? "card_pricing" : "installments");
              setShowCardModal(true);
              return;
            }
          }
        } catch { /* ignore, proceed normally */ }
      }
      const hasPromo = cardSubtotal > subtotal;
      setCardModalStep(hasPromo ? "card_pricing" : "kyc_notice");
      setShowCardModal(true);
    })();
  };

  async function handleWhatsAppPayment(data: CheckoutFormData, autoRetry = false) {
    if (!autoRetry) {
      priceSyncRetryCountRef.current.whatsapp = 0;
    }
    if (!paymentMethods.whatsapp) {
      toast.error("Pagamento via WhatsApp está desativado no momento.");
      return;
    }

    if (!validateLanderGoldRule()) return;
    if (!validateMotoboySchedule()) return;

    const cartAvailable = await validateCartAvailability();
    if (!cartAvailable) return;

    const productsPayload = items.map((item) => ({
      id: (item as { bumpProductId?: string }).bumpProductId ?? item.id,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      isBump: (item as { isBump?: boolean }).isBump === true,
      selectedVariants: normalizeSelectedVariants((item as Record<string, unknown>).selectedVariants),
      variantLabel: resolveVariantLabel(item as unknown as Record<string, unknown>) || undefined,
    }));

    const affiliateCode = getStoredReferralCode();

    try {
      const order = await createOrderWithSecurity({
        client: { name: data.name, email: data.email, phone: data.phone, document: data.document },
        address: {
          cep: data.cep,
          street: data.street,
          number: data.number,
          complement: data.complement || "",
          neighborhood: data.neighborhood,
          city: data.city,
          state: data.state,
        },
        products: productsPayload,
        shippingType: selectedShipping?.name ?? "Frete",
        includeInsurance: insuranceSnapshot.includeInsurance,
        insurancePlan: insuranceSnapshot.plan === "none" ? undefined : insuranceSnapshot.plan,
        useStoreCredit,
        subtotal,
        shippingCost,
        insuranceAmount,
        total,
        paymentMethod: "whatsapp_pix",
        sellerCode,
        affiliateCode: affiliateCode || undefined,
        couponCode: appliedCoupon?.code,
        discountAmount: discountAmount > 0 ? discountAmount : undefined,
        motoboySchedule: motoboySchedulePayload,
      });

      const itemsText = productsPayload
        .map((item) => {
          const itemTotal = item.price * item.quantity;
          const variant = item.variantLabel ? ` (${item.variantLabel})` : "";
          return `- ${item.quantity}x ${item.name}${variant} — ${formatCurrency(itemTotal)}`;
        })
        .join("\n");
      const motoboyItemsText = productsPayload
        .map((item) => {
          const variant = item.variantLabel ? ` – ${item.variantLabel}` : "";
          return `• ${item.quantity}x ${item.name}${variant}`;
        })
        .join("\n");

      const addressFull = [
        `${data.street}, ${data.number}`,
        data.complement,
        data.neighborhood,
        `${data.city}/${data.state}`,
        `CEP ${data.cep}`,
      ]
        .filter(Boolean)
        .join(", ");

      const isMotoboyShipping = selectedShipping?.id.startsWith("motoboy_") === true;
      const message = isMotoboyShipping
        ? `# 🛵 ENTREGAS DE HOJE\n` +
          `━━━━━━━━━━━━━━━━━━\n\n` +
          `### 📦 ENTREGA 1\n` +
          `👤 *Cliente:* ${data.name}\n` +
          `📍 *Endereço:* ${data.street}, ${data.number}${data.complement ? ` – ${data.complement}` : ""}\n` +
          `🏘️ *Bairro:* ${data.neighborhood}\n` +
          `📮 *CEP:* ${data.cep}\n\n` +
          `📅 *Agendamento:* ${motoboyDeliveryDate.split("-").reverse().join("/")} às ${motoboyDeliveryTime}\n\n` +
          `📦 *Itens:*\n${motoboyItemsText}\n\n` +
          `💰 *Produtos:* ${formatCurrency(subtotal)}\n` +
          `🏍️ *Motoboy:* ${formatCurrency(shippingCost)}\n` +
          (includeInsurance ? `🛡️ *Seguro:* ${formatCurrency(insuranceAmount)}\n` : "") +
          (discountAmount > 0 ? `🏷️ *Desconto:* -${formatCurrency(discountAmount)}\n` : "") +
          (affiliateCreditToApply > 0 ? `💳 *Crédito:* -${formatCurrency(affiliateCreditToApply)}\n` : "") +
          `💵 *TOTAL: ${formatCurrency(payableTotal)}*\n\n` +
          `━━━━━━━━━━━━━━━━━━`
        : `Olá! Quero finalizar meu pedido.\n\n` +
          `Pedido: #${formatCheckoutOrderNumber(order)}\n` +
          `Cliente: ${data.name}\n` +
          `Telefone: ${data.phone}\n` +
          `CPF: ${data.document}\n` +
          `E-mail: ${data.email}\n\n` +
          `Endereço: ${addressFull}\n\n` +
          `Itens:\n${itemsText}\n\n` +
          `Subtotal: ${formatCurrency(subtotal)}\n` +
          `Frete (${selectedShipping?.name ?? "Frete"}): ${formatCurrency(shippingCost)}${isFreeShippingEligible ? " (frete gratis)" : ""}\n` +
          (includeInsurance ? `Seguro de envio: +${formatCurrency(insuranceAmount)}\n` : "") +
          (discountAmount > 0
            ? `Desconto${appliedCoupon?.code ? ` (${appliedCoupon.code})` : ""}: -${formatCurrency(discountAmount)}\n`
            : "") +
          `Total: ${formatCurrency(payableTotal)}\n\n` +
          `Pode me enviar a chave PIX para pagamento?`;

      const sellerWhatsApp = await resolveSellerWhatsAppStrict();
      if (!sellerWhatsApp) {
        toast.error("Nao foi possivel confirmar o WhatsApp do vendedor deste link. Tente novamente em instantes.");
        return;
      }
      const waUrl = `https://wa.me/${sellerWhatsApp}?text=${encodeURIComponent(message)}`;

      // Store modal data to show confirmation dialog
      setWhatsappModalData({ url: waUrl, displayNumber: formatCheckoutOrderNumber(order) });
      toast.success(`Pedido #${formatCheckoutOrderNumber(order)} criado com sucesso!`);
      priceSyncRetryCountRef.current.whatsapp = 0;
      clearCart();
      setIsOpen(false);
    } catch (error) {
      const apiError = error as { data?: { error?: string; message?: string } };
      if (apiError?.data?.error === "PRICE_CHANGED") {
        const synced = await syncCartWithLatestProducts();
        toast.error(apiError?.data?.message || "Os preços mudaram e o carrinho foi atualizado.");
        if (synced && priceSyncRetryCountRef.current.whatsapp < 1) {
          priceSyncRetryCountRef.current.whatsapp += 1;
          toast.info("Valores atualizados. Tentando finalizar novamente...");
          setPendingCheckoutRetry("whatsapp");
          return;
        }
        if (synced) toast.info("Revise os novos valores e tente novamente.");
        return;
      }
      toast.error(apiError?.data?.message || "Erro ao registrar pedido via WhatsApp. Tente novamente.");
    }
  }

  const handleWhatsAppCheckout = () => {
    if (!paymentMethods.whatsapp) {
      toast.error("Pagamento via WhatsApp está desativado no momento.");
      return;
    }
    handleSubmit(handleWhatsAppPayment)();
  };

  async function finalizeCardPayment(autoRetry = false) {
    if (!autoRetry) {
      priceSyncRetryCountRef.current.card = 0;
    }
    if (!validateLanderGoldRule()) return;
    if (!validateMotoboySchedule()) return;

    const data = getValues();
    const cardFee = installments <= 3 ? 100 : 0;
    // Card uses regular (non-promo) prices
    const cardTotal = cardNetTotal + cardFee;
    const cardProductsPayload = items.map((i) => ({
      id: (i as { bumpProductId?: string }).bumpProductId ?? i.id,
      name: i.name,
      quantity: i.quantity,
      price: (i as { regularPrice?: number }).regularPrice ?? i.price,
      isBump: (i as { isBump?: boolean }).isBump === true,
      selectedVariants: normalizeSelectedVariants((i as Record<string, unknown>).selectedVariants),
      variantLabel: resolveVariantLabel(i as unknown as Record<string, unknown>) || undefined,
    }));
    const affiliateCode = getStoredReferralCode();

    try {
      const order = await createOrderWithSecurity({
        client: { name: data.name, email: data.email, phone: data.phone, document: data.document },
        address: {
          cep: data.cep,
          street: data.street,
          number: data.number,
          complement: data.complement || "",
          neighborhood: data.neighborhood,
          city: data.city,
          state: data.state,
        },
        products: cardProductsPayload,
        shippingType: selectedShipping?.name ?? "Frete",
        includeInsurance: insuranceSnapshot.includeInsurance,
        insurancePlan: insuranceSnapshot.plan === "none" ? undefined : insuranceSnapshot.plan,
        useStoreCredit,
        subtotal: cardSubtotal,
        shippingCost,
        insuranceAmount: cardInsuranceAmount,
        total: cardTotal,
        paymentMethod: "card_simulation",
        cardInstallments: installments,
        sellerCode,
        affiliateCode: affiliateCode || undefined,
        couponCode: appliedCoupon?.code,
        discountAmount: cardDiscountAmount > 0 ? cardDiscountAmount : undefined,
        motoboySchedule: motoboySchedulePayload,
      });

      const itemsText = cardProductsPayload
        .map((item) => `  • ${item.quantity}x ${item.name} — ${formatCurrency(item.price * item.quantity)}`)
        .join("\n");

      const addressFull = [
        `${data.street}, ${data.number}`,
        data.complement,
        data.neighborhood,
        `${data.city}/${data.state}`,
        `CEP ${data.cep}`,
      ].filter(Boolean).join(", ");

      const message =
        `💳 *Pedido via Cartão — KA Imports*\n\n` +
        `*Nº do Pedido:* ${formatCheckoutOrderNumber(order)}\n` +
        `*Cliente:* ${data.name}\n` +
        `*CPF:* ${data.document}\n` +
        `*Telefone:* ${data.phone}\n` +
        `*E-mail:* ${data.email}\n\n` +
        `*Endereço de Entrega:*\n  ${addressFull}\n\n` +
        `*Produtos:*\n${itemsText}\n\n` +
        `*Subtotal:* ${formatCurrency(cardSubtotal)}\n` +
        `*Frete (${selectedShipping?.name ?? "Frete"}):* ${formatCurrency(shippingCost)}${isFreeShippingEligible ? " (frete gratis)" : ""}\n` +
        (includeInsurance ? `*Seguro de Envio:* Sim (+${formatCurrency(cardInsuranceAmount)})\n` : "") +
        (cardDiscountAmount > 0
          ? `*Desconto${appliedCoupon?.code ? ` (${appliedCoupon.code})` : ""}:* -${formatCurrency(cardDiscountAmount)}\n`
          : "") +
        (cardFee > 0 ? `*Taxa parcelamento:* +${formatCurrency(cardFee)}\n` : "") +
        `*Parcelamento desejado:* ${installments}x\n` +
        `*Total:* ${formatCurrency(cardTotal)}\n\n` +
        `Aguardo o retorno para confirmar os detalhes!`;

      const sellerWhatsApp = await resolveSellerWhatsAppStrict();
      if (!sellerWhatsApp) {
        toast.error("Nao foi possivel confirmar o WhatsApp do vendedor deste link. Tente novamente em instantes.");
        return;
      }
      const waUrl = `https://wa.me/${sellerWhatsApp}?text=${encodeURIComponent(message)}`;
      setKycOrderId(order.id);
      setKycOrderDisplay(formatCheckoutOrderNumber(order));
      setKycWhatsAppUrl(waUrl);
      setCardModalStep("kyc_link");
      priceSyncRetryCountRef.current.card = 0;
    } catch (error) {
      const apiError = error as { data?: { error?: string; message?: string } };
      if (apiError?.data?.error === "PRICE_CHANGED") {
        const synced = await syncCartWithLatestProducts();
        toast.error(apiError?.data?.message || "Os preços mudaram e o carrinho foi atualizado.");
        if (synced && priceSyncRetryCountRef.current.card < 1) {
          priceSyncRetryCountRef.current.card += 1;
          toast.info("Valores atualizados. Tentando finalizar novamente...");
          setPendingCheckoutRetry("card");
          return;
        }
        if (synced) toast.info("Revise os novos valores e tente novamente.");
        return;
      }
      toast.error(apiError?.data?.message || "Erro ao registrar pedido. Tente novamente.");
    }
  }

  return (
    <CheckoutLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <button
          onClick={() => setLocation(sellerHomeHref)}
          className="flex items-center text-muted-foreground hover:text-primary mb-8 font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Voltar para loja
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
          {checkoutMode === "fast" && fastLookupStatus !== "motoboy" ? (
            <div className="lg:col-span-12 mx-auto w-full max-w-3xl">
              <div className="border border-border bg-card p-6 shadow-sm sm:p-8">
                <div className="mb-6 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center bg-emerald-600 text-white">
                    <Zap className="h-5 w-5" />
                  </div>
                  <div>
                    <h1 className="text-xl font-bold text-foreground">Checkout Rápido</h1>
                    <p className="text-sm text-muted-foreground">Informe seu nome e CEP para verificar a entrega.</p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Nome Completo *"
                    placeholder="João da Silva"
                    {...register("name")}
                    error={errors.name?.message}
                  />
                  <div className="w-full space-y-1.5">
                    <label className="ml-1 text-sm font-medium text-foreground">CEP *</label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={cepDisplay}
                        onChange={handleCEPChange}
                        placeholder="00000-000"
                        maxLength={9}
                        className="flex h-12 w-full border-2 border-border bg-white px-4 py-2 pr-10 text-base outline-none transition-colors focus:border-primary"
                      />
                      {(cepLoading || fastLookupStatus === "checking") && (
                        <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-primary" />
                      )}
                    </div>
                  </div>
                </div>

                {fastLookupStatus === "checking" && (
                  <p className="mt-4 text-sm text-muted-foreground">Consultando endereço e disponibilidade de entrega...</p>
                )}

                {fastLookupStatus === "unsupported" && (
                  <div className="mt-7 border-t border-border pt-6">
                    <div className="mb-5 flex items-start gap-3 border border-amber-200 bg-amber-50 p-4">
                      <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                      <div>
                        <p className="font-semibold text-amber-950">Entrega a combinar pelo WhatsApp</p>
                        <p className="mt-1 text-sm text-amber-800">Este bairro não está na rota de motoboy. Envie o pedido para confirmarmos outra forma de entrega.</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-4 text-sm">
                          <span className="min-w-0 truncate">{item.quantity}x {item.name}</span>
                          <span className="shrink-0 font-semibold">{formatCurrency(item.price * item.quantity)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="my-5 flex items-center justify-between border-t border-border pt-4">
                      <span className="font-medium">Total dos produtos</span>
                      <span className="text-2xl font-bold text-primary">{formatCurrency(subtotal)}</span>
                    </div>
                    <Button
                      type="button"
                      size="lg"
                      className="w-full bg-emerald-600 text-base text-white hover:bg-emerald-700"
                      disabled={fastWhatsappOpening}
                      onClick={() => { void handleFastWhatsApp(); }}
                    >
                      {fastWhatsappOpening ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <MessageCircle className="mr-2 h-5 w-5" />}
                      Finalizar via WhatsApp
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
          <>
          {/* Left Column */}
          <div className="lg:col-span-7 space-y-8">

            {/* Personal Data */}
            <div className="bg-card p-6 rounded-2xl shadow-sm border border-border/50">
              <h2 className="text-2xl font-bold mb-6">Dados do Comprador</h2>
              <form id="checkout-form" onSubmit={handleSubmit(handlePixPayment)} className="space-y-4">
                <Input
                  label="Nome Completo *"
                  placeholder="João da Silva"
                  {...register("name")}
                  error={errors.name?.message}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="E-mail *"
                    type="email"
                    placeholder="joao@exemplo.com"
                    {...register("email")}
                    error={errors.email?.message}
                  />
                  <div className="w-full space-y-1.5">
                    <label className="text-sm font-medium text-foreground ml-1">Telefone (WhatsApp) *</label>
                    <input
                      type="tel"
                      value={phoneDisplay}
                      onChange={handlePhoneChange}
                      placeholder="(11) 99999-9999"
                      className={`flex h-12 w-full rounded-xl border-2 border-border bg-white px-4 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/10 transition-all duration-200 ${errors.phone ? "border-destructive" : ""}`}
                    />
                    {errors.phone && <p className="text-sm text-destructive ml-1">{errors.phone.message}</p>}
                  </div>
                </div>
                <div className="w-full space-y-1.5">
                  <label className="text-sm font-medium text-foreground ml-1">CPF *</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={cpfDisplay}
                    onChange={handleCPFChange}
                    placeholder="000.000.000-00"
                    className={`flex h-12 w-full rounded-xl border-2 border-border bg-white px-4 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/10 transition-all duration-200 ${errors.document ? "border-destructive" : ""}`}
                  />
                  {errors.document && <p className="text-sm text-destructive ml-1">{errors.document.message}</p>}
                </div>
              </form>
            </div>

            {/* Address */}
            <div className="bg-card p-6 rounded-2xl shadow-sm border border-border/50">
              <div className="flex items-center gap-2 mb-6">
                <MapPin className="w-5 h-5 text-primary" />
                <h2 className="text-2xl font-bold">Endereço de Entrega</h2>
              </div>
              <div className="space-y-4">
                {/* CEP */}
                <div className="w-full space-y-1.5">
                  <label className="text-sm font-medium text-foreground ml-1">CEP *</label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={cepDisplay}
                      onChange={handleCEPChange}
                      placeholder="00000-000"
                      maxLength={9}
                      className={`flex h-12 w-full rounded-xl border-2 border-border bg-white px-4 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/10 transition-all duration-200 pr-10 ${errors.cep ? "border-destructive" : ""}`}
                    />
                    {cepLoading && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-primary animate-spin" />
                    )}
                  </div>
                  {errors.cep && <p className="text-sm text-destructive ml-1">{errors.cep.message}</p>}
                  <p className="text-xs text-muted-foreground ml-1">
                    Digite o CEP para preenchimento automático do endereço
                  </p>
                </div>

                {/* Street + Number */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <Input
                      label="Rua / Logradouro *"
                      placeholder="Rua das Flores"
                      {...register("street")}
                      error={errors.street?.message}
                    />
                  </div>
                  <Input
                    label="Número *"
                    placeholder="123"
                    {...register("number")}
                    error={errors.number?.message}
                  />
                </div>

                {/* Complement + Neighborhood */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Complemento"
                    placeholder="Apto 12, Bloco B"
                    {...register("complement")}
                  />
                  <Input
                    label="Bairro *"
                    placeholder="Centro"
                    {...register("neighborhood")}
                    error={errors.neighborhood?.message}
                  />
                </div>

                {/* City + State */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <Input
                      label="Cidade *"
                      placeholder="São Paulo"
                      {...register("city")}
                      error={errors.city?.message}
                    />
                  </div>
                  <div className="w-full space-y-1.5">
                    <label className="text-sm font-medium text-foreground ml-1">Estado *</label>
                    <select
                      {...register("state")}
                      className={`flex h-12 w-full rounded-xl border-2 border-border bg-white px-3 py-2 text-base focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/10 transition-all duration-200 cursor-pointer ${errors.state ? "border-destructive" : ""}`}
                    >
                      <option value="">UF</option>
                      {["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map(uf => (
                        <option key={uf} value={uf}>{uf}</option>
                      ))}
                    </select>
                    {errors.state && <p className="text-sm text-destructive ml-1">{errors.state.message}</p>}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Order Bumps ── */}
            {checkoutBumps.length > 0 && (
              <div className="rounded-2xl overflow-hidden border border-amber-200 shadow-sm">
                {/* Header */}
                <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-4 py-3 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400 fill-amber-400 flex-shrink-0" />
                  <span className="text-white font-bold text-sm tracking-wide">Ofertas Exclusivas para Você</span>
                </div>

                <div className="bg-white divide-y divide-amber-100">
                  {checkoutOffers.map(({ bump, triggerItem, offerProduct }) => {
                    const cartItem = triggerItem;
                    const effectivePrice = offerProduct.price;
                    const unit = bump.unit || "unidade";
                    const bumpCartId = `bump_${bump.id}`;
                    const alreadyApplied = items.some((i) => i.id === bumpCartId);
                    const cartQty = cartItem.quantity ?? 1;
                    const cartCost = cartItem.price * cartQty;
                    const regularPrice = offerProduct.price;
                    const originalPrice = regularPrice;
                    const bumpImage = bump.image ?? offerProduct.image ?? undefined;
                    const discountedUnitPrice = (() => {
                      if (bump.discountType === "percent") {
                        return Math.max(0, effectivePrice * (1 - (bump.discountValue ?? 0) / 100));
                      }
                      if (bump.discountType === "fixed") {
                        return Math.max(0, effectivePrice - (bump.discountValue ?? 0));
                      }
                      if (bump.discountType === "buy_x_get_y") {
                        const bQ = bump.buyQuantity ?? 1;
                        const gQ = bump.getQuantity ?? 2;
                        return Math.max(0, (effectivePrice * bQ) / gQ);
                      }
                      return effectivePrice;
                    })();
                    const bumpProduct = { id: offerProduct.id, name: offerProduct.name, price: originalPrice, image: bumpImage };

                    function getBumpBadge(): string {
                      if (bump.discountType === "percent")       return `-${bump.discountValue ?? 0}%`;
                      if (bump.discountType === "fixed")         return `-${formatCurrency(bump.discountValue ?? 0)}`;
                      if (bump.discountType === "buy_x_get_y")  return `Leve ${bump.getQuantity ?? 2} por ${bump.buyQuantity ?? 1}`;
                      return "";
                    }

                    function handleApply(overridePrice?: number, overrideQty?: number) {
                      let price = overridePrice ?? 0;
                      let qty = overrideQty ?? 1;
                      if (overridePrice === undefined) {
                        if (bump.discountType === "percent") {
                          price = Math.max(0, effectivePrice * (1 - (bump.discountValue ?? 0) / 100));
                        } else if (bump.discountType === "fixed") {
                          price = Math.max(0, effectivePrice - (bump.discountValue ?? 0));
                        } else if (bump.discountType === "buy_x_get_y") {
                          const bQ = bump.buyQuantity ?? 1;
                          const gQ = bump.getQuantity ?? 2;
                          price = Math.max(0, (effectivePrice * bQ) / gQ);
                          qty = gQ;
                        } else if (bump.discountType === "quantity_tiers" && bump.tiers?.length) {
                          const firstTier = bump.tiers[0];
                          const extraQty = Math.max(1, firstTier.qty - cartQty);
                          price = Math.max(0, firstTier.price / extraQty);
                          qty = extraQty;
                        }
                      }
                      addBumpItem(bump.id, cartItem.id, bumpProduct, price, qty);
                      toast.success("Oferta adicionada!");
                    }

                    function handleRemove() {
                      removeItem(bumpCartId);
                      toast("Oferta removida.");
                    }

                    return (
                      <div key={bump.id} className="p-4">
                        {/* Title row — only for non-tier bumps */}
                        {bump.discountType !== "quantity_tiers" && (
                          <div className="flex gap-3 mb-3">
                            {bumpImage ? (
                              <img src={bumpImage} alt={offerProduct.name} className="w-14 h-14 rounded-xl object-cover border border-amber-100 flex-shrink-0" />
                            ) : (
                              <div className="w-14 h-14 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center flex-shrink-0">
                                <Zap className="w-6 h-6 text-amber-400" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-sm text-gray-900 leading-tight">{bump.cardTitle || bump.title}</p>
                              <p className="text-xs text-emerald-700 mt-0.5 font-medium">{offerProduct.name}</p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className="text-xs text-gray-400 line-through">
                                  {formatCurrency(regularPrice)}
                                </span>
                                <span className="text-sm font-bold text-emerald-700">
                                  {formatCurrency(discountedUnitPrice)}
                                </span>
                                {bump.discountType === "buy_x_get_y" && (
                                  <span className="text-[11px] font-medium text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                                    {bump.buyQuantity ?? 1} por {bump.getQuantity ?? 2}
                                  </span>
                                )}
                              </div>
                              {bump.description && <p className="text-xs mt-0.5 line-clamp-2 text-gray-500">{bump.description}</p>}
                              {getBumpBadge() && (
                                <span className="inline-flex items-center gap-1 mt-1.5 text-[11px] bg-rose-500 text-white px-2.5 py-0.5 rounded-full font-bold">
                                  <Zap className="w-2.5 h-2.5" />{getBumpBadge()}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Tier cards */}
                        {bump.discountType === "quantity_tiers" && bump.tiers && bump.tiers.length > 0 ? (
                          <>
                            {bump.cardTitle || bump.title ? (
                              <p className="font-bold text-sm text-gray-900 mb-2">{bump.cardTitle || bump.title}</p>
                            ) : null}
                            {bump.description && <p className="text-xs text-gray-500 mb-3">{bump.description}</p>}
                            <div className="space-y-2">
                              {bump.tiers.map((tier, ti) => {
                                // Always base from 1 main unit — we restructure cart when applying
                                const baseExtra = Math.max(1, tier.qty - 1);
                                const pricePerExtraUnit = tier.price / baseExtra;
                                // Offer total uses effectivePrice (actual sale price) to match cart subtotal
                                const offerTotal = effectivePrice + tier.price;
                                // Average price per unit = subtotal / qty (what user sees in cart)
                                const avgPricePerUnit = offerTotal / tier.qty;
                                // Savings vs original (non-sale) price × qty
                                const regularTierTotal = regularPrice * tier.qty;
                                const savings = regularTierTotal - offerTotal;

                                let discountBadge: string | null = null;
                                if (bump.discountTagType === "percent" && savings > 0) {
                                  discountBadge = `-${Math.round((savings / regularTierTotal) * 100)}%`;
                                } else if (bump.discountTagType === "fixed" && savings > 0) {
                                  discountBadge = `-${formatCurrency(savings)}`;
                                }

                                const tierImage = tier.image || bump.image || offerProduct.image;
                                const isThisTierApplied = alreadyApplied && (() => {
                                  const applied = items.find((i) => i.id === bumpCartId);
                                  if (!applied) return false;
                                  const appliedQty = (applied as { quantity?: number }).quantity ?? 0;
                                  return appliedQty === baseExtra;
                                })();

                                return (
                                  <button key={ti}
                                    disabled={alreadyApplied}
                                    onClick={() => {
                                      if (alreadyApplied) return;
                                      // Always restructure: set main item to qty 1, add bump for extras
                                      if (cartQty > 1) updateQuantity(cartItem.id, 1);
                                      addBumpItem(bump.id, cartItem.id, bumpProduct, pricePerExtraUnit, baseExtra);
                                      toast.success("Oferta adicionada!");
                                    }}
                                    className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                                      alreadyApplied
                                        ? isThisTierApplied
                                          ? "border-green-400 bg-green-50 cursor-default"
                                          : "border-gray-100 bg-gray-50 opacity-40 cursor-default"
                                        : "border-amber-200 bg-white hover:border-amber-400 hover:shadow-md active:scale-[.99] cursor-pointer"
                                    }`}>
                                    {/* Image with badge */}
                                    <div className="relative flex-shrink-0">
                                      {tierImage ? (
                                        <img src={tierImage} alt={`${tier.qty} ${unit}`} className="w-14 h-14 rounded-lg object-cover" />
                                      ) : (
                                        <div className="w-14 h-14 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center">
                                          <Zap className="w-6 h-6 text-amber-400" />
                                        </div>
                                      )}
                                      {discountBadge && !alreadyApplied && (
                                        <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap">
                                          {discountBadge}
                                        </span>
                                      )}
                                    </div>
                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                      <p className="font-bold text-sm text-gray-900 leading-tight">
                                        {tier.qty} {pluralizeUnit(unit, tier.qty)} POR
                                      </p>
                                      <p className="text-xs text-gray-400 mt-0.5">
                                        cada {unit} sai por {formatCurrency(avgPricePerUnit)}
                                      </p>
                                    </div>
                                    {/* Total price */}
                                    <div className="text-right flex-shrink-0">
                                      {isThisTierApplied ? (
                                        <span className="text-green-600 font-bold text-sm">✓ Aplicado</span>
                                      ) : (
                                        <>
                                          <p className="font-extrabold text-base text-primary leading-tight">{formatCurrency(offerTotal)}</p>
                                          <p className="text-[10px] text-gray-400 mt-0.5">pedido completo</p>
                                        </>
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </>
                        ) : bump.discountType !== "quantity_tiers" ? (
                          !alreadyApplied ? (
                            <button onClick={() => handleApply()}
                              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 active:scale-[.99] text-white font-bold text-sm px-4 py-3 rounded-xl transition-all">
                              <Zap className="w-4 h-4 fill-white" />
                              Sim! Quero aproveitar essa oferta
                            </button>
                          ) : null
                        ) : null}

                        {alreadyApplied && bump.discountType !== "quantity_tiers" && (
                          <div className="flex items-center gap-2 mt-2">
                            <div className="flex-1 flex items-center justify-center gap-2 bg-green-500 text-white font-bold text-sm px-4 py-3 rounded-xl">
                              ✓ Oferta aplicada!
                            </div>
                            <button onClick={handleRemove}
                              className="flex items-center justify-center gap-1 border border-red-300 text-red-500 hover:bg-red-50 text-xs font-semibold px-3 py-3 rounded-xl transition-all">
                              Remover
                            </button>
                          </div>
                        )}

                        {alreadyApplied && bump.discountType === "quantity_tiers" && (
                          <button onClick={handleRemove}
                            className="mt-2 w-full flex items-center justify-center gap-1 border border-red-200 text-red-400 hover:bg-red-50 text-xs font-semibold px-3 py-2 rounded-xl transition-all">
                            Remover oferta
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Shipping & Options */}
            <div className="bg-card p-6 rounded-2xl shadow-sm border border-border/50 space-y-6">
              <h2 className="text-2xl font-bold">Entrega e Opções</h2>

              {!isMotoboySelected && logisticsForecast && (
                <div className="bg-gradient-to-r from-orange-50 to-red-50 border border-orange-200 rounded-xl p-4 flex items-start gap-3">
                  <Clock className="w-5 h-5 text-orange-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-orange-900">
                      Postagem em até {logisticsForecast.promisedHours} horas
                    </p>
                    <p className="text-sm text-orange-800 mt-1">
                      Restam <span className="font-bold">{logisticsForecast.availableSlots} de {logisticsForecast.capacity} vagas</span> neste prazo. Finalize sua compra para aproveitar.
                    </p>
                    <p className="text-xs text-orange-700 mt-1.5">
                      A vaga é confirmada após a aprovação do pagamento. O prazo de transporte começa depois da postagem.
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-foreground mb-3 block">Tipo de Frete</label>
                {shippingLoading ? (
                  <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Carregando opções de frete...
                  </div>
                ) : availableShippingOptions.length === 0 ? (
                  <div className="py-4 text-muted-foreground text-sm text-center rounded-xl border-2 border-border">
                    Nenhuma opção de frete disponível no momento.
                  </div>
                ) : (
                  <div className={`grid grid-cols-1 ${availableShippingOptions.length > 1 ? "sm:grid-cols-2" : ""} gap-4`}>
                    {availableShippingOptions.map((opt) => (
                      <div
                        key={opt.id}
                        onClick={() => setSelectedShippingId(opt.id)}
                        className={`cursor-pointer p-4 rounded-xl border-2 transition-all flex items-start gap-4 ${selectedShippingId === opt.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
                      >
                        <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${selectedShippingId === opt.id ? "border-primary" : "border-muted-foreground"}`}>
                          {selectedShippingId === opt.id && <div className="w-2.5 h-2.5 bg-primary rounded-full" />}
                        </div>
                        <div>
                          <p className="font-bold text-foreground flex items-center gap-2">
                            {opt.id.startsWith("motoboy_") ? <Bike className="w-4 h-4" /> : <Truck className="w-4 h-4" />}
                            {opt.name}
                          </p>
                          {opt.description && (
                            <p className="text-sm text-muted-foreground mt-1">{opt.description}</p>
                          )}
                          <p className="font-semibold text-primary mt-2">
                            {isFreeByMinimumSubtotal || Number(opt.price) <= 0
                              ? "Gratis"
                              : formatCurrency(Number(opt.price))}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {isMotoboySelected && (
                  <div className="mt-4 border border-emerald-200 bg-emerald-50/70 rounded-xl p-4 space-y-4">
                    <div className="flex items-start gap-3">
                      <CalendarDays className="w-5 h-5 text-emerald-700 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-semibold text-emerald-950">Agende a entrega</p>
                        <p className="text-sm text-emerald-800 mt-0.5">
                          Entregas a partir das 10h. Este bairro ocupa um intervalo de {motoboyDurationHours}h.
                        </p>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="motoboy-delivery-date" className="text-sm font-medium text-foreground mb-1.5 block">
                        Data da entrega
                      </label>
                      <Input
                        id="motoboy-delivery-date"
                        type="date"
                        min={getMotoboyCalendarMinDate()}
                        value={motoboyDeliveryDate}
                        onChange={(event) => setMotoboyDeliveryDate(event.target.value)}
                        className="bg-white"
                      />
                    </div>

                    {motoboyDeliveryDate && (
                      <div>
                        <p className="text-sm font-medium text-foreground mb-2">Horário disponível</p>
                        {motoboySlotsLoading ? (
                          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                            <Loader2 className="w-4 h-4 animate-spin" /> Consultando agenda...
                          </div>
                        ) : motoboyAvailableSlots.length === 0 ? (
                          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                            {isSunday(motoboyDeliveryDate)
                              ? "Não realizamos entregas por motoboy aos domingos. Selecione outro dia."
                              : "Não há horários disponíveis nesta data. Selecione outro dia."}
                          </p>
                        ) : (
                          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                            {motoboyAvailableSlots.map((slot) => (
                              <button
                                key={slot}
                                type="button"
                                onClick={() => setMotoboyDeliveryTime(slot)}
                                className={`h-10 rounded-lg border text-sm font-semibold transition-colors ${motoboyDeliveryTime === slot ? "border-emerald-700 bg-emerald-700 text-white" : "border-emerald-200 bg-white text-emerald-900 hover:border-emerald-500"}`}
                              >
                                {slot}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {activeFreeShippingMin != null && (
                  <div className={`mt-3 rounded-xl border px-3 py-3 ${isFreeShippingEligible ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Truck className={`w-3.5 h-3.5 shrink-0 ${isFreeShippingEligible ? "text-emerald-700" : "text-amber-700"}`} />
                      <p className={`text-xs font-semibold ${isFreeShippingEligible ? "text-emerald-800" : "text-amber-800"}`}>
                        {isFreeShippingEligible
                          ? "Frete grátis desbloqueado!"
                          : `Faltam ${formatCurrency(missingForFreeShipping)} para frete grátis`}
                      </p>
                    </div>
                    <div className="w-full h-2 rounded-full bg-black/10 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${isFreeShippingEligible ? "bg-emerald-500" : "bg-amber-500"}`}
                        style={{ width: `${freeShippingProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Insurance */}
              <CheckoutInsuranceOffer
                enabled={insuranceSettings.enabled}
                settings={insuranceSettings}
                selectedPlan={insuranceSnapshot.plan}
                onSelect={setInsurancePlan}
                isLoggedIn={!!getCustomerToken()}
                fullOffer={insuranceSettings.enabled && insuranceSettings.fullEnabled ? {
                  plan: "full",
                  amount: fullInsuranceQuote.insuranceAmount,
                  cashbackAmount: fullInsuranceQuote.cashbackAmount,
                  productSubtotal: subtotal,
                  label: insuranceSettings.fullLabel,
                  description: insuranceSettings.fullDescription,
                } : null}
                reducedOffer={insuranceSettings.enabled && insuranceSettings.reducedEnabled ? {
                  plan: "reduced",
                  amount: resolveCheckoutInsurance({
                    includeInsurance: true,
                    insurancePlan: "reduced",
                    subtotal,
                    shippingCost: 0,
                    lines: insuranceLines,
                    settings: { ...insuranceSettings, fullEnabled: false, reducedEnabled: true, enabled: true },
                  }).insuranceAmount,
                  label: insuranceSettings.reducedLabel,
                  description: insuranceSettings.reducedDescription,
                } : null}
              />
            </div>
          </div>

          {/* Right Column: Summary */}
          <div className="lg:col-span-5">
            <div className="bg-card p-6 rounded-2xl shadow-xl shadow-primary/5 border border-primary/10 sticky top-28">
              <h2 className="text-xl font-bold mb-6">Resumo do Pedido</h2>

              <div className="space-y-4 mb-6 max-h-72 overflow-y-auto pr-2">
                {items.filter((item) => !(item as { isBump?: boolean }).isBump).map((item) => {
                  const bumpItems = items.filter(
                    (i) => !!(i as { isBump?: boolean }).isBump &&
                      (i as { bumpForProductId?: string }).bumpForProductId === item.id
                  ) as Array<{ quantity: number; price: number; id: string; name: string; image?: string }>;
                  const mainTotal = item.price * item.quantity;
                  return (
                    <div key={item.id} className="space-y-2 rounded-xl p-2">
                      <div className="flex gap-3 items-start">
                        <div className="w-12 h-12 rounded-lg bg-muted overflow-hidden shrink-0 border border-border">
                          <img src={(item as typeof item & { image?: string }).image} alt={item.name} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold line-clamp-1 leading-tight">{item.name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <button
                              type="button"
                              onClick={() => handleQtyDecrease(item)}
                              className="w-5 h-5 flex items-center justify-center rounded border border-border bg-white hover:bg-muted transition-colors text-foreground"
                            >
                              <Minus className="w-2.5 h-2.5" />
                            </button>
                            <span className="text-xs font-semibold w-4 text-center">{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => handleQtyIncrease(item)}
                              className="w-5 h-5 flex items-center justify-center rounded border border-border bg-white hover:bg-muted transition-colors text-foreground"
                            >
                              <Plus className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 shrink-0">
                          <p className="font-semibold text-sm">{formatCurrency(mainTotal)}</p>
                        </div>
                      </div>

                      {bumpItems.map((bumpItem) => (
                        <div key={bumpItem.id} className="ml-12 rounded-xl border border-emerald-200 bg-emerald-50/70 p-2.5">
                          <div className="flex gap-2.5 items-start">
                            <div className="w-10 h-10 rounded-lg bg-white overflow-hidden shrink-0 border border-emerald-100">
                              <img
                                src={bumpItem.image ?? (item as typeof item & { image?: string }).image}
                                alt={bumpItem.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                                  Oferta adicionada
                                </span>
                                <span className="text-[10px] font-medium text-emerald-700">
                                  Order bump
                                </span>
                              </div>
                              <p className="text-xs font-semibold line-clamp-1 leading-tight text-emerald-950">
                                {bumpItem.name}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (bumpItem.quantity <= 1) {
                                      removeItem(bumpItem.id);
                                      return;
                                    }
                                    updateQuantity(bumpItem.id, bumpItem.quantity - 1);
                                  }}
                                  className="w-5 h-5 flex items-center justify-center rounded border border-emerald-200 bg-white hover:bg-emerald-100 transition-colors text-emerald-700"
                                >
                                  <Minus className="w-2.5 h-2.5" />
                                </button>
                                <span className="text-xs font-semibold w-4 text-center text-emerald-900">
                                  {bumpItem.quantity}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => updateQuantity(bumpItem.id, bumpItem.quantity + 1)}
                                  className="w-5 h-5 flex items-center justify-center rounded border border-emerald-200 bg-white hover:bg-emerald-100 transition-colors text-emerald-700"
                                >
                                  <Plus className="w-2.5 h-2.5" />
                                </button>
                                <p className="text-[11px] text-emerald-700 ml-1">
                                  {formatCurrency(bumpItem.price)} cada
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeItem(bumpItem.id)}
                              className="text-[10px] text-muted-foreground underline hover:text-destructive ml-1 transition-colors shrink-0"
                            >
                              remover
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              {shouldBlockLanderGoldOnlyCheckout && (
                <div className="mb-4 rounded-xl border border-red-200 bg-gradient-to-r from-red-50 to-rose-50 p-3.5">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-red-800">Pedido Lander Gold: minimo de 5 pecas</p>
                      <p className="text-xs text-red-700 mt-1 leading-relaxed">
                        Para comprar somente Lander Gold, o minimo e de {LANDER_GOLD_MIN_QTY} pecas.
                        Faltam {missingLanderGoldQty} {missingLanderGoldQty === 1 ? "peca" : "pecas"}.
                        Se preferir, adicione qualquer produto de outra marca e o checkout sera liberado.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 border-red-300 text-red-700 hover:bg-red-100"
                        onClick={() => setLocation(sellerHomeHref)}
                      >
                        Voltar ao catalogo
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {activeFreeShippingMin != null && (
                <div className={`mb-4 rounded-xl border px-3 py-3 ${isFreeShippingEligible ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Truck className={`w-3.5 h-3.5 shrink-0 ${isFreeShippingEligible ? "text-emerald-700" : "text-amber-700"}`} />
                    <p className={`text-xs font-semibold ${isFreeShippingEligible ? "text-emerald-800" : "text-amber-800"}`}>
                      {isFreeShippingEligible
                        ? "Frete grátis desbloqueado!"
                        : `Faltam ${formatCurrency(missingForFreeShipping)} para frete grátis`}
                    </p>
                  </div>
                  <div className="w-full h-2 rounded-full bg-black/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${isFreeShippingEligible ? "bg-emerald-500" : "bg-amber-500"}`}
                      style={{ width: `${freeShippingProgress}%` }}
                    />
                  </div>
                  {!isFreeShippingEligible && (
                    <p className="text-[11px] text-amber-700 mt-1.5">
                      Pedidos a partir de {formatCurrency(activeFreeShippingMin)} têm frete grátis automático.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-3 py-4 border-t border-border mb-4">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Frete ({selectedShipping?.name ?? "—"})</span>
                  <span>{formatCurrency(shippingCost)}</span>
                </div>
                {shippingSavings > 0 && (
                  <div className="flex justify-between text-emerald-700 font-semibold">
                    <span>Economia no frete</span>
                    <span>− {formatCurrency(shippingSavings)}</span>
                  </div>
                )}
                {includeInsurance && (
                  <div className="flex justify-between text-primary font-medium">
                    <span>Seguro de Envio</span>
                    <span>{formatCurrency(insuranceAmount)}</span>
                  </div>
                )}
                {useStoreCredit && storeCreditToApply > 0 && (
                  <div className="flex justify-between text-blue-700 font-medium">
                    <span>Saldo da carteira</span>
                    <span>− {formatCurrency(storeCreditToApply)}</span>
                  </div>
                )}
                {appliedCoupon && (
                  <div className="flex justify-between text-green-700 font-semibold">
                    <span className="flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5" />
                      Cupom {appliedCoupon.code}
                    </span>
                    <span>− {formatCurrency(discountAmount)}</span>
                  </div>
                )}
                {useAffiliateCredit && affiliateCreditToApply > 0 && (
                  <div className="flex justify-between text-blue-700 font-semibold">
                    <span>Saldo de comissão aplicado</span>
                    <span>− {formatCurrency(affiliateCreditToApply)}</span>
                  </div>
                )}
              </div>

              {/* Coupon field — hidden if bump is applied */}
              {!items.some((i) => (i as { isBump?: boolean }).isBump === true) && (
              <div className="mb-4 pb-4 border-b border-border">
                {appliedCoupon ? (
                  <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2 text-green-800">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <div>
                        <p className="text-sm font-bold">{appliedCoupon.code}</p>
                        <p className="text-xs">
                          {appliedCoupon.discountType === "percent"
                            ? `${appliedCoupon.discountValue}% de desconto`
                            : `${formatCurrency(discountAmount)} aplicado`}
                        </p>
                        {appliedCoupon.discountType === "fixed" && discountAmount < appliedCoupon.discountValue && (
                          <p className="text-[11px] text-green-700/80">
                            Limitado ao valor dos produtos elegíveis ({formatCurrency(eligibleProductSubtotal)}).
                          </p>
                        )}
                      </div>
                    </div>
                    <button type="button" onClick={removeCoupon} className="text-green-600 hover:text-red-500 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="text"
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyCoupon())}
                        placeholder="Cupom de desconto"
                        className="w-full h-10 pl-9 pr-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm font-mono tracking-wide uppercase"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={applyCoupon}
                      disabled={couponLoading || !couponInput.trim()}
                      className="px-4 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center gap-1.5 shrink-0"
                    >
                      {couponLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      Aplicar
                    </button>
                  </div>
                )}
              </div>
              )}

              {getCustomerToken() && storeCreditAvailable > 0 && (
                <div className="mb-4 pb-4 border-b border-border">
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <span className="text-sm font-medium text-foreground">Usar saldo da carteira</span>
                    <input
                      type="checkbox"
                      checked={useStoreCredit}
                      onChange={(e) => setUseStoreCredit(e.target.checked)}
                      className="w-4 h-4"
                    />
                  </label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Saldo de seguro: {formatCurrency(storeCreditAvailable)}
                  </p>
                  {useStoreCredit && storeCreditToApply > 0 && (
                    <p className="text-xs text-blue-700 mt-1">
                      Será abatido {formatCurrency(storeCreditToApply)} neste pedido.
                    </p>
                  )}
                </div>
              )}

              {getCustomerToken() && (
                <div className="mb-4 pb-4 border-b border-border">
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <span className="text-sm font-medium text-foreground">Usar saldo de comissão</span>
                    <input
                      type="checkbox"
                      checked={useAffiliateCredit}
                      onChange={(e) => setUseAffiliateCredit(e.target.checked)}
                      disabled={affiliateCreditLoading || affiliateCreditAvailable <= 0}
                      className="w-4 h-4"
                    />
                  </label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Saldo disponível: {affiliateCreditLoading ? "carregando..." : formatCurrency(affiliateCreditAvailable)}
                  </p>
                  {useAffiliateCredit && affiliateCreditToApply > 0 && (
                    <p className="text-xs text-blue-700 mt-1">
                      Será aplicado {formatCurrency(affiliateCreditToApply)} neste pedido.
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-end justify-between mb-2">
                <span className="text-lg font-medium">Total</span>
                <div className="text-right">
                  {appliedCoupon && (
                    <p className="text-sm text-muted-foreground line-through">{formatCurrency(baseTotal)}</p>
                  )}
                  <span className="text-3xl font-bold text-primary">{formatCurrency(payableTotal)}</span>
                </div>
              </div>
              {(() => {
                const totalSavings = items.reduce((acc, item) => {
                  const reg = (item as { regularPrice?: number }).regularPrice ?? item.price;
                  return acc + Math.max(0, reg - item.price) * item.quantity;
                }, 0);
                if (totalSavings <= 0) return null;
                return (
                  <div className="flex items-center justify-end gap-1.5 mb-5">
                    <span className="inline-flex items-center gap-1.5 bg-green-50 border border-green-200 text-green-700 font-semibold text-xs px-3 py-1.5 rounded-full">
                      🎉 Você economizou {formatCurrency(totalSavings)} nessa compra!
                    </span>
                  </div>
                );
              })()}

              <div className="space-y-3">
                {paymentMethods.pix && (
                  <Button
                    type="submit"
                    form="checkout-form"
                    size="lg"
                    className="w-full text-lg bg-green-600 hover:bg-green-700 border-none shadow-lg shadow-green-500/20"
                    disabled={isLoading || shouldBlockLanderGoldOnlyCheckout}
                  >
                    {isLoading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Gerando PIX...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <QrCode className="w-5 h-5" />
                        Pagar com PIX
                      </span>
                    )}
                  </Button>
                )}

                {paymentMethods.card && (
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full text-lg border-2 hover:bg-gray-50"
                    onClick={handleCardPayment}
                    disabled={shouldBlockLanderGoldOnlyCheckout}
                  >
                    <CreditCard className="w-5 h-5 mr-2" />
                    Pagar com Cartão
                  </Button>
                )}

                {paymentMethods.whatsapp && (
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full text-lg border-2 border-emerald-500 text-emerald-700 hover:bg-emerald-50"
                    onClick={handleWhatsAppCheckout}
                    disabled={isLoading || shouldBlockLanderGoldOnlyCheckout}
                  >
                    <MessageCircle className="w-5 h-5 mr-2" />
                    Finalizar via WhatsApp
                  </Button>
                )}

                {!paymentMethods.pix && !paymentMethods.card && !paymentMethods.whatsapp && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    No momento, os pagamentos estão temporariamente desativados. Tente novamente em instantes.
                  </div>
                )}
              </div>
            </div>
          </div>
          </>
          )}
        </div>
      </div>

      {/* Card Payment Modal */}
      <AnimatePresence>
        {showCardModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => cardModalStep !== "kyc_link" ? setShowCardModal(false) : undefined}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-card w-full max-w-lg rounded-3xl shadow-2xl relative z-10 overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              {/* Header */}
              <div className={`p-6 text-white text-center ${
                cardModalStep === "card_pricing" ? "bg-orange-600"
                : cardModalStep === "kyc_notice" ? "bg-amber-600"
                : cardModalStep === "kyc_link" ? "bg-green-600"
                : (cardModalStep === "installments" && kycVerified) ? "bg-green-600"
                : "bg-primary"
              }`}>
                {cardModalStep === "card_pricing" && <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-80" />}
                {cardModalStep === "kyc_notice" && <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-80" />}
                {cardModalStep === "installments" && !kycVerified && <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-80" />}
                {cardModalStep === "installments" && kycVerified && <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-80" />}
                {cardModalStep === "kyc_link" && <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-80" />}
                <h3 className="text-xl font-bold">
                  {cardModalStep === "card_pricing" && "Valor para Pagamento no Cartão"}
                  {cardModalStep === "kyc_notice" && "Verificação KYC Obrigatória"}
                  {cardModalStep === "installments" && !kycVerified && "Pagamento no Cartão"}
                  {cardModalStep === "installments" && kycVerified && "Cliente Reconhecido!"}
                  {cardModalStep === "kyc_link" && "Pedido Registrado!"}
                </h3>
                <p className="text-white/80 mt-1 text-sm">
                  {cardModalStep === "card_pricing" && "Confira o resumo antes de continuar"}
                  {cardModalStep === "kyc_notice" && "Leia com atenção antes de prosseguir"}
                  {cardModalStep === "installments" && !kycVerified && "Simule o parcelamento e finalize via WhatsApp"}
                  {cardModalStep === "installments" && kycVerified && "KYC verificado — pode prosseguir diretamente"}
                  {cardModalStep === "kyc_link" && !kycVerified && "Agora complete o KYC para finalizar sua compra"}
                  {cardModalStep === "kyc_link" && kycVerified && "A vendedora entrará em contato pelo WhatsApp"}
                </p>
              </div>

              <div className="p-6 space-y-5">
                {/* Step 0: Card Pricing */}
                {cardModalStep === "card_pricing" && (
                  <>
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                      <p className="text-sm font-bold text-orange-800 mb-1">⚠️ Preço promocional exclusivo do PIX</p>
                      <p className="text-sm text-orange-700 leading-relaxed">
                        O valor com desconto exibido na loja é válido <strong>apenas para pagamentos via PIX</strong>.
                        Para compras no cartão de crédito, é aplicado o preço original dos produtos conforme abaixo.
                      </p>
                    </div>

                    <div className="bg-muted/40 rounded-xl p-4 space-y-3">
                      <p className="text-sm font-semibold text-foreground mb-2">Resumo do seu pedido no cartão:</p>

                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Produtos (preço sem promo)</span>
                        <span className="font-medium">{formatCurrency(cardSubtotal)}</span>
                      </div>

                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          Frete{selectedShipping ? ` — ${selectedShipping.name}` : ""}
                        </span>
                        <span className="font-medium">{formatCurrency(shippingCost)}</span>
                      </div>

                      {shippingSavings > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-emerald-700">Economia no frete</span>
                          <span className="font-medium text-emerald-700">-{formatCurrency(shippingSavings)}</span>
                        </div>
                      )}

                      {includeInsurance && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Seguro de Envio</span>
                          <span className="font-medium">+{formatCurrency(cardInsuranceAmount)}</span>
                        </div>
                      )}

                      {cardDiscountAmount > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            Desconto{appliedCoupon?.code ? ` (${appliedCoupon.code})` : ""}
                          </span>
                          <span className="font-medium text-green-700">-{formatCurrency(cardDiscountAmount)}</span>
                        </div>
                      )}

                      <div className="border-t border-border pt-3 flex justify-between">
                        <span className="font-bold text-foreground">Total no cartão</span>
                        <span className="font-bold text-lg text-primary">{formatCurrency(cardNetTotal)}</span>
                      </div>

                      <p className="text-xs text-muted-foreground text-center">
                        * Taxa de parcelamento: +R$100,00 para até 3x
                      </p>
                    </div>

                    <Button
                      className="w-full gap-2"
                      onClick={() => setCardModalStep(kycVerified ? "installments" : "kyc_notice")}
                    >
                      <CreditCard className="w-4 h-4" />
                      Entendi, quero prosseguir no cartão
                    </Button>
                    <Button variant="ghost" className="w-full text-sm text-muted-foreground h-8" onClick={() => setShowCardModal(false)}>
                      Cancelar
                    </Button>
                  </>
                )}

                {/* Step 1: KYC Notice */}
                {cardModalStep === "kyc_notice" && (
                  <>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <p className="text-sm font-bold text-amber-800 mb-2">⚠️ O que é o KYC?</p>
                      <p className="text-sm text-amber-700 leading-relaxed">
                        Para compras no cartão de crédito, exigimos a verificação de identidade (KYC) como
                        medida de segurança contra fraudes. É um processo simples e rápido.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-foreground">Você precisará enviar:</p>
                      <div className="space-y-2">
                        {[
                          { icon: Camera, label: "Selfie segurando o RG", desc: "Foto sua com o documento visível" },
                          { icon: IdCard, label: "Frente do RG", desc: "Foto clara do seu RG ou CNH" },
                          { icon: FileText, label: "Declaração de Titular", desc: "Assinatura digital confirming a compra" },
                        ].map(({ icon: Icon, label, desc }) => (
                          <div key={label} className="flex items-center gap-3 p-3 bg-muted/40 rounded-xl">
                            <Icon className="w-5 h-5 text-primary shrink-0" />
                            <div>
                              <p className="text-sm font-medium">{label}</p>
                              <p className="text-xs text-muted-foreground">{desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Button
                        variant="outline"
                        className="gap-1.5 text-sm border-primary text-primary hover:bg-primary/5"
                        onClick={() => window.open(`${BASE}/kyc`, "_blank")}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Saiba mais
                      </Button>
                      <Button className="gap-1.5" onClick={() => setCardModalStep("installments")}>
                        <CreditCard className="w-3.5 h-3.5" />
                        Continuar
                      </Button>
                    </div>
                    <Button variant="ghost" className="w-full text-sm text-muted-foreground h-8" onClick={() => setShowCardModal(false)}>
                      Cancelar
                    </Button>
                  </>
                )}

                {/* Step 2: Installments */}
                {cardModalStep === "installments" && (
                  <>
                    {kycVerified && (
                      <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-bold text-green-800">KYC já verificado para este CPF</p>
                          <p className="text-xs text-green-700 mt-0.5">Seus documentos já foram aprovados anteriormente. Você pode prosseguir diretamente sem precisar enviar nada novamente.</p>
                        </div>
                      </div>
                    )}
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <p className="text-sm text-blue-900 font-semibold mb-1">Condições de parcelamento:</p>
                      <ul className="text-sm text-blue-800 space-y-1">
                        <li>• Parcelamentos em até <strong>3x</strong>: acréscimo de <strong>R$ 100,00</strong> no total</li>
                        <li>• Parcelamentos a partir de <strong>4x</strong>: necessário fazer a simulação</li>
                      </ul>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-foreground mb-3">
                        Escolha o número de parcelas:
                      </label>
                      <select
                        className="w-full h-14 px-4 rounded-xl border-2 border-border bg-white focus:border-primary focus:ring-4 focus:ring-primary/10 text-base font-medium outline-none transition-all cursor-pointer"
                        value={installments}
                        onChange={(e) => setInstallments(Number(e.target.value))}
                      >
                        {[...Array(12)].map((_, i) => {
                          const times = i + 1;
                          const label = times <= 3 ? `${times}x (+ R$ 100,00 de taxa)` : `${times}x`;
                          return <option key={times} value={times}>{label}</option>;
                        })}
                      </select>
                    </div>

                    <div className="bg-muted/40 rounded-xl p-4 text-sm text-muted-foreground text-center">
                      Os valores exatos serão apresentados pelo nosso atendimento via WhatsApp.
                    </div>

                    <div className="flex gap-3">
                      <Button variant="ghost" className="flex-1" onClick={() => setCardModalStep(kycVerified ? "card_pricing" : "kyc_notice")}>
                        ← Voltar
                      </Button>
                      <Button className="flex-1 gap-2" onClick={finalizeCardPayment}>
                        <MessageCircle className="w-4 h-4" />
                        Simular via WhatsApp
                      </Button>
                    </div>
                  </>
                )}

                {/* Step 3: KYC Link after order creation */}
                {cardModalStep === "kyc_link" && kycVerified && (
                  <>
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center space-y-1">
                      <p className="text-sm font-bold text-green-800">✅ Pedido #{kycOrderDisplay || kycOrderId} registrado!</p>
                      <p className="text-sm text-green-700 leading-relaxed">
                        Sua identidade já foi verificada. A vendedora vai entrar em contato pelo WhatsApp para concluir sua compra.
                      </p>
                    </div>

                    <Button
                      className="w-full gap-2 bg-green-600 hover:bg-green-700"
                      onClick={() => {
                        window.open(kycWhatsAppUrl, "_blank");
                        clearCart();
                        setShowCardModal(false);
                      }}
                    >
                      <MessageCircle className="w-4 h-4" />
                      Ir ao WhatsApp
                    </Button>
                  </>
                )}

                {cardModalStep === "kyc_link" && !kycVerified && (
                  <>
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                      <p className="text-sm font-bold text-green-800 mb-1">✅ Pedido #{kycOrderDisplay || kycOrderId} criado!</p>
                      <p className="text-sm text-green-700">
                        Agora você precisa completar o KYC para que seu pedido seja processado.
                      </p>
                    </div>

                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <p className="text-sm font-bold text-amber-800 mb-2">⚠️ KYC é obrigatório</p>
                      <p className="text-xs text-amber-700 leading-relaxed">
                        Sem o KYC concluído, seu pedido não será aprovado. Você pode fazer agora ou
                        acessar o link depois — mas precisa completar antes da aprovação.
                      </p>
                    </div>

                    <Button
                      className="w-full gap-2 bg-primary"
                      onClick={() => {
                        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                        const kycUrl = `${window.location.origin}${base}/kyc/${kycOrderId}`;
                        window.open(kycUrl, "_blank");
                      }}
                    >
                      <ShieldCheck className="w-4 h-4" />
                      Fazer KYC Agora
                    </Button>

                    <div className="text-center">
                      <p className="text-xs text-muted-foreground mb-1">Ou salve o link para fazer depois:</p>
                      <code className="text-xs bg-muted px-2 py-1 rounded break-all">
                        {`${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/kyc/${kycOrderId}`}
                      </code>
                    </div>

                    <Button
                      variant="outline"
                      className="w-full gap-2"
                      onClick={() => {
                        window.open(kycWhatsAppUrl, "_blank");
                        clearCart();
                        setShowCardModal(false);
                      }}
                    >
                      <MessageCircle className="w-4 h-4" />
                      Ir ao WhatsApp
                    </Button>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}

      {whatsappModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setWhatsappModalData(null)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-card w-full max-w-md rounded-3xl shadow-2xl relative z-10 p-8 text-center"
          >
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-600" />
            </div>
            
            <h2 className="text-2xl font-bold mb-2">Pedido #{whatsappModalData.displayNumber} criado!</h2>
            <p className="text-muted-foreground mb-6">
              Seu pedido foi criado com sucesso. Agora, clique no botão abaixo para solicitar a chave PIX ao vendedor.
            </p>

            <div className="space-y-3">
              <Button
                className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => {
                  setIsOpeningWhatsApp(true);
                  window.open(whatsappModalData.url, "_blank", "noopener,noreferrer");
                  setTimeout(() => {
                    setWhatsappModalData(null);
                    setIsOpeningWhatsApp(false);
                  }, 500);
                }}
                disabled={isOpeningWhatsApp}
              >
                <MessageCircle className="w-4 h-4" />
                {isOpeningWhatsApp ? "Abrindo..." : "Solicitar PIX no WhatsApp"}
              </Button>

              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setWhatsappModalData(null)}
                disabled={isOpeningWhatsApp}
              >
                Fechar
              </Button>
            </div>
          </motion.div>
        </div>
      )}
      </AnimatePresence>
    </CheckoutLayout>
  );
}
