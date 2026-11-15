import { cn } from "@/lib/utils";

const VARIANT_CLASS = {
  header: "h-auto max-h-12 w-auto max-w-[46vw] object-contain md:max-h-16",
  pharma: "h-auto max-h-12 w-auto max-w-full object-contain sm:max-h-14",
  checkout: "h-auto max-h-11 w-auto max-w-[46vw] object-contain",
  footer: "h-auto max-h-12 w-auto max-w-[220px] object-contain",
  login: "h-auto max-h-14 w-auto max-w-[220px] object-contain",
  maintenance: "h-auto max-h-16 w-auto max-w-[240px] object-contain",
} as const;

export type StoreWordmarkVariant = keyof typeof VARIANT_CLASS;

/** Wordmark padrão da loja principal. A altura muda por lugar; a proporção fica inteira. */
export function StoreWordmark({
  src,
  alt,
  variant,
  className,
  fetchPriority,
}: {
  src: string;
  alt: string;
  variant: StoreWordmarkVariant;
  className?: string;
  fetchPriority?: "high" | "low" | "auto";
}) {
  return (
    <img
      src={src}
      alt={alt}
      loading="eager"
      decoding="async"
      fetchPriority={fetchPriority}
      className={cn("shrink-0", VARIANT_CLASS[variant], className)}
    />
  );
}
