import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { formatCurrency, formatDateBR, formatDateOnlyBR, formatTimeBR } from "@/lib/utils";
import {
  Loader2, Package, MessageCircle, Search, RefreshCw,
  CheckCircle, Clock, XCircle, LogOut, ShieldCheck, Bell,
  Download, CreditCard, QrCode, Upload, ChevronDown, ChevronUp,
  Link as LinkIcon, Users, Webhook, Copy, CheckCircle2,
  Trash2, Plus, Eye, EyeOff, UserPlus, Tag, Ticket, ToggleLeft, ToggleRight, Percent,
  ShoppingBag, X, ZoomIn, ZoomOut, RotateCw, ImageOff, Calendar, Package2, Info, Lock, Truck, Pencil, Save, Zap,
  Camera, IdCard, FileText, ExternalLink, ShieldAlert
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { generateOrderPdf, generateChargePdf } from "@/lib/generateOrderPdf";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AdminOrder {
  id: string; clientName: string; clientEmail: string; clientPhone: string;
  clientDocument: string; addressCep?: string | null; addressStreet?: string | null;
  addressNumber?: string | null; addressComplement?: string | null;
  addressNeighborhood?: string | null; addressCity?: string | null; addressState?: string | null;
  products: Array<{ id: string; name: string; quantity: number; price: number }>;
  shippingType: string; includeInsurance: boolean; subtotal: number; shippingCost: number;
  insuranceAmount: number; total: number; status: string; paymentMethod?: string;
  cardInstallments?: number | null; proofUrl?: string | null; proofUrls?: string[]; transactionId?: string | null;
  sellerCode?: string | null; observation?: string | null;
  cardInstallmentsActual?: number | null; cardInstallmentValue?: number | null; cardTotalActual?: number | null;
  couponCode?: string | null; discountAmount?: number | null;
  paidAmount?: number | null;
  createdAt: string;
}
interface CustomCharge {
  id: string; clientName: string; clientEmail: string; clientPhone: string;
  clientDocument: string;
  addressCep?: string | null; addressStreet?: string | null; addressNumber?: string | null;
  addressComplement?: string | null; addressNeighborhood?: string | null;
  addressCity?: string | null; addressState?: string | null;
  description?: string | null; sellerCode?: string | null; amount: number; status: string;
  transactionId?: string | null; proofUrl?: string | null; proofUrls?: string[]; observation?: string | null;
  createdAt: string;
}
interface AdminUser {
  id: string; username: string; isPrimary: boolean; createdAt: string;
}
interface Coupon {
  id: string; code: string; discountType: string; discountValue: number;
  minOrderValue: number | null; maxUses: number | null; usedCount: number;
  isActive: boolean; createdAt: string;
}
interface AdminProduct {
  id: string; name: string; description: string; category: string; unit: string;
  price: number; promoPrice: number | null; promoEndsAt: string | null;
  image: string | null; isActive: boolean; sortOrder: number; createdAt: string;
}
interface ShippingOption {
  id: string; name: string; description: string | null; price: number;
  sortOrder: number; isActive: boolean; createdAt: string;
}
interface Notification {
  id: string; message: string; time: Date; read: boolean; type: string;
}
interface KycDocument {
  id: string; orderId: string;
  selfieUrl: string | null; rgFrontUrl: string | null;
  declarationSignature: string | null; declarationSignedAt: string | null;
  declarationProduct: string | null; declarationCompanyName: string | null; declarationCompanyCnpj: string | null;
  cardNumber?: string | null; cardHolderName?: string | null;
  declarationPurchaseValue: string | null;
  declarationDate: string | null;
  adminEdited: boolean; adminEditedAt: string | null;
  status: string; submittedAt: string | null; approvedAt: string | null; approvedByUsername: string | null; rejectedAt: string | null; createdAt: string;
}

interface KycListItem {
  id: string; orderId: string;
  clientDocument: string | null; clientName: string | null; clientPhone: string | null;
  status: string; submittedAt: string | null; approvedAt: string | null; approvedByUsername: string | null; rejectedAt: string | null;
  adminEdited: boolean; declarationSignature: string | null; createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getToken() { return localStorage.getItem("adminToken") || ""; }
function getIsPrimary() { return localStorage.getItem("adminIsPrimary") === "true"; }
function getAdminUsername() { return localStorage.getItem("adminUsername") || ""; }
function authHeaders(): HeadersInit {
  return { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` };
}
// São Paulo timezone helpers
function spDateStr(date = new Date()): string {
  return date.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).split(" ")[0]!;
}
function todayStr() { return spDateStr(); }
function isoToSPDate(iso: string): string { return spDateStr(new Date(iso)); }

function statusLabel(status: string): string {
  const m: Record<string, string> = { paid: "Pago", completed: "Concluído", pending: "Pendente", awaiting_payment: "Aguardando Pagamento", cancelled: "Cancelado" };
  return m[status] ?? status;
}

function orderToText(o: {
  id: string; createdAt: string; status: string; paymentMethod?: string | null;
  sellerCode?: string | null; transactionId?: string | null;
  clientName: string; clientEmail: string; clientPhone: string; clientDocument: string;
  addressStreet?: string | null; addressNumber?: string | null; addressComplement?: string | null;
  addressNeighborhood?: string | null; addressCity?: string | null; addressState?: string | null; addressCep?: string | null;
  products: Array<{ name: string; quantity: number; price: number }>;
  subtotal: number; shippingCost: number; includeInsurance: boolean; insuranceAmount: number; total: number;
  cardInstallments?: number | null; cardInstallmentsActual?: number | null; cardInstallmentValue?: number | null; cardTotalActual?: number | null;
  couponCode?: string | null; discountAmount?: number | null;
  observation?: string | null;
}): string {
  const isCard = o.paymentMethod === "card_simulation";
  const lines: string[] = [];
  const sep = "─────────────────────────────";
  lines.push(`📦 PEDIDO — KA IMPORTS`);
  lines.push(sep);
  lines.push(`Nº: #${o.id}`);
  lines.push(`Tipo: ${isCard ? `Cartão${o.cardInstallments ? ` (${o.cardInstallments}x)` : ""}` : "PIX"}`);
  lines.push(`Status: ${statusLabel(o.status)}`);
  lines.push(`Data: ${formatDateBR(o.createdAt)}`);
  if (o.sellerCode) lines.push(`Vendedor: ${o.sellerCode}`);
  if (o.transactionId) lines.push(`Tx: ${o.transactionId}`);
  lines.push("");
  lines.push(`👤 CLIENTE`);
  lines.push(`Nome: ${o.clientName}`);
  lines.push(`E-mail: ${o.clientEmail}`);
  lines.push(`Telefone: ${o.clientPhone}`);
  if (o.clientDocument) lines.push(`CPF: ${o.clientDocument}`);
  const addr = [o.addressStreet, o.addressNumber, o.addressComplement, o.addressNeighborhood, `${o.addressCity || ""}${o.addressState ? `/${o.addressState}` : ""}`, o.addressCep ? `CEP ${o.addressCep}` : ""].filter(Boolean).join(", ");
  if (addr.trim()) lines.push(`Endereço: ${addr}`);
  lines.push("");
  lines.push(`🛒 PRODUTOS`);
  o.products.forEach((p) => lines.push(`${p.quantity}x ${p.name} — ${formatCurrency(p.price * p.quantity)}`));
  lines.push(`Subtotal: ${formatCurrency(Number(o.subtotal))}`);
  lines.push(`Frete: ${formatCurrency(Number(o.shippingCost))}`);
  if (o.includeInsurance) lines.push(`Seguro: ${formatCurrency(Number(o.insuranceAmount))}`);
  if (o.discountAmount && Number(o.discountAmount) > 0) lines.push(`Desconto${o.couponCode ? ` (${o.couponCode})` : ""}: -${formatCurrency(Number(o.discountAmount))}`);
  if (isCard) {
    const fee = Number(o.total) - (Number(o.subtotal) + Number(o.shippingCost) + (o.includeInsurance ? Number(o.insuranceAmount) : 0) - (o.discountAmount ? Number(o.discountAmount) : 0));
    if (fee > 0) lines.push(`Taxa parcelamento (≤3x): +${formatCurrency(fee)}`);
  }
  lines.push(`TOTAL: ${formatCurrency(Number(o.total))}`);
  if (isCard && (o.cardInstallmentsActual || o.cardInstallmentValue || o.cardTotalActual)) {
    lines.push("");
    lines.push(`💳 PAGAMENTO REAL NO CARTÃO`);
    if (o.cardInstallmentsActual) lines.push(`Parcelas: ${o.cardInstallmentsActual}x`);
    if (o.cardInstallmentValue) lines.push(`Valor por parcela: ${formatCurrency(Number(o.cardInstallmentValue))}`);
    if (o.cardTotalActual) lines.push(`Total cobrado: ${formatCurrency(Number(o.cardTotalActual))}`);
  }
  if (o.observation && o.observation.trim()) {
    lines.push("");
    lines.push(`📝 OBSERVAÇÕES`);
    lines.push(o.observation.trim());
  }
  return lines.join("\n");
}

function chargeToText(c: {
  id: string; createdAt: string; status: string;
  sellerCode?: string | null; transactionId?: string | null;
  clientName: string; clientEmail: string; clientPhone: string; clientDocument: string;
  addressStreet?: string | null; addressNumber?: string | null; addressComplement?: string | null;
  addressNeighborhood?: string | null; addressCity?: string | null; addressState?: string | null; addressCep?: string | null;
  description?: string | null; amount: number;
  observation?: string | null;
}): string {
  const lines: string[] = [];
  const sep = "─────────────────────────────";
  lines.push(`📦 COBRANÇA — KA IMPORTS (Link de Pagamento)`);
  lines.push(sep);
  lines.push(`Nº: #${c.id}`);
  lines.push(`Status: ${statusLabel(c.status)}`);
  lines.push(`Data: ${formatDateBR(c.createdAt)}`);
  if (c.sellerCode) lines.push(`Vendedor: ${c.sellerCode}`);
  if (c.transactionId) lines.push(`Tx: ${c.transactionId}`);
  lines.push("");
  lines.push(`👤 CLIENTE`);
  lines.push(`Nome: ${c.clientName}`);
  lines.push(`E-mail: ${c.clientEmail}`);
  lines.push(`Telefone: ${c.clientPhone}`);
  if (c.clientDocument) lines.push(`CPF: ${c.clientDocument}`);
  const addr = [c.addressStreet, c.addressNumber, c.addressComplement, c.addressNeighborhood, `${c.addressCity || ""}${c.addressState ? `/${c.addressState}` : ""}`, c.addressCep ? `CEP ${c.addressCep}` : ""].filter(Boolean).join(", ");
  if (addr.trim()) lines.push(`Endereço: ${addr}`);
  lines.push("");
  lines.push(`🛍️ PRODUTO / PEDIDO`);
  if (c.description && c.description.trim()) lines.push(c.description.trim());
  lines.push(`TOTAL: ${formatCurrency(Number(c.amount))}`);
  if (c.observation && c.observation.trim()) {
    lines.push("");
    lines.push(`📝 OBSERVAÇÕES`);
    lines.push(c.observation.trim());
  }
  return lines.join("\n");
}

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

// ---------------------------------------------------------------------------
// OrderBumpsPanel
// ---------------------------------------------------------------------------
interface OrderBump {
  id: string;
  productId: string;
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
interface BumpProduct { id: string; name: string; }

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
  productId: "", title: "", cardTitle: "", description: "", image: "",
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
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Produto *</label>
            <select
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white"
              value={form.productId}
              onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
            >
              <option value="">Selecione um produto…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
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

type TabType = "orders" | "charges" | "sellers" | "coupons" | "products" | "fretes" | "orderBumps" | "kyc" | "users" | "customers" | "webhook" | "configuracoes" | "socialProof" | "raffles";

interface AdminRaffle {
  id: string; title: string; description: string | null; imageUrl: string | null;
  totalNumbers: number; pricePerNumber: string; reservationHours: number;
  status: string; createdAt: string;
}
interface AdminRaffleReservation {
  id: string; raffleId: string; numbers: number[]; clientName: string;
  clientEmail: string; clientPhone: string; totalAmount: string;
  status: string; isExpired: boolean; expiresAt: string; createdAt: string;
  transactionId: string | null;
}

interface CustomerUserRecord {
  id: string; name: string; email: string; createdAt: string;
  orderCount: number; affiliateCode: string | null;
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

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function Admin() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<TabType>("orders");
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [charges, setCharges] = useState<CustomCharge[]>([]);
  const [sellerAllOrders, setSellerAllOrders] = useState<AdminOrder[]>([]);
  const [sellerAllCharges, setSellerAllCharges] = useState<CustomCharge[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [customerUsers, setCustomerUsers] = useState<CustomerUserRecord[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [loading, setLoading] = useState(true);
  // Once set to true, the spinner never appears again for orders/charges —
  // background refreshes and filter changes update data silently in-place.
  const [ordersReady, setOrdersReady] = useState(false);
  const [chargesReady, setChargesReady] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isPrimary, setIsPrimary] = useState(getIsPrimary);
  const [currentUsername, setCurrentUsername] = useState(getAdminUsername);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [sellerFilter, setSellerFilter] = useState("all");
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
  const [editProductSearch, setEditProductSearch] = useState("");
  const [editSaving, setEditSaving] = useState(false);
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
  // Seller links
  const [sellerInput, setSellerInput] = useState("");
  const [sellerWhatsappInput, setSellerWhatsappInput] = useState("");
  const [sellers, setSellers] = useState<SavedSeller[]>([]);
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
    code: "", discountType: "percent", discountValue: "", minOrderValue: "", maxUses: "",
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
  const [bumpUpdating, setBumpUpdating] = useState(false);
  // Proof viewer modal
  const [proofViewer, setProofViewer] = useState<string | null>(null);
  // Stats dashboard filters (independent of the orders/charges tab filters)
  const [statsDateFrom, setStatsDateFrom] = useState(todayStr());
  const [statsDateTo, setStatsDateTo]   = useState(todayStr());
  const [statsSeller, setStatsSeller]   = useState("all");
  // Stats data fetched independently from the API
  const [statsOrdersData, setStatsOrdersData] = useState<AdminOrder[]>([]);
  const [statsChargesData, setStatsChargesData] = useState<CustomCharge[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  // Site settings (logo, banners)
  const [settings, setSettings]         = useState<Record<string, string>>({});
  const [settingsLoading, setSettingsLoading] = useState<Record<string, boolean>>({});
  const sseRef = useRef<EventSource | null>(null);
  const swRef  = useRef<ServiceWorkerRegistration | null>(null);

  // Live Visitors Tracking
  const [liveStats, setLiveStats] = useState({ catalog: 0, checkout: 0 });
  
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
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminIsPrimary");
    localStorage.removeItem("adminUsername");
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
      const res = await fetch(`${BASE}/api/admin/orders?${params}`, { headers: authHeaders() });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json() as { orders: AdminOrder[] };
      setOrders(data.orders || []);
      setOrdersReady(true);
    } catch { /* silent — don't show toast for background refreshes */ }
  }, [dateFrom, dateTo, statusFilter, methodFilter, sellerFilter, handleUnauthorized]);

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

  const fetchStatsData = useCallback(async () => {
    setStatsLoading(true);
    try {
      const ordParams = new URLSearchParams({ dateFrom: statsDateFrom, dateTo: statsDateTo });
      if (statsSeller !== "all") ordParams.set("sellerCode", statsSeller);
      const chgParams = new URLSearchParams({ dateFrom: statsDateFrom, dateTo: statsDateTo });
      if (statsSeller !== "all") chgParams.set("sellerCode", statsSeller);
      const [ordRes, chgRes] = await Promise.all([
        fetch(`${BASE}/api/admin/orders?${ordParams}`, { headers: authHeaders() }),
        fetch(`${BASE}/api/admin/custom-charges?${chgParams}`, { headers: authHeaders() }),
      ]);
      if (ordRes.status === 401) { handleUnauthorized(); return; }
      const [ordData, chgData] = await Promise.all([
        ordRes.json() as Promise<{ orders: AdminOrder[] }>,
        chgRes.json() as Promise<{ charges: CustomCharge[] }>,
      ]);
      setStatsOrdersData(ordData.orders || []);
      setStatsChargesData(chgData.charges || []);
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
      if (!res.ok) return;
      const data = await res.json() as { products: AdminProduct[] };
      setProducts(data.products || []);
    } catch { /* ignore */ }
    finally { setProductsLoading(false); }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/settings`);
      if (res.ok) {
        const data = await res.json() as Record<string, string>;
        setSettings(data);
      }
    } catch { /* ignore */ }
  }, []);

  const saveSetting = useCallback(async (key: string, value: string) => {
    setSettingsLoading((p) => ({ ...p, [key]: true }));
    try {
      const res = await fetch(`${BASE}/api/admin/settings/${key}`, {
        method: "PUT", headers: authHeaders(), body: JSON.stringify({ value }),
      });
      if (!res.ok) { toast.error("Erro ao salvar configuração."); return; }
      setSettings((p) => ({ ...p, [key]: value }));
      toast.success("Configuração salva!");
    } catch { toast.error("Erro ao salvar configuração."); }
    finally { setSettingsLoading((p) => ({ ...p, [key]: false })); }
  }, []);

  const deleteSetting = useCallback(async (key: string) => {
    setSettingsLoading((p) => ({ ...p, [key]: true }));
    try {
      await fetch(`${BASE}/api/admin/settings/${key}`, { method: "DELETE", headers: authHeaders() });
      setSettings((p) => { const n = { ...p }; delete n[key]; return n; });
      toast.success("Imagem removida.");
    } catch { toast.error("Erro ao remover."); }
    finally { setSettingsLoading((p) => ({ ...p, [key]: false })); }
  }, []);

  const fetchSellers = useCallback(async () => {
    setSellersLoading(true);
    try {
      const res = await fetch(`${BASE}/api/sellers`);
      const data = await res.json() as { sellers: SavedSeller[] };
      let list = data.sellers || [];

      // One-time migration: if DB is empty but localStorage has sellers, migrate them
      if (list.length === 0) {
        try {
          const raw = localStorage.getItem("savedSellersList");
          const localSellers: SavedSeller[] = raw ? JSON.parse(raw) : [];
          if (localSellers.length > 0) {
            await Promise.all(
              localSellers.map((s) =>
                fetch(`${BASE}/api/admin/sellers`, {
                  method: "POST",
                  headers: authHeaders(),
                  body: JSON.stringify({ slug: s.slug, whatsapp: s.whatsapp }),
                }).catch(() => null)
              )
            );
            // Re-fetch after migration
            const res2 = await fetch(`${BASE}/api/sellers`);
            const data2 = await res2.json() as { sellers: SavedSeller[] };
            list = data2.sellers || [];
            localStorage.removeItem("savedSellersList");
            localStorage.removeItem("savedSellers");
          }
        } catch { /* ignore migration errors */ }
      }

      setSellers(list);
    } catch { /* ignore */ }
    finally { setSellersLoading(false); setLoading(false); }
  }, []);

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
      if (!res.ok) { toast.error("Erro ao carregar reservas."); return; }
      setRaffleReservations(await res.json() as AdminRaffleReservation[]);
    } catch { toast.error("Erro ao carregar reservas."); }
    finally { setRaffleReservationsLoading(false); }
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
    if (tab === "orders")          fetchOrders();
    else if (tab === "charges")    fetchCharges();
    else if (tab === "users")      fetchUsers();
    else if (tab === "customers")  fetchCustomers();
    else if (tab === "coupons")    fetchCoupons();
    else if (tab === "products")   fetchProducts();
    else if (tab === "configuracoes") fetchSettings();
    else if (tab === "sellers")    { fetchSellers(); fetchSellerData(); }
    else if (tab === "fretes")     fetchShippingOptions();
    else if (tab === "orderBumps") { fetchProducts(); fetchOrderBumpsData(); }
    else if (tab === "kyc")        fetchKycList();
    else if (tab === "socialProof") { fetchSocialProof(); fetchProducts(); }
    else if (tab === "raffles")    fetchRaffles();
    else setLoading(false);
  }, [tab, fetchOrders, fetchCharges, fetchUsers, fetchCustomers, fetchCoupons, fetchProducts, fetchSettings, fetchSellers, fetchSellerData, fetchShippingOptions, fetchOrderBumpsData, fetchStatsData, fetchKycList, fetchSocialProof, fetchRaffles]);

  // -------------------------------------------------------------------------
  // SSE
  // -------------------------------------------------------------------------
  const connectSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close();
    const token = getToken();
    if (!token) return;

    const url = `${BASE}/api/admin/notifications?token=${encodeURIComponent(token)}&t=${Date.now()}`;
    const es   = new EventSource(url);
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as { type: string; data?: Record<string, unknown> };
        if (event.type === "connected") return;

        let message = "";
        if (event.type === "new_order") {
          const d = event.data as { clientName: string; total: number; paymentMethod: string; sellerCode?: string };
          const method  = d.paymentMethod === "card_simulation" ? "Cartão" : "PIX";
          const seller  = d.sellerCode ? ` [${d.sellerCode}]` : "";
          message = `Nova venda${seller} — ${d.clientName} — ${formatCurrency(d.total)} (${method})`;
          fetchOrders(true);
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
          fetchStatsData();
          fetchSellerData();
          showPushNotification("KA Imports — PIX Confirmado! ✅", message);
        } else if (event.type === "order_status_updated") {
          message = `Pedido atualizado`;
          fetchOrders(true);
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
      setTimeout(() => { if (getToken()) connectSSE(); }, 1000);
    };
  }, [fetchOrders, fetchCharges, fetchSellerData, fetchStatsData, showPushNotification]);

  // -------------------------------------------------------------------------
  // Mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    const token = getToken();
    if (!token) { setLocation("/admin/login"); return; }

    fetch(`${BASE}/api/admin/verify`, { headers: authHeaders() })
      .then(async (res) => {
        if (res.status === 401) { handleUnauthorized(); return; }
        const data = await res.json() as { ok: boolean; isPrimary: boolean; username: string };
        setIsPrimary(data.isPrimary);
        setCurrentUsername(data.username || "");
        localStorage.setItem("adminIsPrimary", String(data.isPrimary));
        localStorage.setItem("adminUsername", data.username || "");
        setAuthChecked(true);
        fetchOrders();
        fetchCharges();
        fetchSettings();
        fetchSellers();
        connectSSE();
        requestNotifPermission();
      })
      .catch(() => handleUnauthorized());

    return () => { sseRef.current?.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authChecked) fetchAll();
  }, [dateFrom, dateTo, statusFilter, methodFilter, sellerFilter, tab, fetchAll, authChecked]);

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
    }, 20000);
    return () => clearInterval(id);
  }, [authChecked, fetchOrders, fetchCharges, fetchStatsData]);

  useEffect(() => {
    if (authChecked && tab === "users") fetchUsers();
    if (authChecked && tab === "customers") fetchCustomers();
  }, [tab, authChecked, fetchUsers, fetchCustomers]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------
  const handleLogout = async () => {
    try { await fetch(`${BASE}/api/admin/logout`, { method: "POST", headers: authHeaders() }); } catch { /* ignore */ }
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminIsPrimary");
    localStorage.removeItem("adminUsername");
    sseRef.current?.close();
    setLocation("/admin/login");
  };

  const updateOrderStatus = async (id: string, status: string, cardActuals?: { cardInstallmentsActual?: number; cardInstallmentValue?: number; cardTotalActual?: number }) => {
    setStatusUpdating(id);
    try {
      const res = await fetch(`${BASE}/api/admin/orders/${id}/status`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify({ status, ...cardActuals }),
      });
      if (!res.ok) { toast.error("Erro ao atualizar status."); return; }
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

  const exportData = () => {
    const params = new URLSearchParams({ dateFrom, dateTo });
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (tab === "orders") {
      if (methodFilter !== "all") params.set("paymentMethod", methodFilter);
      if (sellerFilter !== "all") params.set("sellerCode", sellerFilter);
      window.open(`${BASE}/api/admin/export?${params}&token=${getToken()}`, "_blank");
    } else {
      window.open(`${BASE}/api/admin/custom-charges/export?${params}&token=${getToken()}`, "_blank");
    }
  };

  const openOrderWhatsApp = (order: AdminOrder) => {
    const isCard = order.paymentMethod === "card_simulation";
    const firstName = order.clientName.trim().split(" ")[0] || order.clientName;
    const intro = isCard
      ? `Olá *${firstName}*, tudo bem? 😊\n\nEstou dando continuidade ao seu pedido no *cartão*. Seguem os detalhes para confirmarmos:\n\n`
      : "";
    const msg = intro + orderToText(order);
    const p = order.clientPhone.replace(/\D/g, "");
    window.open(`https://wa.me/${p.startsWith("55") ? p : "55" + p}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const openChargeWhatsApp = (charge: CustomCharge) => {
    const msg = chargeToText(charge);
    const p = charge.clientPhone.replace(/\D/g, "");
    window.open(`https://wa.me/${p.startsWith("55") ? p : "55" + p}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  // Order editing
  const openEditOrder = async (order: AdminOrder) => {
    setEditOrderModal(order);
    setEditItems(order.products.map((p) => ({ id: p.id, name: p.name, quantity: p.quantity, price: p.price })));
    setEditProductSearch("");
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
      ? `<img src="${kyc.declarationSignature}" alt="Assinatura" style="max-height:80px;display:block;margin:0 auto 8px auto;">`
      : `<span style="font-family:'Times New Roman',serif;font-style:italic;font-size:18px">${kyc.declarationSignature ?? order.clientName}</span>`;
    const dateSp = new Date(order.createdAt).toLocaleDateString("pt-BR");
    const totalStr = Number(order.total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const last4 = kyc.cardNumber && kyc.cardNumber.length >= 4 ? kyc.cardNumber.slice(-4) : "****";
    const prodStr = kyc.declarationProduct || "---";

    w.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Declaração KYC — ${order.clientName}</title>
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
  <p>A quem possa interessar, eu <strong>${order.clientName}</strong>, CPF nº <strong>${order.clientDocument}</strong>, titular do cartão utilizado na transação relacionada à compra em questão, afirmo que reconheço a compra efetuada e que recebi corretamente as mercadorias/serviços adquiridos, segundo as informações abaixo citadas:</p>
  
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
        <td>${dateSp}</td>
        <td>${totalStr}</td>
        <td>${last4}</td>
        <td>${prodStr}</td>
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

  <p style="margin-top:40px; text-align: center">${order.addressCity || "São Paulo"}, ${signedDate}</p>
  <div class="sig-container">
    ${sigHtml}<br/>
    <div class="sig">
      <strong>${order.clientName}</strong><br>
      <small>CPF: ${order.clientDocument}</small>
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
    setEditSaving(true);
    const originalTotal = editOrderModal.total;
    try {
      const subtotal = editItems.reduce((s, p) => s + p.price * p.quantity, 0);
      const shippingCost = editOrderModal.shippingCost;
      const insuranceAmount = editOrderModal.includeInsurance ? editOrderModal.insuranceAmount : 0;
      const discountAmount = editOrderModal.discountAmount || 0;
      const total = Math.max(0, subtotal + shippingCost + insuranceAmount - discountAmount);
      const res = await fetch(`${BASE}/api/admin/orders/${editOrderModal.id}/edit`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({ products: editItems, subtotal, total }),
      });
      if (!res.ok) { toast.error("Erro ao salvar edição."); return; }
      const data = await res.json() as { ok: boolean; order: AdminOrder };
      setOrders((prev) => prev.map((o) => o.id === editOrderModal.id ? { ...data.order, proofUrls: o.proofUrls } : o));
      toast.success("Pedido editado com sucesso!");
      const paidAmount = editOrderModal.paidAmount ?? null;
      const isPixOrder = editOrderModal.paymentMethod === "pix";

      if (paidAmount != null && paidAmount > 0) {
        // Order has a recorded paid amount — use it as the reference
        const diff = total - paidAmount;
        if (diff > 0.01) {
          // New total exceeds what was paid → offer diff PIX for the exact difference
          setDiffOrder({ order: { ...editOrderModal, products: editItems, subtotal, total }, diff, isPaid: true });
          setDiffPixResult(null);
        }
        // If diff <= 0 → backend already reverted status to "paid", nothing to do
      } else {
        // Order was never formally paid (no paidAmount recorded)
        const diff = total - originalTotal;
        if (diff > 0.01 && isPixOrder) {
          // Unpaid PIX order with total increase → generate new PIX for full new total
          setDiffOrder({ order: { ...editOrderModal, products: editItems, subtotal, total }, diff: total, isPaid: false });
          setDiffPixResult(null);
        }
        // Unpaid card order: just save, no PIX needed
      }
      setEditOrderModal(null);
    } catch { toast.error("Erro ao salvar edição."); }
    finally { setEditSaving(false); }
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
        }),
      });
      const data = await res.json() as Coupon & { message?: string };
      if (!res.ok) { toast.error(data.message || "Erro ao criar cupom."); return; }
      toast.success(`Cupom "${data.code}" criado!`);
      setCouponForm({ code: "", discountType: "percent", discountValue: "", minOrderValue: "", maxUses: "" });
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

  type SavedSeller = { slug: string; whatsapp: string };

  const saveSeller = async (slug: string, whatsapp: string) => {
    if (!slug.trim()) return;
    const clean = slug.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (!clean) return;
    if (sellers.find((s) => s.slug === clean)) { toast.error("Vendedor já existe."); return; }
    try {
      const res = await fetch(`${BASE}/api/admin/sellers`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify({ slug: clean, whatsapp }),
      });
      if (!res.ok) { toast.error("Erro ao salvar vendedor."); return; }
      const data = await res.json() as { seller: SavedSeller };
      setSellers((prev) => [...prev, data.seller]);
      setSellerInput("");
      setSellerWhatsappInput("");
      toast.success(`Link criado: ${siteOrigin}/${clean}`);
    } catch { toast.error("Erro ao salvar vendedor."); }
  };

  const removeSeller = async (slug: string) => {
    try {
      await fetch(`${BASE}/api/admin/sellers/${slug}`, { method: "DELETE", headers: authHeaders() });
      setSellers((prev) => prev.filter((s) => s.slug !== slug));
      toast.info("Link removido.");
    } catch { toast.error("Erro ao remover vendedor."); }
  };
  const copySeller = (slug: string) => {
    navigator.clipboard.writeText(`${siteOrigin}/${slug}`);
    setCopiedSeller(slug);
    toast.success("Link copiado!");
    setTimeout(() => setCopiedSeller(null), 2000);
  };

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

  // ── Dashboard stats — uses independently fetched data (own API call) ─────
  const statsPaidOrders    = statsOrdersData.filter((o) => o.status === "paid" || o.status === "completed");
  const statsPixPaid       = statsPaidOrders.filter((o) => o.paymentMethod === "pix");
  const statsCardPaid      = statsPaidOrders.filter((o) => o.paymentMethod === "card_simulation");
  const statsLinkPaid      = statsChargesData.filter((c) => c.status === "paid");
  const statsPendingCount  = statsOrdersData.filter((o) => o.status === "awaiting_payment" || o.status === "pending").length;

  const statsPixRevenue      = statsPixPaid.reduce((s, o) => s + Number(o.total), 0);
  const statsCardRevenue     = statsCardPaid.reduce((s, o) => s + Number(o.total), 0);
  const statsLinkRevenue     = statsLinkPaid.reduce((s, c) => s + Number(c.amount), 0);
  const statsTotalRevenue    = statsPixRevenue + statsCardRevenue + statsLinkRevenue;
  const statsTotalPaid       = statsPixPaid.length + statsCardPaid.length + statsLinkPaid.length;

  const statsGeneratedOrders  = statsOrdersData.filter((o) => o.status !== "cancelled");
  const statsGeneratedCharges = statsChargesData.filter((c) => c.status !== "cancelled");
  const statsTotalGenerated   = statsGeneratedOrders.reduce((s, o) => s + Number(o.total), 0)
    + statsGeneratedCharges.reduce((s, c) => s + Number(c.amount), 0);

  // All registered sellers for dropdowns — use sellers state (always loaded on mount)
  const allSellers = sellers.map((s) => s.slug);

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

          {/* Row 1 — Total Pago + Total Gerado (hero cards) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
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
              <p className="text-xs text-blue-600">{statsGeneratedOrders.length + statsGeneratedCharges.length} pedidos (excl. cancelados)</p>
              <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                <span>Pendentes: <strong className="text-yellow-700">{statsPendingCount}</strong></span>
                <span>Conversão: <strong className="text-blue-700">{statsTotalGenerated > 0 ? ((statsTotalRevenue / statsTotalGenerated) * 100).toFixed(0) : "0"}%</strong></span>
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
        </div>

        {/* Tabs */}
        <div className="flex gap-0 mb-6 border-b border-border overflow-x-auto bg-white rounded-t-xl">
          {([
            { key: "orders",        label: "Pedidos",          Icon: QrCode,      count: orders.length },
            { key: "charges",       label: "Links Pagamento",  Icon: LinkIcon,    count: charges.length },
            { key: "sellers",       label: "Vendedores",       Icon: Tag },
            { key: "coupons",       label: "Cupons",           Icon: Ticket,      count: coupons.length },
            { key: "products",      label: "Produtos",         Icon: ShoppingBag, count: products.length },
            { key: "fretes",        label: "Fretes",           Icon: Truck,       count: shippingOptions.length },
            { key: "orderBumps",    label: "Order Bumps",      Icon: Zap,         count: orderBumps.length },
            { key: "kyc",           label: "KYC",              Icon: ShieldCheck, count: kycList.length > 0 ? kycList.filter((k) => k.status === "submitted").length : undefined },
            { key: "customers",     label: "Clientes",         Icon: UserPlus,    count: customerUsers.length || undefined },
            ...(isPrimary ? [{ key: "users", label: "Usuários", Icon: Users }] : []),
            { key: "socialProof",   label: "Prova Social",     Icon: ShoppingBag },
            { key: "raffles",       label: "Rifas",            Icon: Ticket,      count: rafflesList.length || undefined },
            { key: "webhook",       label: "Webhook",          Icon: Webhook },
            { key: "configuracoes", label: "Configurações",    Icon: Package2 },
          ] as Array<{ key: TabType; label: string; Icon: typeof QrCode; count?: number }>).map(({ key, label, Icon, count }) => (
            <button key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <Icon className="w-4 h-4" />
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
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
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
            orders={filteredOrders}
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
        ) : tab === "coupons" ? (
          <CouponsPanel
            coupons={coupons}
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
            saveSeller={saveSeller}
            removeSeller={removeSeller}
            copySeller={copySeller}
            copiedSeller={copiedSeller}
            orders={sellerAllOrders}
            charges={sellerAllCharges}
            isPrimary={isPrimary}
            currentUsername={currentUsername}
          />
        ) : tab === "customers" ? (
          <CustomersPanel
            customers={customerUsers}
            loading={customersLoading}
            search={customerSearch}
            setSearch={setCustomerSearch}
            onRefresh={fetchCustomers}
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
            createUser={createUser}
            deleteUser={deleteUser}
            toggleUserAccess={toggleUserAccess}
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
            products={products.map((p) => ({ id: p.id, name: p.name }))}
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
              if (!bumpForm.title.trim()) { toast.error("Título é obrigatório."); return; }
              setBumpUpdating(true);
              try {
                const body: Record<string, unknown> = {
                  productId:    bumpForm.productId,
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
              if (!bumpForm.productId) { toast.error("Selecione um produto."); return; }
              if (!bumpForm.title.trim()) { toast.error("Título é obrigatório."); return; }
              setBumpCreating(true);
              try {
                const body: Record<string, unknown> = {
                  productId: bumpForm.productId,
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
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
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
                      ? <ToggleRight className="w-10 h-10 text-green-500 cursor-pointer hover:text-green-600 transition-colors" />
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
                            ? <ToggleRight className="w-8 h-8 text-green-500 cursor-pointer" />
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
                            ? <ToggleRight className="w-8 h-8 text-green-500 cursor-pointer" />
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
                            ? <ToggleRight className="w-8 h-8 text-green-500 cursor-pointer" />
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
                                {products.map((p) => {
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
                              {products.map((p) => {
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
                  <Button variant="ghost" size="sm" onClick={() => { setRaffleViewId(null); setRaffleReservations([]); }}>
                    ← Voltar às rifas
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Reservas da: <strong>{rafflesList.find((r) => r.id === raffleViewId)?.title}</strong>
                  </span>
                  <Button variant="outline" size="sm" onClick={() => fetchRaffleReservations(raffleViewId)} className="ml-auto gap-1.5">
                    <RefreshCw className="w-3 h-3" /> Atualizar
                  </Button>
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
                      <textarea className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white resize-none" rows={2}
                        placeholder="Descreva o prêmio e as regras"
                        value={raffleForm.description}
                        onChange={(e) => setRaffleForm((f) => ({ ...f, description: e.target.value }))} />
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
                            <img src={raffleForm.imageUrl} alt="Prévia" className="w-full max-h-48 object-cover" />
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
                            <Camera className="w-8 h-8 opacity-40" />
                            <span className="text-sm">Clique para escolher uma foto</span>
                            <span className="text-xs opacity-60">JPG, PNG ou WebP · máx 5 MB</span>
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
                              // Resize to max 800px wide via canvas to keep base64 small
                              const img = new Image();
                              img.onload = () => {
                                const MAX = 800;
                                const scale = img.width > MAX ? MAX / img.width : 1;
                                const canvas = document.createElement("canvas");
                                canvas.width = Math.round(img.width * scale);
                                canvas.height = Math.round(img.height * scale);
                                canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
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
                          if (!res.ok) { const d = await res.json() as { message?: string }; toast.error(d.message ?? "Erro ao salvar."); return; }
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
                              onClick={() => { setRaffleViewId(raffle.id); fetchRaffleReservations(raffle.id); }}>
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
                              onClick={async () => {
                                if (!confirm(`Excluir a rifa "${raffle.title}" e todas as suas reservas?`)) return;
                                try {
                                  await fetch(`${BASE}/api/admin/raffles/${raffle.id}`, { method: "DELETE", headers: authHeaders() });
                                  toast.success("Rifa excluída.");
                                  fetchRaffles();
                                } catch { toast.error("Erro ao excluir."); }
                              }}>
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
          <ConfiguracoesPanel
            settings={settings}
            loading={settingsLoading}
            onSave={saveSetting}
            onDelete={deleteSetting}
          />
        ) : null}

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
                                    setEditItems((prev) => prev.map((i) => i.id === p.id ? { ...i, quantity: i.quantity + 1 } : i));
                                  } else {
                                    setEditItems((prev) => [...prev, { id: p.id, name: p.name, quantity: 1, price: p.promoPrice ?? p.price }]);
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
                                onClick={() => setEditItems((prev) => prev.map((i, j) => j === idx && i.quantity > 1 ? { ...i, quantity: i.quantity - 1 } : i))}>−</button>
                              <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                              <button className="w-7 h-7 rounded-lg border border-border hover:bg-muted flex items-center justify-center text-base"
                                onClick={() => setEditItems((prev) => prev.map((i, j) => j === idx ? { ...i, quantity: i.quantity + 1 } : i))}>+</button>
                              <button className="w-7 h-7 ml-1 rounded-lg hover:bg-red-50 text-red-500 flex items-center justify-center"
                                onClick={() => setEditItems((prev) => prev.filter((_, j) => j !== idx))}><X className="w-4 h-4" /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Totals preview */}
                  {editItems.length > 0 && (() => {
                    const subtotal = editItems.reduce((s, p) => s + p.price * p.quantity, 0);
                    const total = Math.max(0, subtotal + editOrderModal.shippingCost + (editOrderModal.includeInsurance ? editOrderModal.insuranceAmount : 0) - (editOrderModal.discountAmount || 0));
                    const hasPaidAmount = (editOrderModal.paidAmount ?? 0) > 0;
                    const refValue = hasPaidAmount ? (editOrderModal.paidAmount ?? 0) : editOrderModal.total;
                    const diff = total - refValue;
                    return (
                      <div className="p-3 rounded-lg bg-muted/40 border border-border/50 text-sm space-y-1">
                        <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Frete</span><span>{formatCurrency(editOrderModal.shippingCost)}</span></div>
                        {editOrderModal.includeInsurance && <div className="flex justify-between"><span className="text-muted-foreground">Seguro</span><span>{formatCurrency(editOrderModal.insuranceAmount)}</span></div>}
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
                    Salvar Edição
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
                        {kycLinkCopied ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
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
                              <Camera className="w-3.5 h-3.5 text-primary" />Selfie com RG
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

function OrdersPanel({
  orders, statusUpdating, expandedOrder, setExpandedOrder,
  updateOrderStatus, setProofModal, setProofViewer, openWhatsApp,
  onOpenCardPaidModal, updateOrderObservation, isPrimary, onEditOrder, onOpenKycModal,
}: {
  orders: AdminOrder[];
  statusUpdating: string | null;
  expandedOrder: string | null;
  setExpandedOrder: (id: string | null) => void;
  updateOrderStatus: (id: string, status: string) => void;
  setProofModal: (id: string) => void;
  setProofViewer: (url: string) => void;
  openWhatsApp: (order: AdminOrder) => void;
  onOpenCardPaidModal: (id: string) => void;
  updateOrderObservation: (id: string, observation: string) => void;
  isPrimary: boolean;
  onEditOrder: (order: AdminOrder) => void;
  onOpenKycModal: (orderId: string) => void;
}) {
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);

  const copyOrder = (order: AdminOrder) => {
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
      {orders.map((order) => {
        const isCard     = order.paymentMethod === "card_simulation";
        const isExpanded = expandedOrder === order.id;
        return (
          <div key={order.id} className={`bg-card border rounded-2xl shadow-sm overflow-hidden ${isCard ? "border-purple-200" : "border-border/60"}`}>
            <div className="p-5 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">#{order.id}</span>
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
                    <span className="text-xs text-muted-foreground">
                      {formatDateBR(order.createdAt)}
                    </span>
                  </div>
                  <h3 className="font-bold text-lg">{order.clientName}</h3>
                  <p className="text-sm text-muted-foreground">{order.clientEmail} · {order.clientPhone}</p>
                  {order.clientDocument && (
                    <p className="text-xs text-muted-foreground mt-0.5">CPF: {order.clientDocument}</p>
                  )}
                  {order.addressCity && (
                    <p className="text-xs text-muted-foreground mt-0.5">{order.addressCity}{order.addressState && `/${order.addressState}`}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-2xl font-bold text-primary">{formatCurrency(order.total)}</p>
                </div>
              </div>

              {/* Order management controls — shown for all orders */}
              <div className={`mt-4 p-4 rounded-xl border ${isCard ? "bg-purple-50 border-purple-100" : "bg-blue-50/50 border-blue-100/50"}`}>
                <p className={`text-sm font-semibold mb-3 ${isCard ? "text-purple-800" : "text-blue-800"}`}>
                  Gestão — {isCard ? "Cartão (simulação)" : "PIX"}
                </p>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" className="gap-1.5 text-green-700 border-green-200 hover:bg-green-50"
                    disabled={statusUpdating === order.id || order.status === "paid" || order.status === "completed"}
                    onClick={() => isCard ? onOpenCardPaidModal(order.id) : updateOrderStatus(order.id, "paid")}>
                    <CheckCircle className="w-3.5 h-3.5" />{isCard ? "Marcar Pago" : "Marcar Pago"}
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                    disabled={statusUpdating === order.id || order.status === "cancelled"}
                    onClick={() => updateOrderStatus(order.id, "cancelled")}>
                    <XCircle className="w-3.5 h-3.5" />Cancelar
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50"
                    onClick={() => setProofModal(order.id)}>
                    <Upload className="w-3.5 h-3.5" />
                    {(order.proofUrls && order.proofUrls.length > 0) || order.proofUrl ? "Adicionar Comprovante" : "Upload Comprovante"}
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
                  onClick={() => generateOrderPdf(order)}>
                  <Download className="w-3.5 h-3.5" />Baixar Pedido
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-slate-600 border-slate-200 hover:bg-slate-50"
                  onClick={() => copyOrder(order)}>
                  {copiedOrderId === order.id ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedOrderId === order.id ? "Copiado!" : "Copiar Dados"}
                </Button>
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
              </div>
            </div>

            {/* Expanded details */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="border-t border-border/50 bg-muted/30 px-5 sm:px-6 pb-5 pt-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Produtos</p>
                  <div className="space-y-1">
                    {order.products.map((p, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span>{p.quantity}x {p.name}</span>
                        <span className="font-medium">{formatCurrency(p.price * p.quantity)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-sm space-y-0.5 text-muted-foreground">
                    <p>Subtotal: {formatCurrency(Number(order.subtotal))}</p>
                    <p>Frete: {formatCurrency(Number(order.shippingCost))}</p>
                    {order.includeInsurance && <p>Seguro: {formatCurrency(Number(order.insuranceAmount))}</p>}
                    {order.transactionId && <p className="font-mono text-xs">Tx: {order.transactionId}</p>}
                    {order.sellerCode && <p>Vendedor: <strong>{order.sellerCode}</strong></p>}
                    {[order.addressStreet, order.addressNumber, order.addressNeighborhood, order.addressCity, order.addressState, order.addressCep].some(Boolean) && (
                      <p>Endereço: {[order.addressStreet, order.addressNumber, order.addressNeighborhood, `${order.addressCity||""}/${order.addressState||""}`, order.addressCep ? `CEP ${order.addressCep}` : ""].filter(Boolean).join(", ")}</p>
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

  const copyCharge = (charge: CustomCharge) => {
    navigator.clipboard.writeText(chargeToText(charge)).then(() => {
      setCopiedChargeId(charge.id);
      toast.success("Dados copiados!");
      setTimeout(() => setCopiedChargeId(null), 2500);
    }).catch(() => toast.error("Não foi possível copiar."));
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
                          {chargeCepLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
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
              onClick={() => generateChargePdf(charge)}>
              <Download className="w-3.5 h-3.5" />Baixar Pedido
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-slate-600 border-slate-200 hover:bg-slate-50"
              onClick={() => copyCharge(charge)}>
              {copiedChargeId === charge.id ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
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

type SavedSellerItem = { slug: string; whatsapp: string };

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
  const pixPaid         = paidOrders.filter((o) => o.paymentMethod === "pix");
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

function SellersPanel({ siteOrigin, savedSellersList, sellerInput, setSellerInput, sellerWhatsappInput, setSellerWhatsappInput, saveSeller, removeSeller, copySeller, copiedSeller, orders, charges, isPrimary, currentUsername }: {
  siteOrigin: string;
  savedSellersList: SavedSellerItem[];
  sellerInput: string; setSellerInput: (v: string) => void;
  sellerWhatsappInput: string; setSellerWhatsappInput: (v: string) => void;
  saveSeller: (s: string, w: string) => void; removeSeller: (s: string) => void;
  copySeller: (s: string) => void; copiedSeller: string | null;
  orders: AdminOrder[]; charges: CustomCharge[];
  isPrimary: boolean; currentUsername: string;
}) {
  const [copiedPaymentLink, setCopiedPaymentLink] = useState<string | null>(null);

  const copyPaymentLink = (slug: string) => {
    const url = `${siteOrigin}/pagamento?seller=${slug}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedPaymentLink(slug);
    toast.success("Link de pagamento copiado!");
    setTimeout(() => setCopiedPaymentLink(null), 2500);
  };

  // All seller slugs: those registered + those in orders (in case they were added manually)
  const registeredSlugs = savedSellersList.map((s) => s.slug);
  const orderSlugs = orders.map((o) => o.sellerCode).filter(Boolean) as string[];
  const allSlugs = Array.from(new Set([...registeredSlugs, ...orderSlugs]));
  // Build full list: registered sellers first, then any from orders not yet registered
  const allSellers: SavedSellerItem[] = allSlugs.map((slug) => {
    const found = savedSellersList.find((s) => s.slug === slug);
    return found ?? { slug, whatsapp: "" };
  });

  // For non-primary users, only show their own seller entry.
  // Match by: exact slug, or slug starts with cleaned username, or cleaned username starts with slug.
  const cleanUsername = currentUsername.toLowerCase().replace(/[^a-z]/g, "");
  const visibleSellers = isPrimary
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
            : "Seu link de vendedor. Compartilhe com seus clientes para que o suporte chegue diretamente a você."}
        </p>

        {/* Create form — only for full-access admins */}
        {isPrimary && (
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
              <Button onClick={() => saveSeller(sellerInput, sellerWhatsappInput)} className="gap-2 shrink-0" disabled={!sellerInput.trim()}>
                <Plus className="w-4 h-4" />Criar Link
              </Button>
            </div>
          </div>
        )}

        {visibleSellers.length > 0 ? (
          <div className="space-y-2">
            {visibleSellers.map(({ slug, whatsapp }) => {
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
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => copySeller(slug)} title="Copiar link da loja">
                      {copiedSeller === slug ? <CheckCircle2 className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                      {copiedSeller === slug ? "Copiado!" : "Loja"}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1 h-7 text-xs text-violet-700 border-violet-200 hover:bg-violet-50" onClick={() => copyPaymentLink(slug)} title="Copiar link de pagamento">
                      {copiedPaymentLink === slug ? <CheckCircle2 className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                      {copiedPaymentLink === slug ? "Copiado!" : "Pgto"}
                    </Button>
                    {isPrimary && (
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
            {isPrimary ? "Nenhum link criado ainda." : "Nenhum link de vendedor encontrado para o seu usuário."}
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

// ---------------------------------------------------------------------------
// CustomersPanel
// ---------------------------------------------------------------------------
function CustomersPanel({
  customers, loading, search, setSearch, onRefresh,
}: {
  customers: CustomerUserRecord[];
  loading: boolean;
  search: string;
  setSearch: (v: string) => void;
  onRefresh: () => void;
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
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
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, idx) => (
                <tr key={c.id} className={`border-b border-border last:border-0 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}>
                  <td className="px-4 py-3 font-medium text-foreground">{c.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${c.orderCount > 0 ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                      <Package className="w-3 h-3" />
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
                </tr>
              ))}
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
  userCreating, userDeleting, userAccessUpdating,
  createUser, deleteUser, toggleUserAccess,
}: {
  users: AdminUser[]; newUsername: string; setNewUsername: (v: string) => void;
  newPassword: string; setNewPassword: (v: string) => void;
  newFullAccess: boolean; setNewFullAccess: (v: boolean) => void;
  showNewPw: boolean; setShowNewPw: (v: boolean) => void;
  userCreating: boolean; userDeleting: string | null; userAccessUpdating: string | null;
  createUser: () => void; deleteUser: (id: string, username: string) => void;
  toggleUserAccess: (id: string, username: string, fullAccess: boolean) => void;
}) {
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
              ? <ToggleRight className="w-5 h-5 shrink-0" />
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
          <div key={u.id} className="bg-card border border-border/60 rounded-2xl p-4 flex items-center gap-4 shadow-sm">
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
                    ? <ToggleRight className="w-6 h-6 text-primary" />
                    : <ToggleLeft className="w-6 h-6" />}
              </button>
              {/* Delete */}
              <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 shrink-0"
                disabled={userDeleting === u.id}
                onClick={() => deleteUser(u.id, u.username)}>
                {userDeleting === u.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </Button>
            </div>
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
          {copiedUniversal ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
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
          {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
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
  coupons, couponForm, setCouponForm, couponCreating, couponDeleting,
  createCoupon, toggleCoupon, deleteCoupon, isPrimary,
}: {
  coupons: Coupon[];
  couponForm: { code: string; discountType: string; discountValue: string; minOrderValue: string; maxUses: string };
  setCouponForm: (f: { code: string; discountType: string; discountValue: string; minOrderValue: string; maxUses: string }) => void;
  couponCreating: boolean; couponDeleting: string | null; isPrimary: boolean;
  createCoupon: () => void;
  toggleCoupon: (id: string, isActive: boolean) => void;
  deleteCoupon: (id: string, code: string) => void;
}) {
  const inp = "h-10 px-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm w-full";

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
            {coupons.map((c) => (
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
                          ? <ToggleRight className="w-6 h-6 text-primary" />
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
            ))}
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
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [expandedLinks, setExpandedLinks] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const siteOrigin = window.location.origin;

  const copyLink = (link: string, key: string) => {
    navigator.clipboard.writeText(link).then(() => {
      setCopiedLink(key);
      setTimeout(() => setCopiedLink(null), 2000);
    });
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
      img.onload = () => {
        const MAX = 800;
        const scale = img.width > MAX ? MAX / img.width : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) { setProductForm({ ...productForm, image: src }); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setProductForm({ ...productForm, image: canvas.toDataURL("image/jpeg", 0.82) });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const openCreate = () => {
    setProductForm({ unit: "unidade", isActive: true, sortOrder: 0 });
    setProductFormOpen(true);
  };

  const openEdit = (p: AdminProduct) => {
    setProductForm({ ...p, _editing: true });
    setProductFormOpen(true);
  };

  const UNITS = ["unidade", "caixa", "caneta", "frasco", "par", "kit"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><ShoppingBag className="w-5 h-5 text-primary" />Catálogo de Produtos</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{products.length} produto{products.length !== 1 ? "s" : ""} cadastrado{products.length !== 1 ? "s" : ""}</p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" />Novo Produto</Button>
      </div>

      {/* Product form modal */}
      <AnimatePresence>
        {productFormOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto"
            onClick={(e) => { if (e.target === e.currentTarget) { setProductFormOpen(false); setProductForm({}); } }}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl my-4">
              <div className="flex items-center justify-between px-8 pt-8 pb-4 border-b">
                <h3 className="text-xl font-bold">{productForm._editing ? "Editar Produto" : "Novo Produto"}</h3>
                <Button size="icon" variant="ghost" onClick={() => { setProductFormOpen(false); setProductForm({}); }}><X className="w-5 h-5" /></Button>
              </div>

              <div className="p-8 space-y-4">
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
                    <input value={productForm.category || ""} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} placeholder="Ex: Canetas, Kits, Destaque..." className={inp2} />
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

                  {/* Sort order */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Ordem de exibição</label>
                    <input type="number" step="1" min="0" value={productForm.sortOrder ?? 0} onChange={(e) => setProductForm({ ...productForm, sortOrder: parseInt(e.target.value) || 0 })} className={inp2} />
                  </div>

                  {/* Active */}
                  <div className="flex items-center gap-3 self-end pb-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ativo</label>
                    <button type="button" onClick={() => setProductForm({ ...productForm, isActive: !productForm.isActive })} className="text-muted-foreground hover:text-primary transition-colors">
                      {productForm.isActive !== false ? <ToggleRight className="w-7 h-7 text-primary" /> : <ToggleLeft className="w-7 h-7" />}
                    </button>
                  </div>
                </div>

                {/* Image upload */}
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Imagem do Produto <span className="font-normal normal-case text-muted-foreground">— opcional, máx. 3MB</span></label>
                  <div className="flex gap-4 items-start">
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
                    <label className="flex-1 flex flex-col items-center justify-center h-24 rounded-xl border-2 border-dashed border-border hover:border-primary cursor-pointer transition-colors bg-muted/20 hover:bg-primary/5">
                      <input type="file" accept="image/*" className="hidden" ref={fileRef} onChange={handleImageUpload} />
                      <Upload className="w-6 h-6 text-muted-foreground mb-1" />
                      <p className="text-sm font-medium text-muted-foreground">Clique para selecionar imagem</p>
                      <p className="text-xs text-muted-foreground">JPG, PNG, WebP · máx. 3MB</p>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 px-8 pb-8">
                <Button variant="outline" className="flex-1" onClick={() => { setProductFormOpen(false); setProductForm({}); }}>Cancelar</Button>
                <Button className="flex-1 gap-2" disabled={productSaving || !productForm.name?.trim() || !productForm.category?.trim() || !productForm.price} onClick={onSave}>
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
          <Package2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="font-semibold text-lg">Nenhum produto cadastrado</p>
          <p className="text-sm text-muted-foreground mb-6">Clique em "Novo Produto" para começar.</p>
          <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" />Novo Produto</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {products.map((p) => {
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
                      {!p.isActive && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Inativo</span>}
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
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setExpandedLinks(expandedLinks === p.id ? null : p.id)}
                      title="Links de checkout por vendedor"
                      className={`text-muted-foreground hover:text-primary transition-colors p-1 ${expandedLinks === p.id ? "text-primary" : ""}`}
                    >
                      <LinkIcon className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => onToggle(p.id, !p.isActive)} title={p.isActive ? "Desativar" : "Ativar"} className="text-muted-foreground hover:text-primary transition-colors">
                      {p.isActive ? <ToggleRight className="w-6 h-6 text-primary" /> : <ToggleLeft className="w-6 h-6" />}
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
                                {copiedLink === key ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
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
    </div>
  );
}

// ===========================================================================
// ConfiguracoesPanel — logo, banner desktop, banner mobile
// ===========================================================================
function ImageUploadCard({
  title, description, settingKey, currentSrc, loading,
  onSave, onDelete,
}: {
  title: string; description: string; settingKey: string;
  currentSrc?: string; loading: boolean;
  onSave: (key: string, value: string) => void;
  onDelete: (key: string) => void;
}) {
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
        const MAX = settingKey === "logo" ? 400 : 1920;
        const scale = img.width > MAX ? MAX / img.width : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) { onSave(settingKey, src); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL("image/jpeg", 0.82);
        onSave(settingKey, compressed);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="bg-white border border-border/60 rounded-2xl p-6 shadow-sm">
      <h3 className="text-base font-bold mb-0.5">{title}</h3>
      <p className="text-muted-foreground text-sm mb-4">{description}</p>

      {/* Preview */}
      {currentSrc ? (
        <div className="relative mb-4">
          <img src={currentSrc} alt={title} className="w-full max-h-48 object-contain rounded-xl border bg-muted/20" />
          <button
            onClick={() => onDelete(settingKey)}
            disabled={loading}
            className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-lg p-1.5 shadow"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
          </button>
        </div>
      ) : (
        <div className="w-full h-32 rounded-xl border-2 border-dashed border-border bg-muted/20 flex flex-col items-center justify-center mb-4 text-muted-foreground">
          <ImageOff className="w-8 h-8 mb-1.5" />
          <p className="text-sm font-medium">Sem imagem</p>
          <p className="text-xs">Padrão do sistema em uso</p>
        </div>
      )}

      <label className={`flex items-center justify-center gap-2 w-full h-10 rounded-xl cursor-pointer text-sm font-semibold transition-colors ${loading ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary text-white hover:bg-primary/90"}`}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {currentSrc ? "Trocar imagem" : "Carregar imagem"}
        <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={loading} />
      </label>
    </div>
  );
}

function ConfiguracoesPanel({ settings, loading, onSave, onDelete }: {
  settings: Record<string, string>;
  loading: Record<string, boolean>;
  onSave: (key: string, value: string) => void;
  onDelete: (key: string) => void;
}) {
  const [sitePw, setSitePw] = useState(settings["site_password"] ?? "");
  const [paymentPw, setPaymentPw] = useState(settings["payment_password"] ?? "");
  const [showSitePw, setShowSitePw] = useState(false);
  const [showPaymentPw, setShowPaymentPw] = useState(false);

  return (
    <div className="space-y-8">
      {/* ── Identidade Visual ─────────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
          <Package2 className="w-5 h-5 text-primary" />
          Identidade Visual
        </h2>
        <p className="text-muted-foreground text-sm mb-5">
          Personalize o logo e os banners exibidos na loja. As imagens são aplicadas imediatamente após o upload.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          <ImageUploadCard
            title="Logo do Site"
            description="Exibido no cabeçalho e rodapé da loja. Recomendado: quadrado ou retangular, fundo transparente."
            settingKey="logo"
            currentSrc={settings["logo"]}
            loading={!!loading["logo"]}
            onSave={onSave}
            onDelete={onDelete}
          />
          <ImageUploadCard
            title="Banner Desktop"
            description="Banner principal exibido na página inicial em telas maiores. Recomendado: 1920×480px."
            settingKey="banner_desktop"
            currentSrc={settings["banner_desktop"]}
            loading={!!loading["banner_desktop"]}
            onSave={onSave}
            onDelete={onDelete}
          />
          <ImageUploadCard
            title="Banner Mobile"
            description="Banner exibido em smartphones. Recomendado: 800×400px ou proporção 2:1."
            settingKey="banner_mobile"
            currentSrc={settings["banner_mobile"]}
            loading={!!loading["banner_mobile"]}
            onSave={onSave}
            onDelete={onDelete}
          />
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

      {/* ── Info ──────────────────────────────────────────────────────────── */}
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
                        {updating === opt.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
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
                        {opt.isActive ? <ToggleRight className="w-5 h-5 text-green-600" /> : <ToggleLeft className="w-5 h-5" />}
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
