import jsPDF from "jspdf";
import { formatDateBR } from "@/lib/utils";

const PRIMARY = [15, 23, 42] as [number, number, number];
const MUTED   = [100, 116, 139] as [number, number, number];
const LINE    = [226, 232, 240] as [number, number, number];
const WHITE   = [255, 255, 255] as [number, number, number];
const BG_HEADER = [15, 23, 42] as [number, number, number];
const GREEN   = [22, 163, 74] as [number, number, number];
const RED     = [220, 38, 38] as [number, number, number];
const AMBER   = [180, 83, 9] as [number, number, number];
const PURPLE  = [109, 40, 217] as [number, number, number];

function fmt(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function statusLabel(status: string): string {
  switch (status) {
    case "paid":              return "Pago";
    case "completed":         return "Concluído";
    case "pending":           return "Pendente";
    case "awaiting_payment":  return "Aguardando Pagamento";
    case "cancelled":         return "Cancelado";
    default:                  return status;
  }
}

function statusColor(status: string): [number, number, number] {
  switch (status) {
    case "paid":
    case "completed":        return GREEN;
    case "cancelled":        return RED;
    case "awaiting_payment": return AMBER;
    default:                 return MUTED;
  }
}

function hline(doc: jsPDF, y: number, left = 14, right = 196) {
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(left, y, right, y);
}

function sectionTitle(doc: jsPDF, y: number, text: string): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(text.toUpperCase(), 14, y);
  hline(doc, y + 1.5, 14, 196);
  return y + 7;
}

function row(doc: jsPDF, y: number, label: string, value: string, bold = false): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(label, 14, y);
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setTextColor(...PRIMARY);
  const lines = doc.splitTextToSize(value, 110) as string[];
  doc.text(lines, 75, y);
  return y + lines.length * 5.5;
}

// ─────────────────────────────────────────────────────────────────
// ORDER (PIX or Card)
// ─────────────────────────────────────────────────────────────────
export interface OrderForPdf {
  id: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientDocument: string;
  addressCep?: string | null;
  addressStreet?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  addressNeighborhood?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  products: Array<{ name: string; quantity: number; price: number }>;
  shippingType: string;
  includeInsurance: boolean;
  subtotal: number;
  shippingCost: number;
  insuranceAmount: number;
  total: number;
  status: string;
  paymentMethod?: string | null;
  cardInstallments?: number | null;
  cardInstallmentsActual?: number | null;
  cardInstallmentValue?: number | null;
  cardTotalActual?: number | null;
  transactionId?: string | null;
  sellerCode?: string | null;
  observation?: string | null;
  createdAt: string;
}

export function generateOrderPdf(order: OrderForPdf): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const isCard = order.paymentMethod === "card_simulation";
  const pageW = 210;

  // ── Header bar ──────────────────────────────────────────────
  doc.setFillColor(...BG_HEADER);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...WHITE);
  doc.text("KA IMPORTS", 14, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(180, 195, 215);
  doc.text("Nota de Pedido", 14, 20);

  // type badge text on right
  const typeLabel = isCard ? "Cartão (Simulação)" : "PIX";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...WHITE);
  doc.text(typeLabel, pageW - 14, 14, { align: "right" });

  // Status badge
  const sLabel = statusLabel(order.status);
  doc.setTextColor(...statusColor(order.status));
  doc.setFontSize(9);
  doc.text(sLabel, pageW - 14, 22, { align: "right" });

  // ── Order info ───────────────────────────────────────────────
  let y = 38;
  y = sectionTitle(doc, y, "Informações do Pedido");
  y = row(doc, y, "Número do Pedido", `#${order.id}`);
  y = row(doc, y, "Data / Hora", formatDateBR(order.createdAt));
  y = row(doc, y, "Status", sLabel, true);
  y = row(doc, y, "Forma de Pagamento", isCard ? `Cartão${order.cardInstallments ? ` – ${order.cardInstallments}x` : ""}` : "PIX");
  if (order.sellerCode) y = row(doc, y, "Vendedor", order.sellerCode);
  if (order.transactionId) y = row(doc, y, "ID da Transação", order.transactionId);
  y += 4;

  // ── Client info ──────────────────────────────────────────────
  y = sectionTitle(doc, y, "Dados do Cliente");
  y = row(doc, y, "Nome", order.clientName, true);
  y = row(doc, y, "E-mail", order.clientEmail);
  y = row(doc, y, "Telefone", order.clientPhone);
  if (order.clientDocument) y = row(doc, y, "CPF", order.clientDocument);

  const addrParts = [
    order.addressStreet, order.addressNumber, order.addressComplement,
    order.addressNeighborhood,
    `${order.addressCity || ""}${order.addressState ? `/${order.addressState}` : ""}`,
    order.addressCep ? `CEP ${order.addressCep}` : "",
  ].filter(Boolean);
  if (addrParts.length > 0) y = row(doc, y, "Endereço", addrParts.join(", "));
  y += 4;

  // ── Products ─────────────────────────────────────────────────
  y = sectionTitle(doc, y, "Produtos");
  order.products.forEach((p) => {
    const itemTotal = fmt(p.price * p.quantity);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...PRIMARY);
    const desc = `${p.quantity}x ${p.name}`;
    const descLines = doc.splitTextToSize(desc, 130) as string[];
    doc.text(descLines, 14, y);
    doc.setFont("helvetica", "bold");
    doc.text(itemTotal, pageW - 14, y, { align: "right" });
    y += descLines.length * 5.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Preço unitário: ${fmt(p.price)}`, 14, y);
    y += 5;
  });
  y += 3;
  hline(doc, y - 1);

  // ── Financial summary ────────────────────────────────────────
  const finRows: [string, string, boolean][] = [
    ["Subtotal", fmt(Number(order.subtotal)), false],
    ["Frete", fmt(Number(order.shippingCost)), false],
  ];
  if (order.includeInsurance) finRows.push(["Seguro", fmt(Number(order.insuranceAmount)), false]);
  finRows.push(["TOTAL", fmt(Number(order.total)), true]);

  finRows.forEach(([label, value, bold]) => {
    const finColor = bold ? PRIMARY : MUTED;
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 10 : 9);
    doc.setTextColor(finColor[0], finColor[1], finColor[2]);
    doc.text(label, pageW - 60, y);
    doc.text(value, pageW - 14, y, { align: "right" });
    y += 6;
  });
  y += 4;

  // ── Card actual payment (if applicable) ──────────────────────
  if (isCard && (order.cardInstallmentsActual || order.cardInstallmentValue || order.cardTotalActual)) {
    y = sectionTitle(doc, y, "Pagamento Real no Cartão");
    doc.setFillColor(245, 240, 255);
    const boxH = 6 + (order.cardInstallmentsActual ? 6 : 0) + (order.cardInstallmentValue ? 6 : 0) + (order.cardTotalActual ? 6 : 0);
    doc.roundedRect(14, y - 4, pageW - 28, boxH, 2, 2, "F");
    doc.setTextColor(...PURPLE);
    if (order.cardInstallmentsActual) { y = row(doc, y, "Parcelas (real)", `${order.cardInstallmentsActual}x`, true); }
    if (order.cardInstallmentValue)   { y = row(doc, y, "Valor por parcela", fmt(Number(order.cardInstallmentValue)), true); }
    if (order.cardTotalActual)        { y = row(doc, y, "Total cobrado (real)", fmt(Number(order.cardTotalActual)), true); }
    doc.setTextColor(...PRIMARY);
    y += 4;
  }

  // ── Observations ─────────────────────────────────────────────
  if (order.observation && order.observation.trim()) {
    y = sectionTitle(doc, y, "Observações");
    doc.setFillColor(248, 250, 252);
    const obsLines = doc.splitTextToSize(order.observation.trim(), pageW - 42) as string[];
    doc.roundedRect(14, y - 4, pageW - 28, obsLines.length * 5.5 + 6, 2, 2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...PRIMARY);
    doc.text(obsLines, 18, y);
    y += obsLines.length * 5.5 + 6;
  }

  // ── Footer ───────────────────────────────────────────────────
  const pageH = 297;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text("KA Imports — Documento gerado automaticamente. Sujeito a confirmação de pagamento.", pageW / 2, pageH - 10, { align: "center" });

  const filename = `pedido-${order.id}-${order.clientName.split(" ")[0].toLowerCase()}.pdf`;
  doc.save(filename);
}

// ─────────────────────────────────────────────────────────────────
// CUSTOM CHARGE (Link de Pagamento)
// ─────────────────────────────────────────────────────────────────
export interface ChargeForPdf {
  id: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientDocument: string;
  addressCep?: string | null;
  addressStreet?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  addressNeighborhood?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  description?: string | null;
  sellerCode?: string | null;
  amount: number;
  status: string;
  transactionId?: string | null;
  observation?: string | null;
  createdAt: string;
}

export function generateChargePdf(charge: ChargeForPdf): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;

  // ── Header bar ──────────────────────────────────────────────
  doc.setFillColor(...BG_HEADER);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...WHITE);
  doc.text("KA IMPORTS", 14, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(180, 195, 215);
  doc.text("Nota de Cobrança — Link de Pagamento", 14, 20);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...statusColor(charge.status));
  doc.text(statusLabel(charge.status), pageW - 14, 18, { align: "right" });

  // ── Order info ───────────────────────────────────────────────
  let y = 38;
  y = sectionTitle(doc, y, "Informações da Cobrança");
  y = row(doc, y, "Número", `#${charge.id}`);
  y = row(doc, y, "Data / Hora", formatDateBR(charge.createdAt));
  y = row(doc, y, "Status", statusLabel(charge.status), true);
  y = row(doc, y, "Forma de Pagamento", "PIX — Link de Pagamento");
  if (charge.sellerCode) y = row(doc, y, "Vendedor", charge.sellerCode);
  if (charge.transactionId) y = row(doc, y, "ID da Transação", charge.transactionId);
  y += 4;

  // ── Client info ──────────────────────────────────────────────
  y = sectionTitle(doc, y, "Dados do Cliente");
  y = row(doc, y, "Nome", charge.clientName, true);
  y = row(doc, y, "E-mail", charge.clientEmail);
  y = row(doc, y, "Telefone", charge.clientPhone);
  if (charge.clientDocument) y = row(doc, y, "CPF", charge.clientDocument);

  const addrParts = [
    charge.addressStreet, charge.addressNumber, charge.addressComplement,
    charge.addressNeighborhood,
    `${charge.addressCity || ""}${charge.addressState ? `/${charge.addressState}` : ""}`,
    charge.addressCep ? `CEP ${charge.addressCep}` : "",
  ].filter(Boolean);
  if (addrParts.length > 0) y = row(doc, y, "Endereço", addrParts.join(", "));
  y += 4;

  // ── Produto (description) ────────────────────────────────────
  y = sectionTitle(doc, y, "Produto / Pedido");
  if (charge.description && charge.description.trim()) {
    const descLines = doc.splitTextToSize(charge.description.trim(), 130) as string[];
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...PRIMARY);
    doc.text(descLines, 14, y);
    doc.setFont("helvetica", "bold");
    doc.text(fmt(Number(charge.amount)), pageW - 14, y, { align: "right" });
    y += descLines.length * 5.5 + 3;
  } else {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text("Sem descrição de produto", 14, y);
    y += 7;
  }

  hline(doc, y);
  y += 5;

  // ── Total ────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...PRIMARY);
  doc.text("TOTAL", pageW - 60, y);
  doc.text(fmt(Number(charge.amount)), pageW - 14, y, { align: "right" });
  y += 10;

  // ── Observations ─────────────────────────────────────────────
  if (charge.observation && charge.observation.trim()) {
    y = sectionTitle(doc, y, "Observações");
    doc.setFillColor(248, 250, 252);
    const obsLines = doc.splitTextToSize(charge.observation.trim(), pageW - 42) as string[];
    doc.roundedRect(14, y - 4, pageW - 28, obsLines.length * 5.5 + 6, 2, 2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...PRIMARY);
    doc.text(obsLines, 18, y);
    y += obsLines.length * 5.5 + 6;
  }

  // ── Footer ───────────────────────────────────────────────────
  const pageH = 297;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text("KA Imports — Documento gerado automaticamente. Sujeito a confirmação de pagamento.", pageW / 2, pageH - 10, { align: "center" });

  const filename = `cobranca-${charge.id}-${charge.clientName.split(" ")[0].toLowerCase()}.pdf`;
  doc.save(filename);
}
