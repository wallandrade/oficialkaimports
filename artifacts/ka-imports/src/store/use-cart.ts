import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CartItem, Product } from "@workspace/api-client-react";

type CartItemExtended = CartItem & {
  image?: string;
  regularPrice: number;
  isBump?: boolean;
  bumpForProductId?: string;
  bumpOfferId?: string;
};

interface CartState {
  items: CartItemExtended[];
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  addItem: (product: Product) => void;
  addBumpItem: (
    bumpOfferId: string,
    product: { id: string; name: string; price: number; image?: string },
    bumpedPrice: number,
    bumpedQty: number
  ) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  clearCart: () => void;
  getSubtotal: () => number;
  getCardSubtotal: () => number;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,

      setIsOpen: (isOpen) => set({ isOpen }),

      addBumpItem: (bumpOfferId, product, bumpedPrice, bumpedQty) => {
        const cartId = `bump_${bumpOfferId}`;
        set((state) => {
          const exists = state.items.some((i) => i.id === cartId);
          if (exists) {
            return {
              items: state.items.map((i) =>
                i.id === cartId
                  ? { ...i, price: bumpedPrice, regularPrice: product.price, quantity: bumpedQty }
                  : i
              ),
            };
          }
          return {
            items: [
              ...state.items,
              {
                id: cartId,
                name: product.name,
                price: bumpedPrice,
                regularPrice: product.price,
                quantity: bumpedQty,
                image: product.image,
                isBump: true,
                bumpForProductId: product.id,
                bumpOfferId,
              } as CartItemExtended,
            ],
          };
        });
      },

      addItem: (product) => {
        set((state) => {
          const existingItem = state.items.find((item) => item.id === product.id);
          const promoActive = product.promoPrice != null && product.promoPrice < product.price;
          const price = promoActive ? product.promoPrice! : product.price;
          const regularPrice = product.price;

          if (existingItem) {
            return {
              items: state.items.map((item) =>
                item.id === product.id
                  ? { ...item, quantity: item.quantity + 1 }
                  : item
              ),
              isOpen: true,
            };
          }

          return {
            items: [
              ...state.items,
              {
                id: product.id,
                name: product.name,
                price,
                regularPrice,
                quantity: 1,
                image: product.image,
              } as CartItemExtended,
            ],
            isOpen: true,
          };
        });
      },

      removeItem: (itemId) => {
        set((state) => ({
          items: state.items.filter(
            (item) =>
              item.id !== itemId &&
              item.bumpForProductId !== itemId
          ),
        }));
      },

      updateQuantity: (itemId, quantity) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === itemId ? { ...item, quantity: Math.max(1, quantity) } : item
          ),
        }));
      },

      clearCart: () => set({ items: [] }),

      getSubtotal: () => {
        return get().items.reduce((total, item) => total + item.price * item.quantity, 0);
      },

      getCardSubtotal: () => {
        return get().items.reduce(
          (total, item) => total + (item.regularPrice ?? item.price) * item.quantity,
          0
        );
      },
    }),
    {
      name: "ka-imports-cart",
      partialize: (state) => ({ items: state.items }),
    }
  )
);
