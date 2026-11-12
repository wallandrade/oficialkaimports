import { cn } from "@/lib/utils";
import arcUrl from "@/assets/brand-loader/arc.png";
import lettersUrl from "@/assets/brand-loader/letters.png";

const SIZES = {
  sm: 24,
  md: 32,
  lg: 48,
} as const;

export type BrandLoaderSize = keyof typeof SIZES;

const MARK_SIZE = 512;

/**
 * Símbolo da KA extraído de `public/logo.jpeg`.
 * As letras ficam paradas. Só o arco (`brand-loader-orbit`) gira.
 * A logo enviada em Configurações (`logo`) é o wordmark largo do header,
 * um raster por filial, e não entra aqui.
 */
export function BrandLoader({
  size = "md",
  className,
  label = "Carregando",
}: {
  size?: BrandLoaderSize;
  className?: string;
  label?: string;
}) {
  const px = SIZES[size];
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-flex shrink-0", className)}
      style={{ width: px, height: px }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`}
        width={px}
        height={px}
        fill="none"
        aria-hidden="true"
        className="brand-loader-svg overflow-visible"
      >
        <image href={lettersUrl} x="0" y="0" width={MARK_SIZE} height={MARK_SIZE} />
        <g className="brand-loader-orbit">
          <image href={arcUrl} x="0" y="0" width={MARK_SIZE} height={MARK_SIZE} />
        </g>
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function BrandPageLoader({
  label = "Carregando",
  message,
  className,
}: {
  label?: string;
  message?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center min-h-screen", className)}>
      <BrandLoader size="lg" label={label} />
      {message ? (
        <p className="mt-4 text-muted-foreground font-medium">{message}</p>
      ) : null}
    </div>
  );
}
