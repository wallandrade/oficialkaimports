// Utilitário para formatar datas no padrão brasileiro (dd/MM/yyyy)
function formatDateBR(date: string | Date | undefined | null): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatDateOnlyLocal(date: string | Date | undefined | null): string {
  if (!date) return "";
  const raw = String(date).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function formatTimeBR(date: string | Date | undefined | null): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function daysSince(date: string | Date | undefined | null): number {
  if (!date) return 0;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
// Funções utilitárias para recuperar dados do localStorage
function getIsPrimary() {
  return localStorage.getItem("adminIsPrimary") === "true";
}
function getAdminUsername() {
  return localStorage.getItem("adminUsername") || "";
}
function getAdminTenantId() {
  return localStorage.getItem("adminTenantId") || "tenant_loja1";
}

// Recupera o token do admin do localStorage
function getToken() {
  return sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
}

// Retorna headers de autenticação para requisições admin
function authHeaders() {
  const token = getToken();
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

function normalizeHexColor(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw.startsWith("#") ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toUpperCase() : "";
}

// BASE URL para requisições (igual outros arquivos)
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const ORDER_WHATSAPP_GROUP_OPTIONS = Array.from({ length: 10 }, (_, index) => `grupo_${index + 1}`);

function whatsappGroupLabel(group: string | null | undefined): string {
  const raw = String(group || "").trim();
  if (!raw) return "Sem grupo";
  const match = raw.match(/^grupo_(\d+)$/i);
  if (match) return `Grupo ${match[1]}`;
  return raw.replace(/_/g, " ");
}

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Funções utilitárias de data
function todayStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}
function spDateStr(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
function isoToSPDate(iso: string) {
  // Converte string ISO para YYYY-MM-DD (para <input type="date">)
  return iso ? iso.slice(0, 10) : "";
}

type OrderProductLite = { id: string; name: string; quantity: number; price: number; costPrice?: number; image?: string | null };

function getOrderProducts(raw: unknown): OrderProductLite[] {
  if (Array.isArray(raw)) return raw as OrderProductLite[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed as OrderProductLite[] : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getOrderDisplayId(order: any): string {
  const numeric = Number(order?.orderNumber);
  if (Number.isFinite(numeric) && numeric > 0) {
    return String(Math.trunc(numeric));
  }
  return String(order?.id || "-");
}

export function orderToText(order: any): string {
  const products = getOrderProducts(order?.products);
  const prioridadeLine = order?.isPrioridade ? "PRIORIDADE URGENTE" : "";
  const productsText = products.length
    ? products
        .map((p) => {
          const qty = Number(p?.quantity) || 0;
          return `- ${qty}x ${p?.name || "Produto"}`;
        })
        .join("\n")
    : "- Sem itens";

  const reshipmentStatus = order?.reshipment?.status;
  const reshipmentLabel = reshipmentStatus === "reenvio_aguardando_estoque" ? "⏳ AGUARDANDO ESTOQUE"
    : reshipmentStatus === "reenvio_pronto_para_envio" ? "✅ PRONTO PARA ENVIO"
    : reshipmentStatus === "reenvio_resolvido_sem_entrada" ? "🟦 RESOLVIDO SEM ENTRADA"
    : reshipmentStatus === "reenvio_enviado" ? "📦 ENVIADO"
    : "";

  const rua = [order?.addressStreet, order?.addressNumber].filter(Boolean).join(", ") || "-";
  const dataPrimeiroPedido = order?.reshipment?.originalOrderCreatedAt || order?.createdAt || null;
  const trackingCodeInformado = String(order?.reshipment?.ticketTrackingCode || "").trim();

  if (reshipmentLabel) {
    return [
      prioridadeLine,
      `🚨 REENVIO - ${reshipmentLabel}`,
      `Data do pedido original: ${formatDateBR(dataPrimeiroPedido) || "-"}`,
      trackingCodeInformado ? `Numero rastreio informado: ${trackingCodeInformado}` : "",
      order?.reshipment?.ticketDescription ? `Motivo do reenvio: ${order.reshipment.ticketDescription}` : "",
      "",
      `Pedido numero: ${getOrderDisplayId(order)}`,
      "",
      `Nome: ${order?.clientName || "-"}`,
      `Rua: ${rua}`,
      `Bairro: ${order?.addressNeighborhood || "-"}`,
      `Complemento: ${order?.addressComplement || "-"}`,
      `Cidade: ${order?.addressCity || "-"}`,
      `Estado: ${order?.addressState || "-"}`,
      `Cep: ${order?.addressCep || "-"}`,
      "",
      "Resumo pedido:",
      productsText,
      order?.observation ? "" : "",
      order?.observation ? `Observacao: ${order.observation}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    prioridadeLine,
    `Pedido numero: ${getOrderDisplayId(order)}`,
    "",
    `Nome: ${order?.clientName || "-"}`,
    `Rua: ${rua}`,
    `Bairro: ${order?.addressNeighborhood || "-"}`,
    `Complemento: ${order?.addressComplement || "-"}`,
    `Cidade: ${order?.addressCity || "-"}`,
    `Estado: ${order?.addressState || "-"}`,
    `Cep: ${order?.addressCep || "-"}`,
    "",
    "Resumo pedido:",
    productsText,
    order?.observation ? "" : "",
    order?.observation ? `Observacao: ${order.observation}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function orderToFullText(order: any): string {
  const products = getOrderProducts(order?.products);
  const prioridadeLine = order?.isPrioridade ? "PRIORIDADE URGENTE" : "";
  const productsText = products.length
    ? products
        .map((p) => {
          const qty = Number(p?.quantity) || 0;
          const unitPrice = Number(p?.price) || 0;
          const lineTotal = qty * unitPrice;
          return `- ${qty}x ${p?.name || "Produto"} (${formatCurrency(lineTotal)})`;
        })
        .join("\n")
    : "- Sem itens";

  const address = [
    order?.addressStreet,
    order?.addressNumber,
    order?.addressComplement,
    order?.addressNeighborhood,
    `${order?.addressCity || ""}${order?.addressState ? `/${order.addressState}` : ""}`,
    order?.addressCep ? `CEP ${order.addressCep}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const subtotalFromItems = products.reduce((sum, p) => {
    const qty = Number(p?.quantity) || 0;
    const unitPrice = Number(p?.price) || 0;
    return sum + (qty * unitPrice);
  }, 0);

  const total = Number(order?.cardTotalActual ?? order?.total) || 0;

  const freteCandidates = [
    Number(order?.shippingCost),
    Number(order?.shippingPrice),
    Number(order?.frete),
    Number(order?.freight),
    Number(order?.deliveryFee),
    Number(order?.shippingFee),
  ].filter((value) => Number.isFinite(value) && value >= 0);

  const frete = freteCandidates.length > 0
    ? freteCandidates[0]
    : Math.max(0, total - subtotalFromItems);

  const subtotalCandidates = [
    Number(order?.subtotal),
    Number(order?.subTotal),
    Number(order?.itemsTotal),
  ].filter((value) => Number.isFinite(value) && value >= 0);

  const subtotal = subtotalCandidates.length > 0
    ? subtotalCandidates[0]
    : Math.max(0, total - frete);

  const insuranceAmount = Math.max(0, Number(order?.insuranceAmount) || 0);
  const hasInsurance = Boolean(order?.includeInsurance) || insuranceAmount > 0;

  const paymentMethodRaw = String(order?.paymentMethod || "").toLowerCase();
  const paymentLabel = paymentMethodRaw === "card_simulation"
    ? "Cartão"
    : paymentMethodRaw === "whatsapp_pix"
      ? "WhatsApp"
      : (paymentMethodRaw || "-").toUpperCase();

  const transactionId = String(order?.transactionId || order?.txid || order?.gatewayTransactionId || "").trim();

  const contato = `${order?.clientPhone || "-"}${order?.clientEmail ? ` · ${order.clientEmail}` : ""}`;

  const normalizeProofs = (raw: unknown): string[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean).map((v) => String(v));
    return [String(raw)];
  };

  const allProofs = [
    ...normalizeProofs(order?.proofUrls),
    ...normalizeProofs(order?.proofUrl),
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  const isInlineProof = (value: string) => /^data:(image|application)\//i.test(value.trim());
  const inlineProofCount = allProofs.filter((value) => isInlineProof(value)).length;
  const externalProofs = allProofs.filter((value) => !isInlineProof(value));

  const proofLines = [
    externalProofs.length > 0 ? `Comprovantes: ${externalProofs.join(", ")}` : "",
    inlineProofCount > 0 ? `Comprovantes anexados: ${inlineProofCount} arquivo(s) (imagem/base64 ocultada no copiar)` : "",
  ];

  return [
    prioridadeLine,
    `Pedido #${getOrderDisplayId(order)}`,
    `Data: ${formatDateBR(order?.createdAt) || "-"}`,
    `Cliente: ${order?.clientName || "-"}`,
    `Contato: ${contato}`,
    order?.clientDocument ? `CPF: ${order.clientDocument}` : "",
    "Produtos:",
    productsText,
    `Subtotal: ${formatCurrency(subtotal)}`,
    `Frete: ${formatCurrency(frete)}`,
    hasInsurance ? `Seguro: Sim (${formatCurrency(insuranceAmount)})` : "",
    `Total: ${formatCurrency(total)}`,
    `Status: ${order?.status || "-"}`,
    `Pagamento: ${paymentLabel}`,
    transactionId ? `Transação: ${transactionId}` : "",
    order?.sellerCode ? `Vendedor: ${order.sellerCode}` : "",
    address ? `Endereço: ${address}` : "",
    order?.observation ? "" : "",
    order?.observation ? `Observação: ${order.observation}` : "",
    order?.trackingCode ? `Rastreio: ${order.trackingCode}` : "",
    ...proofLines,
  ]
    .filter(Boolean)
    .join("\n");
}

function orderToPostPaymentText(order: any): string {
  const products = getOrderProducts(order?.products);
  const productsText = products.length
    ? products
        .map((p) => {
          const qty = Number(p?.quantity) || 0;
          return `💊 ${qty}x ${p?.name || "Produto"}`;
        })
        .join("\n")
    : "💊 Sem itens";

  const rua = [order?.addressStreet, order?.addressNumber].filter(Boolean).join(", ") || "-";
  const bairro = String(order?.addressNeighborhood || "-");
  const complemento = String(order?.addressComplement || "-");
  const cidadeUf = `${order?.addressCity || "-"}${order?.addressState ? `/${order.addressState}` : ""}`;
  const cep = String(order?.addressCep || "-");
  const cliente = String(order?.clientName || "Cliente").trim() || "Cliente";

  return [
    `🎉 **Parabéns, ${cliente}! Sua compra foi confirmada com sucesso!** ✅📦`,
    "",
    "Seu pagamento já foi aprovado e o seu pedido foi registrado em nosso sistema. Agora ele segue para a etapa de preparação e envio. 🚀",
    "",
    "📋 **Resumo do pedido:**",
    productsText,
    "",
    "📍 **Entrega:**",
    rua,
    `Bairro: ${bairro}`,
    `Complemento: ${complemento}`,
    cidadeUf,
    `CEP: ${cep}`,
    "",
    "⏳ Pedimos que aguarde até **48 horas úteis** para a liberação do código de rastreio. Esse prazo é necessário para organização do envio e para conseguirmos manter um atendimento mais rápido e eficiente para todos os clientes. 🙏",
    "",
    "Assim que o rastreio estiver disponível, você poderá acompanhar a movimentação do seu pedido. 📲",
    "",
    "⚠️ **Importante:** sábados, domingos e feriados não são considerados dias úteis para processamento de envio.",
    "",
    "Obrigado pela confiança! 💙📦",
  ].join("\n");
}

export function chargeToText(charge: any): string {
  const address = [
    charge?.addressStreet,
    charge?.addressNumber,
    charge?.addressComplement,
    charge?.addressNeighborhood,
    `${charge?.addressCity || ""}${charge?.addressState ? `/${charge.addressState}` : ""}`,
    charge?.addressCep ? `CEP ${charge.addressCep}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return [
    `Cobrança #${charge?.id || "-"}`,
    `Data: ${formatDateBR(charge?.createdAt) || "-"}`,
    `Cliente: ${charge?.clientName || "-"}`,
    `Contato: ${charge?.clientPhone || "-"}${charge?.clientEmail ? ` · ${charge.clientEmail}` : ""}`,
    charge?.clientDocument ? `CPF: ${charge.clientDocument}` : "",
    `Descrição: ${charge?.description || "-"}`,
    `Valor: ${formatCurrency(Number(charge?.amount) || 0)}`,
    `Status: ${charge?.status || "-"}`,
    charge?.transactionId ? `Transação: ${charge.transactionId}` : "",
    charge?.sellerCode ? `Vendedor: ${charge.sellerCode}` : "",
    address ? `Endereço: ${address}` : "",
    charge?.observation ? `Observação: ${charge.observation}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function supplierOrderBlock(order: any, sequence: number): string {
  const products = getOrderProducts(order?.products);
  const prioridadeLine = order?.isPrioridade ? "🚨 PRIORIDADE URGENTE" : "";
  const resumoPedido = products.length
    ? products
        .map((p) => {
          const qty = Number(p?.quantity) || 0;
          return `- ${qty}x ${p?.name || "Produto"}`;
        })
        .join("\n")
    : "- Sem itens";

  const rua = [order?.addressStreet, order?.addressNumber].filter(Boolean).join(", ") || "-";
  const isReshipment = Boolean(order?.reshipment?.id) && !["reenvio_enviado", "reenvio_resolvido_sem_entrada"].includes(String(order?.reshipment?.status || ""));
  const firstOrderDate = formatDateBR(order?.reshipment?.originalOrderCreatedAt || order?.createdAt) || "-";
  const reshipmentReason = String(order?.reshipment?.ticketDescription || "").trim();
  const reshipmentReasonText = reshipmentReason || "Nao informado no chamado";

  return [
    prioridadeLine,
    isReshipment ? "🚨 ATENCAO REENVIO - ABATER NO PAGAMENTO" : "",
    isReshipment ? `Data do pedido original: ${firstOrderDate}` : "",
    isReshipment ? `Motivo do reenvio: ${reshipmentReasonText}` : "",
    isReshipment ? "" : "",
    `Pedido numero: ${sequence}`,
    "",
    `Nome: ${order?.clientName || "-"}`,
    `Rua: ${rua}`,
    `Bairro: ${order?.addressNeighborhood || "-"}`,
    `Complemento: ${order?.addressComplement || "-"}`,
    `Cidade: ${order?.addressCity || "-"}`,
    `Estado: ${order?.addressState || "-"}`,
    `Cep: ${order?.addressCep || "-"}`,
    "",
    "Resumo pedido:",
    resumoPedido,
    "_______________________________",
  ].join("\n");
}

function formatRaffleDescriptionPreview(value: string | undefined | null): string {
  const raw = String(value || "");
  if (!raw.trim()) return "";

  // Normalize line breaks and avoid very large blank gaps in preview text.
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Loader2, Save, Plus, Trash2, X, CheckCircle, XCircle, Zap, Info, Pencil, MessageCircle, Tag, Bell, RefreshCw, Download, LogOut, QrCode, LinkIcon, Ticket, ShoppingBag, Clock, Upload, ChevronDown, ChevronUp, Copy, Users, Percent, Calendar, DollarSign, ShieldCheck, CreditCard, Truck, UserPlus, Eye, EyeOff, ToggleLeft, Webhook, ImageOff, Lock, AlertTriangle, Star, Send, Mail, Store } from "lucide-react";
import { IconLucide } from "@/components/ui/IconLucide";

import { toast } from "sonner";


import { Button } from "@/components/ui/button";
import { AnimatePresence, motion } from "framer-motion";
import { formatCurrency, formatDateOnlyBR } from "@/lib/utils";
import { generateChargePdf, generateOrderPdf } from "@/lib/generateOrderPdf";
import { AdminLayout } from "@/components/layout/AdminLayout";



function statusBadge(status: string) {
  const map: Record<string, { label: string; color: string; Icon: typeof CheckCircle }> = {
    paid:             { label: "Pago",      color: "bg-green-100 text-green-800 border-green-200",   Icon: CheckCircle },
    completed:        { label: "Concluído", color: "bg-emerald-100 text-emerald-800 border-emerald-200", Icon: CheckCircle },
    awaiting_payment: { label: "Aguardando",color: "bg-yellow-100 text-yellow-800 border-yellow-200",Icon: Clock },
    pending:          { label: "Pendente",  color: "bg-gray-100 text-gray-700 border-gray-200",      Icon: Clock },
    cancelled:        { label: "Cancelado", color: "bg-red-100 text-red-800 border-red-200",         Icon: XCircle },
  };
  const cfg = map[status] || { label: status, color: "bg-gray-100 text-gray-700 border-gray-200", Icon: Clock };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cfg.color}`}>
      <cfg.Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}


function normalizeOrderStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}
async function copyText(text: string): Promise<"auto" | "manual"> {
  // First try async clipboard API (works in secure contexts and with permission).
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return "auto";
    } catch {
      // Fallback below for browsers/contexts where clipboard API is blocked.
    }
  }

  const previousActive = document.activeElement as HTMLElement | null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const ok = typeof document.execCommand === "function" && document.execCommand("copy");
  document.body.removeChild(textarea);
  previousActive?.focus?.();
  if (!ok) {
    const manual = window.prompt("Copia manual: Ctrl+C e Enter", text);
    if (manual !== null) {
      return "manual";
    }
    throw new Error("clipboard_not_available");
  }

  return "auto";
}

// ---------------------------------------------------------------------------
// OrderBumpsPanel
// ---------------------------------------------------------------------------
interface OrderBump {
  id: string;
  productId: string;
  offerProductId?: string | null;
  title: string;
  cardTitle?: string | null;
  description?: string | null;
  image?: string | null;
  discountType: string;
  discountValue?: number | null;
  buyQuantity?: number | null;
  getQuantity?: number | null;
  tiers?: Array<{ qty: number; price: number; image?: string }> | null;
  unit?: string | null;
  discountTagType?: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}
interface BumpProduct { id: string; name: string; image?: string | null; }

const DISCOUNT_TYPES = [
  { value: "percent",        label: "% de Desconto" },
  { value: "fixed",          label: "Desconto Fixo (R$)" },
  { value: "buy_x_get_y",    label: "Pague X Leve Y" },
  { value: "quantity_tiers", label: "Preço por Quantidade" },
];

function discountTypeLabel(t: string) {
  return DISCOUNT_TYPES.find((d) => d.value === t)?.label ?? t;
}

function bumpSummary(b: OrderBump): string {
  if (b.discountType === "percent")        return `${b.discountValue ?? 0}% de desconto`;
  if (b.discountType === "fixed")          return `-${formatCurrency(b.discountValue ?? 0)}`;
  if (b.discountType === "buy_x_get_y")    return `Pague ${b.buyQuantity ?? 1} leve ${b.getQuantity ?? 2}`;
  if (b.discountType === "quantity_tiers" && b.tiers?.length) {
    return b.tiers.map((t) => `${t.qty}un → +${formatCurrency(t.price)}`).join(" | ");
  }
  return "";
}

type BumpFormType = {
  productId: string;
  offerProductId: string;
  title: string;
  cardTitle: string;
  description: string;
  image: string;
  discountType: string;
  discountValue: string;
  buyQuantity: string;
  getQuantity: string;
  tiers: Array<{ qty: string; price: string; image: string }>;
  unit: string;
  discountTagType: string;
  isActive: boolean;
  sortOrder: string;
};

const BUMP_UNITS = ["unidade", "caixa", "frasco", "ampola", "caneta", "par", "kit"];

const EMPTY_BUMP_FORM: BumpFormType = {
  productId: "", offerProductId: "", title: "", cardTitle: "", description: "", image: "",
  discountType: "percent", discountValue: "", buyQuantity: "1", getQuantity: "2",
  tiers: [{ qty: "2", price: "", image: "" }, { qty: "3", price: "", image: "" }],
  unit: "unidade", discountTagType: "none", isActive: true, sortOrder: "0",
};

interface OrderBumpsPanelProps {
  bumps: OrderBump[];
  products: BumpProduct[];
  form: BumpFormType;
  setForm: React.Dispatch<React.SetStateAction<BumpFormType>>;
  creating: boolean;
  toggling: string | null;
  deleting: string | null;
  editingId: string | null;
  updating: boolean;
  onCreate: () => void;
  onUpdate: () => void;
  onEdit: (b: OrderBump) => void;
  onCancelEdit: () => void;
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
}

// ProductSelect with image thumbnails and search - Custom implementation
function ProductSelect({ products, value, onChange, placeholder }: { products: BumpProduct[]; value: string; onChange: (v: string) => void; placeholder: string }) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const filteredProducts = products.filter((p) => {
    const query = search.toLowerCase().trim();
    if (!query) return true;
    const haystack = `${p.name} ${p.id}`.toLowerCase();
    return haystack.includes(query);
  });

  const selectedProduct = products.find((p) => p.id === value);

  const handleSelect = (productId: string) => {
    onChange(productId);
    setIsOpen(false);
    setSearch("");
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          placeholder={selectedProduct ? selectedProduct.name : placeholder}
          value={isOpen ? search : ""}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoComplete="off"
        />
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>

      {isOpen && filteredProducts.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg z-40 max-h-64 overflow-y-auto">
          {filteredProducts.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelect(p.id)}
              className="w-full px-3 py-2 text-sm hover:bg-blue-100 cursor-pointer flex items-center gap-2 text-left border-b border-border last:border-b-0 transition-colors"
            >
              {p.image && <img src={p.image} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />}
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      )}

      {isOpen && filteredProducts.length === 0 && search && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg z-40 px-3 py-2 text-sm text-gray-500">
          Nenhum produto encontrado
        </div>
      )}
    </div>
  );
}

function OrderBumpsPanel({ bumps, products, form, setForm, creating, toggling, deleting, editingId, updating, onCreate, onUpdate, onEdit, onCancelEdit, onToggle, onDelete }: OrderBumpsPanelProps) {
  const productName = (id: string) => products.find((p) => p.id === id)?.name || id;
  const isEditing = editingId !== null;

  return (
    <div className="space-y-6">
      {/* Create / Edit Form */}
      <div className="bg-white border border-border rounded-2xl p-5">
        <h3 className="font-bold text-base mb-4 flex items-center gap-2 text-orange-600">
          <Zap className="w-4 h-4" /> {isEditing ? "Editar Order Bump" : "Novo Order Bump"}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          {/* Product */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Produto gatilho *</label>
            <ProductSelect
              products={Array.isArray(products) ? products : []}
              value={form.productId}
              onChange={(v) => setForm((f) => ({ ...f, productId: v }))}
              placeholder="Selecione um produto…"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Produto da promoção *</label>
            <ProductSelect
              products={Array.isArray(products) ? products : []}
              value={form.offerProductId}
              onChange={(v) => setForm((f) => ({ ...f, offerProductId: v }))}
              placeholder="Selecione o produto promocional…"
            />
          </div>
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Nome interno do bump *</label>
            <input className="w-full border border-border rounded-lg px-3 py-2 text-sm" placeholder="Ex: Bump TG 15mg — 3% off" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          {/* Card Title */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Título do card no site (opcional)</label>
            <input className="w-full border border-border rounded-lg px-3 py-2 text-sm" placeholder="Título exibido ao cliente (padrão: nome interno)" value={form.cardTitle} onChange={(e) => setForm((f) => ({ ...f, cardTitle: e.target.value }))} />
          </div>
          {/* Description */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Descrição (opcional)</label>
            <input className="w-full border border-border rounded-lg px-3 py-2 text-sm" placeholder="Descrição breve da oferta…" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          {/* Image URL */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-muted-foreground mb-1">URL da imagem (opcional)</label>
            <input className="w-full border border-border rounded-lg px-3 py-2 text-sm" placeholder="https://…" value={form.image} onChange={(e) => setForm((f) => ({ ...f, image: e.target.value }))} />
          </div>
          {/* Discount Type */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Tipo de desconto *</label>
            <select className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white" value={form.discountType} onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value }))}>
              {DISCOUNT_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          {/* Unit */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Unidade de medida</label>
            <select className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white capitalize" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}>
              {BUMP_UNITS.map((u) => <option key={u} value={u} className="capitalize">{u}</option>)}
            </select>
          </div>
          {/* Discount Tag Type — for quantity_tiers */}
          {form.discountType === "quantity_tiers" && (
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Tag de desconto nos cards</label>
              <select className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white" value={form.discountTagType} onChange={(e) => setForm((f) => ({ ...f, discountTagType: e.target.value }))}>
                <option value="none">Sem tag</option>
                <option value="percent">Mostrar % de desconto</option>
                <option value="fixed">Mostrar economia em R$</option>
              </select>
            </div>
          )}
          {/* Sort Order */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Ordem</label>
            <input type="number" className="w-full border border-border rounded-lg px-3 py-2 text-sm" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
          </div>
        </div>

        {/* Discount-type-specific fields */}
        {form.discountType === "percent" && (
          <div className="mb-3">
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Percentual de desconto (%)</label>
            <input type="number" min="1" max="100" className="w-full sm:w-40 border border-border rounded-lg px-3 py-2 text-sm" placeholder="20" value={form.discountValue} onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))} />
          </div>
        )}
        {form.discountType === "fixed" && (
          <div className="mb-3">
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Valor de desconto (R$)</label>
            <div className="flex items-center gap-1.5 w-full sm:w-48">
              <span className="text-sm font-semibold text-muted-foreground">R$</span>
              <input type="number" min="0" step="0.01" className="flex-1 border border-border rounded-lg px-3 py-2 text-sm" placeholder="50,00" value={form.discountValue} onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))} />
            </div>
          </div>
        )}
        {form.discountType === "buy_x_get_y" && (
          <div className="flex gap-3 mb-3 flex-wrap">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Pague (qtd)</label>
              <input type="number" min="1" className="w-24 border border-border rounded-lg px-3 py-2 text-sm" value={form.buyQuantity} onChange={(e) => setForm((f) => ({ ...f, buyQuantity: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Leve (qtd)</label>
              <input type="number" min="1" className="w-24 border border-border rounded-lg px-3 py-2 text-sm" value={form.getQuantity} onChange={(e) => setForm((f) => ({ ...f, getQuantity: e.target.value }))} />
            </div>
          </div>
        )}
        {form.discountType === "quantity_tiers" && (
          <div className="mb-3">
            <label className="block text-xs font-semibold text-muted-foreground mb-1">
              Faixas de quantidade
            </label>
            <p className="text-xs text-orange-600 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2 mb-2">
              <strong>Qtd total</strong> = quantidade final que o cliente terá (carrinho + bump). O <strong>valor (+R$)</strong> é o custo extra que o cliente paga além do que já está no carrinho.
            </p>
            {form.tiers.map((tier, i) => (
              <div key={i} className="border border-border rounded-xl p-3 mb-2 space-y-2 bg-muted/20">
                <div className="flex gap-2 items-end flex-wrap">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground font-medium">Qtd total</span>
                    <input type="number" min="2" className="w-20 border border-border rounded-lg px-2 py-1.5 text-sm bg-white" placeholder="Ex: 2" value={tier.qty} onChange={(e) => setForm((f) => { const t = [...f.tiers]; t[i] = { ...t[i], qty: e.target.value }; return { ...f, tiers: t }; })} />
                  </div>
                  <span className="text-xs text-muted-foreground pb-2">→ +</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground font-medium">Valor extra (R$)</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-semibold text-muted-foreground">R$</span>
                      <input type="number" min="0" step="0.01" className="w-28 border border-border rounded-lg px-2 py-1.5 text-sm bg-white" placeholder="0,00" value={tier.price} onChange={(e) => setForm((f) => { const t = [...f.tiers]; t[i] = { ...t[i], price: e.target.value }; return { ...f, tiers: t }; })} />
                    </div>
                  </div>
                  {form.tiers.length > 1 && (
                    <button onClick={() => setForm((f) => ({ ...f, tiers: f.tiers.filter((_, j) => j !== i) }))} className="text-destructive hover:text-destructive/80 p-1 pb-2"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground font-medium">URL da imagem deste card (opcional)</span>
                  <input className="w-full mt-0.5 border border-border rounded-lg px-2 py-1.5 text-sm bg-white" placeholder="https://… (deixe vazio para usar imagem geral)" value={tier.image ?? ""} onChange={(e) => setForm((f) => { const t = [...f.tiers]; t[i] = { ...t[i], image: e.target.value }; return { ...f, tiers: t }; })} />
                </div>
              </div>
            ))}
            <button className="text-xs text-primary underline mt-1" onClick={() => setForm((f) => ({ ...f, tiers: [...f.tiers, { qty: "", price: "", image: "" }] }))}>+ Adicionar faixa</button>
          </div>
        )}

        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="rounded" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            Ativo
          </label>
          {isEditing && (
            <button
              onClick={onCancelEdit}
              className="flex items-center gap-2 border border-border text-muted-foreground hover:bg-muted font-semibold text-sm px-4 py-2 rounded-xl transition-colors"
            >
              <X className="w-4 h-4" /> Cancelar
            </button>
          )}
          <button
            onClick={isEditing ? onUpdate : onCreate}
            disabled={isEditing ? updating : creating}
            className="ml-auto flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm px-5 py-2 rounded-xl transition-colors disabled:opacity-60"
          >
            {(isEditing ? updating : creating) ? <Loader2 className="w-4 h-4 animate-spin" /> : isEditing ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {isEditing ? "Salvar Alterações" : "Criar Bump"}
          </button>
        </div>
      </div>

      {/* List */}
      {bumps.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground bg-orange-50 border border-orange-100 rounded-2xl">
          <Zap className="w-10 h-10 mx-auto mb-3 text-orange-300" />
          <p className="font-semibold">Nenhum order bump criado</p>
          <p className="text-sm mt-1">Crie bumps para incentivar compras maiores.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bumps.map((b) => (
            <div key={b.id} className={`bg-white border rounded-2xl p-4 flex gap-3 transition-opacity ${!b.isActive ? "opacity-50" : ""}`}>
              {b.image && <img src={b.image} alt={b.title} className="w-14 h-14 rounded-xl object-cover flex-shrink-0 border border-border" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-sm text-orange-600">{b.title}</p>
                    <p className="text-xs text-muted-foreground">{productName(b.productId)}</p>
                    {b.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{b.description}</p>}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0 items-center">
                    <button
                      onClick={() => onToggle(b.id, !b.isActive)}
                      disabled={toggling === b.id}
                      className={`text-xs px-2.5 py-1 rounded-full font-semibold transition-colors ${b.isActive ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                    >
                      {toggling === b.id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : b.isActive ? "Ativo" : "Inativo"}
                    </button>
                    <button onClick={() => onEdit(b)} disabled={editingId === b.id} className="text-muted-foreground hover:text-blue-600 transition-colors p-1" title="Editar">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => onDelete(b.id)} disabled={deleting === b.id} className="text-muted-foreground hover:text-destructive transition-colors p-1">
                      {deleting === b.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">{discountTypeLabel(b.discountType)}</span>
                  <span className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">{bumpSummary(b)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-orange-50 border border-orange-100 rounded-2xl px-6 py-4 text-xs text-orange-700 space-y-1">
        <p className="font-semibold flex items-center gap-1"><Info className="w-3.5 h-3.5" />Como funciona</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>Bumps ativos aparecem abaixo do produto na loja com destaque laranja.</li>
          <li>O cliente pode aproveitar a oferta diretamente da página de produtos.</li>
          <li><strong>% de Desconto</strong>: ex. 20% off no preço do produto.</li>
          <li><strong>Desconto Fixo</strong>: ex. R$50 de desconto por unidade.</li>
          <li><strong>Pague X Leve Y</strong>: ex. pague 1 leve 2 unidades.</li>
          <li><strong>Preço por Quantidade</strong>: ex. cliente tem 1 no carrinho → "2 caixas no total" por +R$939 a mais. A qtd é o total final, o valor é o custo extra.</li>
        </ul>
      </div>
    </div>
  );
}

type TabType = "orders" | "charges" | "sellers" | "commissions" | "coupons" | "products" | "fretes" | "orderBumps" | "kyc" | "users" | "customers" | "recurringCustomers" | "support" | "inventory" | "webhook" | "configuracoes" | "socialProof" | "raffles" | "lojas";
type LojasSubTab = "criar" | "pedidos" | "cadastradas";
type FilialScopeSubTab = "pedidos" | "produtos" | "estoque";

const PRIMARY_ONLY_TABS = new Set<TabType>([
  "users",
  "coupons",
  "orderBumps",
  "socialProof",
  "raffles",
  "lojas",
]);

interface AdminRaffle {
  id: string; title: string; description: string | null; imageUrl: string | null;
  totalNumbers: number; pricePerNumber: string; reservationHours: number;
  status: string; createdAt: string; totalPaidAmount: string;
}
interface AdminRaffleReservation {
  id: string; raffleId: string; numbers: number[]; clientName: string;
  clientEmail: string; clientPhone: string; totalAmount: string;
  status: string; isExpired: boolean; expiresAt: string; createdAt: string;
  transactionId: string | null;
}
interface AdminRafflePromotion {
  id: string;
  raffleId: string;
  quantity: number;
  promoPrice: string;
  isActive: number;
  sortOrder: number;
}

interface AdminRaffleRankingEntry {
  clientName: string;
  clientPhone: string;
  totalNumbers: number;
  totalSpent: number;
  reservationCount: number;
}

interface AdminRaffleResult {
  winnerNumber: number;
  winnerClientName: string | null;
  winnerClientPhone: string | null;
  notes: string | null;
  drawnAt: string;
}

interface CustomerUserRecord {
  id: string; name: string; email: string; createdAt: string;
  orderCount: number; affiliateCode: string | null;
  phone?: string | null;
  hasAccount?: boolean;
}

interface RecurringCustomerRecord {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  firstOrderAt: string;
  lastOrderAt: string;
  orderCount: number;
  totalSpent: number;
  averageTicket: number;
  purchases: Array<{
    id: string;
    createdAt: string | null;
    total: number;
    status: string;
    products: Array<{ id: string; name: string; quantity: number; price?: number }>;
  }>;
}

interface SupportTicketRecord {
  id: string;
  orderId: string;
  clientDocument: string;
  clientName: string;
  trackingCode?: string | null;
  description: string;
  imageUrl: string | null;
  addressChange?: {
    cep: string;
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
  } | null;
  status: "open" | "resolved" | string;
  resolutionReason?: string | null;
  orderTotal: number | null;
  orderProducts?: Array<{ id: string; name: string; quantity: number; price?: number }>;
  orderCreatedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ReshipmentRecord {
  id: string;
  source: "support" | "manual" | string;
  orderId: string | null;
  supportTicketId: string | null;
  status: "reenvio_aguardando_estoque" | "reenvio_pronto_para_envio" | "reenvio_resolvido_sem_entrada" | "reenvio_enviado" | string;
  clientName: string;
  clientPhone: string | null;
  clientDocument: string | null;
  products: Array<{ id: string; name: string; quantity: number }>;
  resolvedReason: string | null;
  notes: string | null;
  authorizedAt: string | null;
  sentAt: string | null;
  createdAt: string | null;
}

interface InventoryBalanceRecord {
  productId: string;
  productName: string;
  quantity: number;
}

interface InventoryMovementRecord {
  id: string;
  productId: string;
  productName: string;
  type: string;
  entrySource?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  trackingCode?: string | null;
  quantity: number;
  reason: string | null;
  createdAt: string;
}

interface SellerCommissionPendingOrder {
  id: string;
  sellerCode: string | null;
  clientName: string;
  total: number;
  status: string;
  createdAt: string | null;
  sellerCommissionRateSnapshot: number;
  commissionAmount: number;
}

interface SellerCommissionPaymentBatch {
  id: string;
  sellerCode: string;
  orderIds: string[];
  periodStartDate: string | null;
  periodEndDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  totalAmount: number;
  orderCount: number;
  status: string;
  paymentMethod: string | null;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SocialProofSettings {
  id: number;
  enabled: boolean;
  showRealSales: boolean;
  showFakeCards: boolean;
  fakeAllProducts: boolean;
  fakeProductIds: string;
  delaySeconds: number;
  displaySeconds: number;
  cardBgColor: string;
  cardTextColor: string;
  badgeColor: string;
  autoGenerate: boolean;
  autoGenerateCount: number;
  realWindowHours: number;
}

interface SocialProofFakeEntry {
  id: number;
  firstName: string;
  city: string;
  state: string;
  productName: string;
}

interface ClientErrorEvent {
  id: string;
  receivedAt: string;
  type: string;
  message?: string;
  stack?: string;
  source?: string;
  pageUrl?: string;
  userAgent?: string;
  buildId?: string;
  isChunkLoadError?: boolean;
  componentStack?: string;
  ts: string;
}

interface AdminTenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  domain: string | null;
  dnsTargetHost?: string | null;
  adminUsername?: string | null;
  supplyMarginPercent?: number;
  supplyMarginFixedBrl?: number;
  syncProductsFromLoja1?: boolean;
  createdAt: string;
}

interface TenantProfitSummary {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  marginPercent: number;
  ordersCount: number;
  totalPaid: number;
  childRepasseCost: number;
  loja1EstimatedCost: number;
  loja1EstimatedProfit: number;
  childGrossProfit: number;
  groupEstimatedGrossProfit: number;
}

interface FilialPurchaseRequestItem {
  productId: string;
  productName: string;
  quantity: number;
  saleUnitPrice: number;
  repasseUnitCost: number;
}

interface FilialPurchaseRequest {
  id: string;
  filialTenantId: string;
  filialTenantName: string;
  orderId: string;
  status: string;
  clientName: string;
  orderTotal: number;
  repasseTotal: number;
  items: FilialPurchaseRequestItem[];
  loja1RealCostTotal: number;
  loja1RealProfit: number;
  updateProductCost?: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
  finalizedAt: string | null;
}

interface ManualFilialPurchaseItemDraft {
  productId: string;
  productName: string;
  quantity: number;
  repasseUnitCost: number;
  saleUnitPrice: number;
}

interface FilialStoreProduct {
  id: string;
  name: string;
  category: string;
  unit: string;
  price: number;
  costPrice: number;
  image: string | null;
  isActive: boolean;
  isSoldOut: boolean;
}

function filialPurchaseStatusLabel(status: string): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "pendente_pagamento_filial") return "Pendente pagamento da filial";
  if (normalized === "pago_na_filial") return "Pago na filial";
  if (normalized === "aguardando_compra_loja1") return "Aguardando compra Loja 1";
  if (normalized === "compra_registrada") return "Compra registrada";
  if (normalized === "estoque_lancado_filial") return "Estoque lançado na filial";
  if (normalized === "finalizado") return "Finalizado";
  if (normalized === "cancelado") return "Cancelado";
  return status || "-";
}

interface DnsGuideResponse {
  targetHost: string;
  envTargetHost: string | null;
  instructions: {
    host: string;
    type: "CNAME" | "ALIAS/A";
    name: string;
    value: string;
    note: string;
  } | null;
}

interface DnsCheckResponse {
  domain: string;
  targetHost: string;
  status: "configured" | "misconfigured" | "not_found";
  cnameMatch: boolean;
  aMatch: boolean;
  rootAliasFlattenedMatch?: boolean;
  dns: {
    cname: string[];
    a: string[];
    targetA: string[];
    nameservers: string[];
  };
  message: string;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function Admin() {

  // -------------------- TODOS OS useState DEVEM FICAR AQUI NO TOPO --------------------
  // Financial summary (gateway fees/liquido real)
  const [financialSummary, setFinancialSummary] = React.useState<null | {
    totalRevenue: number;
    totalGatewayFees: number;
    whatsappEconomy: number;
    totalWithdrawFees: number;
    totalMarketingExpenses: number;
    netRevenue: number;
    realNetRevenue: number;
    affiliateRepasseNetProfit?: number;
    affiliateRepasseTotal?: number;
    affiliateRepasseRealCostTotal?: number;
    affiliateRepasseCount?: number;
    marketingExpenses?: Array<{
      id: string;
      sellerCode?: string | null;
      expenseDate: string;
      expenseStartDate?: string;
      expenseEndDate?: string;
      channel: string;
      amount: number;
      note?: string | null;
      createdAt?: string;
    }>;
    marketingExpensesByChannel?: Array<{ channel: string; total: number }>;
    customerRecurrence?: {
      totalUniqueCustomers: number;
      recurringCustomers: number;
      newCustomers: number;
      recurringRate: number;
      newRate: number;
    };
  }>(null);
  const [financialSummaryLoading, setFinancialSummaryLoading] = React.useState(false);
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<TabType>("orders");
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [charges, setCharges] = useState<CustomCharge[]>([]);
  const [sellerAllOrders, setSellerAllOrders] = useState<AdminOrder[]>([]);
  const [sellerAllCharges, setSellerAllCharges] = useState<CustomCharge[]>([]);
  const [commissionPendingOrders, setCommissionPendingOrders] = useState<SellerCommissionPendingOrder[]>([]);
  const [commissionBatches, setCommissionBatches] = useState<SellerCommissionPaymentBatch[]>([]);
  const [commissionPaymentsLoading, setCommissionPaymentsLoading] = useState(false);
  const [commissionPaymentsCreating, setCommissionPaymentsCreating] = useState(false);
  const [commissionPaymentsPayingId, setCommissionPaymentsPayingId] = useState<string | null>(null);
  const [commissionSellerFilter, setCommissionSellerFilter] = useState("all");
  const [commissionDateFrom, setCommissionDateFrom] = useState("");
  const [commissionDateTo, setCommissionDateTo] = useState("");
  const [commissionSelectedOrderIds, setCommissionSelectedOrderIds] = useState<string[]>([]);
  const [commissionPaymentMethod, setCommissionPaymentMethod] = useState("pix");
  const [commissionPaymentNotes, setCommissionPaymentNotes] = useState("");
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [customerUsers, setCustomerUsers] = useState<CustomerUserRecord[]>([]);
  const [recurringCustomers, setRecurringCustomers] = useState<RecurringCustomerRecord[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicketRecord[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryBalances, setInventoryBalances] = useState<InventoryBalanceRecord[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovementRecord[]>([]);
  const [marketingExpenseForm, setMarketingExpenseForm] = useState({
    expenseStartDate: todayStr(),
    expenseEndDate: todayStr(),
    channel: "Facebook",
    amount: "",
    note: "",
  });
  const [marketingExpensesSubmitting, setMarketingExpensesSubmitting] = useState(false);
  const [marketingExpenseDeletingId, setMarketingExpenseDeletingId] = useState<string | null>(null);
  const [pendingReshipments, setPendingReshipments] = useState<ReshipmentRecord[]>([]);
  const [activeManualReturnItemId, setActiveManualReturnItemId] = useState<string | null>(null);
  const [inventoryEntryForm, setInventoryEntryForm] = useState({
    productId: "",
    quantity: "",
    reason: "",
    movementType: "entry" as "entry" | "exit",
    entrySource: "purchase" as "purchase" | "customer_return",
    clientName: "",
    clientPhone: "",
  });
  const [inventorySubmitting, setInventorySubmitting] = useState(false);
  const [manualReshipmentForm, setManualReshipmentForm] = useState({
    clientName: "",
    clientPhone: "",
    clientDocument: "",
    addressCep: "",
    addressStreet: "",
    addressNumber: "",
    addressComplement: "",
    addressNeighborhood: "",
    addressCity: "",
    addressState: "",
    productId: "",
    quantity: "",
    notes: "",
  });
  const [manualReshipmentSubmitting, setManualReshipmentSubmitting] = useState(false);
  const [reshipmentUpdatingId, setReshipmentUpdatingId] = useState<string | null>(null);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [recurringCustomersLoading, setRecurringCustomersLoading] = useState(false);
  const [customerImpersonatingId, setCustomerImpersonatingId] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [recurringCustomerSearch, setRecurringCustomerSearch] = useState("");
  const [exportingCustomersCSV, setExportingCustomersCSV] = useState(false);
  const [syncingCustomersBrevo, setSyncingCustomersBrevo] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportColumns, setExportColumns] = useState({
    name: true,
    email: true,
    phone: true,
    orderCount: true,
    affiliateCode: true,
    createdAt: true,
  });
  const [loading, setLoading] = useState(true);
  // Once set to true, the spinner never appears again for orders/charges —
  // background refreshes and filter changes update data silently in-place.
  const [ordersReady, setOrdersReady] = useState(false);
  const [chargesReady, setChargesReady] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isPrimary, setIsPrimary] = useState(getIsPrimary);
  const [currentUsername, setCurrentUsername] = useState(getAdminUsername);
  const [adminTenantId, setAdminTenantId] = useState(getAdminTenantId);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [sellerFilter, setSellerFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState(todayStr());
  const [dateTo, setDateTo] = useState(todayStr());
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotif, setShowNotif] = useState(false);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const [proofModal, setProofModal] = useState<string | null>(null);
  const [proofFile, setProofFile] = useState<string | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  // Charge management
  const [chargeStatusUpdating, setChargeStatusUpdating] = useState<string | null>(null);
  const [chargeProofModal, setChargeProofModal] = useState<string | null>(null);
  const [chargeProofFile, setChargeProofFile] = useState<string | null>(null);
  const [chargeProofUploading, setChargeProofUploading] = useState(false);
  const [webhookCopied, setWebhookCopied] = useState(false);
  // Order editing
  const [editOrderModal, setEditOrderModal] = useState<AdminOrder | null>(null);
  const [editItems, setEditItems] = useState<Array<{ id: string; name: string; quantity: number; price: number }>>([]);
  const [editAddress, setEditAddress] = useState({
    cep: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
  });
  const [editClientName, setEditClientName] = useState("");
  const [editDiscount, setEditDiscount] = useState(0);
  const [editProductSearch, setEditProductSearch] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editAsReshipment, setEditAsReshipment] = useState(false);
  const [editItemsBeforeReshipmentMode, setEditItemsBeforeReshipmentMode] = useState<Array<{ id: string; name: string; quantity: number; price: number }> | null>(null);
  const [editCatalog, setEditCatalog] = useState<AdminProduct[]>([]);
  const [editCatalogLoading, setEditCatalogLoading] = useState(false);
  // Diff PIX
  const [diffOrder, setDiffOrder] = useState<{ order: AdminOrder; diff: number; isPaid: boolean } | null>(null);
  const [diffPixResult, setDiffPixResult] = useState<{ pixCode: string; pixBase64: string; expiresAt: string } | null>(null);
  const [diffPixLoading, setDiffPixLoading] = useState(false);
  const [diffPixCopied, setDiffPixCopied] = useState(false);
  // Users tab
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newFullAccess, setNewFullAccess] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [userCreating, setUserCreating] = useState(false);
  const [userDeleting, setUserDeleting] = useState<string | null>(null);
  const [userAccessUpdating, setUserAccessUpdating] = useState<string | null>(null);
  const [userPasswordUpdating, setUserPasswordUpdating] = useState<string | null>(null);
  // Seller links
  const [sellerInput, setSellerInput] = useState("");
  const [sellerWhatsappInput, setSellerWhatsappInput] = useState("");
  const [sellerHasCommissionInput, setSellerHasCommissionInput] = useState(true);
  const [sellerCommissionRateInput, setSellerCommissionRateInput] = useState("5");
  const [sellerCommissionUpdatingSlug, setSellerCommissionUpdatingSlug] = useState<string | null>(null);
  const [sellers, setSellers] = useState<SavedSellerItem[]>([]);
  const [sellersLoading, setSellersLoading] = useState(false);
  const [copiedSeller, setCopiedSeller] = useState<string | null>(null);
  // Admin create charge modal
  const [createChargeOpen, setCreateChargeOpen] = useState(false);
  const [createChargeForm, setCreateChargeForm] = useState({ name: "", email: "", phone: "", document: "", amountRaw: "", description: "", cep: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "" });
  const [createChargeCepLoading, setCreateChargeCepLoading] = useState(false);
  const [createChargeSubmitting, setCreateChargeSubmitting] = useState(false);
  // Coupons
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponForm, setCouponForm] = useState({
    code: "", discountType: "percent", discountValue: "", minOrderValue: "", maxUses: "", eligibleProductIds: [] as string[],
  });
  const [couponCreating, setCouponCreating] = useState(false);
  const [couponDeleting, setCouponDeleting] = useState<string | null>(null);
  // Products
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productForm, setProductForm] = useState<Partial<AdminProduct> & { _editing?: boolean }>({});
  const [productSaving, setProductSaving] = useState(false);
  const [productDeleting, setProductDeleting] = useState<string | null>(null);
  const [productFormOpen, setProductFormOpen] = useState(false);
  // Card "mark as paid" modal
  const [cardPaidModal, setCardPaidModal] = useState<string | null>(null);
  const [cardPaidForm, setCardPaidForm] = useState({ installments: "", installmentValue: "", totalValue: "" });
  const [cardPaidSubmitting, setCardPaidSubmitting] = useState(false);
  // KYC modal (per-order detail)
  const [kycModal, setKycModal] = useState<string | null>(null);
  const [kycData, setKycData] = useState<KycDocument | null>(null);
  const [kycLoading, setKycLoading] = useState(false);
  const [kycEditForm, setKycEditForm] = useState({ declarationProduct: "", declarationCompanyName: "", declarationCompanyCnpj: "", declarationPurchaseValue: "", declarationDate: "" });
  const [kycEditSaving, setKycEditSaving] = useState(false);
  const [kycLinkCopied, setKycLinkCopied] = useState(false);
  // KYC tab (list)
  const [kycList, setKycList] = useState<KycListItem[]>([]);
  const [kycListLoading, setKycListLoading] = useState(false);
  const [kycListSearch, setKycListSearch] = useState("");
  const [kycListStatus, setKycListStatus] = useState("all");
  const [kycStatusUpdating, setKycStatusUpdating] = useState<string | null>(null);
  // Social Proof
  const [spSettings, setSpSettings] = useState<SocialProofSettings | null>(null);
  const [spSettingsLoading, setSpSettingsLoading] = useState(false);
  const [spSettingsSaving, setSpSettingsSaving] = useState(false);
  const [spAutoCount, setSpAutoCount] = useState<number | null>(null);
  const [spAutoGenerating, setSpAutoGenerating] = useState(false);
  const [spFakeEntries, setSpFakeEntries] = useState<SocialProofFakeEntry[]>([]);
  const [spFakeEntriesLoading, setSpFakeEntriesLoading] = useState(false);
  const [spFakeForm, setSpFakeForm] = useState({ firstName: "", city: "", state: "", productName: "" });
  const [spFakeCreating, setSpFakeCreating] = useState(false);
  const [spFakeEditingId, setSpFakeEditingId] = useState<number | null>(null);
  const [spFakeDeleting, setSpFakeDeleting] = useState<number | null>(null);
  const [spRealEntries, setSpRealEntries] = useState<Array<{ firstName: string; city: string; state: string; productName: string }>>([]);
  const [spFakeProductIds, setSpFakeProductIds] = useState<string[]>([]);
  // Raffles (rifas)
  const [rafflesList, setRafflesList] = useState<AdminRaffle[]>([]);
  const [rafflesLoading, setRafflesLoading] = useState(false);
  const [raffleForm, setRaffleForm] = useState({ title: "", description: "", imageUrl: "", totalNumbers: "100", pricePerNumber: "10", reservationHours: "24", status: "active" });
  const [raffleCreating, setRaffleCreating] = useState(false);
  const [raffleEditingId, setRaffleEditingId] = useState<string | null>(null);
  const [raffleViewId, setRaffleViewId] = useState<string | null>(null);
  const [raffleReservations, setRaffleReservations] = useState<AdminRaffleReservation[]>([]);
  const [raffleReservationsLoading, setRaffleReservationsLoading] = useState(false);
  const [raffleCancelingReservationId, setRaffleCancelingReservationId] = useState<string | null>(null);
  const [rafflePromotions, setRafflePromotions] = useState<AdminRafflePromotion[]>([]);
  const [rafflePromotionForm, setRafflePromotionForm] = useState({ quantity: "", promoPrice: "", sortOrder: "0", isActive: true });
  const [rafflePromotionSaving, setRafflePromotionSaving] = useState(false);
  const [raffleRanking, setRaffleRanking] = useState<AdminRaffleRankingEntry[]>([]);
  const [raffleResult, setRaffleResult] = useState<AdminRaffleResult | null>(null);
  const [raffleResultLoading, setRaffleResultLoading] = useState(false);
  const [raffleSavingResult, setRaffleSavingResult] = useState(false);
  const [raffleDrawForm, setRaffleDrawForm] = useState({ winnerNumber: "", notes: "" });
  const [raffleDeleteConfirm, setRaffleDeleteConfirm] = useState<{ id: string; title: string } | null>(null);
  const [raffleDeleteInput, setRaffleDeleteInput] = useState("");
  const [raffleDeleting, setRaffleDeleting] = useState(false);
  // Shipping options (fretes)
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
  const [shippingForm, setShippingForm] = useState({ name: "", description: "", price: "", sortOrder: "0" });
  const [shippingCreating, setShippingCreating] = useState(false);
  const [shippingDeleting, setShippingDeleting] = useState<string | null>(null);
  const [shippingEditing, setShippingEditing] = useState<ShippingOption | null>(null);
  const [shippingUpdating, setShippingUpdating] = useState<string | null>(null);
  // Order Bumps
  const [orderBumps, setOrderBumps] = useState<OrderBump[]>([]);
  const [bumpForm, setBumpForm] = useState<BumpFormType>(EMPTY_BUMP_FORM);
  const [bumpCreating, setBumpCreating] = useState(false);
  const [bumpToggling, setBumpToggling] = useState<string | null>(null);
  const [bumpDeleting, setBumpDeleting] = useState<string | null>(null);
  const [bumpEditingId, setBumpEditingId] = useState<string | null>(null);
  const selectedRaffle = raffleViewId ? rafflesList.find((r) => r.id === raffleViewId) ?? null : null;
  const raffleViewPaidAmount = raffleReservations
    .filter((reservation) => reservation.status === "paid")
    .reduce((sum, reservation) => sum + Number(reservation.totalAmount), 0);
  const raffleViewPaidCount = raffleReservations.filter((reservation) => reservation.status === "paid").length;
  const [bumpUpdating, setBumpUpdating] = useState(false);
  // Proof viewer modal
  const [proofViewer, setProofViewer] = useState<string | null>(null);
  // Stats dashboard filters (independent of the orders/charges tab filters)
  const [statsDateFrom, setStatsDateFrom] = useState(todayStr());
  const [statsDateTo, setStatsDateTo]   = useState(todayStr());
  const [statsSeller, setStatsSeller]   = useState("all");
  const [affiliateRepasseDateBasis, setAffiliateRepasseDateBasis] = useState<"purchaseRecordedAt" | "createdAt">("purchaseRecordedAt");
  // Stats data fetched independently from the API
  const [statsOrdersData, setStatsOrdersData] = useState<AdminOrder[]>([]);
  const [statsChargesData, setStatsChargesData] = useState<CustomCharge[]>([]);
  const [statsProductsData, setStatsProductsData] = useState<AdminProduct[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  // Site settings (logo, banners)
  const [settings, setSettings]         = useState<Record<string, string>>({});
  const [settingsLoading, setSettingsLoading] = useState<Record<string, boolean>>({});
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [tenantCreating, setTenantCreating] = useState(false);
  const [tenantDeletingId, setTenantDeletingId] = useState<string | null>(null);
  const [tenantDnsTargetSavingId, setTenantDnsTargetSavingId] = useState<string | null>(null);
  const [tenantDnsTargetDrafts, setTenantDnsTargetDrafts] = useState<Record<string, string>>({});
  const [tenantSupplyMarginDrafts, setTenantSupplyMarginDrafts] = useState<Record<string, string>>({});
  const [tenantSupplyFixedMarginDrafts, setTenantSupplyFixedMarginDrafts] = useState<Record<string, string>>({});
  const [tenantSupplyMarginSavingId, setTenantSupplyMarginSavingId] = useState<string | null>(null);
  const [tenantProfitSummary, setTenantProfitSummary] = useState<TenantProfitSummary[]>([]);
  const [tenantProfitLoading, setTenantProfitLoading] = useState(false);
  const [lojasSubTab, setLojasSubTab] = useState<LojasSubTab>("criar");
  const [filialScopeSubTab, setFilialScopeSubTab] = useState<FilialScopeSubTab>("pedidos");
  const [selectedFilialTenantId, setSelectedFilialTenantId] = useState("");
  const [filialPurchaseRequests, setFilialPurchaseRequests] = useState<FilialPurchaseRequest[]>([]);
  const [filialPurchaseLoading, setFilialPurchaseLoading] = useState(false);
  const [filialPurchaseConfirmingId, setFilialPurchaseConfirmingId] = useState<string | null>(null);
  const [filialPurchaseDeletingId, setFilialPurchaseDeletingId] = useState<string | null>(null);
  const [filialPurchaseCostDrafts, setFilialPurchaseCostDrafts] = useState<Record<string, Record<string, string>>>({});
  const [filialPurchaseUpdateCostFlags, setFilialPurchaseUpdateCostFlags] = useState<Record<string, boolean>>({});
  const [filialPurchaseOpenId, setFilialPurchaseOpenId] = useState<string | null>(null);
  const [manualFilialClientName, setManualFilialClientName] = useState("Compra manual da filial");
  const [manualFilialProductId, setManualFilialProductId] = useState("");
  const [manualFilialQuantity, setManualFilialQuantity] = useState("1");
  const [manualFilialRepasseUnitCost, setManualFilialRepasseUnitCost] = useState("");
  const [manualFilialItems, setManualFilialItems] = useState<ManualFilialPurchaseItemDraft[]>([]);
  const [manualFilialSubmitting, setManualFilialSubmitting] = useState(false);
  const [filialPurchaseMarkPaidId, setFilialPurchaseMarkPaidId] = useState<string | null>(null);
  const [manualFilialNewProductName, setManualFilialNewProductName] = useState("");
  const [manualFilialNewProductCategory, setManualFilialNewProductCategory] = useState("Geral");
  const [manualFilialNewProductUnit, setManualFilialNewProductUnit] = useState("unidade");
  const [manualFilialNewProductPrice, setManualFilialNewProductPrice] = useState("");
  const [manualFilialNewProductCost, setManualFilialNewProductCost] = useState("");
  const [manualFilialCreatingProduct, setManualFilialCreatingProduct] = useState(false);
  const [filialStoreProducts, setFilialStoreProducts] = useState<FilialStoreProduct[]>([]);
  const [filialStoreProductsLoading, setFilialStoreProductsLoading] = useState(false);
  const [filialStoreProductsSearch, setFilialStoreProductsSearch] = useState("");
  const [filialStoreCostDrafts, setFilialStoreCostDrafts] = useState<Record<string, string>>({});
  const [filialStoreCostSavingId, setFilialStoreCostSavingId] = useState<string | null>(null);
  const [filialInventoryBalances, setFilialInventoryBalances] = useState<InventoryBalanceRecord[]>([]);
  const [filialInventoryLoading, setFilialInventoryLoading] = useState(false);
  const [filialInventorySearch, setFilialInventorySearch] = useState("");
  const [tenantAdminSavingId, setTenantAdminSavingId] = useState<string | null>(null);
  const [tenantAdminUsernameDrafts, setTenantAdminUsernameDrafts] = useState<Record<string, string>>({});
  const [tenantAdminPasswordDrafts, setTenantAdminPasswordDrafts] = useState<Record<string, string>>({});
  const [tenantProductSyncRefreshingId, setTenantProductSyncRefreshingId] = useState<string | null>(null);
  const [tenantProductSyncClearingId, setTenantProductSyncClearingId] = useState<string | null>(null);
  const [tenantForm, setTenantForm] = useState({
    name: "",
    slug: "",
    domain: "",
    dnsTargetHost: "",
    siteName: "",
    supportWhatsapp: "",
    adminUsername: "",
    createAdminUser: false,
    newAdminUsername: "",
    newAdminPassword: "",
    cloneSettingsFromDefault: true,
  });
  const [dnsDomainInput, setDnsDomainInput] = useState("");
  const [dnsGuide, setDnsGuide] = useState<DnsGuideResponse | null>(null);
  const [dnsGuideLoading, setDnsGuideLoading] = useState(false);
  const [dnsCheckLoading, setDnsCheckLoading] = useState(false);
  const [dnsCheckResult, setDnsCheckResult] = useState<DnsCheckResponse | null>(null);
  const [brevoApiKey, setBrevoApiKey] = useState("");
  const [brevoConfigured, setBrevoConfigured] = useState(false);
  const [brevoTesting, setBrevoTesting] = useState(false);
  const [clientErrors, setClientErrors] = useState<ClientErrorEvent[]>([]);
  const [clientErrorsLoading, setClientErrorsLoading] = useState(false);
  const sseRef = useRef<EventSource | null>(null);
  const sseReconnectTimerRef = useRef<number | null>(null);
  const sseUnauthorizedRef = useRef(false);
  const sseCookieMismatchNotifiedRef = useRef(false);
  const swRef  = useRef<ServiceWorkerRegistration | null>(null);
  // Live Visitors Tracking
  const [liveStats, setLiveStats] = useState({ catalog: 0, checkout: 0 });
  const canManageTenants = isPrimary && adminTenantId === "tenant_loja1";
  const canManageProductsTab = isPrimary || adminTenantId !== "tenant_loja1";
  const canManageInventoryTab = isPrimary || adminTenantId !== "tenant_loja1";
  const canManageShippingTab = isPrimary || adminTenantId !== "tenant_loja1";
  const canManageSellerLinks = isPrimary || adminTenantId !== "tenant_loja1";
  const filialTenantOptions = tenants.filter((tenant) => tenant.id !== "tenant_loja1");
  const selectedFilialTenant = filialTenantOptions.find((tenant) => tenant.id === selectedFilialTenantId) || null;
  const filteredFilialPurchaseRequests = selectedFilialTenantId
    ? filialPurchaseRequests.filter((request) => request.filialTenantId === selectedFilialTenantId)
    : filialPurchaseRequests;
  const selectedManualFilialProduct = filialStoreProducts.find((product) => product.id === manualFilialProductId) || null;
  const manualFilialSelectableProducts: BumpProduct[] = filialStoreProducts.map((product) => ({
    id: product.id,
    name: `${product.name} · ${formatCurrency(product.price)}`,
    image: product.image,
  }));
  const selectedFilialMarginPercent = (() => {
    const raw = tenantSupplyMarginDrafts[selectedFilialTenantId] ?? selectedFilialTenant?.supplyMarginPercent ?? 0;
    const parsed = Number(String(raw).replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  })();
  const selectedFilialMarginFixedBrl = (() => {
    const raw = tenantSupplyFixedMarginDrafts[selectedFilialTenantId] ?? selectedFilialTenant?.supplyMarginFixedBrl ?? 0;
    const parsed = Number(String(raw).replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  })();
  const manualFilialBaseUnitCost = Number(String(manualFilialRepasseUnitCost || "").replace(",", "."));
  const manualFilialComputedRepasseUnitCost = Number.isFinite(manualFilialBaseUnitCost) && manualFilialBaseUnitCost >= 0
    ? Number((manualFilialBaseUnitCost * (1 + (selectedFilialMarginPercent / 100)) + selectedFilialMarginFixedBrl).toFixed(2))
    : null;
  const manualFilialTotal = manualFilialItems.reduce((sum, item) => sum + (item.repasseUnitCost * item.quantity), 0);
  const filteredFilialStoreProducts = filialStoreProducts.filter((product) => {
    const query = filialStoreProductsSearch.trim().toLowerCase();
    if (!query) return true;
    const haystack = `${product.name} ${product.category} ${product.id}`.toLowerCase();
    return haystack.includes(query);
  });
  const filialInventoryQtyByProductId = new Map(
    filialInventoryBalances.map((row) => [String(row.productId || ""), Number(row.quantity || 0)]),
  );
  const filteredFilialInventoryBalances = filialInventoryBalances.filter((row) => {
    const query = filialInventorySearch.trim().toLowerCase();
    if (!query) return true;
    const haystack = `${row.productName} ${row.productId}`.toLowerCase();
    return haystack.includes(query);
  });

  // -------------------- FIM DOS useState --------------------

  // Agora sim, pode declarar os useCallback, useEffect, etc, que dependem dos states acima
  const fetchFinancialSummary = React.useCallback(async () => {
    setFinancialSummaryLoading(true);
    try {
      const params = new URLSearchParams({ dateFrom: statsDateFrom, dateTo: statsDateTo });
      if (statsSeller !== "all") params.set("sellerCode", statsSeller);
      params.set("repasseDateBasis", affiliateRepasseDateBasis);
      const res = await fetch(`${BASE}/api/admin/financial-summary?${params}`, { headers: authHeaders() });
      if (res.ok) {
        setFinancialSummary(await res.json());
      }
    } catch {}
    setFinancialSummaryLoading(false);
  }, [affiliateRepasseDateBasis, statsDateFrom, statsDateTo, statsSeller]);
  const handleAddMarketingExpense = React.useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const amount = Number(String(marketingExpenseForm.amount).replace(",", "."));
    if (!marketingExpenseForm.expenseStartDate || !marketingExpenseForm.expenseEndDate || !marketingExpenseForm.channel.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast.error("Preencha data inicial, final, canal e valor do gasto.");
      return;
    }

    if (marketingExpenseForm.expenseEndDate < marketingExpenseForm.expenseStartDate) {
      toast.error("A data final deve ser igual ou posterior à data inicial.");
      return;
    }

    setMarketingExpensesSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/admin/marketing-expenses`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          expenseStartDate: marketingExpenseForm.expenseStartDate,
          expenseEndDate: marketingExpenseForm.expenseEndDate,
          channel: marketingExpenseForm.channel.trim(),
          amount,
          note: marketingExpenseForm.note.trim(),
        }),
      });

      const data = await res.json().catch(() => null) as { message?: string } | null;
      if (!res.ok) {
        toast.error(data?.message || "Erro ao registrar gasto.");
        return;
      }

      setMarketingExpenseForm((current) => ({
        ...current,
        amount: "",
        note: "",
      }));
      toast.success("Gasto adicionado com sucesso.");
      fetchFinancialSummary();
    } catch {
      toast.error("Erro ao registrar gasto.");
    } finally {
      setMarketingExpensesSubmitting(false);
    }
  }, [BASE, fetchFinancialSummary, marketingExpenseForm]);

  const handleDeleteMarketingExpense = React.useCallback(async (expenseId: string) => {
    if (!expenseId) return;
    if (!window.confirm("Remover este gasto de marketing?")) return;

    setMarketingExpenseDeletingId(expenseId);
    try {
      const res = await fetch(`${BASE}/api/admin/marketing-expenses/${expenseId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      const data = await res.json().catch(() => null) as { message?: string } | null;
      if (!res.ok) {
        toast.error(data?.message || "Erro ao remover gasto.");
        return;
      }

      toast.success("Gasto removido com sucesso.");
      fetchFinancialSummary();
    } catch {
      toast.error("Erro ao remover gasto.");
    } finally {
      setMarketingExpenseDeletingId(null);
    }
  }, [BASE, fetchFinancialSummary]);

  useEffect(() => {
    if (!authChecked || !getToken()) return;
    const fetchLive = () => {
      fetch(`${BASE}/api/admin/tracking/live`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((data) => {
          if (typeof data.catalog === "number" && typeof data.checkout === "number") {
            setLiveStats(data);
          }
        })
        .catch(() => {});
    };
    fetchLive();
    const intv = setInterval(fetchLive, 5000);
    return () => clearInterval(intv);
  }, [authChecked]);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const webhookUrl  = `${window.location.origin}${BASE}/api/webhook/pix`;

  // -------------------------------------------------------------------------
  // Push notifications via Service Worker
  // -------------------------------------------------------------------------
  const requestNotifPermission = useCallback(async () => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") return;
    const perm = await Notification.requestPermission();
    if (perm === "granted") toast.success("Notificações ativadas!");
    else toast.info("Notificações bloqueadas. Ative nas configurações do browser.");
  }, []);

  const showPushNotification = useCallback(async (title: string, body: string) => {
    if (Notification.permission !== "granted") return;
    try {
      if (swRef.current) {
        await swRef.current.showNotification(title, {
          body, icon: "/favicon.svg", badge: "/favicon.svg",
          vibrate: [200, 100, 200], tag: "ka-imports-admin", renotify: true,
        });
      } else {
        new Notification(title, { body, icon: "/favicon.svg" });
      }
    } catch { /* ignore */ }
  }, []);

  // Register SW
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${BASE}/sw.js`)
        .then((reg) => { swRef.current = reg; })
        .catch(() => { /* SW not critical */ });
    }
  }, []);

  // -------------------------------------------------------------------------
  // Auth check
  // -------------------------------------------------------------------------
  const handleUnauthorized = useCallback(() => {
    if (sseReconnectTimerRef.current !== null) {
      window.clearTimeout(sseReconnectTimerRef.current);
      sseReconnectTimerRef.current = null;
    }
    sseRef.current?.close();
    sseUnauthorizedRef.current = true;
    sessionStorage.removeItem("adminToken");
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminIsPrimary");
    localStorage.removeItem("adminUsername");
    localStorage.removeItem("adminTenantId");
    setAdminTenantId("tenant_loja1");
    setLocation("/admin/login");
  }, [setLocation]);

  // -------------------------------------------------------------------------
  // Fetch helpers
  // -------------------------------------------------------------------------
  const fetchOrders = useCallback(async (_silent?: boolean) => {
    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (methodFilter !== "all") params.set("paymentMethod", methodFilter);
      if (sellerFilter !== "all") params.set("sellerCode", sellerFilter);
      if (groupFilter !== "all") params.set("whatsappGroup", groupFilter);
      const res = await fetch(`${BASE}/api/admin/orders?${params}`, {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json() as { orders: AdminOrder[] };
      setOrders(data.orders || []);
      setOrdersReady(true);
    } catch { /* silent — don't show toast for background refreshes */ }
  }, [dateFrom, dateTo, statusFilter, methodFilter, sellerFilter, groupFilter, handleUnauthorized]);

  const fetchCharges = useCallback(async (_silent?: boolean) => {
    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (sellerFilter !== "all") params.set("sellerCode", sellerFilter);
      const res = await fetch(`${BASE}/api/admin/custom-charges?${params}`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json() as { charges: CustomCharge[] };
      setCharges(data.charges || []);
      setChargesReady(true);
    } catch { /* silent */ }
  }, [dateFrom, dateTo, statusFilter, sellerFilter, handleUnauthorized]);

  const fetchSellerData = useCallback(async () => {
    try {
      const [ordRes, chgRes] = await Promise.all([
        fetch(`${BASE}/api/admin/orders`, { headers: authHeaders() }),
        fetch(`${BASE}/api/admin/custom-charges`, { headers: authHeaders() }),
      ]);
      if (ordRes.status === 401 || chgRes.status === 401) { handleUnauthorized(); return; }
      const [ordData, chgData] = await Promise.all([
        ordRes.json() as Promise<{ orders: AdminOrder[] }>,
        chgRes.json() as Promise<{ charges: CustomCharge[] }>,
      ]);
      setSellerAllOrders(ordData.orders || []);
      setSellerAllCharges(chgData.charges || []);
    } catch { /* silent */ }
  }, [handleUnauthorized]);

  const fetchCommissionPayments = useCallback(async () => {
    setCommissionPaymentsLoading(true);
    try {
      const params = new URLSearchParams();
      if (commissionSellerFilter !== "all") params.set("sellerCode", commissionSellerFilter);
      if (commissionDateFrom) params.set("dateFrom", commissionDateFrom);
      if (commissionDateTo) params.set("dateTo", commissionDateTo);
      const res = await fetch(`${BASE}/api/admin/seller-commission-payments?${params.toString()}`, { headers: authHeaders(), cache: "no-store" });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok) {
        const errData = await res.json().catch(() => null) as { message?: string } | null;
        toast.error(errData?.message || "Erro ao carregar comissões pendentes.");
        return;
      }
      const data = await res.json() as {
        pendingOrders: SellerCommissionPendingOrder[];
        batches: SellerCommissionPaymentBatch[];
      };
      setCommissionPendingOrders(data.pendingOrders || []);
      setCommissionBatches(data.batches || []);
      setCommissionSelectedOrderIds((data.pendingOrders || []).map((order) => order.id));
      const uniqueSellerCodes = Array.from(new Set((data.pendingOrders || []).map((order) => String(order.sellerCode || "").trim()).filter(Boolean)));
      if (commissionSellerFilter === "all" && uniqueSellerCodes.length === 1) {
        setCommissionSellerFilter(uniqueSellerCodes[0]);
      }
    } catch {
      toast.error("Erro ao carregar comissões pendentes.");
    }
    finally { setCommissionPaymentsLoading(false); }
  }, [commissionSellerFilter, commissionDateFrom, commissionDateTo, handleUnauthorized]);

  const createCommissionPaymentBatch = useCallback(async () => {
    if (commissionSelectedOrderIds.length === 0) {
      toast.error("Selecione ao menos um pedido elegível.");
      return;
    }
    if (commissionSellerFilter === "all") {
      toast.error("Selecione um vendedor para criar o lote.");
      return;
    }

    setCommissionPaymentsCreating(true);
    try {
      const res = await fetch(`${BASE}/api/admin/seller-commission-payments`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          sellerCode: commissionSellerFilter,
          dateFrom: commissionDateFrom,
          dateTo: commissionDateTo,
          orderIds: commissionSelectedOrderIds,
        }),
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json().catch(() => null) as { error?: string; message?: string; batch?: SellerCommissionPaymentBatch } | null;
      if (!res.ok) {
        toast.error(data?.message || "Erro ao criar lote de comissão.");
        return;
      }
      toast.success("Lote de comissão criado.");
      setCommissionPaymentNotes("");
      await fetchCommissionPayments();
    } catch {
      toast.error("Erro ao criar lote de comissão.");
    } finally {
      setCommissionPaymentsCreating(false);
    }
  }, [commissionSelectedOrderIds, commissionSellerFilter, commissionDateFrom, commissionDateTo, handleUnauthorized, fetchCommissionPayments]);

  const markCommissionBatchPaid = useCallback(async (batchId: string) => {
    setCommissionPaymentsPayingId(batchId);
    try {
      const res = await fetch(`${BASE}/api/admin/seller-commission-payments/${batchId}/pay`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: commissionPaymentMethod, notes: commissionPaymentNotes }),
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { message?: string } | null;
        toast.error(data?.message || "Erro ao marcar lote como pago.");
        return;
      }
      toast.success("Lote marcado como pago.");
      await fetchCommissionPayments();
    } catch {
      toast.error("Erro ao marcar lote como pago.");
    } finally {
      setCommissionPaymentsPayingId(null);
    }
  }, [commissionPaymentMethod, commissionPaymentNotes, handleUnauthorized, fetchCommissionPayments]);

  const fetchStatsData = useCallback(async () => {
    setStatsLoading(true);
    try {
      const ordParams = new URLSearchParams({ dateFrom: statsDateFrom, dateTo: statsDateTo });
      ordParams.set("pinReshipments", "0");
      if (statsSeller !== "all") ordParams.set("sellerCode", statsSeller);
      const chgParams = new URLSearchParams({ dateFrom: statsDateFrom, dateTo: statsDateTo });
      if (statsSeller !== "all") chgParams.set("sellerCode", statsSeller);
      const [ordRes, chgRes, prodRes] = await Promise.all([
        fetch(`${BASE}/api/admin/orders?${ordParams}`, { headers: authHeaders() }),
        fetch(`${BASE}/api/admin/custom-charges?${chgParams}`, { headers: authHeaders() }),
        fetch(`${BASE}/api/admin/products`, { headers: authHeaders() }),
      ]);
      if (ordRes.status === 401 || chgRes.status === 401 || prodRes.status === 401) { handleUnauthorized(); return; }
      const [ordData, chgData, prodData] = await Promise.all([
        ordRes.json() as Promise<{ orders: AdminOrder[] }>,
        chgRes.json() as Promise<{ charges: CustomCharge[] }>,
        prodRes.json() as Promise<{ products: AdminProduct[] }>,
      ]);
      setStatsOrdersData(ordData.orders || []);
      setStatsChargesData(chgData.charges || []);
      setStatsProductsData(prodData.products || []);
    } catch { /* silent */ }
    finally { setStatsLoading(false); }
  }, [statsDateFrom, statsDateTo, statsSeller, handleUnauthorized]);

  const fetchUsers = useCallback(async () => {
    if (!isPrimary) return;
    try {
      const res = await fetch(`${BASE}/api/admin/users`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json() as { users: AdminUser[] };
      setAdminUsers(data.users || []);
    } catch { /* ignore */ }
  }, [isPrimary]);

  const fetchCustomers = useCallback(async () => {
    setCustomersLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/customers`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json() as { customers: CustomerUserRecord[] };
      setCustomerUsers(data.customers || []);
    } catch { /* ignore */ }
    finally { setCustomersLoading(false); }
  }, []);

  const fetchRecurringCustomers = useCallback(async () => {
    setRecurringCustomersLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/customers/recurring`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json() as { recurringCustomers: RecurringCustomerRecord[] };
      setRecurringCustomers(data.recurringCustomers || []);
    } catch { /* ignore */ }
    finally { setRecurringCustomersLoading(false); }
  }, []);

  const impersonateCustomerAccount = useCallback(async (customer: CustomerUserRecord) => {
    if (!isPrimary) {
      toast.error("Apenas administrador principal pode entrar na conta do cliente.");
      return;
    }
    if (!customer.hasAccount) {
      toast.error("Este comprador não possui conta cadastrada (compra como convidado).");
      return;
    }

    const customerWindow = window.open("about:blank", "_blank");
    setCustomerImpersonatingId(customer.id);
    try {
      const res = await fetch(`${BASE}/api/admin/customers/${customer.id}/impersonate`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await res.json() as {
        token?: string;
        message?: string;
      };

      if (!res.ok || !data.token) {
        if (customerWindow && !customerWindow.closed) customerWindow.close();
        toast.error(data.message || "Não foi possível entrar na conta deste cliente.");
        return;
      }

      localStorage.setItem("customerToken", data.token);
      if (customerWindow && !customerWindow.closed) {
        customerWindow.location.href = `${BASE}/minha-conta/pedidos`;
      } else {
        window.open(`${BASE}/minha-conta/pedidos`, "_blank");
      }
      toast.success(`Entrando na conta de ${customer.name}.`);
    } catch {
      if (customerWindow && !customerWindow.closed) customerWindow.close();
      toast.error("Erro ao entrar na conta do cliente.");
    } finally {
      setCustomerImpersonatingId(null);
    }
  }, [isPrimary]);

  const handleExportCustomersCSV = useCallback(async () => {
    setExportingCustomersCSV(true);
    try {
      const headers = [
        exportColumns.name && "Nome",
        exportColumns.email && "E-mail",
        exportColumns.phone && "Telefone",
        exportColumns.orderCount && "Pedidos",
        exportColumns.affiliateCode && "Código Afiliado",
        exportColumns.createdAt && "Data Cadastro",
      ]
        .filter(Boolean)
        .map((f) => `"${f}"`)
        .join(";");
      
      const csvRows = [
        headers,
        ...customerUsers.map(c => [
          exportColumns.name && c.name,
          exportColumns.email && c.email,
          exportColumns.phone && (c.phone || ''),
          exportColumns.orderCount && c.orderCount,
          exportColumns.affiliateCode && (c.affiliateCode || ''),
          exportColumns.createdAt && new Date(c.createdAt).toLocaleDateString('pt-BR'),
        ]
          .filter(v => v !== false)
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
          .join(";"))
      ];
      const csv = csvRows.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `clientes_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success('Clientes exportados com sucesso!');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao exportar clientes.');
    } finally {
      setExportingCustomersCSV(false);
    }
  }, [customerUsers, exportColumns]);

  const handleSyncCustomersBrevo = useCallback(async () => {
    setSyncingCustomersBrevo(true);
    try {
      const res = await fetch(`${BASE}/api/admin/brevo/sync-customers`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      const data = await res.json() as { ok?: boolean; synced?: number; failed?: number; error?: string; message?: string };
      if (!res.ok || !data.ok) {
        toast.error(data.message || data.error || 'Erro ao sincronizar com Brevo.');
        return;
      }
      const synced = Number(data.synced || 0);
      toast.success(`Sincronizados ${synced} cliente${synced === 1 ? "" : "s"} com Brevo!`);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao sincronizar com Brevo.');
    } finally {
      setSyncingCustomersBrevo(false);
    }
  }, []);
  const fetchSupportTickets = useCallback(async () => {
    setSupportLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/support-tickets`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok) return;
      const data = await res.json() as { tickets: SupportTicketRecord[] };
      setSupportTickets(data.tickets || []);
    } catch {
      // silent
    } finally {
      setSupportLoading(false);
    }
  }, [handleUnauthorized]);

  const fetchInventoryOverview = useCallback(async () => {
    setInventoryLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/inventory/overview`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok) return;
      const data = await res.json() as {
        balances: InventoryBalanceRecord[];
        movements: InventoryMovementRecord[];
        pendingReshipments: ReshipmentRecord[];
      };
      setInventoryBalances(data.balances || []);
      setInventoryMovements(data.movements || []);
      setPendingReshipments(data.pendingReshipments || []);
    } catch {
      // silent
    } finally {
      setInventoryLoading(false);
    }
  }, [handleUnauthorized]);

  const createManualReshipment = useCallback(async () => {
    const payload = {
      clientName: String(manualReshipmentForm.clientName || "").trim(),
      clientPhone: String(manualReshipmentForm.clientPhone || "").trim(),
      clientDocument: String(manualReshipmentForm.clientDocument || "").trim(),
      addressCep: String(manualReshipmentForm.addressCep || "").trim(),
      addressStreet: String(manualReshipmentForm.addressStreet || "").trim(),
      addressNumber: String(manualReshipmentForm.addressNumber || "").trim(),
      addressComplement: String(manualReshipmentForm.addressComplement || "").trim(),
      addressNeighborhood: String(manualReshipmentForm.addressNeighborhood || "").trim(),
      addressCity: String(manualReshipmentForm.addressCity || "").trim(),
      addressState: String(manualReshipmentForm.addressState || "").trim(),
      productId: String(manualReshipmentForm.productId || "").trim(),
      quantity: Number(manualReshipmentForm.quantity || 0),
      notes: String(manualReshipmentForm.notes || "").trim(),
    };

    if (
      !payload.clientName ||
      !payload.clientPhone ||
      !payload.addressCep ||
      !payload.addressStreet ||
      !payload.addressNumber ||
      !payload.addressNeighborhood ||
      !payload.addressCity ||
      !payload.addressState ||
      !payload.productId ||
      !Number.isFinite(payload.quantity) ||
      payload.quantity <= 0
    ) {
      toast.error("Preencha todos os campos obrigatórios do reenvio manual.");
      return;
    }

    setManualReshipmentSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/admin/reshipments/manual`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });

      if (res.status === 401) { handleUnauthorized(); return; }

      const data = await res.json().catch(() => ({} as { message?: string; status?: string }));
      if (!res.ok) {
        toast.error((data as { message?: string }).message || "Erro ao criar reenvio manual.");
        return;
      }

      setManualReshipmentForm({
        clientName: "",
        clientPhone: "",
        clientDocument: "",
        addressCep: "",
        addressStreet: "",
        addressNumber: "",
        addressComplement: "",
        addressNeighborhood: "",
        addressCity: "",
        addressState: "",
        productId: "",
        quantity: "",
        notes: "",
      });

      fetchInventoryOverview();
      const status = String((data as { status?: string }).status || "");
      if (status === "reenvio_pronto_para_envio") {
        toast.success("Reenvio manual criado e já pronto para envio.");
      } else {
        toast.success("Reenvio manual criado e aguardando estoque.");
      }
    } catch {
      toast.error("Erro ao criar reenvio manual.");
    } finally {
      setManualReshipmentSubmitting(false);
    }
  }, [fetchInventoryOverview, handleUnauthorized, manualReshipmentForm]);

  const fetchCoupons = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/coupons`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json() as { coupons: Coupon[] };
      setCoupons(data.coupons || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const fetchProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/products`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok) return;
      const data = await res.json() as { products: AdminProduct[] };
      setProducts(data.products || []);
    } catch { /* ignore */ }
    finally { setProductsLoading(false); }
  }, [handleUnauthorized]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/admin/settings`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (res.ok) {
        const data = await res.json() as Record<string, string>;
        setSettings(data);
        return;
      }

      // Fallback to public endpoint if admin endpoint is temporarily unavailable.
      const publicRes = await fetch(`${BASE}/api/settings`);
      if (publicRes.ok) {
        const data = await publicRes.json() as Record<string, string>;
        setSettings(data);
      }
    } catch { /* ignore */ }
  }, [handleUnauthorized]);

  const fetchTenants = useCallback(async () => {
    if (!canManageTenants) return;
    setTenantsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/tenants`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { message?: string } | null;
        toast.error(data?.message || "Erro ao carregar lojas.");
        return;
      }
      const data = await res.json() as { tenants: AdminTenant[] };
      setTenants(data.tenants || []);
      setTenantDnsTargetDrafts(Object.fromEntries((data.tenants || []).map((tenant) => [tenant.id, tenant.dnsTargetHost || ""])));
      setTenantSupplyMarginDrafts(Object.fromEntries((data.tenants || []).map((tenant) => [tenant.id, String(tenant.supplyMarginPercent ?? 0)])));
      setTenantSupplyFixedMarginDrafts(Object.fromEntries((data.tenants || []).map((tenant) => [tenant.id, String(tenant.supplyMarginFixedBrl ?? 0)])));
      setTenantAdminUsernameDrafts(Object.fromEntries((data.tenants || []).map((tenant) => [tenant.id, tenant.adminUsername || ""])));
    } catch {
      toast.error("Erro ao carregar lojas.");
    } finally {
      setTenantsLoading(false);
    }
  }, [canManageTenants, handleUnauthorized]);

  const createTenant = useCallback(async () => {
    if (!canManageTenants) return;

    const payload = {
      name: tenantForm.name.trim(),
      slug: tenantForm.slug.trim(),
      domain: tenantForm.domain.trim(),
      dnsTargetHost: tenantForm.dnsTargetHost.trim(),
      siteName: tenantForm.siteName.trim(),
      supportWhatsapp: tenantForm.supportWhatsapp.trim(),
      adminUsername: tenantForm.adminUsername.trim(),
      createAdminUser: tenantForm.createAdminUser,
      newAdminUsername: tenantForm.newAdminUsername.trim(),
      newAdminPassword: tenantForm.newAdminPassword,
      cloneSettingsFromDefault: tenantForm.cloneSettingsFromDefault,
    };

    if (!payload.name || !payload.slug) {
      toast.error("Preencha nome e slug da loja.");
      return;
    }
    if (payload.createAdminUser) {
      if (!payload.newAdminUsername) {
        toast.error("Informe o usuário do novo admin da loja.");
        return;
      }
      if ((payload.newAdminPassword || "").length < 6) {
        toast.error("A senha do novo admin deve ter no mínimo 6 caracteres.");
        return;
      }
    }

    setTenantCreating(true);
    try {
      const res = await fetch(`${BASE}/api/admin/tenants`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });

      if (res.status === 401) { handleUnauthorized(); return; }

      const data = await res.json().catch(() => null) as { message?: string; createdAdmin?: { username?: string } | null } | null;
      if (!res.ok) {
        toast.error(data?.message || "Erro ao criar loja.");
        return;
      }

      if (data?.createdAdmin?.username) {
        toast.success(`Loja criada com sucesso. Admin criado: ${data.createdAdmin.username}`);
      } else {
        toast.success("Loja criada com sucesso.");
      }
      setTenantForm({
        name: "",
        slug: "",
        domain: "",
        dnsTargetHost: "",
        siteName: "",
        supportWhatsapp: "",
        adminUsername: "",
        createAdminUser: false,
        newAdminUsername: "",
        newAdminPassword: "",
        cloneSettingsFromDefault: true,
      });
      fetchTenants();
      if (payload.domain) {
        setDnsDomainInput(payload.domain);
      }
    } catch {
      toast.error("Erro ao criar loja.");
    } finally {
      setTenantCreating(false);
    }
  }, [canManageTenants, fetchTenants, handleUnauthorized, tenantForm]);

  const deleteTenant = useCallback(async (tenant: AdminTenant) => {
    if (!canManageTenants) return;
    if (tenant.id === "tenant_loja1") {
      toast.error("A Loja 1 não pode ser excluída.");
      return;
    }

    const confirmed = window.confirm(`Excluir a loja ${tenant.name}? Essa ação não pode ser desfeita.`);
    if (!confirmed) return;

    setTenantDeletingId(tenant.id);
    try {
      const res = await fetch(`${BASE}/api/admin/tenants/${encodeURIComponent(tenant.id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (res.status === 401) { handleUnauthorized(); return; }

      const data = await res.json().catch(() => null) as { message?: string } | null;
      if (!res.ok) {
        toast.error(data?.message || "Erro ao excluir loja.");
        return;
      }

      toast.success(`Loja ${tenant.name} excluída com sucesso.`);
      await fetchTenants();
    } catch {
      toast.error("Erro ao excluir loja.");
    } finally {
      setTenantDeletingId(null);
    }
  }, [canManageTenants, fetchTenants, handleUnauthorized]);

  const fetchDnsGuide = useCallback(async (domain?: string, tenantId?: string) => {
    if (!canManageTenants) return;
    setDnsGuideLoading(true);
    try {
      const params = new URLSearchParams();
      const normalizedDomain = String(domain || "").trim();
      if (normalizedDomain) params.set("domain", normalizedDomain);
      if (tenantId) params.set("tenantId", tenantId);
      const suffix = params.toString() ? `?${params.toString()}` : "";

      const res = await fetch(`${BASE}/api/admin/tenants/dns-guide${suffix}`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { message?: string } | null;
        toast.error(data?.message || "Erro ao carregar instruções DNS.");
        return;
      }
      const data = await res.json() as DnsGuideResponse;
      setDnsGuide(data);
    } catch {
      toast.error("Erro ao carregar instruções DNS.");
    } finally {
      setDnsGuideLoading(false);
    }
  }, [canManageTenants, handleUnauthorized]);

  const saveTenantDnsTarget = useCallback(async (tenant: AdminTenant) => {
    if (!canManageTenants) return;

    const dnsTargetHost = String(tenantDnsTargetDrafts[tenant.id] || "").trim();
    setTenantDnsTargetSavingId(tenant.id);
    try {
      const res = await fetch(`${BASE}/api/admin/tenants/${encodeURIComponent(tenant.id)}/dns-target`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ dnsTargetHost }),
      });

      if (res.status === 401) { handleUnauthorized(); return; }

      const data = await res.json().catch(() => null) as { message?: string } | null;
      if (!res.ok) {
        toast.error(data?.message || "Erro ao salvar host alvo da loja.");
        return;
      }

      toast.success(dnsTargetHost ? "Host alvo da loja salvo." : "Host alvo da loja removido.");
      await fetchTenants();
      if ((tenant.domain || "").trim()) {
        setDnsDomainInput(tenant.domain || "");
        await fetchDnsGuide(tenant.domain || "", tenant.id);
      }
    } catch {
      toast.error("Erro ao salvar host alvo da loja.");
    } finally {
      setTenantDnsTargetSavingId(null);
    }
  }, [canManageTenants, fetchDnsGuide, fetchTenants, handleUnauthorized, tenantDnsTargetDrafts]);

  const saveTenantAdminCredentials = useCallback(async (tenant: AdminTenant) => {
    if (!canManageTenants) return;
    if (tenant.id === "tenant_loja1") {
      toast.warning("Altere o admin da Loja 1 pela aba de usuários.");
      return;
    }

    const newUsername = String(tenantAdminUsernameDrafts[tenant.id] || "").trim().toLowerCase();
    const newPassword = String(tenantAdminPasswordDrafts[tenant.id] || "");
    const currentUsername = String(tenant.adminUsername || "").trim().toLowerCase();
    const usernameChanged = !!newUsername && newUsername !== currentUsername;
    const passwordChanged = newPassword.length > 0;

    if (!usernameChanged && !passwordChanged) {
      toast.info("Informe um novo usuário e/ou uma nova senha para salvar.");
      return;
    }
    if (passwordChanged && newPassword.length < 6) {
      toast.error("A nova senha deve ter no mínimo 6 caracteres.");
      return;
    }

    setTenantAdminSavingId(tenant.id);
    try {
      const res = await fetch(`${BASE}/api/admin/tenants/${encodeURIComponent(tenant.id)}/admin-credentials`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({
          newUsername: usernameChanged ? newUsername : "",
          newPassword: passwordChanged ? newPassword : "",
        }),
      });

      if (res.status === 401) { handleUnauthorized(); return; }

      const data = await res.json().catch(() => null) as { message?: string } | null;
      if (!res.ok) {
        toast.error(data?.message || "Erro ao atualizar usuário/senha do admin da loja.");
        return;
      }

      toast.success("Credenciais do admin da loja atualizadas.");
      setTenantAdminPasswordDrafts((prev) => ({ ...prev, [tenant.id]: "" }));
      await fetchTenants();
    } catch {
      toast.error("Erro ao atualizar usuário/senha do admin da loja.");
    } finally {
      setTenantAdminSavingId(null);
    }
  }, [canManageTenants, fetchTenants, handleUnauthorized, tenantAdminPasswordDrafts, tenantAdminUsernameDrafts]);

  const refreshTenantSyncedProducts = useCallback(async (tenant: AdminTenant) => {
    if (!canManageTenants) return;

    setTenantProductSyncRefreshingId(tenant.id);
    try {
      const res = await fetch(`${BASE}/api/admin/tenants/${encodeURIComponent(tenant.id)}/product-sync/refresh`, {
        method: "POST",
        headers: authHeaders(),
      });

      if (res.status === 401) { handleUnauthorized(); return; }

      const data = await res.json().catch(() => null) as { message?: string; syncedProducts?: number } | null;
      if (!res.ok) {
        toast.error(data?.message || "Erro ao atualizar produtos sincronizados.");
        return;
      }

      toast.success(`Produtos atualizados. ${Number(data?.syncedProducts || 0)} item(ns) sincronizados.`);
      await fetchTenants();
    } catch {
      toast.error("Erro ao atualizar produtos sincronizados.");
    } finally {
      setTenantProductSyncRefreshingId(null);
    }
  }, [canManageTenants, fetchTenants, handleUnauthorized]);

  const clearTenantSyncedProducts = useCallback(async (tenant: AdminTenant) => {
    if (!canManageTenants) return;
    if (!window.confirm(`Remover todos os produtos sincronizados da Loja 1 da filial ${tenant.name}?`)) return;

    setTenantProductSyncClearingId(tenant.id);
    try {
      const res = await fetch(`${BASE}/api/admin/tenants/${encodeURIComponent(tenant.id)}/product-sync`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (res.status === 401) { handleUnauthorized(); return; }

      const data = await res.json().catch(() => null) as { message?: string; removedProducts?: number } | null;
      if (!res.ok) {
        toast.error(data?.message || "Erro ao remover produtos sincronizados.");
        return;
      }

      toast.success(`Produtos sincronizados removidos. ${Number(data?.removedProducts || 0)} item(ns) excluído(s).`);
      await fetchTenants();
    } catch {
      toast.error("Erro ao remover produtos sincronizados.");
    } finally {
      setTenantProductSyncClearingId(null);
    }
  }, [canManageTenants, fetchTenants, handleUnauthorized]);

  const fetchTenantProfitSummary = useCallback(async () => {
    if (!canManageTenants) return;
    setTenantProfitLoading(true);
    try {
      const params = new URLSearchParams({
        dateFrom: statsDateFrom,
        dateTo: statsDateTo,
      });
      const res = await fetch(`${BASE}/api/admin/tenants/profit-summary?${params.toString()}`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { message?: string } | null;
        toast.error(data?.message || "Erro ao carregar lucro por loja.");
        return;
      }
      const data = await res.json() as { summaries: TenantProfitSummary[] };
      setTenantProfitSummary(data.summaries || []);
    } catch {
      toast.error("Erro ao carregar lucro por loja.");
    } finally {
      setTenantProfitLoading(false);
    }
  }, [canManageTenants, statsDateFrom, statsDateTo, handleUnauthorized]);

  const saveTenantSupplyMargin = useCallback(async (tenant: AdminTenant) => {
    if (!canManageTenants) return;
    const raw = String(tenantSupplyMarginDrafts[tenant.id] || "").replace(",", ".").trim();
    const fixedRaw = String(tenantSupplyFixedMarginDrafts[tenant.id] || "").replace(",", ".").trim();
    const marginPercent = Number(raw);
    const marginFixedBrl = Number(fixedRaw);

    if (!Number.isFinite(marginPercent) || marginPercent < 0) {
      toast.error("Informe uma margem válida (>= 0).");
      return;
    }

    if (!Number.isFinite(marginFixedBrl) || marginFixedBrl < 0) {
      toast.error("Informe uma margem fixa válida (>= 0).");
      return;
    }

    setTenantSupplyMarginSavingId(tenant.id);
    try {
      const res = await fetch(`${BASE}/api/admin/tenants/${encodeURIComponent(tenant.id)}/supply-margin`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ marginPercent, marginFixedBrl }),
      });

      if (res.status === 401) { handleUnauthorized(); return; }

      const data = await res.json().catch(() => null) as { message?: string } | null;
      if (!res.ok) {
        toast.error(data?.message || "Erro ao salvar margem de repasse.");
        return;
      }

      toast.success("Margem de repasse salva.");
      await fetchTenants();
      await fetchTenantProfitSummary();
    } catch {
      toast.error("Erro ao salvar margem de repasse.");
    } finally {
      setTenantSupplyMarginSavingId(null);
    }
  }, [canManageTenants, fetchTenants, fetchTenantProfitSummary, handleUnauthorized, tenantSupplyFixedMarginDrafts, tenantSupplyMarginDrafts]);

  const addManualFilialItem = useCallback(() => {
    if (!selectedFilialTenantId) {
      toast.error("Selecione uma filial.");
      return;
    }
    if (!selectedManualFilialProduct) {
      toast.error("Selecione um produto da filial.");
      return;
    }

    const quantity = Number(String(manualFilialQuantity || "").replace(",", "."));
    const repasseUnitCost = manualFilialComputedRepasseUnitCost;

    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Informe uma quantidade válida.");
      return;
    }
    if (!Number.isFinite(manualFilialBaseUnitCost) || manualFilialBaseUnitCost < 0 || !Number.isFinite(repasseUnitCost ?? NaN)) {
      toast.error("Informe um custo base válido para calcular o repasse.");
      return;
    }

    setManualFilialItems((prev) => {
      const idx = prev.findIndex((item) => item.productId === selectedManualFilialProduct.id);
      if (idx < 0) {
        return [
          ...prev,
          {
            productId: selectedManualFilialProduct.id,
            productName: selectedManualFilialProduct.name,
            quantity,
            repasseUnitCost,
            saleUnitPrice: Number(selectedManualFilialProduct.price || 0),
          },
        ];
      }

      const next = [...prev];
      next[idx] = {
        ...next[idx],
        quantity: next[idx].quantity + quantity,
        repasseUnitCost,
      };
      return next;
    });

    setManualFilialQuantity("1");
  }, [manualFilialBaseUnitCost, manualFilialComputedRepasseUnitCost, manualFilialQuantity, selectedFilialTenantId, selectedManualFilialProduct]);

  const removeManualFilialItem = useCallback((productId: string) => {
    setManualFilialItems((prev) => prev.filter((item) => item.productId !== productId));
  }, []);

  const createManualFilialProduct = useCallback(async () => {
    if (!selectedFilialTenantId) {
      toast.error("Selecione uma filial.");
      return;
    }

    const name = manualFilialNewProductName.trim();
    const category = manualFilialNewProductCategory.trim() || "Geral";
    const unit = manualFilialNewProductUnit.trim() || "unidade";
    const price = Number(String(manualFilialNewProductPrice || "").replace(",", "."));
    const costPrice = Number(String(manualFilialNewProductCost || "").replace(",", "."));

    if (!name) {
      toast.error("Informe o nome do produto.");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      toast.error("Informe um preço de venda válido.");
      return;
    }
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      toast.error("Informe um custo válido.");
      return;
    }

    setManualFilialCreatingProduct(true);
    try {
      const params = new URLSearchParams({ tenantId: selectedFilialTenantId });
      const res = await fetch(`${BASE}/api/admin/products?${params.toString()}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name,
          category,
          unit,
          price,
          costPrice,
          description: "",
          isActive: true,
          isSoldOut: false,
          isLaunch: false,
          sortOrder: 0,
        }),
      });

      if (res.status === 401) { handleUnauthorized(); return; }

      const data = await res.json().catch(() => null) as { id?: string; message?: string } | null;
      if (!res.ok) {
        toast.error(data?.message || "Erro ao cadastrar produto na filial.");
        return;
      }

      toast.success("Produto cadastrado na filial.");
      setManualFilialNewProductName("");
      setManualFilialNewProductCategory("Geral");
      setManualFilialNewProductUnit("unidade");
      setManualFilialNewProductPrice("");
      setManualFilialNewProductCost("");
      await fetchFilialStoreProducts(selectedFilialTenantId);
      if (data?.id) {
        setManualFilialProductId(String(data.id));
      }
    } catch {
      toast.error("Erro ao cadastrar produto na filial.");
    } finally {
      setManualFilialCreatingProduct(false);
    }
  }, [handleUnauthorized, manualFilialNewProductCategory, manualFilialNewProductCost, manualFilialNewProductName, manualFilialNewProductPrice, manualFilialNewProductUnit, selectedFilialTenantId]);

  const submitManualFilialPurchase = useCallback(async () => {
    if (!selectedFilialTenantId) {
      toast.error("Selecione uma filial.");
      return;
    }
    if (manualFilialItems.length === 0) {
      toast.error("Adicione pelo menos um produto.");
      return;
    }

    setManualFilialSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/admin/filial-purchases/manual`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          filialTenantId: selectedFilialTenantId,
          clientName: manualFilialClientName.trim() || "Compra manual da filial",
          items: manualFilialItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            repasseUnitCost: item.repasseUnitCost,
          })),
        }),
      });

      if (res.status === 401) { handleUnauthorized(); return; }

      const data = await res.json().catch(() => null) as { message?: string } | null;
      if (!res.ok) {
        toast.error(data?.message || "Erro ao gerar pedido manual da filial.");
        return;
      }

      toast.success("Pedido manual criado e pendente de pagamento da filial.");
      setManualFilialItems([]);
      setManualFilialClientName("Compra manual da filial");
      await fetchFilialPurchaseRequests(selectedFilialTenantId);
    } catch {
      toast.error("Erro ao gerar pedido manual da filial.");
    } finally {
      setManualFilialSubmitting(false);
    }
  }, [handleUnauthorized, manualFilialClientName, manualFilialItems, selectedFilialTenantId]);

  const markFilialPurchaseAsPaid = useCallback(async (request: FilialPurchaseRequest) => {
    if (!canManageTenants) return;
    if (!window.confirm(`Marcar o pedido ${request.orderId} como pago na filial?`)) return;

    setFilialPurchaseMarkPaidId(request.id);
    try {
      const res = await fetch(`${BASE}/api/admin/filial-purchases/${encodeURIComponent(request.id)}/mark-paid`, {
        method: "POST",
        headers: authHeaders(),
      });

      if (res.status === 401) { handleUnauthorized(); return; }

      const data = await res.json().catch(() => null) as { message?: string } | null;
      if (!res.ok) {
        toast.error(data?.message || "Erro ao marcar pedido como pago.");
        return;
      }

      toast.success("Pedido marcado como pago na filial.");
      await fetchFilialPurchaseRequests(selectedFilialTenantId || undefined);
    } catch {
      toast.error("Erro ao marcar pedido como pago.");
    } finally {
      setFilialPurchaseMarkPaidId(null);
    }
  }, [canManageTenants, handleUnauthorized, selectedFilialTenantId]);

  const fetchFilialPurchaseRequests = useCallback(async (tenantId?: string) => {
    if (!canManageTenants) return;
    const targetTenantId = String(tenantId || selectedFilialTenantId || "").trim();
    setFilialPurchaseLoading(true);
    try {
      const params = new URLSearchParams({ status: "pending" });
      if (targetTenantId) params.set("filialTenantId", targetTenantId);
      const res = await fetch(`${BASE}/api/admin/filial-purchases?${params.toString()}`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { message?: string } | null;
        toast.error(data?.message || "Erro ao carregar fila de compras das filiais.");
        return;
      }

      const data = await res.json() as { requests: FilialPurchaseRequest[] };
      const requests = data.requests || [];
      setFilialPurchaseRequests(requests);

      setFilialPurchaseCostDrafts((prev) => {
        const next = { ...prev };
        for (const request of requests) {
          if (!next[request.id]) next[request.id] = {};
          for (const item of request.items || []) {
            if (next[request.id][item.productId] === undefined) {
              next[request.id][item.productId] = String(item.repasseUnitCost || 0);
            }
          }
        }
        return next;
      });
    } catch {
      toast.error("Erro ao carregar fila de compras das filiais.");
    } finally {
      setFilialPurchaseLoading(false);
    }
  }, [canManageTenants, handleUnauthorized, selectedFilialTenantId]);

  const fetchFilialStoreProducts = useCallback(async (tenantId?: string) => {
    if (!canManageTenants) return;
    const targetTenantId = String(tenantId || selectedFilialTenantId || "").trim();
    if (!targetTenantId) {
      setFilialStoreProducts([]);
      return;
    }

    setFilialStoreProductsLoading(true);
    try {
      const params = new URLSearchParams({ tenantId: targetTenantId });
      const res = await fetch(`${BASE}/api/admin/products?${params.toString()}`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { message?: string } | null;
        toast.error(data?.message || "Erro ao carregar produtos da filial.");
        return;
      }

      const data = await res.json() as { products?: Array<Record<string, unknown>> };
      const rows = Array.isArray(data.products) ? data.products : [];
      const mappedRows = rows.map((item) => ({
        id: String(item.id || ""),
        name: String(item.name || "Produto"),
        category: String(item.category || "Sem categoria"),
        unit: String(item.unit || "UN"),
        price: Number(item.price || 0),
        costPrice: Number(item.costPrice || 0),
        image: String(item.image || "").trim() || null,
        isActive: item.isActive !== false,
        isSoldOut: item.isSoldOut === true,
      }));
      setFilialStoreProducts(mappedRows);
      setFilialStoreCostDrafts((prev) => {
        const next = { ...prev };
        for (const row of mappedRows) {
          if (next[row.id] === undefined) {
            next[row.id] = String(row.costPrice || 0);
          }
        }
        return next;
      });
    } catch {
      toast.error("Erro ao carregar produtos da filial.");
    } finally {
      setFilialStoreProductsLoading(false);
    }
  }, [canManageTenants, handleUnauthorized, selectedFilialTenantId]);

  const saveFilialProductCost = useCallback(async (product: FilialStoreProduct) => {
    if (!canManageTenants || !selectedFilialTenantId) return;

    const raw = String(filialStoreCostDrafts[product.id] ?? "").replace(",", ".").trim();
    const nextCost = Number(raw);
    if (!Number.isFinite(nextCost) || nextCost < 0) {
      toast.error("Informe um custo válido (>= 0).");
      return;
    }

    setFilialStoreCostSavingId(product.id);
    try {
      const params = new URLSearchParams({ tenantId: selectedFilialTenantId });
      const res = await fetch(`${BASE}/api/admin/products/${encodeURIComponent(product.id)}?${params.toString()}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ costPrice: nextCost }),
      });

      if (res.status === 401) { handleUnauthorized(); return; }

      const data = await res.json().catch(() => null) as { message?: string } | null;
      if (!res.ok) {
        toast.error(data?.message || "Erro ao salvar custo do produto.");
        return;
      }

      setFilialStoreProducts((prev) => prev.map((item) => (
        item.id === product.id ? { ...item, costPrice: nextCost } : item
      )));
      setFilialStoreCostDrafts((prev) => ({ ...prev, [product.id]: String(nextCost) }));
      toast.success("Custo do produto atualizado.");
    } catch {
      toast.error("Erro ao salvar custo do produto.");
    } finally {
      setFilialStoreCostSavingId(null);
    }
  }, [canManageTenants, filialStoreCostDrafts, handleUnauthorized, selectedFilialTenantId]);

  const fetchFilialInventoryOverview = useCallback(async (tenantId?: string) => {
    if (!canManageTenants) return;
    const targetTenantId = String(tenantId || selectedFilialTenantId || "").trim();
    if (!targetTenantId) {
      setFilialInventoryBalances([]);
      return;
    }

    setFilialInventoryLoading(true);
    try {
      const params = new URLSearchParams({ tenantId: targetTenantId });
      const res = await fetch(`${BASE}/api/admin/inventory/overview?${params.toString()}`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { message?: string } | null;
        toast.error(data?.message || "Erro ao carregar estoque da filial.");
        return;
      }

      const data = await res.json() as { balances?: InventoryBalanceRecord[] };
      setFilialInventoryBalances(Array.isArray(data.balances) ? data.balances : []);
    } catch {
      toast.error("Erro ao carregar estoque da filial.");
    } finally {
      setFilialInventoryLoading(false);
    }
  }, [canManageTenants, handleUnauthorized, selectedFilialTenantId]);

  const confirmFilialPurchase = useCallback(async (request: FilialPurchaseRequest) => {
    if (!canManageTenants) return;

    const drafts = filialPurchaseCostDrafts[request.id] || {};
    const items = request.items.map((item) => {
      const raw = String(drafts[item.productId] ?? "").replace(",", ".").trim();
      const unitCost = Number(raw);
      return {
        productId: item.productId,
        unitCost,
        valid: Number.isFinite(unitCost) && unitCost >= 0,
      };
    });

    const invalidItem = items.find((item) => !item.valid);
    if (invalidItem) {
      toast.error("Preencha o custo real de todos os produtos antes de confirmar.");
      return;
    }

    setFilialPurchaseConfirmingId(request.id);
    try {
      const res = await fetch(`${BASE}/api/admin/filial-purchases/${encodeURIComponent(request.id)}/confirm`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          items: items.map((item) => ({ productId: item.productId, unitCost: item.unitCost })),
          updateProductCost: !!filialPurchaseUpdateCostFlags[request.id],
        }),
      });

      if (res.status === 401) { handleUnauthorized(); return; }

      const data = await res.json().catch(() => null) as { message?: string; idempotent?: boolean } | null;
      if (!res.ok) {
        toast.error(data?.message || "Erro ao confirmar compra da filial.");
        return;
      }

      if (data?.idempotent) {
        toast.success("Compra já estava finalizada. Nenhum estoque duplicado foi lançado.");
      } else {
        toast.success(filialPurchaseUpdateCostFlags[request.id]
          ? "Compra confirmada, estoque lançado e custo dos produtos atualizado na filial."
          : "Compra confirmada e estoque lançado na filial.");
      }

      await fetchFilialPurchaseRequests(selectedFilialTenantId || undefined);
    } catch {
      toast.error("Erro ao confirmar compra da filial.");
    } finally {
      setFilialPurchaseConfirmingId(null);
    }
  }, [canManageTenants, fetchFilialPurchaseRequests, filialPurchaseCostDrafts, filialPurchaseUpdateCostFlags, handleUnauthorized, selectedFilialTenantId]);

  const deleteFilialPurchase = useCallback(async (request: FilialPurchaseRequest) => {
    if (!canManageTenants) return;
    if (!window.confirm(`Cancelar a compra do pedido ${request.orderId} (${request.filialTenantName})? O histórico será mantido.`)) return;

    setFilialPurchaseDeletingId(request.id);
    try {
      const res = await fetch(`${BASE}/api/admin/filial-purchases/${encodeURIComponent(request.id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (res.status === 401) { handleUnauthorized(); return; }

      const data = await res.json().catch(() => null) as { message?: string } | null;
      if (!res.ok) {
        toast.error(data?.message || "Erro ao cancelar compra da filial.");
        return;
      }

      toast.success("Compra da filial cancelada com sucesso.");
      setFilialPurchaseOpenId((prev) => (prev === request.id ? null : prev));
      await fetchFilialPurchaseRequests(selectedFilialTenantId || undefined);
    } catch {
      toast.error("Erro ao cancelar compra da filial.");
    } finally {
      setFilialPurchaseDeletingId(null);
    }
  }, [canManageTenants, fetchFilialPurchaseRequests, handleUnauthorized, selectedFilialTenantId]);

  const checkDns = useCallback(async (domain: string, tenantId?: string) => {
    if (!canManageTenants) return;
    const cleanDomain = String(domain || "").trim();
    if (!cleanDomain) {
      toast.error("Informe um domínio para verificar.");
      return;
    }

    setDnsCheckLoading(true);
    try {
      const params = new URLSearchParams({ domain: cleanDomain });
      if (tenantId) params.set("tenantId", tenantId);
      const res = await fetch(`${BASE}/api/admin/tenants/dns-check?${params.toString()}`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json().catch(() => null) as (DnsCheckResponse & { message?: string }) | null;
      if (!res.ok || !data) {
        toast.error(data?.message || "Erro ao verificar DNS.");
        return;
      }

      setDnsCheckResult(data);
      if (data.status === "configured") {
        toast.success(data.rootAliasFlattenedMatch ? "Domínio validado via ALIAS/ANAME." : "Domínio apontado corretamente.");
      } else if (data.status === "misconfigured") {
        toast.warning("Domínio encontrado, mas ainda não aponta para este servidor.");
      } else {
        toast.info("Domínio sem registros detectados no momento.");
      }
    } catch {
      toast.error("Erro ao verificar DNS.");
    } finally {
      setDnsCheckLoading(false);
    }
  }, [canManageTenants, handleUnauthorized]);

  const fetchBrevoStatus = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/admin/brevo/config`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json() as { configured?: boolean };
        setBrevoConfigured(!!data.configured);
      }
    } catch { /* ignore */ }
  }, []);

  const testBrevoConnection = useCallback(async () => {
    setBrevoTesting(true);
    try {
      const res = await fetch(`${BASE}/api/admin/brevo/config`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ apiKey: brevoApiKey }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; message?: string };
      if (!res.ok) {
        toast.error(data.message || data.error || "Erro ao testar API Brevo.");
        return;
      }
      setBrevoConfigured(true);
      setBrevoApiKey("");
      toast.success("API Brevo configurada e testada com sucesso!");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao configurar API Brevo.");
    } finally {
      setBrevoTesting(false);
    }
  }, [brevoApiKey]);

  const fetchClientErrors = useCallback(async () => {
    setClientErrorsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/client-errors?limit=60`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok) return;
      const data = await res.json() as { events?: ClientErrorEvent[] };
      setClientErrors(data.events || []);
    } catch {
      // silent
    } finally {
      setClientErrorsLoading(false);
    }
  }, [handleUnauthorized]);

  const saveSetting = useCallback(async (key: string, value: string) => {
    setSettingsLoading((p) => ({ ...p, [key]: true }));
    try {
      const res = await fetch(`${BASE}/api/admin/settings/${key}`, {
        method: "PUT", headers: authHeaders(), body: JSON.stringify({ value }),
      });
      if (!res.ok) { toast.error("Erro ao salvar configuração."); return; }
      setSettings((p) => ({ ...p, [key]: value }));

      try {
        const cached = JSON.parse(localStorage.getItem("siteSettings") || "{}") as Record<string, string>;
        const next = { ...cached, [key]: value };
        localStorage.setItem("siteSettings", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("ka-site-settings-updated", { detail: next }));
      } catch {
        // ignore storage issues
      }

      toast.success("Configuração salva!");
    } catch { toast.error("Erro ao salvar configuração."); }
    finally { setSettingsLoading((p) => ({ ...p, [key]: false })); }
  }, []);

  const deleteSetting = useCallback(async (key: string) => {
    setSettingsLoading((p) => ({ ...p, [key]: true }));
    try {
      await fetch(`${BASE}/api/admin/settings/${key}`, { method: "DELETE", headers: authHeaders() });
      setSettings((p) => { const n = { ...p }; delete n[key]; return n; });

      try {
        const cached = JSON.parse(localStorage.getItem("siteSettings") || "{}") as Record<string, string>;
        const next = { ...cached };
        delete next[key];
        localStorage.setItem("siteSettings", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("ka-site-settings-updated", { detail: next }));
      } catch {
        // ignore storage issues
      }

      toast.success("Imagem removida.");
    } catch { toast.error("Erro ao remover."); }
    finally { setSettingsLoading((p) => ({ ...p, [key]: false })); }
  }, []);

  const testOutboundWebhook = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/admin/outbound-webhook/test`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        if ((data as { error?: string }).error === "webhook_url_not_configured") {
          toast.error("Configure a URL do webhook de saída antes de testar.");
          return;
        }
        toast.error("Falha ao enviar webhook de teste.");
        return;
      }
      toast.success("Webhook de teste enviado com sucesso.");
    } catch {
      toast.error("Falha ao enviar webhook de teste.");
    }
  }, []);

  const fetchSellers = useCallback(async () => {
    setSellersLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/sellers`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json() as { sellers: SavedSellerItem[] };
      let list = data.sellers || [];

      // One-time migration: if DB is empty but localStorage has sellers, migrate them
      if (list.length === 0) {
        try {
          const raw = localStorage.getItem("savedSellersList");
          const localSellers: Array<{ slug: string; whatsapp: string }> = raw ? JSON.parse(raw) : [];
          if (localSellers.length > 0) {
            await Promise.all(
              localSellers.map((s) =>
                fetch(`${BASE}/api/admin/sellers`, {
                  method: "POST",
                  headers: authHeaders(),
                  body: JSON.stringify({ slug: s.slug, whatsapp: s.whatsapp, hasCommission: true, commissionRate: 5 }),
                }).catch(() => null)
              )
            );
            // Re-fetch after migration
            const res2 = await fetch(`${BASE}/api/admin/sellers`, { headers: authHeaders() });
            const data2 = await res2.json() as { sellers: SavedSellerItem[] };
            list = data2.sellers || [];
            localStorage.removeItem("savedSellersList");
            localStorage.removeItem("savedSellers");
          }
        } catch { /* ignore migration errors */ }
      }

      setSellers(list);
    } catch { /* ignore */ }
    finally { setSellersLoading(false); setLoading(false); }
  }, [handleUnauthorized]);

  const fetchShippingOptions = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/admin/shipping-options`, { headers: authHeaders() });
      const data = await res.json() as { options: ShippingOption[] };
      setShippingOptions(data.options || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const fetchOrderBumpsData = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/admin/order-bumps`, { headers: authHeaders() });
      const data = await res.json() as { bumps: OrderBump[] };
      setOrderBumps(data.bumps || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const fetchKycList = useCallback(async () => {
    setKycListLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/kyc`, { headers: authHeaders() });
      if (!res.ok) { toast.error("Erro ao carregar KYCs."); return; }
      const data = await res.json() as { kycs: KycListItem[] };
      setKycList(data.kycs ?? []);
    } catch { toast.error("Erro ao carregar KYCs."); }
    finally { setKycListLoading(false); }
  }, []);

  const fetchSocialProof = useCallback(async () => {
    setSpSettingsLoading(true);
    setSpFakeEntriesLoading(true);
    try {
      const [settRes, fakeRes, realRes, autoCountRes] = await Promise.all([
        fetch(`${BASE}/api/admin/social-proof/settings`, { headers: authHeaders() }),
        fetch(`${BASE}/api/admin/social-proof/fake-entries`, { headers: authHeaders() }),
        fetch(`${BASE}/api/admin/social-proof/real-entries`, { headers: authHeaders() }),
        fetch(`${BASE}/api/admin/social-proof/auto-count`, { headers: authHeaders() }),
      ]);
      if (settRes.ok) {
        const s = await settRes.json() as SocialProofSettings;
        setSpSettings(s);
        try { setSpFakeProductIds(JSON.parse(s.fakeProductIds ?? "[]")); } catch { setSpFakeProductIds([]); }
      }
      if (fakeRes.ok) setSpFakeEntries(await fakeRes.json() as SocialProofFakeEntry[]);
      if (realRes.ok) setSpRealEntries(await realRes.json() as Array<{ firstName: string; city: string; state: string; productName: string }>);
      if (autoCountRes.ok) { const d = await autoCountRes.json() as { count: number }; setSpAutoCount(d.count); }
    } catch { toast.error("Erro ao carregar dados de prova social."); }
    finally { setSpSettingsLoading(false); setSpFakeEntriesLoading(false); setLoading(false); }
  }, []);

  const fetchRaffles = useCallback(async () => {
    setRafflesLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/raffles`, { headers: authHeaders() });
      if (!res.ok) { toast.error("Erro ao carregar rifas."); return; }
      setRafflesList(await res.json() as AdminRaffle[]);
    } catch { toast.error("Erro ao carregar rifas."); }
    finally { setRafflesLoading(false); setLoading(false); }
  }, []);

  const fetchRaffleReservations = useCallback(async (raffleId: string) => {
    setRaffleReservationsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/raffles/${raffleId}/reservations`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok) { toast.error("Erro ao carregar reservas."); return; }
      setRaffleReservations(await res.json() as AdminRaffleReservation[]);
    } catch { toast.error("Erro ao carregar reservas."); }
    finally { setRaffleReservationsLoading(false); }
  }, [handleUnauthorized]);

  const cancelRaffleReservation = useCallback(async (raffleId: string, reservation: AdminRaffleReservation) => {
    if (reservation.status === "paid") {
      toast.error("Não é possível cancelar uma reserva já paga.");
      return;
    }

    const confirmed = window.confirm(`Cancelar a reserva de ${reservation.clientName}?`);
    if (!confirmed) return;

    setRaffleCancelingReservationId(reservation.id);
    try {
      const res = await fetch(`${BASE}/api/admin/raffles/${raffleId}/reservations/${reservation.id}/cancel`, {
        method: "PATCH",
        headers: authHeaders(),
      });

      if (res.status === 401) { handleUnauthorized(); return; }

      const data = await res.json().catch(() => ({} as { message?: string }));
      if (!res.ok) {
        toast.error((data as { message?: string }).message || "Erro ao cancelar reserva.");
        return;
      }

      setRaffleReservations((prev) => prev.map((rv) =>
        rv.id === reservation.id
          ? { ...rv, status: "expired", isExpired: true, expiresAt: new Date().toISOString() }
          : rv,
      ));
      toast.success("Reserva cancelada com sucesso.");
    } catch {
      toast.error("Erro ao cancelar reserva.");
    } finally {
      setRaffleCancelingReservationId(null);
    }
  }, [handleUnauthorized]);

  const fetchRafflePromotions = useCallback(async (raffleId: string) => {
    try {
      const res = await fetch(`${BASE}/api/admin/raffles/${raffleId}/promotions`, { headers: authHeaders() });
      if (!res.ok) { toast.error("Erro ao carregar promoções da rifa."); return; }
      const data = await res.json() as { promotions?: AdminRafflePromotion[] };
      setRafflePromotions(data.promotions ?? []);
    } catch {
      toast.error("Erro ao carregar promoções da rifa.");
    }
  }, []);

  const fetchRaffleRanking = useCallback(async (raffleId: string) => {
    try {
      const res = await fetch(`${BASE}/api/admin/raffles/${raffleId}/ranking`, { headers: authHeaders() });
      if (!res.ok) { toast.error("Erro ao carregar ranking da rifa."); return; }
      const data = await res.json() as { ranking?: AdminRaffleRankingEntry[] };
      setRaffleRanking(data.ranking ?? []);
    } catch {
      toast.error("Erro ao carregar ranking da rifa.");
    }
  }, []);

  const fetchRaffleResult = useCallback(async (raffleId: string) => {
    setRaffleResultLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/raffles/${raffleId}/result`, { headers: authHeaders() });
      if (!res.ok) { toast.error("Erro ao carregar resultado da rifa."); return; }
      const data = await res.json() as { result?: AdminRaffleResult | null };
      setRaffleResult(data.result ?? null);
      if (data.result?.winnerNumber) {
        setRaffleDrawForm((f) => ({ ...f, winnerNumber: String(data.result?.winnerNumber ?? "") }));
      }
    } catch {
      toast.error("Erro ao carregar resultado da rifa.");
    } finally {
      setRaffleResultLoading(false);
    }
  }, []);

  const generateAutoEntries = useCallback(async () => {
    setSpAutoGenerating(true);
    try {
      const res = await fetch(`${BASE}/api/admin/social-proof/generate`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await res.json() as { success?: boolean; count?: number; error?: string; message?: string };
      if (!res.ok) { toast.error(data.message ?? "Erro ao gerar notificações."); return; }
      setSpAutoCount(data.count ?? 0);
      toast.success(`✅ ${data.count} notificações geradas com sucesso!`);
    } catch { toast.error("Erro ao gerar notificações."); }
    finally { setSpAutoGenerating(false); }
  }, []);

  const saveSpSettings = useCallback(async (patch: Partial<SocialProofSettings>) => {
    setSpSettingsSaving(true);
    try {
      const res = await fetch(`${BASE}/api/admin/social-proof/settings`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) { toast.error("Erro ao salvar configuração."); return; }
      const updated = await res.json() as SocialProofSettings;
      setSpSettings(updated);
      try { setSpFakeProductIds(JSON.parse(updated.fakeProductIds ?? "[]")); } catch { setSpFakeProductIds([]); }
      toast.success("Configuração salva!");
    } catch { toast.error("Erro ao salvar configuração."); }
    finally { setSpSettingsSaving(false); }
  }, []);

  const createSpFakeEntry = useCallback(async () => {
    if (!spFakeForm.firstName || !spFakeForm.city || !spFakeForm.state || !spFakeForm.productName) {
      toast.error("Preencha todos os campos."); return;
    }
    setSpFakeCreating(true);
    try {
      const res = await fetch(`${BASE}/api/admin/social-proof/fake-entries`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(spFakeForm),
      });
      if (!res.ok) { toast.error("Erro ao criar entrada."); return; }
      const entry = await res.json() as SocialProofFakeEntry;
      setSpFakeEntries((prev) => [entry, ...prev]);
      setSpFakeForm({ firstName: "", city: "", state: "", productName: "" });
      toast.success("Entrada criada!");
    } catch { toast.error("Erro ao criar entrada."); }
    finally { setSpFakeCreating(false); }
  }, [spFakeForm]);

  const updateSpFakeEntry = useCallback(async (id: number) => {
    if (!spFakeForm.firstName || !spFakeForm.city || !spFakeForm.state || !spFakeForm.productName) {
      toast.error("Preencha todos os campos."); return;
    }
    setSpFakeCreating(true);
    try {
      const res = await fetch(`${BASE}/api/admin/social-proof/fake-entries/${id}`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(spFakeForm),
      });
      if (!res.ok) { toast.error("Erro ao atualizar entrada."); return; }
      const entry = await res.json() as SocialProofFakeEntry;
      setSpFakeEntries((prev) => prev.map((e) => e.id === id ? entry : e));
      setSpFakeEditingId(null);
      setSpFakeForm({ firstName: "", city: "", state: "", productName: "" });
      toast.success("Entrada atualizada!");
    } catch { toast.error("Erro ao atualizar entrada."); }
    finally { setSpFakeCreating(false); }
  }, [spFakeForm]);

  const deleteSpFakeEntry = useCallback(async (id: number) => {
    setSpFakeDeleting(id);
    try {
      await fetch(`${BASE}/api/admin/social-proof/fake-entries/${id}`, { method: "DELETE", headers: authHeaders() });
      setSpFakeEntries((prev) => prev.filter((e) => e.id !== id));
      toast.success("Entrada removida!");
    } catch { toast.error("Erro ao remover."); }
    finally { setSpFakeDeleting(null); }
  }, []);

  const fetchAll = useCallback(() => {
    fetchStatsData();
    if (tab === "orders")          { fetchOrders(); fetchProducts(); fetchInventoryOverview(); }
    else if (tab === "charges")    fetchCharges();
    else if (tab === "users")      fetchUsers();
    else if (tab === "customers")  fetchCustomers();
    else if (tab === "recurringCustomers") fetchRecurringCustomers();
    else if (tab === "support")    fetchSupportTickets();
    else if (tab === "inventory")  { fetchInventoryOverview(); fetchProducts(); }
    else if (tab === "coupons")    { fetchCoupons(); fetchProducts(); }
    else if (tab === "products")   fetchProducts();
    else if (tab === "configuracoes") { fetchSettings(); fetchClientErrors(); fetchBrevoStatus(); }
    else if (tab === "sellers")    { fetchSellers(); fetchSellerData(); }
    else if (tab === "fretes")     fetchShippingOptions();
    else if (tab === "orderBumps") { fetchProducts(); fetchOrderBumpsData(); }
    else if (tab === "kyc")        fetchKycList();
    else if (tab === "commissions") { fetchCommissionPayments(); }
    else if (tab === "socialProof") { fetchSocialProof(); fetchProducts(); }
    else if (tab === "raffles")    fetchRaffles();
    else if (tab === "lojas")      { fetchTenants(); fetchDnsGuide(dnsDomainInput); fetchTenantProfitSummary(); fetchFilialPurchaseRequests(selectedFilialTenantId || undefined); }
    else setLoading(false);
  }, [tab, fetchOrders, fetchCharges, fetchUsers, fetchCustomers, fetchRecurringCustomers, fetchSupportTickets, fetchInventoryOverview, fetchCoupons, fetchProducts, fetchSettings, fetchClientErrors, fetchSellers, fetchSellerData, fetchShippingOptions, fetchOrderBumpsData, fetchStatsData, fetchKycList, fetchCommissionPayments, fetchSocialProof, fetchRaffles, fetchTenants, fetchDnsGuide, fetchTenantProfitSummary, fetchFilialPurchaseRequests, dnsDomainInput, selectedFilialTenantId]);

  // -------------------------------------------------------------------------
  // SSE
  // -------------------------------------------------------------------------
  const connectSSE = useCallback(() => {
    if (sseReconnectTimerRef.current !== null) {
      window.clearTimeout(sseReconnectTimerRef.current);
      sseReconnectTimerRef.current = null;
    }
    if (sseRef.current) sseRef.current.close();
    const token = getToken();
    if (!token) return;
    sseUnauthorizedRef.current = false;

    const url = `${BASE}/api/admin/notifications?t=${Date.now()}`;
    const es = new EventSource(url, { withCredentials: true });
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as { type: string; data?: Record<string, unknown> };
        if (event.type === "connected") return;

        let message = "";
        if (event.type === "new_order") {
          const d = event.data as { clientName: string; total: number; paymentMethod: string; sellerCode?: string };
          const method = d.paymentMethod === "card_simulation"
            ? "Cartão"
            : d.paymentMethod === "whatsapp_pix"
              ? "WhatsApp"
              : "PIX";
          const seller  = d.sellerCode ? ` [${d.sellerCode}]` : "";
          message = `Nova venda${seller} — ${d.clientName} — ${formatCurrency(d.total)} (${method})`;
          fetchOrders(true);
          fetchRecurringCustomers();
          fetchStatsData();
          fetchSellerData();
          showPushNotification("KA Imports — Nova Venda! 🛍️", message);
        } else if (event.type === "new_charge") {
          const d = event.data as { clientName: string; amount: number };
          message = `Nova cobrança — ${d.clientName} — ${formatCurrency(d.amount)}`;
          fetchCharges(true);
          fetchStatsData();
          fetchSellerData();
          showPushNotification("KA Imports — Nova Cobrança! 💳", message);
        } else if (event.type === "order_paid") {
          message = `Pagamento PIX confirmado!`;
          fetchOrders(true);
          fetchRecurringCustomers();
          fetchStatsData();
          fetchSellerData();
          showPushNotification("KA Imports — PIX Confirmado! ✅", message);
        } else if (event.type === "order_status_updated") {
          message = `Pedido atualizado`;
          fetchOrders(true);
          fetchRecurringCustomers();
          fetchStatsData();
          fetchSellerData();
        } else if (event.type === "charge_paid") {
          message = `Cobrança paga`;
          fetchCharges(true);
          fetchOrders(true);
          fetchStatsData();
          fetchSellerData();
          showPushNotification("KA Imports — Cobrança Paga! ✅", message);
        } else if (event.type === "order_updated") {
          fetchOrders(true);
          fetchRecurringCustomers();
        } else if (event.type === "support_ticket_created") {
          const d = event.data as { id?: string; orderId?: string; clientName?: string };
          const orderLabel = d.orderId ? `pedido ${String(d.orderId).slice(0, 8)}` : "pedido";
          const clientLabel = d.clientName ? ` - ${d.clientName}` : "";
          message = `Novo ticket de suporte (${orderLabel})${clientLabel}`;
          fetchSupportTickets();
          showPushNotification("KA Imports — Novo Ticket de Suporte", message);
        } else if (event.type === "support_ticket_reshipment_authorized") {
          message = "Reenvio autorizado em chamado de suporte";
          fetchSupportTickets();
          fetchOrders(true);
          fetchInventoryOverview();
        } else if (event.type === "reshipment_stock_released") {
          message = "Reenvio liberado automaticamente por entrada de estoque";
          fetchOrders(true);
          fetchInventoryOverview();
        } else if (event.type === "reshipment_updated") {
          message = "Status de reenvio atualizado";
          fetchOrders(true);
          fetchInventoryOverview();
        }

        if (message) {
          const notif: Notification = { id: Date.now().toString(), message, time: new Date(), read: false, type: event.type };
          setNotifications((prev) => [notif, ...prev.slice(0, 49)]);
          toast.info(message);
        }
      } catch { /* ignore */ }
    };

    es.onerror = () => {
      es.close();
      if (sseReconnectTimerRef.current !== null) {
        window.clearTimeout(sseReconnectTimerRef.current);
      }
      sseReconnectTimerRef.current = window.setTimeout(async () => {
        sseReconnectTimerRef.current = null;
        if (!getToken() || sseUnauthorizedRef.current) return;

        try {
          const verifyRes = await fetch(`${BASE}/api/admin/verify`, {
            credentials: "include",
            cache: "no-store",
          });

          if (verifyRes.status === 401 || verifyRes.status === 403) {
            // SSE depends on cookie auth, while most admin requests still support bearer.
            // If bearer is still valid, keep user logged in and just stop SSE reconnect loop.
            const bearerVerifyRes = await fetch(`${BASE}/api/admin/verify`, {
              headers: authHeaders(),
              credentials: "include",
              cache: "no-store",
            });

            if (bearerVerifyRes.ok) {
              sseUnauthorizedRef.current = true;
              sseCookieMismatchNotifiedRef.current = true;
              console.warn("[SSE] Cookie auth expired; realtime updates paused until reload.");
              return;
            }

            handleUnauthorized();
            return;
          }
        } catch {
          // Network blip: keep trying to reconnect while token still exists.
        }

        if (getToken() && !sseUnauthorizedRef.current) connectSSE();
      }, 1000);
    };
  }, [fetchOrders, fetchCharges, fetchSellerData, fetchStatsData, fetchSupportTickets, fetchInventoryOverview, showPushNotification, handleUnauthorized]);

  // -------------------------------------------------------------------------
  // Mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    const token = getToken();
    console.log('[DEBUG] Token encontrado:', token);
    if (!token) {
      console.log('[DEBUG] Nenhum token encontrado, redirecionando para login');
      setLocation("/admin/login");
      return;
    }

    fetch(`${BASE}/api/admin/verify`, { headers: authHeaders(), credentials: "include" })
      .then(async (res) => {
        console.log('[DEBUG] Resposta /api/admin/verify:', res.status);
        if (!res.ok) {
          console.log('[DEBUG] /api/admin/verify não autorizado/forbidden, chamando handleUnauthorized');
          handleUnauthorized();
          return;
        }
        const data = await res.json() as { ok: boolean; isPrimary: boolean; username: string; tenantId?: string };
        console.log('[DEBUG] Dados recebidos do backend:', data);
        setIsPrimary(data.isPrimary);
        setCurrentUsername(data.username || "");
        setAdminTenantId(data.tenantId || "tenant_loja1");
        localStorage.setItem("adminIsPrimary", String(data.isPrimary));
        localStorage.setItem("adminUsername", data.username || "");
        if (data.tenantId) localStorage.setItem("adminTenantId", data.tenantId);
        setAuthChecked(true);
        fetchOrders();
        fetchCharges();
        fetchSettings();
        fetchBrevoStatus();
        fetchSellers();
        connectSSE();
        requestNotifPermission();
      })
      .catch((err) => {
        console.log('[DEBUG] Erro no fetch /api/admin/verify:', err);
        handleUnauthorized();
      });

    return () => {
      sseRef.current?.close();
      if (sseReconnectTimerRef.current !== null) {
        window.clearTimeout(sseReconnectTimerRef.current);
        sseReconnectTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authChecked) fetchAll();
  }, [dateFrom, dateTo, statusFilter, methodFilter, sellerFilter, tab, fetchAll, authChecked]);

  useEffect(() => {
    if (!canManageTenants) return;
    if (filialTenantOptions.length === 0) {
      if (selectedFilialTenantId) setSelectedFilialTenantId("");
      return;
    }

    const stillExists = filialTenantOptions.some((tenant) => tenant.id === selectedFilialTenantId);
    if (!stillExists) {
      setSelectedFilialTenantId(filialTenantOptions[0]?.id || "");
    }
  }, [canManageTenants, filialTenantOptions, selectedFilialTenantId]);

  useEffect(() => {
    if (!selectedFilialTenantId) return;
    setManualFilialItems([]);
    setManualFilialProductId("");
    setManualFilialQuantity("1");
    setManualFilialRepasseUnitCost("");
    setManualFilialClientName("Compra manual da filial");
  }, [selectedFilialTenantId]);

  useEffect(() => {
    if (!selectedManualFilialProduct) {
      setManualFilialRepasseUnitCost("");
      return;
    }
    setManualFilialRepasseUnitCost(String(selectedManualFilialProduct.costPrice || 0));
  }, [selectedManualFilialProduct]);

  useEffect(() => {
    if (!authChecked || tab !== "lojas" || lojasSubTab !== "pedidos") return;
    if (!selectedFilialTenantId) return;

    if (filialScopeSubTab === "pedidos") {
      void fetchFilialPurchaseRequests(selectedFilialTenantId);
      void fetchFilialStoreProducts(selectedFilialTenantId);
      return;
    }

    if (filialScopeSubTab === "estoque") {
      void fetchFilialInventoryOverview(selectedFilialTenantId);
      void fetchFilialStoreProducts(selectedFilialTenantId);
      return;
    }

    if (filialScopeSubTab === "produtos") {
      void fetchFilialStoreProducts(selectedFilialTenantId);
      void fetchFilialInventoryOverview(selectedFilialTenantId);
      return;
    }

    void fetchFilialStoreProducts(selectedFilialTenantId);
  }, [authChecked, tab, lojasSubTab, filialScopeSubTab, selectedFilialTenantId, fetchFilialPurchaseRequests, fetchFilialStoreProducts, fetchFilialInventoryOverview]);

  useEffect(() => {
    if (authChecked && tab === "commissions") {
      fetchCommissionPayments();
    }
  }, [authChecked, tab, commissionSellerFilter, commissionDateFrom, commissionDateTo, fetchCommissionPayments]);

  // Stats panel: independent fetch triggered by its own filters
  useEffect(() => {
    if (authChecked) fetchStatsData();
  }, [authChecked, statsDateFrom, statsDateTo, statsSeller, fetchStatsData]);

  // Fallback auto-refresh every 20s — catches any SSE events that were missed
  // (e.g. SSE reconnect gap, network blip, gateway delay)
  // Uses silent=true so data updates without flashing the loading spinner.
  useEffect(() => {
    if (!authChecked) return;
    const id = setInterval(() => {
      if (!getToken()) return;
      fetchOrders(true);
      fetchCharges(true);
      fetchStatsData();
      if (tab === "recurringCustomers") fetchRecurringCustomers();
    }, 20000);
    return () => clearInterval(id);
  }, [authChecked, tab, fetchOrders, fetchCharges, fetchStatsData, fetchRecurringCustomers]);

  useEffect(() => {
    if (authChecked && tab === "users") fetchUsers();
    if (authChecked && tab === "customers") fetchCustomers();
    if (authChecked && tab === "recurringCustomers") fetchRecurringCustomers();
  }, [tab, authChecked, fetchUsers, fetchCustomers, fetchRecurringCustomers]);

  useEffect(() => {
    if ((tab === "products" && !canManageProductsTab) || (!isPrimary && PRIMARY_ONLY_TABS.has(tab)) || (tab === "lojas" && !canManageTenants)) {
      setTab("orders");
    }
  }, [isPrimary, tab, canManageTenants, canManageProductsTab]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------
  const handleLogout = async () => {
    try { await fetch(`${BASE}/api/admin/logout`, { method: "POST", headers: authHeaders(), credentials: "include" }); } catch { /* ignore */ }
    sessionStorage.removeItem("adminToken");
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminIsPrimary");
    localStorage.removeItem("adminUsername");
    localStorage.removeItem("adminTenantId");
    setAdminTenantId("tenant_loja1");
    if (sseReconnectTimerRef.current !== null) {
      window.clearTimeout(sseReconnectTimerRef.current);
      sseReconnectTimerRef.current = null;
    }
    sseUnauthorizedRef.current = true;
    sseRef.current?.close();
    setLocation("/admin/login");
  };

  const updateOrderStatus = async (
    id: string,
    status: string,
    cardActuals?: { cardInstallmentsActual?: number; cardInstallmentValue?: number; cardTotalActual?: number },
    opts?: { adminPassword?: string },
  ) => {
    setStatusUpdating(id);
    try {
      const res = await fetch(`${BASE}/api/admin/orders/${id}/status`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ status, ...cardActuals, ...(opts?.adminPassword ? { adminPassword: opts.adminPassword } : {}) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { message?: string }));
        toast.error(data?.message || "Erro ao atualizar status.");
        return;
      }
      toast.success("Status atualizado!");
      setOrders((prev) => prev.map((o) => o.id === id ? { ...o, status, ...cardActuals } : o));
      if (status === "completed") setProofModal(id);
    } catch { toast.error("Erro ao atualizar status."); }
    finally { setStatusUpdating(null); }
  };

  const submitCardPaid = async () => {
    if (!cardPaidModal) return;
    setCardPaidSubmitting(true);
    try {
      const inst = parseInt(cardPaidForm.installments) || 0;
      const instVal = parseFloat(cardPaidForm.installmentValue.replace(",", ".")) || 0;
      const totVal = parseFloat(cardPaidForm.totalValue.replace(",", ".")) || 0;
      await updateOrderStatus(cardPaidModal, "completed", {
        cardInstallmentsActual: inst || undefined,
        cardInstallmentValue: instVal || undefined,
        cardTotalActual: totVal || undefined,
      });
      setCardPaidModal(null);
      setCardPaidForm({ installments: "", installmentValue: "", totalValue: "" });
    } finally { setCardPaidSubmitting(false); }
  };

  const updateOrderObservation = async (id: string, observation: string) => {
    try {
      await fetch(`${BASE}/api/admin/orders/${id}/observation`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify({ observation }),
      });
      setOrders((prev) => prev.map((o) => o.id === id ? { ...o, observation } : o));
    } catch { toast.error("Erro ao salvar observação."); }
  };

  const lookupChargeCep = async () => {
    const raw = createChargeForm.cep.replace(/\D/g, "");
    if (raw.length !== 8) { toast.error("CEP inválido."); return; }
    setCreateChargeCepLoading(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${raw}/json/`);
      const d = await r.json() as { logradouro?: string; bairro?: string; localidade?: string; uf?: string; erro?: boolean };
      if (d.erro) { toast.error("CEP não encontrado."); return; }
      setCreateChargeForm({ ...createChargeForm, cep: `${raw.slice(0,5)}-${raw.slice(5)}`, street: d.logradouro || createChargeForm.street, neighborhood: d.bairro || createChargeForm.neighborhood, city: d.localidade || createChargeForm.city, state: d.uf || createChargeForm.state });
    } catch { toast.error("Erro ao buscar CEP."); }
    finally { setCreateChargeCepLoading(false); }
  };

  const updateChargeObservation = async (id: string, observation: string) => {
    try {
      await fetch(`${BASE}/api/admin/custom-charges/${id}/observation`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify({ observation }),
      });
      setCharges((prev) => prev.map((c) => c.id === id ? { ...c, observation } : c));
    } catch { toast.error("Erro ao salvar observação."); }
  };

  const handleProofUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Arquivo muito grande. Máximo 5MB."); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setProofFile(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const submitProof = async () => {
    if (!proofModal || !proofFile) { toast.error("Selecione um comprovante."); return; }
    setProofUploading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/orders/${proofModal}/proof`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify({ proofData: proofFile }),
      });
      if (!res.ok) { toast.error("Erro ao enviar comprovante."); return; }
      const data = await res.json() as { ok: boolean; proofUrls?: string[] };
      toast.success("Comprovante adicionado!");
      setOrders((prev) => prev.map((o) => o.id === proofModal ? { ...o, status: "completed", proofUrl: proofFile!, proofUrls: data.proofUrls || [proofFile!] } : o));
      setProofModal(null); setProofFile(null);
    } catch { toast.error("Erro ao enviar comprovante."); }
    finally { setProofUploading(false); }
  };

  const updateChargeStatus = async (id: string, status: string) => {
    setChargeStatusUpdating(id);
    try {
      const res = await fetch(`${BASE}/api/admin/custom-charges/${id}/status`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify({ status }),
      });
      if (!res.ok) { toast.error("Erro ao atualizar status."); return; }
      toast.success("Status atualizado!");
      setCharges((prev) => prev.map((c) => c.id === id ? { ...c, status } : c));
      if (status === "paid") setChargeProofModal(id);
    } catch { toast.error("Erro ao atualizar status."); }
    finally { setChargeStatusUpdating(null); }
  };

  const handleChargeProofUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Arquivo muito grande. Máximo 5MB."); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setChargeProofFile(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const submitChargeProof = async () => {
    if (!chargeProofModal || !chargeProofFile) { toast.error("Selecione um comprovante."); return; }
    setChargeProofUploading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/custom-charges/${chargeProofModal}/proof`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify({ proofData: chargeProofFile }),
      });
      if (!res.ok) { toast.error("Erro ao enviar comprovante."); return; }
      const data = await res.json() as { ok: boolean; proofUrls?: string[] };
      toast.success("Comprovante adicionado!");
      setCharges((prev) => prev.map((c) => c.id === chargeProofModal ? { ...c, status: "paid", proofUrl: chargeProofFile!, proofUrls: data.proofUrls || [chargeProofFile!] } : c));
      setChargeProofModal(null); setChargeProofFile(null);
    } catch { toast.error("Erro ao enviar comprovante."); }
    finally { setChargeProofUploading(false); }
  };

  const exportData = async () => {
    const params = new URLSearchParams({ dateFrom, dateTo });
    if (statusFilter !== "all") params.set("status", statusFilter);
    const endpoint = tab === "orders"
      ? `${BASE}/api/admin/export`
      : `${BASE}/api/admin/custom-charges/export`;

    if (tab === "orders") {
      if (methodFilter !== "all") params.set("paymentMethod", methodFilter);
      if (sellerFilter !== "all") params.set("sellerCode", sellerFilter);
      if (groupFilter !== "all") params.set("whatsappGroup", groupFilter);
    }

    try {
      const res = await fetch(`${endpoint}?${params.toString()}`, {
        method: "GET",
        headers: authHeaders(),
        credentials: "include",
      });

      if (!res.ok) {
        toast.error("Erro ao exportar dados.");
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const match = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
      const fallback = tab === "orders" ? "orders-export.csv" : "charges-export.csv";
      const filename = match?.[1] ? decodeURIComponent(match[1].replace(/\"/g, "").trim()) : fallback;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Erro ao exportar dados.");
    }
  };

  const openOrderWhatsApp = (order: AdminOrder) => {
    const isCard = order.paymentMethod === "card_simulation";
    const firstName = order.clientName.trim().split(" ")[0] || order.clientName;
    const intro = isCard
      ? `Olá *${firstName}*, tudo bem? 😊\n\nEstou dando continuidade ao seu pedido no *cartão*. Seguem os detalhes para confirmarmos:\n\n`
      : "";
    const msg = intro + orderToFullText(order);
    const p = order.clientPhone.replace(/\D/g, "");
    window.open(`https://wa.me/${p.startsWith("55") ? p : "55" + p}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const openChargeWhatsApp = (charge: CustomCharge) => {
    const msg = chargeToText(charge);
    const p = charge.clientPhone.replace(/\D/g, "");
    window.open(`https://wa.me/${p.startsWith("55") ? p : "55" + p}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  // --------------------------------------------------------------------------
  // Bulk-discount tier resolver (mirrors server-side resolveUnitPriceForQuantity)
  // --------------------------------------------------------------------------
  function resolveEditItemPrice(catalogProduct: AdminProduct, quantity: number): number {
    const p = catalogProduct as any;
    const now = new Date();
    const regularPrice = Number(p.price || 0);
    const rawPromo = p.promoPrice == null ? null : Number(p.promoPrice);
    const promoEndsAt = p.promoEndsAt ? new Date(p.promoEndsAt) : null;
    const base =
      rawPromo != null && rawPromo > 0 && (promoEndsAt == null || now <= promoEndsAt)
        ? rawPromo
        : regularPrice;

    if (!p.bulkDiscountEnabled) return base;

    let tiers: Array<{ minQty: number; maxQty: number | null; unitPrice: number }> = [];
    try {
      const raw = typeof p.bulkDiscountTiers === "string"
        ? JSON.parse(p.bulkDiscountTiers)
        : p.bulkDiscountTiers;
      if (Array.isArray(raw)) {
        tiers = raw
          .map((t: any) => ({
            minQty: Number(t.minQty),
            maxQty: t.maxQty == null ? null : Number(t.maxQty),
            unitPrice: Number(t.unitPrice),
          }))
          .filter((t) => Number.isFinite(t.minQty) && t.minQty >= 1 && Number.isFinite(t.unitPrice) && t.unitPrice > 0)
          .sort((a, b) => a.minQty - b.minQty);
      }
    } catch { /* ignore */ }

    const tier = tiers.find((t) => quantity >= t.minQty && (t.maxQty == null || quantity <= t.maxQty));
    return tier ? tier.unitPrice : base;
  }

  // Order editing
  const openEditOrder = async (order: AdminOrder) => {
    setEditOrderModal(order);
    setEditItems(getOrderProducts(order.products).map((p) => ({ id: p.id, name: p.name, quantity: p.quantity, price: p.price })));
    setEditClientName(String(order.clientName || ""));
    setEditDiscount(order.discountAmount || 0);
    setEditAddress({
      cep: String(order.addressCep || ""),
      street: String(order.addressStreet || ""),
      number: String(order.addressNumber || ""),
      complement: String(order.addressComplement || ""),
      neighborhood: String(order.addressNeighborhood || ""),
      city: String(order.addressCity || ""),
      state: String(order.addressState || ""),
    });
    setEditProductSearch("");
    setEditAsReshipment(false);
    setEditItemsBeforeReshipmentMode(null);
    setDiffOrder(null);
    setDiffPixResult(null);
    if (editCatalog.length === 0) {
      setEditCatalogLoading(true);
      try {
        const res = await fetch(`${BASE}/api/products`);
        const data = await res.json() as { products: AdminProduct[] };
        setEditCatalog(data.products.filter((p) => p.isActive));
      } catch { /* ignore */ }
      finally { setEditCatalogLoading(false); }
    }
  };

  const openKycModal = async (orderId: string) => {
    setKycModal(orderId);
    setKycData(null);
    setKycLoading(true);
    setKycLinkCopied(false);
    try {
      const res = await fetch(`${BASE}/api/admin/kyc/${orderId}`, { headers: authHeaders() });
      const data = await res.json() as { kyc: KycDocument | null };
      setKycData(data.kyc);
      setKycEditForm({
        declarationProduct:       data.kyc?.declarationProduct       ?? "",
        declarationPurchaseValue: data.kyc?.declarationPurchaseValue ?? "",
        declarationDate:          data.kyc?.declarationDate          ?? "",
        declarationCompanyName:   data.kyc?.declarationCompanyName   ?? "",
        declarationCompanyCnpj:   data.kyc?.declarationCompanyCnpj   ?? "",
      });
    } catch { toast.error("Erro ao carregar KYC."); }
    finally { setKycLoading(false); }
  };

  const saveKycEdit = async () => {
    if (!kycModal) return;
    setKycEditSaving(true);
    try {
      const res = await fetch(`${BASE}/api/admin/kyc/${kycModal}`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify(kycEditForm),
      });
      if (!res.ok) { toast.error("Erro ao salvar."); return; }
      toast.success("Declaração atualizada!");
      setKycData((prev) => prev ? { ...prev, ...kycEditForm, adminEdited: true } : prev);
    } catch { toast.error("Erro ao salvar."); }
    finally { setKycEditSaving(false); }
  };

  const downloadKycDoc = (dataUrl: string, filename: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.click();
  };

  const printKycDeclaration = (order: AdminOrder, kyc: KycDocument) => {
    const addressFull = [
      order.addressStreet && order.addressNumber ? `${order.addressStreet}, ${order.addressNumber}` : null,
      order.addressComplement,
      order.addressNeighborhood,
      order.addressCity && order.addressState ? `${order.addressCity}/${order.addressState}` : null,
      order.addressCep ? `CEP ${order.addressCep}` : null,
    ].filter(Boolean).join(", ");
    // If admin set a custom declarationDate (datetime-local string), use it; otherwise fall back to signedAt or now
    let signedDate: string;
    if (kyc.declarationDate) {
      const dt = new Date(kyc.declarationDate);
      const datePart = dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
      const hours   = String(dt.getHours()).padStart(2, "0");
      const minutes = String(dt.getMinutes()).padStart(2, "0");
      signedDate = `${datePart}, às ${hours}h${minutes}`;
    } else {
      const fallback = kyc.declarationSignedAt ? new Date(kyc.declarationSignedAt) : new Date();
      signedDate = fallback.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
    }
    const w = window.open("", "_blank");
    if (!w) return;
    const sigHtml = kyc.declarationSignature && kyc.declarationSignature.startsWith("data:image")
      ? `<img src="${escapeHtml(kyc.declarationSignature)}" alt="Assinatura" style="max-height:80px;display:block;margin:0 auto 8px auto;">`
      : `<span style="font-family:'Times New Roman',serif;font-style:italic;font-size:18px">${escapeHtml(kyc.declarationSignature ?? order.clientName)}</span>`;
    const dateSp = new Date(order.createdAt).toLocaleDateString("pt-BR");
    const totalStr = Number(order.total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const last4 = kyc.cardNumber && kyc.cardNumber.length >= 4 ? kyc.cardNumber.slice(-4) : "****";
    const prodStr = kyc.declarationProduct || "---";
    const clientName = escapeHtml(order.clientName);
    const clientDocument = escapeHtml(order.clientDocument);
    const cityName = escapeHtml(order.addressCity || "São Paulo");
    const signedDateSafe = escapeHtml(signedDate);
    const dateSpSafe = escapeHtml(dateSp);
    const totalStrSafe = escapeHtml(totalStr);
    const last4Safe = escapeHtml(last4);
    const prodStrSafe = escapeHtml(prodStr);

    w.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Declaração KYC — ${clientName}</title>
  <style>
    body { font-family: 'Times New Roman', serif; max-width: 680px; margin: 40px auto; padding: 0 20px; color: #000; }
    h1 { text-align: center; font-size: 18px; text-transform: uppercase; margin-bottom: 30px; }
    p { line-height: 1.8; text-align: justify; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
    th, td { border: 1px solid #000; padding: 8px; text-align: center; }
    th { background-color: #f3f4f6; }
    ol { margin-bottom: 24px; padding-left: 24px; line-height: 1.6; text-align: justify; font-size: 14px; }
    .sig { border-top: 1px solid #000; display: inline-block; min-width: 300px; margin-top: 60px; padding-top: 8px; text-align: center; }
    .sig-container { text-align: center; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>Declaração de Compra</h1>
  <p>A quem possa interessar, eu <strong>${clientName}</strong>, CPF nº <strong>${clientDocument}</strong>, titular do cartão utilizado na transação relacionada à compra em questão, afirmo que reconheço a compra efetuada e que recebi corretamente as mercadorias/serviços adquiridos, segundo as informações abaixo citadas:</p>
  
  <table>
    <thead>
      <tr>
        <th>Data da Transação</th>
        <th>Valor</th>
        <th>4 Últimos Dígitos</th>
        <th>Produto/Serviço</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${dateSpSafe}</td>
        <td>${totalStrSafe}</td>
        <td>${last4Safe}</td>
        <td>${prodStrSafe}</td>
      </tr>
    </tbody>
  </table>

  <p>Afirmo que em caso de cancelamento da compra, estou ciente dos seguintes termos:</p>
  <ol>
    <li>Por se tratar de uma compra presencial, não é possível a aplicação do artigo 49 do CDC, referente a direito de arrependimento;</li>
    <li>A única forma de cancelamento desta compra é através da solicitação do estabelecimento à adquirente que processou a transação referente a esta;</li>
    <li>Nesse caso, o portador compromete-se a tentar solucionar toda e qualquer questão a respeito da compra diretamente com o lojista, apresentando evidências que comprovem a data em que foi efetuada a solicitação referente à questão.</li>
  </ol>
  
  <p>Ratifico serem verdadeiras as informações prestadas neste documento, e por ser expressa verdade, firmo a presente declaração, para que se produza seus efeitos legais.</p>

  <p style="margin-top:40px; text-align: center">${cityName}, ${signedDateSafe}</p>
  <div class="sig-container">
    ${sigHtml}<br/>
    <div class="sig">
      <strong>${clientName}</strong><br>
      <small>CPF: ${clientDocument}</small>
    </div>
  </div>
</body>
</html>`);
    w.document.close();
    setTimeout(() => w.print(), 500);
  };

  const updateKycStatus = async (orderId: string, action: "approve" | "reject") => {
    setKycStatusUpdating(orderId);
    try {
      const res = await fetch(`${BASE}/api/admin/kyc/${orderId}/status`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({ action }),
      });
      if (!res.ok) { toast.error("Erro ao atualizar status."); return; }
      toast.success(action === "approve" ? "KYC aprovado!" : "KYC negado.");
      setKycList((prev) => prev.map((k) =>
        k.orderId === orderId
          ? { ...k, status: action === "approve" ? "approved" : "rejected", approvedAt: action === "approve" ? new Date().toISOString() : k.approvedAt, approvedByUsername: action === "approve" ? (getAdminUsername() || null) : k.approvedByUsername, rejectedAt: action === "reject" ? new Date().toISOString() : k.rejectedAt }
          : k
      ));
      // Also update kycData in modal if open
      if (kycModal === orderId && kycData) {
        setKycData((prev) => prev ? {
          ...prev,
          status: action === "approve" ? "approved" : "rejected",
          approvedAt: action === "approve" ? new Date().toISOString() : prev.approvedAt,
          approvedByUsername: action === "approve" ? (getAdminUsername() || null) : prev.approvedByUsername,
          rejectedAt: action === "reject" ? new Date().toISOString() : prev.rejectedAt,
        } : prev);
      }
    } catch { toast.error("Erro ao atualizar status."); }
    finally { setKycStatusUpdating(null); }
  };

  const saveEditOrder = async () => {
    if (!editOrderModal || editItems.length === 0) { toast.error("Adicione ao menos um produto."); return; }
    const normalizedClientName = String(editClientName || "").trim();
    if (!editAsReshipment && !normalizedClientName) { toast.error("Informe o nome do cliente."); return; }
    setEditSaving(true);
    const originalTotal = editOrderModal.total;
    try {
      if (editAsReshipment) {
        const res = await fetch(`${BASE}/api/admin/orders/${editOrderModal.id}/reshipment`, {
          method: "POST", headers: authHeaders(),
          body: JSON.stringify({ products: editItems }),
        });
        const data = await res.json().catch(() => ({})) as { message?: string; reshipment?: { status?: string; missingProducts?: string[] } };
        if (!res.ok) {
          toast.error(data?.message || "Erro ao lançar reenvio.");
          return;
        }
        const missingCount = data?.reshipment?.missingProducts?.length || 0;
        if (missingCount > 0) {
          toast.success(`${data?.message || "Reenvio lançado."} Faltando estoque em ${missingCount} produto(s).`);
        } else {
          toast.success(data?.message || "Reenvio lançado com sucesso!");
        }
        setEditOrderModal(null);
        return;
      }

      const subtotal = editItems.reduce((s, p) => s + p.price * p.quantity, 0);
      const shippingCost = editOrderModal.shippingCost;
      const insuranceAmount = editOrderModal.includeInsurance ? Math.max(0, subtotal) * 0.1 : 0;
      const discountAmount = editDiscount || 0;
      const total = Math.max(0, subtotal + shippingCost + insuranceAmount - discountAmount);
      const nextOrderSnapshot = {
        ...editOrderModal,
        clientName: normalizedClientName,
        products: editItems,
        subtotal,
        insuranceAmount,
        total,
      };
      const res = await fetch(`${BASE}/api/admin/orders/${editOrderModal.id}/edit`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({
          clientName: normalizedClientName,
          products: editItems,
          discountAmount: discountAmount,
          address: {
            cep: editAddress.cep,
            street: editAddress.street,
            number: editAddress.number,
            complement: editAddress.complement,
            neighborhood: editAddress.neighborhood,
            city: editAddress.city,
            state: editAddress.state,
          },
        }),
      });
      if (!res.ok) { toast.error("Erro ao salvar edição."); return; }
      const data = await res.json() as { ok: boolean; order: AdminOrder };
      setOrders((prev) => prev.map((o) => o.id === editOrderModal.id ? { ...data.order, proofUrls: o.proofUrls } : o));
      toast.success("Pedido editado com sucesso!");
      const paidAmount = editOrderModal.paidAmount ?? null;
      const isPixOrder = editOrderModal.paymentMethod === "pix" || editOrderModal.paymentMethod === "whatsapp_pix";

      if (paidAmount != null && paidAmount > 0) {
        // Order has a recorded paid amount — use it as the reference
        const diff = total - paidAmount;
        if (diff > 0.01) {
          // New total exceeds what was paid → offer diff PIX for the exact difference
          setDiffOrder({ order: nextOrderSnapshot, diff, isPaid: true });
          setDiffPixResult(null);
        }
        // If diff <= 0 → backend already reverted status to "paid", nothing to do
      } else {
        // No paidAmount recorded — determine if the order was ever paid
        const diff = total - originalTotal;
        // "Never paid" = still in initial pending state with no proof of payment at all.
        // awaiting_payment means a previous diff PIX was generated but not yet confirmed —
        // the original payment already happened, so we still only charge the difference.
        const hasProof = !!(editOrderModal.proofUrl || (editOrderModal.proofUrls && editOrderModal.proofUrls.length > 0));
        const neverPaid = editOrderModal.status === "pending" && !hasProof;
        if (diff > 0.01 && isPixOrder) {
          if (neverPaid) {
            // Truly unpaid PIX order → generate PIX for the full new total
            setDiffOrder({ order: nextOrderSnapshot, diff: total, isPaid: false });
          } else {
            // Order was at some point paid (or diff is pending) → PIX only for the difference
            setDiffOrder({ order: nextOrderSnapshot, diff, isPaid: true });
          }
          setDiffPixResult(null);
        }
        // Unpaid card order: just save, no PIX needed
      }
      setEditOrderModal(null);
    } catch { toast.error("Erro ao salvar edição."); }
    finally { setEditSaving(false); }
  };

  const toggleEditAsReshipment = (enabled: boolean) => {
    setEditAsReshipment(enabled);
    if (enabled) {
      setEditItemsBeforeReshipmentMode(editItems);
      setEditItems([]);
      setEditProductSearch("");
      return;
    }
    if (editItemsBeforeReshipmentMode) {
      setEditItems(editItemsBeforeReshipmentMode);
    }
    setEditItemsBeforeReshipmentMode(null);
  };

  const createDiffPix = async () => {
    if (!diffOrder) return;
    setDiffPixLoading(true);
    setDiffPixCopied(false);
    try {
      const res = await fetch(`${BASE}/api/admin/orders/${diffOrder.order.id}/difference-charge`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ amount: diffOrder.diff }),
      });
      const data = await res.json() as { pixCode: string; pixBase64: string; pixImage: string; expiresAt: string };
      if (!res.ok) { toast.error((data as { message?: string }).message || "Erro ao gerar PIX."); return; }
      setDiffPixResult({ pixCode: data.pixCode, pixBase64: data.pixBase64 || data.pixImage || "", expiresAt: data.expiresAt });
      toast.success("PIX de diferença gerado!");
    } catch { toast.error("Erro ao gerar PIX."); }
    finally { setDiffPixLoading(false); }
  };

  const copyDiffPix = () => {
    if (!diffPixResult) return;
    navigator.clipboard.writeText(diffPixResult.pixCode).then(() => { setDiffPixCopied(true); setTimeout(() => setDiffPixCopied(false), 2000); });
  };

  // Users
  const createUser = async () => {
    if (!newUsername.trim() || !newPassword.trim()) { toast.error("Preencha usuário e senha."); return; }
    setUserCreating(true);
    try {
      const res = await fetch(`${BASE}/api/admin/users`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, fullAccess: newFullAccess }),
      });
      const data = await res.json() as { username?: string; message?: string };
      if (!res.ok) { toast.error(data.message || "Erro ao criar usuário."); return; }
      toast.success(`Usuário "${data.username}" criado!`);
      setNewUsername(""); setNewPassword(""); setNewFullAccess(false);
      fetchUsers();
    } catch { toast.error("Erro ao criar usuário."); }
    finally { setUserCreating(false); }
  };

  const toggleUserAccess = async (id: string, username: string, fullAccess: boolean) => {
    setUserAccessUpdating(id);
    try {
      const res = await fetch(`${BASE}/api/admin/users/${id}/access`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify({ fullAccess }),
      });
      const data = await res.json() as { message?: string };
      if (!res.ok) { toast.error(data.message || "Erro ao alterar acesso."); return; }
      toast.success(`Acesso de "${username}" ${fullAccess ? "promovido para total" : "alterado para limitado"}.`);
      fetchUsers();
    } catch { toast.error("Erro ao alterar acesso."); }
    finally { setUserAccessUpdating(null); }
  };

  const deleteUser = async (id: string, username: string) => {
    if (!confirm(`Remover usuário "${username}"?`)) return;
    setUserDeleting(id);
    try {
      const res = await fetch(`${BASE}/api/admin/users/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) { const d = await res.json() as { message?: string }; toast.error(d.message || "Erro."); return; }
      toast.success(`Usuário "${username}" removido.`);
      setAdminUsers((prev) => prev.filter((u) => u.id !== id));
    } catch { toast.error("Erro ao remover usuário."); }
    finally { setUserDeleting(null); }
  };

  const changeUserPassword = async (id: string, username: string, password: string): Promise<boolean> => {
    if (!password.trim()) { toast.error("Informe a nova senha."); return false; }
    if (password.trim().length < 6) { toast.error("A senha deve ter no mínimo 6 caracteres."); return false; }

    setUserPasswordUpdating(id);
    try {
      const res = await fetch(`${BASE}/api/admin/users/${id}/password`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ password: password.trim() }),
      });
      const data = await res.json().catch(() => ({})) as { message?: string };
      if (!res.ok) {
        toast.error(data.message || "Erro ao alterar senha.");
        return false;
      }
      toast.success(`Senha de "${username}" atualizada.`);
      return true;
    } catch {
      toast.error("Erro ao alterar senha.");
      return false;
    } finally {
      setUserPasswordUpdating(null);
    }
  };

  // Coupons handlers
  const createCoupon = async () => {
    if (!couponForm.code.trim() || !couponForm.discountValue) { toast.error("Preencha código e valor."); return; }
    setCouponCreating(true);
    try {
      const res = await fetch(`${BASE}/api/admin/coupons`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({
          code:          couponForm.code,
          discountType:  couponForm.discountType,
          discountValue: Number(couponForm.discountValue),
          minOrderValue: couponForm.minOrderValue ? Number(couponForm.minOrderValue) : null,
          maxUses:       couponForm.maxUses ? Number(couponForm.maxUses) : null,
          eligibleProductIds: couponForm.eligibleProductIds,
        }),
      });
      let data: (Coupon & { message?: string }) | null = null;
      let textFallback = "";
      try {
        data = await res.json() as Coupon & { message?: string };
      } catch {
        try {
          textFallback = await res.text();
        } catch {
          textFallback = "";
        }
      }
      if (!res.ok) {
        const msg = data?.message || textFallback || `Erro ao criar cupom (HTTP ${res.status}).`;
        toast.error(msg);
        return;
      }
      if (!data) {
        toast.error("Resposta inválida ao criar cupom.");
        return;
      }
      toast.success(`Cupom "${data.code}" criado!`);
      setCouponForm({ code: "", discountType: "percent", discountValue: "", minOrderValue: "", maxUses: "", eligibleProductIds: [] });
      setCoupons((prev) => [...prev, data]);
    } catch { toast.error("Erro ao criar cupom."); }
    finally { setCouponCreating(false); }
  };

  const toggleCoupon = async (id: string, isActive: boolean) => {
    try {
      await fetch(`${BASE}/api/admin/coupons/${id}`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify({ isActive }),
      });
      setCoupons((prev) => prev.map((c) => c.id === id ? { ...c, isActive } : c));
      toast.success(isActive ? "Cupom ativado." : "Cupom desativado.");
    } catch { toast.error("Erro ao atualizar cupom."); }
  };

  const deleteCoupon = async (id: string, code: string) => {
    if (!confirm(`Remover cupom "${code}"?`)) return;
    setCouponDeleting(id);
    try {
      await fetch(`${BASE}/api/admin/coupons/${id}`, { method: "DELETE", headers: authHeaders() });
      setCoupons((prev) => prev.filter((c) => c.id !== id));
      toast.success(`Cupom "${code}" removido.`);
    } catch { toast.error("Erro ao remover cupom."); }
    finally { setCouponDeleting(null); }
  };

  // Seller links — use root domain only (no path prefix) so links work on any custom domain
  const siteOrigin = window.location.origin;

  const saveSeller = async (slug: string, whatsapp: string, hasCommission: boolean, commissionRate: number) => {
    if (!slug.trim()) return;
    const clean = slug.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (!clean) return;
    try {
      const res = await fetch(`${BASE}/api/admin/sellers`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ slug: clean, whatsapp, hasCommission, commissionRate }),
      });
      if (!res.ok) { toast.error("Erro ao salvar vendedor."); return; }
      const data = await res.json() as { seller: SavedSellerItem };
      setSellers((prev) => {
        const exists = prev.some((s) => s.slug === data.seller.slug);
        return exists ? prev.map((s) => (s.slug === data.seller.slug ? data.seller : s)) : [...prev, data.seller];
      });
      setSellerInput("");
      setSellerWhatsappInput("");
      setSellerHasCommissionInput(true);
      setSellerCommissionRateInput("5");
      toast.success(`Vendedor salvo: ${siteOrigin}/${clean}`);
    } catch { toast.error("Erro ao salvar vendedor."); }
  };

  const removeSeller = async (slug: string) => {
    try {
      await fetch(`${BASE}/api/admin/sellers/${slug}`, { method: "DELETE", headers: authHeaders() });
      setSellers((prev) => prev.filter((s) => s.slug !== slug));
      toast.info("Link removido.");
    } catch { toast.error("Erro ao remover vendedor."); }
  };

  const updateSellerCommission = async (slug: string, whatsapp: string, hasCommission: boolean, commissionRate: number) => {
    const clean = String(slug || "").trim().toLowerCase();
    if (!clean) return;
    setSellerCommissionUpdatingSlug(clean);
    try {
      const normalizedRate = hasCommission ? Math.max(0, Number(commissionRate || 0)) : 0;
      const res = await fetch(`${BASE}/api/admin/sellers`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ slug: clean, whatsapp: whatsapp || "", hasCommission, commissionRate: normalizedRate }),
      });
      if (!res.ok) {
        toast.error("Erro ao atualizar comissão do vendedor.");
        return false;
      }
      const data = await res.json() as { seller: SavedSellerItem };
      setSellers((prev) => prev.map((s) => (s.slug === clean ? data.seller : s)));
      toast.success(`Comissão de ${clean} atualizada.`);
      return true;
    } catch {
      toast.error("Erro ao atualizar comissão do vendedor.");
      return false;
    } finally {
      setSellerCommissionUpdatingSlug(null);
    }
  };

  const copySeller = (slug: string) => {
    navigator.clipboard.writeText(`${siteOrigin}/${slug}`);
    setCopiedSeller(slug);
    toast.success("Link copiado!");
    setTimeout(() => setCopiedSeller(null), 2000);
  };

  // Atualizar junto com stats (must be before the early return to respect Rules of Hooks)
  React.useEffect(() => { if (authChecked) fetchFinancialSummary(); }, [authChecked, statsDateFrom, statsDateTo, statsSeller, fetchFinancialSummary]);

  // -------------------------------------------------------------------------
  // Guard
  // -------------------------------------------------------------------------
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
          <p className="text-muted-foreground font-medium">Verificando acesso...</p>
        </div>
      </div>
    );
  }

  const filteredOrders  = orders.filter((o) => {
    const q = search.toLowerCase();
    return !q || o.id.toLowerCase().includes(q) || o.clientName.toLowerCase().includes(q) ||
      o.clientPhone.includes(q) || o.clientEmail.toLowerCase().includes(q);
  });
  const filteredCharges = charges.filter((c) => {
    const q = search.toLowerCase();
    return !q || c.id.toLowerCase().includes(q) || c.clientName.toLowerCase().includes(q) ||
      c.clientPhone.includes(q) || c.clientEmail.toLowerCase().includes(q);
  });

  const paidOrders      = orders.filter((o) => o.status === "paid" || o.status === "completed");
  const revenue         = paidOrders.reduce((s, o) => s + Number(o.total), 0);
  const chargeRevenue   = charges.filter((c) => c.status === "paid").reduce((s, c) => s + Number(c.amount), 0);
  const isActiveReshipmentOrder = (order: AdminOrder): boolean => Boolean((order as { reshipment?: { id?: string; status?: string } }).reshipment?.id)
    && !["reenvio_enviado", "reenvio_resolvido_sem_entrada"].includes(String((order as { reshipment?: { status?: string } }).reshipment?.status || ""));

  const extractOriginalOrderIdFromObservation = (order: AdminOrder): string | null => {
    const raw = String(order.observation || "");
    const match = raw.match(/REENVIO DO PEDIDO\s+([a-z0-9]+)/i);
    return match?.[1]?.trim().toLowerCase() || null;
  };

  const isSupportReshipmentChild = (order: AdminOrder): boolean => !!extractOriginalOrderIdFromObservation(order);

  const ordersParaEnviarDedupForCopy = (input: AdminOrder[]): AdminOrder[] => {
    const byKey = new Map<string, AdminOrder>();

    for (const order of input) {
      const key = isActiveReshipmentOrder(order)
        ? `reship:${extractOriginalOrderIdFromObservation(order) || String(order.id || "").toLowerCase()}`
        : `order:${String(order.id || "").toLowerCase()}`;

      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, order);
        continue;
      }

      const existingChild = isSupportReshipmentChild(existing);
      const currentChild = isSupportReshipmentChild(order);
      if (currentChild && !existingChild) {
        byKey.set(key, order);
        continue;
      }

      const existingTs = new Date(existing.createdAt || 0).getTime();
      const currentTs = new Date(order.createdAt || 0).getTime();
      if (currentTs > existingTs) {
        byKey.set(key, order);
      }
    }

    return Array.from(byKey.values()).sort((a, b) => {
      const aTs = new Date(a.createdAt || 0).getTime();
      const bTs = new Date(b.createdAt || 0).getTime();
      return bTs - aTs;
    });
  };

  const ordersParaEnviar = orders.filter((o) => {
    const isActiveReshipment = isActiveReshipmentOrder(o);
    const isPendingNormalShipment = (o.status === "paid" || o.status === "completed") && !o.enviado;
    return isPendingNormalShipment || isActiveReshipment;
  });
  const ordersParaEnviarCopyBase = ordersParaEnviarDedupForCopy(ordersParaEnviar);

  const copyShoppingList = async (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();

    if (ordersParaEnviarCopyBase.length === 0) {
      toast.info("Nao ha pedidos pendentes.");
      return;
    }

    const totals = new Map<string, { label: string; productId: string | null; qtyNormal: number; qtyReshipment: number }>();
    for (const order of ordersParaEnviarCopyBase) {
      const isReshipment = isActiveReshipmentOrder(order);
      for (const p of getOrderProducts(order.products)) {
        const name = (p.name || "Produto").trim();
        const productId = String((p as { id?: string })?.id || "").trim() || null;
        const qty = Number(p.quantity) || 0;
        const key = productId ? `id:${productId}` : `name:${name.toLowerCase()}`;
        const prev = totals.get(key);
        totals.set(key, {
          label: prev?.label || name,
          productId,
          qtyNormal: (prev?.qtyNormal || 0) + (isReshipment ? 0 : qty),
          qtyReshipment: (prev?.qtyReshipment || 0) + (isReshipment ? qty : 0),
        });
      }
    }

    const costById = new Map(products.map((p) => [String(p.id), Number((p as { costPrice?: number | null }).costPrice || 0)] as const));
    const costByName = new Map(products.map((p) => [String(p.name || "").trim().toLowerCase(), Number((p as { costPrice?: number | null }).costPrice || 0)] as const));
    const productNameById = new Map(products.map((p) => [String(p.id), String(p.name || "").trim()] as const));

    let balancesSnapshot = inventoryBalances;
    if (isPrimary && balancesSnapshot.length === 0) {
      try {
        const res = await fetch(`${BASE}/api/admin/inventory/overview`, { headers: authHeaders() });
        if (res.ok) {
          const data = await res.json() as { balances?: InventoryBalanceRecord[] };
          if (Array.isArray(data?.balances)) {
            balancesSnapshot = data.balances;
            setInventoryBalances(data.balances);
          }
        }
      } catch {
        // keep current snapshot and continue
      }
    }

    const stockById = new Map(
      balancesSnapshot.map((row) => [String(row.productId || "").trim(), Number(row.quantity || 0)] as const),
    );
    const stockByName = new Map(
      balancesSnapshot.map((row) => [String(row.productName || "").trim().toLowerCase(), Number(row.quantity || 0)] as const),
    );

    const breakdown = [...totals.values()]
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))
      .map((item) => {
        const normalizedName = item.label.trim().toLowerCase();
        const fallbackName = item.productId ? (productNameById.get(item.productId)?.trim().toLowerCase() || "") : "";
        const available = item.productId
          ? (stockById.get(item.productId) ?? stockByName.get(fallbackName) ?? stockByName.get(normalizedName) ?? 0)
          : (stockByName.get(normalizedName) ?? 0);
        const fromStock = Math.min(Math.max(available, 0), item.qtyNormal);
        const toBuyNormal = Math.max(0, item.qtyNormal - fromStock);
        const toBuyReshipment = Math.max(0, item.qtyReshipment);
        const toBuy = toBuyNormal + toBuyReshipment;
        return { ...item, fromStock, toBuy, toBuyReshipment };
      });

    const buyLines = breakdown
      .filter((item) => item.toBuy > 0)
      .map((item) => `- ${item.toBuy}x ${item.label}`);

    const stockLines = breakdown
      .filter((item) => item.fromStock > 0)
      .map((item) => `- ${item.fromStock}x ${item.label}`);

    const reshipmentLines = breakdown
      .filter((item) => item.toBuyReshipment > 0)
      .map((item) => `- ${item.toBuyReshipment}x ${item.label}`);

    const estimatedTotalCost = breakdown.reduce((sum, item) => {
      const unitCost = item.productId ? costById.get(item.productId) : undefined;
      const fallback = costByName.get(item.label.trim().toLowerCase());
      const effectiveCost = unitCost ?? fallback ?? 0;
      return sum + (item.toBuy * effectiveCost);
    }, 0);

    const stockSectionLabel = balancesSnapshot.length > 0
      ? "Itens ja cobertos por estoque (nao comprar):"
      : "Itens ja cobertos por estoque (nao comprar):\n- Estoque nao carregado";

    const text = [
      `Lista de Compra - ${ordersParaEnviarCopyBase.length} pedido${ordersParaEnviarCopyBase.length !== 1 ? "s" : ""}`,
      "",
      "Comprar agora:",
      buyLines.length ? buyLines.join("\n") : "- Nada para comprar",
      "",
      "🚨 Reenvios (abater no pagamento):",
      reshipmentLines.length ? reshipmentLines.join("\n") : "- Nenhum reenvio na lista",
      "",
      stockSectionLabel,
      stockLines.length ? stockLines.join("\n") : "- Nenhum item coberto",
      "",
      `Valor total estimado de custo (somente compra): ${formatCurrency(estimatedTotalCost)}`,
    ].join("\n");

    try {
      const mode = await copyText(text);
      toast.success(mode === "manual" ? "Texto aberto para copia manual." : "Lista de compra copiada!");
    } catch {
      toast.error("Nao foi possivel copiar a lista.");
    }
  };

  const copyOrdersParaEnviar = async (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();

    if (ordersParaEnviarCopyBase.length === 0) {
      toast.info("Nao ha pedidos pendentes para copiar.");
      return;
    }

    const text = ordersParaEnviarCopyBase.map((order, index) => supplierOrderBlock(order, index + 1)).join("\n\n");
    try {
      const mode = await copyText(text);
      toast.success(mode === "manual" ? "Texto aberto para copia manual." : "Pedidos copiados com sucesso.");
    } catch {
      toast.error("Nao foi possivel copiar os pedidos.");
    }
  };

  // ── Dashboard stats — uses independently fetched data (own API call) ─────
  const statsPaidOrders    = statsOrdersData.filter((o) => o.status === "paid" || o.status === "completed");
  const statsPixPaid       = statsPaidOrders.filter((o) => o.paymentMethod === "pix" || o.paymentMethod === "whatsapp_pix");
  const statsCardPaid      = statsPaidOrders.filter((o) => o.paymentMethod === "card_simulation");
  const statsLinkPaid      = statsChargesData.filter((c) => c.status === "paid");
  const statsPendingCount  = statsOrdersData.filter((o) => o.status === "awaiting_payment" || o.status === "pending").length;

  const statsPixRevenue      = statsPixPaid.reduce((s, o) => s + Number(o.total), 0);
  const statsCardRevenue     = statsCardPaid.reduce((s, o) => s + Number(o.total), 0);
  const statsLinkRevenue     = statsLinkPaid.reduce((s, c) => s + Number(c.amount), 0);
  const statsTotalRevenue    = statsPixRevenue + statsCardRevenue + statsLinkRevenue;
  const statsTotalPaid       = statsPixPaid.length + statsCardPaid.length + statsLinkPaid.length;

  const sellerCommissionMap = new Map(
    sellers.map((s) => [s.slug.toLowerCase(), s.hasCommission ? Number(s.commissionRate || 0) : 0] as const),
  );
  const getCommissionRate = (sellerCode?: string | null, snapshot?: number | null) => {
    if (snapshot != null && !Number.isNaN(Number(snapshot))) {
      return Number(snapshot);
    }
    if (!sellerCode) return 0;
    const mapped = sellerCommissionMap.get(String(sellerCode).toLowerCase());
    if (mapped == null) return 5;
    return mapped;
  };

  const statsOrderCommission = statsPaidOrders.reduce((sum, order) => {
    const rate = getCommissionRate(order.sellerCode, order.sellerCommissionRateSnapshot);
    return sum + (Number(order.total) * rate) / 100;
  }, 0);
  const statsLinkCommission = statsLinkPaid.reduce((sum, charge) => {
    const rate = getCommissionRate(charge.sellerCode);
    return sum + (Number(charge.amount) * rate) / 100;
  }, 0);
  const statsTotalCommission = statsOrderCommission + statsLinkCommission;

  const productCostMap = new Map(statsProductsData.map((p) => [p.id, Number(p.costPrice || 0)] as const));
  const statsTotalCost = statsPaidOrders.reduce((sum, order) => {
    const orderCost = getOrderProducts(order.products).reduce((lineSum, item) => {
      const qty = Number(item.quantity) || 0;
      const lineCost = item.costPrice != null ? Number(item.costPrice) : Number(productCostMap.get(item.id) || 0);
      return lineSum + qty * lineCost;
    }, 0);
    return sum + orderCost;
  }, 0);
  const statsNetRevenue = statsTotalRevenue - statsTotalCost - statsTotalCommission;

  const statsGeneratedOrders  = statsOrdersData;
  const statsGeneratedCharges = statsChargesData;
  const statsTotalGenerated   = statsGeneratedOrders.reduce((s, o) => s + Number(o.total), 0)
    + statsGeneratedCharges.reduce((s, c) => s + Number(c.amount), 0);

  const statsTopProductsMap = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const order of statsPaidOrders) {
    for (const product of getOrderProducts(order.products)) {
      const key = String(product.name || "").trim().toLowerCase();
      if (!key) continue;
      const current = statsTopProductsMap.get(key);
      const qty = Number(product.quantity) || 0;
      const unitPrice = Number(product.price) || 0;
      const lineRevenue = qty * unitPrice;
      if (current) {
        current.quantity += qty;
        current.revenue += lineRevenue;
      } else {
        statsTopProductsMap.set(key, { name: product.name, quantity: qty, revenue: lineRevenue });
      }
    }
  }
  const statsTopProducts = Array.from(statsTopProductsMap.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  // All registered sellers for dropdowns — use sellers state (always loaded on mount)
  const allSellers = sellers.map((s) => s.slug);
  const orderGroups = Array.from(new Set(
    orders
      .map((o) => String((o as { whatsappGroup?: string | null }).whatsappGroup || "").trim())
      .filter(Boolean),
  ));
  const availableWhatsappGroups = Array.from(new Set([...ORDER_WHATSAPP_GROUP_OPTIONS, ...orderGroups]));

  // =========================================================================
  // RENDER
  // =========================================================================
  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">

        {/* Admin panel header bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Painel Administrativo</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Gerencie pedidos, vendas e configurações</p>
          </div>
          <div className="flex gap-2 flex-wrap self-start sm:self-auto items-center">
            {/* Live Stats */}
            <div className="hidden sm:flex gap-3 mr-2 bg-orange-50 border border-orange-200 px-3 py-1.5 rounded-lg text-sm font-semibold text-orange-800">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                👁️ {liveStats.catalog} visitantes ao vivo catálogo
              </span>
              <span className="w-px h-5 bg-orange-200 mx-1"></span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                🛒 {liveStats.checkout} visitantes ao vivo checkout
              </span>
            </div>
            
            <div className="flex sm:hidden w-full gap-2 mb-2 bg-orange-50 border border-orange-200 p-2 rounded-lg text-xs font-semibold text-orange-800 justify-between items-center">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                👁️ {liveStats.catalog} no catálogo
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                🛒 {liveStats.checkout} no checkout
              </span>
            </div>
            {/* Notification bell */}
            <div className="relative">
              <Button variant="outline" size="sm" onClick={() => { setShowNotif((v) => !v); setNotifications((n) => n.map((x) => ({ ...x, read: true }))); }} className="gap-2 relative h-9">
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Button>
              <AnimatePresence>
                {showNotif && (
                  <motion.div initial={{ opacity: 0, y: 8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                    className="absolute right-0 top-11 z-50 w-80 bg-white border border-border shadow-xl rounded-2xl overflow-hidden">
                    <div className="p-3 border-b border-border font-semibold text-sm flex items-center justify-between">
                      <span>Notificações</span>
                      <button onClick={() => setNotifications([])} className="text-xs text-muted-foreground hover:text-destructive">Limpar</button>
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <p className="text-center text-muted-foreground text-sm py-6">Sem notificações</p>
                      ) : notifications.map((n) => (
                        <div key={n.id} className={`p-3 border-b border-border/50 text-sm ${n.read ? "bg-white" : "bg-blue-50"}`}>
                          <p className="font-medium">{n.message}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{formatTimeBR(n.time)}</p>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <Button variant="outline" size="sm" onClick={fetchAll} className="gap-2 h-9"><RefreshCw className="w-4 h-4" />Atualizar</Button>
            {(tab === "orders" || tab === "charges") && (
              <Button variant="outline" size="sm" onClick={exportData} className="gap-2 h-9 text-green-700 border-green-200 hover:bg-green-50">
                <Download className="w-4 h-4" />Exportar CSV
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2 h-9 text-red-600 border-red-200 hover:bg-red-50">
              <LogOut className="w-4 h-4" />Sair
            </Button>
          </div>
        </div>

        {/* ── Dashboard Stats ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-border/60 shadow-sm p-5 mb-6">
          {/* Filter row */}
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-foreground">Visão Geral de Vendas</span>
              {statsLoading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                : <span className="text-xs text-muted-foreground">Período selecionado</span>
              }
            </div>
            <div className="flex items-center gap-1.5 ml-auto flex-wrap">
              <span className="text-xs text-muted-foreground">De</span>
              <input type="date" value={statsDateFrom} onChange={(e) => setStatsDateFrom(e.target.value)}
                className="h-8 px-2 rounded-lg border border-border bg-muted/40 text-xs cursor-pointer outline-none focus:border-primary" />
              <span className="text-xs text-muted-foreground">até</span>
              <input type="date" value={statsDateTo} onChange={(e) => setStatsDateTo(e.target.value)}
                className="h-8 px-2 rounded-lg border border-border bg-muted/40 text-xs cursor-pointer outline-none focus:border-primary" />
              <select value={statsSeller} onChange={(e) => setStatsSeller(e.target.value)}
                className="h-8 px-2 rounded-lg border border-border bg-muted/40 text-xs cursor-pointer outline-none focus:border-primary">
                <option value="all">Todos os vendedores</option>
                {allSellers.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Row 1 — Total Pago + Total Gerado + Faturamento Líquido */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <div className="rounded-xl border bg-gradient-to-br from-emerald-50 to-emerald-100/60 border-emerald-200 p-5 flex flex-col gap-1">
              <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">Total Pago</p>
              <p className="text-3xl font-bold text-emerald-700">{formatCurrency(statsTotalRevenue)}</p>
              <p className="text-xs text-emerald-600">{statsTotalPaid} vendas pagas · PIX + Links + Cartão</p>
              <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                <span>PIX+Links: <strong className="text-emerald-700">{formatCurrency(statsPixRevenue + statsLinkRevenue)}</strong></span>
                <span>Cartão: <strong className="text-emerald-700">{formatCurrency(statsCardRevenue)}</strong></span>
              </div>
            </div>
            <div className="rounded-xl border bg-gradient-to-br from-blue-50 to-blue-100/60 border-blue-200 p-5 flex flex-col gap-1">
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Total Gerado</p>
              <p className="text-3xl font-bold text-blue-700">{formatCurrency(statsTotalGenerated)}</p>
              <p className="text-xs text-blue-600">{statsGeneratedOrders.length + statsGeneratedCharges.length} pedidos (todos os status)</p>
              <p className="text-[11px] text-blue-700/90">Inclui: pendente, aguardando, pago, concluído e cancelado.</p>
              <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                <span>Pendentes: <strong className="text-yellow-700">{statsPendingCount}</strong></span>
                <span>Conversão: <strong className="text-blue-700">{statsTotalGenerated > 0 ? ((statsTotalRevenue / statsTotalGenerated) * 100).toFixed(0) : "0"}%</strong></span>
              </div>
            </div>
            <div className="rounded-xl border bg-gradient-to-br from-teal-50 to-teal-100/60 border-teal-200 p-5 flex flex-col gap-1">
              <p className="text-xs font-semibold text-teal-600 uppercase tracking-wide">Faturamento Líquido</p>
              <p className="text-3xl font-bold text-teal-700">
                {financialSummary
                  ? formatCurrency(Number(financialSummary.realNetRevenue) || 0)
                  : formatCurrency(Number(statsNetRevenue) || 0)}
              </p>
              <p className="text-xs text-teal-700">Total pago - custo dos produtos - comissão - taxas do gateway - taxas de saque</p>
              <div className="flex gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                <span>Custo: <strong className="text-red-700">-{formatCurrency(Number(financialSummary?.totalCost) || 0)}</strong></span>
                <span>Comissão: <strong className="text-amber-700">-{formatCurrency(Number(financialSummary?.totalCommission) || 0)}</strong></span>
                <span>Gastos marketing: <strong className="text-red-700">-{formatCurrency(Number(financialSummary?.totalMarketingExpenses) || 0)}</strong></span>
                {financialSummary && (
                  <>
                    <span>Taxas do gateway: <strong className="text-pink-700">-{formatCurrency(Number(financialSummary.totalGatewayFees) || 0)}</strong></span>
                    <span>Taxas de saque: <strong className="text-pink-700">-{formatCurrency(Number(financialSummary.totalWithdrawFees) || 0)}</strong></span>

                    {financialSummary.whatsappEconomy > 0 && (
                      <span>Economia WhatsApp: <strong className="text-green-700">+{formatCurrency(Number(financialSummary.whatsappEconomy) || 0)}</strong></span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Row 1.5 — Gateway Fees/Líquido Real removido, agora integrado ao card de Faturamento Líquido */}

          {canManageTenants && (
            <div className="grid grid-cols-1 gap-3 mb-3">
              <div className="rounded-xl border bg-gradient-to-br from-indigo-50 to-sky-100/60 border-indigo-200 p-5 flex flex-col gap-1">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">Lucro líquido de repasse para afiliadas</p>
                  <select
                    value={affiliateRepasseDateBasis}
                    onChange={(e) => setAffiliateRepasseDateBasis(e.target.value as "purchaseRecordedAt" | "createdAt")}
                    className="h-8 px-2 rounded-lg border border-indigo-200 bg-white/80 text-xs cursor-pointer outline-none focus:border-indigo-400"
                  >
                    <option value="purchaseRecordedAt">Base: confirmação do repasse</option>
                    <option value="createdAt">Base: criação da solicitação</option>
                  </select>
                </div>
                <p className="text-3xl font-bold text-indigo-800">
                  {formatCurrency(Number(financialSummary?.affiliateRepasseNetProfit) || 0)}
                </p>
                <p className="text-xs text-indigo-700">
                  Mostra apenas o lucro da Loja 1 nos repasses para filiais. Nao inclui lucro operacional das afiliadas.
                </p>
                <div className="flex gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                  <span>Repasse total: <strong className="text-indigo-800">{formatCurrency(Number(financialSummary?.affiliateRepasseTotal) || 0)}</strong></span>
                  <span>Custo real Loja 1: <strong className="text-red-700">-{formatCurrency(Number(financialSummary?.affiliateRepasseRealCostTotal) || 0)}</strong></span>
                  <span>Operações: <strong className="text-indigo-800">{Number(financialSummary?.affiliateRepasseCount) || 0}</strong></span>
                </div>
              </div>
            </div>
          )}

          {/* Row 1.6 — Clientes novos vs recorrentes */}
          <div className="mt-3 rounded-xl border bg-gradient-to-br from-cyan-50 to-sky-100/60 border-cyan-200 p-5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-semibold text-cyan-700 uppercase tracking-wide">Clientes no Período</p>
              <span className="text-xs text-cyan-700/80">
                {financialSummary?.customerRecurrence?.totalUniqueCustomers ?? 0} únicos
              </span>
            </div>

            <div className="h-3 w-full rounded-full bg-cyan-100 overflow-hidden border border-cyan-200/70">
              <div
                className="h-full bg-blue-500"
                style={{ width: `${Math.min(100, Math.max(0, financialSummary?.customerRecurrence?.recurringRate ?? 0))}%` }}
              />
            </div>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
              <div className="rounded-lg bg-white/70 border border-cyan-200 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Clientes recorrentes (qtd)</p>
                <p className="font-bold text-blue-700">
                  {financialSummary?.customerRecurrence?.recurringCustomers ?? 0}
                  <span className="text-xs font-semibold text-blue-600 ml-1">
                    ({Number(financialSummary?.customerRecurrence?.recurringRate ?? 0).toFixed(1)}%)
                  </span>
                </p>
              </div>
              <div className="rounded-lg bg-white/70 border border-cyan-200 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Novos</p>
                <p className="font-bold text-emerald-700">
                  {financialSummary?.customerRecurrence?.newCustomers ?? 0}
                  <span className="text-xs font-semibold text-emerald-600 ml-1">
                    ({Number(financialSummary?.customerRecurrence?.newRate ?? 0).toFixed(1)}%)
                  </span>
                </p>
              </div>
              <div className="rounded-lg bg-white/70 border border-cyan-200 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Taxa de recorrência (%)</p>
                <p className="font-bold text-cyan-800">
                  {Number(financialSummary?.customerRecurrence?.recurringRate ?? 0).toFixed(1)}%
                </p>
              </div>
            </div>
          </div>

          {/* Row 2 — Cards individuais */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* PIX Loja */}
            <div className="rounded-xl border p-4 bg-blue-50 border-blue-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">PIX da Loja</p>
                <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold">PIX</span>
              </div>
              <p className="text-2xl font-bold text-blue-800">{formatCurrency(statsPixRevenue)}</p>
              <p className="text-xs text-blue-600 mt-1">{statsPixPaid.length} pedido{statsPixPaid.length !== 1 ? "s" : ""} pago{statsPixPaid.length !== 1 ? "s" : ""}</p>
            </div>
            {/* Link de Pagamento */}
            <div className="rounded-xl border p-4 bg-orange-50 border-orange-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">Links de Pagamento</p>
                <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-semibold">PIX</span>
              </div>
              <p className="text-2xl font-bold text-orange-800">{formatCurrency(statsLinkRevenue)}</p>
              <p className="text-xs text-orange-600 mt-1">{statsLinkPaid.length} link{statsLinkPaid.length !== 1 ? "s" : ""} pago{statsLinkPaid.length !== 1 ? "s" : ""}</p>
            </div>
            {/* Cartão */}
            <div className="rounded-xl border p-4 bg-purple-50 border-purple-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">Cartão de Crédito</p>
                <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-semibold">CARTÃO</span>
              </div>
              <p className="text-2xl font-bold text-purple-800">{formatCurrency(statsCardRevenue)}</p>
              <p className="text-xs text-purple-600 mt-1">{statsCardPaid.length} pedido{statsCardPaid.length !== 1 ? "s" : ""} pago{statsCardPaid.length !== 1 ? "s" : ""}</p>
            </div>
            {/* Aguardando */}
            <div className="rounded-xl border p-4 bg-yellow-50 border-yellow-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-yellow-700 uppercase tracking-wide">Aguardando</p>
                <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full font-semibold">PEND.</span>
              </div>
              <p className="text-2xl font-bold text-yellow-800">
                {statsPendingCount}
              </p>
              <p className="text-xs text-yellow-600 mt-1">pedidos pendentes</p>
            </div>
          </div>

          {/* Card Pedidos para Enviar */}
          <div
            className="mt-3 rounded-xl border p-4 bg-amber-50 border-amber-300 cursor-pointer hover:bg-amber-100 transition"
            onClick={() => setTab("orders")}
            title="Ver pedidos para enviar"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-1.5">
                <Truck className="w-4 h-4" /> Pedidos para Enviar
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copyShoppingList}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white/90 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-white"
                >
                  <ShoppingBag className="w-3.5 h-3.5" /> Lista de Compra
                </button>
                <button
                  type="button"
                  onClick={copyOrdersParaEnviar}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white/90 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-white"
                >
                  <Copy className="w-3.5 h-3.5" /> Copiar Pedido
                </button>
                <span className="text-[10px] bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-bold">
                  {ordersParaEnviarCopyBase.length}
                </span>
              </div>
            </div>
            {ordersParaEnviar.length === 0 ? (
              <p className="text-sm text-amber-700/80 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-green-500" /> Todos os pedidos pagos já foram enviados!
              </p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {ordersParaEnviar.slice(0, 5).map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded-lg bg-white/70 border border-amber-100 px-3 py-1.5">
                    <div className="min-w-0 pr-2">
                      <p className="text-sm font-medium text-amber-900 truncate">{o.clientName}</p>
                      <p className="text-xs text-amber-700/80">#{o.id} · {formatDateBR(o.createdAt)}</p>
                    </div>
                    <span className="text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                      {formatCurrency(Number(o.total))}
                    </span>
                  </div>
                ))}
                {ordersParaEnviar.length > 5 && (
                  <p className="text-xs text-amber-700 font-semibold text-center mt-1">
                    +{ordersParaEnviar.length - 5} pedidos a enviar
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="mt-3 rounded-xl border p-4 bg-indigo-50 border-indigo-200">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">Produtos mais vendidos</p>
              <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full font-semibold">TOP</span>
            </div>
            {statsTopProducts.length === 0 ? (
              <p className="text-sm text-indigo-700/80">Sem produtos vendidos no período selecionado.</p>
            ) : (
              <div className="space-y-2">
                {statsTopProducts.map((product, idx) => (
                  <div key={`${product.name}-${idx}`} className="flex items-center justify-between rounded-lg bg-white/70 border border-indigo-100 px-3 py-2">
                    <div className="min-w-0 pr-2">
                      <p className="text-sm font-medium text-indigo-900 truncate">{idx + 1}. {product.name}</p>
                      <p className="text-xs text-indigo-700/80">Faturamento: {formatCurrency(product.revenue)}</p>
                    </div>
                    <div className="text-xs font-semibold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                      {product.quantity} un
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 mb-6 border-b border-border overflow-x-auto bg-white rounded-t-xl">
          {([
            { key: "orders",        label: "Pedidos",          icon: "QrCode",      count: orders.length },
            { key: "charges",       label: "Links Pagamento",  icon: "LinkIcon",    count: charges.length },
            { key: "sellers",       label: "Vendedores",       icon: "Tag" },
            { key: "commissions",   label: "Comissões",        icon: "DollarSign",  count: commissionPendingOrders.length || undefined },
            { key: "kyc",           label: "KYC",              icon: "ShieldCheck", count: kycList.length > 0 ? kycList.filter((k) => k.status === "submitted").length : undefined },
            { key: "customers",     label: "Clientes",         icon: "UserPlus",    count: customerUsers.length || undefined },
            { key: "recurringCustomers", label: "Clientes recorrentes", icon: "RefreshCw", count: recurringCustomers.length || undefined },
            { key: "support",       label: "Suporte",          icon: "MessageCircle", count: supportTickets.filter((t) => t.status === "open").length || undefined },
            ...(canManageProductsTab ? [
              { key: "products" as TabType, label: "Produtos", icon: "ShoppingBag", count: products.length },
              { key: "configuracoes" as TabType, label: "Configurações", icon: "Settings" },
            ] : []),
            ...(canManageShippingTab ? [
              { key: "fretes" as TabType, label: "Fretes", icon: "Truck", count: shippingOptions.length },
            ] : []),
            ...(canManageInventoryTab ? [
              { key: "inventory" as TabType, label: "Estoque", icon: "Package", count: pendingReshipments.length || undefined },
            ] : []),
            ...(isPrimary ? [
              { key: "coupons",       label: "Cupons",           icon: "Ticket",      count: coupons.length },
              { key: "orderBumps",    label: "Order Bumps",      icon: "Zap",         count: orderBumps.length },
              { key: "users",         label: "Usuários",         icon: "User" },
              { key: "socialProof",   label: "Prova Social",     icon: "ShoppingBag" },
              { key: "raffles",       label: "Rifas",            icon: "Ticket",      count: rafflesList.length || undefined },
              ...(canManageTenants ? [{ key: "lojas" as TabType, label: "Lojas", icon: "Store" }] : []),
            ] : []),
            { key: "webhook",       label: "Webhook",          icon: "Link" },
          ] as Array<{ key: TabType; label: string; icon: string; count?: number }>).map(({ key, label, icon, count }) => (
            <button key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <IconLucide name={icon} className="w-4 h-4" />
              {label}
              {count !== undefined && (
                <span className="ml-1 bg-primary/10 text-primary text-xs px-1.5 py-0.5 rounded-full">{count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Filters (only for orders/charges) */}
        {(tab === "orders" || tab === "charges") && (
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="relative flex-1">
              <IconLucide name="Search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome, e-mail, telefone ou ID..."
                className="w-full h-11 pl-10 pr-4 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm" />
            </div>
            <div className="flex gap-2 flex-wrap">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm cursor-pointer" />
              <input type="date" value={dateTo}   onChange={(e) => setDateTo(e.target.value)}   className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm cursor-pointer" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm cursor-pointer">
                <option value="all">Todos os status</option>
                <option value="paid">Pago</option>
                <option value="completed">Concluído</option>
                <option value="awaiting_payment">Aguardando</option>
                <option value="pending">Pendente</option>
                <option value="cancelled">Cancelado</option>
              </select>
              {tab === "orders" && (
                <>
                  <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm cursor-pointer">
                    <option value="all">Todos os métodos</option>
                    <option value="pix">PIX</option>
                    <option value="card_simulation">Cartão</option>
                  </select>
                  <select value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)} className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm cursor-pointer">
                    <option value="all">Todos os vendedores</option>
                    {allSellers.map((s) => (
                      <option key={s!} value={s!}>{s}</option>
                    ))}
                  </select>
                  <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm cursor-pointer">
                    <option value="all">Todos os grupos</option>
                    {availableWhatsappGroups.map((group) => (
                      <option key={group} value={group}>{whatsappGroupLabel(group)}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        {(tab === "orders" && !ordersReady) || (tab === "charges" && !chargesReady) ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
            <p className="text-muted-foreground">Carregando...</p>
          </div>
        ) : tab === "orders" ? (
          <OrdersPanel
            allOrders={orders}
            orders={filteredOrders}
            trackingCandidates={orders.filter((order) => !order.enviado && order.status !== "cancelled")}
            productImageById={Object.fromEntries(
              (products as Array<{ id?: string; image?: string | null }>)
                .map((p) => [String(p?.id || "").trim(), String(p?.image || "").trim()] as const)
                .filter(([id, image]) => !!id && !!image),
            )}
            productCostById={Object.fromEntries(
              (products as Array<{ id?: string; costPrice?: number | null }>)
                .map((p) => [String(p?.id || "").trim(), Number(p?.costPrice || 0)] as const)
                .filter(([id]) => !!id),
            )}
            productNameById={Object.fromEntries(
              (products as Array<{ id?: string; name?: string | null }>)
                .map((p) => [String(p?.id || "").trim(), String(p?.name || "").trim()] as const)
                .filter(([id, name]) => !!id && !!name),
            )}
            inventoryBalances={inventoryBalances}
            getCommissionRate={getCommissionRate}
            gatewayFeePercent={Number(settings["gateway_fee_percent"] || 0)}
            gatewayFeeFixed={Number(settings["gateway_fee_fixed"] || 0)}
            gatewayFeeMin={Number(settings["gateway_fee_min"] || 0)}
            statusUpdating={statusUpdating}
            expandedOrder={expandedOrder}
            setExpandedOrder={setExpandedOrder}
            updateOrderStatus={updateOrderStatus}
            setProofModal={setProofModal}
            setProofViewer={setProofViewer}
            openWhatsApp={openOrderWhatsApp}
            onOpenCardPaidModal={(id) => { setCardPaidModal(id); setCardPaidForm({ installments: "", installmentValue: "", totalValue: "" }); }}
            updateOrderObservation={updateOrderObservation}
            isPrimary={isPrimary}
            onEditOrder={openEditOrder}
            onOpenKycModal={openKycModal}
            onSetOrderEnviado={(id, enviado) => {
              setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, enviado } : o)));
            }}
            onSetOrderPatched={(order) => {
              setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, ...order } : o)));
            }}
            availableWhatsappGroups={availableWhatsappGroups}
            onSetReshipmentStatus={async (reshipmentId, status) => {
              if (!reshipmentId) return;
              setReshipmentUpdatingId(reshipmentId);
              try {
                const res = await fetch(`${BASE}/api/admin/reshipments/${reshipmentId}/status`, {
                  method: "PATCH",
                  headers: authHeaders(),
                  body: JSON.stringify({ status }),
                });
                const data = await res.json() as {
                  message?: string;
                  error?: string;
                  missingProducts?: string[];
                  status?: string;
                  requestedStatus?: string;
                  alreadySent?: boolean;
                  debitedProducts?: Array<{ productId?: string; productName?: string; quantity?: number }>;
                };
                if (!res.ok) {
                  if (data?.error === "INSUFFICIENT_STOCK" && Array.isArray(data?.missingProducts) && data.missingProducts.length > 0) {
                    toast.error(`Estoque insuficiente para este reenvio: ${data.missingProducts.join(", ")}.`);
                    return;
                  }
                  toast.error(data?.message || "Erro ao atualizar reenvio.");
                  return;
                }
                fetchOrders(true);
                if (tab === "inventory") fetchInventoryOverview();
                if (status === "reenvio_enviado") {
                  const debited = Array.isArray(data?.debitedProducts) ? data.debitedProducts : [];
                  if (data?.alreadySent) {
                    toast.success("Reenvio já estava marcado como enviado.");
                  } else if (debited.length > 0) {
                    const summary = debited
                      .map((item) => `${Number(item?.quantity || 0)}x ${String(item?.productName || item?.productId || "Produto")}`)
                      .join(", ");
                    toast.success(`Baixa de estoque aplicada (${summary}). Reenvio marcado como enviado.`);
                  } else {
                    toast.success("Reenvio marcado como enviado.");
                  }
                } else {
                  toast.success(status === "reenvio_enviado" ? "Reenvio marcado como enviado." : "Status do reenvio atualizado.");
                }
              } catch {
                toast.error("Erro ao atualizar reenvio.");
              } finally {
                setReshipmentUpdatingId(null);
              }
            }}
            onRemoveOrder={(id) => {
              setOrders((prev) => prev.filter((o) => o.id !== id));
            }}
          />
        ) : tab === "charges" ? (
          <ChargesPanel
            charges={filteredCharges}
            openWhatsApp={openChargeWhatsApp}
            chargeStatusUpdating={chargeStatusUpdating}
            onUpdateChargeStatus={updateChargeStatus}
            chargeProofModal={chargeProofModal}
            setChargeProofModal={setChargeProofModal}
            chargeProofFile={chargeProofFile}
            chargeProofUploading={chargeProofUploading}
            onChargeProofUpload={handleChargeProofUpload}
            onSubmitChargeProof={submitChargeProof}
            setProofViewer={setProofViewer}
            updateChargeObservation={updateChargeObservation}
            lookupChargeCep={lookupChargeCep}
            chargeCepLoading={createChargeCepLoading}
            createChargeOpen={createChargeOpen}
            setCreateChargeOpen={setCreateChargeOpen}
            createChargeForm={createChargeForm}
            setCreateChargeForm={setCreateChargeForm}
            createChargeSubmitting={createChargeSubmitting}
            onCreateCharge={async () => {
              const { name, email, phone, document, amountRaw, description, cep, street, number, complement, neighborhood, city, state } = createChargeForm;
              if (!name.trim() || !email.trim() || !phone.trim() || !document.trim()) { toast.error("Preencha todos os campos obrigatórios."); return; }
              if (!description.trim()) { toast.error("Descreva o pedido antes de continuar."); return; }
              const amountCents = Number(amountRaw);
              if (!amountCents || amountCents < 100) { toast.error("Informe um valor mínimo de R$1,00."); return; }
              setCreateChargeSubmitting(true);
              const address = (cep || street || city) ? { cep: cep.replace(/\D/g, ""), street, number, complement, neighborhood, city, state } : undefined;
              try {
                const res = await fetch(`${BASE}/api/custom-charges`, {
                  method: "POST", headers: authHeaders(),
                  body: JSON.stringify({ client: { name: name.trim(), email: email.trim(), phone, document }, amount: amountCents / 100, description: description.trim(), address }),
                });
                const data = await res.json() as { id?: string; message?: string };
                if (!res.ok) { toast.error(data.message || "Erro ao criar cobrança."); return; }
                toast.success("Cobrança criada e PIX gerado!");
                setCreateChargeOpen(false);
                setCreateChargeForm({ name: "", email: "", phone: "", document: "", amountRaw: "", description: "", cep: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "" });
                fetchCharges();
              } catch { toast.error("Erro de conexão."); }
              finally { setCreateChargeSubmitting(false); }
            }}
          />
        ) : tab === "commissions" ? (
          <CommissionPaymentsPanel
            sellers={sellers}
            pendingOrders={commissionPendingOrders}
            batches={commissionBatches}
            loading={commissionPaymentsLoading}
            sellerFilter={commissionSellerFilter}
            setSellerFilter={setCommissionSellerFilter}
            dateFrom={commissionDateFrom}
            setDateFrom={setCommissionDateFrom}
            dateTo={commissionDateTo}
            setDateTo={setCommissionDateTo}
            selectedOrderIds={commissionSelectedOrderIds}
            setSelectedOrderIds={setCommissionSelectedOrderIds}
            onRefresh={fetchCommissionPayments}
            onCreateBatch={createCommissionPaymentBatch}
            onMarkPaid={markCommissionBatchPaid}
            creating={commissionPaymentsCreating}
            payingId={commissionPaymentsPayingId}
            paymentMethod={commissionPaymentMethod}
            setPaymentMethod={setCommissionPaymentMethod}
            paymentNotes={commissionPaymentNotes}
            setPaymentNotes={setCommissionPaymentNotes}
          />
        ) : tab === "coupons" ? (
          <CouponsPanel
            coupons={coupons}
            products={products}
            couponForm={couponForm}
            setCouponForm={setCouponForm}
            couponCreating={couponCreating}
            couponDeleting={couponDeleting}
            createCoupon={createCoupon}
            toggleCoupon={toggleCoupon}
            deleteCoupon={deleteCoupon}
            isPrimary={isPrimary}
          />
        ) : tab === "sellers" ? (
          <SellersPanel
            siteOrigin={siteOrigin}
            savedSellersList={sellers}
            sellerInput={sellerInput}
            setSellerInput={setSellerInput}
            sellerWhatsappInput={sellerWhatsappInput}
            setSellerWhatsappInput={setSellerWhatsappInput}
            sellerHasCommissionInput={sellerHasCommissionInput}
            setSellerHasCommissionInput={setSellerHasCommissionInput}
            sellerCommissionRateInput={sellerCommissionRateInput}
            setSellerCommissionRateInput={setSellerCommissionRateInput}
            saveSeller={saveSeller}
            updateSellerCommission={updateSellerCommission}
            sellerCommissionUpdatingSlug={sellerCommissionUpdatingSlug}
            removeSeller={removeSeller}
            copySeller={copySeller}
            copiedSeller={copiedSeller}
            orders={sellerAllOrders}
            charges={sellerAllCharges}
            isPrimary={isPrimary}
            canManageSellerLinks={canManageSellerLinks}
            currentUsername={currentUsername}
          />
        ) : tab === "customers" ? (
          <CustomersPanel
            customers={customerUsers}
            loading={customersLoading}
            search={customerSearch}
            setSearch={setCustomerSearch}
            onRefresh={fetchCustomers}
            onImpersonate={impersonateCustomerAccount}
            impersonatingId={customerImpersonatingId}
            canImpersonate={isPrimary}
            onExportCSV={handleExportCustomersCSV}
            onSyncBrevo={handleSyncCustomersBrevo}
            exportingCSV={exportingCustomersCSV}
            syncingBrevo={syncingCustomersBrevo}
            exportModalOpen={exportModalOpen}
            setExportModalOpen={setExportModalOpen}
            exportColumns={exportColumns}
            setExportColumns={setExportColumns}
          />
        ) : tab === "recurringCustomers" ? (
          <RecurringCustomersPanel
            customers={recurringCustomers}
            loading={recurringCustomersLoading}
            search={recurringCustomerSearch}
            setSearch={setRecurringCustomerSearch}
            onRefresh={fetchRecurringCustomers}
          />
        ) : tab === "support" ? (
          <SupportTicketsPanel
            tickets={supportTickets}
            productsCatalog={products.map((item) => ({ id: item.id, name: item.name }))}
            loading={supportLoading}
            onRefresh={fetchSupportTickets}
            onSetStatus={async (id, status) => {
              try {
                const res = await fetch(`${BASE}/api/admin/support-tickets/${id}/status`, {
                  method: "PATCH",
                  headers: authHeaders(),
                  body: JSON.stringify({ status }),
                });
                const data = await res.json() as {
                  message?: string;
                  resolutionReason?: string | null;
                  reshipment?: { status?: string } | null;
                };
                if (!res.ok) {
                  toast.error(data?.message || "Erro ao atualizar chamado.");
                  return;
                }
                setSupportTickets((prev) => prev.map((t) => (
                  t.id === id
                    ? {
                        ...t,
                        status,
                        resolutionReason: status === "resolved" ? (data?.resolutionReason || "resolvido_manual") : null,
                        resolvedAt: status === "resolved" ? new Date().toISOString() : null,
                      }
                    : t
                )));
                if (status === "resolved") {
                  fetchOrders(true);
                  fetchInventoryOverview();
                }
                if (status === "resolved" && data?.reshipment?.status === "reenvio_aguardando_estoque") {
                  toast.success("Chamado resolvido. Pedido entrou em reenvio aguardando estoque.");
                } else if (status === "resolved" && data?.reshipment?.status === "reenvio_pronto_para_envio") {
                  toast.success("Chamado resolvido. Pedido pronto para reenvio.");
                } else {
                  toast.success(status === "resolved" ? "Chamado marcado como resolvido." : "Chamado reaberto.");
                }
              } catch {
                toast.error("Erro ao atualizar chamado.");
              }
            }}
            onDelete={async (id) => {
              if (!window.confirm("Excluir este chamado de suporte? Esta ação não pode ser desfeita.")) {
                return;
              }

              try {
                const res = await fetch(`${BASE}/api/admin/support-tickets/${id}`, {
                  method: "DELETE",
                  headers: authHeaders(),
                });
                const data = await res.json() as { message?: string };
                if (!res.ok) {
                  toast.error(data?.message || "Erro ao excluir chamado.");
                  return;
                }
                setSupportTickets((prev) => prev.filter((t) => t.id !== id));
                toast.success("Chamado excluído.");
              } catch {
                toast.error("Erro ao excluir chamado.");
              }
            }}
            onReenviar={async (id, products) => {
              try {
                const res = await fetch(`${BASE}/api/admin/support-tickets/${id}/reenviar`, {
                  method: "POST",
                  headers: authHeaders(),
                  body: JSON.stringify({
                    products: products || [],
                  }),
                });
                const data = await res.json() as { message?: string; reshipment?: { status?: string } };
                if (!res.ok) {
                  toast.error(data?.message || "Erro ao autorizar reenvio.");
                  return;
                }
                setSupportTickets((prev) => prev.map((t) => (
                  t.id === id
                    ? { ...t, status: "resolved", resolutionReason: "reenvio_autorizado", resolvedAt: new Date().toISOString() }
                    : t
                )));
                fetchOrders(true);
                fetchInventoryOverview();
                const st = data?.reshipment?.status;
                if (st === "reenvio_aguardando_estoque") {
                  toast.success("Reenvio criado e aguardando estoque.");
                } else {
                  toast.success("Reenvio autorizado e pronto para envio.");
                }
              } catch {
                toast.error("Erro ao autorizar reenvio.");
              }
            }}
          />
        ) : tab === "inventory" ? (
          <InventoryPanel
            loading={inventoryLoading}
            products={products}
            balances={inventoryBalances}
            movements={inventoryMovements}
            pendingReshipments={pendingReshipments}
            entryForm={inventoryEntryForm}
            setEntryForm={setInventoryEntryForm}
            submitting={inventorySubmitting}
            manualForm={manualReshipmentForm}
            setManualForm={setManualReshipmentForm}
            manualSubmitting={manualReshipmentSubmitting}
            onRefresh={() => { fetchInventoryOverview(); fetchProducts(); }}
            onCreateEntry={async () => {
              const productId = String(inventoryEntryForm.productId || "").trim();
              const quantity = Number(inventoryEntryForm.quantity || 0);
              const reason = String(inventoryEntryForm.reason || "").trim();
              const movementType = inventoryEntryForm.movementType === "exit" ? "exit" : "entry";
              const entrySource = inventoryEntryForm.entrySource === "customer_return" ? "customer_return" : "purchase";
              const clientName = String(inventoryEntryForm.clientName || "").trim();
              const clientPhone = String(inventoryEntryForm.clientPhone || "").trim();
              if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
                toast.error("Selecione o produto e informe quantidade válida.");
                return;
              }
              setInventorySubmitting(true);
              try {
                const res = await fetch(`${BASE}/api/admin/inventory/entries`, {
                  method: "POST",
                  headers: authHeaders(),
                  body: JSON.stringify({ productId, quantity, reason, movementType, entrySource, clientName, clientPhone }),
                });
                const data = await res.json() as { releasedCount?: number; message?: string; balanceChanged?: boolean };
                if (!res.ok) {
                  toast.error(data?.message || "Erro ao registrar entrada de estoque.");
                  return;
                }

                if (movementType === "entry" && entrySource === "customer_return" && activeManualReturnItemId) {
                  await fetch(`${BASE}/api/admin/manual-return-items/${activeManualReturnItemId}/status`, {
                    method: "PATCH",
                    headers: authHeaders(),
                    body: JSON.stringify({ status: "done" }),
                  });
                  setActiveManualReturnItemId(null);
                }

                setInventoryEntryForm((prev) => ({ ...prev, productId: "", quantity: "", reason: "", clientName: "", clientPhone: "" }));
                fetchInventoryOverview();
                fetchOrders(true);
                const released = Number(data?.releasedCount || 0);
                if (movementType === "entry") {
                  if (data?.balanceChanged === false) {
                    toast.success("Estorno do reenvio registrado sem entrada no estoque.");
                  } else if (released > 0) {
                    toast.success(`Entrada registrada. ${released} reenvio(s) liberado(s).`);
                  } else {
                    toast.success("Entrada de estoque registrada.");
                  }
                } else {
                  toast.success("Saida de estoque registrada.");
                }
              } catch {
                toast.error(movementType === "entry" ? "Erro ao registrar entrada de estoque." : "Erro ao registrar saída de estoque.");
              } finally {
                setInventorySubmitting(false);
              }
            }}
            onCreateManualReshipment={createManualReshipment}
            onResolvePendingReshipment={async (item, registerStockEntry) => {
              const manualReturnId = String(item.id || "").trim();
              const firstProduct = item.products?.[0];
              if (!manualReturnId || !firstProduct?.id) {
                toast.error("Item de retorno manual inválido.");
                return;
              }

              try {
                if (registerStockEntry) {
                  const reasonSuffix = String(item.notes || item.resolvedReason || "").trim();
                  setInventoryEntryForm((prev) => ({
                    ...prev,
                    movementType: "entry",
                    entrySource: "customer_return",
                    productId: firstProduct.id,
                    quantity: String(Number(firstProduct.quantity) || 1),
                    clientName: String(item.clientName || ""),
                    reason: reasonSuffix ? `Pedido voltando: ${reasonSuffix}` : prev.reason,
                  }));
                  setActiveManualReturnItemId(manualReturnId);
                  toast.success("Dados preenchidos. Clique em Dar Entrada para confirmar.");
                } else {
                  const statusRes = await fetch(`${BASE}/api/admin/manual-return-items/${manualReturnId}/status`, {
                    method: "PATCH",
                    headers: authHeaders(),
                    body: JSON.stringify({ status: "done" }),
                  });
                  const statusData = await statusRes.json().catch(() => ({})) as { message?: string };
                  if (!statusRes.ok) {
                    toast.error(statusData?.message || "Erro ao concluir retorno manual.");
                    return;
                  }
                  fetchInventoryOverview();
                  toast.success("Retorno manual concluído sem entrada no estoque.");
                }
              } catch {
                toast.error("Erro ao processar item de retorno manual.");
              }
            }}
          />
        ) : tab === "users" && isPrimary ? (
          <UsersPanel
            users={adminUsers}
            newUsername={newUsername}
            setNewUsername={setNewUsername}
            newPassword={newPassword}
            setNewPassword={setNewPassword}
            newFullAccess={newFullAccess}
            setNewFullAccess={setNewFullAccess}
            showNewPw={showNewPw}
            setShowNewPw={setShowNewPw}
            userCreating={userCreating}
            userDeleting={userDeleting}
            userAccessUpdating={userAccessUpdating}
            userPasswordUpdating={userPasswordUpdating}
            createUser={createUser}
            deleteUser={deleteUser}
            toggleUserAccess={toggleUserAccess}
            changeUserPassword={changeUserPassword}
          />
        ) : tab === "products" ? (
          <ProductsPanel
            products={products}
            loading={productsLoading}
            productForm={productForm}
            setProductForm={setProductForm}
            productFormOpen={productFormOpen}
            setProductFormOpen={setProductFormOpen}
            productSaving={productSaving}
            productDeleting={productDeleting}
            onSave={async () => {
              setProductSaving(true);
              try {
                const isEdit = Boolean(productForm._editing && productForm.id);
                const url    = isEdit ? `${BASE}/api/admin/products/${productForm.id}` : `${BASE}/api/admin/products`;
                const method = isEdit ? "PATCH" : "POST";
                const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(productForm) });
                if (!res.ok) {
                  const err = await res.json() as { message?: string };
                  toast.error(err.message || "Erro ao salvar produto.");
                } else {
                  toast.success(isEdit ? "Produto atualizado!" : "Produto criado!");
                  setProductFormOpen(false);
                  setProductForm({});
                  fetchProducts();
                }
              } catch { toast.error("Erro ao salvar produto."); }
              finally { setProductSaving(false); }
            }}
                onRefreshProducts={fetchProducts}
            onDelete={async (id: string) => {
              if (!confirm("Apagar este produto?")) return;
              setProductDeleting(id);
              try {
                await fetch(`${BASE}/api/admin/products/${id}`, { method: "DELETE", headers: authHeaders() });
                toast.success("Produto removido.");
                fetchProducts();
              } catch { toast.error("Erro ao apagar produto."); }
              finally { setProductDeleting(null); }
            }}
            onToggle={async (id: string, isActive: boolean) => {
              try {
                await fetch(`${BASE}/api/admin/products/${id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ isActive }) });
                fetchProducts();
              } catch { toast.error("Erro ao atualizar produto."); }
            }}
            sellers={sellers}
          />
        ) : tab === "fretes" ? (
          <FretePanel
            options={shippingOptions}
            form={shippingForm}
            setForm={setShippingForm}
            creating={shippingCreating}
            deleting={shippingDeleting}
            editing={shippingEditing}
            setEditing={setShippingEditing}
            updating={shippingUpdating}
            onCreate={async () => {
              if (!shippingForm.name.trim()) { toast.error("Nome é obrigatório."); return; }
              if (shippingForm.price === "" || Number(shippingForm.price) < 0) { toast.error("Preço inválido."); return; }
              setShippingCreating(true);
              try {
                const res = await fetch(`${BASE}/api/admin/shipping-options`, {
                  method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
                  body: JSON.stringify({ name: shippingForm.name, description: shippingForm.description, price: Number(shippingForm.price), sortOrder: Number(shippingForm.sortOrder) }),
                });
                if (!res.ok) { const e = await res.json() as { message?: string }; toast.error(e.message || "Erro ao criar frete."); }
                else { toast.success("Frete criado!"); setShippingForm({ name: "", description: "", price: "", sortOrder: "0" }); fetchShippingOptions(); }
              } catch { toast.error("Erro ao criar frete."); }
              finally { setShippingCreating(false); }
            }}
            onUpdate={async (id: string, patch: Partial<ShippingOption>) => {
              setShippingUpdating(id);
              try {
                const res = await fetch(`${BASE}/api/admin/shipping-options/${id}`, {
                  method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" },
                  body: JSON.stringify(patch),
                });
                if (!res.ok) { const e = await res.json() as { message?: string }; toast.error(e.message || "Erro ao atualizar."); }
                else { toast.success("Frete atualizado!"); setShippingEditing(null); fetchShippingOptions(); }
              } catch { toast.error("Erro ao atualizar."); }
              finally { setShippingUpdating(null); }
            }}
            onDelete={async (id: string) => {
              setShippingDeleting(id);
              try {
                await fetch(`${BASE}/api/admin/shipping-options/${id}`, { method: "DELETE", headers: authHeaders() });
                toast.success("Frete excluído!");
                fetchShippingOptions();
              } catch { toast.error("Erro ao excluir."); }
              finally { setShippingDeleting(null); }
            }}
          />
        ) : tab === "orderBumps" ? (
          <OrderBumpsPanel
            bumps={orderBumps}
            products={(Array.isArray(products) ? products : []).map((p) => ({ id: p.id, name: p.name, image: p.image }))}
            form={bumpForm}
            setForm={setBumpForm}
            creating={bumpCreating}
            toggling={bumpToggling}
            deleting={bumpDeleting}
            editingId={bumpEditingId}
            updating={bumpUpdating}
            onEdit={(b) => {
              setBumpEditingId(b.id);
              setBumpForm({
                productId:    b.productId,
                offerProductId: b.offerProductId || b.productId,
                title:        b.title,
                cardTitle:    b.cardTitle ?? "",
                description:  b.description ?? "",
                image:        b.image ?? "",
                discountType: b.discountType,
                discountValue: b.discountValue != null ? String(b.discountValue) : "",
                buyQuantity:  b.buyQuantity != null ? String(b.buyQuantity) : "1",
                getQuantity:  b.getQuantity != null ? String(b.getQuantity) : "2",
                tiers:        b.tiers?.length ? b.tiers.map((t) => ({ qty: String(t.qty), price: String(t.price), image: t.image ?? "" })) : [{ qty: "2", price: "", image: "" }, { qty: "3", price: "", image: "" }],
                unit:         b.unit ?? "unidade",
                discountTagType: b.discountTagType ?? "none",
                isActive:     b.isActive,
                sortOrder:    String(b.sortOrder),
              });
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onCancelEdit={() => { setBumpEditingId(null); setBumpForm(EMPTY_BUMP_FORM); }}
            onUpdate={async () => {
              if (!bumpEditingId) return;
              if (!bumpForm.productId) { toast.error("Selecione o produto gatilho."); return; }
              if (!bumpForm.offerProductId) { toast.error("Selecione o produto promocional."); return; }
              if (!bumpForm.title.trim()) { toast.error("Título é obrigatório."); return; }
              setBumpUpdating(true);
              try {
                const body: Record<string, unknown> = {
                  productId:    bumpForm.productId,
                  offerProductId: bumpForm.offerProductId,
                  title:        bumpForm.title.trim(),
                  cardTitle:    bumpForm.cardTitle.trim() || null,
                  description:  bumpForm.description.trim() || null,
                  image:        bumpForm.image.trim() || null,
                  discountType: bumpForm.discountType,
                  unit:         bumpForm.unit || "unidade",
                  isActive:     bumpForm.isActive,
                  sortOrder:    Number(bumpForm.sortOrder) || 0,
                  discountValue: null, buyQuantity: null, getQuantity: null, tiers: null,
                };
                if (bumpForm.discountType === "percent" || bumpForm.discountType === "fixed") {
                  body.discountValue = Number(bumpForm.discountValue) || 0;
                } else if (bumpForm.discountType === "buy_x_get_y") {
                  body.buyQuantity = Number(bumpForm.buyQuantity) || 1;
                  body.getQuantity = Number(bumpForm.getQuantity) || 2;
                } else if (bumpForm.discountType === "quantity_tiers") {
                  body.tiers = bumpForm.tiers.filter((t) => t.qty && t.price).map((t) => ({ qty: Number(t.qty), price: Number(t.price), image: t.image?.trim() || undefined }));
                  body.discountTagType = bumpForm.discountTagType || "none";
                }
                const res = await fetch(`${BASE}/api/admin/order-bumps/${bumpEditingId}`, {
                  method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                });
                if (!res.ok) { const e = await res.json() as { error?: string }; toast.error(e.error || "Erro ao salvar."); }
                else { toast.success("Bump atualizado!"); setBumpEditingId(null); setBumpForm(EMPTY_BUMP_FORM); fetchOrderBumpsData(); }
              } catch { toast.error("Erro ao salvar."); }
              finally { setBumpUpdating(false); }
            }}
            onCreate={async () => {
              if (!bumpForm.productId) { toast.error("Selecione o produto gatilho."); return; }
              if (!bumpForm.offerProductId) { toast.error("Selecione o produto promocional."); return; }
              if (!bumpForm.title.trim()) { toast.error("Título é obrigatório."); return; }
              setBumpCreating(true);
              try {
                const body: Record<string, unknown> = {
                  productId: bumpForm.productId,
                  offerProductId: bumpForm.offerProductId,
                  title: bumpForm.title.trim(),
                  cardTitle: bumpForm.cardTitle.trim() || null,
                  description: bumpForm.description.trim() || null,
                  image: bumpForm.image.trim() || null,
                  discountType: bumpForm.discountType,
                  unit: bumpForm.unit || "unidade",
                  isActive: bumpForm.isActive,
                  sortOrder: Number(bumpForm.sortOrder) || 0,
                };
                if (bumpForm.discountType === "percent" || bumpForm.discountType === "fixed") {
                  body.discountValue = Number(bumpForm.discountValue) || 0;
                } else if (bumpForm.discountType === "buy_x_get_y") {
                  body.buyQuantity = Number(bumpForm.buyQuantity) || 1;
                  body.getQuantity = Number(bumpForm.getQuantity) || 2;
                } else if (bumpForm.discountType === "quantity_tiers") {
                  body.tiers = bumpForm.tiers.filter((t) => t.qty && t.price).map((t) => ({ qty: Number(t.qty), price: Number(t.price), image: t.image?.trim() || undefined }));
                  body.discountTagType = bumpForm.discountTagType || "none";
                }
                const res = await fetch(`${BASE}/api/admin/order-bumps`, {
                  method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                });
                if (!res.ok) { const e = await res.json() as { error?: string }; toast.error(e.error || "Erro ao criar bump."); }
                else { toast.success("Order bump criado!"); setBumpForm(EMPTY_BUMP_FORM); fetchOrderBumpsData(); }
              } catch { toast.error("Erro ao criar bump."); }
              finally { setBumpCreating(false); }
            }}
            onToggle={async (id, active) => {
              setBumpToggling(id);
              try {
                await fetch(`${BASE}/api/admin/order-bumps/${id}`, {
                  method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" },
                  body: JSON.stringify({ isActive: active }),
                });
                fetchOrderBumpsData();
              } catch { toast.error("Erro ao atualizar."); }
              finally { setBumpToggling(null); }
            }}
            onDelete={async (id) => {
              setBumpDeleting(id);
              try {
                await fetch(`${BASE}/api/admin/order-bumps/${id}`, { method: "DELETE", headers: authHeaders() });
                toast.success("Bump excluído!");
                if (bumpEditingId === id) { setBumpEditingId(null); setBumpForm(EMPTY_BUMP_FORM); }
                fetchOrderBumpsData();
              } catch { toast.error("Erro ao excluir."); }
              finally { setBumpDeleting(null); }
            }}
          />
        ) : tab === "kyc" ? (
          <div className="space-y-6">
            {/* KYC Tab Header */}
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Verificações KYC</h2>
                <p className="text-sm text-muted-foreground">Gerencie e aprove as verificações de identidade dos clientes.</p>
              </div>
              <button onClick={fetchKycList} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-xl hover:bg-muted transition-colors">
                <RefreshCw className="w-3.5 h-3.5" />Atualizar
              </button>
            </div>

            {/* KYC Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <IconLucide name="Search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={kycListSearch}
                  onChange={(e) => setKycListSearch(e.target.value)}
                  placeholder="Buscar por nome, CPF ou telefone..."
                  className="w-full h-11 pl-10 pr-4 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                />
              </div>
              <select
                value={kycListStatus}
                onChange={(e) => setKycListStatus(e.target.value)}
                className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm cursor-pointer"
              >
                <option value="all">Todos os status</option>
                <option value="submitted">Aguardando revisão</option>
                <option value="approved">Aprovado</option>
                <option value="rejected">Negado</option>
                <option value="pending">Pendente</option>
              </select>
            </div>

            {/* KYC Status badge helper */}
            {kycListLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : (() => {
              const searchLower = kycListSearch.toLowerCase();
              const filtered = kycList.filter((k) => {
                const matchSearch = !kycListSearch
                  || (k.clientName?.toLowerCase().includes(searchLower))
                  || (k.clientDocument?.replace(/\D/g, "").includes(kycListSearch.replace(/\D/g, "")))
                  || (k.clientPhone?.replace(/\D/g, "").includes(kycListSearch.replace(/\D/g, "")));
                const matchStatus = kycListStatus === "all" || k.status === kycListStatus;
                return matchSearch && matchStatus;
              });
              if (filtered.length === 0) {
                return (
                  <div className="text-center py-16 text-muted-foreground">
                    <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">{kycList.length === 0 ? "Nenhum KYC encontrado" : "Nenhum resultado para o filtro"}</p>
                  </div>
                );
              }
              return (
                <div className="space-y-3">
                  {filtered.map((k) => {
                    const statusMap: Record<string, { label: string; color: string; Icon: typeof CheckCircle }> = {
                      approved: { label: "Aprovado",           color: "bg-green-100 text-green-800 border-green-200",   Icon: CheckCircle },
                      rejected: { label: "Negado",             color: "bg-red-100 text-red-800 border-red-200",         Icon: XCircle },
                      submitted: { label: "Aguardando revisão", color: "bg-amber-100 text-amber-800 border-amber-200",  Icon: Clock },
                      pending:  { label: "Pendente",           color: "bg-gray-100 text-gray-600 border-gray-200",      Icon: Clock },
                    };
                    const s = statusMap[k.status] ?? statusMap.pending;
                    const isUpdating = kycStatusUpdating === k.orderId;
                    return (
                      <div key={k.id} className="bg-white border border-border rounded-2xl p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm">{k.clientName || "—"}</span>
                              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${s.color}`}>
                                <s.Icon className="w-3 h-3" />
                                {s.label}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                              {k.clientDocument && <p>CPF: {k.clientDocument}</p>}
                              {k.clientPhone && <p>Tel: {k.clientPhone}</p>}
                              <p>Pedido: #{k.orderId}</p>
                              {k.submittedAt && <p>Enviado em: {formatDateBR(k.submittedAt)}</p>}
                              {k.approvedAt  && (
                                <p className="text-green-700">
                                  Aprovado em: {formatDateBR(k.approvedAt)}
                                  {k.approvedByUsername && (
                                    <span className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-800 border border-green-200">
                                      @{k.approvedByUsername}
                                    </span>
                                  )}
                                </p>
                              )}
                              {k.rejectedAt  && <p className="text-red-700">Negado em: {formatDateBR(k.rejectedAt)}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => openKycModal(k.orderId)}
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-muted transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Ver docs
                            </button>
                          </div>
                        </div>

                        {/* Approve / Reject actions */}
                        {(k.status === "submitted" || k.status === "pending" || k.status === "approved" || k.status === "rejected") && (
                          <div className="flex gap-2 pt-1 border-t border-border">
                            <button
                              onClick={() => updateKycStatus(k.orderId, "approve")}
                              disabled={isUpdating || k.status === "approved"}
                              className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl font-semibold transition-colors ${
                                k.status === "approved"
                                  ? "bg-green-100 text-green-700 cursor-default"
                                  : "bg-green-500 hover:bg-green-600 text-white"
                              }`}
                            >
                              {isUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                              {k.status === "approved" ? "Aprovado" : "Aprovar"}
                            </button>
                            <button
                              onClick={() => updateKycStatus(k.orderId, "reject")}
                              disabled={isUpdating || k.status === "rejected"}
                              className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl font-semibold transition-colors ${
                                k.status === "rejected"
                                  ? "bg-red-100 text-red-700 cursor-default"
                                  : "bg-red-500 hover:bg-red-600 text-white"
                              }`}
                            >
                              {isUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                              {k.status === "rejected" ? "Negado" : "Negar"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Summary stats */}
            {kycList.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Total",      count: kycList.length,                                    color: "text-foreground" },
                  { label: "Aguardando", count: kycList.filter((k) => k.status === "submitted").length, color: "text-amber-700" },
                  { label: "Aprovados",  count: kycList.filter((k) => k.status === "approved").length,  color: "text-green-700" },
                  { label: "Negados",    count: kycList.filter((k) => k.status === "rejected").length,  color: "text-red-700" },
                ].map(({ label, count, color }) => (
                  <div key={label} className="bg-white border border-border rounded-xl p-4 text-center">
                    <p className={`text-2xl font-bold ${color}`}>{count}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : tab === "socialProof" ? (
          <div className="space-y-6">
            {spSettingsLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-foreground flex items-center gap-2"><ShoppingBag className="w-5 h-5 text-primary" /> Prova Social</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">Notificações de compra exibidas no canto inferior esquerdo da loja</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={fetchSocialProof} className="gap-1.5"><RefreshCw className="w-3.5 h-3.5" />Atualizar</Button>
                </div>

                {/* Main toggle */}
                <div className={`rounded-2xl border-2 p-5 flex items-center justify-between gap-4 transition-colors ${spSettings?.enabled ? "border-green-400 bg-green-50" : "border-border bg-muted/30"}`}>
                  <div>
                    <p className="font-semibold text-foreground">{spSettings?.enabled ? "✅ Prova Social Ativada" : "⭕ Prova Social Desativada"}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">Quando ativado, os cards aparecem no site para os visitantes</p>
                  </div>
                  <button
                    onClick={() => spSettings && saveSpSettings({ enabled: !spSettings.enabled })}
                    disabled={spSettingsSaving}
                    className="flex-shrink-0"
                  >
                    {spSettings?.enabled
                      ? <IconLucide name="ToggleRight" className="w-10 h-10 text-green-500 cursor-pointer hover:text-green-600 transition-colors" />
                      : <ToggleLeft className="w-10 h-10 text-muted-foreground cursor-pointer hover:text-foreground transition-colors" />
                    }
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left column — settings */}
                  <div className="space-y-4">

                    {/* Timing */}
                    <div className="bg-white rounded-2xl border border-border p-5 space-y-4">
                      <h3 className="font-semibold text-foreground flex items-center gap-2"><Clock className="w-4 h-4 text-primary" />Temporização</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground block mb-1">Intervalo entre cards (seg)</label>
                          <input
                            type="number" min="2" max="120"
                            className="w-full border border-border rounded-lg px-3 py-2 text-sm"
                            defaultValue={spSettings?.delaySeconds ?? 8}
                            onBlur={(e) => saveSpSettings({ delaySeconds: parseInt(e.target.value) || 8 })}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground block mb-1">Tempo exibido (seg)</label>
                          <input
                            type="number" min="2" max="30"
                            className="w-full border border-border rounded-lg px-3 py-2 text-sm"
                            defaultValue={spSettings?.displaySeconds ?? 5}
                            onBlur={(e) => saveSpSettings({ displaySeconds: parseInt(e.target.value) || 5 })}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Colors */}
                    <div className="bg-white rounded-2xl border border-border p-5 space-y-4">
                      <h3 className="font-semibold text-foreground">🎨 Cores do Card</h3>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground block mb-1">Fundo</label>
                          <div className="flex gap-2 items-center">
                            <input type="color" className="w-9 h-9 rounded-lg border border-border cursor-pointer p-0.5"
                              defaultValue={spSettings?.cardBgColor ?? "#ffffff"}
                              onBlur={(e) => saveSpSettings({ cardBgColor: e.target.value })}
                            />
                            <span className="text-xs text-muted-foreground font-mono">{spSettings?.cardBgColor ?? "#ffffff"}</span>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground block mb-1">Texto</label>
                          <div className="flex gap-2 items-center">
                            <input type="color" className="w-9 h-9 rounded-lg border border-border cursor-pointer p-0.5"
                              defaultValue={spSettings?.cardTextColor ?? "#1a1a1a"}
                              onBlur={(e) => saveSpSettings({ cardTextColor: e.target.value })}
                            />
                            <span className="text-xs text-muted-foreground font-mono">{spSettings?.cardTextColor ?? "#1a1a1a"}</span>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground block mb-1">Destaque</label>
                          <div className="flex gap-2 items-center">
                            <input type="color" className="w-9 h-9 rounded-lg border border-border cursor-pointer p-0.5"
                              defaultValue={spSettings?.badgeColor ?? "#22c55e"}
                              onBlur={(e) => saveSpSettings({ badgeColor: e.target.value })}
                            />
                            <span className="text-xs text-muted-foreground font-mono">{spSettings?.badgeColor ?? "#22c55e"}</span>
                          </div>
                        </div>
                      </div>

                      {/* Preview */}
                      <div className="mt-2">
                        <p className="text-xs font-medium text-muted-foreground mb-2">Pré-visualização</p>
                        <div
                          className="rounded-2xl overflow-hidden relative select-none"
                          style={{
                            backgroundColor: spSettings?.cardBgColor ?? "#ffffff",
                            boxShadow: "0 8px 32px rgba(0,0,0,0.13), 0 2px 8px rgba(0,0,0,0.08)",
                            width: 250,
                          }}
                        >
                          <div className="h-1 w-full" style={{ backgroundColor: spSettings?.badgeColor ?? "#22c55e" }} />
                          <div className="px-3.5 pt-3 pb-3">
                            <div className="flex items-start gap-2.5">
                              <div className="mt-0.5 w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                                style={{ backgroundColor: (spSettings?.badgeColor ?? "#22c55e") + "1a" }}>
                                <ShoppingBag className="w-4 h-4" style={{ color: spSettings?.badgeColor ?? "#22c55e" }} />
                              </div>
                              <div className="flex-1 min-w-0 pr-4">
                                <p className="text-[13px] font-semibold leading-tight" style={{ color: spSettings?.cardTextColor ?? "#1a1a1a" }}>
                                  <span style={{ color: spSettings?.badgeColor ?? "#22c55e" }}>Maria***</span>
                                  {" "}
                                  <span style={{ opacity: 0.7 }}>acabou de comprar</span>
                                </p>
                                <p className="text-[12px] font-bold mt-1 leading-snug" style={{ color: spSettings?.cardTextColor ?? "#1a1a1a" }}>Produto Exemplo XYZ</p>
                                <div className="flex items-center gap-1 mt-1.5">
                                  <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                    style={{ color: spSettings?.badgeColor ?? "#22c55e", opacity: 0.8 }}>
                                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                                  </svg>
                                  <p className="text-[11px] font-medium" style={{ color: spSettings?.cardTextColor ?? "#1a1a1a", opacity: 0.55 }}>São Paulo</p>
                                </div>
                              </div>
                            </div>
                            <div className="mt-3 h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: (spSettings?.cardTextColor ?? "#1a1a1a") + "12" }}>
                              <div className="h-full w-2/3 rounded-full" style={{ backgroundColor: (spSettings?.badgeColor ?? "#22c55e") + "99" }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Sources */}
                    <div className="bg-white rounded-2xl border border-border p-5 space-y-3">
                      <h3 className="font-semibold text-foreground">📢 Fontes de Dados</h3>
                      <div className="flex items-center justify-between py-2 border-b border-border">
                        <div>
                          <p className="text-sm font-medium">Vendas Reais</p>
                          <p className="text-xs text-muted-foreground">Exibe notificações de pedidos pagos recentes</p>
                        </div>
                        <button onClick={() => spSettings && saveSpSettings({ showRealSales: !spSettings.showRealSales })} disabled={spSettingsSaving}>
                          {spSettings?.showRealSales
                            ? <IconLucide name="ToggleRight" className="w-8 h-8 text-green-500 cursor-pointer" />
                            : <ToggleLeft className="w-8 h-8 text-muted-foreground cursor-pointer" />
                          }
                        </button>
                      </div>
                      {spSettings?.showRealSales && (
                        <div className="px-1 pb-1">
                          <label className="text-xs font-medium text-muted-foreground block mb-1">
                            Janela de tempo — considerar como "recente" (horas)
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number" min="1" max="72"
                              className="w-24 border border-border rounded-lg px-3 py-2 text-sm"
                              defaultValue={spSettings.realWindowHours ?? 2}
                              onBlur={(e) => saveSpSettings({ realWindowHours: Math.min(72, Math.max(1, parseInt(e.target.value) || 2)) })}
                            />
                            <span className="text-xs text-muted-foreground">hora(s) antes do acesso do visitante</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Pedidos fora desta janela não aparecem como venda real — o widget usa somente os auto-gerados.
                          </p>
                        </div>
                      )}
                      <div className="flex items-center justify-between py-2 border-b border-border">
                        <div>
                          <p className="text-sm font-medium">Cards Extras (Manuais)</p>
                          <p className="text-xs text-muted-foreground">Entradas criadas manualmente na coluna ao lado</p>
                        </div>
                        <button onClick={() => spSettings && saveSpSettings({ showFakeCards: !spSettings.showFakeCards })} disabled={spSettingsSaving}>
                          {spSettings?.showFakeCards
                            ? <IconLucide name="ToggleRight" className="w-8 h-8 text-green-500 cursor-pointer" />
                            : <ToggleLeft className="w-8 h-8 text-muted-foreground cursor-pointer" />
                          }
                        </button>
                      </div>

                      {/* Auto-generate */}
                      <div className="flex items-center justify-between py-2">
                        <div>
                          <p className="text-sm font-medium flex items-center gap-1.5">
                            ✨ Auto-gerar Notificações
                          </p>
                          <p className="text-xs text-muted-foreground">Sistema gera nomes e cidades brasileiros aleatórios + produtos do catálogo, sem repetir</p>
                        </div>
                        <button onClick={() => spSettings && saveSpSettings({ autoGenerate: !spSettings.autoGenerate })} disabled={spSettingsSaving}>
                          {spSettings?.autoGenerate
                            ? <IconLucide name="ToggleRight" className="w-8 h-8 text-green-500 cursor-pointer" />
                            : <ToggleLeft className="w-8 h-8 text-muted-foreground cursor-pointer" />
                          }
                        </button>
                      </div>

                      {/* Auto-generate options */}
                      {spSettings?.autoGenerate && (
                        <div className="pt-1 pb-2 space-y-4 bg-violet-50 border border-violet-100 rounded-xl px-3 py-3">

                          {/* Status badge */}
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">
                              {spAutoCount === null ? "Carregando..." : spAutoCount === 0
                                ? "⚠️ Nenhuma notificação gerada ainda — clique em Salvar e Gerar"
                                : `✅ ${spAutoCount} notificações armazenadas no banco`}
                            </p>
                          </div>

                          <div>
                            <label className="text-xs font-medium text-muted-foreground block mb-1">Quantidade de notificações a gerar</label>
                            <input
                              type="number" min="10" max="100"
                              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white"
                              defaultValue={spSettings.autoGenerateCount ?? 40}
                              onBlur={(e) => saveSpSettings({ autoGenerateCount: Math.min(100, Math.max(10, parseInt(e.target.value) || 40)) })}
                            />
                            <p className="text-[10px] text-muted-foreground mt-1">Nomes e cidades brasileiros aleatórios. Mínimo 10, máximo 100.</p>
                          </div>

                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1.5">Produtos para auto-gerar</p>
                            <div className="flex gap-3 flex-wrap">
                              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                                <input type="radio" checked={spSettings.fakeAllProducts} onChange={() => saveSpSettings({ fakeAllProducts: true })} />
                                Todos os produtos
                              </label>
                              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                                <input type="radio" checked={!spSettings.fakeAllProducts} onChange={() => saveSpSettings({ fakeAllProducts: false })} />
                                Produtos específicos
                              </label>
                            </div>
                            {!spSettings.fakeAllProducts && (
                              <div className="mt-2 space-y-1.5 max-h-36 overflow-y-auto">
                                {(Array.isArray(products) ? products : []).map((p) => {
                                  const checked = spFakeProductIds.includes(p.id);
                                  return (
                                    <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-white px-2 py-1 rounded-lg">
                                      <input type="checkbox" checked={checked} onChange={() => {
                                        const next = checked ? spFakeProductIds.filter((id) => id !== p.id) : [...spFakeProductIds, p.id];
                                        setSpFakeProductIds(next);
                                        saveSpSettings({ fakeProductIds: JSON.stringify(next) });
                                      }} />
                                      {p.name}
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* Generate button */}
                          <button
                            onClick={generateAutoEntries}
                            disabled={spAutoGenerating}
                            className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
                          >
                            {spAutoGenerating
                              ? <><Loader2 className="w-4 h-4 animate-spin" />Gerando...</>
                              : <>✨ Salvar e Gerar Notificações</>
                            }
                          </button>
                          <p className="text-[10px] text-muted-foreground text-center -mt-1">
                            As notificações anteriores são apagadas e substituídas pelas novas. Gere novamente a cada dia para variar.
                          </p>
                        </div>
                      )}

                      {/* Product filter for manual fake cards (only when not using auto-generate) */}
                      {spSettings?.showFakeCards && !spSettings?.autoGenerate && (
                        <div className="pt-2 space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">Produtos para cards manuais</p>
                          <div className="flex gap-3">
                            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                              <input type="radio" checked={spSettings.fakeAllProducts} onChange={() => saveSpSettings({ fakeAllProducts: true })} />
                              Todos os produtos
                            </label>
                            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                              <input type="radio" checked={!spSettings.fakeAllProducts} onChange={() => saveSpSettings({ fakeAllProducts: false })} />
                              Produtos específicos
                            </label>
                          </div>
                          {!spSettings.fakeAllProducts && (
                            <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                              {(Array.isArray(products) ? products : []).map((p) => {
                                const checked = spFakeProductIds.includes(p.id);
                                return (
                                  <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/40 px-2 py-1 rounded-lg">
                                    <input type="checkbox" checked={checked} onChange={() => {
                                      const next = checked ? spFakeProductIds.filter((id) => id !== p.id) : [...spFakeProductIds, p.id];
                                      setSpFakeProductIds(next);
                                      saveSpSettings({ fakeProductIds: JSON.stringify(next) });
                                    }} />
                                    {p.name}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right column — fake entries */}
                  <div className="space-y-4">
                    <div className="bg-white rounded-2xl border border-border p-5">
                      <h3 className="font-semibold text-foreground mb-3">✍️ Cards Extras</h3>
                      <p className="text-xs text-muted-foreground mb-4">Entradas manuais exibidas quando "Cards Extras" está ativado. Apenas o primeiro nome aparece para proteger a privacidade.</p>

                      {/* Form */}
                      <div className="bg-muted/30 rounded-xl p-4 space-y-3 mb-4">
                        <p className="text-xs font-semibold text-foreground">{spFakeEditingId ? "Editar entrada" : "Nova entrada"}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-muted-foreground">Primeiro Nome</label>
                            <input
                              className="w-full mt-0.5 border border-border rounded-lg px-2.5 py-2 text-sm"
                              placeholder="Ex: Ana"
                              value={spFakeForm.firstName}
                              onChange={(e) => setSpFakeForm((f) => ({ ...f, firstName: e.target.value }))}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Cidade</label>
                            <input
                              className="w-full mt-0.5 border border-border rounded-lg px-2.5 py-2 text-sm"
                              placeholder="Ex: São Paulo"
                              value={spFakeForm.city}
                              onChange={(e) => setSpFakeForm((f) => ({ ...f, city: e.target.value }))}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Estado (sigla)</label>
                            <input
                              className="w-full mt-0.5 border border-border rounded-lg px-2.5 py-2 text-sm"
                              placeholder="Ex: SP"
                              maxLength={2}
                              value={spFakeForm.state}
                              onChange={(e) => setSpFakeForm((f) => ({ ...f, state: e.target.value.toUpperCase() }))}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Produto comprado</label>
                            <input
                              className="w-full mt-0.5 border border-border rounded-lg px-2.5 py-2 text-sm"
                              placeholder="Ex: Bolsa Feminina XL"
                              value={spFakeForm.productName}
                              onChange={(e) => setSpFakeForm((f) => ({ ...f, productName: e.target.value }))}
                            />
                          </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          {spFakeEditingId ? (
                            <>
                              <Button size="sm" className="flex-1 gap-1.5" onClick={() => updateSpFakeEntry(spFakeEditingId)} disabled={spFakeCreating}>
                                {spFakeCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Salvar
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => { setSpFakeEditingId(null); setSpFakeForm({ firstName: "", city: "", state: "", productName: "" }); }}>
                                Cancelar
                              </Button>
                            </>
                          ) : (
                            <Button size="sm" className="flex-1 gap-1.5" onClick={createSpFakeEntry} disabled={spFakeCreating}>
                              {spFakeCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}Adicionar
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Entries list */}
                      {spFakeEntriesLoading ? (
                        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                      ) : spFakeEntries.length === 0 ? (
                        <p className="text-center text-sm text-muted-foreground py-6">Nenhuma entrada criada ainda.</p>
                      ) : (
                        <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
                          {spFakeEntries.map((entry) => (
                            <div key={entry.id} className="flex items-center gap-3 px-3 py-2.5 bg-muted/30 rounded-xl border border-border">
                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                <ShoppingBag className="w-3.5 h-3.5 text-primary" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold truncate"><span className="text-primary">{entry.firstName}</span> · {entry.city}, {entry.state}</p>
                                <p className="text-[11px] text-muted-foreground truncate">{entry.productName}</p>
                              </div>
                              <div className="flex gap-1 flex-shrink-0">
                                <button
                                  onClick={() => { setSpFakeEditingId(entry.id); setSpFakeForm({ firstName: entry.firstName, city: entry.city, state: entry.state, productName: entry.productName }); }}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-primary/10 transition-colors text-muted-foreground hover:text-primary"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => deleteSpFakeEntry(entry.id)}
                                  disabled={spFakeDeleting === entry.id}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-500"
                                >
                                  {spFakeDeleting === entry.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Real sales preview */}
                    {spSettings?.showRealSales && (
                      <div className="bg-white rounded-2xl border border-border p-5">
                        <h3 className="font-semibold text-foreground mb-3">📦 Pré-visualização de Vendas Reais</h3>
                        <p className="text-xs text-muted-foreground mb-3">Pedidos pagos mais recentes que aparecerão no feed (apenas {`{primeiro nome}`}, cidade e estado)</p>
                        {spRealEntries.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-4">Nenhuma venda real encontrada com endereço completo.</p>
                        ) : (
                          <div className="space-y-2 max-h-60 overflow-y-auto">
                            {spRealEntries.slice(0, 10).map((e, i) => (
                              <div key={i} className="flex items-center gap-2.5 px-3 py-2 bg-green-50 rounded-lg border border-green-100">
                                <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-xs font-medium truncate"><span className="text-green-700">{e.firstName}</span> · {e.city}, {e.state}</p>
                                  <p className="text-[11px] text-muted-foreground truncate">{e.productName}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : tab === "raffles" ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                <Ticket className="w-5 h-5 text-primary" /> Rifas
              </h2>
              <Button variant="outline" size="sm" onClick={fetchRaffles} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Atualizar
              </Button>
            </div>

            {/* View Reservations panel */}
            {raffleViewId ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" onClick={() => { setRaffleViewId(null); setRaffleReservations([]); setRaffleRanking([]); setRaffleResult(null); setRafflePromotions([]); }}>
                    ← Voltar às rifas
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Reservas da: <strong>{selectedRaffle?.title}</strong>
                  </span>
                  <Button variant="outline" size="sm" onClick={() => { fetchRaffleReservations(raffleViewId); fetchRaffleRanking(raffleViewId); fetchRaffleResult(raffleViewId); fetchRafflePromotions(raffleViewId); }} className="ml-auto gap-1.5">
                    <RefreshCw className="w-3 h-3" /> Atualizar
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="border border-border rounded-xl p-3 bg-card">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total pago</p>
                    <p className="mt-1 text-2xl font-bold text-green-700">{formatCurrency(raffleViewPaidAmount)}</p>
                  </div>
                  <div className="border border-border rounded-xl p-3 bg-card">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reservas pagas</p>
                    <p className="mt-1 text-2xl font-bold text-foreground">{raffleViewPaidCount}</p>
                  </div>
                  <div className="border border-border rounded-xl p-3 bg-card">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preço por cota</p>
                    <p className="mt-1 text-2xl font-bold text-foreground">{selectedRaffle ? formatCurrency(Number(selectedRaffle.pricePerNumber)) : "-"}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <div className="lg:col-span-2 border border-border rounded-xl p-3 bg-card space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Top 3 compradores (pagos)</p>
                    {raffleRanking.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Ainda não há ranking com pagamentos confirmados.</p>
                    ) : (
                      <div className="space-y-2">
                        {raffleRanking.map((rk, idx) => (
                          <div key={`${rk.clientPhone}-${idx}`} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                            <div>
                              <p className="text-sm font-semibold text-foreground">{idx + 1}º {rk.clientName}</p>
                              <p className="text-xs text-muted-foreground">{rk.clientPhone}</p>
                            </div>
                            <p className="text-sm font-bold text-primary">{rk.totalNumbers} cotas</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border border-border rounded-xl p-3 bg-card space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Resultado da rifa</p>
                    {raffleResultLoading ? (
                      <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                    ) : raffleResult ? (
                      <div className="rounded-lg bg-muted/40 p-2">
                        <p className="text-sm text-muted-foreground">Número vencedor</p>
                        <p className="text-xl font-bold text-primary">{raffleResult.winnerNumber}</p>
                        <p className="text-sm font-semibold text-foreground mt-1">{raffleResult.winnerClientName || "Sem comprador pago"}</p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Sem resultado publicado.</p>
                    )}

                    <div className="space-y-2">
                      <input
                        type="number"
                        min="1"
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white"
                        placeholder="Número vencedor"
                        value={raffleDrawForm.winnerNumber}
                        onChange={(e) => setRaffleDrawForm((f) => ({ ...f, winnerNumber: e.target.value }))}
                      />
                      <textarea
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white resize-none"
                        rows={2}
                        placeholder="Observação do sorteio (opcional)"
                        value={raffleDrawForm.notes}
                        onChange={(e) => setRaffleDrawForm((f) => ({ ...f, notes: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={raffleSavingResult}
                        onClick={async () => {
                          if (!raffleViewId) return;
                          const winnerNumber = Number(raffleDrawForm.winnerNumber);
                          if (!Number.isInteger(winnerNumber) || winnerNumber < 1) {
                            toast.error("Informe um número vencedor válido.");
                            return;
                          }
                          setRaffleSavingResult(true);
                          try {
                            const res = await fetch(`${BASE}/api/admin/raffles/${raffleViewId}/result`, {
                              method: "PUT",
                              headers: { ...authHeaders(), "Content-Type": "application/json" },
                              body: JSON.stringify({ winnerNumber, notes: raffleDrawForm.notes.trim() || null, drawMethod: "manual" }),
                            });
                            const data = await res.json() as { result?: AdminRaffleResult; message?: string };
                            if (!res.ok) {
                              toast.error(data.message || "Erro ao registrar resultado.");
                              return;
                            }
                            setRaffleResult(data.result ?? null);
                            toast.success("Resultado da rifa publicado!");
                            fetchRaffles();
                            fetchRaffleRanking(raffleViewId);
                          } catch {
                            toast.error("Erro ao registrar resultado.");
                          } finally {
                            setRaffleSavingResult(false);
                          }
                        }}
                      >
                        {raffleSavingResult ? <Loader2 className="w-4 h-4 animate-spin" /> : "Publicar resultado"}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="border border-border rounded-xl p-3 bg-card space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Promoções de cotas</p>
                    <span className="text-xs text-muted-foreground">{rafflePromotions.length} promoções</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <input
                      type="number"
                      min="2"
                      className="border border-border rounded-lg px-3 py-2 text-sm bg-white"
                      placeholder="Qtd. cotas"
                      value={rafflePromotionForm.quantity}
                      onChange={(e) => setRafflePromotionForm((f) => ({ ...f, quantity: e.target.value }))}
                    />
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      className="border border-border rounded-lg px-3 py-2 text-sm bg-white"
                      placeholder="Preço promocional"
                      value={rafflePromotionForm.promoPrice}
                      onChange={(e) => setRafflePromotionForm((f) => ({ ...f, promoPrice: e.target.value }))}
                    />
                    <input
                      type="number"
                      className="border border-border rounded-lg px-3 py-2 text-sm bg-white"
                      placeholder="Ordem"
                      value={rafflePromotionForm.sortOrder}
                      onChange={(e) => setRafflePromotionForm((f) => ({ ...f, sortOrder: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      disabled={rafflePromotionSaving}
                      onClick={async () => {
                        if (!raffleViewId) return;
                        const quantity = Number(rafflePromotionForm.quantity);
                        const promoPrice = Number(rafflePromotionForm.promoPrice);
                        if (!Number.isInteger(quantity) || quantity < 2) {
                          toast.error("Quantidade inválida para promoção.");
                          return;
                        }
                        if (!Number.isFinite(promoPrice) || promoPrice <= 0) {
                          toast.error("Preço promocional inválido.");
                          return;
                        }
                        setRafflePromotionSaving(true);
                        try {
                          const res = await fetch(`${BASE}/api/admin/raffles/${raffleViewId}/promotions`, {
                            method: "POST",
                            headers: { ...authHeaders(), "Content-Type": "application/json" },
                            body: JSON.stringify({
                              quantity,
                              promoPrice,
                              sortOrder: Number(rafflePromotionForm.sortOrder || 0),
                              isActive: rafflePromotionForm.isActive,
                            }),
                          });
                          const data = await res.json() as { message?: string };
                          if (!res.ok) {
                            toast.error(data.message || "Erro ao criar promoção.");
                            return;
                          }
                          toast.success("Promoção criada!");
                          setRafflePromotionForm({ quantity: "", promoPrice: "", sortOrder: "0", isActive: true });
                          fetchRafflePromotions(raffleViewId);
                        } catch {
                          toast.error("Erro ao criar promoção.");
                        } finally {
                          setRafflePromotionSaving(false);
                        }
                      }}
                    >
                      {rafflePromotionSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Adicionar"}
                    </Button>
                  </div>

                  {rafflePromotions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma promoção cadastrada para esta rifa.</p>
                  ) : (
                    <div className="space-y-2">
                      {rafflePromotions.map((promo) => (
                        <div key={promo.id} className="flex items-center justify-between rounded-lg border border-border p-2">
                          <div>
                            <p className="text-sm font-semibold text-foreground">{promo.quantity} cotas por {formatCurrency(Number(promo.promoPrice))}</p>
                            <p className="text-xs text-muted-foreground">Ordem: {promo.sortOrder} · {promo.isActive ? "Ativa" : "Inativa"}</p>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                if (!raffleViewId) return;
                                try {
                                  await fetch(`${BASE}/api/admin/raffles/${raffleViewId}/promotions/${promo.id}`, {
                                    method: "PATCH",
                                    headers: { ...authHeaders(), "Content-Type": "application/json" },
                                    body: JSON.stringify({ isActive: !promo.isActive }),
                                  });
                                  fetchRafflePromotions(raffleViewId);
                                } catch {
                                  toast.error("Erro ao atualizar promoção.");
                                }
                              }}
                            >
                              {promo.isActive ? "Desativar" : "Ativar"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-red-200 text-red-600 hover:bg-red-50"
                              onClick={async () => {
                                if (!raffleViewId) return;
                                if (!confirm("Excluir esta promoção?")) return;
                                try {
                                  await fetch(`${BASE}/api/admin/raffles/${raffleViewId}/promotions/${promo.id}`, {
                                    method: "DELETE",
                                    headers: authHeaders(),
                                  });
                                  fetchRafflePromotions(raffleViewId);
                                } catch {
                                  toast.error("Erro ao excluir promoção.");
                                }
                              }}
                            >
                              Excluir
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {raffleReservationsLoading ? (
                  <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                ) : raffleReservations.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">Nenhuma reserva encontrada.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="pb-2 pr-4">Cliente</th>
                          <th className="pb-2 pr-4">Telefone</th>
                          <th className="pb-2 pr-4">Números</th>
                          <th className="pb-2 pr-4">Valor</th>
                          <th className="pb-2 pr-4">Status</th>
                          <th className="pb-2">Data</th>
                          <th className="pb-2 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {raffleReservations.map((rv) => (
                          <tr key={rv.id} className="hover:bg-muted/30">
                            <td className="py-2 pr-4 font-medium">{rv.clientName}</td>
                            <td className="py-2 pr-4">{rv.clientPhone}</td>
                            <td className="py-2 pr-4 font-mono text-xs max-w-[160px] truncate" title={rv.numbers.join(", ")}>{rv.numbers.join(", ")}</td>
                            <td className="py-2 pr-4">{formatCurrency(Number(rv.totalAmount))}</td>
                            <td className="py-2 pr-4">
                              {rv.status === "paid" ? (
                                <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-semibold">Pago</span>
                              ) : rv.status === "expired" || rv.isExpired ? (
                                <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full font-semibold">Expirado</span>
                              ) : (
                                <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full font-semibold">Reservado</span>
                              )}
                            </td>
                            <td className="py-2 text-muted-foreground text-xs">{new Date(rv.createdAt).toLocaleDateString("pt-BR")}</td>
                            <td className="py-2 text-right">
                              {rv.status === "reserved" && !rv.isExpired ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 px-2.5 text-xs border-red-200 text-red-700 hover:bg-red-50"
                                  onClick={() => raffleViewId && cancelRaffleReservation(raffleViewId, rv)}
                                  disabled={raffleCancelingReservationId === rv.id}
                                >
                                  {raffleCancelingReservationId === rv.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                                  <span className="ml-1">Cancelar</span>
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Create / Edit form */}
                <div className="bg-muted/30 border border-border rounded-2xl p-5 space-y-4">
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    <Plus className="w-4 h-4 text-primary" />
                    {raffleEditingId ? "Editar Rifa" : "Nova Rifa"}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="text-xs font-medium text-muted-foreground block mb-1">Título *</label>
                      <input type="text" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white"
                        placeholder="Ex: Rifa do iPhone 15"
                        value={raffleForm.title}
                        onChange={(e) => setRaffleForm((f) => ({ ...f, title: e.target.value }))} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-xs font-medium text-muted-foreground block mb-1">Descrição</label>
                      <textarea className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white resize-y min-h-[140px]" rows={7}
                        placeholder="Descreva o prêmio e as regras"
                        value={raffleForm.description}
                        onChange={(e) => setRaffleForm((f) => ({ ...f, description: e.target.value }))} />
                      <p className="mt-1 text-[11px] text-muted-foreground">Use Enter para quebra de linha. A prévia abaixo mostra como ficará para o cliente.</p>
                      {!!raffleForm.description.trim() && (
                        <div className="mt-2 rounded-lg border border-border bg-muted/30 p-3">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Prévia</p>
                          <p className="text-sm leading-7 text-foreground/90 whitespace-pre-line break-words text-left">
                            {formatRaffleDescriptionPreview(raffleForm.description)}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-xs font-medium text-muted-foreground block mb-1">Foto da rifa</label>
                      <div
                        className="relative border-2 border-dashed border-border rounded-xl overflow-hidden bg-white cursor-pointer hover:border-primary transition-colors"
                        style={{ minHeight: 96 }}
                        onClick={() => document.getElementById("raffle-img-upload")?.click()}
                      >
                        {raffleForm.imageUrl ? (
                          <div className="relative">
                            <div className="w-full max-w-[220px] aspect-[1149/1369] bg-muted/30 rounded-lg overflow-hidden">
                              <img src={raffleForm.imageUrl} alt="Prévia" className="w-full h-full object-contain" />
                            </div>
                            <button
                              type="button"
                              className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full w-7 h-7 flex items-center justify-center"
                              onClick={(e) => { e.stopPropagation(); setRaffleForm((f) => ({ ...f, imageUrl: "" })); }}
                              title="Remover foto"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-2 select-none">
                            <IconLucide name="Camera" className="w-8 h-8 opacity-40" />
                            <span className="text-sm">Clique para escolher uma foto</span>
                            <span className="text-xs opacity-60">JPG, PNG ou WebP · 1149x1369 · máx 5 MB</span>
                          </div>
                        )}
                        <input
                          id="raffle-img-upload"
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 5 * 1024 * 1024) { toast.error("Imagem maior que 5 MB."); return; }
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              const result = ev.target?.result as string;
                              // Normalize raffle image to a fixed 1149x1369 canvas.
                              const img = new Image();
                              img.onload = () => {
                                const TARGET_W = 1149;
                                const TARGET_H = 1369;
                                const scale = Math.min(TARGET_W / img.width, TARGET_H / img.height);
                                const drawW = Math.round(img.width * scale);
                                const drawH = Math.round(img.height * scale);
                                const offsetX = Math.round((TARGET_W - drawW) / 2);
                                const offsetY = Math.round((TARGET_H - drawH) / 2);
                                const canvas = document.createElement("canvas");
                                canvas.width = TARGET_W;
                                canvas.height = TARGET_H;
                                const ctx = canvas.getContext("2d")!;
                                ctx.fillStyle = "#ffffff";
                                ctx.fillRect(0, 0, TARGET_W, TARGET_H);
                                ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
                                const compressed = canvas.toDataURL("image/jpeg", 0.82);
                                setRaffleForm((f) => ({ ...f, imageUrl: compressed }));
                              };
                              img.src = result;
                            };
                            reader.readAsDataURL(file);
                            e.target.value = "";
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1">Qtd. de números *</label>
                      <input type="number" min="1" max="100000" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white"
                        value={raffleForm.totalNumbers}
                        onChange={(e) => setRaffleForm((f) => ({ ...f, totalNumbers: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1">Preço por número (R$) *</label>
                      <input type="number" min="0.01" step="0.01" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white"
                        value={raffleForm.pricePerNumber}
                        onChange={(e) => setRaffleForm((f) => ({ ...f, pricePerNumber: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1">Tempo de reserva (horas)</label>
                      <input type="number" min="1" max="720" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white"
                        value={raffleForm.reservationHours}
                        onChange={(e) => setRaffleForm((f) => ({ ...f, reservationHours: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
                      <select className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white"
                        value={raffleForm.status}
                        onChange={(e) => setRaffleForm((f) => ({ ...f, status: e.target.value }))}>
                        <option value="active">Ativa</option>
                        <option value="closed">Encerrada</option>
                        <option value="drawn">Sorteada</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {raffleEditingId && (
                      <Button variant="outline" size="sm" className="flex-1"
                        onClick={() => { setRaffleEditingId(null); setRaffleForm({ title: "", description: "", imageUrl: "", totalNumbers: "100", pricePerNumber: "10", reservationHours: "24", status: "active" }); }}>
                        Cancelar
                      </Button>
                    )}
                    <Button size="sm" className="flex-1" disabled={raffleCreating}
                      onClick={async () => {
                        if (!raffleForm.title.trim()) { toast.error("Informe o título."); return; }
                        setRaffleCreating(true);
                        try {
                          const url = raffleEditingId ? `${BASE}/api/admin/raffles/${raffleEditingId}` : `${BASE}/api/admin/raffles`;
                          const method = raffleEditingId ? "PATCH" : "POST";
                          const res = await fetch(url, {
                            method,
                            headers: { ...authHeaders(), "Content-Type": "application/json" },
                            body: JSON.stringify({
                              title: raffleForm.title.trim(),
                              description: raffleForm.description.trim() || null,
                              imageUrl: raffleForm.imageUrl.trim() || null,
                              totalNumbers: Number(raffleForm.totalNumbers),
                              pricePerNumber: Number(raffleForm.pricePerNumber),
                              reservationHours: Number(raffleForm.reservationHours),
                              status: raffleForm.status,
                            }),
                          });
                          if (!res.ok) {
                            const text = await res.text();
                            let msg = "Erro ao salvar.";
                            try { msg = (JSON.parse(text) as { message?: string }).message ?? msg; } catch { msg = text.slice(0, 120) || msg; }
                            if (res.status === 401) msg = "Sessão expirada. Faça login novamente.";
                            toast.error(msg);
                            return;
                          }
                          toast.success(raffleEditingId ? "Rifa atualizada!" : "Rifa criada com sucesso!");
                          setRaffleEditingId(null);
                          setRaffleForm({ title: "", description: "", imageUrl: "", totalNumbers: "100", pricePerNumber: "10", reservationHours: "24", status: "active" });
                          fetchRaffles();
                        } catch { toast.error("Erro de conexão."); }
                        finally { setRaffleCreating(false); }
                      }}>
                      {raffleCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : raffleEditingId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                      {raffleEditingId ? "Salvar" : "Criar Rifa"}
                    </Button>
                  </div>
                </div>

                {/* Raffles list */}
                {rafflesLoading ? (
                  <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                ) : rafflesList.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">Nenhuma rifa criada ainda.</div>
                ) : (
                  <div className="space-y-3">
                    {rafflesList.map((raffle) => (
                      <div key={raffle.id} className="border border-border rounded-2xl p-4 bg-card">
                        <div className="flex items-start gap-3">
                          {raffle.imageUrl && (
                            <img src={raffle.imageUrl} alt={raffle.title} className="w-16 h-16 object-cover rounded-xl shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-foreground truncate">{raffle.title}</p>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${raffle.status === "active" ? "bg-green-100 text-green-700" : raffle.status === "drawn" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"}`}>
                                {raffle.status === "active" ? "Ativa" : raffle.status === "drawn" ? "Sorteada" : "Encerrada"}
                              </span>
                            </div>
                            {raffle.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{raffle.description}</p>}
                            <p className="text-xs text-muted-foreground mt-1">
                              {raffle.totalNumbers} números · {formatCurrency(Number(raffle.pricePerNumber))}/número · Reserva {raffle.reservationHours}h
                            </p>
                            <p className="text-sm font-semibold text-green-700 mt-2">
                              Total pago: {formatCurrency(Number(raffle.totalPaidAmount))}
                            </p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button size="icon" variant="outline" className="w-8 h-8"
                              title="Copiar link da rifa"
                              onClick={() => {
                                const link = `${window.location.origin}/rifas/${raffle.id}`;
                                navigator.clipboard.writeText(link);
                                toast.success("Link copiado!");
                              }}>
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="outline" className="w-8 h-8"
                              title="Ver reservas"
                              onClick={() => { setRaffleViewId(raffle.id); fetchRaffleReservations(raffle.id); fetchRaffleRanking(raffle.id); fetchRaffleResult(raffle.id); fetchRafflePromotions(raffle.id); }}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="outline" className="w-8 h-8"
                              title="Editar"
                              onClick={() => {
                                setRaffleEditingId(raffle.id);
                                setRaffleForm({
                                  title: raffle.title,
                                  description: raffle.description ?? "",
                                  imageUrl: raffle.imageUrl ?? "",
                                  totalNumbers: String(raffle.totalNumbers),
                                  pricePerNumber: raffle.pricePerNumber,
                                  reservationHours: String(raffle.reservationHours),
                                  status: raffle.status,
                                });
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="outline" className="w-8 h-8 border-red-200 hover:bg-red-50 text-red-500"
                              title="Excluir"
                              onClick={() => { setRaffleDeleteConfirm({ id: raffle.id, title: raffle.title }); setRaffleDeleteInput(""); }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : tab === "lojas" ? (
          <div className="space-y-6">
            <div className="rounded-2xl border border-border bg-card p-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={lojasSubTab === "criar" ? "default" : "outline"}
                  className="h-9"
                  onClick={() => setLojasSubTab("criar")}
                >
                  Criar nova loja
                </Button>
                <Button
                  type="button"
                  variant={lojasSubTab === "pedidos" ? "default" : "outline"}
                  className="h-9"
                  onClick={() => setLojasSubTab("pedidos")}
                >
                  Pedidos de compra de filiais
                </Button>
                <Button
                  type="button"
                  variant={lojasSubTab === "cadastradas" ? "default" : "outline"}
                  className="h-9"
                  onClick={() => setLojasSubTab("cadastradas")}
                >
                  Lojas cadastradas
                </Button>
              </div>
            </div>

            {lojasSubTab === "criar" ? (
              <>
                <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center gap-2 text-foreground">
                    <Store className="w-4 h-4" />
                    <h3 className="text-base font-bold">Criar nova loja</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={tenantForm.name}
                      onChange={(e) => setTenantForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="Nome da loja"
                      className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                    />
                    <input
                      type="text"
                      value={tenantForm.slug}
                      onChange={(e) => setTenantForm((p) => ({ ...p, slug: e.target.value }))}
                      placeholder="Slug (ex: loja-2)"
                      className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                    />
                    <input
                      type="text"
                      value={tenantForm.domain}
                      onChange={(e) => {
                        const value = e.target.value;
                        setTenantForm((p) => ({ ...p, domain: value }));
                        setDnsDomainInput(value);
                      }}
                      placeholder="Domínio público (ex: loja2.seudominio.com)"
                      className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                    />
                    <input
                      type="text"
                      value={tenantForm.dnsTargetHost}
                      onChange={(e) => setTenantForm((p) => ({ ...p, dnsTargetHost: e.target.value }))}
                      placeholder="Host alvo DNS/Railway (opcional)"
                      className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                    />
                    <input
                      type="text"
                      value={tenantForm.siteName}
                      onChange={(e) => setTenantForm((p) => ({ ...p, siteName: e.target.value }))}
                      placeholder="Nome público da loja (rodapé/cabeçalho)"
                      className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                    />
                    <input
                      type="text"
                      value={tenantForm.supportWhatsapp}
                      onChange={(e) => setTenantForm((p) => ({ ...p, supportWhatsapp: e.target.value }))}
                      placeholder="WhatsApp suporte da loja (ex: 5511999999999)"
                      className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                    />
                    {!tenantForm.createAdminUser ? (
                      <input
                        type="text"
                        value={tenantForm.adminUsername}
                        onChange={(e) => setTenantForm((p) => ({ ...p, adminUsername: e.target.value }))}
                        placeholder="Usuário admin para vincular (opcional)"
                        className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                      />
                    ) : (
                      <input
                        type="text"
                        value={tenantForm.newAdminUsername}
                        onChange={(e) => setTenantForm((p) => ({ ...p, newAdminUsername: e.target.value }))}
                        placeholder="Novo usuário admin da loja"
                        className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                      />
                    )}
                  </div>
                  {tenantForm.createAdminUser ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input
                        type="password"
                        value={tenantForm.newAdminPassword}
                        onChange={(e) => setTenantForm((p) => ({ ...p, newAdminPassword: e.target.value }))}
                        placeholder="Senha do novo admin (mínimo 6 caracteres)"
                        className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                      />
                      <div className="h-11 px-3 rounded-xl border border-dashed border-border text-xs text-muted-foreground flex items-center">
                        O novo usuário será criado como admin da loja (sem acesso primário).
                      </div>
                    </div>
                  ) : null}
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={tenantForm.createAdminUser}
                      onChange={(e) => setTenantForm((p) => ({
                        ...p,
                        createAdminUser: e.target.checked,
                        adminUsername: e.target.checked ? "" : p.adminUsername,
                        newAdminUsername: e.target.checked ? p.newAdminUsername : "",
                        newAdminPassword: e.target.checked ? p.newAdminPassword : "",
                      }))}
                    />
                    Criar usuário admin novo para esta loja
                  </label>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={tenantForm.cloneSettingsFromDefault}
                      onChange={(e) => setTenantForm((p) => ({ ...p, cloneSettingsFromDefault: e.target.checked }))}
                    />
                    Clonar configurações atuais da Loja 1 para a nova loja
                  </label>
                  <div>
                    <Button
                      type="button"
                      onClick={createTenant}
                      disabled={tenantCreating}
                      className="h-10 rounded-xl"
                    >
                      {tenantCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      <span className="ml-2">Criar loja</span>
                    </Button>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-bold">Assistente DNS</h3>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9"
                      onClick={() => fetchDnsGuide(dnsDomainInput)}
                      disabled={dnsGuideLoading}
                    >
                      {dnsGuideLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      <span className="ml-2">Atualizar alvo</span>
                    </Button>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm">
                    <p className="text-muted-foreground">Host alvo da aplicação</p>
                    <p className="font-semibold text-foreground break-all">{dnsGuide?.targetHost || "carregando..."}</p>
                    <p className="text-xs text-muted-foreground mt-1">Configure TENANT_DNS_TARGET_HOST no backend se quiser forçar um host alvo específico.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2">
                    <input
                      type="text"
                      value={dnsDomainInput}
                      onChange={(e) => setDnsDomainInput(e.target.value)}
                      placeholder="Domínio para verificar (ex: loja2.seudominio.com)"
                      className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                    />
                    <Button type="button" variant="outline" className="h-11" onClick={() => fetchDnsGuide(dnsDomainInput)} disabled={dnsGuideLoading}>
                      Instrução
                    </Button>
                    <Button type="button" className="h-11" onClick={() => checkDns(dnsDomainInput)} disabled={dnsCheckLoading}>
                      {dnsCheckLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verificar DNS"}
                    </Button>
                  </div>

                  {dnsGuide?.instructions && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm space-y-1">
                      <p className="font-semibold text-blue-900">Registro recomendado</p>
                      <p className="text-blue-900">Tipo: <strong>{dnsGuide.instructions.type}</strong></p>
                      <p className="text-blue-900">Nome/Host: <strong>{dnsGuide.instructions.name}</strong></p>
                      <p className="text-blue-900 break-all">Valor/Destino: <strong>{dnsGuide.instructions.value}</strong></p>
                      <p className="text-xs text-blue-800">{dnsGuide.instructions.note}</p>
                    </div>
                  )}

                  {dnsCheckResult && (
                    <div className="rounded-xl border border-border bg-white p-3 text-sm space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${dnsCheckResult.status === "configured" ? "bg-emerald-100 text-emerald-700" : dnsCheckResult.status === "misconfigured" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-700"}`}>
                          {dnsCheckResult.status === "configured" ? (dnsCheckResult.rootAliasFlattenedMatch ? "Configurado via ALIAS" : "Configurado") : dnsCheckResult.status === "misconfigured" ? "Incorreto" : "Sem registro"}
                        </span>
                        <span className="text-muted-foreground">{dnsCheckResult.message}</span>
                      </div>
                      <p className="text-xs text-muted-foreground break-all">CNAME: {dnsCheckResult.dns.cname.length ? dnsCheckResult.dns.cname.join(", ") : "-"}</p>
                      <p className="text-xs text-muted-foreground break-all">A: {dnsCheckResult.dns.a.length ? dnsCheckResult.dns.a.join(", ") : "-"}</p>
                      <p className="text-xs text-muted-foreground break-all">Target A: {dnsCheckResult.dns.targetA.length ? dnsCheckResult.dns.targetA.join(", ") : "-"}</p>
                    </div>
                  )}
                </div>
              </>
            ) : null}

            {lojasSubTab === "pedidos" ? (
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-4 gap-2">
                  <h3 className="text-base font-bold">Painel da loja filial</h3>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    onClick={() => {
                      if (!selectedFilialTenantId) return;
                      if (filialScopeSubTab === "pedidos") {
                        void fetchFilialPurchaseRequests(selectedFilialTenantId);
                        void fetchFilialStoreProducts(selectedFilialTenantId);
                      } else if (filialScopeSubTab === "estoque") {
                        void fetchFilialInventoryOverview(selectedFilialTenantId);
                        void fetchFilialStoreProducts(selectedFilialTenantId);
                      } else {
                        void fetchFilialStoreProducts(selectedFilialTenantId);
                        void fetchFilialInventoryOverview(selectedFilialTenantId);
                      }
                    }}
                    disabled={!selectedFilialTenantId || filialPurchaseLoading || filialStoreProductsLoading || filialInventoryLoading}
                  >
                    {(filialPurchaseLoading || filialStoreProductsLoading || filialInventoryLoading) ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    <span className="ml-2">Atualizar</span>
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 mb-4">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Selecionar loja filial</p>
                    <select
                      value={selectedFilialTenantId}
                      onChange={(e) => {
                        const nextTenantId = e.target.value;
                        setSelectedFilialTenantId(nextTenantId);
                        setFilialPurchaseOpenId(null);
                        setFilialStoreProductsSearch("");
                        setFilialInventorySearch("");
                      }}
                      className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus:border-primary"
                    >
                      <option value="">Selecione uma loja filial</option>
                      {filialTenantOptions.map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/20 p-1 flex items-center gap-1 self-end">
                    <Button
                      type="button"
                      variant={filialScopeSubTab === "pedidos" ? "default" : "ghost"}
                      className="h-8"
                      onClick={() => setFilialScopeSubTab("pedidos")}
                    >
                      Pedidos da loja
                    </Button>
                    <Button
                      type="button"
                      variant={filialScopeSubTab === "produtos" ? "default" : "ghost"}
                      className="h-8"
                      onClick={() => setFilialScopeSubTab("produtos")}
                    >
                      Produtos da loja
                    </Button>
                    <Button
                      type="button"
                      variant={filialScopeSubTab === "estoque" ? "default" : "ghost"}
                      className="h-8"
                      onClick={() => setFilialScopeSubTab("estoque")}
                    >
                      Estoque da loja
                    </Button>
                  </div>
                </div>

                {!selectedFilialTenantId ? (
                  <div className="text-sm text-muted-foreground mb-4">Selecione uma filial para carregar pedidos e produtos dessa loja.</div>
                ) : filialScopeSubTab === "pedidos" ? (
                  <>
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                      <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">Fila da Loja 1 para {selectedFilialTenant?.name || "filial"}</p>
                      <p className="text-xs text-amber-800 mt-1">
                        Aqui aparecem apenas os pedidos da filial selecionada. Ao confirmar a compra, o custo real é salvo e o estoque entra direto nessa filial.
                      </p>
                    </div>

                    <div className="mb-4 rounded-xl border border-border bg-white p-3 space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Gerar pedido manual para filial</p>
                        <p className="text-xs text-muted-foreground mt-1">Selecione produtos da filial (ou cadastre um novo) e gere um pedido pendente até a filial pagar.</p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-[1.3fr_0.5fr_0.6fr_auto] gap-2">
                        <ProductSelect
                          products={manualFilialSelectableProducts}
                          value={manualFilialProductId}
                          onChange={setManualFilialProductId}
                          placeholder="Pesquisar produto da filial"
                        />

                        <input
                          type="text"
                          inputMode="decimal"
                          value={manualFilialQuantity}
                          onChange={(e) => setManualFilialQuantity(e.target.value.replace(/[^0-9.,]/g, ""))}
                          placeholder="Qtd"
                          className="h-10 w-full rounded-lg border border-border px-3 text-sm bg-white"
                        />

                        <input
                          type="text"
                          inputMode="decimal"
                          value={manualFilialRepasseUnitCost}
                          onChange={(e) => setManualFilialRepasseUnitCost(e.target.value.replace(/[^0-9.,]/g, ""))}
                          placeholder="Custo base unit."
                          className="h-10 w-full rounded-lg border border-border px-3 text-sm bg-white"
                        />

                        <Button
                          type="button"
                          variant="outline"
                          className="h-10"
                          onClick={addManualFilialItem}
                        >
                          <Plus className="w-4 h-4" />
                          <span className="ml-2">Adicionar</span>
                        </Button>
                      </div>

                      {selectedManualFilialProduct ? (
                        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {selectedManualFilialProduct.image ? (
                              <img src={selectedManualFilialProduct.image} alt={selectedManualFilialProduct.name} className="h-9 w-9 rounded-md object-cover shrink-0 border border-border" loading="lazy" />
                            ) : (
                              <div className="h-9 w-9 rounded-md bg-muted shrink-0 border border-border flex items-center justify-center">
                                <IconLucide name="Package" className="w-4 h-4 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-xs text-muted-foreground">
                                Produto selecionado: <span className="font-semibold text-foreground">{selectedManualFilialProduct.name}</span>
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Preco venda: <span className="font-semibold text-foreground">{formatCurrency(selectedManualFilialProduct.price)}</span> · Custo atual: <span className="font-semibold text-foreground">{formatCurrency(selectedManualFilialProduct.costPrice)}</span>
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Margens aplicadas: <span className="font-semibold text-foreground">{selectedFilialMarginPercent}%</span> + <span className="font-semibold text-foreground">{formatCurrency(selectedFilialMarginFixedBrl)}</span>
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Repasse unit. calculado: <span className="font-semibold text-emerald-700">{manualFilialComputedRepasseUnitCost == null ? "-" : formatCurrency(manualFilialComputedRepasseUnitCost)}</span>
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <div className="rounded-lg border border-dashed border-border p-2 space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cadastrar produto rápido na filial</p>
                        <div className="grid grid-cols-1 md:grid-cols-[1.3fr_0.9fr_0.8fr_0.8fr_0.8fr_auto] gap-2">
                          <input
                            type="text"
                            value={manualFilialNewProductName}
                            onChange={(e) => setManualFilialNewProductName(e.target.value)}
                            placeholder="Nome do produto"
                            className="h-9 w-full rounded-lg border border-border px-3 text-sm bg-white"
                          />
                          <input
                            type="text"
                            value={manualFilialNewProductCategory}
                            onChange={(e) => setManualFilialNewProductCategory(e.target.value)}
                            placeholder="Categoria"
                            className="h-9 w-full rounded-lg border border-border px-3 text-sm bg-white"
                          />
                          <input
                            type="text"
                            value={manualFilialNewProductUnit}
                            onChange={(e) => setManualFilialNewProductUnit(e.target.value)}
                            placeholder="Unidade"
                            className="h-9 w-full rounded-lg border border-border px-3 text-sm bg-white"
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={manualFilialNewProductPrice}
                            onChange={(e) => setManualFilialNewProductPrice(e.target.value.replace(/[^0-9.,]/g, ""))}
                            placeholder="Venda R$"
                            className="h-9 w-full rounded-lg border border-border px-3 text-sm bg-white"
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={manualFilialNewProductCost}
                            onChange={(e) => setManualFilialNewProductCost(e.target.value.replace(/[^0-9.,]/g, ""))}
                            placeholder="Custo R$"
                            className="h-9 w-full rounded-lg border border-border px-3 text-sm bg-white"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9"
                            onClick={createManualFilialProduct}
                            disabled={manualFilialCreatingProduct}
                          >
                            {manualFilialCreatingProduct ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            <span className="ml-2">Cadastrar</span>
                          </Button>
                        </div>
                      </div>

                      {manualFilialItems.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Nenhum item adicionado no pedido manual.</p>
                      ) : (
                        <div className="space-y-2">
                          {manualFilialItems.map((item) => (
                            <div key={`manual-item-${item.productId}`} className="grid grid-cols-1 md:grid-cols-[1.4fr_auto_auto_auto] gap-2 items-center rounded-lg border border-border px-3 py-2">
                              <div>
                                <p className="text-sm font-medium text-foreground">{item.productName}</p>
                                <p className="text-xs text-muted-foreground">ID: {item.productId}</p>
                              </div>
                              <p className="text-xs text-muted-foreground">Qtd: <span className="font-semibold text-foreground">{item.quantity}</span></p>
                              <p className="text-xs text-muted-foreground">Custo un.: <span className="font-semibold text-foreground">{formatCurrency(item.repasseUnitCost)}</span></p>
                              <Button
                                type="button"
                                variant="outline"
                                className="h-8 border-red-200 text-red-700 hover:bg-red-50"
                                onClick={() => removeManualFilialItem(item.productId)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-center">
                        <input
                          type="text"
                          value={manualFilialClientName}
                          onChange={(e) => setManualFilialClientName(e.target.value)}
                          placeholder="Descrição do pedido (ex: compra manual lote agosto)"
                          className="h-10 w-full rounded-lg border border-border px-3 text-sm bg-white"
                        />
                        <Button
                          type="button"
                          className="h-10"
                          onClick={submitManualFilialPurchase}
                          disabled={manualFilialSubmitting || manualFilialItems.length === 0}
                        >
                          {manualFilialSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingBag className="w-4 h-4" />}
                          <span className="ml-2">Gerar pedido pendente ({formatCurrency(manualFilialTotal)})</span>
                        </Button>
                      </div>
                    </div>

                    {filialPurchaseLoading ? (
                      <div className="text-sm text-muted-foreground mb-4">Carregando pedidos da filial selecionada...</div>
                    ) : filteredFilialPurchaseRequests.length === 0 ? (
                      <div className="text-sm text-muted-foreground mb-4">Nenhum pedido pendente para essa filial.</div>
                    ) : (
                      <div className="space-y-3 mb-4">
                        {filteredFilialPurchaseRequests.map((request) => (
                          <div key={request.id} className="rounded-xl border border-amber-200 bg-white p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-foreground">{request.filialTenantName} · Pedido {request.orderId}</p>
                                <p className="text-xs text-muted-foreground">Cliente: {request.clientName}</p>
                                <p className="text-xs text-muted-foreground">
                                  Status: {filialPurchaseStatusLabel(request.status)} · Criado em {formatDateBR(request.createdAt) || "-"}
                                </p>
                                <p className="text-xs mt-1">
                                  <span className="text-muted-foreground">Custo produto atualizado:</span>{" "}
                                  {request.updateProductCost == null ? (
                                    <span className="font-semibold text-amber-700">Pendente</span>
                                  ) : request.updateProductCost ? (
                                    <span className="font-semibold text-emerald-700">Sim</span>
                                  ) : (
                                    <span className="font-semibold text-slate-600">Não</span>
                                  )}
                                </p>
                              </div>
                              <div className="text-right text-xs">
                                <p className="text-muted-foreground">Total pago na filial</p>
                                <p className="font-semibold text-foreground">{formatCurrency(request.orderTotal)}</p>
                                <p className="text-muted-foreground mt-1">Repasse estimado Loja 1</p>
                                <p className="font-semibold text-blue-700">{formatCurrency(request.repasseTotal)}</p>
                              </div>
                            </div>

                            <div className="mt-3 flex justify-end">
                              <div className="flex gap-2">
                                {String(request.status || "").trim().toLowerCase() === "pendente_pagamento_filial" ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="h-9 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                    onClick={() => { void markFilialPurchaseAsPaid(request); }}
                                    disabled={filialPurchaseMarkPaidId === request.id || filialPurchaseDeletingId === request.id || filialPurchaseConfirmingId === request.id}
                                  >
                                    {filialPurchaseMarkPaidId === request.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                    <span className="ml-2">Marcar pago na filial</span>
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-9 border-red-200 text-red-700 hover:bg-red-50"
                                  onClick={() => { void deleteFilialPurchase(request); }}
                                  disabled={filialPurchaseDeletingId === request.id || filialPurchaseConfirmingId === request.id}
                                >
                                  {filialPurchaseDeletingId === request.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                  <span className="ml-2">Cancelar pedido</span>
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-9"
                                  onClick={() => setFilialPurchaseOpenId((prev) => (prev === request.id ? null : request.id))}
                                >
                                  <span>{filialPurchaseOpenId === request.id ? "Fechar compra" : "Abrir compra"}</span>
                                </Button>
                              </div>
                            </div>

                            {filialPurchaseOpenId === request.id ? (
                              <>
                                <div className="mt-3 space-y-2">
                                  {request.items.map((item) => (
                                    <div key={`${request.id}-${item.productId}`} className="grid grid-cols-1 md:grid-cols-[1.6fr_auto_auto_auto] gap-2 items-center rounded-lg border border-border p-2">
                                      <div>
                                        <p className="text-sm font-medium text-foreground">{item.productName}</p>
                                        <p className="text-xs text-muted-foreground">ID: {item.productId}</p>
                                      </div>
                                      <p className="text-xs text-muted-foreground">Qtd: <span className="font-semibold text-foreground">{item.quantity}</span></p>
                                      <p className="text-xs text-muted-foreground">Repasse un.: <span className="font-semibold text-foreground">{formatCurrency(item.repasseUnitCost)}</span></p>
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={filialPurchaseCostDrafts[request.id]?.[item.productId] ?? String(item.repasseUnitCost || 0)}
                                        onChange={(e) => {
                                          const sanitized = e.target.value.replace(/[^0-9.,]/g, "");
                                          setFilialPurchaseCostDrafts((prev) => ({
                                            ...prev,
                                            [request.id]: {
                                              ...(prev[request.id] || {}),
                                              [item.productId]: sanitized,
                                            },
                                          }));
                                        }}
                                        placeholder="Custo real unit."
                                        className="h-9 px-2 rounded-lg border border-border bg-white focus:border-primary outline-none text-sm text-right"
                                      />
                                    </div>
                                  ))}
                                </div>

                                <div className="mt-3 flex justify-end">
                                  <label className="mr-3 inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs text-muted-foreground">
                                    <input
                                      type="checkbox"
                                      checked={!!filialPurchaseUpdateCostFlags[request.id]}
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        setFilialPurchaseUpdateCostFlags((prev) => ({ ...prev, [request.id]: checked }));
                                      }}
                                      className="h-4 w-4 rounded border-border"
                                    />
                                    Atualizar custo do produto na filial
                                  </label>
                                  <Button
                                    type="button"
                                    className="h-9"
                                    onClick={() => confirmFilialPurchase(request)}
                                    disabled={filialPurchaseConfirmingId === request.id || String(request.status || "").trim().toLowerCase() === "pendente_pagamento_filial"}
                                  >
                                    {filialPurchaseConfirmingId === request.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                    <span className="ml-2">
                                      {String(request.status || "").trim().toLowerCase() === "pendente_pagamento_filial"
                                        ? "Aguardando pagamento da filial"
                                        : "Confirmar compra e lançar estoque"}
                                    </span>
                                  </Button>
                                </div>
                              </>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : filialScopeSubTab === "produtos" ? (
                  <>
                    <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/70 p-3">
                      <p className="text-xs font-semibold text-blue-900 uppercase tracking-wide">Produtos da filial {selectedFilialTenant?.name || ""}</p>
                      <p className="text-xs text-blue-800 mt-1">
                        Catálogo da loja selecionada para conferência rápida de preço, custo e status.
                      </p>
                    </div>

                    <div className="mb-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-xs text-muted-foreground">Produtos exibidos</p>
                        <span className="text-xs text-muted-foreground">{filteredFilialStoreProducts.length}/{filialStoreProducts.length}</span>
                      </div>
                      <input
                        type="text"
                        value={filialStoreProductsSearch}
                        onChange={(e) => setFilialStoreProductsSearch(e.target.value)}
                        placeholder="Pesquisar produto por nome"
                        className="h-10 w-full rounded-lg border border-border px-3 text-sm bg-white"
                      />
                    </div>

                    {filialStoreProductsLoading ? (
                      <div className="text-sm text-muted-foreground mb-4">Carregando produtos da filial...</div>
                    ) : filialStoreProducts.length === 0 ? (
                      <div className="text-sm text-muted-foreground mb-4">Nenhum produto cadastrado para essa filial.</div>
                    ) : filteredFilialStoreProducts.length === 0 ? (
                      <div className="text-sm text-muted-foreground mb-4">Nenhum produto encontrado para essa busca.</div>
                    ) : (
                      <div className="space-y-2 mb-4">
                        {filteredFilialStoreProducts.map((product) => (
                          <div key={`filial-product-${product.id}`} className="rounded-xl border border-border bg-white p-3">
                            {(() => {
                              const stockQty = Number(filialInventoryQtyByProductId.get(product.id) || 0);
                              const hasStock = stockQty > 0;
                              return (
                                <>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="flex items-start gap-2 min-w-0">
                                {product.image ? (
                                  <img src={product.image} alt={product.name} className="h-9 w-9 rounded-md object-cover shrink-0 border border-border" loading="lazy" />
                                ) : (
                                  <div className="h-9 w-9 rounded-md bg-muted shrink-0 border border-border flex items-center justify-center">
                                    <IconLucide name="Package" className="w-4 h-4 text-muted-foreground" />
                                  </div>
                                )}
                                <div className="min-w-0">
                                <p className="text-sm font-semibold text-foreground">{product.name}</p>
                                <p className="text-xs text-muted-foreground">ID: {product.id} · Categoria: {product.category} · Unidade: {product.unit}</p>
                                </div>
                              </div>
                              <div className="text-right text-xs">
                                <p className="text-muted-foreground">Preço venda</p>
                                <p className="font-semibold text-foreground">{formatCurrency(product.price)}</p>
                                <p className="text-muted-foreground mt-1">Custo</p>
                                <p className="font-semibold text-blue-700">{formatCurrency(product.costPrice)}</p>
                                <div className="mt-2 flex items-center gap-1.5 justify-end">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={filialStoreCostDrafts[product.id] ?? String(product.costPrice || 0)}
                                    onChange={(e) => {
                                      const sanitized = e.target.value.replace(/[^0-9.,]/g, "");
                                      setFilialStoreCostDrafts((prev) => ({ ...prev, [product.id]: sanitized }));
                                    }}
                                    placeholder="Novo custo"
                                    className="h-7 w-24 rounded-md border border-border bg-white px-2 text-[11px] text-right"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="h-7 px-2 text-[11px]"
                                    onClick={() => saveFilialProductCost(product)}
                                    disabled={filialStoreCostSavingId === product.id}
                                  >
                                    {filialStoreCostSavingId === product.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                    <span className="ml-1">Salvar</span>
                                  </Button>
                                </div>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${product.isActive ? "border-emerald-200 bg-emerald-100 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600"}`}>
                                {product.isActive ? "Ativo" : "Inativo"}
                              </span>
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${hasStock ? "border-emerald-200 bg-emerald-100 text-emerald-700" : "border-red-200 bg-red-100 text-red-700"}`}>
                                {hasStock ? `Com estoque (${stockQty})` : "Sem estoque"}
                              </span>
                            </div>
                                </>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                      <p className="text-xs font-semibold text-emerald-900 uppercase tracking-wide">Estoque da filial {selectedFilialTenant?.name || ""}</p>
                      <p className="text-xs text-emerald-800 mt-1">
                        Saldo individual por produto da loja selecionada.
                      </p>
                    </div>

                    <div className="mb-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-xs text-muted-foreground">Produtos no estoque</p>
                        <span className="text-xs text-muted-foreground">{filteredFilialInventoryBalances.length}/{filialInventoryBalances.length}</span>
                      </div>
                      <input
                        type="text"
                        value={filialInventorySearch}
                        onChange={(e) => setFilialInventorySearch(e.target.value)}
                        placeholder="Pesquisar produto por nome"
                        className="h-10 w-full rounded-lg border border-border px-3 text-sm bg-white"
                      />
                    </div>

                    {filialInventoryLoading ? (
                      <div className="text-sm text-muted-foreground mb-4">Carregando estoque da filial...</div>
                    ) : filialInventoryBalances.length === 0 ? (
                      <div className="text-sm text-muted-foreground mb-4">Nenhum saldo registrado para essa filial.</div>
                    ) : filteredFilialInventoryBalances.length === 0 ? (
                      <div className="text-sm text-muted-foreground mb-4">Nenhum produto encontrado para essa busca.</div>
                    ) : (
                      <div className="space-y-2 mb-4">
                        {filteredFilialInventoryBalances.map((row) => {
                          const product = filialStoreProducts.find((item) => item.id === row.productId);
                          return (
                            <div key={`filial-stock-${row.productId}`} className="rounded-xl border border-border bg-white px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  {product?.image ? (
                                    <img src={product.image} alt={row.productName} className="h-8 w-8 rounded-md object-cover shrink-0 border border-border" loading="lazy" />
                                  ) : (
                                    <div className="h-8 w-8 rounded-md bg-muted shrink-0 border border-border flex items-center justify-center">
                                      <IconLucide name="Package" className="w-4 h-4 text-muted-foreground" />
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">{row.productName}</p>
                                    <p className="text-xs text-muted-foreground truncate">ID: {row.productId}</p>
                                  </div>
                                </div>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ${row.quantity > 0 ? "bg-green-100 text-green-800 border-green-200" : "bg-red-100 text-red-700 border-red-200"}`}>
                                  {row.quantity} un
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : null}

            {lojasSubTab === "cadastradas" ? (
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-4 gap-2">
                  <h3 className="text-base font-bold">Lojas cadastradas</h3>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    onClick={() => { fetchTenants(); fetchTenantProfitSummary(); }}
                    disabled={tenantsLoading || tenantProfitLoading}
                  >
                    {tenantsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    <span className="ml-2">Atualizar</span>
                  </Button>
                </div>

                <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/70 p-3">
                  <p className="text-xs font-semibold text-blue-900 uppercase tracking-wide">Resumo de lucro por loja</p>
                  <p className="text-xs text-blue-800 mt-1">
                    Período: {formatDateOnlyLocal(statsDateFrom)} até {formatDateOnlyLocal(statsDateTo)} ·
                    lucro da Loja 1 estimado com base na margem de repasse configurada por loja.
                  </p>
                </div>

                {tenantProfitLoading ? (
                  <div className="text-sm text-muted-foreground mb-4">Calculando lucro por loja...</div>
                ) : tenantProfitSummary.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
                    {tenantProfitSummary.map((summary) => (
                      <div key={`profit-${summary.tenantId}`} className="rounded-xl border border-border bg-muted/20 p-3">
                        <p className="text-sm font-semibold text-foreground">{summary.tenantName}</p>
                        <p className="text-xs text-muted-foreground">{summary.ordersCount} pedido(s) pago(s)</p>
                        <div className="mt-2 space-y-1 text-xs">
                          <p className="text-muted-foreground">Faturamento: <span className="font-semibold text-foreground">{formatCurrency(summary.totalPaid)}</span></p>
                          <p className="text-muted-foreground">Custo repasse (loja filha): <span className="font-semibold text-foreground">{formatCurrency(summary.childRepasseCost)}</span></p>
                          <p className="text-muted-foreground">Lucro loja filha (bruto): <span className="font-semibold text-emerald-700">{formatCurrency(summary.childGrossProfit)}</span></p>
                          <p className="text-muted-foreground">Lucro Loja 1 (estimado): <span className="font-semibold text-blue-700">{formatCurrency(summary.loja1EstimatedProfit)}</span></p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground mb-4">Sem pedidos pagos no período para calcular lucro por loja.</div>
                )}

                {tenantsLoading ? (
                  <div className="text-sm text-muted-foreground">Carregando lojas...</div>
                ) : tenants.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Nenhuma loja cadastrada.</div>
                ) : (
                  <div className="space-y-2">
                    {tenants.map((tenant) => (
                      <div key={tenant.id} className="rounded-xl border border-border bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-foreground">{tenant.name}</p>
                            <p className="text-xs text-muted-foreground">ID: {tenant.id} · Slug: {tenant.slug}</p>
                            <p className="text-xs text-muted-foreground">Domínio: {tenant.domain || "não definido"}</p>
                            <p className="text-xs text-muted-foreground break-all">Host alvo: {tenant.dnsTargetHost || "usando alvo global"}</p>
                            <p className="text-xs text-muted-foreground">Admin da loja: {tenant.adminUsername || "não vinculado"}</p>
                          </div>
                          <div className="text-xs flex items-center gap-2">
                            {tenant.domain ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setDnsDomainInput(tenant.domain || "");
                                  fetchDnsGuide(tenant.domain || "", tenant.id);
                                  checkDns(tenant.domain || "", tenant.id);
                                  setLojasSubTab("criar");
                                }}
                              >
                                Verificar DNS
                              </Button>
                            ) : null}
                            {tenant.id !== "tenant_loja1" ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="h-7 px-2 text-xs border-red-200 text-red-700 hover:bg-red-50"
                                onClick={() => deleteTenant(tenant)}
                                disabled={tenantDeletingId === tenant.id}
                              >
                                {tenantDeletingId === tenant.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5" />
                                )}
                                <span className="ml-1">Excluir</span>
                              </Button>
                            ) : null}
                            <span className={`px-2 py-1 rounded-full ${tenant.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-700"}`}>
                              {tenant.status}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-col md:flex-row gap-2">
                          <input
                            type="text"
                            value={tenantDnsTargetDrafts[tenant.id] ?? tenant.dnsTargetHost ?? ""}
                            onChange={(e) => setTenantDnsTargetDrafts((prev) => ({ ...prev, [tenant.id]: e.target.value }))}
                            placeholder="Host alvo DNS/Railway desta loja"
                            className="h-10 flex-1 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10"
                            onClick={() => saveTenantDnsTarget(tenant)}
                            disabled={tenantDnsTargetSavingId === tenant.id}
                          >
                            {tenantDnsTargetSavingId === tenant.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            <span className="ml-2">Salvar alvo</span>
                          </Button>
                        </div>
                        {tenant.id !== "tenant_loja1" ? (
                          <div className="mt-2 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                            <div className="rounded-xl border-2 border-border bg-white p-2 space-y-2">
                              <div className="flex items-center gap-2 rounded-lg border border-border px-3 h-10">
                                <span className="text-xs text-muted-foreground whitespace-nowrap">Margem repasse produtos Loja 1 (%)</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={tenantSupplyMarginDrafts[tenant.id] ?? String(tenant.supplyMarginPercent ?? 0)}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    const sanitized = raw.replace(/[^0-9.,]/g, "");
                                    setTenantSupplyMarginDrafts((prev) => ({ ...prev, [tenant.id]: sanitized }));
                                  }}
                                  placeholder="Ex: 15"
                                  className="w-full bg-white rounded-md border border-border px-2 py-1 outline-none focus:border-primary text-sm text-right"
                                />
                              </div>
                              <div className="flex items-center gap-2 rounded-lg border border-border px-3 h-10">
                                <span className="text-xs text-muted-foreground whitespace-nowrap">Margem repasse produtos em R$ Loja 1</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={tenantSupplyFixedMarginDrafts[tenant.id] ?? String(tenant.supplyMarginFixedBrl ?? 0)}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    const sanitized = raw.replace(/[^0-9.,]/g, "");
                                    setTenantSupplyFixedMarginDrafts((prev) => ({ ...prev, [tenant.id]: sanitized }));
                                  }}
                                  placeholder="Ex: 10"
                                  className="w-full bg-white rounded-md border border-border px-2 py-1 outline-none focus:border-primary text-sm text-right"
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                className="h-10"
                                onClick={() => saveTenantSupplyMargin(tenant)}
                                disabled={tenantSupplyMarginSavingId === tenant.id}
                              >
                                {tenantSupplyMarginSavingId === tenant.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                <span className="ml-2">Salvar margem</span>
                              </Button>
                            </div>
                          </div>
                        ) : null}
                        {tenant.id !== "tenant_loja1" ? (
                          <div className="mt-2 grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
                            <input
                              type="text"
                              value={tenantAdminUsernameDrafts[tenant.id] ?? tenant.adminUsername ?? ""}
                              onChange={(e) => setTenantAdminUsernameDrafts((prev) => ({ ...prev, [tenant.id]: e.target.value }))}
                              placeholder="Novo usuário admin da loja"
                              className="h-10 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                            />
                            <input
                              type="password"
                              value={tenantAdminPasswordDrafts[tenant.id] ?? ""}
                              onChange={(e) => setTenantAdminPasswordDrafts((prev) => ({ ...prev, [tenant.id]: e.target.value }))}
                              placeholder="Nova senha admin (mínimo 6)"
                              className="h-10 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              className="h-10"
                              onClick={() => saveTenantAdminCredentials(tenant)}
                              disabled={tenantAdminSavingId === tenant.id}
                            >
                              {tenantAdminSavingId === tenant.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                              <span className="ml-2">Salvar admin</span>
                            </Button>
                          </div>
                        ) : null}
                        {tenant.id !== "tenant_loja1" ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              className="h-10"
                              onClick={() => refreshTenantSyncedProducts(tenant)}
                              disabled={tenantProductSyncRefreshingId === tenant.id}
                            >
                              {tenantProductSyncRefreshingId === tenant.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                              <span className="ml-2">Atualizar produtos</span>
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-10 border-red-200 text-red-700 hover:bg-red-50"
                              onClick={() => clearTenantSyncedProducts(tenant)}
                              disabled={tenantProductSyncClearingId === tenant.id}
                            >
                              {tenantProductSyncClearingId === tenant.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                              <span className="ml-2">Deletar produtos sincronizados</span>
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : tab === "webhook" ? (
          <WebhookPanel
            webhookUrl={webhookUrl}
            copied={webhookCopied}
            onCopy={() => {
              navigator.clipboard.writeText(webhookUrl);
              setWebhookCopied(true);
              toast.success("URL copiada!");
              setTimeout(() => setWebhookCopied(false), 2000);
            }}
          />
        ) : tab === "configuracoes" ? (
          <div className="space-y-6">
            <div className="rounded-xl border bg-gradient-to-br from-rose-50 to-orange-50/60 border-rose-200 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
                <div>
                  <p className="text-xs font-semibold text-rose-700 uppercase tracking-wide">Gastos por data</p>
                  <p className="text-sm text-rose-700/80">Cadastre novas despesas de marketing aqui. Os registros antigos ficam intactos.</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-rose-700/70 uppercase tracking-wide">Total no período</p>
                  <p className="text-2xl font-bold text-rose-700">{formatCurrency(Number(financialSummary?.totalMarketingExpenses) || 0)}</p>
                </div>
              </div>

              <form onSubmit={handleAddMarketingExpense} className="grid grid-cols-1 sm:grid-cols-6 gap-3 mb-4">
                <input
                  type="date"
                  value={marketingExpenseForm.expenseStartDate}
                  onChange={(e) => setMarketingExpenseForm((current) => ({ ...current, expenseStartDate: e.target.value }))}
                  className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm cursor-pointer"
                />
                <input
                  type="date"
                  value={marketingExpenseForm.expenseEndDate}
                  onChange={(e) => setMarketingExpenseForm((current) => ({ ...current, expenseEndDate: e.target.value }))}
                  className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm cursor-pointer"
                />
                <input
                  type="text"
                  value={marketingExpenseForm.channel}
                  onChange={(e) => setMarketingExpenseForm((current) => ({ ...current, channel: e.target.value }))}
                  placeholder="Canal, ex: Facebook"
                  className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={marketingExpenseForm.amount}
                  onChange={(e) => setMarketingExpenseForm((current) => ({ ...current, amount: e.target.value }))}
                  placeholder="Valor"
                  className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                />
                <input
                  type="text"
                  value={marketingExpenseForm.note}
                  onChange={(e) => setMarketingExpenseForm((current) => ({ ...current, note: e.target.value }))}
                  placeholder="Observação opcional"
                  className="h-11 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                />
                <Button type="submit" disabled={marketingExpensesSubmitting} className="h-11 rounded-xl bg-rose-600 hover:bg-rose-700 text-white">
                  {marketingExpensesSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Adicionar gasto"}
                </Button>
              </form>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border border-rose-200 bg-white/80 p-4">
                  <p className="text-xs font-semibold text-rose-700 uppercase tracking-wide mb-3">Resumo por canal</p>
                  <div className="space-y-2">
                    {(financialSummary?.marketingExpensesByChannel?.length || 0) > 0 ? (
                      financialSummary!.marketingExpensesByChannel!.map((item) => (
                        <div key={item.channel} className="flex items-center justify-between rounded-lg border border-rose-100 bg-rose-50 px-3 py-2">
                          <span className="text-sm font-medium text-rose-900">{item.channel}</span>
                          <span className="text-sm font-semibold text-rose-700">{formatCurrency(Number(item.total) || 0)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-rose-700/80">Nenhum gasto registrado no período selecionado.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-rose-200 bg-white/80 p-4">
                  <p className="text-xs font-semibold text-rose-700 uppercase tracking-wide mb-3">Lançamentos recentes</p>
                  <div className="space-y-2 max-h-72 overflow-auto pr-1">
                    {(financialSummary?.marketingExpenses?.length || 0) > 0 ? (
                      financialSummary!.marketingExpenses!.map((item) => (
                        <div key={item.id} className="rounded-lg border border-rose-100 bg-white px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-rose-900">{item.channel}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatDateBR(item.expenseStartDate || item.expenseDate)} até {formatDateBR(item.expenseEndDate || item.expenseDate)}
                              </p>
                              {item.note ? <p className="text-xs text-rose-700/80 mt-1">{item.note}</p> : null}
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <span className="text-sm font-semibold text-rose-700 whitespace-nowrap">{formatCurrency(Number(item.amount) || 0)}</span>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 px-2 border-rose-200 text-rose-700 hover:bg-rose-50"
                                disabled={marketingExpenseDeletingId === item.id}
                                onClick={() => handleDeleteMarketingExpense(item.id)}
                              >
                                {marketingExpenseDeletingId === item.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5" />
                                )}
                                <span className="ml-1">Remover</span>
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-rose-700/80">Sem lançamentos para mostrar.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <ConfiguracoesPanel
              adminTenantId={adminTenantId}
              settings={settings}
              loading={settingsLoading}
              products={products}
              clientErrors={clientErrors}
              clientErrorsLoading={clientErrorsLoading}
              onRefreshClientErrors={fetchClientErrors}
              onTestOutboundWebhook={testOutboundWebhook}
              onSave={saveSetting}
              onDelete={deleteSetting}
              brevoApiKey={brevoApiKey}
              setBrevoApiKey={setBrevoApiKey}
              brevoConfigured={brevoConfigured}
              brevoTesting={brevoTesting}
              onTestBrevoConnection={testBrevoConnection}
            />
          </div>
        ) : null}

        {/* Raffle delete confirmation modal */}
        <AnimatePresence>
          {raffleDeleteConfirm && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4"
              onClick={(e) => { if (e.target === e.currentTarget && !raffleDeleting) { setRaffleDeleteConfirm(null); setRaffleDeleteInput(""); } }}>
              <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
                className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                    <Trash2 className="w-5 h-5 text-red-600" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground">Excluir rifa</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">Esta ação é permanente e não pode ser desfeita.</p>
                  </div>
                </div>

                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 space-y-1">
                  <p className="font-semibold">{raffleDeleteConfirm.title}</p>
                  <p>Todas as reservas vinculadas a esta rifa também serão excluídas permanentemente.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm text-muted-foreground">
                    Para confirmar, digite o nome exato da rifa abaixo:
                  </label>
                  <code className="block text-xs bg-muted rounded px-2 py-1 text-foreground font-mono break-all">
                    {raffleDeleteConfirm.title}
                  </code>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                    placeholder="Digite o nome da rifa..."
                    value={raffleDeleteInput}
                    onChange={(e) => setRaffleDeleteInput(e.target.value)}
                    disabled={raffleDeleting}
                    autoFocus
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={raffleDeleting}
                    onClick={() => { setRaffleDeleteConfirm(null); setRaffleDeleteInput(""); }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    disabled={raffleDeleteInput !== raffleDeleteConfirm.title || raffleDeleting}
                    onClick={async () => {
                      if (!raffleDeleteConfirm) return;
                      setRaffleDeleting(true);
                      try {
                        await fetch(`${BASE}/api/admin/raffles/${raffleDeleteConfirm.id}`, { method: "DELETE", headers: authHeaders() });
                        toast.success("Rifa excluída.");
                        setRaffleDeleteConfirm(null);
                        setRaffleDeleteInput("");
                        fetchRaffles();
                      } catch {
                        toast.error("Erro ao excluir.");
                      } finally {
                        setRaffleDeleting(false);
                      }
                    }}
                  >
                    {raffleDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
                    Excluir rifa
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Proof viewer modal */}
        <AnimatePresence>
          {proofViewer && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4"
              onClick={(e) => { if (e.target === e.currentTarget) setProofViewer(null); }}>
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b">
                  <h3 className="text-lg font-bold">Comprovante de Pagamento</h3>
                  <div className="flex gap-2">
                    <a href={proofViewer} download="comprovante" target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <Download className="w-4 h-4" />Download
                      </Button>
                    </a>
                    <Button size="icon" variant="ghost" onClick={() => setProofViewer(null)}><X className="w-5 h-5" /></Button>
                  </div>
                </div>
                <div className="p-4 flex items-center justify-center min-h-[400px] bg-muted/20">
                  {proofViewer.startsWith("data:application/pdf") || proofViewer.endsWith(".pdf") ? (
                    <iframe src={proofViewer} className="w-full h-[500px] rounded-xl border" title="Comprovante PDF" />
                  ) : (
                    <img src={proofViewer} alt="Comprovante" className="max-w-full max-h-[500px] rounded-xl object-contain shadow" />
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Proof upload modal */}
        <AnimatePresence>
          {proofModal && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
              onClick={(e) => { if (e.target === e.currentTarget) { setProofModal(null); setProofFile(null); } }}>
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md">
                <h3 className="text-xl font-bold mb-2">Adicionar Comprovante</h3>
                <p className="text-muted-foreground text-sm mb-6">Envie um comprovante de pagamento. Múltiplos comprovantes são suportados.</p>
                <label className={`flex flex-col items-center justify-center w-full h-40 rounded-2xl border-2 border-dashed cursor-pointer transition-colors ${proofFile ? "border-green-400 bg-green-50" : "border-border hover:border-primary bg-muted/30"}`}>
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleProofUpload} />
                  {proofFile ? (
                    <><CheckCircle className="w-10 h-10 text-green-500 mb-2" /><p className="text-sm font-semibold text-green-700">Arquivo selecionado</p><p className="text-xs text-muted-foreground">Clique para trocar</p></>
                  ) : (
                    <><Upload className="w-10 h-10 text-muted-foreground mb-2" /><p className="text-sm font-semibold">Clique para selecionar</p><p className="text-xs text-muted-foreground">Imagem ou PDF · máx. 5MB</p></>
                  )}
                </label>
                {proofFile && proofFile.startsWith("data:image") && (
                  <img src={proofFile} alt="Comprovante" className="mt-4 w-full rounded-xl object-contain max-h-40" />
                )}
                <div className="flex gap-3 mt-6">
                  <Button variant="outline" className="flex-1" onClick={() => { setProofModal(null); setProofFile(null); }}>Cancelar</Button>
                  <Button className="flex-1 gap-2" disabled={proofUploading || !proofFile} onClick={submitProof}>
                    {proofUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Salvar
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Edit Order Modal */}
        <AnimatePresence>
          {editOrderModal && (
            <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={(e) => { if (e.target === e.currentTarget) setEditOrderModal(null); }}>
              <motion.div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}>
                <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
                  <h3 className="text-lg font-bold">Editar Pedido #{editOrderModal.id}</h3>
                  <Button size="icon" variant="ghost" onClick={() => setEditOrderModal(null)}><X className="w-5 h-5" /></Button>
                </div>
                <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={editAsReshipment}
                        onChange={(e) => toggleEditAsReshipment(e.target.checked)}
                      />
                      <span className="text-sm text-amber-900 font-medium">Modo reenvio parcial (nao altera pedido original nem comissao)</span>
                    </label>
                    <p className="text-xs text-amber-800 mt-1">
                      Use quando parte do pedido ja foi enviada e voce quer reenviar so o que faltou, sem reduzir total/comissao do vendedor. Ao ativar este modo, a lista de produtos inicia vazia para voce adicionar apenas o que faltou.
                    </p>
                  </div>

                  {/* Product search */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Adicionar produto do catálogo</label>
                    {editCatalogLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Carregando...</div>
                    ) : (
                      <div className="relative">
                        <input value={editProductSearch} onChange={(e) => setEditProductSearch(e.target.value)}
                          placeholder="Digite o nome do produto..."
                          className="w-full h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm outline-none focus:border-primary" />
                        {editProductSearch.trim().length > 0 && (
                          <div className="absolute top-full left-0 right-0 z-10 bg-white border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto mt-1">
                            {editCatalog.filter((p) => p.name.toLowerCase().includes(editProductSearch.toLowerCase())).slice(0, 8).map((p) => (
                              <button key={p.id} className="w-full px-3 py-2 text-sm text-left hover:bg-muted/50 flex justify-between items-center"
                                onClick={() => {
                                  const exists = editItems.find((i) => i.id === p.id);
                                  if (exists) {
                                    const newQty = exists.quantity + 1;
                                    const newPrice = resolveEditItemPrice(p, newQty);
                                    setEditItems((prev) => prev.map((i) => i.id === p.id ? { ...i, quantity: newQty, price: newPrice } : i));
                                  } else {
                                    const newPrice = resolveEditItemPrice(p, 1);
                                    setEditItems((prev) => [...prev, { id: p.id, name: p.name, quantity: 1, price: newPrice }]);
                                  }
                                  setEditProductSearch("");
                                }}>
                                <span>{p.name}</span>
                                <span className="text-muted-foreground text-xs">{formatCurrency(p.promoPrice ?? p.price)}</span>
                              </button>
                            ))}
                            {editCatalog.filter((p) => p.name.toLowerCase().includes(editProductSearch.toLowerCase())).length === 0 && (
                              <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum produto encontrado</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Product list */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Produtos no pedido</label>
                    {editItems.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum produto. Adicione acima.</p>
                    ) : (
                      <div className="space-y-2">
                        {editItems.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30 border border-border/50">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{item.name}</p>
                              <p className="text-xs text-muted-foreground">{formatCurrency(item.price)} × {item.quantity} = {formatCurrency(item.price * item.quantity)}</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <button className="w-7 h-7 rounded-lg border border-border hover:bg-muted flex items-center justify-center text-base"
                                onClick={() => {
                                  if (item.quantity <= 1) return;
                                  const newQty = item.quantity - 1;
                                  const catalog = editCatalog.find((c) => c.id === item.id);
                                  const newPrice = catalog ? resolveEditItemPrice(catalog, newQty) : item.price;
                                  setEditItems((prev) => prev.map((i, j) => j === idx ? { ...i, quantity: newQty, price: newPrice } : i));
                                }}>−</button>
                              <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                              <button className="w-7 h-7 rounded-lg border border-border hover:bg-muted flex items-center justify-center text-base"
                                onClick={() => {
                                  const newQty = item.quantity + 1;
                                  const catalog = editCatalog.find((c) => c.id === item.id);
                                  const newPrice = catalog ? resolveEditItemPrice(catalog, newQty) : item.price;
                                  setEditItems((prev) => prev.map((i, j) => j === idx ? { ...i, quantity: newQty, price: newPrice } : i));
                                }}>+</button>
                              <button className="w-7 h-7 ml-1 rounded-lg hover:bg-red-50 text-red-500 flex items-center justify-center"
                                onClick={() => setEditItems((prev) => prev.filter((_, j) => j !== idx))}><X className="w-4 h-4" /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {!editAsReshipment && (
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Dados do cliente</label>
                    <input
                      value={editClientName}
                      onChange={(e) => setEditClientName(e.target.value)}
                      placeholder="Nome do cliente"
                      className="w-full h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  )}

                  {!editAsReshipment && (
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Endereço do cliente</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        value={editAddress.cep}
                        onChange={(e) => setEditAddress((prev) => ({ ...prev, cep: e.target.value }))}
                        placeholder="CEP"
                        className="h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm outline-none focus:border-primary"
                      />
                      <input
                        value={editAddress.state}
                        onChange={(e) => setEditAddress((prev) => ({ ...prev, state: e.target.value.toUpperCase() }))}
                        placeholder="UF"
                        className="h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm outline-none focus:border-primary"
                        maxLength={2}
                      />
                      <input
                        value={editAddress.street}
                        onChange={(e) => setEditAddress((prev) => ({ ...prev, street: e.target.value }))}
                        placeholder="Rua"
                        className="h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm outline-none focus:border-primary sm:col-span-2"
                      />
                      <input
                        value={editAddress.number}
                        onChange={(e) => setEditAddress((prev) => ({ ...prev, number: e.target.value }))}
                        placeholder="Número"
                        className="h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm outline-none focus:border-primary"
                      />
                      <input
                        value={editAddress.complement}
                        onChange={(e) => setEditAddress((prev) => ({ ...prev, complement: e.target.value }))}
                        placeholder="Complemento"
                        className="h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm outline-none focus:border-primary"
                      />
                      <input
                        value={editAddress.neighborhood}
                        onChange={(e) => setEditAddress((prev) => ({ ...prev, neighborhood: e.target.value }))}
                        placeholder="Bairro"
                        className="h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm outline-none focus:border-primary"
                      />
                      <input
                        value={editAddress.city}
                        onChange={(e) => setEditAddress((prev) => ({ ...prev, city: e.target.value }))}
                        placeholder="Cidade"
                        className="h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                  )}

                  {/* Coupon/Discount */}
                  {!editAsReshipment && (
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Cupom / Desconto</label>
                    <input
                      type="number"
                      value={editDiscount}
                      onChange={(e) => setEditDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
                      placeholder="Valor do desconto"
                      className="w-full h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  )}

                  {/* Totals preview */}
                  {!editAsReshipment && editItems.length > 0 && (() => {
                    const subtotal = editItems.reduce((s, p) => s + p.price * p.quantity, 0);
                    const insuranceAmount = editOrderModal.includeInsurance ? Math.max(0, subtotal) * 0.1 : 0;
                    const total = Math.max(0, subtotal + editOrderModal.shippingCost + insuranceAmount - (editDiscount || 0));
                    const hasPaidAmount = (editOrderModal.paidAmount ?? 0) > 0;
                    const refValue = hasPaidAmount ? (editOrderModal.paidAmount ?? 0) : editOrderModal.total;
                    const diff = total - refValue;
                    return (
                      <div className="p-3 rounded-lg bg-muted/40 border border-border/50 text-sm space-y-1">
                        <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Frete</span><span>{formatCurrency(editOrderModal.shippingCost)}</span></div>
                        {editOrderModal.includeInsurance && <div className="flex justify-between"><span className="text-muted-foreground">Seguro</span><span>{formatCurrency(insuranceAmount)}</span></div>}
                        {(editOrderModal.discountAmount || 0) > 0 && <div className="flex justify-between text-green-700"><span>Desconto</span><span>-{formatCurrency(editOrderModal.discountAmount!)}</span></div>}
                        <div className="flex justify-between font-bold border-t border-border/50 pt-1 mt-1"><span>Novo Total</span><span>{formatCurrency(total)}</span></div>
                        {hasPaidAmount && (
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Já pago</span><span>{formatCurrency(editOrderModal.paidAmount ?? 0)}</span>
                          </div>
                        )}
                        {Math.abs(diff) > 0.01 && (
                          <div className={`flex justify-between text-xs font-bold rounded px-1.5 py-0.5 mt-1 ${diff > 0 ? "text-orange-700 bg-orange-50" : "text-green-700 bg-green-50"}`}>
                            <span>{diff > 0 ? (hasPaidAmount ? "PIX de diferença" : "Acréscimo") : "Redução"}</span>
                            <span>{diff > 0 ? "+" : ""}{formatCurrency(diff)}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="flex gap-3 px-6 py-4 border-t shrink-0">
                  <Button variant="outline" className="flex-1" onClick={() => setEditOrderModal(null)}>Cancelar</Button>
                  <Button className="flex-1 gap-2" disabled={editSaving || editItems.length === 0} onClick={saveEditOrder}>
                    {editSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    {editAsReshipment ? "Lancar Reenvio" : "Salvar Edicao"}
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Diff PIX Modal */}
        <AnimatePresence>
          {diffOrder && (
            <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={(e) => { if (e.target === e.currentTarget) { setDiffOrder(null); setDiffPixResult(null); } }}>
              <motion.div className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}>
                <div className="flex items-center justify-between px-6 py-4 border-b">
                  <h3 className="text-lg font-bold">{diffOrder.isPaid ? "Cobrança de Diferença" : "Novo PIX — Valor Atualizado"}</h3>
                  <Button size="icon" variant="ghost" onClick={() => { setDiffOrder(null); setDiffPixResult(null); }}><X className="w-5 h-5" /></Button>
                </div>
                <div className="p-6 space-y-4">
                  {diffOrder.isPaid ? (
                    <div className="p-4 rounded-xl bg-orange-50 border border-orange-200 text-center">
                      <p className="text-sm text-orange-700 mb-1">Diferença a cobrar</p>
                      <p className="text-3xl font-bold text-orange-800">{formatCurrency(diffOrder.diff)}</p>
                      <p className="text-xs text-orange-600 mt-1">Pedido #{diffOrder.order.id} · {diffOrder.order.clientName}</p>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-center">
                      <p className="text-sm text-blue-700 mb-1">Novo total a cobrar via PIX</p>
                      <p className="text-3xl font-bold text-blue-800">{formatCurrency(diffOrder.diff)}</p>
                      <p className="text-xs text-blue-600 mt-1">Pedido #{diffOrder.order.id} · {diffOrder.order.clientName}</p>
                      <p className="text-xs text-blue-500 mt-1">O PIX anterior (valor antigo) deve ser desconsiderado</p>
                    </div>
                  )}
                  {!diffPixResult ? (
                    <Button className="w-full gap-2" disabled={diffPixLoading} onClick={createDiffPix}>
                      {diffPixLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>💸</span>}
                      {diffOrder.isPaid ? "Gerar PIX de Diferença" : "Gerar Novo PIX"}
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      {diffPixResult.pixBase64 && (
                        <div className="flex justify-center">
                          <img src={diffPixResult.pixBase64.startsWith("data:") ? diffPixResult.pixBase64 : `data:image/png;base64,${diffPixResult.pixBase64}`}
                            alt="QR Code PIX" className="w-48 h-48 rounded-xl border shadow" />
                        </div>
                      )}
                      <div className="p-3 rounded-lg bg-muted/40 border border-border">
                        <p className="text-xs text-muted-foreground mb-1">Código PIX Copia e Cola</p>
                        <p className="text-xs font-mono break-all text-foreground/80 line-clamp-3">{diffPixResult.pixCode}</p>
                      </div>
                      <Button className="w-full gap-2" variant={diffPixCopied ? "default" : "outline"} onClick={copyDiffPix}>
                        {diffPixCopied ? <><CheckCircle className="w-4 h-4" />Copiado!</> : <><Copy className="w-4 h-4" />Copiar Código PIX</>}
                      </Button>
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Card "Mark as Paid" modal */}
        <AnimatePresence>
          {/* KYC Modal */}
          {kycModal && (
            <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={(e) => { if (e.target === e.currentTarget) setKycModal(null); }}>
              <motion.div className="bg-white dark:bg-card rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}>
                <div className="bg-amber-600 p-5 text-white rounded-t-2xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="w-7 h-7 opacity-90" />
                    <div>
                      <h3 className="text-lg font-bold">KYC — Pedido #{kycModal}</h3>
                      <p className="text-white/80 text-xs">Verificação de identidade do cliente</p>
                    </div>
                  </div>
                  <button onClick={() => setKycModal(null)} className="p-1.5 rounded-lg hover:bg-white/20 transition">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-6 space-y-5">
                  {/* KYC Link */}
                  <div className="bg-muted/40 border border-border rounded-xl p-4 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Link KYC para o cliente</p>
                    <div className="flex gap-2 items-center">
                      <code className="text-xs bg-white border border-border px-2 py-1.5 rounded-lg flex-1 truncate">
                        {`${window.location.origin}${BASE}/kyc/${kycModal}`}
                      </code>
                      <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}${BASE}/kyc/${kycModal}`);
                        setKycLinkCopied(true);
                        toast.success("Link copiado!");
                        setTimeout(() => setKycLinkCopied(false), 2000);
                      }}>
                        {kycLinkCopied ? <CheckCircle className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                        {kycLinkCopied ? "Copiado!" : "Copiar"}
                      </Button>
                      <Button size="sm" variant="outline" className="shrink-0" onClick={() => window.open(`${window.location.origin}${BASE}/kyc/${kycModal}`, "_blank")}>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {kycLoading ? (
                    <div className="text-center py-8">
                      <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
                      <p className="text-sm text-muted-foreground mt-2">Carregando KYC...</p>
                    </div>
                  ) : !kycData ? (
                    <div className="text-center py-6 space-y-2">
                      <ShieldAlert className="w-10 h-10 text-amber-400 mx-auto" />
                      <p className="font-semibold text-sm">KYC ainda não enviado</p>
                      <p className="text-xs text-muted-foreground">O cliente ainda não completou o processo de verificação.</p>
                    </div>
                  ) : (
                    <>
                      {/* Status */}
                      {(() => {
                        const modalStatusMap: Record<string, { label: string; color: string; bgColor: string; Icon: typeof CheckCircle }> = {
                          approved: { label: "KYC Aprovado ✅",        color: "text-green-700",  bgColor: "bg-green-50 border-green-200",   Icon: CheckCircle },
                          rejected: { label: "KYC Negado ❌",          color: "text-red-700",    bgColor: "bg-red-50 border-red-200",       Icon: XCircle },
                          submitted: { label: "KYC Enviado — Aguardando revisão", color: "text-blue-700", bgColor: "bg-blue-50 border-blue-200", Icon: Clock },
                          pending:  { label: "KYC Pendente",           color: "text-amber-700",  bgColor: "bg-amber-50 border-amber-200",   Icon: ShieldAlert },
                        };
                        const ms = modalStatusMap[kycData.status] ?? modalStatusMap.pending;
                        return (
                          <div className={`flex items-center gap-3 p-3 rounded-xl border ${ms.bgColor}`}>
                            <ms.Icon className={`w-5 h-5 shrink-0 ${ms.color}`} />
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-semibold ${ms.color}`}>{ms.label}</p>
                              {kycData.submittedAt && <p className="text-xs text-muted-foreground">Enviado: {formatDateBR(kycData.submittedAt)}</p>}
                              {kycData.approvedAt && (
                                <p className="text-xs text-green-700 flex items-center gap-1.5 flex-wrap">
                                  Aprovado: {formatDateBR(kycData.approvedAt)}
                                  {kycData.approvedByUsername && (
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-800 border border-green-200">
                                      @{kycData.approvedByUsername}
                                    </span>
                                  )}
                                </p>
                              )}
                              {kycData.rejectedAt  && <p className="text-xs text-red-700">Negado: {formatDateBR(kycData.rejectedAt)}</p>}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Approve / Reject buttons in modal */}
                      {(kycData.status === "submitted" || kycData.status === "approved" || kycData.status === "rejected") && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => updateKycStatus(kycModal, "approve")}
                            disabled={kycStatusUpdating === kycModal || kycData.status === "approved"}
                            className={`flex-1 flex items-center justify-center gap-1.5 text-sm py-2.5 rounded-xl font-semibold transition-colors ${
                              kycData.status === "approved"
                                ? "bg-green-100 text-green-700 cursor-default"
                                : "bg-green-500 hover:bg-green-600 text-white"
                            }`}
                          >
                            {kycStatusUpdating === kycModal ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                            {kycData.status === "approved" ? "Aprovado" : "Aprovar KYC"}
                          </button>
                          <button
                            onClick={() => updateKycStatus(kycModal, "reject")}
                            disabled={kycStatusUpdating === kycModal || kycData.status === "rejected"}
                            className={`flex-1 flex items-center justify-center gap-1.5 text-sm py-2.5 rounded-xl font-semibold transition-colors ${
                              kycData.status === "rejected"
                                ? "bg-red-100 text-red-700 cursor-default"
                                : "bg-red-500 hover:bg-red-600 text-white"
                            }`}
                          >
                            {kycStatusUpdating === kycModal ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                            {kycData.status === "rejected" ? "Negado" : "Negar KYC"}
                          </button>
                        </div>
                      )}

                      {/* Documents */}
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Documentos</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 text-xs font-medium">
                              <IconLucide name="Camera" className="w-3.5 h-3.5 text-primary" />Selfie com RG
                            </div>
                            {kycData.selfieUrl ? (
                              <>
                                <img src={kycData.selfieUrl} alt="Selfie" className="w-full h-32 object-cover rounded-xl border border-border" />
                                <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs" onClick={() => downloadKycDoc(kycData.selfieUrl!, `selfie_${kycModal}.jpg`)}>
                                  <Download className="w-3 h-3" />Baixar
                                </Button>
                              </>
                            ) : (
                              <div className="w-full h-32 rounded-xl border-2 border-dashed border-border flex items-center justify-center text-xs text-muted-foreground">Não enviado</div>
                            )}
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 text-xs font-medium">
                              <IdCard className="w-3.5 h-3.5 text-primary" />Frente do RG
                            </div>
                            {kycData.rgFrontUrl ? (
                              <>
                                <img src={kycData.rgFrontUrl} alt="RG Frente" className="w-full h-32 object-cover rounded-xl border border-border" />
                                <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs" onClick={() => downloadKycDoc(kycData.rgFrontUrl!, `rg_frente_${kycModal}.jpg`)}>
                                  <Download className="w-3 h-3" />Baixar
                                </Button>
                              </>
                            ) : (
                              <div className="w-full h-32 rounded-xl border-2 border-dashed border-border flex items-center justify-center text-xs text-muted-foreground">Não enviado</div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Declaration signature */}
                      {kycData.declarationSignature && (
                        <div className="bg-muted/40 border border-border rounded-xl p-4 space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            <FileText className="w-3.5 h-3.5" />Declaração Assinada
                          </div>
                          <p className="font-serif italic text-base text-foreground">"{kycData.declarationSignature}"</p>
                          {kycData.declarationSignedAt && (
                            <p className="text-xs text-muted-foreground">{formatDateBR(kycData.declarationSignedAt)}</p>
                          )}
                          {(() => {
                            const kycOrder = orders.find((o) => o.id === kycModal);
                            return kycOrder ? (
                              <Button size="sm" variant="outline" className="gap-1.5 text-xs w-full mt-1" onClick={() => printKycDeclaration(kycOrder, kycData)}>
                                <Download className="w-3 h-3" />Baixar/Imprimir Declaração
                              </Button>
                            ) : null;
                          })()}
                        </div>
                      )}

                      {/* Admin declaration fields (primary only) */}
                      {isPrimary && (
                        <div className="border border-violet-200 bg-violet-50 rounded-xl p-4 space-y-3">
                          <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide">Campos adicionais da declaração (acesso total)</p>
                          <div className="space-y-2">
                            <div>
                              <label className="text-xs text-muted-foreground">Data e Hora da Compra</label>
                              <input
                                type="datetime-local"
                                className="w-full mt-0.5 h-9 px-3 rounded-lg border border-border bg-white text-sm outline-none focus:border-primary"
                                value={kycEditForm.declarationDate}
                                onChange={(e) => setKycEditForm((f) => ({ ...f, declarationDate: e.target.value }))} />
                              <p className="text-[10px] text-muted-foreground mt-0.5">Se preenchida, substitui a data automática na declaração impressa</p>
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground">Valor da Compra</label>
                              <input className="w-full mt-0.5 h-9 px-3 rounded-lg border border-border bg-white text-sm outline-none focus:border-primary"
                                placeholder="Ex: R$ 1.200,00"
                                value={kycEditForm.declarationPurchaseValue}
                                onChange={(e) => setKycEditForm((f) => ({ ...f, declarationPurchaseValue: e.target.value }))} />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground">Produto</label>
                              <input className="w-full mt-0.5 h-9 px-3 rounded-lg border border-border bg-white text-sm outline-none focus:border-primary"
                                placeholder="Nome do produto"
                                value={kycEditForm.declarationProduct}
                                onChange={(e) => setKycEditForm((f) => ({ ...f, declarationProduct: e.target.value }))} />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground">Nome da Empresa</label>
                              <input className="w-full mt-0.5 h-9 px-3 rounded-lg border border-border bg-white text-sm outline-none focus:border-primary"
                                placeholder="Razão social ou nome fantasia"
                                value={kycEditForm.declarationCompanyName}
                                onChange={(e) => setKycEditForm((f) => ({ ...f, declarationCompanyName: e.target.value }))} />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground">CNPJ</label>
                              <input className="w-full mt-0.5 h-9 px-3 rounded-lg border border-border bg-white text-sm outline-none focus:border-primary"
                                placeholder="00.000.000/0000-00"
                                value={kycEditForm.declarationCompanyCnpj}
                                onChange={(e) => setKycEditForm((f) => ({ ...f, declarationCompanyCnpj: e.target.value }))} />
                            </div>
                          </div>
                          <Button size="sm" className="w-full gap-1.5" onClick={saveKycEdit} disabled={kycEditSaving}>
                            {kycEditSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Salvar Campos da Declaração
                          </Button>
                          {kycData.adminEdited && (
                            <p className="text-xs text-violet-600 text-center">✅ Editado em {kycData.adminEditedAt ? formatDateBR(kycData.adminEditedAt) : "—"}</p>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  <Button variant="outline" className="w-full" onClick={() => setKycModal(null)}>Fechar</Button>
                </div>
              </motion.div>
            </motion.div>
          )}

          {cardPaidModal && (
            <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <motion.div className="bg-white dark:bg-card rounded-2xl shadow-2xl p-6 w-full max-w-sm"
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}>
                <h3 className="text-lg font-bold mb-1">Marcar como Pago (Cartão)</h3>
                <p className="text-sm text-muted-foreground mb-4">Informe os detalhes reais do pagamento.</p>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Parcelas reais</label>
                    <input type="number" min="1" max="24" placeholder="Ex: 3"
                      value={cardPaidForm.installments}
                      onChange={(e) => setCardPaidForm((f) => ({ ...f, installments: e.target.value }))}
                      className="w-full mt-1 h-10 px-3 rounded-lg border border-border bg-muted/30 text-sm outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Valor por parcela (R$)</label>
                    <input type="text" inputMode="decimal" placeholder="Ex: 150,00"
                      value={cardPaidForm.installmentValue}
                      onChange={(e) => setCardPaidForm((f) => ({ ...f, installmentValue: e.target.value }))}
                      className="w-full mt-1 h-10 px-3 rounded-lg border border-border bg-muted/30 text-sm outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total real cobrado (R$)</label>
                    <input type="text" inputMode="decimal" placeholder="Ex: 450,00"
                      value={cardPaidForm.totalValue}
                      onChange={(e) => setCardPaidForm((f) => ({ ...f, totalValue: e.target.value }))}
                      className="w-full mt-1 h-10 px-3 rounded-lg border border-border bg-muted/30 text-sm outline-none focus:border-primary" />
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <Button variant="outline" className="flex-1" onClick={() => setCardPaidModal(null)}>Cancelar</Button>
                  <Button className="flex-1 gap-2 bg-green-600 hover:bg-green-700 text-white border-none"
                    disabled={cardPaidSubmitting} onClick={submitCardPaid}>
                    {cardPaidSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    Confirmar
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AdminLayout>
  );
}

// ===========================================================================
// Sub-panels
// ===========================================================================

function SupportTicketsPanel({
  tickets,
  productsCatalog,
  loading,
  onRefresh,
  onSetStatus,
  onDelete,
  onReenviar,
}: {
  tickets: SupportTicketRecord[];
  productsCatalog: Array<{ id: string; name: string }>;
  loading: boolean;
  onRefresh: () => void;
  onSetStatus: (id: string, status: "open" | "resolved") => void;
  onDelete: (id: string) => void;
  onReenviar: (id: string, products?: Array<{ id: string; name: string; quantity: number }>) => Promise<void>;
}) {
  const [reenviarModalTicket, setReenviarModalTicket] = useState<SupportTicketRecord | null>(null);
  const [reenviarItems, setReenviarItems] = useState<Array<{ id: string; name: string; quantity: number }>>([]);
  const [reenviarSubmitting, setReenviarSubmitting] = useState(false);
  const [reenviarAddProductId, setReenviarAddProductId] = useState("");
  const [reenviarAddQty, setReenviarAddQty] = useState("1");

  const openReenviarModal = (ticket: SupportTicketRecord) => {
    const baseItems = (ticket.orderProducts || [])
      .map((item) => ({
        id: String(item.id || "").trim(),
        name: String(item.name || "Produto").trim() || "Produto",
        quantity: Math.max(1, Number(item.quantity) || 1),
      }))
      .filter((item) => item.id);

    setReenviarModalTicket(ticket);
    setReenviarItems(baseItems);
    setReenviarAddProductId("");
    setReenviarAddQty("1");
  };

  const addProductToReshipment = () => {
    const productId = String(reenviarAddProductId || "").trim();
    const quantity = Math.max(1, Number(reenviarAddQty) || 1);
    if (!productId) {
      toast.error("Selecione um produto para adicionar.");
      return;
    }
    const product = productsCatalog.find((item) => item.id === productId);
    if (!product) {
      toast.error("Produto selecionado não foi encontrado.");
      return;
    }

    setReenviarItems((prev) => {
      const index = prev.findIndex((item) => item.id === productId);
      if (index >= 0) {
        const next = [...prev];
        next[index] = { ...next[index], quantity: Math.max(1, next[index].quantity + quantity) };
        return next;
      }
      return [...prev, { id: product.id, name: product.name, quantity }];
    });
    setReenviarAddQty("1");
  };

  const submitReenviarModal = async () => {
    if (!reenviarModalTicket) return;
    const payload = reenviarItems
      .map((item) => ({
        id: String(item.id || "").trim(),
        name: String(item.name || "Produto").trim() || "Produto",
        quantity: Math.max(0, Number(item.quantity) || 0),
      }))
      .filter((item) => item.id && item.quantity > 0);

    if (payload.length === 0) {
      toast.error("Informe ao menos um produto com quantidade para o reenvio.");
      return;
    }

    setReenviarSubmitting(true);
    try {
      await onReenviar(reenviarModalTicket.id, payload);
      setReenviarModalTicket(null);
      setReenviarItems([]);
    } finally {
      setReenviarSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-4">
        <div>
          <p className="text-sm font-semibold">Chamados de Suporte</p>
          <p className="text-xs text-muted-foreground">Cliente escolhe o pedido especifico e reporta problema da entrega.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
          <p className="text-sm text-muted-foreground">Carregando chamados...</p>
        </div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-16 bg-muted/30 rounded-2xl border border-dashed">
          <MessageCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-semibold">Nenhum chamado encontrado</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <div key={ticket.id} className="rounded-2xl border bg-card p-4 sm:p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <div className="flex items-center flex-wrap gap-2">
                    <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">#{ticket.id}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${ticket.status === "resolved" ? "bg-green-100 text-green-800 border-green-200" : "bg-yellow-100 text-yellow-800 border-yellow-200"}`}>
                      {ticket.status === "resolved"
                        ? (ticket.resolutionReason === "reenvio_autorizado" ? "Resolvido · Reenvio" : "Resolvido")
                        : "Em aberto"}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDateBR(ticket.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold">{ticket.clientName}</p>
                  <p className="text-xs text-muted-foreground">CPF: {ticket.clientDocument} | Pedido: {ticket.orderId}</p>
                  {ticket.orderTotal != null && (
                    <p className="text-xs text-muted-foreground">Valor pedido: {formatCurrency(ticket.orderTotal)}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  {ticket.status !== "resolved" ? (
                    <>
                      <Button size="sm" onClick={() => onSetStatus(ticket.id, "resolved")}>Marcar resolvido</Button>
                      <Button size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => openReenviarModal(ticket)}>
                        Reenviar
                      </Button>
                      <Button size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => onDelete(ticket.id)}>
                        Excluir
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => onSetStatus(ticket.id, "open")}>Reabrir</Button>
                      <Button size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => onDelete(ticket.id)}>
                        Excluir
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm whitespace-pre-wrap">
                {ticket.description}
              </div>

              {ticket.addressChange && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                  <p className="text-xs font-semibold text-amber-800 mb-1">Solicitacao de novo endereco</p>
                  <p className="text-sm text-amber-900">
                    {ticket.addressChange.street}, {ticket.addressChange.number}
                    {ticket.addressChange.complement ? `, ${ticket.addressChange.complement}` : ""}
                  </p>
                  <p className="text-xs text-amber-800">
                    {ticket.addressChange.neighborhood} - {ticket.addressChange.city}/{ticket.addressChange.state} - CEP {ticket.addressChange.cep}
                  </p>
                </div>
              )}

              {ticket.imageUrl && (
                <div className="rounded-xl border border-border p-2 bg-white">
                  <img
                    src={ticket.imageUrl}
                    alt={`Comprovacao chamado ${ticket.id}`}
                    className="max-h-80 w-full object-contain rounded-lg"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {reenviarModalTicket && (
          <motion.div
            className="fixed inset-0 z-[140] bg-black/50 p-4 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              if (reenviarSubmitting) return;
              setReenviarModalTicket(null);
            }}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-2xl rounded-2xl border border-border bg-white p-4 sm:p-5 shadow-2xl space-y-4"
            >
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reenvio do chamado</p>
                <h3 className="text-lg font-bold">Pedido original: #{reenviarModalTicket.orderId}</h3>
                <p className="text-sm text-muted-foreground mt-1">Edite os itens que vão para o novo pedido de reenvio. O pedido original não será alterado.</p>
              </div>

              <div className="space-y-2 max-h-[45vh] overflow-auto pr-1">
                <div className="rounded-xl border border-border bg-muted/10 p-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Adicionar produto no reenvio</p>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                    <div className="sm:col-span-7">
                      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Produto</label>
                      <select
                        value={reenviarAddProductId}
                        onChange={(event) => setReenviarAddProductId(event.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-border bg-white text-sm outline-none focus:border-primary"
                      >
                        <option value="">Selecione...</option>
                        {productsCatalog.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-3">
                      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Quantidade</label>
                      <input
                        type="number"
                        min="1"
                        value={reenviarAddQty}
                        onChange={(event) => setReenviarAddQty(event.target.value)}
                        className="w-full h-9 px-3 rounded-lg border border-border bg-white text-sm outline-none focus:border-primary"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Button type="button" variant="outline" className="w-full" onClick={addProductToReshipment}>Adicionar</Button>
                    </div>
                  </div>
                </div>

                {reenviarItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
                    Nenhum item carregado do pedido. Feche e revise o pedido original.
                  </div>
                ) : (
                  reenviarItems.map((item, index) => (
                    <div key={`${item.id}-${index}`} className="rounded-xl border border-border bg-muted/20 p-3">
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                        <div className="sm:col-span-6">
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Produto</label>
                          <input
                            value={item.name}
                            onChange={(event) => {
                              const next = [...reenviarItems];
                              next[index] = { ...next[index], name: event.target.value };
                              setReenviarItems(next);
                            }}
                            className="w-full h-9 px-3 rounded-lg border border-border bg-white text-sm outline-none focus:border-primary"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Quantidade</label>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(event) => {
                              const next = [...reenviarItems];
                              next[index] = { ...next[index], quantity: Math.max(1, Number(event.target.value) || 1) };
                              setReenviarItems(next);
                            }}
                            className="w-full h-9 px-3 rounded-lg border border-border bg-white text-sm outline-none focus:border-primary"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full border-red-200 text-red-700 hover:bg-red-50"
                            onClick={() => setReenviarItems((prev) => prev.filter((_, i) => i !== index))}
                          >
                            Remover
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (reenviarSubmitting) return;
                    setReenviarModalTicket(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={() => { void submitReenviarModal(); }}
                  disabled={reenviarSubmitting}
                  className="gap-1.5"
                >
                  {reenviarSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Criar pedido de reenvio
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InventoryPanel({
  loading,
  products,
  balances,
  movements,
  pendingReshipments,
  entryForm,
  setEntryForm,
  submitting,
  manualForm,
  setManualForm,
  manualSubmitting,
  onRefresh,
  onCreateEntry,
  onCreateManualReshipment,
  onResolvePendingReshipment,
}: {
  loading: boolean;
  products: Array<{ id: string; name: string; image?: string | null }>;
  balances: InventoryBalanceRecord[];
  movements: InventoryMovementRecord[];
  pendingReshipments: ReshipmentRecord[];
  entryForm: {
    productId: string;
    quantity: string;
    reason: string;
    movementType: "entry" | "exit";
    entrySource: "purchase" | "customer_return";
    clientName: string;
    trackingCode: string;
  };
  setEntryForm: React.Dispatch<React.SetStateAction<{
    productId: string;
    quantity: string;
    reason: string;
    movementType: "entry" | "exit";
    entrySource: "purchase" | "customer_return";
    clientName: string;
    trackingCode: string;
  }>>;
  submitting: boolean;
  manualForm: {
    clientName: string;
    clientPhone: string;
    clientDocument: string;
    addressCep: string;
    addressStreet: string;
    addressNumber: string;
    addressComplement: string;
    addressNeighborhood: string;
    addressCity: string;
    addressState: string;
    productId: string;
    quantity: string;
    notes: string;
  };
  setManualForm: React.Dispatch<React.SetStateAction<{
    clientName: string;
    clientPhone: string;
    clientDocument: string;
    addressCep: string;
    addressStreet: string;
    addressNumber: string;
    addressComplement: string;
    addressNeighborhood: string;
    addressCity: string;
    addressState: string;
    productId: string;
    quantity: string;
    notes: string;
  }>>;
  manualSubmitting: boolean;
  onRefresh: () => void;
  onCreateEntry: () => void;
  onCreateManualReshipment: () => void;
  onResolvePendingReshipment: (item: ReshipmentRecord, registerStockEntry: boolean) => Promise<void>;
}) {
  const [entryProductQuery, setEntryProductQuery] = useState("");
  const [manualProductQuery, setManualProductQuery] = useState("");
  const [balanceSearch, setBalanceSearch] = useState("");
  const [reshipmentActionLoading, setReshipmentActionLoading] = useState<Record<string, boolean>>({});
  const [manualReturnDraft, setManualReturnDraft] = useState({
    clientName: "",
    returningOrder: "",
    productName: "",
    quantity: "1",
  });

  useEffect(() => {
    if (!entryForm.productId) {
      setEntryProductQuery("");
      return;
    }
    const selected = products.find((p) => p.id === entryForm.productId);
    if (selected) setEntryProductQuery(selected.name);
  }, [entryForm.productId, products]);

  useEffect(() => {
    if (!manualForm.productId) {
      setManualProductQuery("");
      return;
    }
    const selected = products.find((p) => p.id === manualForm.productId);
    if (selected) setManualProductQuery(selected.name);
  }, [manualForm.productId, products]);

  const applyEntryProductQuery = (rawValue: string) => {
    const value = rawValue.trim();
    setEntryProductQuery(rawValue);
    const selected = products.find((p) => p.name.trim().toLowerCase() === value.toLowerCase());
    setEntryForm((prev) => ({ ...prev, productId: selected?.id || "" }));
  };

  const applyManualProductQuery = (rawValue: string) => {
    const value = rawValue.trim();
    setManualProductQuery(rawValue);
    const selected = products.find((p) => p.name.trim().toLowerCase() === value.toLowerCase());
    setManualForm((prev) => ({ ...prev, productId: selected?.id || "" }));
  };

  const normalizedBalanceSearch = balanceSearch.trim().toLowerCase();
  const filteredBalances = normalizedBalanceSearch
    ? balances.filter((row) => {
        const productName = String(row.productName || "").toLowerCase();
        return productName.includes(normalizedBalanceSearch);
      })
    : balances;

  const onFillManualReturnEntry = () => {
    const clientName = String(manualReturnDraft.clientName || "").trim();
    const returningOrder = String(manualReturnDraft.returningOrder || "").trim();
    const productName = String(manualReturnDraft.productName || "").trim();
    const quantity = Number(manualReturnDraft.quantity || 0);

    if (!clientName || !returningOrder || !productName || !Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Preencha nome do cliente, pedido voltando, produto voltando e quantidade válida.");
      return;
    }

    const selected = products.find((p) => p.name.trim().toLowerCase() === productName.toLowerCase());
    if (!selected) {
      toast.error("Produto voltando inválido. Selecione um produto da lista.");
      return;
    }

    setEntryProductQuery(selected.name);
    setEntryForm((prev) => ({
      ...prev,
      movementType: "entry",
      entrySource: "customer_return",
      productId: selected.id,
      quantity: String(quantity),
      clientName,
      reason: `Pedido voltando: ${returningOrder}`,
    }));

    toast.success("Entrada manual preenchida. Clique em Dar Entrada para confirmar.");
  };

  const onAddManualReturnToQueue = async () => {
    const clientName = String(manualReturnDraft.clientName || "").trim();
    const returningOrder = String(manualReturnDraft.returningOrder || "").trim();
    const productName = String(manualReturnDraft.productName || "").trim();
    const quantity = Number(manualReturnDraft.quantity || 0);

    if (!clientName || !productName || !Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Preencha nome do cliente, produto e quantidade válida para adicionar na fila.");
      return;
    }

    const selected = products.find((p) => p.name.trim().toLowerCase() === productName.toLowerCase());
    if (!selected) {
      toast.error("Produto voltando inválido. Selecione um produto da lista.");
      return;
    }

    try {
      const res = await fetch(`${BASE}/api/admin/manual-return-items`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          clientName,
          returningOrder,
          productId: selected.id,
          productName: selected.name,
          quantity,
        }),
      });
      const data = await res.json().catch(() => ({})) as { message?: string };
      if (!res.ok) {
        toast.error(data?.message || "Erro ao adicionar retorno manual na fila.");
        return;
      }

      setManualReturnDraft((prev) => ({ ...prev, clientName: "", returningOrder: "", productName: "", quantity: "1" }));
      onRefresh();
      toast.success("Retorno manual adicionado na fila.");
    } catch {
      toast.error("Erro ao adicionar retorno manual na fila.");
    }
  };

  const copyPendingReturnsAsText = async () => {
    if (pendingReshipments.length === 0) {
      toast.error("Sem itens na fila manual para copiar.");
      return;
    }

    const body = pendingReshipments
      .map((item, index) => {
        const productsText = item.products
          .map((product) => `- ${product.quantity}x ${product.name}`)
          .join("\n");
        const returningOrder = String(item.notes || "").trim();

        return [
          `#${index + 1}`,
          `Cliente: ${item.clientName || "-"}`,
          returningOrder ? `Pedido voltando: ${returningOrder}` : "",
          "Produtos:",
          productsText || "- Sem produtos",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n------------------------------\n\n");

    const text = [
      `FILA MANUAL - PRODUTOS VOLTANDO (${new Date().toLocaleDateString("pt-BR")})`,
      "",
      body,
    ].join("\n");

    try {
      const mode = await copyText(text);
      toast.success(mode === "manual" ? "Texto aberto para cópia manual." : "Fila manual copiada para texto.");
    } catch {
      toast.error("Não foi possível copiar a fila manual.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Estoque e Reenvios</p>
            <p className="text-xs text-muted-foreground">Registre entrada ou saída de estoque. Entradas por compra ou devolução liberam reenvios automaticamente.</p>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />Atualizar
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-2">
          <select
            className="h-10 rounded-lg border border-border px-3 text-sm bg-white"
            value={entryForm.movementType}
            onChange={(e) => setEntryForm((prev) => ({ ...prev, movementType: e.target.value === "exit" ? "exit" : "entry" }))}
          >
            <option value="entry">Entrada</option>
            <option value="exit">Saída</option>
          </select>
          <div className="md:col-span-2">
            <input
              list="inventory-entry-products"
              className="h-10 w-full rounded-lg border border-border px-3 text-sm bg-white"
              placeholder="Pesquise e selecione o produto"
              value={entryProductQuery}
              onChange={(e) => applyEntryProductQuery(e.target.value)}
            />
            <datalist id="inventory-entry-products">
              {products.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </div>
          <input
            type="number"
            min={1}
            className="h-10 rounded-lg border border-border px-3 text-sm"
            placeholder="Quantidade"
            value={entryForm.quantity}
            onChange={(e) => setEntryForm((prev) => ({ ...prev, quantity: e.target.value }))}
          />
          <Button className="h-10" onClick={onCreateEntry} disabled={submitting}>
            {submitting ? "Salvando..." : entryForm.movementType === "exit" ? "Dar Saída" : "Dar Entrada"}
          </Button>
        </div>
        {entryForm.movementType === "entry" && (
          <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="md:col-span-3 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Para entrada de produto voltando, escolha <span className="font-semibold text-foreground">Produto voltando (cliente)</span> e então informe nome e telefone.
            </div>
            <select
              className="h-10 rounded-lg border border-border px-3 text-sm bg-white"
              value={entryForm.entrySource}
              onChange={(e) => setEntryForm((prev) => ({ ...prev, entrySource: e.target.value === "customer_return" ? "customer_return" : "purchase" }))}
            >
              <option value="purchase">Entrada por compra</option>
              <option value="customer_return">Produto voltando (cliente)</option>
            </select>
            {entryForm.entrySource === "customer_return" && (
              <>
                <input
                  className="h-10 rounded-lg border border-border px-3 text-sm"
                  placeholder="Nome do cliente (opcional)"
                  value={entryForm.clientName}
                  onChange={(e) => setEntryForm((prev) => ({ ...prev, clientName: e.target.value }))}
                />
                <input
                  className="h-10 rounded-lg border border-border px-3 text-sm"
                  placeholder="Telefone do cliente (opcional)"
                  value={entryForm.clientPhone}
                  onChange={(e) => setEntryForm((prev) => ({ ...prev, clientPhone: e.target.value }))}
                />
              </>
            )}
          </div>
        )}
        <input
          className="mt-2 h-10 rounded-lg border border-border px-3 text-sm w-full"
          placeholder="Motivo (opcional)"
          value={entryForm.reason}
          onChange={(e) => setEntryForm((prev) => ({ ...prev, reason: e.target.value }))}
        />
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Reenvio manual (sem compra no site)</p>
            <p className="text-xs text-muted-foreground">Cadastre cliente, endereço e produto para envio manual.</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
          <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Nome do cliente*" value={manualForm.clientName} onChange={(e) => setManualForm((prev) => ({ ...prev, clientName: e.target.value }))} />
          <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Telefone*" value={manualForm.clientPhone} onChange={(e) => setManualForm((prev) => ({ ...prev, clientPhone: e.target.value }))} />
          <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="CPF (opcional)" value={manualForm.clientDocument} onChange={(e) => setManualForm((prev) => ({ ...prev, clientDocument: e.target.value }))} />
          <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="CEP*" value={manualForm.addressCep} onChange={(e) => setManualForm((prev) => ({ ...prev, addressCep: e.target.value }))} />
          <input className="h-10 rounded-lg border border-border px-3 text-sm md:col-span-2" placeholder="Rua*" value={manualForm.addressStreet} onChange={(e) => setManualForm((prev) => ({ ...prev, addressStreet: e.target.value }))} />
          <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Numero*" value={manualForm.addressNumber} onChange={(e) => setManualForm((prev) => ({ ...prev, addressNumber: e.target.value }))} />
          <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Complemento (opcional)" value={manualForm.addressComplement} onChange={(e) => setManualForm((prev) => ({ ...prev, addressComplement: e.target.value }))} />
          <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Bairro*" value={manualForm.addressNeighborhood} onChange={(e) => setManualForm((prev) => ({ ...prev, addressNeighborhood: e.target.value }))} />
          <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Cidade*" value={manualForm.addressCity} onChange={(e) => setManualForm((prev) => ({ ...prev, addressCity: e.target.value }))} />
          <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="UF*" value={manualForm.addressState} onChange={(e) => setManualForm((prev) => ({ ...prev, addressState: e.target.value }))} />
          <div>
            <input
              list="inventory-manual-products"
              className="h-10 w-full rounded-lg border border-border px-3 text-sm bg-white"
              placeholder="Pesquise e selecione o produto*"
              value={manualProductQuery}
              onChange={(e) => applyManualProductQuery(e.target.value)}
            />
            <datalist id="inventory-manual-products">
              {products.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </div>
          <input
            type="number"
            min={1}
            className="h-10 rounded-lg border border-border px-3 text-sm"
            placeholder="Quantidade*"
            value={manualForm.quantity}
            onChange={(e) => setManualForm((prev) => ({ ...prev, quantity: e.target.value }))}
          />
        </div>
        <textarea
          className="mt-2 min-h-20 rounded-lg border border-border px-3 py-2 text-sm w-full"
          placeholder="Observacao (opcional)"
          value={manualForm.notes}
          onChange={(e) => setManualForm((prev) => ({ ...prev, notes: e.target.value }))}
        />
        <div className="mt-2 flex justify-end">
          <Button className="h-10" onClick={onCreateManualReshipment} disabled={manualSubmitting}>
            {manualSubmitting ? "Salvando..." : "Cadastrar Reenvio Manual"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-card p-4 flex flex-col h-full max-h-[560px] overflow-hidden">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-sm font-semibold">Saldo atual por produto</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {filteredBalances.length}/{balances.length}
              </span>
              <button
                type="button"
                title="Copiar estoque"
                onClick={() => {
                  const lines = balances
                    .filter((r) => r.quantity > 0)
                    .sort((a, b) => a.productName.localeCompare(b.productName, "pt-BR"))
                    .map((r) => `${r.quantity} un - ${r.productName}`);
                  const text = `📦 Estoque disponível (${new Date().toLocaleDateString("pt-BR")}):\n\n${lines.join("\n")}`;
                  navigator.clipboard.writeText(text).then(() => {
                    const btn = document.getElementById("copy-stock-btn");
                    if (btn) { btn.textContent = "✓ Copiado!"; setTimeout(() => { btn.textContent = "📋 Copiar estoque"; }, 2000); }
                  });
                }}
                id="copy-stock-btn"
                className="text-xs px-2 py-1 rounded-md border border-border bg-muted hover:bg-accent transition-colors font-medium"
              >
                📋 Copiar estoque
              </button>
            </div>
          </div>
          <input
            className="h-10 w-full rounded-lg border border-border px-3 text-sm mb-3"
            placeholder="Pesquisar produto por nome"
            value={balanceSearch}
            onChange={(e) => setBalanceSearch(e.target.value)}
          />
          <div className="flex-1 min-h-0">
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando estoque...</p>
            ) : balances.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum saldo registrado ainda.</p>
            ) : filteredBalances.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum produto encontrado para essa busca.</p>
            ) : (
              <div className="space-y-2 h-full overflow-auto pr-1">
                {filteredBalances.map((row) => {
                  const prod = products.find((p) => p.id === row.productId);
                  return (
                    <div key={row.productId} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {prod?.image ? (
                          <img src={prod.image} alt={row.productName} className="h-8 w-8 rounded-md object-cover shrink-0 border border-border" loading="lazy" />
                        ) : (
                          <div className="h-8 w-8 rounded-md bg-muted shrink-0 border border-border flex items-center justify-center">
                            <IconLucide name="Package" className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                        <span className="text-sm truncate">{row.productName}</span>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ${row.quantity > 0 ? "bg-green-100 text-green-800 border-green-200" : "bg-red-100 text-red-700 border-red-200"}`}>
                        {row.quantity} un
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 flex flex-col h-full max-h-[620px] overflow-hidden">
          <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50/60 p-3">
            <p className="text-sm font-semibold text-blue-900">Entrada manual de produto voltando</p>
            <p className="text-xs text-blue-800 mt-1">Digite manualmente e preencha a entrada acima com 1 clique.</p>
            <div className="mt-2 grid grid-cols-1 gap-2">
              <input
                className="h-9 rounded-lg border border-blue-200 px-3 text-sm bg-white"
                placeholder="Nome cliente"
                value={manualReturnDraft.clientName}
                onChange={(e) => setManualReturnDraft((prev) => ({ ...prev, clientName: e.target.value }))}
              />
              <input
                className="h-9 rounded-lg border border-blue-200 px-3 text-sm bg-white"
                placeholder="Pedido voltando"
                value={manualReturnDraft.returningOrder}
                onChange={(e) => setManualReturnDraft((prev) => ({ ...prev, returningOrder: e.target.value }))}
              />
              <input
                list="inventory-manual-return-products"
                className="h-9 rounded-lg border border-blue-200 px-3 text-sm bg-white"
                placeholder="Produto voltando"
                value={manualReturnDraft.productName}
                onChange={(e) => setManualReturnDraft((prev) => ({ ...prev, productName: e.target.value }))}
              />
              <input
                type="number"
                min={1}
                className="h-9 rounded-lg border border-blue-200 px-3 text-sm bg-white"
                placeholder="Quantidade"
                value={manualReturnDraft.quantity}
                onChange={(e) => setManualReturnDraft((prev) => ({ ...prev, quantity: e.target.value }))}
              />
              <datalist id="inventory-manual-return-products">
                {products.map((p) => (
                  <option key={`manual-return-${p.id}`} value={p.name} />
                ))}
              </datalist>
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="outline" className="h-8" onClick={onAddManualReturnToQueue}>
                Adicionar na fila
              </Button>
              <Button size="sm" className="h-8" onClick={onFillManualReturnEntry}>
                Preencher entrada manual
              </Button>
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Produtos voltando (fila manual)</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={copyPendingReturnsAsText}
            >
              Copiar TXT
            </Button>
          </div>
          <div className="flex-1 min-h-0">
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando fila manual...</p>
            ) : pendingReshipments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum produto voltando na fila manual.</p>
            ) : (
              <div className="space-y-2 min-h-[220px] sm:min-h-[250px] max-h-[300px] overflow-auto pr-1">
                {pendingReshipments.map((item) => (
                <div key={item.id} className="rounded-lg border border-red-200 bg-red-50/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-red-800 truncate">
                      {item.clientName}
                    </p>
                  </div>
                  {item.notes && (
                    <p className="text-xs text-red-700 mt-1">Pedido voltando: {item.notes}</p>
                  )}
                  <p className="text-xs text-red-700 mt-1">
                    {item.products.map((p) => `${p.quantity}x ${p.name}`).join(" · ")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="h-8"
                      disabled={!!reshipmentActionLoading[item.id]}
                      onClick={async () => {
                        setReshipmentActionLoading((prev) => ({ ...prev, [item.id]: true }));
                        try {
                          await onResolvePendingReshipment(item, true);
                        } finally {
                          setReshipmentActionLoading((prev) => ({ ...prev, [item.id]: false }));
                        }
                      }}
                    >
                      {reshipmentActionLoading[item.id] ? "Processando..." : "Produto chegou (dar entrada)"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={!!reshipmentActionLoading[item.id]}
                      onClick={async () => {
                        setReshipmentActionLoading((prev) => ({ ...prev, [item.id]: true }));
                        try {
                          await onResolvePendingReshipment(item, false);
                        } finally {
                          setReshipmentActionLoading((prev) => ({ ...prev, [item.id]: false }));
                        }
                      }}
                    >
                      {reshipmentActionLoading[item.id] ? "Processando..." : "Concluir (sem entrada)"}
                    </Button>
                  </div>
                </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold mb-3">Movimentações de estoque</p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando movimentações...</p>
        ) : movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem movimentações registradas.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-auto pr-1">
            {movements.map((mv) => (
              <div key={mv.id} className="flex items-start justify-between rounded-lg border border-border px-3 py-2 gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{mv.productName}</p>
                  <p className="text-xs text-muted-foreground">Motivo: {mv.reason || "Movimentação"} · {formatDateBR(mv.createdAt)}</p>
                  {(mv.clientName || mv.clientPhone || mv.trackingCode) && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {mv.clientName && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full border border-sky-200 bg-sky-50 text-sky-700">
                          Cliente: {mv.clientName}
                        </span>
                      )}
                      {mv.clientPhone && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                          Telefone: {mv.clientPhone}
                        </span>
                      )}
                      {mv.trackingCode && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700">
                          Rastreio: {mv.trackingCode}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${mv.quantity >= 0 ? "bg-green-100 text-green-800 border-green-200" : "bg-red-100 text-red-800 border-red-200"}`}>
                  {mv.quantity >= 0 ? "+" : ""}{mv.quantity}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OrdersPanel({
  allOrders,
  productImageById,
  productCostById,
  productNameById,
  inventoryBalances,
  getCommissionRate,
  gatewayFeePercent,
  gatewayFeeFixed,
  gatewayFeeMin,
  orders, statusUpdating, expandedOrder, setExpandedOrder,
  updateOrderStatus, setProofModal, setProofViewer, openWhatsApp,
  onOpenCardPaidModal, updateOrderObservation, isPrimary, onEditOrder, onOpenKycModal,
  onSetOrderEnviado, onSetOrderPatched, availableWhatsappGroups, onSetReshipmentStatus, onRemoveOrder,
}: {
  allOrders: AdminOrder[];
  productImageById: Record<string, string>;
  productCostById: Record<string, number>;
  productNameById: Record<string, string>;
  inventoryBalances: InventoryBalanceRecord[];
  getCommissionRate: (sellerCode?: string | null, snapshot?: number | null) => number;
  gatewayFeePercent: number;
  gatewayFeeFixed: number;
  gatewayFeeMin: number;
  orders: AdminOrder[];
  trackingCandidates: AdminOrder[];
  statusUpdating: string | null;
  expandedOrder: string | null;
  setExpandedOrder: (id: string | null) => void;
  updateOrderStatus: (
    id: string,
    status: string,
    cardActuals?: { cardInstallmentsActual?: number; cardInstallmentValue?: number; cardTotalActual?: number },
    opts?: { adminPassword?: string },
  ) => Promise<void>;
  setProofModal: (id: string) => void;
  setProofViewer: (url: string) => void;
  openWhatsApp: (order: AdminOrder) => void;
  onOpenCardPaidModal: (id: string) => void;
  updateOrderObservation: (id: string, observation: string) => void;
  isPrimary: boolean;
  onEditOrder: (order: AdminOrder) => void;
  onOpenKycModal: (orderId: string) => void;
  onSetOrderEnviado: (id: string, enviado: boolean) => void;
  onSetOrderPatched: (order: AdminOrder) => void;
  availableWhatsappGroups: string[];
  onSetReshipmentStatus: (reshipmentId: string, status: "reenvio_aguardando_estoque" | "reenvio_pronto_para_envio" | "reenvio_enviado") => void;
  onRemoveOrder: (id: string) => void;
}) {

  const normalizeIp = (ip?: string | null) => String(ip || "").trim().replace(/^::ffff:/, "") || "-";
  const ordersLookup = allOrders.length > 0 ? allOrders : orders;

  // Todos os hooks no topo
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);
  const [orderPriorities, setOrderPriorities] = useState<Record<string, boolean>>({});
  const [orderPriorityUpdating, setOrderPriorityUpdating] = useState<Record<string, boolean>>({});
  const [enviados, setEnviados] = useState<Record<string, boolean>>({});
  const [enviadoLockUntil, setEnviadoLockUntil] = useState<Record<string, number>>({});
  const [imagePreview, setImagePreview] = useState<{ src: string; name: string } | null>(null);
  const [trackingUploading, setTrackingUploading] = useState<Record<string, boolean>>({});
  const trackingInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [trackingReview, setTrackingReview] = useState<null | {
    order: AdminOrder;
    imageUrl: string;
    suggestedTrackingCode: string;
    detectedName: string;
    detectedAddress: string;
    detectedCep: string;
    ocrEnabled: boolean;
  }>(null);
  const [trackingDraftCode, setTrackingDraftCode] = useState("");
  const [trackingSaving, setTrackingSaving] = useState(false);
  const [trackingBatchFiles, setTrackingBatchFiles] = useState<File[]>([]);
  const [trackingBatchIndex, setTrackingBatchIndex] = useState(0);
  const [trackingBatchProcessing, setTrackingBatchProcessing] = useState(false);
  const [trackingSelectedOrderId, setTrackingSelectedOrderId] = useState<string | null>(null);
  const [trackingInventoryBalances, setTrackingInventoryBalances] = useState<InventoryBalanceRecord[] | null>(null);
  const [trackingInventoryLoading, setTrackingInventoryLoading] = useState(false);
  const [whatsappGroupDrafts, setWhatsappGroupDrafts] = useState<Record<string, string>>({});
  const [whatsappGroupUpdating, setWhatsappGroupUpdating] = useState<Record<string, boolean>>({});
  const trackingBatchInputRef = useRef<HTMLInputElement | null>(null);
  const trackingBatchWatchdogRef = useRef<number | null>(null);

  const withTimeout = async <T,>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
    let timeoutId: number | null = null;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error(message)), ms);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId != null) window.clearTimeout(timeoutId);
    }
  };

  const reshipmentStatusLabel = (status?: string) => {
    if (status === "reenvio_aguardando_estoque") return "Reenvio · Aguardando estoque";
    if (status === "reenvio_pronto_para_envio") return "Reenvio · Pronto para envio";
    if (status === "reenvio_resolvido_sem_entrada") return "Reenvio · Resolvido sem entrada";
    if (status === "reenvio_enviado") return "Reenvio · Enviado";
    return "Reenvio";
  };

  const orderAddressText = (order: AdminOrder) => {
    const cityState = [order.addressCity || "", order.addressState || ""].filter(Boolean).join("/");
    return [
      order.addressStreet,
      order.addressNumber,
      order.addressComplement,
      order.addressNeighborhood,
      cityState,
      order.addressCep ? `CEP ${order.addressCep}` : "",
    ].filter(Boolean).join(", ") || "Endereço não informado";
  };

  // Inicializa enviados com base nos pedidos carregados
  useEffect(() => {
    const now = Date.now();
    setEnviados((prev) => {
      const map: Record<string, boolean> = {};
      for (const order of ordersLookup) {
        const lockUntil = Number(enviadoLockUntil[order.id] || 0);
        if (lockUntil > now && Object.prototype.hasOwnProperty.call(prev, order.id)) {
          map[order.id] = !!prev[order.id];
        } else {
          map[order.id] = !!order.enviado;
        }
      }
      return map;
    });
  }, [ordersLookup, enviadoLockUntil]);

  useEffect(() => {
    const map: Record<string, boolean> = {};
    for (const order of ordersLookup) {
      map[order.id] = !!(order as any).isPrioridade;
    }
    setOrderPriorities(map);
  }, [ordersLookup]);

  useEffect(() => {
    const map: Record<string, string> = {};
    for (const order of ordersLookup) {
      const current = String((order as { whatsappGroup?: string | null }).whatsappGroup || "").trim();
      map[order.id] = current || "__none";
    }
    setWhatsappGroupDrafts(map);
  }, [ordersLookup]);

  useEffect(() => {
    if (!imagePreview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImagePreview(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [imagePreview]);

  useEffect(() => {
    if (!trackingReview) {
      setTrackingInventoryBalances(null);
      setTrackingInventoryLoading(false);
      return;
    }

    let cancelled = false;
    const loadTrackingInventory = async () => {
      setTrackingInventoryLoading(true);
      try {
        const res = await fetch(`${BASE}/api/admin/inventory/overview`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({})) as { balances?: InventoryBalanceRecord[] };
        if (cancelled) return;
        setTrackingInventoryBalances(Array.isArray(data?.balances) ? data.balances : []);
      } catch {
        if (!cancelled) setTrackingInventoryBalances([]);
      } finally {
        if (!cancelled) setTrackingInventoryLoading(false);
      }
    };

    void loadTrackingInventory();
    return () => {
      cancelled = true;
    };
  }, [trackingReview]);

  // Funções SEM hooks

  const saveOrderWhatsappGroup = async (order: AdminOrder) => {
    const id = String(order.id || "").trim();
    if (!id) return;
    const draft = whatsappGroupDrafts[id] || "__none";
    const whatsappGroup = draft === "__none" ? null : draft;

    setWhatsappGroupUpdating((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`${BASE}/api/admin/orders/${encodeURIComponent(id)}/whatsapp-group`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ whatsappGroup }),
      });

      const data = await res.json().catch(() => ({})) as { message?: string; order?: AdminOrder };
      if (!res.ok) {
        toast.error(data?.message || "Erro ao salvar grupo do pedido.");
        return;
      }

      if (data?.order) onSetOrderPatched(data.order);
      toast.success("Grupo do pedido atualizado.");
    } catch {
      toast.error("Erro ao salvar grupo do pedido.");
    } finally {
      setWhatsappGroupUpdating((prev) => ({ ...prev, [id]: false }));
    }
  };

  const resolveOrderPriority = (order: AdminOrder): boolean => {
    const id = String(order.id || "").trim();
    if (!id) return !!(order as any).isPrioridade;
    return Object.prototype.hasOwnProperty.call(orderPriorities, id)
      ? !!orderPriorities[id]
      : !!(order as any).isPrioridade;
  };

  const copyOrder = async (order: AdminOrder) => {
    try {
      const mode = await copyText(orderToText({ ...order, isPrioridade: resolveOrderPriority(order) }));
      setCopiedOrderId(order.id);
      if (mode === "auto") {
        toast.success("Resumo copiado!");
      } else {
        toast.info("Abra o prompt e copie manualmente.");
      }
      setTimeout(() => setCopiedOrderId(null), 2500);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  // Nova função: copiar resumo completo
  const copyOrderFull = async (order: AdminOrder) => {
    try {
      const mode = await copyText(orderToFullText({ ...order, isPrioridade: resolveOrderPriority(order) }));
      setCopiedOrderId(order.id + "-full");
      if (mode === "auto") {
        toast.success("Resumo completo copiado!");
      } else {
        toast.info("Abra o prompt e copie manualmente.");
      }
      setTimeout(() => setCopiedOrderId(null), 2500);
    } catch {
      toast.error("Não foi possível copiar o resumo completo.");
    }
  };

  const copyOrderPostPayment = async (order: AdminOrder) => {
    try {
      const mode = await copyText(orderToPostPaymentText({ ...order, isPrioridade: resolveOrderPriority(order) }));
      setCopiedOrderId(order.id + "-post-paid");
      if (mode === "auto") {
        toast.success("Pós-pagamento copiado!");
      } else {
        toast.info("Abra o prompt e copie manualmente.");
      }
      setTimeout(() => setCopiedOrderId(null), 2500);
    } catch {
      toast.error("Não foi possível copiar a mensagem de pós-pagamento.");
    }
  };

  const toggleOrderPriority = async (order: AdminOrder) => {
    const id = String(order.id || "").trim();
    if (!id) return;

    const current = resolveOrderPriority(order);
    const next = !current;

    setOrderPriorityUpdating((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`${BASE}/api/admin/orders/${id}/prioridade`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ isPrioridade: next }),
      });

      const data = await res.json().catch(() => ({})) as {
        message?: string;
        order?: AdminOrder;
      };

      if (!res.ok) {
        if (res.status === 404 || res.status === 503) {
          setOrderPriorities((prev) => ({ ...prev, [id]: next }));
          toast.warning("Prioridade salva apenas localmente (migração pendente no servidor).");
          return;
        }
        throw new Error(data?.message || "Erro ao atualizar prioridade.");
      }

      setOrderPriorities((prev) => ({
        ...prev,
        [id]: !!(data.order as any)?.isPrioridade,
      }));

      if (data.order) onSetOrderPatched(data.order);
      toast.success(next ? "Pedido marcado como prioridade." : "Prioridade removida do pedido.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao atualizar prioridade.";
      toast.error(message);
    } finally {
      setOrderPriorityUpdating((prev) => ({ ...prev, [id]: false }));
    }
  };

  const downloadOrder = (order: AdminOrder) => {
    try {
      const normalizedProducts = getOrderProducts(order.products).map((p) => ({
        name: p.name,
        quantity: Number(p.quantity) || 0,
        price: Number(p.price) || 0,
      }));
      generateOrderPdf({ ...order, products: normalizedProducts });
    } catch {
      toast.error("Não foi possível baixar o pedido.");
    }
  };

  const [enviando, setEnviando] = useState<Record<string, boolean>>({});
  const [adminPasswordModalOpen, setAdminPasswordModalOpen] = useState(false);
  const [adminPasswordModalTitle, setAdminPasswordModalTitle] = useState("Confirmar ação sensível");
  const [adminPasswordModalDescription, setAdminPasswordModalDescription] = useState("");
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [adminPasswordVisible, setAdminPasswordVisible] = useState(false);
  const [adminPasswordSubmitting, setAdminPasswordSubmitting] = useState(false);
  const adminPasswordActionRef = useRef<((password: string) => Promise<void>) | null>(null);

  const closeAdminPasswordModal = () => {
    if (adminPasswordSubmitting) return;
    setAdminPasswordModalOpen(false);
    setAdminPasswordInput("");
    setAdminPasswordVisible(false);
    adminPasswordActionRef.current = null;
  };

  const openAdminPasswordModal = (title: string, description: string, onConfirm: (password: string) => Promise<void>) => {
    setAdminPasswordModalTitle(title);
    setAdminPasswordModalDescription(description);
    setAdminPasswordInput("");
    setAdminPasswordVisible(false);
    adminPasswordActionRef.current = onConfirm;
    setAdminPasswordModalOpen(true);
  };

  const submitAdminPasswordModal = async () => {
    const password = adminPasswordInput.trim();
    if (!password) {
      toast.error("Senha do admin é obrigatória para esta ação.");
      return;
    }
    const action = adminPasswordActionRef.current;
    if (!action) {
      closeAdminPasswordModal();
      return;
    }
    setAdminPasswordSubmitting(true);
    try {
      await action(password);
      closeAdminPasswordModal();
    } finally {
      setAdminPasswordSubmitting(false);
    }
  };
  const verifyOrderStock = (orderId: string, balancesSnapshot: InventoryBalanceRecord[] = inventoryBalances): { hasStock: boolean; message: string; missingItems: string[] } => {
    // Only check stock when marking as enviado (novoValor = true)
    const order = ordersLookup.find(o => o.id === orderId);
    if (!order) {
      return { hasStock: false, message: "Pedido não encontrado", missingItems: [] };
    }

    // If currently marked as enviado and trying to unmark (revert to pendente), skip stock check
    if (enviados[orderId]) {
      return { hasStock: true, message: "", missingItems: [] };
    }

    // Avoid false negatives while inventory snapshot is still loading.
    if (balancesSnapshot.length === 0) {
      return { hasStock: true, message: "", missingItems: [] };
    }

    const normalizeStockName = (value: string) => value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const compactStockName = (value: string) => normalizeStockName(value).replace(/\s+/g, "");

    const stockNameMatches = (left: string, right: string) => {
      const normalizedLeft = normalizeStockName(left);
      const normalizedRight = normalizeStockName(right);
      if (!normalizedLeft || !normalizedRight) return false;
      if (normalizedLeft === normalizedRight) return true;

      const compactLeft = compactStockName(left);
      const compactRight = compactStockName(right);
      if (compactLeft && compactRight && (compactLeft.includes(compactRight) || compactRight.includes(compactLeft))) return true;

      const leftTokens = new Set(normalizedLeft.split(" ").filter(Boolean));
      const rightTokens = new Set(normalizedRight.split(" ").filter(Boolean));
      if (leftTokens.size === 0 || rightTokens.size === 0) return false;

      let overlap = 0;
      for (const token of leftTokens) {
        if (rightTokens.has(token)) overlap += 1;
      }

      const smallestSetSize = Math.min(leftTokens.size, rightTokens.size);
      return overlap >= 2 && overlap >= Math.ceil(smallestSetSize * 0.6);
    };

    // Build stock maps from inventory balances
    const stockById = new Map<string, number>();
    for (const row of balancesSnapshot) {
      const key = String(row.productId || "").trim();
      if (!key) continue;
      const quantity = Number(row.quantity || 0);
      const current = stockById.get(key);
      stockById.set(key, typeof current === "number" ? current + quantity : quantity);
    }
    const stockByName = new Map<string, number>();
    for (const row of balancesSnapshot) {
      const normalized = normalizeStockName(String(row.productName || ""));
      if (!normalized) continue;
      const quantity = Number(row.quantity || 0);
      const current = stockByName.get(normalized);
      stockByName.set(normalized, typeof current === "number" ? current + quantity : quantity);
    }

    // Group order items by product identity, preventing duplicate-line mismatch.
    const products = getOrderProducts(order.products);
    const totals = new Map<string, { label: string; qty: number; productId: string | null }>();
    for (const product of products) {
      const productQty = Number(product.quantity || 0);
      if (productQty <= 0) continue;
      const idFromLine = String((product as { id?: string }).id || "").trim();
      const altIdFromLine = String((product as { productId?: string }).productId || "").trim();
      const productId = idFromLine || altIdFromLine || null;
      const label = String(product.name || "Produto").trim() || "Produto";
      const key = productId ? `id:${productId}` : `name:${normalizeStockName(label)}`;
      const prev = totals.get(key);
      totals.set(key, {
        label: prev?.label || label,
        qty: (prev?.qty || 0) + productQty,
        productId,
      });
    }

    const missingItems: string[] = [];

    for (const item of totals.values()) {
      const normalizedLabel = normalizeStockName(item.label);
      const fallbackCatalogName = item.productId ? normalizeStockName(String(productNameById[item.productId] || "")) : "";

      // Consider every possible match source and keep the highest stock found.
      // This avoids false negatives when an old product ID has zero but the same product name has stock.
      const candidates: number[] = [];
      if (item.productId) {
        const byId = stockById.get(item.productId);
        if (typeof byId === "number" && Number.isFinite(byId)) candidates.push(byId);
      }
      if (fallbackCatalogName) {
        const byCatalogName = stockByName.get(fallbackCatalogName);
        if (typeof byCatalogName === "number" && Number.isFinite(byCatalogName)) candidates.push(byCatalogName);
      }
      if (normalizedLabel) {
        const byLineName = stockByName.get(normalizedLabel);
        if (typeof byLineName === "number" && Number.isFinite(byLineName)) candidates.push(byLineName);
      }
      for (const [stockName, stockQty] of stockByName.entries()) {
        if (stockNameMatches(normalizedLabel, stockName) || (fallbackCatalogName && stockNameMatches(fallbackCatalogName, stockName))) {
          candidates.push(stockQty);
        }
      }
      const availableQty = candidates.length > 0 ? Math.max(...candidates) : 0;

      if (availableQty < item.qty) {
        missingItems.push(
          `${item.label}: faltam ${item.qty - availableQty} un. (tem ${availableQty}, precisa ${item.qty})`
        );
      }
    }

    if (missingItems.length > 0) {
      return {
        hasStock: false,
        message: `Faltando estoque dos produtos do cliente:\n${missingItems.join("\n")}`,
        missingItems,
      };
    }

    return { hasStock: true, message: "", missingItems: [] };
  };

  const executeToggleEnviado = async (orderId: string, adminPassword?: string) => {
    const novoValor = !enviados[orderId];
    if (!orderId || typeof orderId !== "string" || orderId.length === 0) {
      toast.error("ID do pedido inválido!");
      return;
    }

    // Verify stock before marking as enviado
    if (novoValor) {
      // Only check stock when marking as enviado (not when unmarking)
      const stockCheck = verifyOrderStock(orderId, trackingInventoryBalances ?? inventoryBalances);
      if (!stockCheck.hasStock) {
        toast.error(stockCheck.message);
        return;
      }
    }

    setEnviando(prev => ({ ...prev, [orderId]: true }));
    try {
      const res = await fetch(`${BASE}/api/admin/orders/${orderId}/enviado`, {
        method: "PATCH",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enviado: novoValor, ...(adminPassword ? { adminPassword } : {}) }),
      });
      if (res.status === 404) {
        toast.error("Pedido não encontrado no banco de dados!");
        onRemoveOrder(orderId);
        setEnviando(prev => ({ ...prev, [orderId]: false }));
        return;
      }
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        throw new Error(data?.message || "Erro ao atualizar status de envio");
      }
      const data = await res.json().catch(() => ({})) as { enviado?: boolean };
      const confirmado = typeof data?.enviado === "boolean" ? data.enviado : novoValor;
      onSetOrderEnviado(orderId, confirmado);
      setEnviados(prev => ({ ...prev, [orderId]: confirmado }));

      // Keep local state briefly to avoid UI flip from stale background refreshes.
      setEnviadoLockUntil((prev) => ({ ...prev, [orderId]: Date.now() + 15000 }));

      toast.success(confirmado ? "Pedido marcado como enviado!" : "Pedido marcado como pendente!");
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "Erro ao atualizar status de envio!";
      toast.error(message);
    } finally {
      setEnviando(prev => ({ ...prev, [orderId]: false }));
    }
  };

  const toggleEnviado = async (orderId: string) => {
    const novoValor = !enviados[orderId];
    if (!novoValor && enviados[orderId]) {
      openAdminPasswordModal(
        "Confirmar desmarcar envio",
        "Para desfazer o status de enviado, confirme sua senha de admin.",
        async (password) => {
          await executeToggleEnviado(orderId, password);
        },
      );
      return;
    }
    await executeToggleEnviado(orderId);
  };

  const fileToDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Leitura da imagem excedeu o tempo limite."));
    }, 15000);

    reader.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      const result = String(reader.result || "");
      if (!result.startsWith("data:image/")) {
        reject(new Error("Formato de imagem inválido."));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(new Error("Falha ao ler imagem."));
    };
    reader.readAsDataURL(file);
  });

  const compressImageDataUrl = (source: string): Promise<string> => new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(source);
    }, 8000);

    img.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      const max = 1800;
      const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((img.width || 1) * scale));
      canvas.height = Math.max(1, Math.round((img.height || 1) * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(source);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(source);
    };
    img.src = source;
  });

  const pickBestTrackingCode = (values: string[]): string => {
    const normalized = values
      .map((value) => String(value || "").toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9-]/g, "").trim())
      .filter(Boolean);

    return normalized.find((value) => /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(value))
      || normalized.find((value) => /^BR[0-9A-Z]{8,24}$/.test(value))
      || normalized.find((value) => /^[A-Z0-9-]{8,30}$/.test(value) && /\d/.test(value))
      || "";
  };

  const createImageFromDataUrl = (dataUrl: string): Promise<HTMLImageElement | null> =>
    new Promise((resolve) => {
      const temp = new Image();
      temp.onload = () => resolve(temp);
      temp.onerror = () => resolve(null);
      temp.src = dataUrl;
    });

  const cropToCanvas = (img: HTMLImageElement, crop: { x: number; y: number; w: number; h: number }): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(crop.w));
    canvas.height = Math.max(1, Math.round(crop.h));
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
    return canvas;
  };

  const applyHighContrast = (source: HTMLCanvasElement): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return source;

    ctx.drawImage(source, 0, 0);
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = frame.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const gray = Math.round((pixels[i] * 0.299) + (pixels[i + 1] * 0.587) + (pixels[i + 2] * 0.114));
      const bw = gray > 145 ? 255 : 0;
      pixels[i] = bw;
      pixels[i + 1] = bw;
      pixels[i + 2] = bw;
    }
    ctx.putImageData(frame, 0, 0);
    return canvas;
  };

  const buildBarcodeSources = (img: HTMLImageElement): Array<HTMLImageElement | HTMLCanvasElement> => {
    const w = img.width || 1;
    const h = img.height || 1;

    const full = cropToCanvas(img, { x: 0, y: 0, w, h });
    const lowerHalf = cropToCanvas(img, { x: 0, y: h * 0.45, w, h: h * 0.55 });
    const lowerThird = cropToCanvas(img, { x: 0, y: h * 0.58, w, h: h * 0.42 });
    const barcodeBand = cropToCanvas(img, { x: w * 0.05, y: h * 0.60, w: w * 0.90, h: h * 0.18 });
    const barcodeBandWide = cropToCanvas(img, { x: w * 0.03, y: h * 0.52, w: w * 0.94, h: h * 0.28 });
    const midBand = cropToCanvas(img, { x: w * 0.05, y: h * 0.24, w: w * 0.9, h: h * 0.30 });

    const rotateCanvas = (source: HTMLCanvasElement, degrees: 90 | 180 | 270): HTMLCanvasElement => {
      const rotated = document.createElement("canvas");
      const ctx = rotated.getContext("2d");
      if (!ctx) return source;

      if (degrees === 180) {
        rotated.width = source.width;
        rotated.height = source.height;
        ctx.translate(rotated.width, rotated.height);
        ctx.rotate(Math.PI);
      } else {
        rotated.width = source.height;
        rotated.height = source.width;
        if (degrees === 90) {
          ctx.translate(rotated.width, 0);
          ctx.rotate(Math.PI / 2);
        } else {
          ctx.translate(0, rotated.height);
          ctx.rotate(-Math.PI / 2);
        }
      }

      ctx.drawImage(source, 0, 0);
      return rotated;
    };

    const barcodeBandVariants = [
      barcodeBand,
      barcodeBandWide,
      applyHighContrast(barcodeBand),
      applyHighContrast(barcodeBandWide),
    ];

    const rotatedBarcodeBandVariants = barcodeBandVariants.flatMap((source) => [
      source,
      rotateCanvas(source, 90),
      rotateCanvas(source, 180),
      rotateCanvas(source, 270),
    ]);

    return [
      img,
      full,
      applyHighContrast(full),
      lowerHalf,
      applyHighContrast(lowerHalf),
      lowerThird,
      applyHighContrast(lowerThird),
      ...rotatedBarcodeBandVariants,
      midBand,
      applyHighContrast(midBand),
    ];
  };

  const detectTrackingByBarcode = async (imageData: string): Promise<string> => {
    const img = await createImageFromDataUrl(imageData);

    if (!img) return "";

    const decodeSources = buildBarcodeSources(img);

    try {
      const BarcodeDetectorCtor = (window as any)?.BarcodeDetector;
      if (BarcodeDetectorCtor) {
        const detector = new BarcodeDetectorCtor({
          formats: ["code_128", "code_39", "itf", "ean_13", "ean_8", "qr_code", "data_matrix", "pdf417", "codabar"],
        });
        for (const source of decodeSources) {
          const detections = await detector.detect(source as any);
          const rawValues = detections.map((item: any) => String(item?.rawValue || ""));
          const bestNative = pickBestTrackingCode(rawValues);
          if (bestNative) return bestNative;
        }
      }
    } catch {
      // ignore native detector failures and try ZXing fallback
    }

    try {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.ITF,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.CODABAR,
        BarcodeFormat.PDF_417,
        BarcodeFormat.QR_CODE,
        BarcodeFormat.DATA_MATRIX,
      ]);

      const reader = new BrowserMultiFormatReader(hints);
      const zxingValues: string[] = [];
      for (const source of decodeSources) {
        try {
          const result = source instanceof HTMLCanvasElement
            ? reader.decodeFromCanvas(source)
            : await reader.decodeFromImageElement(source);
          zxingValues.push(String(result?.getText?.() || ""));
        } catch {
          // try next source
        }
      }
      const barcodeBandOnly = decodeSources.filter((source) => source instanceof HTMLCanvasElement && source.width < source.height * 2);
      for (const source of barcodeBandOnly) {
        try {
          const result = reader.decodeFromCanvas(source);
          zxingValues.push(String(result?.getText?.() || ""));
        } catch {
          // ignore
        }
      }
      reader.reset();
      const bestZxing = pickBestTrackingCode(zxingValues);
      return bestZxing;
    } catch {
      return "";
    }
  };

  const startTrackingBatch = async (files: File[]) => {
    const supportedMime = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    const hasSupportedExtension = (name: string) => /\.(jpe?g|png|webp|gif)$/i.test(String(name || ""));
    const validFiles = files.filter((file) => supportedMime.has(file.type) || hasSupportedExtension(file.name));
    
    if (validFiles.length === 0) {
      toast.info("Selecione imagens JPG, PNG, WebP ou GIF.");
      return;
    }

    const skipped = files.length - validFiles.length;
    if (skipped > 0) {
      toast.warning(`${skipped} arquivo(s) ignorado(s). Formatos aceitos: JPG, PNG, WebP, GIF.`);
    }

    setTrackingBatchFiles(validFiles);
    setTrackingBatchIndex(0);
    setTrackingBatchProcessing(true);

    // Process first file
    await processBatchFileSimple(0, validFiles);
  };

  const processBatchFileSimple = async (index: number, files: File[]) => {
    if (index >= files.length) {
      setTrackingBatchProcessing(false);
      setTrackingBatchFiles([]);
      setTrackingBatchIndex(0);
      toast.success("Lote de etiquetas concluído.");
      return;
    }

    const file = files[index];
    setTrackingBatchIndex(index);
    setTrackingBatchProcessing(true);

    try {
      // Use same logic as single upload but without orderId (auto-match)
      const rawDataUrl = await fileToDataUrl(file);
      const imageData = await compressImageDataUrl(rawDataUrl);
      
      const res = await fetch(`${BASE}/api/admin/orders/tracking-label/parse`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ imageData }), // No orderId - triggers auto-match
      });

      const data = await res.json().catch(() => ({})) as {
        message?: string;
        order?: AdminOrder | null;
        imageUrl?: string;
        parsed?: {
          suggestedTrackingCode?: string | null;
          detectedName?: string | null;
          detectedAddress?: string | null;
          detectedCep?: string | null;
          ocrEnabled?: boolean;
        };
      };

      if (!res.ok) {
        throw new Error(data?.message || "Erro ao processar etiqueta.");
      }

      if (data.order) {
        onSetOrderPatched(data.order);
      }

      const orderForReview = data.order || ordersLookup.find((item) => item.id === (data as any)?.matchedOrderId);
      if (!orderForReview) {
        toast.warning(`Imagem ${index + 1}: Não foi possível identificar o pedido.`);
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay
        await processBatchFileSimple(index + 1, files);
        return;
      }

      let suggestedTracking = String(data?.parsed?.suggestedTrackingCode || "").trim();
      if (!suggestedTracking) {
        const detectedByBarcode = await detectTrackingByBarcode(imageData);
        if (detectedByBarcode) {
          suggestedTracking = detectedByBarcode;
        }
      }

      setTrackingDraftCode(suggestedTracking || String((orderForReview as any)?.trackingCode || "").trim());
      setTrackingReview({
        order: orderForReview,
        imageUrl: String(data?.imageUrl || (orderForReview as any)?.trackingLabelUrl || "").trim(),
        suggestedTrackingCode: suggestedTracking,
        detectedName: String(data?.parsed?.detectedName || (orderForReview as any)?.trackingDetectedName || "").trim(),
        detectedAddress: String(data?.parsed?.detectedAddress || (orderForReview as any)?.trackingDetectedAddress || "").trim(),
        detectedCep: String(data?.parsed?.detectedCep || "").trim(),
        ocrEnabled: !!data?.parsed?.ocrEnabled,
      });
      setTrackingBatchProcessing(false);
      // Modal is now open - user will confirm or skip
      // confirmTrackingSave will call advanceToNextBatchFile
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao processar etiqueta.";
      toast.error(`Imagem ${index + 1}: ${message}`);
      await new Promise(resolve => setTimeout(resolve, 500));
      await processBatchFileSimple(index + 1, files);
    }
  };

  const advanceToNextBatchFile = async () => {
    const nextIndex = trackingBatchIndex + 1;
    if (nextIndex >= trackingBatchFiles.length) {
      setTrackingBatchProcessing(false);
      setTrackingBatchFiles([]);
      setTrackingBatchIndex(0);
      toast.success("Lote concluído!");
      return;
    }
    await processBatchFileSimple(nextIndex, trackingBatchFiles);
  };

  const uploadTrackingLabel = async (orderId: string, file: File) => {
    if (!orderId) return;
    setTrackingUploading((prev) => ({ ...prev, [orderId]: true }));
    try {
      const rawDataUrl = await fileToDataUrl(file);
      const imageData = await compressImageDataUrl(rawDataUrl);
      const res = await fetch(`${BASE}/api/admin/orders/tracking-label/parse`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ orderId, imageData }),
      });

      const data = await res.json().catch(() => ({})) as {
        message?: string;
        order?: AdminOrder;
        imageUrl?: string;
        parsed?: {
          suggestedTrackingCode?: string | null;
          detectedName?: string | null;
          detectedAddress?: string | null;
          detectedCep?: string | null;
          ocrEnabled?: boolean;
        };
      };

      if (!res.ok) {
        throw new Error(data?.message || "Erro ao processar etiqueta de rastreio.");
      }

      if (data.order) {
        onSetOrderPatched(data.order);
      }

      const orderForReview = data.order || ordersLookup.find((item) => item.id === orderId);
      if (!orderForReview) {
        toast.error("Pedido não encontrado para revisão do rastreio.");
        return;
      }

      let suggestedTracking = String(data?.parsed?.suggestedTrackingCode || "").trim();
      if (!suggestedTracking) {
        const detectedByBarcode = await detectTrackingByBarcode(imageData);
        if (detectedByBarcode) {
          suggestedTracking = detectedByBarcode;
          toast.success(`Rastreio detectado por código de barras: ${detectedByBarcode}`);
        }
      }
      setTrackingDraftCode(suggestedTracking || String((orderForReview as any)?.trackingCode || "").trim());
      setTrackingReview({
        order: orderForReview,
        imageUrl: String(data?.imageUrl || (orderForReview as any)?.trackingLabelUrl || "").trim(),
        suggestedTrackingCode: suggestedTracking,
        detectedName: String(data?.parsed?.detectedName || (orderForReview as any)?.trackingDetectedName || "").trim(),
        detectedAddress: String(data?.parsed?.detectedAddress || (orderForReview as any)?.trackingDetectedAddress || "").trim(),
        detectedCep: String(data?.parsed?.detectedCep || "").trim(),
        ocrEnabled: !!data?.parsed?.ocrEnabled,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao processar etiqueta de rastreio.";
      toast.error(message);
    } finally {
      setTrackingUploading((prev) => ({ ...prev, [orderId]: false }));
      const input = trackingInputRefs.current[orderId];
      if (input) input.value = "";
    }
  };

  const confirmTrackingSave = async () => {
    if (!trackingReview) return;
    console.log(`[Tracking] Confirming save for order: ${trackingReview.order.id}`);
    const normalized = trackingDraftCode.toUpperCase().replace(/\s+/g, "").trim();
    if (!normalized) {
      toast.error("Informe o código de rastreio antes de confirmar.");
      return;
    }

    const targetOrderId = trackingSelectedOrderId || trackingReview.order.id;
    const targetOrder = ordersLookup.find((o) => o.id === targetOrderId) || trackingReview.order;
    const stockCheck = verifyOrderStock(targetOrderId);
    if (!stockCheck.hasStock) {
      toast.error(stockCheck.message);
      return;
    }
    const currentTracking = String((targetOrder as any)?.trackingCode || "").toUpperCase().replace(/\s+/g, "").trim();
    const overwrite = !!currentTracking && currentTracking !== normalized;

    setTrackingSaving(true);
    try {
      const saveRes = await fetch(`${BASE}/api/admin/orders/${targetOrderId}/tracking-code`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ trackingCode: normalized, overwrite }),
      });
      const saveData = await saveRes.json().catch(() => ({})) as { message?: string; order?: AdminOrder };
      if (!saveRes.ok) {
        throw new Error(saveData?.message || "Erro ao salvar código de rastreio.");
      }
      if (saveData.order) {
        onSetOrderPatched(saveData.order);
      }

      // Mark as shipped right after tracking confirmation so inventory can be decremented.
      if (!enviados[targetOrderId]) {
        const envioRes = await fetch(`${BASE}/api/admin/orders/${targetOrderId}/enviado`, {
          method: "PATCH",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ enviado: true }),
        });

        if (envioRes.status === 404) {
          onRemoveOrder(targetOrderId);
          throw new Error("Rastreio salvo, mas pedido não foi encontrado para marcar como enviado.");
        }

        if (!envioRes.ok) {
          const envioData = await envioRes.json().catch(() => ({})) as { message?: string };
          throw new Error(envioData?.message || "Rastreio salvo, mas falhou ao marcar pedido como enviado.");
        }

        onSetOrderEnviado(targetOrderId, true);
        setEnviados((prev) => ({ ...prev, [targetOrderId]: true }));
      }

      setTrackingReview(null);
      setTrackingDraftCode("");
      setTrackingSelectedOrderId(null);
      toast.success(`Rastreio salvo e pedido marcado como enviado: ${normalized}`);
      if (trackingBatchFiles.length > 0) {
        await advanceToNextBatchFile();
      } else if (trackingBatchWatchdogRef.current != null) {
        window.clearTimeout(trackingBatchWatchdogRef.current);
        trackingBatchWatchdogRef.current = null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao salvar código de rastreio.";
      toast.error(message);
    } finally {
      setTrackingSaving(false);
    }
  };

  const trackingTargetOrderId = trackingReview ? (trackingSelectedOrderId || trackingReview.order.id) : "";
  const trackingTargetOrder = trackingReview
    ? (ordersLookup.find((order) => order.id === trackingTargetOrderId) || trackingReview.order)
    : null;
  const modalInventoryBalances = (trackingInventoryBalances && trackingInventoryBalances.length > 0)
    ? trackingInventoryBalances
    : inventoryBalances;
  const trackingInventoryReady = modalInventoryBalances.length > 0;
  const globalInventorySnapshotReady = inventoryBalances.length > 0;
  const trackingReviewStock = trackingReview
    ? (trackingInventoryReady ? verifyOrderStock(trackingReview.order.id, modalInventoryBalances) : { hasStock: true, message: "", missingItems: [] as string[] })
    : { hasStock: true, message: "", missingItems: [] as string[] };
  const trackingTargetStock = trackingTargetOrderId
    ? verifyOrderStock(trackingTargetOrderId, modalInventoryBalances)
    : { hasStock: true, message: "", missingItems: [] as string[] };

  if (orders.length === 0) return (
    <div className="text-center py-16 bg-muted/30 rounded-2xl border border-dashed">
      <IconLucide name="Package" className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
      <p className="font-semibold text-lg">Nenhum pedido encontrado</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-dashed border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-sky-50 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-indigo-900">Upload em lote de etiquetas</p>
            <p className="text-xs text-indigo-700/90">Envia várias imagens de uma vez e a IA abre a revisão uma por uma, só com pedidos ainda não enviados.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={trackingBatchInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = "";
                void startTrackingBatch(files);
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="gap-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
              disabled={trackingBatchProcessing || trackingSaving}
              onClick={() => trackingBatchInputRef.current?.click()}
            >
              {trackingBatchProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {trackingBatchProcessing ? "Processando lote..." : "Selecionar várias etiquetas"}
            </Button>
          </div>
        </div>
      </div>

      {orders
        .filter(order => typeof order.id === "string" && order.id.length > 0)
        .map((order) => {
          const isPrioridade = resolveOrderPriority(order);
          const currentOrderStatus = normalizeOrderStatus(order.status);
          const isPaidOrder = currentOrderStatus === "paid" || currentOrderStatus === "completed";
          const isCard     = order.paymentMethod === "card_simulation";
          const isExpanded = expandedOrder === order.id;
          const orderStockCheck = enviados[order.id] || !globalInventorySnapshotReady
            ? { hasStock: true, message: "", missingItems: [] as string[] }
            : verifyOrderStock(order.id);
          const orderProducts = getOrderProducts(order.products);
          const grossAmount = Number(order.cardTotalActual ?? order.total) || 0;
          const orderProductsCost = orderProducts.reduce((sum, item) => {
            const qty = Number(item.quantity) || 0;
            const unitCost = item.costPrice != null
              ? Number(item.costPrice)
              : Number(productCostById[String(item.id || "").trim()] || 0);
            return sum + qty * unitCost;
          }, 0);
          const commissionRate = getCommissionRate(order.sellerCode, order.sellerCommissionRateSnapshot);
          const commissionAmount = grossAmount * (commissionRate / 100);
          const isWhatsAppPix = order.paymentMethod === "whatsapp_pix";
          const gatewayFeeRaw = grossAmount * (gatewayFeePercent / 100) + gatewayFeeFixed;
          const gatewayFee = isWhatsAppPix
            ? 0
            : (grossAmount > 0 ? Math.max(gatewayFeeRaw, gatewayFeeMin) : 0);
          const estimatedProfit = grossAmount - orderProductsCost - commissionAmount - gatewayFee;
          const reshipmentTrackingCode = String(order?.reshipment?.ticketTrackingCode || "").trim();
          const previewProducts = orderProducts.slice(0, 5);
          const hiddenProductsCount = Math.max(0, orderProducts.length - previewProducts.length);
          // Definir isReshipment no escopo correto
          const isReshipment = Boolean(order?.reshipment?.id) && !["reenvio_enviado", "reenvio_resolvido_sem_entrada"].includes(String(order?.reshipment?.status || ""));
          const isSupportTicketReshipmentChild = String(order?.observation || "").toUpperCase().includes("REENVIO DO PEDIDO");
          const commissionBasisAmount = Number(order?.subtotal ?? order?.total) || 0;
          const hasIncrementalCommission = isSupportTicketReshipmentChild && commissionBasisAmount > 0;
          const resolveProductImage = (product: OrderProductLite): string => {
            const fromSnapshot = String(product?.image || "").trim();
            if (fromSnapshot) return fromSnapshot;
            const productId = String(product?.id || "").trim();
            return productId ? String(productImageById[productId] || "").trim() : "";
          };
          return (
            <div key={order.id} className={`bg-card border rounded-2xl shadow-sm overflow-hidden ${isCard ? "border-purple-200" : "border-border/60"} ${isPrioridade ? "ring-2 ring-red-400" : ""}`}>
            <div className="p-5 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {(() => {
                    const rs = (order as any)?.reshipment?.status as string | undefined;
                    const isReshipment = !!rs;
                    return (
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        {isPrioridade && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-bold border border-red-700 animate-pulse">
                            <Star className="w-3 h-3 fill-yellow-300 text-yellow-300" />
                            PRIORIDADE URGENTE
                          </span>
                        )}
                        <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">#{getOrderDisplayId(order)}</span>
                        {/* Badge de status de envio */}
                        {enviados[order.id] ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs font-semibold border border-green-200">Enviado</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 text-xs font-semibold border border-yellow-200">Pendente para envio</span>
                        )}
                        {!enviados[order.id] && (
                          <span
                            title={!globalInventorySnapshotReady
                              ? "Carregando saldo de estoque"
                              : orderStockCheck.hasStock
                                ? "Estoque suficiente para envio"
                                : orderStockCheck.missingItems.join("\n")}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${!globalInventorySnapshotReady
                              ? "bg-slate-100 text-slate-700 border-slate-200"
                              : orderStockCheck.hasStock
                              ? "bg-green-100 text-green-800 border-green-200"
                              : "bg-red-100 text-red-800 border-red-200"}`}
                          >
                            {!globalInventorySnapshotReady ? "Estoque carregando" : (orderStockCheck.hasStock ? "Estoque OK" : "Faltando estoque")}
                          </span>
                        )}
                        {isReshipment && (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${rs === "reenvio_aguardando_estoque" ? "bg-red-100 text-red-800 border-red-200" : rs === "reenvio_pronto_para_envio" ? "bg-red-50 text-red-700 border-red-200" : "bg-rose-100 text-rose-800 border-rose-200"}`}>
                            <AlertTriangle className="w-3 h-3" />{reshipmentStatusLabel(rs)}
                          </span>
                        )}
                        {isSupportTicketReshipmentChild && (
                          <span
                            title={hasIncrementalCommission
                              ? "Pedido de reenvio: comissão aplicada apenas no acréscimo de produtos/quantidade."
                              : "Pedido de reenvio: sem nova comissão (somente reposição do pedido original)."}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${hasIncrementalCommission
                              ? "bg-amber-100 text-amber-800 border-amber-200"
                              : "bg-emerald-100 text-emerald-800 border-emerald-200"}`}
                          >
                            <Percent className="w-3 h-3" />
                            {hasIncrementalCommission ? "Comissão só no acréscimo" : "Sem nova comissão"}
                          </span>
                        )}
                        {statusBadge(order.status)}
                        {isCard ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-xs font-semibold border border-purple-200">
                            <CreditCard className="w-3 h-3" />Cartão{order.cardInstallments ? ` · ${order.cardInstallments}x` : ""}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-xs font-semibold border border-blue-200">
                            <QrCode className="w-3 h-3" />PIX
                          </span>
                        )}
                        {order.sellerCode && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 text-xs font-semibold border border-orange-200">
                            <Tag className="w-3 h-3" />{order.sellerCode}
                          </span>
                        )}
                        {String((order as { whatsappGroup?: string | null }).whatsappGroup || "").trim() && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-800 text-xs font-semibold border border-cyan-200">
                            Grupo: {whatsappGroupLabel((order as { whatsappGroup?: string | null }).whatsappGroup || null)}
                          </span>
                        )}
                        {order.purchaseIp && (
                          <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded" title={(order as any).ipIsp || "IP de compra"}>
                            {normalizeIp(order.purchaseIp)}
                            {(order as any).ipCity ? ` · ${(order as any).ipCity}/${(order as any).ipRegion || ""}` : ""}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatDateBR(order.createdAt)}{" "}
                          {order.createdAt ? new Date(order.createdAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) : ""}
                        </span>
                      </div>
                    );
                  })()}
                  <h3 className="font-bold text-lg">{order.clientName}</h3>
                  <p className="text-sm text-muted-foreground">{order.clientEmail} · {order.clientPhone}</p>
                  {order.clientDocument && (
                    <p className="text-xs text-muted-foreground mt-0.5">CPF: {order.clientDocument}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">IP compra: {normalizeIp((order as any).purchaseIp)}</p>
                  {order.addressCity && (
                    <p className="text-xs text-muted-foreground mt-0.5">{order.addressCity}{order.addressState && `/${order.addressState}`}</p>
                  )}
                  {((order as any).trackingCode || (order as any).trackingDetectedName || (order as any).trackingDetectedAddress) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {(order as any).trackingCode && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-xs font-semibold border border-indigo-200">
                          Rastreio: {(order as any).trackingCode}
                        </span>
                      )}
                      {(order as any).trackingDetectedName && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-800 text-xs font-semibold border border-cyan-200">
                          Detectado: {(order as any).trackingDetectedName}
                        </span>
                      )}
                    </div>
                  )}
                  {previewProducts.length > 0 && (
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {previewProducts.map((product, index) => {
                        const imageSrc = resolveProductImage(product);
                        return (
                          <div
                            key={`${product.id}-${index}`}
                            title={`${product.quantity}x ${product.name}`}
                            className={`group relative h-11 w-11 rounded-lg overflow-visible shrink-0 ${imageSrc ? "cursor-zoom-in" : ""}`}
                            onClick={() => {
                              if (!imageSrc) return;
                              setImagePreview({ src: imageSrc, name: product.name });
                            }}
                          >
                            <div className="h-11 w-11 rounded-lg overflow-hidden border border-border bg-muted/30">
                              {imageSrc ? (
                                <img src={imageSrc} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
                              ) : (
                                <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                                  <ShoppingBag className="w-4 h-4" />
                                </div>
                              )}
                            </div>
                            {imageSrc && (
                              <div className="pointer-events-none absolute left-12 top-1/2 z-30 hidden -translate-y-1/2 rounded-xl border border-border bg-white p-1 shadow-2xl opacity-0 scale-95 invisible transition-all duration-200 ease-out group-hover:opacity-100 group-hover:scale-100 group-hover:visible sm:block">
                                <img
                                  src={imageSrc}
                                  alt={`Zoom ${product.name}`}
                                  className="h-32 w-32 rounded-lg object-cover"
                                  loading="lazy"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {hiddenProductsCount > 0 && (
                        <span className="inline-flex items-center h-11 px-2 rounded-lg border border-border bg-muted text-xs font-semibold text-muted-foreground">
                          +{hiddenProductsCount}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-2xl font-bold text-primary">{formatCurrency(order.total)}</p>
                  <p
                    className={`text-xs font-semibold mt-1 ${estimatedProfit >= 0 ? "text-emerald-700" : "text-red-600"}`}
                    title="Lucro estimado = total - custo dos produtos - comissão - taxa do gateway (exceto WhatsApp)"
                  >
                    Lucro est.: {formatCurrency(estimatedProfit)}
                  </p>
                </div>
              </div>

              {/* Order management controls — shown for all orders */}
              <div className={`mt-4 p-4 rounded-xl border ${isCard ? "bg-purple-50 border-purple-100" : "bg-blue-50/50 border-blue-100/50"}`}>
                <p className={`text-sm font-semibold mb-3 ${isCard ? "text-purple-800" : "text-blue-800"}`}>
                  Gestão — {isCard ? "Cartão (simulação)" : "PIX"}
                </p>
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <select
                    value={whatsappGroupDrafts[order.id] || "__none"}
                    onChange={(event) => setWhatsappGroupDrafts((prev) => ({ ...prev, [order.id]: event.target.value }))}
                    className="h-8 px-2 rounded-lg border border-border bg-white text-xs cursor-pointer outline-none focus:border-primary"
                  >
                    <option value="__none">Sem grupo</option>
                    {availableWhatsappGroups.map((group) => (
                      <option key={group} value={group}>{whatsappGroupLabel(group)}</option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-cyan-700 border-cyan-200 hover:bg-cyan-50"
                    disabled={!!whatsappGroupUpdating[order.id]}
                    onClick={() => { void saveOrderWhatsappGroup(order); }}
                  >
                    {whatsappGroupUpdating[order.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Salvar grupo
                  </Button>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button type="button" size="sm" variant="outline" className="gap-1.5 text-green-700 border-green-200 hover:bg-green-50"
                    disabled={statusUpdating === order.id || isPaidOrder}
                    onClick={() => isCard ? onOpenCardPaidModal(order.id) : updateOrderStatus(order.id, "paid")}>
                    <CheckCircle className="w-3.5 h-3.5" />{isCard ? "Marcar Pago" : "Marcar Pago"}
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                    type="button"
                    disabled={statusUpdating === order.id || currentOrderStatus === "cancelled"}
                    onClick={() => {
                      if (isPaidOrder) {
                        openAdminPasswordModal(
                          "Confirmar desfazer status pago",
                          "Para alterar um pedido já pago/concluído, confirme sua senha de admin.",
                          async (password) => {
                            await updateOrderStatus(order.id, "cancelled", undefined, { adminPassword: password });
                          },
                        );
                        return;
                      }
                      void updateOrderStatus(order.id, "cancelled");
                    }}>
                    <XCircle className="w-3.5 h-3.5" />Cancelar
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50"
                    onClick={() => setProofModal(order.id)}>
                    <Upload className="w-3.5 h-3.5" />
                    {(order.proofUrls && order.proofUrls.length > 0) || order.proofUrl ? "Adicionar Comprovante" : "Upload Comprovante"}
                  </Button>
                  <input
                    ref={(el) => { trackingInputRefs.current[order.id] = el; }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      uploadTrackingLabel(order.id, file);
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                    disabled={!!trackingUploading[order.id]}
                    onClick={() => trackingInputRefs.current[order.id]?.click()}
                  >
                    {trackingUploading[order.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {trackingUploading[order.id] ? "Lendo Etiqueta..." : "Etiqueta/Rastreio"}
                  </Button>
                  {(order.proofUrls && order.proofUrls.length > 0) && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {order.proofUrls.map((url, i) => (
                        <button key={i} title={`Comprovante ${i + 1}`}
                          className="w-8 h-8 rounded-lg border border-border overflow-hidden hover:ring-2 hover:ring-primary transition"
                          onClick={() => setProofViewer(url)}>
                          {url.startsWith("data:image") ? (
                            <img src={url} alt={`Comp. ${i + 1}`} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-muted text-[9px] font-bold text-muted-foreground">PDF</div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {!order.proofUrls?.length && order.proofUrl && (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setProofViewer(order.proofUrl!)}>
                      <Eye className="w-3.5 h-3.5" />Ver Comprovante
                    </Button>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-4 flex-wrap">
                <Button
                  size="sm"
                  variant={isPrioridade ? "danger" : "outline"}
                  className={`gap-1.5 ${isPrioridade ? "bg-red-600 text-white border-red-700 hover:bg-red-700" : "text-red-600 border-red-200 hover:bg-red-50"}`}
                  title={isPrioridade ? "Remover prioridade" : "Marcar como prioridade"}
                  disabled={!!orderPriorityUpdating[order.id]}
                  onClick={() => { void toggleOrderPriority(order); }}
                >
                  {orderPriorityUpdating[order.id]
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Star className={`w-4 h-4 ${isPrioridade ? "fill-yellow-300 text-yellow-300" : ""}`} />}
                  {orderPriorityUpdating[order.id] ? "Salvando..." : "Prioridade"}
                </Button>
                <Button
                  size="sm"
                  className={`gap-1.5 rounded-full px-5 py-2 font-semibold transition shadow-sm border ${enviados[order.id]
                    ? "bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-200"
                    : "bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-200"}`}
                  variant="outline"
                  disabled={!!enviando[order.id]}
                  onClick={() => toggleEnviado(order.id)}
                >
                  {enviando[order.id]
                    ? "Salvando..."
                    : enviados[order.id]
                      ? "Marcar como Pendente"
                      : "Marcar como Enviado"}
                </Button>
                <Button size="sm" className="gap-2 bg-green-600 hover:bg-green-700 text-white border-none"
                  onClick={() => openWhatsApp(order)}>
                  <MessageCircle className="w-4 h-4" />WhatsApp
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5"
                  onClick={() => setExpandedOrder(isExpanded ? null : order.id)}>
                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  Detalhes
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-slate-700 border-slate-200 hover:bg-slate-50"
                  onClick={() => downloadOrder(order)}>
                  <Download className="w-3.5 h-3.5" />Baixar Pedido
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-slate-600 border-slate-200 hover:bg-slate-50"
                  onClick={() => copyOrder(order)}>
                  {copiedOrderId === order.id ? <CheckCircle className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedOrderId === order.id ? "Resumo copiado!" : "Copiar Resumo"}
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                  onClick={() => copyOrderFull(order)}>
                  {copiedOrderId === order.id + "-full" ? <CheckCircle className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedOrderId === order.id + "-full" ? "Completo copiado!" : "Copiar Completo"}
                </Button>
                {isPaidOrder && (
                  <Button size="sm" variant="outline" className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                    onClick={() => copyOrderPostPayment(order)}>
                    {copiedOrderId === order.id + "-post-paid" ? <CheckCircle className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedOrderId === order.id + "-post-paid" ? "Pós-pagamento copiado!" : "Copiar pós-pagamento"}
                  </Button>
                )}
                {isPrimary && (
                  <Button size="sm" variant="outline" className="gap-1.5 text-violet-600 border-violet-200 hover:bg-violet-50"
                    onClick={() => onEditOrder(order)}>
                    <Pencil className="w-3.5 h-3.5" />Editar Pedido
                  </Button>
                )}
                {isCard && (
                  <Button size="sm" variant="outline" className="gap-1.5 text-amber-600 border-amber-200 hover:bg-amber-50"
                    onClick={() => onOpenKycModal(order.id)}>
                    <ShieldCheck className="w-3.5 h-3.5" />KYC
                  </Button>
                )}
                {(order as any)?.reshipment?.id && !["reenvio_enviado", "reenvio_resolvido_sem_entrada"].includes(String((order as any)?.reshipment?.status || "")) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-red-700 border-red-200 hover:bg-red-50"
                    onClick={() => onSetReshipmentStatus((order as any).reshipment.id, "reenvio_enviado")}
                  >
                    <Truck className="w-3.5 h-3.5" />Marcar Reenvio Enviado
                  </Button>
                )}
              </div>
            </div>

            {/* Expanded details */}
            <AnimatePresence initial={false}>
              {isExpanded && (
                <motion.div
                  key={`details-${order.id}`}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  style={{ overflow: "hidden" }}
                  className="border-t border-border/50 bg-muted/30 px-5 sm:px-6 pb-5 pt-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Produtos</p>
                  <div className="space-y-1">
                    {orderProducts.map((p, i) => {
                      const imageSrc = resolveProductImage(p);
                      const qty = Number(p.quantity) || 0;
                      const lineTotal = Number(p.price) * qty;
                      const unitCost = p.costPrice != null
                        ? Number(p.costPrice)
                        : Number(productCostById[String(p.id || "").trim()] || 0);
                      const lineProfit = lineTotal - (unitCost * qty);
                      const hasNegativeProfit = lineProfit < 0;
                      return (
                      <div key={i} className="flex items-center justify-between text-sm gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={`group relative h-9 w-9 overflow-visible shrink-0 ${imageSrc ? "cursor-zoom-in" : ""}`}
                            onClick={() => {
                              if (!imageSrc) return;
                              setImagePreview({ src: imageSrc, name: p.name });
                            }}
                          >
                            <div className="h-9 w-9 rounded-md overflow-hidden border border-border bg-muted/30">
                              {imageSrc ? (
                                <img src={imageSrc} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                              ) : (
                                <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                                  <ShoppingBag className="w-3.5 h-3.5" />
                                </div>
                              )}
                            </div>
                            {imageSrc && (
                              <div className="pointer-events-none absolute left-10 top-1/2 z-30 hidden -translate-y-1/2 rounded-xl border border-border bg-white p-1 shadow-2xl opacity-0 scale-95 invisible transition-all duration-200 ease-out group-hover:opacity-100 group-hover:scale-100 group-hover:visible sm:block">
                                <img
                                  src={imageSrc}
                                  alt={`Zoom ${p.name}`}
                                  className="h-28 w-28 rounded-lg object-cover"
                                  loading="lazy"
                                />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <span className="truncate block">{p.quantity}x {p.name}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-medium block">{formatCurrency(lineTotal)}</span>
                          <span className={`block text-xs font-medium ${hasNegativeProfit ? "text-red-600" : "text-emerald-700"}`}>
                            {hasNegativeProfit ? "Prejuízo" : "Lucro"}: {formatCurrency(lineProfit)}
                          </span>
                        </div>
                      </div>
                    )})}
                  </div>
                  <div className="mt-3 text-sm space-y-0.5 text-muted-foreground">
                    <p>Subtotal: {formatCurrency(Number(order.subtotal))}</p>
                    <p>Frete: {formatCurrency(Number(order.shippingCost))}</p>
                    {order.includeInsurance && <p>Seguro: {formatCurrency(Number(order.insuranceAmount))}</p>}
                    {((order.discountAmount || 0) > 0 || !!order.couponCode) && (
                      <p>
                        Desconto: <span className="text-green-700">-{formatCurrency(Number(order.discountAmount || 0))}</span>
                        {order.couponCode && <span>{` (Cupom ${order.couponCode})`}</span>}
                      </p>
                    )}
                    {order.transactionId && <p className="font-mono text-xs">Tx: {order.transactionId}</p>}
                    {order.sellerCode && <p>Vendedor: <strong>{order.sellerCode}</strong></p>}
                    {[order.addressStreet, order.addressNumber, order.addressNeighborhood, order.addressCity, order.addressState, order.addressCep].some(Boolean) && (
                      <p>Endereço: {[order.addressStreet, order.addressNumber, order.addressComplement, order.addressNeighborhood, `${order.addressCity||""}/${order.addressState||""}`, order.addressCep ? `CEP ${order.addressCep}` : ""].filter(Boolean).join(", ")}</p>
                    )}
                  </div>
                  {/* Card actual payment details */}
                  {isCard && (order.cardInstallmentsActual || order.cardInstallmentValue || order.cardTotalActual) && (
                    <div className="mt-3 p-3 rounded-lg bg-purple-50 border border-purple-100 text-sm">
                      <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-1.5">Pagamento Real no Cartão</p>
                      {order.cardInstallmentsActual && <p className="text-purple-800">Parcelas: <strong>{order.cardInstallmentsActual}x</strong></p>}
                      {order.cardInstallmentValue && <p className="text-purple-800">Valor por parcela: <strong>{formatCurrency(Number(order.cardInstallmentValue))}</strong></p>}
                      {order.cardTotalActual && <p className="text-purple-800">Total cobrado: <strong>{formatCurrency(Number(order.cardTotalActual))}</strong></p>}
                    </div>
                  )}
                  {/* Observation field */}
                  <div className="mt-4">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Observações</label>
                    <ObservationField
                      value={order.observation ?? ""}
                      onSave={(val) => updateOrderObservation(order.id, val)}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      <AnimatePresence>
        {imagePreview && (
          <motion.div
            className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-[1px] p-4 sm:p-8 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setImagePreview(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 6 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              onClick={(event) => event.stopPropagation()}
              className="max-w-[94vw] rounded-2xl border border-white/20 bg-white p-2 shadow-2xl"
            >
              <img
                src={imagePreview.src}
                alt={`Prévia ${imagePreview.name}`}
                className="max-h-[78vh] w-auto max-w-[90vw] rounded-xl object-contain"
              />
              <p className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground truncate max-w-[86vw]">
                {imagePreview.name}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {trackingReview && (
          <motion.div
            className="fixed inset-0 z-[130] bg-black/65 backdrop-blur-[1px] p-4 sm:p-6 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              if (trackingSaving) return;
              setTrackingReview(null);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-6xl max-h-[92vh] overflow-auto rounded-2xl border border-border bg-white shadow-2xl"
            >
              <div className="p-4 sm:p-6 border-b border-border/70 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Revisar Etiqueta</p>
                  <h3 className="text-lg sm:text-xl font-bold">Pedido #{trackingReview.order.id}</h3>
                </div>
                <div className="flex flex-wrap gap-2 items-center justify-end">
                  {trackingBatchFiles.length > 0 && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                      Lote {trackingBatchIndex + 1}/{trackingBatchFiles.length}
                    </span>
                  )}
                  {trackingBatchFiles.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={trackingSaving}
                      onClick={async () => {
                        setTrackingReview(null);
                        setTrackingDraftCode("");
                        setTrackingSelectedOrderId(null);
                        if (trackingBatchWatchdogRef.current != null) {
                          window.clearTimeout(trackingBatchWatchdogRef.current);
                          trackingBatchWatchdogRef.current = null;
                        }
                        await advanceToNextBatchFile();
                      }}
                    >
                      Pular
                    </Button>
                  )}
                  {trackingBatchFiles.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={trackingSaving}
                      onClick={() => {
                        setTrackingReview(null);
                        setTrackingDraftCode("");
                        setTrackingSelectedOrderId(null);
                        if (trackingBatchWatchdogRef.current != null) {
                          window.clearTimeout(trackingBatchWatchdogRef.current);
                          trackingBatchWatchdogRef.current = null;
                        }
                        setTrackingBatchFiles([]);
                        setTrackingBatchIndex(0);
                      }}
                    >
                      Cancelar
                    </Button>
                  )}
                  <Button type="button" className="gap-2" disabled={trackingSaving || (trackingInventoryReady && !trackingTargetStock.hasStock)} onClick={confirmTrackingSave}>
                    {trackingSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    Confirmar Rastreio
                  </Button>
                </div>
              </div>

              <div className="p-4 sm:p-6 space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-4">
                  <div className="rounded-xl border border-border bg-slate-50/40 p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Etiqueta carregada</p>
                    {trackingReview.imageUrl ? (
                      <img
                        src={trackingReview.imageUrl}
                        alt={`Etiqueta do pedido ${trackingReview.order.id}`}
                        className="w-full max-h-[60vh] object-contain rounded-lg border border-border bg-white"
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">Imagem da etiqueta não disponível.</p>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
                      <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-2">OCR detectado</p>
                      <div className="space-y-1 text-sm">
                        <p><span className="font-semibold">Rastreio sugerido:</span> {trackingReview.suggestedTrackingCode || "-"}</p>
                        <p><span className="font-semibold">Nome detectado:</span> {trackingReview.detectedName || "-"}</p>
                        <p><span className="font-semibold">Endereço detectado:</span> {trackingReview.detectedAddress || "-"}</p>
                        <p><span className="font-semibold">CEP detectado:</span> {trackingReview.detectedCep || "-"}</p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                      <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2">Dados do pedido</p>
                      <div className="space-y-1 text-sm">
                        <p><span className="font-semibold">Cliente:</span> {trackingTargetOrder?.clientName || trackingReview.order.clientName}</p>
                        <p><span className="font-semibold">Telefone:</span> {trackingTargetOrder?.clientPhone || trackingReview.order.clientPhone}</p>
                        <p><span className="font-semibold">Endereço:</span> {orderAddressText(trackingTargetOrder || trackingReview.order)}</p>
                        <p><span className="font-semibold">Rastreio atual:</span> {String((trackingTargetOrder as any)?.trackingCode || "").trim() || "-"}</p>
                      </div>
                    </div>

                    <div className={`rounded-xl border p-3 ${!trackingInventoryReady ? "border-amber-200 bg-amber-50/60" : trackingReviewStock.hasStock ? "border-green-200 bg-green-50/60" : "border-red-200 bg-red-50/60"}`}>
                      <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${!trackingInventoryReady ? "text-amber-700" : trackingReviewStock.hasStock ? "text-green-700" : "text-red-700"}`}>
                        Estoque do pedido revisado
                      </p>
                      {!trackingInventoryReady ? (
                        <p className="text-sm text-amber-800 font-medium">Carregando saldo de estoque.</p>
                      ) : trackingReviewStock.hasStock ? (
                        <p className="text-sm text-green-800 font-medium">Estoque OK para o pedido da etiqueta carregada.</p>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-sm text-red-800 font-medium">Faltando estoque para o pedido da etiqueta carregada.</p>
                          {trackingReviewStock.missingItems.map((item) => (
                            <p key={item} className="text-xs text-red-700">• {item}</p>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-border p-3">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
                        Código de rastreio para salvar
                      </label>
                      <input
                        value={trackingDraftCode}
                        onChange={(event) => setTrackingDraftCode(event.target.value.toUpperCase())}
                        placeholder="Ex.: AA123456789BR"
                        className="w-full h-10 px-3 rounded-lg border border-border bg-white focus:border-primary outline-none font-mono text-sm"
                      />
                      <p className="mt-2 text-xs text-muted-foreground">
                        Confira os dados ao lado. O sistema só salva no pedido quando você clicar em Confirmar.
                        {!trackingReview.ocrEnabled && " OCR automático está desativado no servidor (tentamos leitura local por código de barras quando possível)."}
                      </p>
                    </div>

                    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                      <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide block mb-2">
                        Pedido de destino
                      </label>
                      <select
                        value={trackingSelectedOrderId || trackingReview.order.id}
                        onChange={(event) => setTrackingSelectedOrderId(event.target.value || null)}
                        className="w-full h-10 px-3 rounded-lg border border-border bg-white focus:border-primary outline-none text-sm"
                      >
                        {[
                          trackingReview.order,
                          ...(ordersLookup.filter((item) => item.id !== trackingReview.order.id)),
                        ]
                          .filter((order, index, list) => list.findIndex((item) => item.id === order.id) === index)
                          .filter((order) => !order.enviado && order.status !== "cancelled")
                          .sort((a, b) => (a.id === trackingReview.order.id ? -1 : b.id === trackingReview.order.id ? 1 : 0))
                          .map((order) => (
                            <option key={order.id} value={order.id}>
                              #{order.id} · {order.clientName} · {order.addressCity}/{order.addressState}
                            </option>
                          ))}
                      </select>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Se o pedido sugerido não for o correto, escolha manualmente entre os pedidos em aberto.
                      </p>
                    </div>

                    <div className={`rounded-xl border p-3 ${!trackingInventoryReady ? "border-amber-200 bg-amber-50/60" : trackingTargetStock.hasStock ? "border-green-200 bg-green-50/60" : "border-red-200 bg-red-50/60"}`}>
                      <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${!trackingInventoryReady ? "text-amber-700" : trackingTargetStock.hasStock ? "text-green-700" : "text-red-700"}`}>
                        Verificação de estoque para envio
                      </p>
                      {!trackingInventoryReady ? (
                        <p className="text-sm text-amber-800 font-medium">Carregando saldo de estoque. Tente novamente em alguns segundos.</p>
                      ) : trackingTargetStock.hasStock ? (
                        <p className="text-sm text-green-800 font-medium">Estoque OK para confirmar rastreio e marcar pedido como enviado.</p>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-sm text-red-800 font-medium">Faltando estoque dos produtos do cliente.</p>
                          {trackingTargetStock.missingItems.map((item) => (
                            <p key={item} className="text-xs text-red-700">• {item}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {adminPasswordModalOpen && (
          <div className="fixed inset-0 z-[120] bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-md rounded-2xl border border-border bg-white shadow-2xl overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-border bg-gradient-to-r from-slate-50 to-white">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                    <Lock className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground">{adminPasswordModalTitle}</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">{adminPasswordModalDescription}</p>
                  </div>
                </div>
              </div>

              <div className="px-5 py-4 space-y-3">
                <label className="text-sm font-medium text-foreground block">Senha do admin</label>
                <div className="relative">
                  <input
                    type={adminPasswordVisible ? "text" : "password"}
                    value={adminPasswordInput}
                    onChange={(event) => setAdminPasswordInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submitAdminPasswordModal();
                      }
                    }}
                    autoFocus
                    placeholder="Digite sua senha"
                    className="w-full h-11 rounded-xl border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none px-3 pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setAdminPasswordVisible((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"
                    aria-label={adminPasswordVisible ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {adminPasswordVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">Essa confirmação é exigida para evitar alterações críticas sem autorização.</p>
              </div>

              <div className="px-5 py-4 border-t border-border bg-slate-50/60 flex items-center justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeAdminPasswordModal} disabled={adminPasswordSubmitting}>Cancelar</Button>
                <Button type="button" className="gap-1.5" onClick={() => { void submitAdminPasswordModal(); }} disabled={adminPasswordSubmitting}>
                  {adminPasswordSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Confirmar
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatPhoneAdmin(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
function formatCPFAdmin(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
function formatAmountAdmin(raw: string) {
  if (!raw) return "";
  const n = Number(raw) / 100;
  return n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function ObservationField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setText(value); }, [value]);
  const save = () => { onSave(text); setSaved(true); setTimeout(() => setSaved(false), 2000); };
  return (
    <div className="flex gap-2 items-end">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Nenhuma observação"
        className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-background resize-none outline-none focus:border-primary"
      />
      <Button size="sm" variant="outline" onClick={save} className="shrink-0 gap-1.5 text-xs">
        {saved ? <CheckCircle className="w-3.5 h-3.5 text-green-600" /> : <Save className="w-3.5 h-3.5" />}
        {saved ? "Salvo" : "Salvar"}
      </Button>
    </div>
  );
}

type CreateChargeFormType = { name: string; email: string; phone: string; document: string; amountRaw: string; description: string; cep: string; street: string; number: string; complement: string; neighborhood: string; city: string; state: string };

function ChargesPanel({ charges, openWhatsApp, chargeStatusUpdating, onUpdateChargeStatus, chargeProofModal, setChargeProofModal, chargeProofFile, chargeProofUploading, onChargeProofUpload, onSubmitChargeProof, setProofViewer, updateChargeObservation, createChargeOpen, setCreateChargeOpen, createChargeForm, setCreateChargeForm, createChargeSubmitting, onCreateCharge, lookupChargeCep, chargeCepLoading }: {
  charges: CustomCharge[];
  openWhatsApp: (charge: CustomCharge) => void;
  chargeStatusUpdating: string | null;
  onUpdateChargeStatus: (id: string, status: string) => void;
  chargeProofModal: string | null;
  setChargeProofModal: (v: string | null) => void;
  chargeProofFile: string | null;
  chargeProofUploading: boolean;
  onChargeProofUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmitChargeProof: () => void;
  setProofViewer: (v: string | null) => void;
  updateChargeObservation: (id: string, observation: string) => void;
  createChargeOpen: boolean;
  setCreateChargeOpen: (v: boolean) => void;
  createChargeForm: CreateChargeFormType;
  setCreateChargeForm: (v: CreateChargeFormType) => void;
  createChargeSubmitting: boolean;
  onCreateCharge: () => void;
  lookupChargeCep: () => void;
  chargeCepLoading: boolean;
}) {
  const setCF = (k: string, v: string) => setCreateChargeForm({ ...createChargeForm, [k]: v });
  const [expandedCharge, setExpandedCharge] = useState<string | null>(null);
  const [copiedChargeId, setCopiedChargeId] = useState<string | null>(null);

  const copyCharge = async (charge: CustomCharge) => {
    try {
      const mode = await copyText(chargeToText(charge));
      setCopiedChargeId(charge.id);
      if (mode === "auto") {
        toast.success("Dados copiados!");
      } else {
        toast.info("Abra o prompt e copie manualmente.");
      }
      setTimeout(() => setCopiedChargeId(null), 2500);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  const downloadCharge = (charge: CustomCharge) => {
    try {
      generateChargePdf(charge);
    } catch {
      toast.error("Não foi possível baixar o pedido.");
    }
  };

  return (
    <div className="space-y-4">
      {/* Nova Cobrança button */}
      <div className="flex justify-end mb-2">
        <Button className="gap-2" onClick={() => setCreateChargeOpen(true)}>
          <Plus className="w-4 h-4" />Nova Cobrança
        </Button>
      </div>

      {/* Create charge modal */}
      <AnimatePresence>
        {createChargeOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && setCreateChargeOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-border flex items-center justify-between">
                <h3 className="font-bold text-lg flex items-center gap-2"><QrCode className="w-5 h-5 text-primary" />Nova Cobrança PIX</h3>
                <button onClick={() => setCreateChargeOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
                {/* Cliente */}
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Dados do Cliente</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="text-sm font-medium mb-1.5 block">Nome Completo *</label>
                      <input value={createChargeForm.name} onChange={(e) => setCF("name", e.target.value)} placeholder="Nome do cliente" className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">E-mail *</label>
                      <input type="email" value={createChargeForm.email} onChange={(e) => setCF("email", e.target.value)} placeholder="email@exemplo.com" className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Telefone *</label>
                      <input value={createChargeForm.phone} onChange={(e) => setCF("phone", formatPhoneAdmin(e.target.value))} placeholder="(11) 99999-9999" className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm" inputMode="tel" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">CPF *</label>
                      <input value={createChargeForm.document} onChange={(e) => setCF("document", formatCPFAdmin(e.target.value))} placeholder="000.000.000-00" className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm" inputMode="numeric" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Valor *</label>
                      <div className="flex rounded-xl border-2 border-border focus-within:border-primary overflow-hidden">
                        <span className="flex items-center px-3 bg-muted/40 border-r border-border font-bold text-muted-foreground text-sm select-none">R$</span>
                        <input
                          value={formatAmountAdmin(createChargeForm.amountRaw)}
                          onChange={(e) => setCF("amountRaw", e.target.value.replace(/\D/g, ""))}
                          placeholder="0,00"
                          className="flex-1 h-10 px-3 outline-none text-sm font-bold bg-transparent"
                          inputMode="numeric"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Pedido */}
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Produto / Pedido *</p>
                  <textarea
                    value={createChargeForm.description}
                    onChange={(e) => setCF("description", e.target.value)}
                    placeholder="Descreva aqui o seu pedido, frete, e outras observações do pedido"
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-xl border-2 border-border outline-none focus:border-primary text-sm resize-none"
                  />
                </div>

                {/* Endereço */}
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Endereço de Entrega</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">CEP</label>
                      <div className="flex gap-2">
                        <input
                          value={createChargeForm.cep}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, "").slice(0, 8);
                            const fmt = v.length > 5 ? `${v.slice(0,5)}-${v.slice(5)}` : v;
                            setCF("cep", fmt);
                          }}
                          onBlur={lookupChargeCep}
                          placeholder="00000-000"
                          inputMode="numeric"
                          className="flex-1 h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
                        />
                        <Button type="button" size="sm" variant="outline" onClick={lookupChargeCep} disabled={chargeCepLoading} className="h-10 px-3 shrink-0">
                          {chargeCepLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <IconLucide name="Search" className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-sm font-medium mb-1.5 block">Rua / Logradouro</label>
                      <input value={createChargeForm.street} onChange={(e) => setCF("street", e.target.value)} placeholder="Rua das Flores" className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Número</label>
                      <input value={createChargeForm.number} onChange={(e) => setCF("number", e.target.value)} placeholder="123" className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Complemento</label>
                      <input value={createChargeForm.complement} onChange={(e) => setCF("complement", e.target.value)} placeholder="Apto 12" className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Bairro</label>
                      <input value={createChargeForm.neighborhood} onChange={(e) => setCF("neighborhood", e.target.value)} placeholder="Centro" className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Cidade</label>
                      <input value={createChargeForm.city} onChange={(e) => setCF("city", e.target.value)} placeholder="São Paulo" className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Estado (UF)</label>
                      <input value={createChargeForm.state} onChange={(e) => setCF("state", e.target.value.toUpperCase().slice(0,2))} placeholder="SP" className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-6 border-t border-border flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setCreateChargeOpen(false)}>Cancelar</Button>
                <Button className="flex-1 gap-2" onClick={onCreateCharge} disabled={createChargeSubmitting}>
                  {createChargeSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
                  Gerar PIX
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {charges.length === 0 ? (
        <div className="text-center py-16 bg-muted/30 rounded-2xl border border-dashed">
          <LinkIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="font-semibold text-lg">Nenhuma cobrança encontrada</p>
          <p className="text-muted-foreground text-sm mt-1">As cobranças via link de pagamento aparecerão aqui.</p>
        </div>
      ) : charges.map((charge) => (
        <div key={charge.id} className="bg-card border border-border/60 rounded-2xl p-5 sm:p-6 shadow-sm">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">#{charge.id}</span>
                {statusBadge(charge.status)}
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 text-xs font-semibold border border-orange-200">
                  <LinkIcon className="w-3 h-3" />Link de Pagamento
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateBR(charge.createdAt)}
                </span>
              </div>
              <h3 className="font-bold text-lg">{charge.clientName}</h3>
              <p className="text-sm text-muted-foreground">{charge.clientEmail} · {charge.clientPhone}</p>
              {charge.clientDocument && <p className="text-xs text-muted-foreground">CPF: {charge.clientDocument}</p>}
            </div>
            <p className="text-2xl font-bold text-primary shrink-0">{formatCurrency(Number(charge.amount))}</p>
          </div>

          {/* Charge management controls */}
          <div className="mt-4 p-4 rounded-xl border bg-orange-50/50 border-orange-100/50">
            <p className="text-sm font-semibold mb-3 text-orange-800">Gestão — Link de Pagamento</p>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" className="gap-1.5 text-green-700 border-green-200 hover:bg-green-50"
                disabled={chargeStatusUpdating === charge.id || charge.status === "paid"}
                onClick={() => onUpdateChargeStatus(charge.id, "paid")}>
                <CheckCircle className="w-3.5 h-3.5" />Marcar Pago
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                disabled={chargeStatusUpdating === charge.id || charge.status === "cancelled"}
                onClick={() => onUpdateChargeStatus(charge.id, "cancelled")}>
                <XCircle className="w-3.5 h-3.5" />Cancelar
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50"
                onClick={() => setChargeProofModal(charge.id)}>
                <Upload className="w-3.5 h-3.5" />
                {(charge.proofUrls && charge.proofUrls.length > 0) || charge.proofUrl ? "Adicionar Comprovante" : "Upload Comprovante"}
              </Button>
              {(charge.proofUrls && charge.proofUrls.length > 0) && (
                <div className="flex items-center gap-1 flex-wrap">
                  {charge.proofUrls.map((url, i) => (
                    <button key={i} title={`Comprovante ${i + 1}`}
                      className="w-8 h-8 rounded-lg border border-border overflow-hidden hover:ring-2 hover:ring-primary transition"
                      onClick={() => setProofViewer(url)}>
                      {url.startsWith("data:image") ? (
                        <img src={url} alt={`Comp. ${i + 1}`} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-muted text-[9px] font-bold text-muted-foreground">PDF</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {!charge.proofUrls?.length && charge.proofUrl && (
                <Button size="sm" variant="outline" className="gap-1.5"
                  onClick={() => setProofViewer(charge.proofUrl!)}>
                  <Eye className="w-3.5 h-3.5" />Ver Comprovante
                </Button>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 mt-4 flex-wrap">
            <Button size="sm" className="gap-2 bg-green-600 hover:bg-green-700 text-white border-none"
              onClick={() => openWhatsApp(charge)}>
              <MessageCircle className="w-4 h-4" />WhatsApp
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5"
              onClick={() => setExpandedCharge(expandedCharge === charge.id ? null : charge.id)}>
              {expandedCharge === charge.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Detalhes
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-slate-700 border-slate-200 hover:bg-slate-50"
              onClick={() => downloadCharge(charge)}>
              <Download className="w-3.5 h-3.5" />Baixar Pedido
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-slate-600 border-slate-200 hover:bg-slate-50"
              onClick={() => copyCharge(charge)}>
              {copiedChargeId === charge.id ? <CheckCircle className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedChargeId === charge.id ? "Copiado!" : "Copiar Dados"}
            </Button>
          </div>

          {/* Expanded details — produtos + address + tx + seller */}
          <AnimatePresence>
            {expandedCharge === charge.id && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="border-t border-border/50 bg-muted/30 -mx-5 sm:-mx-6 px-5 sm:px-6 pb-5 pt-4 mt-4 overflow-hidden">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Produtos</p>
                <div className="flex justify-between text-sm">
                  <span className="flex-1 pr-4">{charge.description || <span className="italic text-muted-foreground">Sem descrição</span>}</span>
                  <span className="font-medium shrink-0">{formatCurrency(Number(charge.amount))}</span>
                </div>
                <div className="mt-3 text-sm space-y-0.5 text-muted-foreground">
                  {charge.transactionId && <p className="font-mono text-xs">Tx: {charge.transactionId}</p>}
                  {charge.sellerCode && (
                    <p>Vendedor: <strong>{charge.sellerCode}</strong></p>
                  )}
                  {[charge.addressStreet, charge.addressNumber, charge.addressNeighborhood, charge.addressCity, charge.addressState, charge.addressCep].some(Boolean) && (
                    <p>Endereço: {[charge.addressStreet, charge.addressNumber, charge.addressComplement, charge.addressNeighborhood, `${charge.addressCity || ""}${charge.addressState ? `/${charge.addressState}` : ""}`, charge.addressCep ? `CEP ${charge.addressCep}` : ""].filter(Boolean).join(", ")}</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Observation */}
          <div className="mt-4">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Observações</label>
            <ObservationField
              value={charge.observation ?? ""}
              onSave={(val) => updateChargeObservation(charge.id, val)}
            />
          </div>
        </div>
      ))}

      {/* Charge proof upload modal */}
      <AnimatePresence>
        {chargeProofModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && (setChargeProofModal(null))}>
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
              <div className="p-6 border-b border-border flex items-center justify-between">
                <h3 className="text-xl font-bold mb-0">Upload do Comprovante</h3>
                <button onClick={() => setChargeProofModal(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6">
                <p className="text-muted-foreground text-sm mb-6">Envie o comprovante de pagamento do link PIX.</p>
                <label className="cursor-pointer block">
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onChargeProofUpload} />
                  <div className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary transition-colors">
                    {chargeProofFile ? (
                      <><CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" /><p className="text-sm font-semibold text-green-700">Arquivo selecionado!</p></>
                    ) : (
                      <><Upload className="w-10 h-10 text-muted-foreground mb-2 mx-auto" /><p className="text-sm font-semibold">Clique para selecionar</p><p className="text-xs text-muted-foreground">Imagem ou PDF · máx. 5MB</p></>
                    )}
                  </div>
                </label>
              </div>
              <div className="p-6 pt-0 flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => { setChargeProofModal(null); }}>Cancelar</Button>
                <Button className="flex-1 gap-2" disabled={chargeProofUploading || !chargeProofFile} onClick={onSubmitChargeProof}>
                  {chargeProofUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Enviar
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SellerAnalyticsCard({ seller, orders, charges }: { seller: SavedSellerItem; orders: AdminOrder[]; charges: CustomCharge[] }) {
  const [dateFrom, setDateFrom] = useState(todayStr);
  const [dateTo, setDateTo] = useState(todayStr);

  const sellerOrders = orders.filter((o) => {
    if (o.sellerCode !== seller.slug) return false;
    const d = isoToSPDate(o.createdAt);
    return d >= dateFrom && d <= dateTo;
  });
  const sellerCharges = charges.filter((c) => {
    if (c.sellerCode !== seller.slug) return false;
    const d = isoToSPDate(c.createdAt);
    return d >= dateFrom && d <= dateTo;
  });

  const paidOrders      = sellerOrders.filter((o) => o.status === "paid" || o.status === "completed");
  const pixPaid         = paidOrders.filter((o) => o.paymentMethod === "pix" || o.paymentMethod === "whatsapp_pix");
  const cardPaid        = paidOrders.filter((o) => o.paymentMethod === "card_simulation");
  const paidCharges     = sellerCharges.filter((c) => c.status === "paid");
  const pending         = sellerOrders.filter((o) => o.status === "awaiting_payment" || o.status === "pending");
  const generatedOrders = sellerOrders.filter((o) => o.status !== "cancelled");
  const generatedCharges = sellerCharges.filter((c) => c.status !== "cancelled");

  const pixRevenue      = pixPaid.reduce((s, o) => s + Number(o.total), 0);
  const cardRevenue     = cardPaid.reduce((s, o) => s + Number(o.total), 0);
  const linkRevenue     = paidCharges.reduce((s, c) => s + Number(c.amount), 0);
  const totalRevenue    = pixRevenue + cardRevenue + linkRevenue;
  const totalPaid       = pixPaid.length + cardPaid.length + paidCharges.length;
  const commissionRate  = seller.hasCommission ? Number(seller.commissionRate || 0) : 0;
  const commission      = totalRevenue * (commissionRate / 100);

  const generatedRevenue = generatedOrders.reduce((s, o) => s + Number(o.total), 0)
    + generatedCharges.reduce((s, c) => s + Number(c.amount), 0);

  return (
    <div className="bg-white border border-border/60 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-primary/20 to-primary/40 text-primary flex items-center justify-center font-bold text-xl shrink-0">
          {seller.slug[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold capitalize text-base">{seller.slug}</p>
          {seller.whatsapp && (
            <a
              href={`https://wa.me/${seller.whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-green-600 flex items-center gap-1 hover:underline"
            >
              <MessageCircle className="w-3 h-3" />+{seller.whatsapp}
            </a>
          )}
        </div>
      </div>

      {/* Date filter */}
      <div className="flex gap-2">
        <div className="flex-1">
          <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">De</p>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full text-xs h-8 px-2 rounded-lg border border-border bg-muted/30 outline-none focus:border-primary" />
        </div>
        <div className="flex-1">
          <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">Até</p>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full text-xs h-8 px-2 rounded-lg border border-border bg-muted/30 outline-none focus:border-primary" />
        </div>
      </div>

      {/* Revenue highlight */}
      <div className="bg-emerald-50 rounded-xl px-4 py-3 flex gap-3">
        <div className="flex-1">
          <p className="text-[10px] text-emerald-600 font-semibold uppercase tracking-wide mb-0.5">Total Pago</p>
          <p className="text-xl font-bold text-emerald-700">{formatCurrency(totalRevenue)}</p>
          <p className="text-xs text-emerald-600 mt-0.5">{totalPaid} vendas pagas</p>
        </div>
        <div className="flex-1 border-l border-emerald-200 pl-3">
          <p className="text-[10px] text-blue-600 font-semibold uppercase tracking-wide mb-0.5">Total Gerado</p>
          <p className="text-xl font-bold text-blue-700">{formatCurrency(generatedRevenue)}</p>
          <p className="text-xs text-blue-600 mt-0.5">{generatedOrders.length + generatedCharges.length} pedidos</p>
        </div>
      </div>

      {/* Commission */}
      <div className="bg-amber-50 rounded-xl px-4 py-3 border border-amber-200">
        <p className="text-[10px] text-amber-600 font-semibold uppercase tracking-wide mb-0.5">
          {commissionRate > 0 ? `Comissão (${commissionRate.toFixed(2)}%)` : "Comissão (sem comissão)"}
        </p>
        <p className="text-xl font-bold text-amber-700">{formatCurrency(commission)}</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-yellow-50 rounded-lg p-2.5 text-center">
          <p className="text-lg font-bold text-yellow-700">{pending.length}</p>
          <p className="text-[11px] text-yellow-600 font-medium">Aguardando</p>
        </div>
        <div className="bg-muted/40 rounded-lg p-2.5 text-center">
          <p className="text-lg font-bold text-foreground">{totalPaid}</p>
          <p className="text-[11px] text-muted-foreground font-medium">Pagos</p>
        </div>
        <div className="bg-blue-50 rounded-lg p-2.5">
          <p className="text-sm font-bold text-blue-700">{formatCurrency(pixRevenue)}</p>
          <p className="text-[11px] text-blue-600 font-medium">PIX Loja · {pixPaid.length}</p>
        </div>
        <div className="bg-orange-50 rounded-lg p-2.5">
          <p className="text-sm font-bold text-orange-700">{formatCurrency(linkRevenue)}</p>
          <p className="text-[11px] text-orange-600 font-medium">Links PIX · {paidCharges.length}</p>
        </div>
        <div className="bg-purple-50 rounded-lg p-2.5 col-span-2">
          <p className="text-sm font-bold text-purple-700">{formatCurrency(cardRevenue)}</p>
          <p className="text-[11px] text-purple-600 font-medium">Cartão · {cardPaid.length} ped.</p>
        </div>
      </div>
    </div>
  );
}

function SellersPanel({ siteOrigin, savedSellersList, sellerInput, setSellerInput, sellerWhatsappInput, setSellerWhatsappInput, sellerHasCommissionInput, setSellerHasCommissionInput, sellerCommissionRateInput, setSellerCommissionRateInput, saveSeller, updateSellerCommission, sellerCommissionUpdatingSlug, removeSeller, copySeller, copiedSeller, orders, charges, isPrimary, canManageSellerLinks, currentUsername }: {
  siteOrigin: string;
  savedSellersList: SavedSellerItem[];
  sellerInput: string; setSellerInput: (v: string) => void;
  sellerWhatsappInput: string; setSellerWhatsappInput: (v: string) => void;
  sellerHasCommissionInput: boolean; setSellerHasCommissionInput: (v: boolean) => void;
  sellerCommissionRateInput: string; setSellerCommissionRateInput: (v: string) => void;
  saveSeller: (s: string, w: string, hasCommission: boolean, commissionRate: number) => void; removeSeller: (s: string) => void;
  updateSellerCommission: (slug: string, whatsapp: string, hasCommission: boolean, commissionRate: number) => Promise<boolean>;
  sellerCommissionUpdatingSlug: string | null;
  copySeller: (s: string) => void; copiedSeller: string | null;
  orders: AdminOrder[]; charges: CustomCharge[];
  canManageSellerLinks: boolean;
  isPrimary: boolean; currentUsername: string;
}) {
  const [copiedPaymentLink, setCopiedPaymentLink] = useState<string | null>(null);
  const [editingCommissionSlug, setEditingCommissionSlug] = useState<string | null>(null);
  const [editingHasCommission, setEditingHasCommission] = useState(true);
  const [editingCommissionRate, setEditingCommissionRate] = useState("5");

  const copyPaymentLink = (slug: string) => {
    const url = `${siteOrigin}/pagamento?seller=${slug}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedPaymentLink(slug);
    toast.success("Link de pagamento copiado!");
    setTimeout(() => setCopiedPaymentLink(null), 2500);
  };

  const startCommissionEdit = (seller: SavedSellerItem) => {
    setEditingCommissionSlug(seller.slug);
    setEditingHasCommission(!!seller.hasCommission);
    setEditingCommissionRate(String(Number(seller.commissionRate || 0)));
  };

  const cancelCommissionEdit = () => {
    setEditingCommissionSlug(null);
    setEditingHasCommission(true);
    setEditingCommissionRate("5");
  };

  // All seller slugs: those registered + those in orders (in case they were added manually)
  const registeredSlugs = savedSellersList.map((s) => s.slug);
  const orderSlugs = orders.map((o) => o.sellerCode).filter(Boolean) as string[];
  const allSlugs = Array.from(new Set([...registeredSlugs, ...orderSlugs]));
  // Build full list: registered sellers first, then any from orders not yet registered
  const allSellers: SavedSellerItem[] = allSlugs.map((slug) => {
    const found = savedSellersList.find((s) => s.slug === slug);
    return found ?? { slug, whatsapp: "", hasCommission: true, commissionRate: 5 };
  });

  // For non-primary users, only show their own seller entry.
  // Match by: exact slug, or slug starts with cleaned username, or cleaned username starts with slug.
  const cleanUsername = currentUsername.toLowerCase().replace(/[^a-z]/g, "");
  const visibleSellers = canManageSellerLinks
    ? savedSellersList
    : savedSellersList.filter((s) => {
        const slug = s.slug.toLowerCase();
        return slug === currentUsername.toLowerCase()
          || slug === cleanUsername
          || cleanUsername.startsWith(slug)
          || slug.startsWith(cleanUsername);
      });

  return (
    <div className="space-y-8">
      {/* ── Link Generator ───────────────────────────────────────────────── */}
      <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm max-w-2xl">
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2"><Tag className="w-5 h-5 text-primary" />Links de Vendedor</h2>
        <p className="text-muted-foreground text-sm mb-5">
          {isPrimary
            ? "Gere um link personalizado para cada vendedor com o número do WhatsApp. O cliente que acessar por esse link terá suporte direto com o vendedor."
            : canManageSellerLinks
            ? "Gere e gerencie os links de vendedor desta loja com os números de WhatsApp."
            : "Seu link de vendedor. Compartilhe com seus clientes para que o suporte chegue diretamente a você."}
        </p>

        {/* Create form — only for full-access admins */}
        {canManageSellerLinks && (
          <div className="space-y-3 mb-4">
            <div className="flex gap-2">
              <input
                value={sellerInput}
                onChange={(e) => setSellerInput(e.target.value)}
                placeholder="Nome do vendedor (ex: beatriz)"
                className="flex-1 h-11 px-4 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
              />
            </div>
            <div className="flex gap-2">
              <input
                value={sellerWhatsappInput}
                onChange={(e) => setSellerWhatsappInput(e.target.value)}
                placeholder="WhatsApp (ex: 5511999999999)"
                className="flex-1 h-11 px-4 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
                inputMode="tel"
              />
              <Button
                onClick={() => saveSeller(sellerInput, sellerWhatsappInput, sellerHasCommissionInput, Number(sellerCommissionRateInput || 0))}
                className="gap-2 shrink-0"
                disabled={!sellerInput.trim() || (sellerHasCommissionInput && Number(sellerCommissionRateInput || 0) < 0)}
              >
                <Plus className="w-4 h-4" />Criar Link
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tem comissão</label>
              <button
                type="button"
                onClick={() => setSellerHasCommissionInput(!sellerHasCommissionInput)}
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                {sellerHasCommissionInput ? <IconLucide name="ToggleRight" className="w-7 h-7 text-primary" /> : <ToggleLeft className="w-7 h-7" />}
              </button>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Percentual</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={sellerCommissionRateInput}
                  onChange={(e) => setSellerCommissionRateInput(e.target.value)}
                  disabled={!sellerHasCommissionInput}
                  className="h-8 w-24 px-2 rounded-lg border border-border bg-white text-sm outline-none focus:border-primary disabled:bg-muted/50"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">Desative para dono/sem comissão.</p>
            </div>
          </div>
        )}

        {visibleSellers.length > 0 ? (
          <div className="space-y-2">
            {visibleSellers.map(({ slug, whatsapp, hasCommission, commissionRate }) => {
              const storeUrl      = `${siteOrigin}/${slug}`;
              const paymentUrl    = `${siteOrigin}/pagamento?seller=${slug}`;
              return (
                <div key={slug} className="flex items-center gap-3 bg-muted/30 rounded-xl px-4 py-2.5">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                    {slug[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm capitalize">{slug}</p>
                    <p className="text-xs font-mono text-muted-foreground truncate">{storeUrl}</p>
                    <p className="text-xs font-mono text-violet-600 truncate">{paymentUrl}</p>
                    {whatsapp && <p className="text-xs text-green-600">WA: +{whatsapp}</p>}
                    {editingCommissionSlug === slug ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingHasCommission(!editingHasCommission)}
                          className="text-muted-foreground hover:text-primary transition-colors"
                          title="Ativar/desativar comissão"
                        >
                          {editingHasCommission ? <IconLucide name="ToggleRight" className="w-6 h-6 text-primary" /> : <ToggleLeft className="w-6 h-6" />}
                        </button>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editingCommissionRate}
                          onChange={(e) => setEditingCommissionRate(e.target.value)}
                          disabled={!editingHasCommission}
                          className="h-7 w-24 px-2 rounded-md border border-border bg-white text-xs outline-none focus:border-primary disabled:bg-muted/50"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs gap-1"
                          disabled={sellerCommissionUpdatingSlug === slug || (editingHasCommission && Number(editingCommissionRate || 0) < 0)}
                          onClick={async () => {
                            const ok = await updateSellerCommission(slug, whatsapp || "", editingHasCommission, Number(editingCommissionRate || 0));
                            if (ok) cancelCommissionEdit();
                          }}
                        >
                          {sellerCommissionUpdatingSlug === slug ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          Salvar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs gap-1 text-muted-foreground"
                          onClick={cancelCommissionEdit}
                          disabled={sellerCommissionUpdatingSlug === slug}
                        >
                          <X className="w-3 h-3" />
                          Cancelar
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-amber-700">
                        Comissão: {hasCommission ? `${Number(commissionRate || 0).toFixed(2)}%` : "sem comissão"}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => copySeller(slug)} title="Copiar link da loja">
                      {copiedSeller === slug ? <CheckCircle className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                      {copiedSeller === slug ? "Copiado!" : "Loja"}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1 h-7 text-xs text-violet-700 border-violet-200 hover:bg-violet-50" onClick={() => copyPaymentLink(slug)} title="Copiar link de pagamento">
                      {copiedPaymentLink === slug ? <CheckCircle className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                      {copiedPaymentLink === slug ? "Copiado!" : "Pgto"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 h-7 text-xs text-green-700 border-green-200 hover:bg-green-50"
                      disabled={sellerCommissionUpdatingSlug === slug}
                      title="Editar WhatsApp do vendedor"
                      onClick={async () => {
                        const current = String(whatsapp || "").replace(/\D/g, "");
                        const next = window.prompt("Novo WhatsApp do vendedor (somente números, com DDD)", current);
                        if (next == null) return;

                        const normalized = String(next).replace(/\D/g, "");
                        if (!normalized) {
                          toast.error("Informe um WhatsApp válido.");
                          return;
                        }

                        await updateSellerCommission(slug, normalized, !!hasCommission, Number(commissionRate || 0));
                      }}
                    >
                      <Pencil className="w-3 h-3" />
                      WhatsApp
                    </Button>
                    {canManageSellerLinks && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 h-7 text-xs text-amber-700 border-amber-200 hover:bg-amber-50"
                        onClick={() => {
                          const seller = savedSellersList.find((s) => s.slug === slug);
                          startCommissionEdit(seller ?? { slug, whatsapp, hasCommission, commissionRate });
                        }}
                        disabled={sellerCommissionUpdatingSlug === slug}
                        title="Editar comissão"
                      >
                        <Pencil className="w-3 h-3" />
                        Comissão
                      </Button>
                    )}
                    {canManageSellerLinks && (
                      <Button size="sm" variant="outline" className="h-7 text-red-600 border-red-200 hover:bg-red-50 px-2" onClick={() => removeSeller(slug)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground mt-4">
            {canManageSellerLinks ? "Nenhum link criado ainda." : "Nenhum link de vendedor encontrado para o seu usuário."}
          </p>
        )}
      </div>

      {/* ── Seller Analytics ─────────────────────────────────────────────── */}
      {isPrimary && (
        <div>
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Desempenho por Vendedor
          </h2>
          {allSellers.length === 0 ? (
            <div className="text-center py-12 bg-muted/30 rounded-2xl border border-dashed">
              <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-semibold">Nenhum vendedor cadastrado ainda</p>
              <p className="text-sm text-muted-foreground mt-1">Crie um link de vendedor acima para começar.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {allSellers.map((seller) => (
                <SellerAnalyticsCard key={seller.slug} seller={seller} orders={orders} charges={charges} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CommissionPaymentsPanel({
  sellers,
  pendingOrders,
  batches,
  loading,
  sellerFilter,
  setSellerFilter,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  selectedOrderIds,
  setSelectedOrderIds,
  onRefresh,
  onCreateBatch,
  onMarkPaid,
  creating,
  payingId,
  paymentMethod,
  setPaymentMethod,
  paymentNotes,
  setPaymentNotes,
}: {
  sellers: SavedSellerItem[];
  pendingOrders: SellerCommissionPendingOrder[];
  batches: SellerCommissionPaymentBatch[];
  loading: boolean;
  sellerFilter: string;
  setSellerFilter: (v: string) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  selectedOrderIds: string[];
  setSelectedOrderIds: React.Dispatch<React.SetStateAction<string[]>>;
  onRefresh: () => void;
  onCreateBatch: () => void;
  onMarkPaid: (batchId: string) => void;
  creating: boolean;
  payingId: string | null;
  paymentMethod: string;
  setPaymentMethod: (v: string) => void;
  paymentNotes: string;
  setPaymentNotes: (v: string) => void;
}) {
  const selectedSet = new Set(selectedOrderIds);
  const selectedOrders = pendingOrders.filter((order) => selectedSet.has(order.id));
  const pendingTotal = pendingOrders.reduce((sum, order) => sum + order.commissionAmount, 0);
  const selectedTotal = selectedOrders.reduce((sum, order) => sum + order.commissionAmount, 0);
  const paidBatches = batches.filter((batch) => batch.status === "paid");
  const openBatches = batches.filter((batch) => batch.status !== "paid");
  const allSelected = pendingOrders.length > 0 && selectedOrderIds.length === pendingOrders.length;

  const toggleOrder = (orderId: string) => {
    setSelectedOrderIds((prev) => prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]);
  };

  const sellerOptions = sellers.length > 0 ? sellers : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Controle de comissões</h2>
          <p className="text-sm text-muted-foreground">Selecione os pedidos elegíveis, crie o lote e marque o pagamento quando o repasse for feito.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onRefresh} className="h-10 px-3 rounded-xl border-2 border-border bg-white hover:bg-muted text-sm flex items-center gap-1.5">
            <RefreshCw className="w-4 h-4" /> Atualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Pendências</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{pendingOrders.length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Total pendente</p>
          <p className="mt-1 text-2xl font-bold text-amber-700">{formatCurrency(pendingTotal)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Lotes abertos</p>
          <p className="mt-1 text-2xl font-bold text-blue-700">{openBatches.length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Lotes pagos</p>
          <p className="mt-1 text-2xl font-bold text-green-700">{paidBatches.length}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)} className="h-10 rounded-xl border border-border bg-white px-3 text-sm">
            <option value="all">Todos os vendedores</option>
            {sellerOptions.map((seller) => (
              <option key={seller.slug} value={seller.slug}>{seller.slug}</option>
            ))}
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-10 rounded-xl border border-border bg-white px-3 text-sm" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-10 rounded-xl border border-border bg-white px-3 text-sm" />
          <button type="button" onClick={() => setSelectedOrderIds(pendingOrders.map((order) => order.id))} className="h-10 rounded-xl border border-border bg-white px-3 text-sm hover:bg-muted">
            Selecionar todos
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="px-2 py-1 rounded-full border border-border bg-muted/40">Selecionados: {selectedOrderIds.length}</span>
          <span className="px-2 py-1 rounded-full border border-border bg-muted/40">Total selecionado: {formatCurrency(selectedTotal)}</span>
          <span className="px-2 py-1 rounded-full border border-border bg-muted/40">{sellerFilter === "all" ? "Selecione um vendedor para criar lote" : "Pronto para criar lote"}</span>
        </div>

        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Forma de pagamento</p>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm">
              <option value="pix">PIX</option>
              <option value="transferencia">Transferência</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div className="flex-[2]">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Observação</p>
            <input value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} placeholder="Ex: fechamento quinzenal" className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm" />
          </div>
          <Button onClick={onCreateBatch} disabled={creating || selectedOrderIds.length === 0 || sellerFilter === "all"} className="h-10 min-w-[180px]">
            {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <DollarSign className="w-4 h-4 mr-2" />}
            Criar lote
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <p className="text-sm font-semibold">Pedidos elegíveis</p>
              <p className="text-xs text-muted-foreground">Pedidos pagos com comissão ainda não vinculada a lote.</p>
            </div>
            {pendingOrders.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={allSelected} onChange={() => setSelectedOrderIds(allSelected ? [] : pendingOrders.map((order) => order.id))} />
                Marcar todos
              </label>
            )}
          </div>
          <div className="max-h-[420px] overflow-auto space-y-2 pr-1">
            {loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Carregando comissões...</div>
            ) : pendingOrders.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Nenhuma comissão pendente encontrada.</div>
            ) : pendingOrders.map((order) => {
              const checked = selectedSet.has(order.id);
              return (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => toggleOrder(order.id)}
                  className={`w-full text-left rounded-xl border px-3 py-2.5 flex items-start gap-3 transition-colors ${checked ? "border-blue-200 bg-blue-50" : "border-border bg-white hover:bg-muted/30"}`}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggleOrder(order.id)} className="mt-1" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold truncate">{order.clientName}</p>
                      <span className="text-xs font-semibold text-amber-700">{formatCurrency(order.commissionAmount)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Pedido {order.id} · {order.sellerCode || "sem vendedor"} · {formatDateBR(order.createdAt || "")}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Comissão {order.sellerCommissionRateSnapshot.toFixed(2)}% sobre {formatCurrency(order.total)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <p className="text-sm font-semibold">Lotes de comissão</p>
              <p className="text-xs text-muted-foreground">Histórico de repasses por vendedor.</p>
            </div>
            <span className="text-xs text-muted-foreground">{batches.length} lote(s)</span>
          </div>
          <div className="max-h-[420px] overflow-auto space-y-2 pr-1">
            {batches.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Nenhum lote criado ainda.</div>
            ) : batches.map((batch) => (
              <div key={batch.id} className="rounded-xl border border-border bg-white p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{batch.sellerCode}</p>
                    <p className="text-xs text-muted-foreground">{batch.orderCount} pedido(s) · {formatCurrency(batch.totalAmount)}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Criado em {formatDateBR(batch.createdAt)}</p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${batch.status === "paid" ? "bg-green-100 text-green-700 border-green-200" : "bg-amber-100 text-amber-700 border-amber-200"}`}>
                    {batch.status === "paid" ? "Pago" : "Aberto"}
                  </span>
                </div>
                {batch.notes ? <p className="text-xs text-muted-foreground">Obs.: {batch.notes}</p> : null}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {batch.periodStartDate || batch.periodStart ? <span className="px-2 py-1 rounded-full border border-border bg-muted/30">De {formatDateOnlyLocal(batch.periodStartDate || batch.periodStart)}</span> : null}
                  {batch.periodEndDate || batch.periodEnd ? <span className="px-2 py-1 rounded-full border border-border bg-muted/30">Até {formatDateOnlyLocal(batch.periodEndDate || batch.periodEnd)}</span> : null}
                  {batch.paidAt ? <span className="px-2 py-1 rounded-full border border-border bg-green-50 text-green-700">Pago em {formatDateBR(batch.paidAt)}</span> : null}
                </div>
                {batch.status !== "paid" && (
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => onMarkPaid(batch.id)} disabled={payingId === batch.id}>
                      {payingId === batch.id ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                      Marcar pago
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CustomersPanel
// ---------------------------------------------------------------------------
function CustomersPanel({
  customers, loading, search, setSearch, onRefresh, onImpersonate, impersonatingId, canImpersonate, onExportCSV, onSyncBrevo, exportingCSV, syncingBrevo, exportModalOpen, setExportModalOpen, exportColumns, setExportColumns,
}: {
  customers: CustomerUserRecord[];
  loading: boolean;
  search: string;
  setSearch: (v: string) => void;
  onRefresh: () => void;
  onImpersonate: (customer: CustomerUserRecord) => void;
  impersonatingId: string | null;
  canImpersonate: boolean;
  onExportCSV: () => void;
  onSyncBrevo: () => void;
  exportingCSV: boolean;
  syncingBrevo: boolean;
  exportModalOpen: boolean;
  setExportModalOpen: (v: boolean) => void;
  exportColumns: Record<string, boolean>;
  setExportColumns: (v: Record<string, boolean>) => void;
}) {
  const filtered = customers.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.affiliateCode || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Clientes cadastrados</h2>
          <p className="text-sm text-muted-foreground">{customers.length} cliente{customers.length !== 1 ? "s" : ""} no total</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <IconLucide name="Search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, e-mail ou cód. afiliado..."
              className="h-10 pl-9 pr-4 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm w-72"
            />
          </div>
          <button
            onClick={onRefresh}
            className="h-10 px-3 rounded-xl border-2 border-border bg-white hover:bg-muted text-sm flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setExportModalOpen(true)}
            disabled={exportingCSV || customers.length === 0}
            className="h-10 px-3 rounded-xl border-2 border-border bg-white hover:bg-muted text-sm flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
            title={customers.length === 0 ? "Sem clientes para exportar" : "Exportar clientes CSV"}
          >
            {exportingCSV ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          </button>
          <button
            onClick={onSyncBrevo}
            disabled={syncingBrevo || customers.length === 0}
            className="h-10 px-3 rounded-xl border-2 border-border bg-white hover:bg-muted text-sm flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
            title={customers.length === 0 ? "Sem clientes para sincronizar" : "Sincronizar com Brevo"}
          >
            {syncingBrevo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-border rounded-2xl">
          <UserPlus className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-semibold text-foreground">{search ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado ainda."}</p>
          {search && (
            <button onClick={() => setSearch("")} className="mt-2 text-sm text-primary hover:underline">Limpar busca</button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/60 border-b border-border">
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Nome</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">E-mail</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Pedidos</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Cód. afiliado</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Cadastro em</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, idx) => (
                <tr key={c.id} className={`border-b border-border last:border-0 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}>
                  <td className="px-4 py-3 font-medium text-foreground">
                    <div className="flex items-center gap-2">
                      <span>{c.name}</span>
                      {!c.hasAccount && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
                          convidado
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${c.orderCount > 0 ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                      <IconLucide name="Package" className="w-3 h-3" />
                      {c.orderCount}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {c.affiliateCode ? (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-mono font-semibold">{c.affiliateCode}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDateBR(c.createdAt)}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onImpersonate(c)}
                      disabled={!canImpersonate || !c.hasAccount || impersonatingId === c.id}
                      className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg border border-border bg-white hover:bg-muted text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                      title={!canImpersonate ? "Apenas administrador principal pode entrar na conta" : !c.hasAccount ? "Comprador sem cadastro (convidado)" : "Entrar na conta do cliente"}
                    >
                      {impersonatingId === c.id ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Entrando...
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          Entrar na conta
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Export Modal */}
      {exportModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-lg max-w-md w-full mx-4 p-6 space-y-6">
            <div>
              <h3 className="text-lg font-bold text-foreground">Personalizar Exportação</h3>
              <p className="text-sm text-muted-foreground mt-1">Selecione as colunas que deseja exportar</p>
            </div>

            {/* Preset buttons */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setExportColumns({
                  name: false,
                  email: true,
                  phone: false,
                  orderCount: false,
                  affiliateCode: false,
                  createdAt: false,
                })}
                className="px-3 py-2 text-sm font-semibold rounded-lg border border-border hover:bg-muted bg-white transition-colors"
              >
                Apenas Email
              </button>
              <button
                onClick={() => setExportColumns({
                  name: false,
                  email: false,
                  phone: true,
                  orderCount: false,
                  affiliateCode: false,
                  createdAt: false,
                })}
                className="px-3 py-2 text-sm font-semibold rounded-lg border border-border hover:bg-muted bg-white transition-colors"
              >
                Apenas Telefone
              </button>
              <button
                onClick={() => setExportColumns({
                  name: true,
                  email: true,
                  phone: true,
                  orderCount: true,
                  affiliateCode: true,
                  createdAt: true,
                })}
                className="px-3 py-2 text-sm font-semibold rounded-lg border border-border hover:bg-muted bg-white transition-colors"
              >
                Todas as Colunas
              </button>
            </div>

            {/* Column checkboxes */}
            <div className="space-y-3 bg-muted/20 p-4 rounded-lg">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportColumns.name}
                  onChange={() => setExportColumns({ ...exportColumns, name: !exportColumns.name })}
                  className="w-4 h-4 rounded border-border cursor-pointer"
                />
                <span className="text-sm font-medium text-foreground">Nome</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportColumns.email}
                  onChange={() => setExportColumns({ ...exportColumns, email: !exportColumns.email })}
                  className="w-4 h-4 rounded border-border cursor-pointer"
                />
                <span className="text-sm font-medium text-foreground">E-mail</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportColumns.phone}
                  onChange={() => setExportColumns({ ...exportColumns, phone: !exportColumns.phone })}
                  className="w-4 h-4 rounded border-border cursor-pointer"
                />
                <span className="text-sm font-medium text-foreground">Telefone</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportColumns.orderCount}
                  onChange={() => setExportColumns({ ...exportColumns, orderCount: !exportColumns.orderCount })}
                  className="w-4 h-4 rounded border-border cursor-pointer"
                />
                <span className="text-sm font-medium text-foreground">Pedidos</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportColumns.affiliateCode}
                  onChange={() => setExportColumns({ ...exportColumns, affiliateCode: !exportColumns.affiliateCode })}
                  className="w-4 h-4 rounded border-border cursor-pointer"
                />
                <span className="text-sm font-medium text-foreground">Código Afiliado</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportColumns.createdAt}
                  onChange={() => setExportColumns({ ...exportColumns, createdAt: !exportColumns.createdAt })}
                  className="w-4 h-4 rounded border-border cursor-pointer"
                />
                <span className="text-sm font-medium text-foreground">Data Cadastro</span>
              </label>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setExportModalOpen(false)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-border bg-white hover:bg-muted text-sm font-semibold transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  onExportCSV();
                  setExportModalOpen(false);
                }}
                disabled={exportingCSV}
                className="flex-1 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {exportingCSV ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Exportando...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Exportar CSV
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RecurringCustomersPanel({
  customers,
  loading,
  search,
  setSearch,
  onRefresh,
}: {
  customers: RecurringCustomerRecord[];
  loading: boolean;
  search: string;
  setSearch: (v: string) => void;
  onRefresh: () => void;
}) {
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);
  const [messageTemplate, setMessageTemplate] = useState(
    "Olá, {{nome}}! Tudo bem? Vi aqui que você já comprou conosco antes e queria falar com você.",
  );

  const filtered = customers.filter((customer) => {
    if (!search.trim()) return true;
    const query = search.toLowerCase();
    return (
      customer.name.toLowerCase().includes(query) ||
      customer.email.toLowerCase().includes(query) ||
      String(customer.phone || "").toLowerCase().includes(query)
    );
  });

  const totalSpent = filtered.reduce((sum, customer) => sum + Number(customer.totalSpent || 0), 0);
  const totalOrders = filtered.reduce((sum, customer) => sum + Number(customer.orderCount || 0), 0);
  const maxDaysWithoutPurchase = filtered.reduce((max, customer) => Math.max(max, daysSince(customer.lastOrderAt)), 0);

  const formatPurchaseProducts = (products: Array<{ id: string; name: string; quantity: number; price?: number }>) => {
    if (!products.length) return "Sem produtos informados";
    return products.map((product) => `${product.quantity}x ${product.name}`).join(" · ");
  };

  const openCustomerWhatsApp = (customer: RecurringCustomerRecord) => {
    const phoneDigits = String(customer.phone || "").replace(/\D/g, "");
    if (!phoneDigits) return;
    const normalizedPhone = phoneDigits.startsWith("55") ? phoneDigits : `55${phoneDigits}`;
    const message = messageTemplate
      .replace(/\{\{\s*nome\s*\}\}/gi, customer.name)
      .replace(/\{\{\s*email\s*\}\}/gi, customer.email || "")
      .replace(/\{\{\s*telefone\s*\}\}/gi, customer.phone || "")
      .replace(/\{\{\s*pedidos\s*\}\}/gi, String(customer.orderCount || 0))
      .replace(/\{\{\s*total\s*\}\}/gi, formatCurrency(Number(customer.totalSpent || 0)))
      .replace(/\{\{\s*dias_sem_compra\s*\}\}/gi, String(daysSince(customer.lastOrderAt)))
      .trim();
    window.open(`https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`, "_blank");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Clientes recorrentes</h2>
          <p className="text-sm text-muted-foreground">Clientes com mais de um pedido, ordenados do que está há mais tempo sem comprar para o mais recente.</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <IconLucide name="Search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, e-mail ou telefone..."
              className="h-10 pl-9 pr-4 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm w-72"
            />
          </div>
          <button
            onClick={onRefresh}
            className="h-10 px-3 rounded-xl border-2 border-border bg-white hover:bg-muted text-sm flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white p-4 shadow-sm space-y-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Mensagem pronta para o WhatsApp</p>
          <p className="text-sm text-muted-foreground mt-1">Personalize o texto que será usado ao clicar no telefone. Use <span className="font-semibold text-foreground">{"{{nome}}"}</span>, <span className="font-semibold text-foreground">{"{{email}}"}</span>, <span className="font-semibold text-foreground">{"{{telefone}}"}</span>, <span className="font-semibold text-foreground">{"{{pedidos}}"}</span>, <span className="font-semibold text-foreground">{"{{total}}"}</span> e <span className="font-semibold text-foreground">{"{{dias_sem_compra}}"}</span>.</p>
        </div>
        <textarea
          value={messageTemplate}
          onChange={(e) => setMessageTemplate(e.target.value)}
          rows={3}
          className="w-full rounded-xl border-2 border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary resize-none"
          placeholder="Digite sua mensagem pronta..."
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Clientes recorrentes</p>
          <p className="text-2xl font-bold mt-1">{filtered.length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Pedidos somados</p>
          <p className="text-2xl font-bold mt-1">{totalOrders}</p>
        </div>
        <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Faturamento total</p>
          <p className="text-2xl font-bold mt-1">{formatCurrency(totalSpent)}</p>
          <p className="text-xs text-muted-foreground mt-1">Maior inatividade: {maxDaysWithoutPurchase} dia{maxDaysWithoutPurchase === 1 ? "" : "s"}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-border rounded-2xl bg-white">
          <Users className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-semibold text-foreground">{search ? "Nenhum cliente encontrado." : "Nenhum cliente recorrente encontrado."}</p>
          {search && (
            <button onClick={() => setSearch("")} className="mt-2 text-sm text-primary hover:underline">Limpar busca</button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-sm">
          <table className="min-w-[980px] w-full table-fixed text-xs">
            <thead>
              <tr className="bg-muted/60 border-b border-border">
                <th className="text-left px-2 py-2 font-semibold text-muted-foreground whitespace-nowrap w-36">Cliente</th>
                <th className="text-left px-2 py-2 font-semibold text-muted-foreground whitespace-nowrap w-44">E-mail</th>
                <th className="text-left px-2 py-2 font-semibold text-muted-foreground whitespace-nowrap w-28">Telefone</th>
                <th className="text-left px-2 py-2 font-semibold text-muted-foreground whitespace-nowrap w-20">Pedidos</th>
                <th className="text-left px-2 py-2 font-semibold text-muted-foreground whitespace-nowrap w-28">Total gasto</th>
                <th className="text-left px-2 py-2 font-semibold text-muted-foreground whitespace-nowrap w-28">Ticket médio</th>
                <th className="text-left px-2 py-2 font-semibold text-muted-foreground whitespace-nowrap w-28">Primeira compra</th>
                <th className="text-left px-2 py-2 font-semibold text-muted-foreground whitespace-nowrap w-28">Última compra</th>
                <th className="text-left px-2 py-2 font-semibold text-muted-foreground whitespace-nowrap w-28">Dias sem comprar</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((customer, index) => {
                const staleDays = daysSince(customer.lastOrderAt);
                const isExpanded = expandedCustomerId === customer.id;
                return (
                  <>
                  <tr
                    key={customer.id}
                    className={`border-b border-border last:border-0 cursor-pointer hover:bg-primary/5 ${index % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}
                    onClick={() => setExpandedCustomerId(isExpanded ? null : customer.id)}
                  >
                    <td className="px-2 py-2 font-medium text-foreground truncate" title={customer.name}>{customer.name}</td>
                    <td className="px-2 py-2 text-muted-foreground truncate" title={customer.email || ""}>{customer.email || "—"}</td>
                    <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">
                      {customer.phone ? (
                        <button
                          type="button"
                          className="text-emerald-700 hover:text-emerald-800 font-semibold hover:underline"
                          onClick={(event) => {
                            event.stopPropagation();
                            openCustomerWhatsApp(customer);
                          }}
                          title="Abrir WhatsApp"
                        >
                          {customer.phone}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                        <IconLucide name="Package" className="w-3 h-3" />
                        {customer.orderCount}
                      </span>
                    </td>
                    <td className="px-2 py-2 font-semibold text-foreground whitespace-nowrap">{formatCurrency(Number(customer.totalSpent || 0))}</td>
                    <td className="px-2 py-2 font-medium text-foreground whitespace-nowrap">{formatCurrency(Number(customer.averageTicket || 0))}</td>
                    <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">{formatDateBR(customer.firstOrderAt)}</td>
                    <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">{formatDateBR(customer.lastOrderAt)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${staleDays >= 30 ? "bg-red-100 text-red-700" : staleDays >= 14 ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                        {staleDays} dia{staleDays === 1 ? "" : "s"}
                      </span>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-slate-50/80 border-b border-border">
                      <td colSpan={9} className="px-4 py-4">
                        <div className="rounded-xl border border-border bg-white p-4">
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <div>
                              <p className="text-sm font-semibold text-foreground">Produtos comprados</p>
                              <p className="text-xs text-muted-foreground">{customer.purchases.length} pedido{customer.purchases.length === 1 ? "" : "s"} listado{customer.purchases.length === 1 ? "" : "s"} abaixo</p>
                            </div>
                            <button
                              type="button"
                              className="text-xs font-semibold text-primary hover:underline"
                              onClick={(e) => { e.stopPropagation(); setExpandedCustomerId(null); }}
                            >
                              Fechar
                            </button>
                          </div>
                          <div className="space-y-2">
                            {customer.purchases.map((purchase) => (
                              <div key={purchase.id} className="rounded-lg border border-border bg-slate-50 px-3 py-2">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                                  <p className="text-xs font-semibold text-foreground">Pedido #{purchase.id}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {purchase.createdAt ? formatDateBR(purchase.createdAt) : "Data indisponível"} · {formatCurrency(Number(purchase.total || 0))}
                                  </p>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">{formatPurchaseProducts(purchase.products)}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UsersPanel({
  users, newUsername, setNewUsername, newPassword, setNewPassword,
  newFullAccess, setNewFullAccess, showNewPw, setShowNewPw,
  userCreating, userDeleting, userAccessUpdating, userPasswordUpdating,
  createUser, deleteUser, toggleUserAccess, changeUserPassword,
}: {
  users: AdminUser[]; newUsername: string; setNewUsername: (v: string) => void;
  newPassword: string; setNewPassword: (v: string) => void;
  newFullAccess: boolean; setNewFullAccess: (v: boolean) => void;
  showNewPw: boolean; setShowNewPw: (v: boolean) => void;
  userCreating: boolean; userDeleting: string | null; userAccessUpdating: string | null; userPasswordUpdating: string | null;
  createUser: () => void; deleteUser: (id: string, username: string) => void;
  toggleUserAccess: (id: string, username: string, fullAccess: boolean) => void;
  changeUserPassword: (id: string, username: string, password: string) => Promise<boolean>;
}) {
  const [editingPasswordUserId, setEditingPasswordUserId] = useState<string | null>(null);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [showPasswordDraft, setShowPasswordDraft] = useState(false);

  const openPasswordEditor = (userId: string) => {
    setEditingPasswordUserId(userId);
    setPasswordDraft("");
    setShowPasswordDraft(false);
  };

  const closePasswordEditor = () => {
    setEditingPasswordUserId(null);
    setPasswordDraft("");
    setShowPasswordDraft(false);
  };

  const submitPasswordChange = async (id: string, username: string) => {
    const ok = await changeUserPassword(id, username, passwordDraft);
    if (ok) closePasswordEditor();
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2"><UserPlus className="w-5 h-5 text-primary" />Novo Usuário</h2>
        <p className="text-muted-foreground text-sm mb-5">Crie novos acessos ao painel administrativo.</p>
        <div className="space-y-3">
          <input
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="Nome de usuário (ex: beatriz)"
            className="w-full h-11 px-4 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
          />
          <div className="relative">
            <input
              type={showNewPw ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createUser()}
              placeholder="Senha (mínimo 6 caracteres)"
              className="w-full h-11 px-4 pr-12 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
            />
            <button type="button" onClick={() => setShowNewPw(!showNewPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Full access toggle */}
          <button
            type="button"
            onClick={() => setNewFullAccess(!newFullAccess)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors text-left ${
              newFullAccess
                ? "border-primary bg-primary/5 text-primary"
                : "border-border bg-white text-muted-foreground hover:border-primary/40"
            }`}
          >
            {newFullAccess
              ? <IconLucide name="ToggleRight" className="w-5 h-5 shrink-0" />
              : <ToggleLeft className="w-5 h-5 shrink-0" />}
            <div>
              <p className="font-semibold text-sm text-foreground">Acesso Total</p>
              <p className="text-xs text-muted-foreground">
                {newFullAccess
                  ? "Este usuário terá acesso completo — criar cupons, gerenciar produtos, configurações e usuários."
                  : "Acesso padrão — visualiza pedidos, cobranças, vendedores e configurações básicas."}
              </p>
            </div>
          </button>

          <Button onClick={createUser} className="w-full gap-2" disabled={userCreating || !newUsername.trim() || !newPassword.trim()}>
            {userCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Criar Usuário
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="font-bold text-sm text-muted-foreground uppercase tracking-wide px-1">Usuários Cadastrados</h3>
        {users.length === 0 ? (
          <div className="text-center py-10 bg-muted/30 rounded-2xl border border-dashed">
            <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">Nenhum usuário cadastrado.</p>
          </div>
        ) : users.map((u) => (
          <div key={u.id} className="bg-card border border-border/60 rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex items-center gap-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg shrink-0 ${u.isPrimary ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
              {u.username[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold capitalize">{u.username}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
                  u.isPrimary
                    ? "bg-primary/10 text-primary border-primary/20"
                    : "bg-muted text-muted-foreground border-border"
                }`}>
                  {u.isPrimary ? "Acesso Total" : "Limitado"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Criado em {formatDateOnlyBR(u.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Toggle access level */}
              <button
                type="button"
                title={u.isPrimary ? "Remover acesso total" : "Conceder acesso total"}
                disabled={userAccessUpdating === u.id}
                onClick={() => toggleUserAccess(u.id, u.username, !u.isPrimary)}
                className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
              >
                {userAccessUpdating === u.id
                  ? <Loader2 className="w-5 h-5 animate-spin" />
                  : u.isPrimary
                    ? <IconLucide name="ToggleRight" className="w-6 h-6 text-primary" />
                    : <ToggleLeft className="w-6 h-6" />}
              </button>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5"
                onClick={() => openPasswordEditor(u.id)}
                disabled={userPasswordUpdating === u.id}
              >
                {userPasswordUpdating === u.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                Alterar senha
              </Button>
              {/* Delete */}
              <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 shrink-0"
                disabled={userDeleting === u.id}
                onClick={() => deleteUser(u.id, u.username)}>
                {userDeleting === u.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </Button>
            </div>
            </div>

            {editingPasswordUserId === u.id && (
              <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Alterar senha de {u.username}
                </p>
                <div className="relative">
                  <input
                    type={showPasswordDraft ? "text" : "password"}
                    value={passwordDraft}
                    onChange={(e) => setPasswordDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void submitPasswordChange(u.id, u.username);
                      }
                    }}
                    placeholder="Nova senha (mínimo 6 caracteres)"
                    className="w-full h-10 px-3 pr-10 rounded-lg border border-border bg-white text-sm focus:border-primary outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswordDraft(!showPasswordDraft)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPasswordDraft ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="gap-2"
                    onClick={() => void submitPasswordChange(u.id, u.username)}
                    disabled={userPasswordUpdating === u.id || passwordDraft.trim().length < 6}
                  >
                    {userPasswordUpdating === u.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Salvar senha
                  </Button>
                  <Button size="sm" variant="ghost" onClick={closePasswordEditor} disabled={userPasswordUpdating === u.id}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function WebhookPanel({ webhookUrl, copied, onCopy }: { webhookUrl: string; copied: boolean; onCopy: () => void }) {
  const universalUrl = webhookUrl.replace("/webhook/pix", "/webhook");
  const [copiedUniversal, setCopiedUniversal] = useState(false);

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Universal Webhook */}
      <div className="bg-card border border-primary/20 rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
          <Webhook className="w-5 h-5 text-primary" />Webhook Universal
          <span className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full font-semibold">Recomendado</span>
        </h2>
        <p className="text-muted-foreground text-sm mb-5">
          Aceita qualquer formato de payload — APPCNPay, Mercado Pago, PagSeguro, Stripe ou qualquer gateway.
          Extrai automaticamente o ID da transação e o status do pagamento.
        </p>
        <div className="bg-muted/60 rounded-xl p-4 border border-border mb-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">URL Universal</p>
          <p className="font-mono text-sm break-all text-foreground">{universalUrl}</p>
        </div>
        <Button onClick={() => { navigator.clipboard.writeText(universalUrl); setCopiedUniversal(true); setTimeout(() => setCopiedUniversal(false), 2000); toast.success("URL copiada!"); }} className="w-full gap-2" variant={copiedUniversal ? "default" : "outline"}>
          {copiedUniversal ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copiedUniversal ? "Copiado!" : "Copiar URL Universal"}
        </Button>
      </div>

      {/* PIX-specific Webhook */}
      <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
          <QrCode className="w-5 h-5 text-blue-600" />Webhook PIX (APPCNPay)
        </h2>
        <p className="text-muted-foreground text-sm mb-5">
          URL específica para o gateway APPCNPay. Configure no painel em <strong>Configurações → Webhook</strong>.
        </p>
        <div className="bg-muted/60 rounded-xl p-4 border border-border mb-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">URL PIX</p>
          <p className="font-mono text-sm break-all text-foreground">{webhookUrl}</p>
        </div>
        <Button onClick={onCopy} className="w-full gap-2" variant={copied ? "default" : "outline"}>
          {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? "Copiado!" : "Copiar URL PIX"}
        </Button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
        <h3 className="font-bold text-amber-800 mb-2">Formatos aceitos pelo Webhook Universal</h3>
        <div className="text-sm text-amber-700 space-y-1.5 font-mono bg-amber-100/50 rounded-xl p-3">
          <p><span className="font-bold">&#123; transactionId, status &#125;</span> — APPCNPay</p>
          <p><span className="font-bold">&#123; id, status &#125;</span> — Mercado Pago, genérico</p>
          <p><span className="font-bold">&#123; transaction_id, status &#125;</span> — snake_case</p>
          <p><span className="font-bold">&#123; orderId, status &#125;</span> — por ID do pedido</p>
          <p><span className="font-bold">&#123; payment: &#123; id, status &#125; &#125;</span> — aninhado</p>
        </div>
      </div>

      <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm">
        <h3 className="font-bold mb-2">URLs por transação (geradas automaticamente)</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Cada PIX gerado recebe uma URL única enviada automaticamente ao gateway. Não é necessário configurar manualmente.
        </p>
        <div className="space-y-2 text-xs font-mono bg-muted/40 rounded-xl p-3">
          <p className="text-muted-foreground break-all">{webhookUrl.replace("/webhook/pix", "/webhook/pix/order/:token/:orderId")}</p>
          <p className="text-muted-foreground break-all">{webhookUrl.replace("/webhook/pix", "/webhook/pix/charge/:token/:chargeId")}</p>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// CouponsPanel
// ===========================================================================
function CouponsPanel({
  coupons, products, couponForm, setCouponForm, couponCreating, couponDeleting,
  createCoupon, toggleCoupon, deleteCoupon, isPrimary,
}: {
  coupons: Coupon[];
  products: AdminProduct[];
  couponForm: { code: string; discountType: string; discountValue: string; minOrderValue: string; maxUses: string; eligibleProductIds: string[] };
  setCouponForm: (f: { code: string; discountType: string; discountValue: string; minOrderValue: string; maxUses: string; eligibleProductIds: string[] }) => void;
  couponCreating: boolean; couponDeleting: string | null; isPrimary: boolean;
  createCoupon: () => void;
  toggleCoupon: (id: string, isActive: boolean) => void;
  deleteCoupon: (id: string, code: string) => void;
}) {
  const inp = "h-10 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm w-full";
  const productNameById = (id: string) => products.find((p) => p.id === id)?.name || id;
  const getCouponEligibleProductIds = (coupon: Coupon): string[] => {
    const raw = (coupon as { eligibleProductIds?: unknown }).eligibleProductIds;
    if (!Array.isArray(raw)) return [];
    return raw.map((id) => String(id || "").trim()).filter(Boolean);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {isPrimary && (
        <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
            <Ticket className="w-5 h-5 text-primary" />Novo Cupom de Desconto
          </h2>
          <p className="text-muted-foreground text-sm mb-5">
            Crie cupons de desconto percentual ou valor fixo para seus clientes usarem no checkout.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Código do Cupom *</label>
              <input
                value={couponForm.code}
                onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value.toUpperCase().replace(/\s/g, "") })}
                placeholder="Ex: DESCONTO10, BEMVINDO, NATAL20..."
                className={`${inp} font-mono tracking-widest`}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Tipo de Desconto *</label>
              <select
                value={couponForm.discountType}
                onChange={(e) => setCouponForm({ ...couponForm, discountType: e.target.value })}
                className={`${inp} cursor-pointer`}
              >
                <option value="percent">Percentual (%)</option>
                <option value="fixed">Valor fixo (R$)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
                Valor do Desconto * {couponForm.discountType === "percent" ? "(% de 1 a 100)" : "(em R$)"}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  {couponForm.discountType === "percent" ? <Percent className="w-3.5 h-3.5" /> : "R$"}
                </span>
                <input
                  type="number" min="0.01" step={couponForm.discountType === "percent" ? "1" : "0.01"}
                  value={couponForm.discountValue}
                  onChange={(e) => setCouponForm({ ...couponForm, discountValue: e.target.value })}
                  placeholder={couponForm.discountType === "percent" ? "Ex: 10" : "Ex: 25"}
                  className={`${inp} pl-8`}
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
                Pedido mínimo (R$) <span className="font-normal normal-case text-muted-foreground">— opcional</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">R$</span>
                <input
                  type="number" min="0" step="0.01"
                  value={couponForm.minOrderValue}
                  onChange={(e) => setCouponForm({ ...couponForm, minOrderValue: e.target.value })}
                  placeholder="Ex: 150"
                  className={`${inp} pl-8`}
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
                Limite de usos <span className="font-normal normal-case text-muted-foreground">— opcional, sem limite se vazio</span>
              </label>
              <input
                type="number" min="1" step="1"
                value={couponForm.maxUses}
                onChange={(e) => setCouponForm({ ...couponForm, maxUses: e.target.value })}
                placeholder="Ex: 100"
                className={inp}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
                Produtos válidos para este cupom <span className="font-normal normal-case text-muted-foreground">— opcional, vazio = todos os produtos</span>
              </label>
              <div className="max-h-40 overflow-auto rounded-xl border border-border bg-white p-2 space-y-1">
                {products.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-2 py-1">Nenhum produto carregado.</p>
                ) : (
                  products.map((p) => {
                    const checked = couponForm.eligibleProductIds.includes(p.id);
                    return (
                      <label key={p.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded-lg hover:bg-muted/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...couponForm.eligibleProductIds, p.id]
                              : couponForm.eligibleProductIds.filter((id) => id !== p.id);
                            setCouponForm({ ...couponForm, eligibleProductIds: next });
                          }}
                        />
                        <span className="truncate">{p.name}</span>
                      </label>
                    );
                  })
                )}
              </div>
              {couponForm.eligibleProductIds.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {couponForm.eligibleProductIds.length} produto(s) selecionado(s). O desconto será aplicado somente sobre esses itens.
                </p>
              )}
            </div>
          </div>

          <Button
            onClick={createCoupon}
            className="mt-4 w-full gap-2"
            disabled={couponCreating || !couponForm.code.trim() || !couponForm.discountValue}
          >
            {couponCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Criar Cupom
          </Button>
        </div>
      )}

      <div>
        <h3 className="font-bold text-sm text-muted-foreground uppercase tracking-wide px-1 mb-3">
          Cupons Cadastrados ({coupons.length})
        </h3>

        {coupons.length === 0 ? (
          <div className="text-center py-12 bg-muted/30 rounded-2xl border border-dashed">
            <Ticket className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-semibold">Nenhum cupom cadastrado</p>
            <p className="text-sm text-muted-foreground mt-1">Crie o primeiro cupom acima.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {coupons.map((c) => {
              const eligibleIds = getCouponEligibleProductIds(c);
              return (
              <div key={c.id} className={`bg-card border rounded-2xl p-4 shadow-sm flex items-start gap-4 ${c.isActive ? "border-border/60" : "border-border/30 opacity-60"}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${c.discountType === "percent" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                  {c.discountType === "percent" ? <Percent className="w-5 h-5" /> : <span className="text-sm font-bold">R$</span>}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-base tracking-wide">{c.code}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${c.isActive ? "bg-green-100 text-green-800 border-green-200" : "bg-gray-100 text-gray-500 border-gray-200"}`}>
                      {c.isActive ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Desconto: <strong>
                      {c.discountType === "percent"
                        ? `${c.discountValue}%`
                        : `R$ ${c.discountValue.toFixed(2).replace(".", ",")}`}
                    </strong>
                    {c.minOrderValue && ` · Mínimo: R$ ${c.minOrderValue.toFixed(2).replace(".", ",")}`}
                    {c.maxUses && ` · Limite: ${c.usedCount}/${c.maxUses} usos`}
                    {!c.maxUses && ` · ${c.usedCount} uso${c.usedCount !== 1 ? "s" : ""}`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {eligibleIds.length > 0
                      ? `Válido somente para: ${eligibleIds.map(productNameById).join(", ")}`
                      : "Válido para todos os produtos"}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isPrimary && (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleCoupon(c.id, !c.isActive)}
                        title={c.isActive ? "Desativar" : "Ativar"}
                        className="text-muted-foreground hover:text-primary transition-colors"
                      >
                        {c.isActive
                          ? <IconLucide name="ToggleRight" className="w-6 h-6 text-primary" />
                          : <ToggleLeft className="w-6 h-6" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCoupon(c.id, c.code)}
                        disabled={couponDeleting === c.id}
                        className="text-muted-foreground hover:text-red-500 transition-colors"
                      >
                        {couponDeleting === c.id
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Trash2 className="w-4 h-4" />}
                      </button>
                    </>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// ProductsPanel
// ===========================================================================
const inp2 = "w-full h-11 px-4 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm transition-colors";

/**
 * Brazilian-currency masked input.
 * Displays as "1.150,00" when unfocused, allows free editing when focused.
 * Calls onChange with the parsed numeric value (or undefined if empty).
 */
function PriceInput({
  value, onChange, placeholder, className,
}: {
  value: number | null | undefined;
  onChange: (n: number | undefined) => void;
  placeholder?: string;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState("");

  // Format number → "1.150,00" (pt-BR)
  const format = (n: number | null | undefined) =>
    n != null ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";

  // Parse "1.150,00" or "1150" or "1150,50" → number
  const parse = (s: string): number | undefined => {
    const cleaned = s.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    return isNaN(n) ? undefined : n;
  };

  const displayValue = focused ? raw : format(value);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={displayValue}
      placeholder={placeholder ?? "0,00"}
      className={className}
      onFocus={() => {
        setRaw(value != null ? String(value).replace(".", ",") : "");
        setFocused(true);
      }}
      onChange={(e) => {
        const v = e.target.value;
        setRaw(v);
        onChange(parse(v));
      }}
      onBlur={() => {
        setFocused(false);
        const n = parse(raw);
        onChange(n);
      }}
    />
  );
}

function ProductsPanel({
  products, loading, productForm, setProductForm, productFormOpen, setProductFormOpen,
  productSaving, productDeleting, onSave, onDelete, onToggle, sellers,
  onRefreshProducts,
}: {
  products: AdminProduct[];
  loading: boolean;
  productForm: Partial<AdminProduct> & { _editing?: boolean };
  setProductForm: (f: Partial<AdminProduct> & { _editing?: boolean }) => void;
  productFormOpen: boolean;
  setProductFormOpen: (open: boolean) => void;
  productSaving: boolean;
  productDeleting: string | null;
  onSave: () => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, isActive: boolean) => void;
  sellers: Array<{ slug: string; whatsapp: string }>;
  onRefreshProducts: () => void;
}) {
  type BulkDiscountTier = {
    minQty: number;
    maxQty: number | null;
    unitPrice: number;
    label?: string | null;
  };

  type ProductVariantGroup = {
    name: string;
    options: string[];
  };

  const normalizeBulkDiscountTiers = (raw: unknown): BulkDiscountTier[] => {
    if (!Array.isArray(raw)) return [];
    const tiers = raw
      .map((tier) => {
        const item = tier as Record<string, unknown>;
        const minQty = Number(item.minQty);
        const maxQtyRaw = item.maxQty;
        const maxQty = maxQtyRaw == null ? null : Number(maxQtyRaw);
        const unitPrice = Number(item.unitPrice);
        const label = item.label == null ? null : String(item.label);

        if (!Number.isFinite(minQty) || minQty < 1) return null;
        if (maxQty !== null && (!Number.isFinite(maxQty) || maxQty < minQty)) return null;
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;

        return { minQty, maxQty, unitPrice, label };
      })
      .filter((tier): tier is BulkDiscountTier => Boolean(tier));

    return tiers.sort((a, b) => a.minQty - b.minQty);
  };

  const upsertFixedTier = (
    currentTiers: BulkDiscountTier[],
    quantity: number,
    unitPrice: number | undefined,
  ): BulkDiscountTier[] => {
    const normalized = [...currentTiers]
      .filter((tier) => tier.minQty !== quantity)
      .filter((tier) => !(quantity >= 4 && tier.maxQty === null));

    if (unitPrice == null || !Number.isFinite(unitPrice) || unitPrice <= 0) {
      return normalized.sort((a, b) => a.minQty - b.minQty);
    }

    normalized.push({
      minQty: quantity,
      maxQty: quantity >= 4 ? null : quantity,
      unitPrice,
      label: quantity >= 4 ? "4cx+" : `${quantity}cx`,
    });

    return normalized.sort((a, b) => a.minQty - b.minQty);
  };

  const getFixedTierPrice = (currentTiers: BulkDiscountTier[], quantity: number): number | null => {
    const tier = currentTiers.find((t) => t.minQty === quantity && (quantity < 4 ? t.maxQty === quantity : t.maxQty === null));
    return tier ? Number(tier.unitPrice) : null;
  };

  const normalizeVariantGroups = (raw: unknown): ProductVariantGroup[] => {
    if (!Array.isArray(raw)) return [];

    return raw
      .map((group) => {
        const item = group as Record<string, unknown>;
        const name = String(item.name ?? "").trim();
        const options = Array.isArray(item.options)
          ? item.options.map((option) => String(option ?? "").trim()).filter(Boolean)
          : [];

        if (!name || options.length === 0) return null;
        return { name, options };
      })
      .filter((group): group is ProductVariantGroup => Boolean(group));
  };

  const currentVariantGroups = normalizeVariantGroups((productForm as any).variantGroups);

  const fileRef = useRef<HTMLInputElement>(null);
  const backupFileRef = useRef<HTMLInputElement>(null);
  const [expandedLinks, setExpandedLinks] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productImageUploading, setProductImageUploading] = useState(false);
  const [productBackupExporting, setProductBackupExporting] = useState(false);
  const [productBackupImporting, setProductBackupImporting] = useState(false);
  const [pendingRestoreMode, setPendingRestoreMode] = useState<"merge" | "replace">("merge");
  const [costHistoryProductId, setCostHistoryProductId] = useState<string | null>(null);
  const [costHistoryProductName, setCostHistoryProductName] = useState("");
  const [costHistory, setCostHistory] = useState<Array<{ id: number; costPrice: number; changedAt: string }>>([]);
  const [costHistoryLoading, setCostHistoryLoading] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState("");
  const [newBrandInput, setNewBrandInput] = useState("");
  const [savedBrandOptions, setSavedBrandOptions] = useState<string[]>([]);
  const [removingCategory, setRemovingCategory] = useState(false);
  const [removingBrand, setRemovingBrand] = useState(false);
  const siteOrigin = window.location.origin;

  const categoryOptions = Array.from(new Set(
    products
      .map((p) => String(p.category || "").trim())
      .filter(Boolean),
  )).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const brandOptions = Array.from(
    products
      .map((p) => String((p as any).brand || "").trim())
      .filter(Boolean)
      .reduce((map, brand) => {
        const key = brand.toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
        if (!map.has(key)) map.set(key, brand);
        return map;
      }, new Map<string, string>())
      .values(),
  ).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

  const normalizeOptions = React.useCallback((values: string[]) => {
    return Array.from(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .reduce((map, value) => {
          const key = value.toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
          if (!map.has(key)) map.set(key, value);
          return map;
        }, new Map<string, string>())
        .values(),
    ).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  }, []);

  const allBrandOptions = React.useMemo(
    () => normalizeOptions([...brandOptions, ...savedBrandOptions]),
    [brandOptions, normalizeOptions, savedBrandOptions],
  );

  const saveBrandsSetting = React.useCallback(async (brands: string[]) => {
    const payload = JSON.stringify(normalizeOptions(brands));
    await fetch(`${BASE}/api/admin/settings/admin_saved_brands`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ value: payload }),
    });
  }, [normalizeOptions]);

  const loadSavedBrands = React.useCallback(async () => {
    const res = await fetch(`${BASE}/api/admin/settings`, { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json() as Record<string, string>;
    const raw = String(data?.admin_saved_brands || "").trim();
    if (!raw) {
      setSavedBrandOptions([]);
      return;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    const normalized = normalizeOptions(parsed.map((item) => String(item || "")));
    setSavedBrandOptions(normalized);
  }, [normalizeOptions]);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        await loadSavedBrands();
      } catch {
        // ignore saved brands loading failures
      }
    })();

    return () => {
      active = false;
    };
  }, [loadSavedBrands]);

  const handleBackupDownload = async () => {
    setProductBackupExporting(true);
    try {
      const res = await fetch(`${BASE}/api/admin/products/backup`, { headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as { message?: string }));
        toast.error(err.message || "Erro ao gerar backup dos produtos.");
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] || `produtos-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Backup dos produtos baixado com sucesso!");
    } catch {
      toast.error("Erro ao gerar backup dos produtos.");
    } finally {
      setProductBackupExporting(false);
    }
  };

  const openRestorePicker = (mode: "merge" | "replace") => {
    if (mode === "replace") {
      const confirmed = window.confirm("Isso vai substituir todo o catálogo atual pelo conteúdo do backup. Deseja continuar?");
      if (!confirmed) return;
    }

    setPendingRestoreMode(mode);
    backupFileRef.current?.click();
  };

  const handleBackupRestore = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setProductBackupImporting(true);
    try {
      const raw = await file.text();
      const backup = JSON.parse(raw) as unknown;
      const res = await fetch(`${BASE}/api/admin/products/restore`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ mode: pendingRestoreMode, backup }),
      });
      const data = await res.json().catch(() => ({} as { message?: string; imported?: number; mode?: string }));
      if (!res.ok) {
        toast.error(data.message || "Erro ao restaurar backup dos produtos.");
        return;
      }

      await Promise.all([onRefreshProducts(), loadSavedBrands()]);
      const importedCount = Number(data.imported || 0);
      toast.success(
        pendingRestoreMode === "replace"
          ? `Backup restaurado com substituição total. ${importedCount} produto(s) carregado(s).`
          : `Backup restaurado. ${importedCount} produto(s) atualizado(s)/adicionado(s).`,
      );
    } catch {
      toast.error("Arquivo de backup inválido.");
    } finally {
      event.target.value = "";
      setProductBackupImporting(false);
    }
  };

  const openCostHistory = async (productId: string, productName: string) => {
    setCostHistoryProductId(productId);
    setCostHistoryProductName(productName);
    setCostHistory([]);
    setCostHistoryLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/products/${productId}/cost-history`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json() as { history: Array<{ id: number; costPrice: number; changedAt: string }> };
        setCostHistory(data.history);
      }
    } catch {
      // ignore
    } finally {
      setCostHistoryLoading(false);
    }
  };

  const normalizedProductSearch = productSearch.trim().toLowerCase();
  const visibleProducts = products.filter((p) => p.name.toLowerCase().includes(normalizedProductSearch));

  const copyLink = (link: string, key: string) => {
    navigator.clipboard.writeText(link).then(() => {
      setCopiedLink(key);
      setTimeout(() => setCopiedLink(null), 2000);
    });
  };

  const copyProductDetails = async (product: AdminProduct, mode: "cost" | "sale") => {
    const description = String(product.description || "").trim() || "-";
    const isPromoActive = product.promoPrice != null && (!product.promoEndsAt || new Date() < new Date(product.promoEndsAt));
    const salePrice = isPromoActive ? Number(product.promoPrice) : Number(product.price);
    const text = [
      `Produto: ${String(product.name || "Produto").trim() || "Produto"}`,
      `Descrição: ${description}`,
      mode === "cost"
        ? `Custo: ${formatCurrency(Number(product.costPrice || 0))}`
        : `Venda: ${formatCurrency(Number.isFinite(salePrice) ? salePrice : Number(product.price || 0))}`,
    ].join("\n");

    const copyMode = await copyText(text);
    toast.success(copyMode === "manual" ? "Texto aberto para copia manual." : "Texto copiado!");
  };

  const copyAllProductCosts = async () => {
    const text = visibleProducts
      .map((product) => `${String(product.name || "Produto").trim() || "Produto"} - ${formatCurrency(Number(product.costPrice || 0))}`)
      .join("\n");
    const copyMode = await copyText(text);
    toast.success(copyMode === "manual" ? "Lista aberta para copia manual." : "Lista de custos copiada!");
  };

  const copyAllProductSalePrices = async () => {
    const text = visibleProducts
      .map((product) => {
        const isPromoActive = product.promoPrice != null && (!product.promoEndsAt || new Date() < new Date(product.promoEndsAt));
        const salePrice = isPromoActive ? Number(product.promoPrice) : Number(product.price);
        return `${String(product.name || "Produto").trim() || "Produto"} - ${formatCurrency(Number.isFinite(salePrice) ? salePrice : Number(product.price || 0))}`;
      })
      .join("\n");
    const copyMode = await copyText(text);
    toast.success(copyMode === "manual" ? "Lista aberta para copia manual." : "Lista de venda copiada!");
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("Imagem muito grande. Máximo 10MB."); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      if (!src) return;
      const img = new Image();
      img.onload = async () => {
        const MAX = 800;
        const scale = img.width > MAX ? MAX / img.width : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) { setProductForm({ ...productForm, image: src }); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressedImage = canvas.toDataURL("image/jpeg", 0.82);

        try {
          setProductImageUploading(true);
          const res = await fetch(`${BASE}/api/admin/products/upload-image`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ imageData: compressedImage, productId: productForm.id ?? null }),
          });
          const data = await res.json().catch(() => ({})) as { message?: string; missing?: string[]; imageUrl?: string };
          if (!res.ok || !data?.imageUrl) {
            const missingText = Array.isArray(data?.missing) && data.missing.length > 0
              ? ` Faltando: ${data.missing.join(", ")}.`
              : "";
            throw new Error((data?.message || "Falha ao enviar imagem para o Cloudflare R2.") + missingText);
          }
          setProductForm({ ...productForm, image: data.imageUrl });
          toast.success("Imagem enviada para o R2.");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha ao enviar imagem para o Cloudflare R2.";
          toast.error(message);
        } finally {
          setProductImageUploading(false);
          e.target.value = "";
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const openCreate = () => {
    setProductForm({ unit: "unidade", isActive: true, isSoldOut: false, isLaunch: false, sortOrder: 0, costPrice: 0, bulkDiscountEnabled: false, bulkDiscountTiers: [], variantGroups: [] } as any);
    setNewCategoryInput("");
    setNewBrandInput("");
    setProductFormOpen(true);
  };

  const openEdit = (p: AdminProduct) => {
    setProductForm({ ...(p as any), bulkDiscountTiers: normalizeBulkDiscountTiers((p as any).bulkDiscountTiers), variantGroups: normalizeVariantGroups((p as any).variantGroups), _editing: true } as any);
    setNewCategoryInput("");
    setNewBrandInput("");
    setProductFormOpen(true);
  };

  const removeSelectedCategory = async () => {
    const targetCategory = String(productForm.category || "").trim();
    if (!targetCategory) {
      toast.error("Selecione uma categoria para remover.");
      return;
    }

    const affectedProducts = products.filter(
      (p) => String(p.category || "").trim().toLowerCase() === targetCategory.toLowerCase(),
    );

    if (affectedProducts.length === 0) {
      toast.info("Nenhum produto encontrado com essa categoria.");
      return;
    }

    const confirmed = window.confirm(
      `Remover a categoria "${targetCategory}" de ${affectedProducts.length} produto(s)? Eles ficarão como "Sem categoria".`,
    );
    if (!confirmed) return;

    setRemovingCategory(true);
    let successCount = 0;

    try {
      for (const product of affectedProducts) {
        const res = await fetch(`${BASE}/api/admin/products/${product.id}`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ category: "Sem categoria" }),
        });
        if (res.ok) {
          successCount += 1;
        }
      }

      if (successCount === 0) {
        toast.error("Não foi possível remover a categoria.");
        return;
      }

      setProductForm({ ...productForm, category: "" });
      onRefreshProducts();
      toast.success(`Categoria removida de ${successCount} produto(s).`);
    } catch {
      toast.error("Erro ao remover categoria.");
    } finally {
      setRemovingCategory(false);
    }
  };

  const removeSelectedBrand = async () => {
    const targetBrand = String((productForm as any).brand || "").trim();
    if (!targetBrand) {
      toast.error("Selecione uma marca para remover.");
      return;
    }

    const affectedProducts = products.filter(
      (p) => String((p as any).brand || "").trim().toLowerCase() === targetBrand.toLowerCase(),
    );

    if (affectedProducts.length === 0) {
      toast.info("Nenhum produto encontrado com essa marca.");
      return;
    }

    const confirmed = window.confirm(
      `Remover a marca "${targetBrand}" de ${affectedProducts.length} produto(s)? Eles ficarão sem marca.`,
    );
    if (!confirmed) return;

    setRemovingBrand(true);
    let successCount = 0;

    try {
      for (const product of affectedProducts) {
        const res = await fetch(`${BASE}/api/admin/products/${product.id}`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ brand: null }),
        });
        if (res.ok) {
          successCount += 1;
        }
      }

      if (successCount === 0) {
        toast.error("Não foi possível remover a marca.");
        return;
      }

      setProductForm({ ...productForm, brand: null } as any);
      onRefreshProducts();
      toast.success(`Marca removida de ${successCount} produto(s).`);
    } catch {
      toast.error("Erro ao remover marca.");
    } finally {
      setRemovingBrand(false);
    }
  };

  const UNITS = ["unidade", "caixa", "caneta", "frasco", "par", "kit"];
  const currentTiers = normalizeBulkDiscountTiers((productForm as any).bulkDiscountTiers);
  const parsedCostPrice = Number(productForm.costPrice);
  const costPriceForProfit = Number.isFinite(parsedCostPrice) ? parsedCostPrice : 0;

  const renderUnitProfitHint = (
    saleValue: number | null | undefined,
    emptyText = "Defina um valor de venda para ver o lucro.",
    quantity = 1,
    quantityLabel?: string,
  ) => {
    const sale = Number(saleValue);
    if (!Number.isFinite(sale) || sale <= 0) {
      return <p className="mt-1 text-xs text-muted-foreground">{emptyText}</p>;
    }

    const profit = sale - costPriceForProfit;
    const totalProfit = profit * Math.max(1, quantity);
    const margin = sale > 0 ? (profit / sale) * 100 : 0;
    const isNegative = profit < 0;
    const label = quantityLabel || `${quantity}x`;

    return (
      <div className={`mt-1 text-xs font-medium ${isNegative ? "text-red-600" : "text-emerald-700"}`}>
        <p>{isNegative ? "Prejuízo" : "Lucro"} unitário: {formatCurrency(profit)} ({margin.toFixed(1)}%)</p>
        {quantity > 1 && <p>{isNegative ? "Prejuízo" : "Lucro"} total {label}: {formatCurrency(totalProfit)}</p>}
      </div>
    );
  };

  const tierProfitSummary = [1, 2, 3, 4]
    .map((qty) => {
      const sale = Number(getFixedTierPrice(currentTiers, qty));
      if (!Number.isFinite(sale) || sale <= 0) return null;

      const unitProfit = sale - costPriceForProfit;
      const totalProfit = unitProfit * qty;
      const margin = sale > 0 ? (unitProfit / sale) * 100 : 0;

      return {
        qty,
        label: qty >= 4 ? "4cx+" : `${qty}cx`,
        unitProfit,
        totalProfit,
        margin,
      };
    })
    .filter((item): item is { qty: number; label: string; unitProfit: number; totalProfit: number; margin: number } => item !== null);

  const bestTierByTotalProfit = tierProfitSummary.length > 0
    ? tierProfitSummary.reduce((best, current) => (current.totalProfit > best.totalProfit ? current : best))
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><ShoppingBag className="w-5 h-5 text-primary" />Catálogo de Produtos</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {visibleProducts.length} de {products.length} produto{products.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <input
            ref={backupFileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleBackupRestore}
          />
          <Button variant="outline" onClick={handleBackupDownload} disabled={productBackupExporting || productBackupImporting} className="gap-2">
            {productBackupExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Backup JSON
          </Button>
          <Button variant="outline" onClick={() => openRestorePicker("merge")} disabled={productBackupExporting || productBackupImporting} className="gap-2">
            {productBackupImporting && pendingRestoreMode === "merge" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Restaurar backup
          </Button>
          <Button variant="outline" onClick={() => openRestorePicker("replace")} disabled={productBackupExporting || productBackupImporting} className="gap-2 border-red-200 text-red-700 hover:bg-red-50">
            {productBackupImporting && pendingRestoreMode === "replace" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Substituir por backup
          </Button>
          <Button variant="outline" onClick={copyAllProductCosts} className="gap-2">
            <Copy className="w-4 h-4" />Copiar custo
          </Button>
          <Button variant="outline" onClick={copyAllProductSalePrices} className="gap-2">
            <Copy className="w-4 h-4" />Copiar venda
          </Button>
          <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" />Novo Produto</Button>
        </div>
      </div>

      <div className="relative">
        <IconLucide name="Search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={productSearch}
          onChange={(e) => setProductSearch(e.target.value)}
          placeholder="Pesquisar produto por nome..."
          className="w-full h-11 pl-10 pr-4 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm"
        />
      </div>

      {/* Product form modal */}
      <AnimatePresence>
        {productFormOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-start sm:items-center justify-center px-3 py-3 sm:p-4 overflow-y-auto"
            onClick={(e) => { if (e.target === e.currentTarget) { setProductFormOpen(false); setProductForm({}); } }}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-2xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh] flex flex-col overflow-hidden my-auto">
              <div className="flex items-center justify-between px-4 sm:px-8 pt-4 sm:pt-8 pb-3 sm:pb-4 border-b shrink-0">
                <h3 className="text-xl font-bold">{productForm._editing ? "Editar Produto" : "Novo Produto"}</h3>
                <Button size="icon" variant="ghost" onClick={() => { setProductFormOpen(false); setProductForm({}); }}><X className="w-5 h-5" /></Button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-4 sm:py-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Name */}
                  <div className="sm:col-span-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Nome do Produto *</label>
                    <input value={productForm.name || ""} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} placeholder="Ex: Caneta Importada Premium" className={inp2} />
                  </div>

                  {/* Description */}
                  <div className="sm:col-span-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Descrição</label>
                    <textarea value={productForm.description || ""} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} placeholder="Descreva o produto..." rows={3} className="w-full px-4 py-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm transition-colors resize-none" />
                  </div>

                  {/* Category */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Categoria *</label>
                    <input
                      list="admin-category-options"
                      value={productForm.category || ""}
                      onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
                      placeholder="Digite uma categoria nova ou existente"
                      className={inp2}
                    />
                    <datalist id="admin-category-options">
                      {categoryOptions.map((category) => (
                        <option key={category} value={category} />
                      ))}
                    </datalist>
                    <div className="mt-2 flex gap-2">
                      <input
                        value={newCategoryInput}
                        onChange={(e) => setNewCategoryInput(e.target.value)}
                        placeholder="Cadastrar nova categoria"
                        className={inp2}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const next = String(newCategoryInput || "").trim();
                          if (!next) { toast.error("Digite uma categoria válida."); return; }
                          setProductForm({ ...productForm, category: next });
                          setNewCategoryInput("");
                        }}
                      >
                        Cadastrar
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Campo livre: pode escrever qualquer categoria.</p>
                    <div className="mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full border-red-200 text-red-700 hover:bg-red-50"
                        disabled={removingCategory || !String(productForm.category || "").trim()}
                        onClick={removeSelectedCategory}
                      >
                        {removingCategory ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        <span className="ml-1">Remover categoria selecionada</span>
                      </Button>
                    </div>
                  </div>

                  {/* Brand */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Marca</label>
                    <input
                      list="admin-brand-options"
                      value={String((productForm as any).brand || "")}
                      onChange={(e) => setProductForm({ ...productForm, brand: e.target.value } as any)}
                      placeholder="Digite uma marca nova ou existente"
                      className={inp2}
                    />
                    <datalist id="admin-brand-options">
                      {allBrandOptions.map((brand) => (
                        <option key={brand} value={brand} />
                      ))}
                    </datalist>
                    <div className="mt-2 flex gap-2">
                      <input
                        value={newBrandInput}
                        onChange={(e) => setNewBrandInput(e.target.value)}
                        placeholder="Cadastrar nova marca"
                        className={inp2}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={async () => {
                          const next = String(newBrandInput || "").trim();
                          if (!next) { toast.error("Digite uma marca válida."); return; }
                          setProductForm({ ...productForm, brand: next } as any);
                          setNewBrandInput("");

                          const exists = allBrandOptions.some((brand) =>
                            brand.toLocaleLowerCase("pt-BR") === next.toLocaleLowerCase("pt-BR"),
                          );
                          if (exists) return;

                          const updatedBrands = normalizeOptions([...allBrandOptions, next]);
                          setSavedBrandOptions(updatedBrands);
                          try {
                            await saveBrandsSetting(updatedBrands);
                            toast.success("Marca cadastrada na lista.");
                          } catch {
                            toast.error("Marca aplicada, mas falhou ao salvar na lista.");
                          }
                        }}
                      >
                        Cadastrar
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Campo livre: pode escrever qualquer marca.</p>
                    <div className="mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full border-red-200 text-red-700 hover:bg-red-50"
                        disabled={removingBrand || !String((productForm as any).brand || "").trim()}
                        onClick={removeSelectedBrand}
                      >
                        {removingBrand ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        <span className="ml-1">Remover marca selecionada</span>
                      </Button>
                    </div>
                  </div>

                  {/* Unit */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Unidade</label>
                    <select value={productForm.unit || "unidade"} onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })} className={`${inp2} cursor-pointer`}>
                      {UNITS.map((u) => <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>)}
                    </select>
                  </div>

                  {/* Price */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Preço Regular (R$) *</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold select-none">R$</span>
                      <PriceInput
                        value={productForm.price}
                        onChange={(n) => setProductForm({ ...productForm, price: n })}
                        placeholder="1.150,00"
                        className={`${inp2} pl-9`}
                      />
                    </div>
                    {renderUnitProfitHint(productForm.price)}
                  </div>

                  {/* Cost price */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preço de Custo (R$)</label>
                      {productForm._editing && productForm.id && (
                        <button
                          type="button"
                          onClick={() => openCostHistory(productForm.id!, productForm.name || "")}
                          className="flex items-center gap-1 text-xs text-primary hover:underline"
                          title="Ver histórico de custo"
                        >
                          <Clock className="w-3 h-3" />Histórico
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold select-none">R$</span>
                      <PriceInput
                        value={productForm.costPrice}
                        onChange={(n) => setProductForm({ ...productForm, costPrice: n ?? 0 })}
                        placeholder="700,00"
                        className={`${inp2} pl-9`}
                      />
                    </div>
                  </div>

                  {/* Promo price */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Preço Promocional (R$) <span className="font-normal normal-case text-muted-foreground">— opcional</span></label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold select-none">R$</span>
                      <PriceInput
                        value={productForm.promoPrice}
                        onChange={(n) => setProductForm({ ...productForm, promoPrice: n ?? null })}
                        placeholder="999,00"
                        className={`${inp2} pl-9`}
                      />
                    </div>
                    {renderUnitProfitHint(productForm.promoPrice, "Sem preço promocional definido.")}
                  </div>

                  {/* Promo ends */}
                  <div className="sm:col-span-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1.5 block">
                      <Calendar className="w-3.5 h-3.5" />Promoção expira em <span className="font-normal normal-case text-muted-foreground">— deixe em branco para não expirar</span>
                    </label>
                    <input type="datetime-local" value={productForm.promoEndsAt ? (() => { const d = new Date(productForm.promoEndsAt!); d.setTime(d.getTime() - 3 * 60 * 60 * 1000); return d.toISOString().slice(0, 16); })() : ""} onChange={(e) => {
                          if (!e.target.value) { setProductForm({ ...productForm, promoEndsAt: null }); return; }
                          // Interpret input as São Paulo time (UTC-3) to get correct UTC timestamp
                          const utc = new Date(e.target.value + ":00-03:00").toISOString();
                          setProductForm({ ...productForm, promoEndsAt: utc });
                        }} className={`${inp2} cursor-pointer`} />
                  </div>

                  <div className="sm:col-span-2 rounded-2xl border border-border bg-muted/20 p-4 space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">Desconto Progressivo por Quantidade</label>
                      <p className="text-xs text-muted-foreground mt-1">Configure os preços unitários para 1cx, 2cx, 3cx e 4cx+.</p>
                    </div>

                    <div className="rounded-xl border border-border bg-white px-3 py-2">
                      {bestTierByTotalProfit ? (
                        <p className={`text-xs font-medium ${bestTierByTotalProfit.totalProfit < 0 ? "text-red-600" : "text-emerald-700"}`}>
                          Melhor faixa de lucro total: {bestTierByTotalProfit.label}
                          {bestTierByTotalProfit.qty >= 4 ? " (mín. 4)" : ""}
                          {" "}- {bestTierByTotalProfit.totalProfit < 0 ? "Prejuízo" : "Lucro"} total {formatCurrency(bestTierByTotalProfit.totalProfit)}
                          {" "}({bestTierByTotalProfit.margin.toFixed(1)}% unit.)
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Preencha os preços das faixas para ver a melhor oportunidade de lucro.</p>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ativar estratégia</label>
                      <button
                        type="button"
                        onClick={() => setProductForm({ ...(productForm as any), bulkDiscountEnabled: !(productForm as any).bulkDiscountEnabled } as any)}
                        className="text-muted-foreground hover:text-emerald-600 transition-colors"
                      >
                        {(productForm as any).bulkDiscountEnabled === true
                          ? <IconLucide name="ToggleRight" className="w-7 h-7 text-emerald-600" />
                          : <ToggleLeft className="w-7 h-7" />}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[1, 2, 3, 4].map((qty) => {
                        const value = getFixedTierPrice(currentTiers, qty);
                        return (
                          <div key={qty}>
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
                              {qty >= 4 ? "4cx+" : `${qty}cx`} (R$ por unidade)
                            </label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold select-none">R$</span>
                              <PriceInput
                                value={value}
                                onChange={(n) => {
                                  const next = upsertFixedTier(currentTiers, qty, n);
                                  setProductForm({ ...(productForm as any), bulkDiscountTiers: next } as any);
                                }}
                                placeholder={qty >= 4 ? "849,00" : "899,00"}
                                className={`${inp2} pl-9`}
                              />
                            </div>
                            {renderUnitProfitHint(
                              value,
                              "Defina um valor de venda para ver o lucro.",
                              qty,
                              qty >= 4 ? "4cx+ (mín. 4)" : `${qty}cx`,
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="sm:col-span-2 rounded-2xl border border-border bg-muted/20 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">Variantes do Produto</label>
                        <p className="text-xs text-muted-foreground mt-1">Exemplo: Cor, Numeração, Tamanho.</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const next = [...currentVariantGroups, { name: "", options: [] }];
                          setProductForm({ ...(productForm as any), variantGroups: next } as any);
                        }}
                      >
                        <Plus className="w-4 h-4 mr-1" />Adicionar variante
                      </Button>
                    </div>

                    {currentVariantGroups.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Sem variantes. O cliente compra sem seleção adicional.</p>
                    ) : (
                      <div className="space-y-3">
                        {currentVariantGroups.map((group, groupIndex) => (
                          <div key={`${group.name}-${groupIndex}`} className="rounded-xl border border-border bg-white p-3 space-y-2">
                            <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
                              <div className="sm:col-span-2">
                                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Nome da variante</label>
                                <input
                                  value={group.name}
                                  onChange={(event) => {
                                    const next = currentVariantGroups.map((item, index) => index === groupIndex
                                      ? { ...item, name: event.target.value }
                                      : item);
                                    setProductForm({ ...(productForm as any), variantGroups: next } as any);
                                  }}
                                  placeholder="Ex: Cor"
                                  className={inp2}
                                />
                              </div>
                              <div className="sm:col-span-4">
                                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Opções (separadas por vírgula)</label>
                                <input
                                  value={group.options.join(", ")}
                                  onChange={(event) => {
                                    const options = event.target.value
                                      .split(",")
                                      .map((value) => value.trim())
                                      .filter(Boolean);
                                    const next = currentVariantGroups.map((item, index) => index === groupIndex
                                      ? { ...item, options }
                                      : item);
                                    setProductForm({ ...(productForm as any), variantGroups: next } as any);
                                  }}
                                  placeholder="Ex: Preta, Branca, Azul"
                                  className={inp2}
                                />
                              </div>
                            </div>
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                variant="outline"
                                className="border-red-200 text-red-700 hover:bg-red-50"
                                onClick={() => {
                                  const next = currentVariantGroups.filter((_, index) => index !== groupIndex);
                                  setProductForm({ ...(productForm as any), variantGroups: next } as any);
                                }}
                              >
                                <Trash2 className="w-4 h-4 mr-1" />Remover
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Sort order */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Ordem de exibição</label>
                    <input type="number" step="1" min="0" value={productForm.sortOrder ?? 0} onChange={(e) => setProductForm({ ...productForm, sortOrder: parseInt(e.target.value) || 0 })} className={inp2} />
                  </div>

                  {/* Active */}
                  <div className="flex items-center gap-3 self-end pb-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ativo</label>
                    <button type="button" onClick={() => setProductForm({ ...productForm, isActive: !productForm.isActive })} className="text-muted-foreground hover:text-primary transition-colors">
                      {productForm.isActive !== false ? <IconLucide name="ToggleRight" className="w-7 h-7 text-primary" /> : <ToggleLeft className="w-7 h-7" />}
                    </button>
                  </div>

                  {/* Sold out */}
                  <div className="flex items-center gap-3 self-end pb-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Esgotado</label>
                    <button type="button" onClick={() => setProductForm({ ...productForm, isSoldOut: !productForm.isSoldOut })} className="text-muted-foreground hover:text-destructive transition-colors">
                      {productForm.isSoldOut === true ? <IconLucide name="ToggleRight" className="w-7 h-7 text-destructive" /> : <ToggleLeft className="w-7 h-7" />}
                    </button>
                  </div>

                  {/* Launch */}
                  <div className="flex items-center gap-3 self-end pb-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Lançamento</label>
                    <button type="button" onClick={() => setProductForm({ ...productForm, isLaunch: !productForm.isLaunch })} className="text-muted-foreground hover:text-blue-600 transition-colors">
                      {productForm.isLaunch === true ? <IconLucide name="ToggleRight" className="w-7 h-7 text-blue-600" /> : <ToggleLeft className="w-7 h-7" />}
                    </button>
                  </div>
                </div>

                {/* Image upload */}
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Imagem do Produto <span className="font-normal normal-case text-muted-foreground">— armazenada no Cloudflare R2</span></label>
                  <div className="flex flex-col sm:flex-row gap-4 items-start">
                    {productForm.image ? (
                      <div className="relative w-24 h-24 rounded-xl overflow-hidden border-2 border-border flex-shrink-0">
                        <img src={productForm.image} alt="preview" className="w-full h-full object-cover" />
                        <button type="button" onClick={() => setProductForm({ ...productForm, image: null })} className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 hover:bg-black/80">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="w-24 h-24 rounded-xl border-2 border-dashed border-border flex items-center justify-center text-muted-foreground flex-shrink-0">
                        <ImageOff className="w-8 h-8" />
                      </div>
                    )}
                    <label className="w-full sm:flex-1 flex flex-col items-center justify-center min-h-24 rounded-xl border-2 border-dashed border-border hover:border-primary cursor-pointer transition-colors bg-muted/20 hover:bg-primary/5 px-4 py-3 text-center">
                      <input type="file" accept="image/*" className="hidden" ref={fileRef} onChange={handleImageUpload} disabled={productImageUploading} />
                      {productImageUploading ? <Loader2 className="w-6 h-6 text-muted-foreground mb-1 animate-spin" /> : <Upload className="w-6 h-6 text-muted-foreground mb-1" />}
                      <p className="text-sm font-medium text-muted-foreground">{productImageUploading ? "Enviando para o R2..." : "Clique para selecionar imagem"}</p>
                      <p className="text-xs text-muted-foreground">JPG, PNG, WebP · otimizada antes do upload</p>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-3 px-4 sm:px-8 pb-4 sm:pb-8 pt-3 border-t shrink-0 bg-white">
                <Button variant="outline" className="flex-1" onClick={() => { setProductFormOpen(false); setProductForm({}); }}>Cancelar</Button>
                <Button className="flex-1 gap-2" disabled={productSaving || productImageUploading || !productForm.name?.trim() || !productForm.category?.trim() || !productForm.price} onClick={onSave}>
                  {productSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  {productForm._editing ? "Salvar alterações" : "Criar produto"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Product list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-16 bg-muted/30 rounded-2xl border border-dashed">
          <IconLucide name="Package2" className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="font-semibold text-lg">Nenhum produto cadastrado</p>
          <p className="text-sm text-muted-foreground mb-6">Clique em "Novo Produto" para começar.</p>
          <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" />Novo Produto</Button>
        </div>
      ) : visibleProducts.length === 0 ? (
        <div className="text-center py-16 bg-muted/30 rounded-2xl border border-dashed">
          <IconLucide name="Search" className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="font-semibold text-lg">Nenhum produto encontrado</p>
          <p className="text-sm text-muted-foreground mb-6">Tente outro nome na busca.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleProducts.map((p) => {
            const effectivePrice = (p.promoPrice && (!p.promoEndsAt || new Date() < new Date(p.promoEndsAt))) ? p.promoPrice : p.price;
            return (
              <div key={p.id} className={`bg-card border rounded-2xl shadow-sm overflow-hidden ${!p.isActive ? "opacity-60" : ""}`}>
                <div className="flex gap-4 p-4">
                  {/* Image */}
                  <div className="w-16 h-16 rounded-xl flex-shrink-0 overflow-hidden border border-border bg-muted flex items-center justify-center">
                    {p.image ? (
                      <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <ImageOff className="w-7 h-7 text-muted-foreground/40" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-bold text-sm truncate">{p.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{p.unit}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{p.category}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">Custo: {formatCurrency(Number(p.costPrice || 0))}</span>
                      {(p as any).bulkDiscountEnabled === true && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Promo progressiva ativa</span>}
                      {!p.isActive && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Inativo</span>}
                      {p.isSoldOut && <span className="text-xs px-2 py-0.5 rounded-full bg-red-600 text-white">Esgotado</span>}
                      {p.isLaunch && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-600 text-white">Lançamento</span>}
                    </div>
                    {p.description && <p className="text-xs text-muted-foreground truncate">{p.description}</p>}
                    <div className="flex items-center gap-3 mt-1">
                      <span className="font-bold text-primary text-sm">{formatCurrency(effectivePrice)}</span>
                      {p.promoPrice && effectivePrice === p.promoPrice && (
                        <span className="text-xs line-through text-muted-foreground">{formatCurrency(p.price)}</span>
                      )}
                      {p.promoEndsAt && new Date() < new Date(p.promoEndsAt) && (
                        <span className="text-xs text-orange-600 flex items-center gap-0.5">
                          <Calendar className="w-3 h-3" />
                          até {formatDateOnlyBR(p.promoEndsAt)}
                        </span>
                      )}
                    </div>
                    {normalizeBulkDiscountTiers((p as any).bulkDiscountTiers).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {normalizeBulkDiscountTiers((p as any).bulkDiscountTiers).map((tier) => {
                          const label = tier.maxQty == null ? `${tier.minQty}cx+` : `${tier.minQty}cx`;
                          return (
                            <span key={`${p.id}-${label}`} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                              {label}: {formatCurrency(tier.unitPrice)}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => copyProductDetails(p, "cost")}
                      title="Copiar descrição + custo"
                      className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-colors"
                    >
                      Desc + Custo
                    </button>
                    <button
                      type="button"
                      onClick={() => copyProductDetails(p, "sale")}
                      title="Copiar descrição + valor de venda"
                      className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-colors"
                    >
                      Desc + Venda
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedLinks(expandedLinks === p.id ? null : p.id)}
                      title="Links de checkout por vendedor"
                      className={`text-muted-foreground hover:text-primary transition-colors p-1 ${expandedLinks === p.id ? "text-primary" : ""}`}
                    >
                      <LinkIcon className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => onToggle(p.id, !p.isActive)} title={p.isActive ? "Desativar" : "Ativar"} className="text-muted-foreground hover:text-primary transition-colors">
                      {p.isActive ? <IconLucide name="ToggleRight" className="w-6 h-6 text-primary" /> : <ToggleLeft className="w-6 h-6" />}
                    </button>
                    <button type="button" onClick={() => openEdit(p)} className="text-muted-foreground hover:text-primary transition-colors p-1">
                      <Info className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => onDelete(p.id)} disabled={productDeleting === p.id} className="text-muted-foreground hover:text-red-500 transition-colors p-1">
                      {productDeleting === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Seller checkout links — expandable */}
                {expandedLinks === p.id && (
                  <div className="border-t border-border/60 bg-muted/30 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1.5">
                      <LinkIcon className="w-3.5 h-3.5" />
                      Links de Checkout por Vendedor
                    </p>
                    {sellers.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhum vendedor cadastrado ainda. Adicione vendedores na aba "Vendedores".</p>
                    ) : (
                      <div className="space-y-2">
                        {sellers.map((s) => {
                          const link = `${siteOrigin}/${s.slug}/checkout?product=${p.id}`;
                          const key = `${p.id}-${s.slug}`;
                          return (
                            <div key={s.slug} className="flex items-center gap-2 bg-white border border-border/60 rounded-xl px-3 py-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-primary truncate capitalize">{s.slug}</p>
                                <p className="text-[11px] text-muted-foreground truncate font-mono">{link}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => copyLink(link, key)}
                                className="flex-shrink-0 flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-primary/5"
                              >
                                {copiedLink === key ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                                {copiedLink === key ? "Copiado!" : "Copiar"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Cost Price History Modal */}
      {costHistoryProductId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h3 className="text-base font-bold">Histórico de Custo</h3>
                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[260px]">{costHistoryProductName}</p>
              </div>
              <button type="button" onClick={() => setCostHistoryProductId(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {costHistoryLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : costHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhuma alteração registrada ainda.<br />O histórico é gerado a cada vez que o preço de custo é alterado e salvo.</p>
              ) : (
                <div className="space-y-0">
                  {costHistory.map((entry, idx) => (
                    <div key={entry.id} className="flex items-start gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${idx === 0 ? "bg-primary" : "bg-gray-300"}`} />
                        {idx < costHistory.length - 1 && <div className="w-0.5 flex-1 bg-gray-200 my-1" style={{ minHeight: 24 }} />}
                      </div>
                      <div className="pb-4">
                        <p className="text-sm font-semibold text-foreground">{formatCurrency(entry.costPrice)}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(entry.changedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </p>
                        {idx === 0 && <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">Última alteração</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// ConfiguracoesPanel — logo, banner desktop, banner mobile
// ===========================================================================
type ImageResizeMode = "auto" | "contain" | "cover";

function ImageUploadCard({
  title, description, settingKey, currentSrc, loading,
  targetWidth, targetHeight, showResizeModeSelector = false,
  currentScale,
  onScaleSave,
  onSave, onDelete,
}: {
  title: string; description: string; settingKey: string;
  currentSrc?: string; loading: boolean;
  targetWidth?: number; targetHeight?: number; showResizeModeSelector?: boolean;
  currentScale?: number;
  onScaleSave?: (value: number) => void;
  onSave: (key: string, value: string) => void;
  onDelete: (key: string) => void;
}) {
  const [resizeMode, setResizeMode] = useState<ImageResizeMode>("cover");
  const [logoScale, setLogoScale] = useState(Number.isFinite(Number(currentScale)) ? Number(currentScale) : 180);
  const isLogoCard = settingKey === "logo";

  useEffect(() => {
    if (isLogoCard) {
      setLogoScale(Number.isFinite(Number(currentScale)) ? Number(currentScale) : 180);
    }
  }, [currentScale, isLogoCard]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { toast.error("Arquivo muito grande. Máximo 15MB."); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      if (!src) return;
      const img = new Image();
      img.onload = () => {
        const fallbackMaxWidth = settingKey === "logo" ? 400 : settingKey.includes("mobile") ? 800 : 1920;
        const effectiveMode = showResizeModeSelector ? resizeMode : (targetWidth && targetHeight ? "cover" : "auto");
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) { onSave(settingKey, src); return; }

        const drawContainWithTrimmedEdges = () => {
          const sourceCanvas = document.createElement("canvas");
          sourceCanvas.width = img.width;
          sourceCanvas.height = img.height;
          const sourceCtx = sourceCanvas.getContext("2d");
          if (!sourceCtx) return false;
          sourceCtx.drawImage(img, 0, 0);

          const imageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
          const { data, width, height } = imageData;
          let left = width;
          let top = height;
          let right = -1;
          let bottom = -1;
          const isVisiblePixel = (index: number) => {
            const alpha = data[index + 3] ?? 0;
            if (alpha < 8) return false;
            const red = data[index] ?? 0;
            const green = data[index + 1] ?? 0;
            const blue = data[index + 2] ?? 0;
            return !(red > 248 && green > 248 && blue > 248);
          };

          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              const index = (y * width + x) * 4;
              if (!isVisiblePixel(index)) continue;
              if (x < left) left = x;
              if (y < top) top = y;
              if (x > right) right = x;
              if (y > bottom) bottom = y;
            }
          }

          const hasTrimBounds = right >= left && bottom >= top;
          const cropX = hasTrimBounds ? left : 0;
          const cropY = hasTrimBounds ? top : 0;
          const cropWidth = hasTrimBounds ? (right - left + 1) : width;
          const cropHeight = hasTrimBounds ? (bottom - top + 1) : height;

          const maxWidth = fallbackMaxWidth;
          const scale = cropWidth > maxWidth ? maxWidth / cropWidth : 1;
          canvas.width = Math.max(1, Math.round(cropWidth * scale));
          canvas.height = Math.max(1, Math.round(cropHeight * scale));
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          ctx.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
          return true;
        };

        if (targetWidth && targetHeight && effectiveMode !== "auto") {
          if (effectiveMode === "contain" && !isLogoCard && drawContainWithTrimmedEdges()) {
            const compressed = canvas.toDataURL("image/jpeg", 0.82);
            onSave(settingKey, compressed);
            return;
          }

          canvas.width = targetWidth;
          canvas.height = targetHeight;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          const scale = effectiveMode === "cover"
            ? Math.max(targetWidth / img.width, targetHeight / img.height)
            : Math.min(targetWidth / img.width, targetHeight / img.height);
          const drawWidth = Math.round(img.width * scale);
          const drawHeight = Math.round(img.height * scale);
          const offsetX = Math.round((targetWidth - drawWidth) / 2);
          const offsetY = Math.round((targetHeight - drawHeight) / 2);
          ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
        } else {
          const scale = img.width > fallbackMaxWidth ? fallbackMaxWidth / img.width : 1;
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }

        const compressed = canvas.toDataURL("image/jpeg", 0.82);
        onSave(settingKey, compressed);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const handleLogoScaleChange = (value: number) => {
    setLogoScale(value);
    onScaleSave?.(value);
  };

  return (
    <div className={`bg-white border border-border/60 rounded-2xl p-6 shadow-sm ${settingKey === "logo" ? "shadow-[0_8px_24px_rgba(0,0,0,0.04)]" : ""}`}>
      <h3 className="text-base font-bold mb-0.5">{title}</h3>
      <p className="text-muted-foreground text-sm mb-4">{description}</p>

      {showResizeModeSelector && targetWidth && targetHeight && (
        <div className="mb-4 rounded-xl border border-dashed border-border/70 bg-muted/20 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Dimensão da imagem</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="text-sm text-foreground font-medium">
              {targetWidth}×{targetHeight}px
            </div>
            <select
              value={resizeMode}
              onChange={(e) => setResizeMode(e.target.value as ImageResizeMode)}
              className="h-10 w-full sm:w-auto px-3 rounded-xl border border-input bg-white text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary cursor-pointer"
            >
              <option value="cover">Preencher e cortar</option>
              <option value="contain">Ajustar sem cortar</option>
              <option value="auto">Ajuste automático</option>
            </select>
          </div>
        </div>
      )}

      {isLogoCard && (
        <div className="mb-4 rounded-xl border border-dashed border-amber-200 bg-amber-50/60 p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Tamanho da logo</p>
            <span className="text-sm font-bold text-amber-800">{logoScale}%</span>
          </div>
          <input
            type="range"
            min={100}
            max={240}
            step={1}
            value={logoScale}
            onChange={(e) => handleLogoScaleChange(Number(e.target.value))}
            className="w-full h-2 rounded-full appearance-none cursor-pointer accent-amber-600"
          />
          <div className="mt-2 flex items-center justify-between text-[11px] text-amber-700/80">
            <span>Menor</span>
            <span>Maior</span>
          </div>
        </div>
      )}

      {/* Preview */}
      {currentSrc ? (
        <div className="relative mb-4">
          <div className={`w-full rounded-2xl border bg-gradient-to-b from-white to-amber-50/20 flex items-center justify-center overflow-hidden ${isLogoCard ? "h-36 sm:h-40 p-4" : "max-h-48 p-2"}`}>
            {isLogoCard ? (
              <div style={{ width: `${logoScale}px`, maxWidth: "100%" }} className="flex items-center justify-center">
                <img src={currentSrc} alt={title} className="w-full h-auto object-contain" />
              </div>
            ) : (
              <img
                src={currentSrc}
                alt={title}
                className={`w-full h-full object-contain ${isLogoCard ? "max-h-32 sm:max-h-36" : "max-h-48"}`}
              />
            )}
          </div>
          <button
            onClick={() => onDelete(settingKey)}
            disabled={loading}
            className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-lg p-1.5 shadow-md"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
          </button>
        </div>
      ) : (
        <div className={`w-full rounded-2xl border-2 border-dashed border-border bg-muted/20 flex flex-col items-center justify-center mb-4 text-muted-foreground ${isLogoCard ? "h-36 sm:h-40" : "h-32"}`}>
          <ImageOff className="w-8 h-8 mb-1.5" />
          <p className="text-sm font-medium">Sem imagem</p>
          <p className="text-xs">Padrão do sistema em uso</p>
        </div>
      )}

      <label className={`flex items-center justify-center gap-2 w-full h-11 rounded-xl cursor-pointer text-sm font-semibold transition-colors ${loading ? "bg-muted text-muted-foreground cursor-not-allowed" : isLogoCard ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-primary text-white hover:bg-primary/90"}`}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {currentSrc ? "Trocar imagem" : "Carregar imagem"}
        <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={loading} />
      </label>
    </div>
  );
}

function ConfiguracoesPanel({ adminTenantId, settings, loading, products, clientErrors, clientErrorsLoading, onRefreshClientErrors, onTestOutboundWebhook, onSave, onDelete, brevoApiKey, setBrevoApiKey, brevoConfigured, brevoTesting, onTestBrevoConnection }: {
  adminTenantId: string;
  settings: Record<string, string>;
  loading: Record<string, boolean>;
  products: Array<{ id?: string; name?: string | null; image?: string | null; price?: number | null; promoPrice?: number | null }>;
  clientErrors: ClientErrorEvent[];
  clientErrorsLoading: boolean;
  onRefreshClientErrors: () => void;
  onTestOutboundWebhook: () => void;
  onSave: (key: string, value: string) => void;
  onDelete: (key: string) => void;
  brevoApiKey: string;
  setBrevoApiKey: (v: string) => void;
  brevoConfigured: boolean;
  brevoTesting: boolean;
  onTestBrevoConnection: () => void;
}) {
  const [sitePw, setSitePw] = useState(settings["site_password"] ?? "");
  const [paymentPw, setPaymentPw] = useState(settings["payment_password"] ?? "");
  const [outboundUrl, setOutboundUrl] = useState(settings["outbound_webhook_url"] ?? "");
  const [outboundSecret, setOutboundSecret] = useState(settings["outbound_webhook_secret"] ?? "");
  const [showSitePw, setShowSitePw] = useState(false);
  const [showPaymentPw, setShowPaymentPw] = useState(false);
  const [showOutboundSecret, setShowOutboundSecret] = useState(false);
  const [freeShippingMinSubtotal, setFreeShippingMinSubtotal] = useState(settings["checkout_free_shipping_min_subtotal"] ?? "");
  const [siteDisplayName, setSiteDisplayName] = useState(settings["site_name"] ?? "");
  const [supportWhatsapp, setSupportWhatsapp] = useState(String(settings["support_whatsapp"] ?? "").replace(/\D/g, ""));
  const [storePrimaryColor, setStorePrimaryColor] = useState(normalizeHexColor(settings["store_primary_color"] ?? "") || "#1A2B4A");
  const [storeThemePreset, setStoreThemePreset] = useState<"default" | "classic_clean" | "editorial_noir" | "market_showcase">(() => {
    const preset = String(settings["store_theme_preset"] || "").trim().toLowerCase();
    if (preset === "classic_clean") return "classic_clean";
    if (preset === "editorial_noir") return "editorial_noir";
    if (preset === "market_showcase") return "market_showcase";
    return "default";
  });
  const [promoCountdownEnabled, setPromoCountdownEnabled] = useState(!["0", "false", "off", "no", "disabled"].includes(String(settings["promo_countdown_enabled"] ?? "0").toLowerCase()));
  const [promoCountdownDateTime, setPromoCountdownDateTime] = useState(settings["promo_countdown_datetime"] ?? "");
  const [promoCountdownText, setPromoCountdownText] = useState(settings["promo_countdown_text"] ?? "");
  const [syncProductsFromLoja1Enabled, setSyncProductsFromLoja1Enabled] = useState(!["0", "false", "off", "no", "disabled"].includes(String(settings["tenant_sync_products_from_loja1"] ?? "0").toLowerCase()));
  const [promotionProductSearch, setPromotionProductSearch] = useState("");
  const pixEnabled = !["0", "false", "off", "no", "disabled"].includes(String(settings["checkout_enable_pix"] ?? "1").toLowerCase());
  const cardEnabled = !["0", "false", "off", "no", "disabled"].includes(String(settings["checkout_enable_card"] ?? "1").toLowerCase());
  const whatsappEnabled = !["0", "false", "off", "no", "disabled"].includes(String(settings["checkout_enable_whatsapp"] ?? "0").toLowerCase());
  const pixGateway = String(settings["checkout_pix_gateway"] ?? "appcnpay").toLowerCase() === "dentpeg" ? "dentpeg" : "appcnpay";
  const outboundEnabled = !["0", "false", "off", "no", "disabled"].includes(String(settings["outbound_webhook_enabled"] ?? "0").toLowerCase());
  const outboundEventNewOrder = !["0", "false", "off", "no", "disabled"].includes(String(settings["outbound_webhook_event_new_order"] ?? "1").toLowerCase());
  const outboundEventOrderPaid = !["0", "false", "off", "no", "disabled"].includes(String(settings["outbound_webhook_event_order_paid"] ?? "1").toLowerCase());

  useEffect(() => {
    setOutboundUrl(settings["outbound_webhook_url"] ?? "");
    setOutboundSecret(settings["outbound_webhook_secret"] ?? "");
    setFreeShippingMinSubtotal(settings["checkout_free_shipping_min_subtotal"] ?? "");
    setSiteDisplayName(settings["site_name"] ?? "");
    setSupportWhatsapp(String(settings["support_whatsapp"] ?? "").replace(/\D/g, ""));
    setStorePrimaryColor(normalizeHexColor(settings["store_primary_color"] ?? "") || "#1A2B4A");
    const preset = String(settings["store_theme_preset"] || "").trim().toLowerCase();
    if (preset === "classic_clean") setStoreThemePreset("classic_clean");
    else if (preset === "editorial_noir") setStoreThemePreset("editorial_noir");
    else if (preset === "market_showcase") setStoreThemePreset("market_showcase");
    else setStoreThemePreset("default");
    setPromoCountdownEnabled(!["0", "false", "off", "no", "disabled"].includes(String(settings["promo_countdown_enabled"] ?? "0").toLowerCase()));
    setPromoCountdownDateTime(settings["promo_countdown_datetime"] ?? "");
    setPromoCountdownText(settings["promo_countdown_text"] ?? "");
    setSyncProductsFromLoja1Enabled(!["0", "false", "off", "no", "disabled"].includes(String(settings["tenant_sync_products_from_loja1"] ?? "0").toLowerCase()));
  }, [settings]);

  const togglePaymentMethod = (key: "checkout_enable_pix" | "checkout_enable_card" | "checkout_enable_whatsapp", enabled: boolean) => {
    onSave(key, enabled ? "1" : "0");
  };

  const catalogBannerProductId = String(settings["catalog_banner_product_id"] ?? "").trim();
  const selectablePromotionProducts = products
    .filter((product) => String(product.id || "").trim() && String(product.name || "").trim())
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR", { sensitivity: "base" }));
  const selectedPromotionProduct = selectablePromotionProducts.find((product) => String(product.id || "").trim() === catalogBannerProductId) || null;
  const normalizedPromotionSearch = promotionProductSearch.trim().toLowerCase();
  const filteredPromotionProducts = selectablePromotionProducts
    .filter((product) => {
      if (!normalizedPromotionSearch) return true;
      return String(product.name || "").toLowerCase().includes(normalizedPromotionSearch);
    })
    .slice(0, 120);

  return (
    <div className="space-y-8">
      {/* ── Identidade Visual ─────────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
          <IconLucide name="Package2" className="w-5 h-5 text-primary" />
          Identidade Visual
        </h2>
        <p className="text-muted-foreground text-sm mb-5">
          Personalize o logo e os banners exibidos na loja. As imagens são aplicadas imediatamente após o upload.
        </p>

        <div className="mb-5 rounded-2xl border border-border/60 bg-card p-4 shadow-sm space-y-3">
          <h3 className="text-sm font-bold">Nome e WhatsApp da loja</h3>
          <p className="text-xs text-muted-foreground">Esses dados aparecem no rodapé e no botão de suporte da vitrine desta loja.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              type="text"
              value={siteDisplayName}
              onChange={(e) => setSiteDisplayName(e.target.value)}
              placeholder="Nome público da loja"
              className="h-10 w-full rounded-lg border border-border px-3 text-sm bg-white"
            />
            <input
              type="text"
              value={supportWhatsapp}
              onChange={(e) => setSupportWhatsapp(e.target.value.replace(/\D/g, ""))}
              placeholder="WhatsApp suporte (somente números, com DDI)"
              className="h-10 w-full rounded-lg border border-border px-3 text-sm bg-white"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!!loading["site_name"] || !!loading["support_whatsapp"]}
              onClick={() => {
                onSave("site_name", siteDisplayName.trim());
                onSave("support_whatsapp", supportWhatsapp.trim());
              }}
            >
              {(loading["site_name"] || loading["support_whatsapp"]) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar nome e WhatsApp
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!loading["site_name"] || !!loading["support_whatsapp"]}
              onClick={() => {
                setSiteDisplayName("");
                setSupportWhatsapp("");
                onDelete("site_name");
                onDelete("support_whatsapp");
              }}
            >
              Limpar
            </Button>
          </div>
        </div>

        {adminTenantId !== "tenant_loja1" ? (
          <div className="mb-5 rounded-2xl border border-border/60 bg-card p-4 shadow-sm space-y-3">
            <h3 className="text-sm font-bold">Produtos da Loja 1</h3>
            <p className="text-xs text-muted-foreground">A própria filial decide se quer receber e atualizar produtos vindos da Loja 1.</p>

            <label className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 bg-white">
              <span className="text-sm text-foreground">Aceitar atualização Fornecedor</span>
              <input
                type="checkbox"
                checked={syncProductsFromLoja1Enabled}
                onChange={(e) => setSyncProductsFromLoja1Enabled(e.target.checked)}
                className="h-4 w-4"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!!loading["tenant_sync_products_from_loja1"]}
                onClick={() => onSave("tenant_sync_products_from_loja1", syncProductsFromLoja1Enabled ? "1" : "0")}
              >
                {loading["tenant_sync_products_from_loja1"] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar sincronização
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mb-5 rounded-2xl border border-border/60 bg-card p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-bold">Cor principal da loja</h3>
              <p className="text-xs text-muted-foreground">Cada loja pode usar uma cor própria para botões e destaques.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Preview:</span>
              <span className="h-7 px-3 rounded-lg text-xs font-semibold text-white flex items-center" style={{ backgroundColor: storePrimaryColor }}>
                Botão
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="color"
              value={storePrimaryColor}
              onChange={(e) => setStorePrimaryColor(normalizeHexColor(e.target.value) || "#1A2B4A")}
              className="h-10 w-16 rounded-lg border border-border bg-white p-1 cursor-pointer"
              aria-label="Selecionar cor principal"
            />
            <input
              type="text"
              value={storePrimaryColor}
              onChange={(e) => {
                const raw = String(e.target.value || "").trim();
                if (!raw) {
                  setStorePrimaryColor("#1A2B4A");
                  return;
                }
                const normalized = normalizeHexColor(raw);
                if (normalized) setStorePrimaryColor(normalized);
              }}
              placeholder="#1A2B4A"
              className="h-10 w-full sm:w-44 rounded-lg border border-border px-3 text-sm bg-white"
            />
            <Button
              size="sm"
              className="h-10"
              disabled={!!loading["store_primary_color"]}
              onClick={() => onSave("store_primary_color", storePrimaryColor)}
            >
              {loading["store_primary_color"] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar cor
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-10"
              disabled={!!loading["store_primary_color"]}
              onClick={() => {
                setStorePrimaryColor("#1A2B4A");
                onDelete("store_primary_color");
              }}
            >
              Restaurar padrão
            </Button>
          </div>
        </div>

        <div className="mb-5 rounded-2xl border border-border/60 bg-card p-4 shadow-sm space-y-3">
          <div>
            <h3 className="text-sm font-bold">Tema da loja</h3>
            <p className="text-xs text-muted-foreground">Escolha um visual diferente por loja. O padrão mantém o tema original sem alterações.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => setStoreThemePreset("default")}
              className={`rounded-xl border p-3 text-left transition-colors ${storeThemePreset === "default" ? "border-primary bg-primary/5" : "border-border bg-white hover:bg-muted/40"}`}
            >
              <p className="text-sm font-semibold">Original (padrão)</p>
              <p className="text-xs text-muted-foreground mt-1">Mantém o layout e o estilo atual exatamente como já está.</p>
            </button>
            <button
              type="button"
              onClick={() => setStoreThemePreset("classic_clean")}
              className={`rounded-xl border p-3 text-left transition-colors ${storeThemePreset === "classic_clean" ? "border-primary bg-primary/5" : "border-border bg-white hover:bg-muted/40"}`}
            >
              <p className="text-sm font-semibold">Clássico Clean</p>
              <p className="text-xs text-muted-foreground mt-1">Visual claro, tipografia clássica e aparência mais sofisticada.</p>
            </button>
            <button
              type="button"
              onClick={() => setStoreThemePreset("editorial_noir")}
              className={`rounded-xl border p-3 text-left transition-colors ${storeThemePreset === "editorial_noir" ? "border-primary bg-primary/5" : "border-border bg-white hover:bg-muted/40"}`}
            >
              <p className="text-sm font-semibold">Editorial Noturno Luxo</p>
              <p className="text-xs text-muted-foreground mt-1">Estilo premium escuro, com cards sofisticados e mais presença visual.</p>
            </button>
            <button
              type="button"
              onClick={() => setStoreThemePreset("market_showcase")}
              className={`rounded-xl border p-3 text-left transition-colors ${storeThemePreset === "market_showcase" ? "border-primary bg-primary/5" : "border-border bg-white hover:bg-muted/40"}`}
            >
              <p className="text-sm font-semibold">Marketplace Vitrine</p>
              <p className="text-xs text-muted-foreground mt-1">Home com menu horizontal, faixa de categorias e seção "Em destaque" com abas.</p>
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!!loading["store_theme_preset"]}
              onClick={() => onSave("store_theme_preset", storeThemePreset)}
            >
              {loading["store_theme_preset"] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar tema
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!loading["store_theme_preset"]}
              onClick={() => {
                setStoreThemePreset("default");
                onDelete("store_theme_preset");
              }}
            >
              Restaurar tema padrão
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          <ImageUploadCard
            title="Logo do Site"
            description="Exibido no cabeçalho e rodapé da loja. Recomendado: quadrado ou retangular, fundo transparente."
            settingKey="logo"
            currentSrc={settings["logo"]}
            currentScale={Number(settings["logo_scale"] ?? 180)}
            loading={!!loading["logo"]}
            onScaleSave={(value) => onSave("logo_scale", String(value))}
            onSave={onSave}
            onDelete={onDelete}
          />
          <ImageUploadCard
            title="Banner Desktop"
            description="Banner principal exibido na página inicial em telas maiores. Recomendado: 1956×804px."
            settingKey="banner_desktop"
            currentSrc={settings["banner_desktop"]}
            loading={!!loading["banner_desktop"]}
            targetWidth={1956}
            targetHeight={804}
            showResizeModeSelector
            onSave={onSave}
            onDelete={onDelete}
          />
          <ImageUploadCard
            title="Banner Mobile"
            description="Banner exibido em smartphones. Recomendado: 800×400px ou proporção 2:1."
            settingKey="banner_mobile"
            currentSrc={settings["banner_mobile"]}
            loading={!!loading["banner_mobile"]}
            targetWidth={800}
            targetHeight={400}
            showResizeModeSelector
            onSave={onSave}
            onDelete={onDelete}
          />
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-primary" />
            Banner do topo do catálogo
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <ImageUploadCard
              title="Banner Catálogo Desktop"
              description="Imagem exibida no topo do catálogo em telas maiores. Recomendado: 1956×804px."
              settingKey="catalog_banner_desktop"
              currentSrc={settings["catalog_banner_desktop"]}
              loading={!!loading["catalog_banner_desktop"]}
              targetWidth={1956}
              targetHeight={804}
              showResizeModeSelector
              onSave={onSave}
              onDelete={onDelete}
            />
            <ImageUploadCard
              title="Banner Catálogo Mobile"
              description="Imagem exibida no topo do catálogo em celulares. Recomendado: 800×420px."
              settingKey="catalog_banner_mobile"
              currentSrc={settings["catalog_banner_mobile"]}
              loading={!!loading["catalog_banner_mobile"]}
              targetWidth={800}
              targetHeight={420}
              showResizeModeSelector
              onSave={onSave}
              onDelete={onDelete}
            />
          </div>
          <div className="mt-5 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-4">
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Produto promocional do banner
            </label>
            <input
              className="h-10 w-full rounded-lg border border-border px-3 text-sm bg-white"
              placeholder="Pesquisar produto por nome"
              value={promotionProductSearch}
              onChange={(e) => setPromotionProductSearch(e.target.value)}
            />
            <div className="mt-2 max-h-56 overflow-auto rounded-xl border border-border bg-white p-2 space-y-1">
              {filteredPromotionProducts.length === 0 ? (
                <p className="text-xs text-muted-foreground px-2 py-1">Nenhum produto encontrado.</p>
              ) : (
                filteredPromotionProducts.map((product) => {
                  const productId = String(product.id || "").trim();
                  const productName = String(product.name || "").trim();
                  const isSelected = productId === catalogBannerProductId;
                  return (
                    <button
                      key={productId}
                      type="button"
                      onClick={() => {
                        onSave("catalog_banner_product_id", productId);
                        setPromotionProductSearch(productName);
                      }}
                      className={`w-full flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors ${isSelected ? "bg-blue-50 border-blue-200" : "border-border hover:bg-muted/40"}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {product.image ? (
                          <img src={product.image} alt={productName} className="h-7 w-7 rounded-md object-cover shrink-0 border border-border" loading="lazy" />
                        ) : (
                          <div className="h-7 w-7 rounded-md bg-muted shrink-0 border border-border flex items-center justify-center">
                            <IconLucide name="Package" className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                        )}
                        <span className="text-xs truncate">{productName}</span>
                      </div>
                      {isSelected ? <span className="text-[10px] font-semibold text-blue-700">Selecionado</span> : null}
                    </button>
                  );
                })
              )}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground truncate">
                {selectedPromotionProduct
                  ? `Produto atual: ${String(selectedPromotionProduct.name || "")}`
                  : "Nenhum produto selecionado."}
              </p>
              {catalogBannerProductId ? (
                <button
                  type="button"
                  onClick={() => onSave("catalog_banner_product_id", "")}
                  className="text-xs px-2 py-1 rounded-md border border-border bg-white hover:bg-muted transition-colors"
                >
                  Limpar
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Quando definido, o banner do topo do catálogo abre a página do produto selecionado.
            </p>
          </div>
        </div>
      </div>

      {/* ── Cronograma de Promoção no Topo ─────────────────────────────── */}
      <div className="max-w-3xl">
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" />
          Cronograma da Promoção no Topo
        </h2>
        <p className="text-muted-foreground text-sm mb-5">
          Configure um contador regressivo no topo da loja com data, horário e texto personalizado.
        </p>

        <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm space-y-4">
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div>
              <p className="font-semibold">Ativar contador regressivo</p>
              <p className="text-xs text-muted-foreground">Quando ativo, o contador aparece no topo do site até chegar no horário programado.</p>
            </div>
            <input
              type="checkbox"
              checked={promoCountdownEnabled}
              onChange={(e) => setPromoCountdownEnabled(e.target.checked)}
              className="w-4 h-4"
            />
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Data e horário da promoção</label>
              <input
                type="datetime-local"
                value={promoCountdownDateTime}
                onChange={(e) => setPromoCountdownDateTime(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
                disabled={!!loading["promo_countdown_datetime"]}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Texto exibido no topo</label>
              <input
                type="text"
                value={promoCountdownText}
                onChange={(e) => setPromoCountdownText(e.target.value)}
                placeholder="Ex: Oferta Relâmpago começa em"
                className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
                disabled={!!loading["promo_countdown_text"]}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                if (promoCountdownEnabled) {
                  if (!promoCountdownDateTime.trim()) {
                    toast.error("Selecione data e horário da promoção.");
                    return;
                  }
                  if (!promoCountdownText.trim()) {
                    toast.error("Digite o texto do contador.");
                    return;
                  }
                }

                onSave("promo_countdown_enabled", promoCountdownEnabled ? "1" : "0");
                onSave("promo_countdown_datetime", promoCountdownDateTime.trim());
                onSave("promo_countdown_text", promoCountdownText.trim());
              }}
              disabled={!!loading["promo_countdown_enabled"] || !!loading["promo_countdown_datetime"] || !!loading["promo_countdown_text"]}
              className="gap-2"
            >
              {(loading["promo_countdown_enabled"] || loading["promo_countdown_datetime"] || loading["promo_countdown_text"])
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Save className="w-4 h-4" />}
              Salvar cronograma
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPromoCountdownEnabled(false);
                setPromoCountdownDateTime("");
                setPromoCountdownText("");
                onDelete("promo_countdown_enabled");
                onDelete("promo_countdown_datetime");
                onDelete("promo_countdown_text");
              }}
              disabled={!!loading["promo_countdown_enabled"] || !!loading["promo_countdown_datetime"] || !!loading["promo_countdown_text"]}
            >
              Limpar cronograma
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            O contador será exibido no topo até a data programada e para automaticamente quando o tempo acabar.
          </p>
        </div>
      </div>

      {/* ── Taxas do Gateway ─────────────────────────────────────────────── */}
      <div className="max-w-2xl">
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-primary" />
          Taxas do Gateway de Pagamento
        </h2>
        <p className="text-muted-foreground text-sm mb-5">
          Configure as taxas cobradas pelo gateway de pagamento para cálculo do líquido real no dashboard.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">Taxa percentual por transação (%)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={settings["gateway_fee_percent"] ?? ""}
              onChange={e => onSave("gateway_fee_percent", e.target.value)}
              placeholder="Ex: 1.5"
              className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
              disabled={!!loading["gateway_fee_percent"]}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Taxa fixa por transação (R$)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={settings["gateway_fee_fixed"] ?? ""}
              onChange={e => onSave("gateway_fee_fixed", e.target.value)}
              placeholder="Ex: 0.45"
              className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
              disabled={!!loading["gateway_fee_fixed"]}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Taxa mínima por transação (R$)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={settings["gateway_fee_min"] ?? ""}
              onChange={e => onSave("gateway_fee_min", e.target.value)}
              placeholder="Ex: 0.99"
              className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
              disabled={!!loading["gateway_fee_min"]}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Taxa percentual por saque (%)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={settings["gateway_withdraw_percent"] ?? ""}
              onChange={e => onSave("gateway_withdraw_percent", e.target.value)}
              placeholder="Ex: 1.5"
              className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
              disabled={!!loading["gateway_withdraw_percent"]}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Taxa fixa por saque (R$)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={settings["gateway_withdraw_fixed"] ?? ""}
              onChange={e => onSave("gateway_withdraw_fixed", e.target.value)}
              placeholder="Ex: 0.45"
              className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
              disabled={!!loading["gateway_withdraw_fixed"]}
            />
          </div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-xs text-blue-800 mt-4">
          <p>Essas taxas serão usadas para calcular o valor líquido real no dashboard, descontando custos do gateway de pagamento.</p>
        </div>
      </div>

      {/* ── Provedor PIX Ativo ───────────────────────────────────────────── */}
      <div className="max-w-2xl">
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
          <QrCode className="w-5 h-5 text-primary" />
          Provedor PIX Ativo
        </h2>
        <p className="text-muted-foreground text-sm mb-5">
          Selecione qual gateway PIX será usado no checkout. APPCNPay continua como padrão.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className={`border rounded-2xl p-4 cursor-pointer transition-colors ${pixGateway === "appcnpay" ? "border-primary bg-primary/5" : "border-border/60 bg-card"}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">APPCNPay</p>
                <p className="text-xs text-muted-foreground">Fluxo atual do sistema (sem alterações).</p>
              </div>
              <input
                type="radio"
                name="pixGateway"
                checked={pixGateway === "appcnpay"}
                onChange={() => onSave("checkout_pix_gateway", "appcnpay")}
                disabled={!!loading["checkout_pix_gateway"]}
              />
            </div>
          </label>

          <label className={`border rounded-2xl p-4 cursor-pointer transition-colors ${pixGateway === "dentpeg" ? "border-primary bg-primary/5" : "border-border/60 bg-card"}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">DentPeg</p>
                <p className="text-xs text-muted-foreground">Alternativa de gateway PIX usando API key DentPeg.</p>
              </div>
              <input
                type="radio"
                name="pixGateway"
                checked={pixGateway === "dentpeg"}
                onChange={() => onSave("checkout_pix_gateway", "dentpeg")}
                disabled={!!loading["checkout_pix_gateway"]}
              />
            </div>
          </label>
        </div>
      </div>

      {/* ── Métodos de Pagamento no Checkout ─────────────────────────────── */}
      <div className="max-w-2xl">
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-primary" />
          Métodos de Pagamento no Checkout
        </h2>
        <p className="text-muted-foreground text-sm mb-5">
          Escolha quais botões ficam disponíveis para o cliente na página de checkout.
        </p>

        <div className="space-y-4">
          <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm">
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <p className="font-semibold flex items-center gap-2"><QrCode className="w-4 h-4 text-primary" />PIX</p>
                <p className="text-xs text-muted-foreground">Exibe o botão "Pagar com PIX" no checkout.</p>
              </div>
              <input
                type="checkbox"
                checked={pixEnabled}
                onChange={(e) => togglePaymentMethod("checkout_enable_pix", e.target.checked)}
                disabled={!!loading["checkout_enable_pix"]}
                className="w-4 h-4"
              />
            </label>
          </div>

          <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm">
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <p className="font-semibold flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" />Cartão</p>
                <p className="text-xs text-muted-foreground">Exibe o botão "Pagar com Cartão" no checkout.</p>
              </div>
              <input
                type="checkbox"
                checked={cardEnabled}
                onChange={(e) => togglePaymentMethod("checkout_enable_card", e.target.checked)}
                disabled={!!loading["checkout_enable_card"]}
                className="w-4 h-4"
              />
            </label>
          </div>

          <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm">
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <p className="font-semibold flex items-center gap-2"><MessageCircle className="w-4 h-4 text-primary" />WhatsApp</p>
                <p className="text-xs text-muted-foreground">Exibe o botão "Finalizar via WhatsApp" no checkout.</p>
              </div>
              <input
                type="checkbox"
                checked={whatsappEnabled}
                onChange={(e) => togglePaymentMethod("checkout_enable_whatsapp", e.target.checked)}
                disabled={!!loading["checkout_enable_whatsapp"]}
                className="w-4 h-4"
              />
            </label>
          </div>
        </div>

        {!pixEnabled && !cardEnabled && !whatsappEnabled && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-800 mt-4">
            Todos os métodos estão desativados. Nesse estado, o checkout ficará sem opção de pagamento.
          </div>
        )}
      </div>

      {/* ── Regra de Frete Grátis ────────────────────────────────────────── */}
      <div className="max-w-2xl">
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
          <Truck className="w-5 h-5 text-primary" />
          Frete Grátis por Valor Mínimo
        </h2>
        <p className="text-muted-foreground text-sm mb-5">
          Defina o subtotal mínimo do carrinho para liberar frete grátis automático no checkout.
        </p>

        <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm space-y-3">
          <label className="block text-xs font-medium">Valor mínimo (R$)</label>
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              step="0.01"
              value={freeShippingMinSubtotal}
              onChange={(e) => setFreeShippingMinSubtotal(e.target.value)}
              placeholder="Ex: 2500"
              className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
              disabled={!!loading["checkout_free_shipping_min_subtotal"]}
            />
            <Button
              size="sm"
              onClick={() => {
                const raw = freeShippingMinSubtotal.trim();
                if (!raw) {
                  onDelete("checkout_free_shipping_min_subtotal");
                  return;
                }

                const value = Number(raw);
                if (!Number.isFinite(value) || value < 0) {
                  toast.error("Valor inválido para frete grátis.");
                  return;
                }

                onSave("checkout_free_shipping_min_subtotal", String(value));
              }}
              disabled={!!loading["checkout_free_shipping_min_subtotal"]}
            >
              {loading["checkout_free_shipping_min_subtotal"] ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Deixe em branco para desativar a regra. Quando ativo, pedidos com subtotal igual ou maior que esse valor terão frete R$0.
          </p>
        </div>
      </div>

      {/* ── Controle de Acesso ────────────────────────────────────────────── */}
      <div className="max-w-2xl">
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          Controle de Acesso
        </h2>
        <p className="text-muted-foreground text-sm mb-5">
          Proteja o site ou a página de pagamento com senha. Deixe em branco para acesso livre.
        </p>
        <div className="space-y-4">
          {/* Site password */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm">
            <p className="font-semibold mb-1 flex items-center gap-2"><Lock className="w-4 h-4 text-primary" />Senha do Site</p>
            <p className="text-xs text-muted-foreground mb-3">Se preenchida, qualquer visitante precisará digitar a senha antes de ver o site.</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showSitePw ? "text" : "password"}
                  value={sitePw}
                  onChange={(e) => setSitePw(e.target.value)}
                  placeholder="Deixe vazio para acesso livre"
                  className="w-full h-10 px-3 pr-10 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
                />
                <button type="button" onClick={() => setShowSitePw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showSitePw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <Button size="sm" onClick={() => sitePw ? onSave("site_password", sitePw) : onDelete("site_password")}>
                Salvar
              </Button>
            </div>
            {settings["site_password"] && (
              <p className="text-xs text-emerald-600 mt-2 flex items-center gap-1"><CheckCircle className="w-3 h-3" />Proteção ativa</p>
            )}
          </div>
          {/* Payment password */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-sm">
            <p className="font-semibold mb-1 flex items-center gap-2"><QrCode className="w-4 h-4 text-primary" />Senha da Página de Pagamento</p>
            <p className="text-xs text-muted-foreground mb-3">Se preenchida, protege apenas a página /pagamento com uma senha diferente.</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showPaymentPw ? "text" : "password"}
                  value={paymentPw}
                  onChange={(e) => setPaymentPw(e.target.value)}
                  placeholder="Deixe vazio para acesso livre"
                  className="w-full h-10 px-3 pr-10 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
                />
                <button type="button" onClick={() => setShowPaymentPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showPaymentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <Button size="sm" onClick={() => paymentPw ? onSave("payment_password", paymentPw) : onDelete("payment_password")}>
                Salvar
              </Button>
            </div>
            {settings["payment_password"] && (
              <p className="text-xs text-emerald-600 mt-2 flex items-center gap-1"><CheckCircle className="w-3 h-3" />Proteção ativa</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Webhook de Saída (Pushcut/Automations) ───────────────────────── */}
      <div className="max-w-3xl bg-card border border-border/60 rounded-2xl p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
            <Webhook className="w-5 h-5 text-primary" />
            Webhook de Saída (Pushcut)
          </h2>
          <p className="text-muted-foreground text-sm">
            Envia eventos do sistema para uma URL externa (ex: Pushcut) quando pedido é criado ou pagamento é aprovado.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">URL de destino</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={outboundUrl}
                onChange={(e) => setOutboundUrl(e.target.value)}
                placeholder="https://api.pushcut.io/..."
                className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
              />
              <Button
                size="sm"
                onClick={() => {
                  const value = outboundUrl.trim();
                  if (!value) { onDelete("outbound_webhook_url"); return; }
                  onSave("outbound_webhook_url", value);
                }}
                disabled={!!loading["outbound_webhook_url"]}
              >
                {loading["outbound_webhook_url"] ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Segredo de assinatura (opcional)</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showOutboundSecret ? "text" : "password"}
                  value={outboundSecret}
                  onChange={(e) => setOutboundSecret(e.target.value)}
                  placeholder="Defina um segredo para validar assinatura"
                  className="w-full h-10 px-3 pr-10 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowOutboundSecret((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showOutboundSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  const value = outboundSecret.trim();
                  if (!value) { onDelete("outbound_webhook_secret"); return; }
                  onSave("outbound_webhook_secret", value);
                }}
                disabled={!!loading["outbound_webhook_secret"]}
              >
                {loading["outbound_webhook_secret"] ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex items-center justify-between border rounded-xl px-3 py-2.5 cursor-pointer">
            <span className="text-sm font-medium">Ativar envio</span>
            <input
              type="checkbox"
              checked={outboundEnabled}
              onChange={(e) => onSave("outbound_webhook_enabled", e.target.checked ? "1" : "0")}
              disabled={!!loading["outbound_webhook_enabled"]}
            />
          </label>

          <label className="flex items-center justify-between border rounded-xl px-3 py-2.5 cursor-pointer">
            <span className="text-sm font-medium">Evento: pedido criado</span>
            <input
              type="checkbox"
              checked={outboundEventNewOrder}
              onChange={(e) => onSave("outbound_webhook_event_new_order", e.target.checked ? "1" : "0")}
              disabled={!!loading["outbound_webhook_event_new_order"]}
            />
          </label>

          <label className="flex items-center justify-between border rounded-xl px-3 py-2.5 cursor-pointer">
            <span className="text-sm font-medium">Evento: pagamento aprovado</span>
            <input
              type="checkbox"
              checked={outboundEventOrderPaid}
              onChange={(e) => onSave("outbound_webhook_event_order_paid", e.target.checked ? "1" : "0")}
              disabled={!!loading["outbound_webhook_event_order_paid"]}
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-muted-foreground">
            Use o botão de teste para validar recebimento no Pushcut antes de ativar em produção.
          </p>
          <Button variant="outline" onClick={onTestOutboundWebhook}>Enviar teste</Button>
        </div>
      </div>

      {/* ── Integração Brevo ─────────────────────────────────────────────── */}
      <div className="max-w-3xl bg-card border border-border/60 rounded-2xl p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" />
            Integração Brevo
          </h2>
          <p className="text-muted-foreground text-sm">
            Configure sua API key do Brevo para habilitar sincronização de clientes e campanhas.
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium">API key do Brevo</label>
          <input
            type="password"
            value={brevoApiKey}
            onChange={(e) => setBrevoApiKey(e.target.value)}
            placeholder="xkeysib-..."
            className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
          />
          <p className="text-xs text-muted-foreground">
            A chave é validada ao salvar. Se estiver correta, fica armazenada no backend.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs">
            {brevoConfigured ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                <CheckCircle className="w-3 h-3" /> API configurada
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                <AlertTriangle className="w-3 h-3" /> API não configurada
              </span>
            )}
          </div>
          <Button onClick={onTestBrevoConnection} disabled={brevoTesting || !brevoApiKey.trim()}>
            {brevoTesting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
            Testar e salvar API
          </Button>
        </div>
      </div>

      {/* ── Info ──────────────────────────────────────────────────────────── */}
      <div className="max-w-5xl bg-white border border-border/60 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-primary" />
              Diagnóstico de Erros do Navegador
            </h2>
            <p className="text-muted-foreground text-sm">
              Exibe os últimos erros capturados no frontend para confirmar falhas de chunk/import em produção.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onRefreshClientErrors} disabled={clientErrorsLoading}>
            {clientErrorsLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Atualizar
          </Button>
        </div>

        {clientErrorsLoading ? (
          <div className="py-6 flex items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando erros...
          </div>
        ) : clientErrors.length === 0 ? (
          <div className="py-6 text-sm text-muted-foreground text-center border border-dashed rounded-xl">
            Nenhum erro de navegador registrado recentemente.
          </div>
        ) : (
          <div className="space-y-3">
            {clientErrors.map((err) => (
              <div key={err.id} className="border border-border/60 rounded-xl p-3 bg-muted/20 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${err.isChunkLoadError ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>
                      {err.isChunkLoadError ? "Chunk Error" : "Runtime Error"}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{err.type}</span>
                    {err.buildId && <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-800">build: {err.buildId}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDateBR(err.receivedAt)} {formatTimeBR(err.receivedAt)}
                  </span>
                </div>
                <p className="text-sm font-semibold text-foreground break-all">{err.message || "Erro sem mensagem"}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <p><strong>Origem:</strong> {err.source || "-"}</p>
                  <p><strong>Página:</strong> {err.pageUrl || "-"}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 text-sm text-blue-800 max-w-2xl">
        <p className="font-semibold mb-1">Como funciona?</p>
        <ul className="list-disc list-inside space-y-1 text-blue-700">
          <li>Faça upload de qualquer imagem (PNG, JPG, WebP) de até 10MB.</li>
          <li>A imagem é armazenada de forma segura e aplicada imediatamente.</li>
          <li>Para restaurar o padrão, clique no botão vermelho sobre a imagem.</li>
          <li>O banner mobile substitui o banner desktop em telas pequenas.</li>
          <li>As senhas de acesso ficam em vigor até você as remover.</li>
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FretePanel
// ---------------------------------------------------------------------------
interface FretePanelProps {
  options: ShippingOption[];
  form: { name: string; description: string; price: string; sortOrder: string };
  setForm: (f: { name: string; description: string; price: string; sortOrder: string }) => void;
  creating: boolean;
  deleting: string | null;
  editing: ShippingOption | null;
  setEditing: (o: ShippingOption | null) => void;
  updating: string | null;
  onCreate: () => void;
  onUpdate: (id: string, patch: Partial<ShippingOption>) => void;
  onDelete: (id: string) => void;
}

function FretePanel({ options, form, setForm, creating, deleting, editing, setEditing, updating, onCreate, onUpdate, onDelete }: FretePanelProps) {
  const [editForm, setEditForm] = useState({ name: "", description: "", price: "", sortOrder: "0" });

  const startEdit = (o: ShippingOption) => {
    setEditing(o);
    setEditForm({ name: o.name, description: o.description ?? "", price: String(o.price), sortOrder: String(o.sortOrder) });
  };

  return (
    <div className="space-y-6">
      {/* Add new frete */}
      <div className="bg-white rounded-2xl shadow-sm border border-border p-6">
        <h3 className="font-semibold text-base mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" />
          Novo Frete
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">Nome *</label>
            <input
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex: Frete Normal, Expresso, Turbinado..."
              className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Descrição (prazo)</label>
            <input
              value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Ex: 10 a 15 dias úteis"
              className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Preço (R$) *</label>
            <input
              type="number" min="0" step="0.01"
              value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="Ex: 50.00"
              className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Ordem de exibição</label>
            <input
              type="number" min="0"
              value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
              className="w-full h-10 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
            />
          </div>
        </div>
        <Button className="mt-4" onClick={onCreate} disabled={creating}>
          {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
          Adicionar Frete
        </Button>
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl shadow-sm border border-border overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <Truck className="w-4 h-4 text-primary" />
            Fretes Cadastrados ({options.length})
          </h3>
        </div>
        {options.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            Nenhum frete cadastrado ainda. Adicione o primeiro acima.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {options.map((opt) => (
              <div key={opt.id} className="px-6 py-4">
                {editing?.id === opt.id ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">Nome *</label>
                        <input
                          value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="w-full h-9 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Descrição</label>
                        <input
                          value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                          className="w-full h-9 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Preço (R$)</label>
                        <input
                          type="number" min="0" step="0.01"
                          value={editForm.price} onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                          className="w-full h-9 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Ordem</label>
                        <input
                          type="number" min="0"
                          value={editForm.sortOrder} onChange={(e) => setEditForm({ ...editForm, sortOrder: e.target.value })}
                          className="w-full h-9 px-3 rounded-xl border-2 border-border outline-none focus:border-primary text-sm"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => onUpdate(opt.id, { name: editForm.name, description: editForm.description, price: Number(editForm.price), sortOrder: Number(editForm.sortOrder) })} disabled={updating === opt.id}>
                        {updating === opt.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle className="w-3 h-3 mr-1" />}
                        Salvar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{opt.name}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${opt.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {opt.isActive ? "Ativo" : "Inativo"}
                        </span>
                        <span className="text-xs text-muted-foreground">Ordem: {opt.sortOrder}</span>
                      </div>
                      {opt.description && <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>}
                      <p className="text-lg font-bold text-primary mt-1">{formatCurrency(Number(opt.price))}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => onUpdate(opt.id, { isActive: !opt.isActive })}
                        disabled={updating === opt.id}
                        className="text-muted-foreground hover:text-primary transition-colors p-1.5"
                        title={opt.isActive ? "Desativar" : "Ativar"}
                      >
                        {opt.isActive ? <IconLucide name="ToggleRight" className="w-5 h-5 text-green-600" /> : <ToggleLeft className="w-5 h-5" />}
                      </button>
                      <button onClick={() => startEdit(opt)} className="text-muted-foreground hover:text-primary transition-colors p-1.5" title="Editar">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onDelete(opt.id)} disabled={deleting === opt.id}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1.5" title="Excluir"
                      >
                        {deleting === opt.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-2xl px-6 py-4 text-xs text-blue-700 space-y-1">
        <p className="font-semibold flex items-center gap-1"><Info className="w-3.5 h-3.5" />Como funciona</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>Os fretes cadastrados aqui aparecem como opções no checkout para o cliente selecionar.</li>
          <li>Apenas fretes <strong>ativos</strong> são exibidos no checkout.</li>
          <li>Use a ordem de exibição para controlar qual frete aparece primeiro.</li>
          <li>O valor do frete é somado ao total do pedido e exibido no QR Code PIX.</li>
        </ul>
      </div>
    </div>
  );
}
