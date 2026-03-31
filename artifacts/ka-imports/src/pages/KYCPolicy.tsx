import { AppLayout } from "@/components/layout/AppLayout";
import { ShieldCheck, Camera, IdCard, FileText, CheckCircle2 } from "lucide-react";

export default function KYCPolicy() {
  return (
    <AppLayout minimal>
      <div className="max-w-2xl mx-auto px-4 py-12 w-full">
        <div className="space-y-8">

          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
              <ShieldCheck className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-3xl font-bold text-foreground">Verificação KYC</h1>
            <p className="text-muted-foreground mt-2 text-base">
              Know Your Customer — Política de Identificação do Cliente
            </p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <p className="text-sm font-semibold text-amber-800 mb-1">⚠️ Obrigatório para compras no cartão</p>
            <p className="text-sm text-amber-700">
              Todas as compras realizadas via cartão de crédito exigem a verificação de identidade (KYC).
              Seu pedido só será processado após a conclusão deste processo.
            </p>
          </div>

          <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
            <h2 className="font-bold text-lg text-foreground">Por que exigimos o KYC?</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              A verificação KYC é uma exigência legal e de segurança para proteger tanto o cliente quanto
              a KA Imports de fraudes, chargebacks e uso indevido de cartões de crédito. Ao confirmar
              sua identidade, garantimos que apenas o titular legítimo autorize a compra.
            </p>
          </div>

          <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
            <h2 className="font-bold text-lg text-foreground">O que você precisará enviar</h2>
            <div className="space-y-4">
              <div className="flex gap-4 items-start">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Camera className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-foreground">Selfie segurando o RG</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Uma foto sua segurando o documento de identidade (RG) de forma que seu rosto e o
                    documento estejam claramente visíveis.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 items-start">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <IdCard className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-foreground">Frente do RG</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Foto da frente do seu RG (Registro Geral) ou CNH, com todos os dados legíveis.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 items-start">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-foreground">Declaração de Titular</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Um documento declarando que você é o titular legítimo da compra. Seus dados (nome,
                    CPF e endereço) serão preenchidos automaticamente. Você deverá assinar digitalmente.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-6 space-y-3">
            <h2 className="font-bold text-lg text-foreground">Como funciona o processo</h2>
            <ol className="space-y-3">
              {[
                "Finalize seu pedido no checkout selecionando o pagamento via cartão",
                "Acesse o link de KYC enviado ou exibido ao final do pedido",
                "Envie sua selfie com RG e a foto da frente do RG",
                "Assine digitalmente a Declaração de Titular de Compra",
                "Aguarde a confirmação da equipe KA Imports via WhatsApp",
              ].map((step, i) => (
                <li key={i} className="flex gap-3 items-start text-sm text-muted-foreground">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white text-xs font-bold shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          <div className="bg-green-50 border border-green-200 rounded-2xl p-5">
            <div className="flex gap-3 items-start">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-green-800">Seus dados estão seguros</p>
                <p className="text-xs text-green-700 mt-1">
                  Todos os documentos são armazenados com segurança e utilizados exclusivamente para
                  fins de verificação de identidade, em conformidade com a LGPD (Lei Geral de
                  Proteção de Dados).
                </p>
              </div>
            </div>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Dúvidas? Entre em contato com nosso suporte via WhatsApp.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
