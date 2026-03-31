import { useState, useCallback, useEffect, useRef, FormEvent } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PaymentPasswordGate } from "@/components/SitePasswordGate";
import { motion, AnimatePresence } from "framer-motion";
import {
  QrCode, Loader2, CheckCircle2, Copy, MapPin, User, DollarSign,
  ArrowLeft, CheckCircle, AlertCircle, Package, MessageCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatCurrency, fetchAndCacheSellerWhatsApp, getActiveWhatsApp } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PIX_POLL_INTERVAL_MS = 2000;

function formatCPF(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function formatCEP(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}

function parseAmountReais(raw: string): number {
  return parseFloat(raw.replace(",", ".")) || 0;
}

interface PixResult {
  id: string;
  transactionId: string;
  pixCode: string;
  pixBase64: string;
  pixImage: string;
  expiresAt: string;
  status: string;
}

interface FormState {
  name: string;
  email: string;
  phone: string;
  document: string;
  amountRaw: string;
  description: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
}

const EMPTY_FORM: FormState = {
  name: "", email: "", phone: "", document: "",
  amountRaw: "", description: "",
  cep: "", street: "", number: "", complement: "",
  neighborhood: "", city: "", state: "",
};

const UF_LIST = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function PaymentLink() {
  return (
    <PaymentPasswordGate>
      <PaymentLinkInner />
    </PaymentPasswordGate>
  );
}

function PaymentLinkInner() {
  const sellerCode = new URLSearchParams(window.location.search).get("seller") || undefined;

  // -------------------------------------------------------------------------
  // Seller context — must happen before any WhatsApp link is resolved.
  // Set synchronously during render so sessionStorage is ready before Footer
  // mounts. Then fetch the real WhatsApp number from the API asynchronously.
  // -------------------------------------------------------------------------
  const sellerContextSet = useRef(false);
  if (!sellerContextSet.current) {
    sellerContextSet.current = true;
    if (sellerCode) {
      // Always overwrite to avoid stale data from a previous seller session
      sessionStorage.removeItem("sellerWhatsapp");
      sessionStorage.setItem("sellerCode", sellerCode);
      localStorage.setItem("sellerCode", sellerCode);
    } else {
      // No seller in URL — clear any previous context so default is used
      sessionStorage.removeItem("sellerWhatsapp");
      sessionStorage.removeItem("sellerCode");
    }
  }

  useEffect(() => {
    if (sellerCode) {
      fetchAndCacheSellerWhatsApp(sellerCode);
    }
  }, [sellerCode]);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [cepLoading, setCepLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pix, setPix] = useState<PixResult | null>(null);
  const [paid, setPaid] = useState(false);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const pixRef   = useRef<PixResult | null>(null);

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // -------------------------------------------------------------------------
  // CEP lookup
  // -------------------------------------------------------------------------
  const handleCEP = useCallback(async (raw: string) => {
    const formatted = formatCEP(raw);
    set("cep", formatted);
    const digits = formatted.replace(/\D/g, "");
    if (digits.length === 8) {
      setCepLoading(true);
      try {
        const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
        const d = await r.json() as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
        if (!d.erro) {
          setForm((f) => ({
            ...f, cep: formatted,
            street: d.logradouro || "",
            neighborhood: d.bairro || "",
            city: d.localidade || "",
            state: d.uf || "",
          }));
        } else {
          toast.error("CEP não encontrado.");
        }
      } catch {
        toast.error("Erro ao consultar CEP.");
      } finally {
        setCepLoading(false);
      }
    }
  }, []);

  // -------------------------------------------------------------------------
  // Countdown timer
  // -------------------------------------------------------------------------
  const startTimer = useCallback((expiresAt: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    const update = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setTimeLeft(Math.max(0, Math.floor(ms / 1000)));
    };
    update();
    timerRef.current = setInterval(update, 1000);
  }, []);

  // -------------------------------------------------------------------------
  // Status polling — queries our own backend (which is updated by webhook)
  // -------------------------------------------------------------------------
  const startPolling = useCallback((transactionId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/api/custom-charges/status/${transactionId}`);
        if (!r.ok) return;
        const d = await r.json() as { status: string };
        if (d.status === "OK" || d.status === "PAID") {
          clearInterval(pollRef.current!);
          clearInterval(timerRef.current!);
          setPaid(true);
          toast.success("Pagamento confirmado!");
        }
      } catch {
        // ignore transient errors, keep polling
      }
    }, PIX_POLL_INTERVAL_MS);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (pollRef.current)  clearInterval(pollRef.current);
  }, []);

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!form.name.trim() || !form.email.trim() || !form.phone.trim() || !form.document.trim()) {
      toast.error("Preencha todos os campos obrigatórios.");
      return;
    }

    if (form.document.replace(/\D/g, "").length !== 11) {
      toast.error("CPF inválido. Informe os 11 dígitos no formato 000.000.000-00.");
      return;
    }

    if (!form.description.trim()) {
      toast.error("Descreva seu pedido antes de continuar.");
      return;
    }

    const amountVal = parseAmountReais(form.amountRaw);
    if (!amountVal || amountVal < 1) {
      toast.error("Informe um valor mínimo de R$1,00.");
      return;
    }

    if (amountVal > 10000) {
      toast.error("Valor máximo é R$10.000.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/custom-charges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: {
            name: form.name.trim(),
            email: form.email.trim(),
            phone: form.phone,
            document: form.document,
          },
          address: form.cep ? {
            cep: form.cep,
            street: form.street,
            number: form.number,
            complement: form.complement,
            neighborhood: form.neighborhood,
            city: form.city,
            state: form.state,
          } : undefined,
          amount: amountVal,
          description: form.description.trim(),
          sellerCode: sellerCode || undefined,
        }),
      });

      const data = await res.json() as PixResult & { message?: string; error?: string };

      if (!res.ok) {
        toast.error(data.message || "Erro ao gerar PIX.");
        return;
      }

      pixRef.current = data;
      setPix(data);
      startTimer(data.expiresAt);
      startPolling(data.transactionId);
      toast.success("PIX gerado! Aguardando pagamento...");
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyPix = () => {
    if (!pix?.pixCode) return;
    navigator.clipboard.writeText(pix.pixCode);
    setCopied(true);
    toast.success("Código PIX copiado!");
    setTimeout(() => setCopied(false), 2500);
  };

  const reset = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (pollRef.current)  clearInterval(pollRef.current);
    setPix(null);
    setPaid(false);
    setForm(EMPTY_FORM);
  };

  const amountVal = parseAmountReais(form.amountRaw);
  const minutes   = Math.floor(timeLeft / 60);
  const seconds   = timeLeft % 60;
  const expired   = timeLeft === 0 && !!pix && !paid;
  const pixImg    = pix?.pixBase64
    ? (pix.pixBase64.startsWith("data:") ? pix.pixBase64 : `data:image/png;base64,${pix.pixBase64}`)
    : pix?.pixImage || "";

  // =========================================================================
  // PIX PAID screen
  // =========================================================================
  if (paid) {
    const waMsg =
      `✅ *Pagamento PIX Confirmado — KA Imports*\n\n` +
      `*Nome:* ${form.name}\n` +
      `*CPF:* ${form.document}\n` +
      `*Telefone:* ${form.phone}\n` +
      `*E-mail:* ${form.email}\n\n` +
      `*Pedido:* ${form.description || "—"}\n` +
      `*Valor Pago:* ${formatCurrency(amountVal)}\n\n` +
      `Pagamento PIX confirmado! Aguardo o retorno da equipe.`;

    const openWhatsApp = () => {
      window.open(`https://wa.me/${getActiveWhatsApp()}?text=${encodeURIComponent(waMsg)}`, "_blank");
    };

    return (
      <AppLayout minimal>
        <div className="max-w-md mx-auto px-4 py-16 w-full text-center">
          <div className="space-y-6 animate-in fade-in zoom-in duration-500">
            <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-green-100 mx-auto">
              <CheckCircle className="w-12 h-12 text-green-600" />
            </div>
            <h2 className="text-3xl font-bold text-green-700">Pagamento Confirmado!</h2>
            <p className="text-muted-foreground">
              Olá <strong>{form.name.split(" ")[0]}</strong>, recebemos seu PIX de{" "}
              <strong>{formatCurrency(amountVal)}</strong>.<br />Em breve entraremos em contato.
            </p>
            {form.description && (
              <p className="text-sm text-muted-foreground italic">"{form.description}"</p>
            )}
            <Button
              onClick={openWhatsApp}
              className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white"
            >
              <MessageCircle className="w-4 h-4" />
              Falar com a equipe pelo WhatsApp
            </Button>
            <Button onClick={reset} variant="outline" className="w-full">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Nova cobrança
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  // =========================================================================
  // PIX QR CODE screen
  // =========================================================================
  if (pix) {
    return (
      <AppLayout minimal>
        <div className="max-w-lg mx-auto px-4 py-10 w-full">
          <div className="space-y-6 animate-in fade-in zoom-in duration-300">

            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                <QrCode className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-2xl font-bold">PIX Gerado!</h2>
              <p className="text-muted-foreground mt-1">
                Olá <strong>{form.name.split(" ")[0]}</strong>, escaneie ou copie o código abaixo.
              </p>
            </div>

            {/* Timer */}
            <div className={`text-center rounded-2xl p-4 font-bold text-lg ${
              expired
                ? "bg-red-50 text-red-600 border border-red-200"
                : "bg-amber-50 text-amber-700 border border-amber-200"
            }`}>
              {expired
                ? "⚠️ Tempo expirado — gere um novo PIX"
                : `⏱ ${minutes}:${String(seconds).padStart(2, "0")} restantes`}
            </div>

            {/* Polling indicator */}
            {!expired && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                Aguardando confirmação do pagamento...
              </div>
            )}

            {/* Value */}
            <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5 text-center">
              <p className="text-sm text-muted-foreground mb-1">Valor a pagar</p>
              <p className="text-4xl font-bold text-primary">{formatCurrency(amountVal)}</p>
              {form.description && <p className="text-sm text-muted-foreground mt-2 italic">"{form.description}"</p>}
            </div>

            {/* QR Code */}
            {!expired && (
              pixImg ? (
                <div className="flex justify-center">
                  <img
                    src={pixImg}
                    alt="QR Code PIX"
                    className="w-60 h-60 border-4 border-white shadow-xl rounded-2xl"
                  />
                </div>
              ) : null
            )}

            {/* Copy & paste code */}
            {!expired && (
              pix.pixCode ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Copia e Cola</p>
                  <div className="bg-muted/60 rounded-xl p-3 text-xs font-mono break-all text-foreground/80 max-h-28 overflow-y-auto">
                    {pix.pixCode}
                  </div>
                  <Button onClick={copyPix} className="w-full gap-2" variant={copied ? "default" : "outline"}>
                    {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? "Copiado!" : "Copiar Código PIX"}
                  </Button>
                </div>
              ) : !pixImg ? (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-center space-y-1">
                  <p className="text-sm font-semibold text-amber-800">Código PIX indisponível</p>
                  <p className="text-xs text-amber-700">Clique em "Cancelar e voltar" e tente gerar novamente.</p>
                </div>
              ) : null
            )}

            <Button variant="outline" className="w-full" onClick={reset}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              {expired ? "Gerar novo PIX" : "Cancelar e voltar"}
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  // =========================================================================
  // FORM screen
  // =========================================================================
  return (
    <AppLayout minimal>
      <div className="max-w-2xl mx-auto px-4 py-10 w-full">
        <div className="animate-in fade-in slide-in-from-bottom-3 duration-500">

          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-3">
              <QrCode className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-3xl font-bold">Link de Pagamento</h1>
            <p className="text-muted-foreground mt-1">Preencha seus dados e gere um PIX personalizado.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">

            {/* Personal data */}
            <section className="bg-card border border-border/50 rounded-2xl p-6 space-y-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <User className="w-4 h-4 text-primary" />
                <h2 className="font-bold">Dados Pessoais</h2>
              </div>

              <Field label="Nome Completo *">
                <input
                  required
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Seu nome completo"
                  className="input-field"
                />
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="E-mail *">
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder="email@exemplo.com"
                    className="input-field"
                  />
                </Field>
                <Field label="Telefone *">
                  <input
                    required
                    value={form.phone}
                    onChange={(e) => set("phone", formatPhone(e.target.value))}
                    placeholder="(11) 99999-9999"
                    className="input-field"
                    inputMode="tel"
                  />
                </Field>
              </div>

              <Field label="CPF *">
                <input
                  required
                  value={form.document}
                  onChange={(e) => set("document", formatCPF(e.target.value))}
                  placeholder="000.000.000-00"
                  className="input-field"
                  inputMode="numeric"
                />
              </Field>
            </section>

            {/* Amount */}
            <section className="bg-card border border-border/50 rounded-2xl p-6 space-y-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-primary" />
                <h2 className="font-bold">Valor da Cobrança</h2>
              </div>

              <Field label="Valor *">
                <div className="flex rounded-xl border-2 border-border bg-white focus-within:border-primary overflow-hidden transition-colors">
                  <span className="flex items-center px-4 bg-muted/40 border-r border-border font-bold text-muted-foreground text-base select-none">
                    R$
                  </span>
                  <input
                    required
                    value={form.amountRaw}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9,\.]/g, "");
                      set("amountRaw", raw);
                    }}
                    placeholder="0,00"
                    className="flex-1 h-11 px-4 outline-none text-lg font-bold bg-transparent"
                    inputMode="decimal"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Digite o valor em reais. Ex: <strong>850</strong> para R$&nbsp;850,00 — <strong>850,50</strong> para R$&nbsp;850,50
                </p>
              </Field>
            </section>

            {/* Order description — required */}
            <section className="bg-card border border-primary/30 rounded-2xl p-6 space-y-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Package className="w-4 h-4 text-primary" />
                <h2 className="font-bold">Seu Pedido <span className="text-red-500">*</span></h2>
              </div>
              <textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Descreva aqui o seu pedido, frete, e outras observações do pedido"
                rows={4}
                className="w-full px-4 py-3 rounded-xl border-2 border-border bg-white focus:border-primary outline-none text-sm resize-none transition-colors"
              />
              <p className="text-xs text-muted-foreground">Campo obrigatório — informe o que está sendo comprado e qualquer observação relevante.</p>
            </section>

            {/* Address */}
            <section className="bg-card border border-border/50 rounded-2xl p-6 space-y-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <MapPin className="w-4 h-4 text-primary" />
                <h2 className="font-bold">Endereço de Entrega <span className="text-xs font-normal text-muted-foreground">(opcional)</span></h2>
              </div>

              <Field label="CEP">
                <div className="relative">
                  <input
                    value={form.cep}
                    onChange={(e) => handleCEP(e.target.value)}
                    placeholder="00000-000"
                    className="input-field pr-10"
                    inputMode="numeric"
                  />
                  {cepLoading && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />
                  )}
                </div>
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <Field label="Rua">
                    <input value={form.street} onChange={(e) => set("street", e.target.value)} placeholder="Rua das Flores" className="input-field" />
                  </Field>
                </div>
                <Field label="Número">
                  <input value={form.number} onChange={(e) => set("number", e.target.value)} placeholder="123" className="input-field" />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Complemento">
                  <input value={form.complement} onChange={(e) => set("complement", e.target.value)} placeholder="Apto, Bloco..." className="input-field" />
                </Field>
                <Field label="Bairro">
                  <input value={form.neighborhood} onChange={(e) => set("neighborhood", e.target.value)} placeholder="Centro" className="input-field" />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Cidade">
                  <input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="São Paulo" className="input-field" />
                </Field>
                <Field label="Estado">
                  <select value={form.state} onChange={(e) => set("state", e.target.value)} className="input-field">
                    <option value="">UF</option>
                    {UF_LIST.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                  </select>
                </Field>
              </div>
            </section>

            {/* Value preview */}
            <AnimatePresence>
              {form.amountRaw && Number(form.amountRaw) > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="bg-primary/5 border border-primary/20 rounded-2xl p-4 text-center"
                >
                  <p className="text-muted-foreground text-sm">Valor a cobrar</p>
                  <p className="text-3xl font-bold text-primary mt-1">{formatCurrency(amountVal)}</p>
                  {form.description && <p className="text-sm text-muted-foreground mt-1 italic">"{form.description}"</p>}
                </motion.div>
              )}
            </AnimatePresence>

            <Button type="submit" size="lg" className="w-full text-base gap-2" disabled={submitting}>
              {submitting
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Gerando PIX...</>
                : <><QrCode className="w-5 h-5" /> Gerar PIX</>
              }
            </Button>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium ml-1">{label}</label>
      {children}
    </div>
  );
}
