import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, ImagePlus, Loader2, Search, ShieldAlert, ShoppingBag } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type SupportOrderItem = {
  name: string;
  quantity: number;
};

type SupportOrder = {
  id: string;
  clientName: string;
  total: number;
  status: string;
  createdAt: string;
  products: SupportOrderItem[];
};

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function formatCpf(value: string): string {
  const digits = digitsOnly(value).slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function formatDateBR(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export default function Support() {
  const [cpf, setCpf] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [orders, setOrders] = useState<SupportOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) ?? null,
    [orders, selectedOrderId],
  );

  const handleLookup = async () => {
    const cpfDigits = digitsOnly(cpf);
    if (cpfDigits.length !== 11) {
      toast.error("Informe um CPF valido.");
      return;
    }

    setLookupLoading(true);
    try {
      const res = await fetch(`${BASE}/api/support/orders-by-cpf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpf: cpfDigits }),
      });
      const data = (await res.json()) as { orders?: SupportOrder[]; message?: string };
      if (!res.ok) {
        toast.error(data.message || "Nao foi possivel localizar pedidos.");
        return;
      }

      const found = data.orders || [];
      setOrders(found);
      setSelectedOrderId(found.length === 1 ? found[0].id : "");

      if (found.length === 0) {
        toast.info("Nao encontramos pedidos pagos para este CPF.");
      } else if (found.length === 1) {
        toast.success("Pedido localizado. Agora descreva o problema.");
      } else {
        toast.success("Escolha o pedido que voce quer reportar.");
      }
    } catch {
      toast.error("Erro de conexao ao buscar pedidos.");
    } finally {
      setLookupLoading(false);
    }
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Envie apenas imagem (JPG ou PNG).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Imagem muito grande. Maximo 5MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setImageData((e.target?.result as string) || null);
    };
    reader.readAsDataURL(file);
  };

  const submitTicket = async () => {
    const cpfDigits = digitsOnly(cpf);
    if (!selectedOrderId) {
      toast.error("Selecione o pedido correto.");
      return;
    }
    if (cpfDigits.length !== 11) {
      toast.error("CPF invalido.");
      return;
    }
    if (description.trim().length < 10) {
      toast.error("Descreva o problema com pelo menos 10 caracteres.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/support/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cpf: cpfDigits,
          orderId: selectedOrderId,
          description: description.trim(),
          imageData,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; ticketId?: string; message?: string };
      if (!res.ok || !data.ok) {
        toast.error(data.message || "Nao foi possivel abrir o chamado.");
        return;
      }
      setTicketId(data.ticketId || "");
      toast.success("Chamado aberto com sucesso.");
    } catch {
      toast.error("Erro de conexao ao enviar chamado.");
    } finally {
      setSubmitting(false);
    }
  };

  const restart = () => {
    setOrders([]);
    setSelectedOrderId("");
    setDescription("");
    setImageData(null);
    setTicketId(null);
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white py-8">
        <div className="mx-auto w-full max-w-3xl px-4">
          <div className="rounded-3xl border border-amber-200 bg-white shadow-sm p-6 sm:p-8">
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Suporte de Entrega</p>
              <h1 className="mt-2 text-2xl font-bold text-slate-900">Reportar problema no pedido</h1>
              <p className="mt-2 text-sm text-slate-600">
                Informe seu CPF para localizar seu pedido, escolha a compra correta e descreva o problema.
              </p>
            </div>

            {ticketId ? (
              <div className="rounded-2xl border border-green-200 bg-green-50 p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <p className="font-semibold text-green-800">Chamado enviado</p>
                    <p className="text-sm text-green-700">Protocolo: {ticketId}</p>
                  </div>
                </div>
                <p className="text-sm text-green-700">
                  Nosso time vai analisar e retornar pelo canal cadastrado no pedido.
                </p>
                <Button variant="outline" onClick={restart}>Abrir novo chamado</Button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
                  <p className="text-sm font-semibold text-slate-800">1. Identificacao</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={cpf}
                      onChange={(e) => setCpf(formatCpf(e.target.value))}
                      placeholder="CPF do titular do pedido"
                      className="h-11 flex-1 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-amber-500"
                    />
                    <Button onClick={handleLookup} disabled={lookupLoading} className="h-11 gap-2">
                      {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      Buscar pedidos
                    </Button>
                  </div>
                </div>

                {orders.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
                    <p className="text-sm font-semibold text-slate-800">2. Escolha a compra com problema</p>
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {orders.map((order) => (
                        <button
                          key={order.id}
                          type="button"
                          onClick={() => setSelectedOrderId(order.id)}
                          className={`w-full text-left rounded-xl border px-3 py-3 transition ${
                            selectedOrderId === order.id
                              ? "border-amber-500 bg-amber-50"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">Pedido {order.id.slice(0, 8)}</p>
                              <p className="text-xs text-slate-500">{formatDateBR(order.createdAt)} - {order.clientName}</p>
                            </div>
                            <span className="text-xs font-semibold rounded-full bg-slate-100 px-2 py-1 text-slate-700">
                              {formatCurrency(order.total)}
                            </span>
                          </div>
                          <div className="mt-2 text-xs text-slate-600 flex flex-wrap gap-2">
                            {order.products.slice(0, 3).map((product, idx) => (
                              <span key={`${order.id}-${idx}`} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
                                <ShoppingBag className="w-3 h-3" /> {product.quantity}x {product.name}
                              </span>
                            ))}
                            {order.products.length > 3 && <span>+{order.products.length - 3} itens</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedOrder && (
                  <div className="rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
                    <p className="text-sm font-semibold text-slate-800">3. Descreva o problema</p>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Explique o que aconteceu com sua entrega."
                      rows={5}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-500"
                    />

                    <label className="block">
                      <span className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                        <ImagePlus className="w-3.5 h-3.5" /> Anexar imagem (opcional)
                      </span>
                      <input type="file" accept="image/*" onChange={handleImageUpload} className="block w-full text-sm" />
                    </label>

                    {imageData && (
                      <div className="rounded-xl border border-slate-200 p-2">
                        <img src={imageData} alt="Comprovacao do problema" className="max-h-64 rounded-lg object-contain mx-auto" />
                      </div>
                    )}

                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-start gap-2">
                      <ShieldAlert className="w-4 h-4 mt-0.5" />
                      Cada chamado fica vinculado ao pedido selecionado, evitando confusao para clientes com varias compras.
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => setSelectedOrderId("")}>Trocar pedido</Button>
                      <Button onClick={submitTicket} disabled={submitting} className="gap-2">
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertCircle className="w-4 h-4" />}
                        Enviar chamado
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
