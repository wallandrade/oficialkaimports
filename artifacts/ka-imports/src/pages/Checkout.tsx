import { useState, useCallback, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ShieldCheck, Truck, CreditCard, QrCode, ArrowLeft,
  MessageCircle, AlertTriangle, MapPin, Loader2, Tag, X, CheckCircle2, Zap, Minus, Plus, ExternalLink, Camera, IdCard, FileText
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
import { useCreateOrder } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ShippingOption {
  id: string; name: string; description: string | null; price: number;
  sortOrder: number; isActive: boolean;
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

function pluralizeUnit(unit: string, qty: number): string {
  if (qty <= 1) return unit;
  const map: Record<string, string> = {
    unidade: "unidades", caixa: "caixas", frasco: "frascos",
    ampola: "ampolas", caneta: "canetas", par: "pares", kit: "kits",
  };
  return map[unit] ?? unit + "s";
}

function formatCEP(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
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

export default function Checkout() {
  const [, setLocation] = useLocation();
  const { items, getSubtotal, getCardSubtotal, clearCart, addItem, addBumpItem, removeItem, updateQuantity, setIsOpen } = useCart();

  // Garante que o carrinho lateral não abre no checkout
  useEffect(() => { setIsOpen(false); }, [setIsOpen]);

  useLiveTracking("checkout");

  const [pendingCheck, setPendingCheck] = useState(() => !!sessionStorage.getItem("ka_pending_product"));
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
  const [shippingLoading, setShippingLoading] = useState(true);
  const [selectedShippingId, setSelectedShippingId] = useState<string | null>(null);
  const [includeInsurance, setIncludeInsurance] = useState(false);
  const [showCardModal, setShowCardModal] = useState(false);
  const [cardModalStep, setCardModalStep] = useState<"card_pricing" | "kyc_notice" | "installments" | "kyc_link">("card_pricing");
  const [installments, setInstallments] = useState(1);
  const [kycOrderId, setKycOrderId] = useState("");
  const [kycWhatsAppUrl, setKycWhatsAppUrl] = useState("");
  const [kycVerified, setKycVerified] = useState(false);
  const [cpfDisplay, setCpfDisplay] = useState("");
  const [phoneDisplay, setPhoneDisplay] = useState("");
  const [cepDisplay, setCepDisplay] = useState("");
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
  const [paymentMethods, setPaymentMethods] = useState({ pix: true, card: true });

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
    id: string; productId: string; title: string; cardTitle?: string | null; description?: string | null;
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
      const bumpProduct = { id: cartItem.id, name: cartItem.name, price: regularPrice, image: bump.image ?? undefined };

      if (!bumpItem) {
        // Caso 1: nenhum bump aplicado — auto-aplicar se qty > 1
        if (cartQty <= 1) continue;
        const bestTier = [...bump.tiers].sort((a, b) => b.qty - a.qty).find((t) => t.qty <= cartQty);
        if (!bestTier || bestTier.qty <= 1) continue;
        const baseExtra = bestTier.qty - 1;
        updateQuantity(cartItem.id, 1);
        addBumpItem(bump.id, bumpProduct, bestTier.price / baseExtra, baseExtra);
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
          addBumpItem(bump.id, bumpProduct, bestTier.price / baseExtra, baseExtra);
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

  const { mutate: createOrder, isPending: isCreatingOrder } = useCreateOrder({
    request: {
      headers: getCustomerAuthHeaders(),
    },
  });
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const isLoading = isCreatingOrder || isCheckingOut;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${BASE}/api/settings`);
        if (!res.ok) return;
        const data = await res.json() as Record<string, string>;
        const parseEnabled = (value?: string) => {
          if (value == null || value === "") return true;
          const normalized = String(value).trim().toLowerCase();
          return !["0", "false", "off", "no", "disabled"].includes(normalized);
        };
        if (!cancelled) {
          setPaymentMethods({
            pix: parseEnabled(data["checkout_enable_pix"]),
            card: parseEnabled(data["checkout_enable_card"]),
          });
        }
      } catch {
        // Keep defaults enabled on network errors.
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
      addBumpItem(bump.id, { id: item.id, name: item.name, price: (item as { regularPrice?: number }).regularPrice ?? item.price }, bestTier.price / baseExtra, baseExtra);
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
      addBumpItem(bump.id, { id: item.id, name: item.name, price: (item as { regularPrice?: number }).regularPrice ?? item.price }, bestTier.price / baseExtra, baseExtra);
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
  const couponProductsPayload = useMemo(
    () => items.map((item) => ({
      id: (item as { bumpForProductId?: string }).bumpForProductId ?? item.id,
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
  const selectedShipping = shippingOptions.find((o) => o.id === selectedShippingId) ?? null;
  const shippingCost = selectedShipping ? Number(selectedShipping.price) : 0;
  const baseTotal = subtotal + shippingCost + (includeInsurance ? subtotal * 0.1 : 0);
  const discountAmount = appliedCoupon
    ? appliedCoupon.discountType === "percent"
      ? eligibleProductSubtotal * (appliedCoupon.discountValue / 100)
      : Math.min(appliedCoupon.discountValue, eligibleProductSubtotal)
    : 0;
  const insuranceBase = Math.max(0, subtotal);
  const insuranceAmount = includeInsurance ? insuranceBase * 0.1 : 0;
  const total = Math.max(0, subtotal + shippingCost + insuranceAmount - discountAmount);
  const affiliateCreditToApply = useAffiliateCredit ? Math.min(affiliateCreditAvailable, total) : 0;
  const payableTotal = Math.max(0, total - affiliateCreditToApply);

  // Card payment uses regular (non-promo) prices
  const cardSubtotal = getCardSubtotal();
  const cardDiscountAmount = appliedCoupon
    ? appliedCoupon.discountType === "percent"
      ? eligibleProductSubtotalCard * (appliedCoupon.discountValue / 100)
      : Math.min(appliedCoupon.discountValue, eligibleProductSubtotalCard)
    : 0;
  const cardInsuranceBase = Math.max(0, cardSubtotal);
  const cardInsuranceAmount = includeInsurance ? cardInsuranceBase * 0.1 : 0;
  const cardBaseTotal = cardSubtotal + shippingCost + cardInsuranceAmount;
  const cardNetTotal = Math.max(0, cardBaseTotal - cardDiscountAmount);

  useEffect(() => {
    const token = getCustomerToken();
    if (!token) {
      setAffiliateCreditAvailable(0);
      setUseAffiliateCredit(false);
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
          orderValue: baseTotal,
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
    if (rawCep.length === 8) {
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
          if (data.localidade) setValue("city", data.localidade, { shouldValidate: false });
          if (data.uf) setValue("state", data.uf, { shouldValidate: false });
          if (!data.logradouro) {
            toast.info("CEP encontrado, mas sem rua cadastrada. Preencha o endereço manualmente.");
          }
        } else {
          toast.error("CEP não encontrado. Preencha o endereço manualmente.");
        }
      } catch {
        toast.error("Erro ao consultar CEP. Preencha o endereço manualmente.");
      } finally {
        setCepLoading(false);
      }
    }
  }, [setValue]);

  if (pendingCheck) {
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
          <Button onClick={() => setLocation("/")}>Voltar para loja</Button>
        </div>
      </CheckoutLayout>
    );
  }

  const handlePixPayment = async (data: CheckoutFormData) => {
    if (!paymentMethods.pix) {
      toast.error("Pagamento via PIX está desativado no momento.");
      return;
    }

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
        id: (item as { bumpForProductId?: string }).bumpForProductId ?? item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        isBump: (item as { isBump?: boolean }).isBump === true,
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
          includeInsurance,
          subtotal,
          shippingCost,
          insuranceAmount,
          total,
          sellerCode,
          affiliateCode:   affiliateCode || undefined,
          useAffiliateCredit,
          couponCode:      appliedCoupon?.code,
          discountAmount:  discountAmount > 0 ? discountAmount : undefined,
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
          if (synced) toast.info("Revise os novos valores e finalize novamente.");
          return;
        }
        toast.error(result.message || "Erro ao gerar pagamento PIX. Verifique os dados e tente novamente.");
        return;
      }

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
            products:        items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })),
            shippingType:    selectedShipping?.name ?? "Frete",
            shippingCost,
            includeInsurance,
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
          includeInsurance,
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
          products:        items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })),
          shippingType:    selectedShipping?.name ?? "Frete",
          shippingCost,
          includeInsurance,
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
  };

  const handleCardPayment = () => {
    if (!paymentMethods.card) {
      toast.error("Pagamento com cartão está desativado no momento.");
      return;
    }

    handleSubmit(async () => {
      const cartAvailable = await validateCartAvailability();
      if (!cartAvailable) return;

      setKycOrderId("");
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

  const finalizeCardPayment = () => {
    const data = getValues();
    const cardFee = installments <= 3 ? 100 : 0;
    // Card uses regular (non-promo) prices
    const cardTotal = cardNetTotal + cardFee;
    const cardProductsPayload = items.map((i) => ({
      id: (i as { bumpForProductId?: string }).bumpForProductId ?? i.id,
      name: i.name,
      quantity: i.quantity,
      price: (i as { regularPrice?: number }).regularPrice ?? i.price,
      isBump: (i as { isBump?: boolean }).isBump === true,
    }));
    const affiliateCode = getStoredReferralCode();

    // Save card simulation order in DB for admin tracking
    createOrder(
      {
        data: {
          client: { name: data.name, email: data.email, phone: data.phone, document: data.document },
          address: {
            cep: data.cep, street: data.street, number: data.number,
            complement: data.complement || "", neighborhood: data.neighborhood,
            city: data.city, state: data.state,
          },
          products: cardProductsPayload,
          shippingType: selectedShipping?.name ?? "Frete",
          includeInsurance,
          subtotal: cardSubtotal,
          shippingCost,
          insuranceAmount: cardInsuranceAmount,
          total: cardTotal,
          paymentMethod: "card_simulation",
          cardInstallments: installments,
          sellerCode,
          affiliateCode: affiliateCode || undefined,
          couponCode:     appliedCoupon?.code,
          discountAmount: cardDiscountAmount > 0 ? cardDiscountAmount : undefined,
        },
      },
      {
        onSuccess: (order) => {
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
            `*Nº do Pedido:* ${order.id}\n` +
            `*Cliente:* ${data.name}\n` +
            `*CPF:* ${data.document}\n` +
            `*Telefone:* ${data.phone}\n` +
            `*E-mail:* ${data.email}\n\n` +
            `*Endereço de Entrega:*\n  ${addressFull}\n\n` +
            `*Produtos:*\n${itemsText}\n\n` +
            `*Subtotal:* ${formatCurrency(cardSubtotal)}\n` +
            `*Frete (${selectedShipping?.name ?? "Frete"}):* ${formatCurrency(shippingCost)}\n` +
            (includeInsurance ? `*Seguro de Envio:* Sim (+${formatCurrency(cardInsuranceAmount)})\n` : "") +
            (cardDiscountAmount > 0
              ? `*Desconto${appliedCoupon?.code ? ` (${appliedCoupon.code})` : ""}:* -${formatCurrency(cardDiscountAmount)}\n`
              : "") +
            (cardFee > 0 ? `*Taxa parcelamento:* +${formatCurrency(cardFee)}\n` : "") +
            `*Parcelamento desejado:* ${installments}x\n` +
            `*Total:* ${formatCurrency(cardTotal)}\n\n` +
            `Aguardo o retorno para confirmar os detalhes!`;

          const waUrl = `https://wa.me/${getActiveWhatsApp()}?text=${encodeURIComponent(message)}`;
          setKycOrderId(order.id);
          setKycWhatsAppUrl(waUrl);
          setCardModalStep("kyc_link");
        },
        onError: async (error) => {
          const apiError = error as { data?: { error?: string; message?: string } };
          if (apiError?.data?.error === "PRICE_CHANGED") {
            const synced = await syncCartWithLatestProducts();
            toast.error(apiError?.data?.message || "Os preços mudaram e o carrinho foi atualizado.");
            if (synced) toast.info("Revise os novos valores e tente novamente.");
            return;
          }
          toast.error("Erro ao registrar pedido. Tente novamente.");
        },
      }
    );
  };

  return (
    <CheckoutLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <button
          onClick={() => setLocation("/")}
          className="flex items-center text-muted-foreground hover:text-primary mb-8 font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Voltar para loja
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
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
                  {checkoutBumps.map((bump) => {
                    const cartItem = items.find((i) => i.id === bump.productId);
                    if (!cartItem) return null;
                    const effectivePrice = cartItem.price;
                    const unit = bump.unit || "unidade";
                    const bumpCartId = `bump_${bump.id}`;
                    const alreadyApplied = items.some((i) => i.id === bumpCartId);
                    const cartQty = cartItem.quantity ?? 1;
                    const cartCost = cartItem.price * cartQty;
                    const regularPrice = (cartItem as { regularPrice?: number }).regularPrice ?? cartItem.price;
                    const originalPrice = regularPrice;
                    const bumpProduct = { id: cartItem.id, name: cartItem.name, price: originalPrice, image: bump.image ?? undefined };

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
                      addBumpItem(bump.id, bumpProduct, price, qty);
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
                            {bump.image ? (
                              <img src={bump.image} alt={bump.title} className="w-14 h-14 rounded-xl object-cover border border-amber-100 flex-shrink-0" />
                            ) : (
                              <div className="w-14 h-14 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center flex-shrink-0">
                                <Zap className="w-6 h-6 text-amber-400" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-sm text-gray-900 leading-tight">{bump.cardTitle || bump.title}</p>
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

                                const tierImage = tier.image || bump.image;
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
                                      addBumpItem(bump.id, bumpProduct, pricePerExtraUnit, baseExtra);
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

              <div>
                <label className="text-sm font-medium text-foreground mb-3 block">Tipo de Frete</label>
                {shippingLoading ? (
                  <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Carregando opções de frete...
                  </div>
                ) : shippingOptions.length === 0 ? (
                  <div className="py-4 text-muted-foreground text-sm text-center rounded-xl border-2 border-border">
                    Nenhuma opção de frete disponível no momento.
                  </div>
                ) : (
                  <div className={`grid grid-cols-1 ${shippingOptions.length > 1 ? "sm:grid-cols-2" : ""} gap-4`}>
                    {shippingOptions.map((opt) => (
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
                            <Truck className="w-4 h-4" />
                            {opt.name}
                          </p>
                          {opt.description && (
                            <p className="text-sm text-muted-foreground mt-1">{opt.description}</p>
                          )}
                          <p className="font-semibold text-primary mt-2">
                            {formatCurrency(Number(opt.price))}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Insurance */}
              <div className="pt-4 border-t border-border">
                <label className="flex items-start gap-4 cursor-pointer group">
                  <div className="relative flex items-center justify-center mt-1 shrink-0">
                    <div
                      onClick={() => setIncludeInsurance((v) => !v)}
                      className={`w-6 h-6 rounded-md border-2 transition-colors flex items-center justify-center cursor-pointer ${includeInsurance ? "border-primary bg-primary" : "border-muted-foreground"}`}
                    >
                      {includeInsurance && <ShieldCheck className="w-4 h-4 text-white" />}
                    </div>
                  </div>
                  <div>
                    <p className="font-bold text-foreground group-hover:text-primary transition-colors">
                      Adicionar Seguro de Envio (+10%)
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Seguro de envio que garante cobertura em caso de extravio, dano ou problemas na entrega.
                    </p>
                    <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-xs text-amber-800 flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        Pedidos sem seguro são de responsabilidade do comprador. Não nos responsabilizamos por problemas no transporte.
                      </p>
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Right Column: Summary */}
          <div className="lg:col-span-5">
            <div className="bg-card p-6 rounded-2xl shadow-xl shadow-primary/5 border border-primary/10 sticky top-28">
              <h2 className="text-xl font-bold mb-6">Resumo do Pedido</h2>

              <div className="space-y-4 mb-6 max-h-72 overflow-y-auto pr-2">
                {items.filter((item) => !(item as { isBump?: boolean }).isBump).map((item) => {
                  const bumpItem = items.find(
                    (i) => !!(i as { isBump?: boolean }).isBump &&
                      (i as { bumpForProductId?: string }).bumpForProductId === item.id
                  ) as ({ quantity: number; price: number; id: string } | undefined);
                  const totalQty = bumpItem ? item.quantity + bumpItem.quantity : item.quantity;
                  const fullPrice = item.price * totalQty;
                  const actualPrice = bumpItem
                    ? item.price * item.quantity + bumpItem.price * bumpItem.quantity
                    : item.price * item.quantity;
                  const saving = fullPrice - actualPrice;
                  return (
                    <div key={item.id} className="flex gap-3 items-start rounded-xl p-2">
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
                          <span className="text-xs font-semibold w-4 text-center">{totalQty}</span>
                          <button
                            type="button"
                            onClick={() => handleQtyIncrease(item)}
                            className="w-5 h-5 flex items-center justify-center rounded border border-border bg-white hover:bg-muted transition-colors text-foreground"
                          >
                            <Plus className="w-2.5 h-2.5" />
                          </button>
                        </div>
                        {bumpItem && saving > 0 && (
                          <div className="flex items-center gap-1 mt-1">
                            <span className="text-[11px] text-green-600 font-semibold">
                              Desconto ({totalQty}ª cx): -{formatCurrency(saving)}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeItem(bumpItem.id)}
                              className="text-[10px] text-muted-foreground underline hover:text-destructive ml-1 transition-colors"
                            >
                              remover
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        {bumpItem && saving > 0 ? (
                          <>
                            <p className="text-xs text-muted-foreground line-through">{formatCurrency(fullPrice)}</p>
                            <p className="font-semibold text-sm">{formatCurrency(actualPrice)}</p>
                          </>
                        ) : (
                          <p className="font-semibold text-sm">{formatCurrency(actualPrice)}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3 py-4 border-t border-border mb-4">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Frete ({selectedShipping?.name ?? "—"})</span>
                  <span>{formatCurrency(shippingCost)}</span>
                </div>
                {includeInsurance && (
                  <div className="flex justify-between text-primary font-medium">
                    <span>Seguro de Envio (+10%)</span>
                    <span>{formatCurrency(insuranceAmount)}</span>
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

              {/* Coupon field */}
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
                    disabled={isLoading}
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
                  >
                    <CreditCard className="w-5 h-5 mr-2" />
                    Pagar com Cartão
                  </Button>
                )}

                {!paymentMethods.pix && !paymentMethods.card && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    No momento, os pagamentos estão temporariamente desativados. Tente novamente em instantes.
                  </div>
                )}
              </div>
            </div>
          </div>
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
                      <p className="text-sm font-bold text-green-800">✅ Pedido #{kycOrderId} registrado!</p>
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
                      <p className="text-sm font-bold text-green-800 mb-1">✅ Pedido #{kycOrderId} criado!</p>
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
      </AnimatePresence>
    </CheckoutLayout>
  );
}
