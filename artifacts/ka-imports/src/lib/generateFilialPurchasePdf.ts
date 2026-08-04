import jsPDF from "jspdf";
import { formatDateBR } from "@/lib/utils";

const PRIMARY = [15, 23, 42] as [number, number, number];
const MUTED = [100, 116, 139] as [number, number, number];
const LINE = [226, 232, 240] as [number, number, number];
const WHITE = [255, 255, 255] as [number, number, number];
const BG_HEADER = [15, 23, 42] as [number, number, number];

function fmt(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function purchaseStatusLabel(status: string): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "pendente_pagamento_filial") return "Pendente pagamento da filial";
  if (normalized === "pago_na_filial") return "Pago na filial";
  if (normalized === "aguardando_compra_loja1") return "Aguardando compra Loja 1";
  if (normalized === "compra_registrada") return "Compra registrada";
  if (normalized === "estoque_lancado_filial") return "Estoque lancado na filial";
  if (normalized === "finalizado") return "Finalizado";
  if (normalized === "cancelado") return "Cancelado";
  return status || "-";
}

function hline(doc: jsPDF, y: number, left = 14, right = 196): void {
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
  const lines = doc.splitTextToSize(value, 112) as string[];
  doc.text(lines, 74, y);
  return y + lines.length * 5.5;
}

export interface FilialPurchaseItemForPdf {
  productId: string;
  productName: string;
  quantity: number;
  saleUnitPrice?: number;
  baseUnitCost?: number | null;
  repasseUnitCost: number;
}

export interface FilialPurchaseForPdf {
  id: string;
  filialTenantName: string;
  orderId: string;
  status: string;
  clientName: string;
  orderTotal: number;
  repasseTotal: number;
  loja1RealCostTotal?: number;
  loja1RealProfit?: number;
  createdAt: string | null;
  purchaseRecordedAt?: string | null;
  stockLaunchedAt?: string | null;
  finalizedAt?: string | null;
  items: FilialPurchaseItemForPdf[];
}

function buildFilename(input: FilialPurchaseForPdf): string {
  const orderIdSafe = String(input.orderId || input.id || "pedido").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `compra-fornecedor-${orderIdSafe}.pdf`;
}

function buildPdfDoc(input: FilialPurchaseForPdf): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const status = purchaseStatusLabel(input.status);

  doc.setFillColor(...BG_HEADER);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...WHITE);
  doc.text("KA IMPORTS", 14, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(180, 195, 215);
  doc.text("Pedido de Compra da Filial", 14, 20);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...WHITE);
  doc.text(status, pageW - 14, 14, { align: "right" });

  let y = 38;
  y = sectionTitle(doc, y, "Informacoes do Pedido");
  y = row(doc, y, "Pedido", String(input.orderId || "-"), true);
  y = row(doc, y, "Solicitacao", String(input.id || "-"));
  y = row(doc, y, "Filial", String(input.filialTenantName || "-"));
  y = row(doc, y, "Cliente", String(input.clientName || "-"));
  y = row(doc, y, "Status", status);
  y += 3;

  y = sectionTitle(doc, y, "Datas");
  y = row(doc, y, "Criado em", formatDateBR(input.createdAt) || "-");
  y = row(doc, y, "Compra registrada", formatDateBR(input.purchaseRecordedAt) || "-");
  y = row(doc, y, "Estoque lancado", formatDateBR(input.stockLaunchedAt) || "-");
  y = row(doc, y, "Finalizado em", formatDateBR(input.finalizedAt) || "-");
  y += 3;

  y = sectionTitle(doc, y, "Produtos");

  for (const item of input.items || []) {
    const qty = Number(item.quantity || 0);
    const repasseUnit = Number(item.repasseUnitCost || 0);
    const lineTotal = qty * repasseUnit;
    const lineLabel = `${qty}x ${item.productName || "Produto"}`;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...PRIMARY);
    const lines = doc.splitTextToSize(lineLabel, 128) as string[];
    doc.text(lines, 14, y);

    doc.setFont("helvetica", "bold");
    doc.text(fmt(lineTotal), pageW - 14, y, { align: "right" });
    y += lines.length * 5.5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const saleUnit = Number(item.saleUnitPrice || 0);
    const baseUnit = Number(item.baseUnitCost || 0);
    doc.text(`ID: ${item.productId || "-"}`, 14, y);
    y += 4.5;
    doc.text(`Repasse un.: ${fmt(repasseUnit)} | Venda un.: ${fmt(saleUnit)} | Custo base un.: ${fmt(baseUnit)}`, 14, y);
    y += 6;

    if (y > 265) {
      doc.addPage();
      y = 20;
    }
  }

  hline(doc, y - 1);
  y += 3;

  const summaryRows: Array<[string, string, boolean]> = [
    ["Total pago na filial", fmt(Number(input.orderTotal || 0)), false],
    ["Repasse para filial", fmt(Number(input.repasseTotal || 0)), false],
  ];

  if (Number.isFinite(Number(input.loja1RealCostTotal))) {
    summaryRows.push(["Custo real Loja 1", fmt(Number(input.loja1RealCostTotal || 0)), false]);
  }
  if (Number.isFinite(Number(input.loja1RealProfit))) {
    summaryRows.push(["Lucro real Loja 1", fmt(Number(input.loja1RealProfit || 0)), false]);
  }

  summaryRows.forEach(([label, value, bold]) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(9);
    doc.setTextColor(...(bold ? PRIMARY : MUTED));
    doc.text(label, pageW - 88, y);
    doc.text(value, pageW - 14, y, { align: "right" });
    y += 6;
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text("Documento gerado automaticamente pelo painel da filial.", pageW / 2, 287, { align: "center" });

  return doc;
}

export function downloadFilialPurchasePdf(input: FilialPurchaseForPdf): void {
  const doc = buildPdfDoc(input);
  doc.save(buildFilename(input));
}

export function openFilialPurchasePdfInBrowser(input: FilialPurchaseForPdf): void {
  // Open a blank tab immediately in the click context to avoid popup blocking,
  // then navigate it to the generated blob URL.
  const popup = window.open("", "_blank");

  if (!popup) {
    throw new Error("POPUP_BLOCKED");
  }

  popup.document.title = "Gerando PDF...";
  popup.document.body.style.fontFamily = "Arial, sans-serif";
  popup.document.body.style.padding = "16px";
  popup.document.body.textContent = "Gerando PDF da compra...";

  const doc = buildPdfDoc(input);
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  popup.location.href = url;

  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
