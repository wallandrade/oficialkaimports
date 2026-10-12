import { shipmentLabelPdfFilename } from "./shipment-label-filename";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function adminAuthHeader(): Record<string, string> {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function saveBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

/** Baixa a etiqueta uma vez, com o nome do cliente. */
export function openShipmentLabelPdf(input: {
  orderId: string;
  packageId?: string | null;
  fallbackUrl?: string | null;
  clientName?: string | null;
  orderNumber?: number | null;
  poolLabel?: string | null;
}): void {
  const query = input.packageId ? `?packageId=${encodeURIComponent(input.packageId)}` : "";
  void (async () => {
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/orders/${encodeURIComponent(input.orderId)}/label-pdf${query}`, {
        headers: adminAuthHeader(),
      });
      if (!res.ok) throw new Error("label-pdf");
      const blob = await res.blob();
      saveBlob(blob, shipmentLabelPdfFilename(input));
    } catch {
      const fallback = String(input.fallbackUrl || "").trim();
      if (fallback) window.open(fallback, "_blank", "noopener,noreferrer");
    }
  })();
}
