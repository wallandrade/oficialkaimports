import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getActiveWhatsApp } from "@/lib/utils";

function openWhatsApp(text: string) {
  const number = getActiveWhatsApp();
  const url = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function Footer() {
  return (
    <footer className="bg-white border-t border-border mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="font-bold text-xl text-primary">KA IMPORTS</span>
            </div>
            <p className="text-muted-foreground text-sm">
              A sua loja de importados com os melhores preços e garantia de qualidade.
            </p>
          </div>

          <div>
            <h3 className="font-bold text-foreground mb-4">Links Úteis</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="/" className="hover:text-primary transition-colors">Produtos</a></li>
              <li>
                <button
                  type="button"
                  onClick={() => openWhatsApp("Olá, gostaria de suporte.")}
                  className="hover:text-primary transition-colors"
                >
                  Suporte
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-bold text-foreground mb-4">Atendimento</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Precisa de ajuda? Fale com nosso suporte diretamente pelo WhatsApp.
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full border-green-500 text-green-600 hover:bg-green-50 hover:border-green-600"
              onClick={() => openWhatsApp("Olá, gostaria de tirar uma dúvida.")}
            >
              <MessageCircle className="w-5 h-5 mr-2" />
              Suporte via WhatsApp
            </Button>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-border text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} KA Imports - Todos os direitos reservados</p>
        </div>
      </div>
    </footer>
  );
}
