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
  return objectUrl;
}

/** Baixa a etiqueta com o nome do cliente e abre o PDF na aba já criada. */
export function openShipmentLabelPdf(input: {
  orderId: string;
  packageId?: string | null;
  fallbackUrl?: string | null;
  clientName?: string | null;
  orderNumber?: number | null;
  poolLabel?: string | null;
}): void {
  const preview = window.open("about:blank", "_blank");
  const query = input.packageId ? `?packageId=${encodeURIComponent(input.packageId)}` : "";
  void (async () => {
    try {
      const res = await fetch(`${BASE}/api/admin/envioecom/orders/${encodeURIComponent(input.orderId)}/label-pdf${query}`, {
        headers: adminAuthHeader(),
      });
      if (!res.ok) throw new Error("label-pdf");
      const blob = await res.blob();
      const filename = shipmentLabelPdfFilename(input);
      const objectUrl = saveBlob(blob, filename);
      if (preview && !preview.closed) preview.location.href = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 180_000);
    } catch {
      const fallback = String(input.fallbackUrl || "").trim();
      if (preview && !preview.closed) {
        if (fallback) preview.location.href = fallback;
        else preview.close();
      } else if (fallback) {
        window.open(fallback, "_blank", "noopener,noreferrer");
      }
    }
  })();
}
