import { useMemo, useState } from "react";
import { ArrowLeftRight, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type SwapLine = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  costPrice?: number;
  image?: string | null;
  swappedFrom?: { id?: string; name?: string; quantity?: number } | null;
};

type CatalogProduct = {
  id: string;
  name: string;
  image?: string | null;
  price?: number;
  costPrice?: number;
};

type LinePreview = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  lineTotal: number;
  lineCost: number;
  lineProfit: number;
};

type SwapPreview = {
  from: LinePreview;
  keepPrice: { to: LinePreview; newTotal: number; difference: number };
  passDifference: {
    to: LinePreview;
    newTotal: number;
    difference: number;
    needsDifferenceCharge: boolean;
    walletCredit: number;
    guestNoWallet?: boolean;
  };
};

function adminHeaders() {
  const token = sessionStorage.getItem("adminToken") || localStorage.getItem("adminToken") || "";
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

function Profit({ value }: { value: number }) {
  const negative = value < -0.009;
  return (
    <span className={negative ? "text-red-600 font-semibold" : "text-emerald-700 font-semibold"}>
      {negative ? "Prejuízo" : "Lucro"} {formatCurrency(value)}
    </span>
  );
}

export function ReplaceOrderProductButton({
  orderId,
  orderNumber,
  products,
  catalogProducts,
  productImageById,
  disabled,
  disabledReason,
  onPatched,
}: {
  orderId: string;
  orderNumber?: number | string | null;
  products: SwapLine[];
  catalogProducts: CatalogProduct[];
  productImageById?: Record<string, string>;
  disabled?: boolean;
  disabledReason?: string;
  onPatched: (order: Record<string, unknown> & { id: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [lineIndex, setLineIndex] = useState(0);
  const [toProductId, setToProductId] = useState("");
  const [search, setSearch] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState<"preview" | "keep_price" | "pass_difference" | "pix" | null>(null);
  const [preview, setPreview] = useState<SwapPreview | null>(null);
  const [pixCode, setPixCode] = useState("");

  const selectedLine = products[lineIndex] || products[0];
  const filteredCatalog = useMemo(() => {
    const query = search.toLowerCase().trim();
    return catalogProducts
      .filter((product) => product.id && product.id !== selectedLine?.id)
      .filter((product) => {
        if (!query) return true;
        return `${product.name} ${product.id}`.toLowerCase().includes(query);
      })
      .slice(0, 40);
  }, [catalogProducts, search, selectedLine?.id]);

  const selectedCatalog = catalogProducts.find((product) => product.id === toProductId) || null;

  function reset() {
    setPreview(null);
    setPixCode("");
    setSearch("");
    setToProductId("");
    setLineIndex(0);
    setQuantity(products[0]?.quantity || 1);
  }

  async function loadPreview() {
    if (!selectedLine || !toProductId) {
      toast.error("Escolha o produto atual e o produto novo.");
      return;
    }
    setBusy("preview");
    try {
      const res = await fetch(`${BASE}/api/admin/orders/${orderId}/replace-product`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ lineIndex, toProductId, quantity, confirm: false }),
      });
      const data = await res.json() as SwapPreview & { message?: string };
      if (!res.ok) throw new Error(data.message || "Não foi possível calcular a troca.");
      setPreview(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível calcular a troca.");
    } finally {
      setBusy(null);
    }
  }

  async function confirm(mode: "keep_price" | "pass_difference") {
    setBusy(mode);
    try {
      const res = await fetch(`${BASE}/api/admin/orders/${orderId}/replace-product`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ lineIndex, toProductId, quantity, mode, confirm: true }),
      });
      const data = await res.json() as SwapPreview & {
        order?: Record<string, unknown> & { id: string };
        message?: string;
        needsDifferenceCharge?: boolean;
        difference?: number;
        walletCredited?: number;
      };
      if (!res.ok) throw new Error(data.message || "Não foi possível trocar o produto.");
      if (data.order) onPatched(data.order);
      if (mode === "keep_price") {
        toast.success("Produto trocado. O cliente continua com o mesmo valor pago.");
      } else if ((data.walletCredited || 0) > 0) {
        toast.success(`Produto trocado. Crédito de ${formatCurrency(data.walletCredited || 0)} na carteira do cliente.`);
      } else if (data.needsDifferenceCharge && Number(data.difference || 0) > 0.01) {
        toast.success("Produto trocado. Gere o PIX da diferença abaixo.");
        const pixRes = await fetch(`${BASE}/api/admin/orders/${orderId}/difference-charge`, {
          method: "POST",
          headers: adminHeaders(),
          body: JSON.stringify({ amount: data.difference, description: `Troca de produto pedido #${orderNumber || orderId}` }),
        });
        const pixData = await pixRes.json() as { pixCode?: string; message?: string };
        if (!pixRes.ok) throw new Error(pixData.message || "Troca salva, mas falhou ao gerar o PIX da diferença.");
        setPixCode(String(pixData.pixCode || "").trim());
        toast.success("PIX da diferença gerado.");
        return;
      } else {
        toast.success("Produto trocado.");
      }
      setOpen(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível trocar o produto.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5 text-fuchsia-700 border-fuchsia-200 hover:bg-fuchsia-50"
        disabled={disabled}
        title={disabled ? disabledReason : "Trocar um item do pedido por outro"}
        onClick={() => {
          reset();
          setQuantity(products[0]?.quantity || 1);
          setOpen(true);
        }}
      >
        <ArrowLeftRight className="w-3.5 h-3.5" />
        Trocar produto
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => { setOpen(false); reset(); }}>
          <div className="bg-white rounded-[28px] max-w-lg w-full shadow-xl max-h-[90vh] overflow-auto p-5 sm:p-6" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-lg font-bold text-neutral-900">Trocar produto</h2>
            <p className="text-sm text-neutral-500 mt-1">
              Pedido #{orderNumber || orderId}. Depois de escolher o item novo, o sistema mostra a diferença de valor, custo e lucro.
            </p>

            <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wide block mt-4 mb-1">Produto atual</label>
            <select
              className="w-full h-10 px-3 rounded-lg border border-border bg-white text-sm"
              value={String(lineIndex)}
              onChange={(event) => {
                const next = Number(event.target.value) || 0;
                setLineIndex(next);
                setQuantity(products[next]?.quantity || 1);
                setPreview(null);
              }}
            >
              {products.map((product, index) => (
                <option key={`${product.id}-${index}`} value={index}>
                  {product.quantity}× {product.name}
                  {product.swappedFrom?.name ? ` (já era ${product.swappedFrom.name})` : ""}
                </option>
              ))}
            </select>

            {selectedLine && (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <img
                  src={String(selectedLine.image || productImageById?.[selectedLine.id] || "")}
                  alt=""
                  className="h-11 w-11 rounded-lg object-cover border border-neutral-200 bg-neutral-50"
                  onError={(event) => { (event.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
                <div>
                  <p className="font-medium">{selectedLine.name}</p>
                  <p className="text-xs text-neutral-500">
                    {formatCurrency(selectedLine.price)} · custo {formatCurrency(Number(selectedLine.costPrice || 0))}
                  </p>
                </div>
              </div>
            )}

            <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wide block mt-4 mb-1">Quantidade</label>
            <input
              type="number"
              min={1}
              max={selectedLine?.quantity || 1}
              className="w-24 h-10 px-3 rounded-lg border border-border text-sm"
              value={quantity}
              onChange={(event) => {
                setQuantity(Math.max(1, Math.min(selectedLine?.quantity || 1, Number(event.target.value) || 1)));
                setPreview(null);
              }}
            />

            <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wide block mt-4 mb-1">Produto novo</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-neutral-400" />
              <input
                className="w-full h-10 pl-9 pr-3 rounded-lg border border-border text-sm"
                placeholder="Buscar no catálogo"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="mt-2 max-h-40 overflow-auto border border-neutral-100 rounded-xl divide-y">
              {filteredCatalog.map((product) => (
                <button
                  type="button"
                  key={product.id}
                  className={`w-full flex items-center gap-2 px-2 py-2 text-left text-sm hover:bg-neutral-50 ${toProductId === product.id ? "bg-fuchsia-50" : ""}`}
                  onClick={() => {
                    setToProductId(product.id);
                    setPreview(null);
                  }}
                >
                  {product.image ? (
                    <img src={product.image} alt="" className="h-8 w-8 rounded object-cover" />
                  ) : (
                    <span className="h-8 w-8 rounded bg-neutral-100 flex items-center justify-center text-[11px] text-neutral-400">
                      {product.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="flex-1 min-w-0 truncate">{product.name}</span>
                  <span className="text-xs text-neutral-500">{formatCurrency(Number(product.price || 0))}</span>
                </button>
              ))}
            </div>
            {selectedCatalog && (
              <p className="text-xs text-neutral-500 mt-2">
                Novo: {selectedCatalog.name} · vitrine {formatCurrency(Number(selectedCatalog.price || 0))} · custo {formatCurrency(Number(selectedCatalog.costPrice || 0))}
              </p>
            )}

            <Button type="button" className="mt-4 w-full" disabled={!!busy || !toProductId} onClick={() => void loadPreview()}>
              {busy === "preview" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Ver diferença"}
            </Button>

            {preview && (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-neutral-200 p-3 text-sm space-y-1">
                  <p className="text-xs uppercase tracking-wide text-neutral-400 font-semibold">Agora</p>
                  <p>{preview.from.quantity}× {preview.from.name} · {formatCurrency(preview.from.lineTotal)}</p>
                  <p className="text-xs text-neutral-500">Custo {formatCurrency(preview.from.lineCost)} · <Profit value={preview.from.lineProfit} /></p>
                </div>
                <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/50 p-3 text-sm space-y-2">
                  <p className="text-xs uppercase tracking-wide text-fuchsia-700 font-semibold">Manter o valor pago</p>
                  <p>{preview.keepPrice.to.quantity}× {preview.keepPrice.to.name} · cliente continua pagando {formatCurrency(preview.keepPrice.to.lineTotal)}</p>
                  <p className="text-xs">Custo novo {formatCurrency(preview.keepPrice.to.lineCost)} · <Profit value={preview.keepPrice.to.lineProfit} /></p>
                  <Button type="button" className="w-full" disabled={!!busy} onClick={() => void confirm("keep_price")}>
                    {busy === "keep_price" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Trocar e manter valor"}
                  </Button>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-sm space-y-2">
                  <p className="text-xs uppercase tracking-wide text-amber-800 font-semibold">Repassar a diferença</p>
                  <p>{preview.passDifference.to.quantity}× {preview.passDifference.to.name} · {formatCurrency(preview.passDifference.to.lineTotal)}</p>
                  <p className="text-xs">Custo novo {formatCurrency(preview.passDifference.to.lineCost)} · <Profit value={preview.passDifference.to.lineProfit} /></p>
                  <p className={`text-xs font-semibold ${preview.passDifference.difference > 0.01 ? "text-orange-700" : preview.passDifference.difference < -0.01 ? "text-green-700" : "text-neutral-500"}`}>
                    {preview.passDifference.difference > 0.01
                      ? `Cliente paga ${formatCurrency(preview.passDifference.difference)} a mais (PIX)`
                      : preview.passDifference.difference < -0.01
                        ? (preview.passDifference.guestNoWallet
                          ? `Pedido sem conta: diferença de ${formatCurrency(Math.abs(preview.passDifference.difference))} fica na loja`
                          : `Crédito de ${formatCurrency(preview.passDifference.walletCredit || Math.abs(preview.passDifference.difference))} na carteira`)
                        : "Sem diferença de total"}
                  </p>
                  <Button type="button" variant="outline" className="w-full" disabled={!!busy} onClick={() => void confirm("pass_difference")}>
                    {busy === "pass_difference" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Trocar e repassar valor"}
                  </Button>
                </div>
              </div>
            )}

            {pixCode && (
              <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm">
                <p className="font-semibold text-orange-900">PIX da diferença</p>
                <p className="font-mono text-xs break-all mt-2">{pixCode}</p>
                <Button type="button" size="sm" className="mt-2" onClick={() => navigator.clipboard.writeText(pixCode).then(() => toast.success("PIX copiado."))}>
                  Copiar PIX
                </Button>
              </div>
            )}

            <div className="flex justify-end mt-4">
              <Button type="button" variant="outline" onClick={() => { setOpen(false); reset(); }}>Fechar</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
