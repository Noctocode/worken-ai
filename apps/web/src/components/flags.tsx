import { cn } from "@/lib/utils";
import type { Language } from "@/lib/i18n";

const FLAGS: Record<Language, { src: string; alt: string }> = {
  en: { src: "/united-kingdom.png", alt: "English" },
  sl: { src: "/slovenia.png", alt: "Slovenščina" },
};

/**
 * Small colorful flag icon for the language selector, backed by the
 * square 24×24 PNGs in /public. Plain <img> (not next/image) — they're
 * tiny, local, and decorative, so the optimizer's wrapper isn't worth
 * it. Square by default; callers size it via `className`.
 */
export function Flag({
  code,
  className,
}: {
  code: Language;
  className?: string;
}) {
  const { src, alt } = FLAGS[code] ?? FLAGS.en;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      aria-hidden="true"
      className={cn(
        "pointer-events-none inline-block shrink-0 rounded-[2px] object-cover",
        "h-[18px] w-[18px]",
        className,
      )}
    />
  );
}
