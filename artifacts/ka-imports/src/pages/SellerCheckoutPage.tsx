/**
 * SellerCheckoutPage — handles /:seller/checkout and /:seller/checkout?product=:id
 *
 * 1. Saves seller code SYNCHRONOUSLY before Checkout renders.
 * 2. Fetches seller WhatsApp from API asynchronously and stores in sessionStorage.
 * 3. If ?product= is present, queues it for Checkout to auto-add to cart.
 */
import { useRef, useEffect } from "react";
import { useRoute, useSearch } from "wouter";
import Checkout from "@/pages/Checkout";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type SellerRecord = { slug: string; whatsapp: string };

function saveSellerSync(seller: string) {
  sessionStorage.setItem("sellerCode", seller);
  localStorage.setItem("sellerCode", seller);
}

async function preloadSellerWhatsApp(seller: string): Promise<void> {
  try {
    const res = await fetch(`${BASE}/api/sellers/${encodeURIComponent(seller)}`);
    if (!res.ok) return;
    const data = (await res.json()) as SellerRecord;
    if (data?.whatsapp) {
      sessionStorage.setItem("sellerWhatsapp", data.whatsapp);
    }
  } catch {
    // ignore
  }
}

export default function SellerCheckoutPage() {
  const [, params] = useRoute("/:seller/checkout");
  const searchString = useSearch();

  const seller = params?.seller?.toLowerCase() ?? "";

  // --- Synchronous seller save (runs during render, before Checkout mounts) ---
  const lastSavedRef = useRef<string | null>(null);
  if (seller && lastSavedRef.current !== seller) {
    lastSavedRef.current = seller;
    saveSellerSync(seller);
  }

  // --- Queue pending product from ?product= (synchronous, before Checkout mounts) ---
  const pendingQueuedRef = useRef(false);
  if (!pendingQueuedRef.current) {
    pendingQueuedRef.current = true;
    const sp = new URLSearchParams(searchString);
    const productId = sp.get("product");
    if (productId) {
      sessionStorage.setItem("ka_pending_product", productId);
    }
  }

  // --- Async WhatsApp pre-load ---
  useEffect(() => {
    if (seller) preloadSellerWhatsApp(seller);
  }, [seller]);

  return <Checkout />;
}
