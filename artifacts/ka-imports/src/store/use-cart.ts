import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CartItem, Product } from "@workspace/api-client-react";
import {
  buildCartLineId,
  buildVariantLabel,
  catalogIdFromLineId,
  migrateCartLine,
  orderSelectedVariants,
  parseVariantGroups,
  resolveVariantLineImage,
  variantSelectionMessage,
  type SelectedVariant,
} from "@/lib/product-variants";

type BulkDiscountTier = {
  minQty: number;
  maxQty: number | null;
  unitPrice: number;
  label?: string | null;
};

type ProductAvailability = Product & {
  isSoldOut?: boolean;
  isActive?: boolean;
  stock?: number | null;
};

export function isProductUnavailable(product: Product): boolean {
  const candidate = product as ProductAvailability;
  if (candidate.isActive === false) return true;
  if (candidate.isSoldOut === true) return true;
  return false;
}

type CartItemExtended = CartItem & {
  productId?: string;
  image?: string;
  baseUnitPrice: number;
  regularPrice: number;
  bulkDiscountEnabled?: boolean;
  bulkDiscountTiers?: BulkDiscountTier[];
  selectedVariants?: SelectedVariant[];
  variantLabel?: string;
  isBump?: boolean;
  bumpForProductId?: string;
  bumpOfferId?: string;
  bumpProductId?: string;
};

function getBaseUnitPrice(product: Product): number {
  const bulkEnabled = (product as Product & { bulkDiscountEnabled?: boolean }).bulkDiscountEnabled === true;
  if (bulkEnabled) {
    const tiers = parseBulkDiscountTiers((product as Product & { bulkDiscountTiers?: unknown }).bulkDiscountTiers);
    const oneBoxTier = tiers.find((tier) => tier.minQty <= 1 && (tier.maxQty == null || tier.maxQty >= 1));
    if (oneBoxTier) return oneBoxTier.unitPrice;
  }
  const promoActive = product.promoPrice != null && product.promoPrice < product.price;
  return promoActive ? product.promoPrice! : product.price;
}

function parseBulkDiscountTiers(raw: unknown): BulkDiscountTier[] {
  if (!Array.isArray(raw)) return [];

  const normalized = raw
    .map((tier) => {
      const item = tier as Record<string, unknown>;
      const minQty = Number(item.minQty);
      const maxQtyRaw = item.maxQty;
      const maxQty = maxQtyRaw == null ? null : Number(maxQtyRaw);
      const unitPrice = Number(item.unitPrice);
      const label = item.label == null ? null : String(item.label);

      if (!Number.isFinite(minQty) || minQty < 1) return null;
      if (maxQty !== null && (!Number.isFinite(maxQty) || maxQty < minQty)) return null;
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;

      return { minQty, maxQty, unitPrice, label };
    })
    .filter((tier): tier is BulkDiscountTier => Boolean(tier));

  return normalized.sort((a, b) => a.minQty - b.minQty);
}

function getTierUnitPrice(baseUnitPrice: number, quantity: number, tiers: BulkDiscountTier[]): number {
  if (tiers.length === 0) return baseUnitPrice;
  const match = tiers.find((tier) => quantity >= tier.minQty && (tier.maxQty == null || quantity <= tier.maxQty));
  return match?.unitPrice ?? baseUnitPrice;
}

interface CartState {
  items: CartItemExtended[];
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  addItem: (
    product: Product,
    options?: { quantity?: number; unitPrice?: number; selectedVariants?: Array<{ groupName?: string; option?: string }> },
  ) => void;
  addBumpItem: (
    bumpOfferId: string,
    anchorProductId: string,
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

      addBumpItem: (bumpOfferId, anchorProductId, product, bumpedPrice, bumpedQty) => {
        const cartId = `bump_${bumpOfferId}`;
        set((state) => {
          const exists = state.items.some((i) => i.id === cartId);
          if (exists) {
            return {
              items: state.items.map((i) =>
                i.id === cartId
                  ? { ...i, price: bumpedPrice, regularPrice: product.price, quantity: bumpedQty, bumpForProductId: anchorProductId, bumpProductId: product.id, image: product.image, name: product.name }
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
                baseUnitPrice: product.price,
                regularPrice: product.price,
                quantity: bumpedQty,
                image: product.image,
                isBump: true,
                bumpForProductId: anchorProductId,
                bumpOfferId,
                bumpProductId: product.id,
              } as CartItemExtended,
            ],
          };
        });
      },

      addItem: (product, options) => {
        set((state) => {
          if (isProductUnavailable(product)) {
            return state;
          }

          const addQuantity = Math.max(1, Number(options?.quantity ?? 1) || 1);
          const variantGroups = parseVariantGroups((product as Product & { variantGroups?: unknown }).variantGroups);
          const selectedVariants = orderSelectedVariants(variantGroups, options?.selectedVariants);
          if (variantGroups.length > 0 && variantSelectionMessage(variantGroups, selectedVariants)) {
            return state;
          }
          const variantLabel = buildVariantLabel(selectedVariants);
          const displayName = variantLabel ? `${product.name} - ${variantLabel}` : product.name;
          const lineId = buildCartLineId(product.id, selectedVariants);
          const lineImage = resolveVariantLineImage(variantGroups, selectedVariants, product.image ?? null) || undefined;
          const bulkDiscountEnabled = (product as Product & { bulkDiscountEnabled?: boolean }).bulkDiscountEnabled === true;
          const bulkDiscountTiers = bulkDiscountEnabled
            ? parseBulkDiscountTiers((product as Product & { bulkDiscountTiers?: unknown }).bulkDiscountTiers)
            : [];
          const baseUnitPrice = getBaseUnitPrice(product);

          const existingItem = state.items.find((item) => item.id === lineId && item.isBump !== true);
          const regularPrice = product.price;

          if (existingItem) {
            const nextQuantity = existingItem.quantity + addQuantity;
            const tiersForPrice = bulkDiscountEnabled ? (existingItem.bulkDiscountTiers ?? bulkDiscountTiers) : [];
            const nextPrice = options?.unitPrice ?? getTierUnitPrice(baseUnitPrice, nextQuantity, tiersForPrice);
            return {
              items: state.items.map((item) =>
                item.id === lineId
                  ? {
                    ...item,
                    productId: product.id,
                    name: displayName,
                    quantity: nextQuantity,
                    price: nextPrice,
                    image: lineImage,
                    baseUnitPrice,
                    bulkDiscountEnabled,
                    bulkDiscountTiers: tiersForPrice,
                    selectedVariants,
                    variantLabel: variantLabel || undefined,
                  }
                  : item
              ),
              isOpen: true,
            };
          }

          const initialPrice = options?.unitPrice ?? getTierUnitPrice(baseUnitPrice, addQuantity, bulkDiscountTiers);

          return {
            items: [
              ...state.items,
              {
                id: lineId,
                productId: product.id,
                name: displayName,
                price: initialPrice,
                baseUnitPrice,
                regularPrice,
                quantity: addQuantity,
                image: lineImage,
                bulkDiscountEnabled,
                bulkDiscountTiers,
                selectedVariants,
                variantLabel: variantLabel || undefined,
              } as CartItemExtended,
            ],
            isOpen: true,
          };
        });
      },

      removeItem: (itemId) => {
        set((state) => {
          const target = state.items.find((item) => item.id === itemId);
          const nextItems = state.items.filter((item) => item.id !== itemId);
          if (!target || target.isBump === true) return { items: nextItems };
          const productId = target.productId || catalogIdFromLineId(target.id);
          const stillThere = nextItems.some((item) => item.isBump !== true && (item.productId || catalogIdFromLineId(item.id)) === productId);
          if (stillThere) return { items: nextItems };
          return { items: nextItems.filter((item) => item.bumpForProductId !== productId) };
        });
      },

      updateQuantity: (itemId, quantity) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === itemId
              ? {
                ...item,
                quantity: Math.max(1, quantity),
                price: item.isBump === true
                  ? Number(item.price)
                  : (item.bulkDiscountEnabled === true)
                    ? getTierUnitPrice(Number(item.baseUnitPrice ?? item.price), Math.max(1, quantity), item.bulkDiscountTiers ?? [])
                    : Number(item.baseUnitPrice ?? item.price),
              }
              : item
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
      merge: (persisted, current) => {
        const saved = persisted as { items?: CartItemExtended[] } | undefined;
        return {
          ...current,
          ...saved,
          items: (saved?.items ?? []).map((item) => migrateCartLine(item)),
        };
      },
    }
  )
);
