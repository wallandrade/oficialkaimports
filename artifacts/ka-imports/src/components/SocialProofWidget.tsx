import { useEffect, useState, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ShoppingBag, X, MapPin } from "lucide-react";

interface Entry {
  firstName: string;
  city: string;
  productName: string;
  source: "real" | "fake" | "auto";
}

interface Feed {
  enabled: boolean;
  delaySeconds: number;
  displaySeconds: number;
  cardBgColor: string;
  cardTextColor: string;
  badgeColor: string;
  realEntries?: Entry[];
  fillEntries?: Entry[];
  entries?: Entry[]; // legacy format (backward compat)
}

function maskName(name: string): string {
  if (!name) return "***";
  return name.charAt(0).toUpperCase() + name.slice(1) + "***";
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Deck {
  private items: Entry[];
  private index = 0;

  constructor(entries: Entry[]) {
    this.items = shuffled(entries);
  }

  get length() { return this.items.length; }

  next(): Entry | null {
    if (!this.items.length) return null;
    const entry = this.items[this.index];
    this.index++;
    if (this.index >= this.items.length) {
      this.items = shuffled(this.items);
      this.index = 0;
    }
    return entry;
  }
}

export default function SocialProofWidget() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const feedRef = useRef<Feed | null>(null);
  const realDeck = useRef<Deck | null>(null);
  const fillDeck = useRef<Deck | null>(null);
  const nextTurn = useRef<"real" | "fill">("real");

  const [current, setCurrent] = useState<Entry | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const dismissedRef = useRef(false);
  const [cardKey, setCardKey] = useState(0);

  // Timer ref for the "show next card" timeout — lives outside React's effect cleanup
  const nextCardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load feed once
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/social-proof/feed`)
      .then((r) => r.json())
      .then((data: Feed) => {
        if (!data.enabled) return;

        // Support both new (realEntries/fillEntries) and old (entries) API formats
        let real: Entry[] = data.realEntries ?? [];
        let fill: Entry[] = data.fillEntries ?? [];
        if (!real.length && !fill.length && data.entries?.length) {
          real = data.entries.filter((e) => e.source === "real");
          fill = data.entries.filter((e) => e.source !== "real");
        }
        if (!real.length && !fill.length) return;

        realDeck.current = new Deck(real);
        fillDeck.current = new Deck(fill);
        feedRef.current = data;
        setFeed(data);
      })
      .catch(() => {});
  }, []);

  // Keep dismissedRef in sync with state (for use inside timer callbacks)
  useEffect(() => { dismissedRef.current = dismissed; }, [dismissed]);

  // Pick the next entry from the correct deck (real takes priority)
  const pickNext = useCallback((): Entry | null => {
    const real = realDeck.current;
    const fill = fillDeck.current;
    const turn = nextTurn.current;
    let entry: Entry | null = null;

    if (turn === "real") {
      entry = real?.length ? real.next() ?? null : null;
      entry = entry ?? (fill?.length ? fill.next() ?? null : null);
      nextTurn.current = fill?.length ? "fill" : "real";
    } else {
      entry = fill?.length ? fill.next() ?? null : null;
      entry = entry ?? (real?.length ? real.next() ?? null : null);
      nextTurn.current = real?.length ? "real" : "fill";
    }
    return entry;
  }, []);

  // Schedule the next card to appear after `delayMs`.
  // Stored in a ref so it is NOT cancelled by React effect cleanup when visible→false.
  const scheduleNext = useCallback((delayMs: number) => {
    if (nextCardTimer.current) clearTimeout(nextCardTimer.current);
    nextCardTimer.current = setTimeout(() => {
      if (dismissedRef.current) return;
      const next = pickNext();
      if (!next) return;
      setCurrent(next);
      setCardKey((k) => k + 1);
      setVisible(true);
    }, delayMs);
  }, [pickNext]);

  // First card: pick immediately, display after 3s
  useEffect(() => {
    if (!feed) return;
    const first = pickNext();
    if (!first) return;
    setCurrent(first);
    const t = setTimeout(() => setVisible(true), 3000);
    return () => clearTimeout(t);
  }, [feed, pickNext]);

  // When card becomes visible: hide it after displaySeconds, then schedule next after delaySeconds.
  // IMPORTANT: only `hideT` is in the cleanup — `scheduleNext` lives in nextCardTimer (a ref)
  // and is NOT cancelled when visible→false. This fixes the "stops after first card" bug.
  useEffect(() => {
    if (!visible || !feed) return;
    const display = (feed.displaySeconds ?? 5) * 1000;
    const delay   = (feed.delaySeconds   ?? 8) * 1000;

    const hideT = setTimeout(() => {
      setVisible(false);
      scheduleNext(delay); // schedules the next card — survives this effect's cleanup
    }, display);

    return () => clearTimeout(hideT); // only cancel the hide timer, never the next-card timer
  }, [visible, feed, scheduleNext]);

  // Cancel any pending next-card timer when user dismisses
  useEffect(() => {
    if (!dismissed) return;
    if (nextCardTimer.current) {
      clearTimeout(nextCardTimer.current);
      nextCardTimer.current = null;
    }
  }, [dismissed]);

  if (!feed || !current || dismissed) return null;

  const bg    = feed.cardBgColor   ?? "#ffffff";
  const text  = feed.cardTextColor ?? "#1a1a1a";
  const badge = feed.badgeColor    ?? "#22c55e";

  return (
    <div className="fixed bottom-5 left-5 z-[9999]" style={{ width: 260 }}>
      <AnimatePresence mode="wait">
        {visible && (
          <motion.div
            key={cardKey}
            initial={{ opacity: 0, x: -20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -16, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
            className="rounded-2xl select-none overflow-hidden relative"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            style={{
              backgroundColor: bg,
              boxShadow: "0 8px 32px rgba(0,0,0,0.13), 0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            <div className="h-1 w-full" style={{ backgroundColor: badge }} />

            <div className="px-3.5 pt-3 pb-3">
              <div className="flex items-start gap-2.5">
                <div
                  className="mt-0.5 w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: badge + "1a" }}
                >
                  <ShoppingBag className="w-4 h-4" style={{ color: badge }} />
                </div>

                <div className="flex-1 min-w-0 pr-4">
                  <p className="text-[13px] font-semibold leading-tight" style={{ color: text }}>
                    <span style={{ color: badge }}>{maskName(current.firstName)}</span>
                    {" "}
                    <span style={{ opacity: 0.65 }}>acabou de comprar</span>
                  </p>
                  <p
                    className="text-[12px] font-bold mt-1 leading-snug truncate"
                    style={{ color: text }}
                    title={current.productName}
                  >
                    {current.productName}
                  </p>
                  <div className="flex items-center gap-1 mt-1.5">
                    <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: badge, opacity: 0.8 }} />
                    <p className="text-[11px] font-medium truncate" style={{ color: text, opacity: 0.5 }}>
                      {current.city}
                    </p>
                  </div>
                </div>
              </div>

              {/* Progress bar — resets on each new card via key */}
              <div className="mt-3 h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: text + "12" }}>
                <motion.div
                  key={cardKey}
                  className="h-full rounded-full"
                  style={{ backgroundColor: badge + "99" }}
                  initial={{ width: "100%" }}
                  animate={{ width: "0%" }}
                  transition={{ duration: feed.displaySeconds ?? 5, ease: "linear" }}
                />
              </div>
            </div>

            <button
              onClick={() => { dismissedRef.current = true; setDismissed(true); setVisible(false); }}
              className="absolute top-2.5 right-2.5 w-5 h-5 flex items-center justify-center rounded-full transition-opacity hover:opacity-80"
              style={{ color: text, opacity: 0.3 }}
              aria-label="Fechar"
            >
              <X className="w-3 h-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
