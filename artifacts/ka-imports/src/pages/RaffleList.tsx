import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { Loader2, Ticket } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Raffle = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  totalNumbers: number;
  pricePerNumber: string;
  reservationHours: number;
  status: string;
};

export default function RaffleList() {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${BASE}/api/raffles`)
      .then((r) => r.json())
      .then((data) => setRaffles(Array.isArray(data) ? data : []))
      .catch(() => setRaffles([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Ticket className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Rifas</h1>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : raffles.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Ticket className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="font-medium">Nenhuma rifa disponível no momento.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {raffles.map((raffle) => (
              <Link key={raffle.id} href={`/rifas/${raffle.id}`}>
                <div className="border border-border rounded-2xl overflow-hidden hover:shadow-md transition-shadow cursor-pointer bg-card">
                  {raffle.imageUrl && (
                    <img
                      src={raffle.imageUrl}
                      alt={raffle.title}
                      className="w-full h-48 object-cover"
                    />
                  )}
                  <div className="p-4">
                    <h2 className="font-bold text-lg text-foreground">{raffle.title}</h2>
                    {raffle.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{raffle.description}</p>
                    )}
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-sm text-muted-foreground">
                        {raffle.totalNumbers} números · {formatCurrency(Number(raffle.pricePerNumber))} cada
                      </span>
                      <Button size="sm" variant="default">Ver rifa</Button>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8 text-center">
          <Link href="/rifas/consulta">
            <Button variant="outline" className="w-full max-w-xs">
              Consultar minha reserva
            </Button>
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}
