import { motion, AnimatePresence } from "framer-motion";
import { X, Plus, Minus, ShoppingBag, ArrowRight } from "lucide-react";
import { useCart } from "@/store/use-cart";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { Link, useLocation } from "wouter";

export function CartDrawer() {
  const { items, isOpen, setIsOpen, updateQuantity, removeItem, getSubtotal } = useCart();
  const [, setLocation] = useLocation();

  const handleCheckout = () => {
    setIsOpen(false);
    setLocation("/checkout");
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col border-l border-border"
          >
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h2 className="text-2xl font-display font-bold flex items-center gap-2">
                <ShoppingBag className="w-6 h-6 text-primary" />
                Seu Carrinho
              </h2>
              <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="rounded-full">
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
                  <div className="w-48 h-48 relative">
                    <div className="absolute inset-0 bg-primary/5 rounded-full blur-2xl"></div>
                    <img 
                      src={`${import.meta.env.BASE_URL}images/empty-cart.png`} 
                      alt="Carrinho vazio" 
                      className="w-full h-full object-contain relative z-10"
                      onError={(e) => {
                        // fallback if image generation failed
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.parentElement!.innerHTML = '<div class="w-full h-full flex items-center justify-center text-primary/20"><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg></div>';
                      }}
                    />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-foreground">Seu carrinho está vazio</h3>
                    <p className="text-muted-foreground mt-2">Explore nossos produtos e adicione itens ao carrinho.</p>
                  </div>
                  <Button onClick={() => setIsOpen(false)} className="mt-4">
                    Continuar Comprando
                  </Button>
                </div>
              ) : (
                <div className="space-y-6">
                  {items.filter((item) => !(item as { isBump?: boolean }).isBump).map((item) => {
                    const bumpItem = items.find(
                      (i) => !!(i as { isBump?: boolean }).isBump &&
                        (i as { bumpForProductId?: string }).bumpForProductId === item.id
                    ) as ({ quantity: number; price: number } | undefined);
                    const totalQty = bumpItem ? item.quantity + bumpItem.quantity : item.quantity;
                    return (
                    <motion.div 
                      layout
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      key={item.id} 
                      className="flex gap-4 p-3 rounded-2xl border bg-gray-50 border-border/50"
                    >
                      <div className="w-20 h-20 bg-white rounded-xl overflow-hidden shrink-0 shadow-sm">
                        <img 
                          src={item.image || "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=200&q=80"} 
                          alt={item.name} 
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 flex flex-col py-1">
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex-1">
                            <h4 className="font-semibold text-foreground leading-tight line-clamp-2">{item.name}</h4>
                            {bumpItem && (
                              <span className="inline-flex items-center gap-1 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold mt-0.5">
                                🏷️ Desconto aplicado no checkout
                              </span>
                            )}
                          </div>
                          <button 
                            onClick={() => removeItem(item.id)}
                            className="text-muted-foreground hover:text-destructive p-1 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="mt-auto flex items-end justify-between">
                          <span className="font-bold text-primary">{formatCurrency(item.price)}</span>
                          <div className="flex items-center gap-3 bg-white border border-border rounded-lg p-1 shadow-sm">
                            <button 
                              onClick={() => updateQuantity(item.id, item.quantity - 1)}
                              className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-muted text-foreground transition-colors"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="text-sm font-medium w-4 text-center">{totalQty}</span>
                            <button 
                              onClick={() => updateQuantity(item.id, item.quantity + 1)}
                              className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-muted text-foreground transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                    );
                  })}
                </div>
              )}
            </div>

            {items.length > 0 && (
              <div className="p-6 bg-gray-50 border-t border-border">
                <div className="flex items-center justify-between mb-6 text-lg">
                  <span className="font-medium text-muted-foreground">Subtotal</span>
                  <span className="font-display font-bold text-2xl text-foreground">
                    {formatCurrency(getSubtotal())}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  <Button size="lg" className="w-full text-lg shadow-xl shadow-primary/20" onClick={handleCheckout}>
                    Finalizar Pedido
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                  <Button size="lg" variant="outline" className="w-full text-base" onClick={() => setIsOpen(false)}>
                    Continuar comprando
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
