import { useState, useEffect, useRef, useCallback } from "react";
import { useRoute } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ShieldCheck, Camera, IdCard, FileText, Upload, CheckCircle2, Loader2, AlertCircle, X, MessageCircle, Trash2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DEFAULT_WHATSAPP = "5511917082244";

interface OrderInfo {
  id: string;
  clientName: string;
  clientDocument: string;
  address: string;
  paymentMethod: string;
  sellerWhatsapp: string | null;
}

interface KycStatus {
  status: string;
  submittedAt: string | null;
  hasSelfie: boolean;
  hasRgFront: boolean;
  declarationSigned: boolean;
}

type Step = "selfie" | "rg_front" | "declaration" | "review" | "done";

async function compressImage(dataUrl: string, maxSizeKB = 900): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let quality = 0.85;
      let w = img.width;
      let h = img.height;
      const maxDim = 1600;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.floor(w * ratio);
        h = Math.floor(h * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      let result = canvas.toDataURL("image/jpeg", quality);
      while (result.length > maxSizeKB * 1024 * 1.37 && quality > 0.3) {
        quality -= 0.1;
        result = canvas.toDataURL("image/jpeg", quality);
      }
      resolve(result);
    };
    img.src = dataUrl;
  });
}

// ---------------------------------------------------------------------------
// Signature canvas — draw with finger (touch) or mouse
// ---------------------------------------------------------------------------
function SignatureCanvas({ onChange, hasDrawn }: {
  onChange: (dataUrl: string | null) => void;
  hasDrawn: React.MutableRefObject<boolean>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 300;
    const h = canvas.offsetHeight || 180;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      const t = e.touches[0] || e.changedTouches[0];
      if (!t) return null;
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const start = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isDrawing.current = true;
    const pos = getPos(e);
    if (!pos) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const move = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    const pos = getPos(e);
    if (!pos) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    hasDrawn.current = true;
  };

  const stop = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    isDrawing.current = false;
    if (hasDrawn.current) {
      onChange(canvasRef.current!.toDataURL("image/png"));
    }
  };

  const clear = () => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    hasDrawn.current = false;
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="w-full rounded-xl border-2 border-dashed border-primary/40 bg-white cursor-crosshair block"
          style={{ height: "180px", touchAction: "none" }}
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={stop}
          onMouseLeave={stop}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={stop}
        />
        <div className="absolute top-2 right-2 pointer-events-none">
          <span className="text-xs text-muted-foreground/60 select-none">Assine aqui</span>
        </div>
      </div>
      <button
        type="button"
        onClick={clear}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
      >
        <Trash2 className="w-3 h-3" />
        Limpar e assinar novamente
      </button>
    </div>
  );
}

function PhotoUpload({
  label, hint, icon: Icon, value, onChange,
}: {
  label: string; hint: string; icon: React.ElementType; value: string | null;
  onChange: (v: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Apenas imagens são aceitas."); return; }
    if (file.size > 15 * 1024 * 1024) { toast.error("Arquivo muito grande. Máximo 15MB."); return; }
    setLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const raw = e.target?.result as string;
        const compressed = await compressImage(raw);
        onChange(compressed);
        setLoading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      toast.error("Erro ao processar imagem.");
      setLoading(false);
    }
  }, [onChange]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-5 h-5 text-primary" />
        <p className="font-semibold text-sm">{label}</p>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />

      {value ? (
        <div className="relative">
          <img src={value} alt={label} className="w-full max-h-64 object-contain rounded-2xl border-2 border-primary/30 bg-muted" />
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute top-2 right-2 bg-destructive text-white rounded-full p-1 shadow"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" className="gap-1.5 flex-1" onClick={() => inputRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" />Substituir foto
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="w-full h-36 rounded-2xl border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground"
        >
          {loading ? (
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          ) : (
            <>
              <Upload className="w-8 h-8" />
              <span className="text-sm font-medium">Toque para tirar foto ou carregar</span>
              <span className="text-xs">JPG, PNG — máx 15MB</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

export default function KYCSubmit() {
  const [, params] = useRoute("/kyc/:orderId");
  const orderId = params?.orderId ?? "";

  const [order, setOrder]   = useState<OrderInfo | null>(null);
  const [kyc, setKyc]       = useState<KycStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep]     = useState<Step>("selfie");
  const [submitting, setSubmitting] = useState(false);

  const [selfieUrl, setSelfieUrl]       = useState("");
  const [rgFrontUrl, setRgFrontUrl]     = useState("");
  const [signature, setSignature]       = useState<string | null>(null);
  const signatureHasDrawn               = useRef(false);

  useEffect(() => {
    if (!orderId) return;
    fetch(`${BASE}/api/kyc/${orderId}`)
      .then((r) => r.json())
      .then((data: { order?: OrderInfo; kyc?: KycStatus }) => {
        if (data.order) setOrder(data.order);
        if (data.kyc) setKyc(data.kyc);
        // "submitted" and "approved" go to done screen; "rejected" stays on form (re-send allowed)
        if (data.kyc?.status === "submitted" || data.kyc?.status === "approved") setStep("done");
        setLoading(false);
      })
      .catch(() => { toast.error("Erro ao carregar pedido."); setLoading(false); });
  }, [orderId]);

  const handleSubmit = async () => {
    if (!selfieUrl) { toast.error("Envie a selfie com o RG."); setStep("selfie"); return; }
    if (!rgFrontUrl) { toast.error("Envie a foto da frente do RG."); setStep("rg_front"); return; }
    if (!signature || !signatureHasDrawn.current) { toast.error("Assine a declaração antes de continuar."); setStep("declaration"); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/kyc/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selfieUrl, rgFrontUrl, declarationSignature: signature }),
      });
      const data = await res.json() as { ok?: boolean; message?: string };
      if (!res.ok) { toast.error(data.message || "Erro ao enviar."); return; }
      setStep("done");
      toast.success("KYC enviado com sucesso!");
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

  if (loading) {
    return (
      <AppLayout minimal>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!order) {
    return (
      <AppLayout minimal>
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center space-y-3">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
            <h2 className="text-xl font-bold">Pedido não encontrado</h2>
            <p className="text-muted-foreground text-sm">Verifique o link e tente novamente.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  const steps: { id: Step; label: string; icon: React.ElementType }[] = [
    { id: "selfie", label: "Selfie + RG", icon: Camera },
    { id: "rg_front", label: "Frente do RG", icon: IdCard },
    { id: "declaration", label: "Declaração", icon: FileText },
    { id: "review", label: "Revisão", icon: CheckCircle2 },
  ];
  const stepIndex = steps.findIndex((s) => s.id === step);

  return (
    <AppLayout minimal>
      <div className="max-w-lg mx-auto px-4 py-10 w-full space-y-6">

        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-3">
            <ShieldCheck className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Verificação KYC</h1>
          <p className="text-muted-foreground text-sm mt-1">Pedido #{order.id} — {order.clientName}</p>
        </div>

        {step === "done" ? (
          <div className="text-center space-y-5 py-6">
            {kyc?.status === "approved" ? (
              <>
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100">
                  <CheckCircle2 className="w-10 h-10 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-green-700">KYC Aprovado!</h2>
                <p className="text-muted-foreground text-sm">
                  Sua identidade já foi verificada. Você não precisa enviar documentos novamente.
                </p>
              </>
            ) : (
              <>
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100">
                  <CheckCircle2 className="w-10 h-10 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-green-700">Obrigado!</h2>
                <p className="text-foreground text-base font-medium">
                  Seus documentos foram enviados com sucesso.
                </p>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  A vendedora vai entrar em contato pelo WhatsApp para concluir a sua compra. Fique de olho nas mensagens!
                </p>
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800 text-left space-y-1">
                  <p>✅ Selfie com RG enviada</p>
                  <p>✅ Frente do RG enviada</p>
                  <p>✅ Declaração assinada</p>
                </div>
              </>
            )}
            <a
              href={`https://wa.me/${order.sellerWhatsapp?.replace(/\D/g, "") || DEFAULT_WHATSAPP}?text=${encodeURIComponent(kyc?.status === "approved" ? `Olá! Meu KYC já foi aprovado (pedido #${order.id}). Como prosseguir?` : `Olá! Acabei de enviar meus documentos KYC para o pedido #${order.id}. Aguardo seu contato para concluir a compra!`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3.5 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold text-sm transition-colors shadow-sm"
            >
              <MessageCircle className="w-5 h-5" />
              Falar com a Vendedora no WhatsApp
            </a>
          </div>
        ) : (
          <>
            {/* Rejection notice — show when the previous KYC was rejected, allow re-send */}
            {kyc?.status === "rejected" && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-500" />
                <div>
                  <p className="font-semibold">Seu KYC anterior foi recusado.</p>
                  <p className="text-red-700 mt-0.5">Por favor, envie novos documentos com fotos nítidas e a declaração assinada corretamente.</p>
                </div>
              </div>
            )}

            {/* Step indicator */}
            <div className="flex items-center gap-1">
              {steps.map((s, i) => (
                <div key={s.id} className="flex items-center flex-1">
                  <button
                    type="button"
                    onClick={() => { if (i <= stepIndex) setStep(s.id); }}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors w-full justify-center ${
                      step === s.id
                        ? "bg-primary text-white"
                        : i < stepIndex
                        ? "bg-primary/10 text-primary cursor-pointer hover:bg-primary/20"
                        : "bg-muted text-muted-foreground cursor-default"
                    }`}
                  >
                    <s.icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden sm:inline truncate">{s.label}</span>
                  </button>
                  {i < steps.length - 1 && <div className="h-px w-2 bg-border shrink-0" />}
                </div>
              ))}
            </div>

            <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
              {step === "selfie" && (
                <>
                  <PhotoUpload
                    label="Selfie segurando o RG"
                    hint="Tire uma foto de você segurando seu RG com o rosto e o documento claramente visíveis."
                    icon={Camera}
                    value={selfieUrl}
                    onChange={setSelfieUrl}
                  />
                  <Button
                    className="w-full"
                    disabled={!selfieUrl}
                    onClick={() => setStep("rg_front")}
                  >
                    Próximo →
                  </Button>
                </>
              )}

              {step === "rg_front" && (
                <>
                  <PhotoUpload
                    label="Frente do RG"
                    hint="Tire uma foto clara da frente do seu RG ou CNH com todos os dados legíveis."
                    icon={IdCard}
                    value={rgFrontUrl}
                    onChange={setRgFrontUrl}
                  />
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => setStep("selfie")}>← Voltar</Button>
                    <Button className="flex-1" disabled={!rgFrontUrl} onClick={() => setStep("declaration")}>Próximo →</Button>
                  </div>
                </>
              )}

              {step === "declaration" && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" />
                    <p className="font-semibold text-sm">Declaração de Titular de Compra</p>
                  </div>

                  <div className="bg-muted/50 border border-border rounded-xl p-4 text-sm text-foreground leading-relaxed space-y-3 font-serif">
                    <p className="text-center font-bold text-base">DECLARAÇÃO DE TITULAR DE COMPRA</p>
                    <p>
                      Eu, <strong>{order.clientName}</strong>, portador(a) do CPF nº{" "}
                      <strong>{order.clientDocument}</strong>,
                      {order.address ? (
                        <> residente e domiciliado(a) em <strong>{order.address}</strong>,</>
                      ) : null}{" "}
                      declaro, para os devidos fins, que sou o(a) legítimo(a) titular da
                      compra realizada.
                    </p>
                    <p>
                      Declaro ainda que os dados informados são verdadeiros, que a compra foi
                      realizada por minha livre e espontânea vontade e que estou ciente das
                      condições de venda.
                    </p>
                    <div className="pt-2 border-t border-border">
                      <p className="text-xs text-muted-foreground mb-3">{today}</p>
                      <p className="text-xs font-semibold text-foreground mb-2">Assinatura do titular:</p>
                      <div className="bg-white rounded-xl overflow-hidden">
                        <SignatureCanvas
                          onChange={(v) => setSignature(v)}
                          hasDrawn={signatureHasDrawn}
                        />
                      </div>
                      {!signatureHasDrawn.current && !signature && (
                        <p className="text-xs text-amber-600 mt-2 text-center">
                          ✍️ Assine dentro da área acima com o dedo ou mouse
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => setStep("rg_front")}>← Voltar</Button>
                    <Button
                      className="flex-1"
                      disabled={!signature || !signatureHasDrawn.current}
                      onClick={() => setStep("review")}
                    >
                      Próximo →
                    </Button>
                  </div>
                </div>
              )}

              {step === "review" && (
                <div className="space-y-4">
                  <p className="font-semibold text-sm">Revise seus documentos</p>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-xl">
                      <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">Selfie com RG</p>
                        <p className="text-xs text-muted-foreground">Foto enviada</p>
                      </div>
                      <button type="button" className="text-xs text-primary underline" onClick={() => setStep("selfie")}>Alterar</button>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-xl">
                      <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">Frente do RG</p>
                        <p className="text-xs text-muted-foreground">Foto enviada</p>
                      </div>
                      <button type="button" className="text-xs text-primary underline" onClick={() => setStep("rg_front")}>Alterar</button>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-xl">
                      <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium mb-1.5">Declaração assinada</p>
                        {signature && signature.startsWith("data:image") ? (
                          <img
                            src={signature}
                            alt="Assinatura"
                            className="max-h-16 w-auto border border-border rounded-lg bg-white p-1"
                          />
                        ) : (
                          <p className="text-xs text-muted-foreground italic">Assinatura registrada</p>
                        )}
                      </div>
                      <button type="button" className="text-xs text-primary underline shrink-0" onClick={() => setStep("declaration")}>Alterar</button>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => setStep("declaration")}>← Voltar</Button>
                    <Button
                      className="flex-1 gap-2"
                      onClick={handleSubmit}
                      disabled={submitting}
                    >
                      {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />Enviando...</> : "Enviar KYC"}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* WhatsApp support link at the bottom of the form */}
            <div className="text-center pt-2">
              <a
                href={`https://wa.me/${order.sellerWhatsapp?.replace(/\D/g, "") || DEFAULT_WHATSAPP}?text=${encodeURIComponent(`Olá! Preciso de ajuda com o KYC do pedido #${order.id}.`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-green-600 transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                Precisa de ajuda? Fale com o suporte
              </a>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
