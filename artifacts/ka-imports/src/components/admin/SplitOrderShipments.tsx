import { useMemo, useState } from "react";
import { Loader2, Split } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EnvioEcomOrderActions, type EnvioEcomOrderFields, type EnvioEcomPackageFields } from "@/components/admin/EnvioEcomOrderActions";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Pool = "loja" | "motoboy" | "minas";

type OrderProduct = { id?: string; name?: string; quantity?: number };

function adminHeaders() {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

function poolLabel(pool: string): string {
  if (pool === "motoboy") return "Motoboy";
  if (pool === "minas") return "Minas";
  return "Fóz Guaçu";
}

function parseProducts(products: unknown): Array<{ id: string; name: string; quantity: number }> {
  const rows = Array.isArray(products) ? products : [];
  return rows
    .map((item) => {
      const row = item as OrderProduct;
      return {
        id: String(row.id || "").trim(),
        name: String(row.name || "Produto").trim() || "Produto",
        quantity: Math.trunc(Number(row.quantity || 0)),
      };
    })
    .filter((item) => item.quantity > 0);
}

export function isSplitOrder(order: { packages?: EnvioEcomPackageFields[] | null }): boolean {
  return Array.isArray(order.packages) && order.packages.length >= 2;
}

export function SplitOrderShipmentsButton({
  order,
  onPatched,
  inventoryByProduct,
  yuryByProduct,
}: {
  order: EnvioEcomOrderFields & { products?: unknown; enviado?: boolean };
  onPatched: (patch: Partial<EnvioEcomOrderFields> & { id: string }) => void;
  inventoryByProduct?: Record<string, number>;
  yuryByProduct?: Record<string, { motoboy: number; minas: number }>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const products = useMemo(() => parseProducts(order.products), [order.products]);
  const [qty, setQty] = useState<Record<string, Record<Pool, number>>>(() => {
    const next: Record<string, Record<Pool, number>> = {};
    for (const product of products) {
      next[product.id || product.name] = { loja: product.quantity, motoboy: 0, minas: 0 };
    }
    return next;
  });

  function setCell(key: string, pool: Pool, value: number, max: number) {
    const qtyValue = Math.max(0, Math.min(max, Math.trunc(Number(value) || 0)));
    setQty((current) => ({
      ...current,
      [key]: { ...current[key], [pool]: qtyValue },
    }));
  }

  async function submit() {
    const packages: Array<{ pool: Pool; items: Array<{ id: string; name: string; quantity: number }> }> = [];
    for (const pool of ["loja", "motoboy", "minas"] as const) {
      const items = products
        .map((product) => {
          const key = product.id || product.name;
          const quantity = Number(qty[key]?.[pool] || 0);
          return { id: product.id, name: product.name, quantity };
        })
        .filter((item) => item.quantity > 0);
      if (items.length) packages.push({ pool, items });
    }
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/admin/orders/${order.id}/shipments`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ packages }),
      });
      const data = await res.json() as { order?: EnvioEcomOrderFields; message?: string; error?: string };
      if (!res.ok) throw new Error(data.message || data.error || "Falha ao dividir envio.");
      if (data.order) onPatched(data.order);
      toast.success("Envio dividido em pacotes.");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao dividir envio.");
    } finally {
      setBusy(false);
    }
  }

  if (isSplitOrder(order)) {
    return (
      <div className="w-full space-y-3">
        {order.packages!.map((pkg) => (
          <div key={pkg.id} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
            <p className="text-xs font-semibold text-emerald-900">
              Pacote {poolLabel(String(pkg.inventoryPool || ""))}
              {pkg.enviado ? " · Enviado" : pkg.inventoryReserved ? " · Estoque baixado" : ""}
            </p>
            <ul className="text-xs text-emerald-900/80 space-y-0.5">
              {(pkg.items || []).map((item, index) => (
                <li key={`${pkg.id}-${item.productId || item.productName || index}`}>
                  {item.quantity}× {item.productName || item.productId}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <EnvioEcomOrderActions
                order={order}
                packageId={pkg.id}
                poolLabel={poolLabel(String(pkg.inventoryPool || ""))}
                onPatched={onPatched}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5 text-violet-700 border-violet-200 hover:bg-violet-50"
        disabled={!!order.enviado}
        onClick={() => setOpen(true)}
      >
        <Split className="w-3.5 h-3.5" />
        Dividir envio
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-[28px] max-w-lg w-full shadow-xl max-h-[88vh] overflow-auto p-5 sm:p-6" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-lg font-bold text-neutral-900">Dividir envio</h2>
            <p className="text-sm text-neutral-500 mt-1">
              Um pacote por origem. A soma das qtds precisa fechar o pedido. O mesmo SKU pode partir.
            </p>
            <div className="mt-4 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                    <th className="pb-2 pr-2">Item</th>
                    <th className="pb-2 px-1">Pedido</th>
                    <th className="pb-2 px-1">Fóz</th>
                    <th className="pb-2 px-1">Motoboy</th>
                    <th className="pb-2 px-1">Minas</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => {
                    const key = product.id || product.name;
                    const lojaStock = product.id ? Number(inventoryByProduct?.[product.id] || 0) : 0;
                    const yury = product.id ? yuryByProduct?.[product.id] : undefined;
                    return (
                      <tr key={key} className="border-t border-neutral-100">
                        <td className="py-2 pr-2">
                          <p className="font-medium text-neutral-900">{product.name}</p>
                          <p className="text-[11px] text-neutral-400">
                            Fóz {lojaStock} · Motoboy {yury?.motoboy ?? "—"} · Minas {yury?.minas ?? "—"}
                          </p>
                        </td>
                        <td className="py-2 px-1 font-semibold">{product.quantity}</td>
                        {(["loja", "motoboy", "minas"] as const).map((pool) => (
                          <td key={pool} className="py-2 px-1">
                            <input
                              type="number"
                              min={0}
                              max={product.quantity}
                              className="w-16 border border-neutral-300 rounded-lg px-2 py-1"
                              value={qty[key]?.[pool] ?? 0}
                              onChange={(event) => setCell(key, pool, Number(event.target.value), product.quantity)}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="button" disabled={busy} onClick={() => void submit()}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar divisão"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
