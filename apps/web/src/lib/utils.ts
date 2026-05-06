import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as currency: $100.000,00
 * - 2 decimal places
 * - dot as thousands separator
 * - comma as decimal separator
 */
export function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `-$${formatted}` : `$${formatted}`;
}

/**
 * Live formatter for the de-DE budget input. Called on every keystroke
 * to keep the displayed value in `1.234,56` shape while the user is
 * typing. Also smart-parses pasted en-US values (`1234.56` → `1.234,56`)
 * so both keyboard layouts feel native.
 *
 * Pairs with the parser used on confirm: strip dots, swap comma for
 * dot, then `parseFloat`.
 */
export function formatBudgetInput(raw: string): string {
  // Strip everything except digits, dots, commas.
  let canonical = raw.replace(/[^\d.,]/g, "");

  const hasComma = canonical.includes(",");
  const dotCount = (canonical.match(/\./g) ?? []).length;

  if (hasComma) {
    // de-DE: comma is decimal, dots are thousand separators → drop dots.
    canonical = canonical.replace(/\./g, "");
  } else if (dotCount > 0) {
    // No comma. Heuristic: a single dot followed by 1–2 digits is a
    // decimal point (en-US paste like "1234.56"). Anything else is
    // thousand-separator decoration ("1.234") and the dots get stripped.
    const lastDot = canonical.lastIndexOf(".");
    const trailingDigits = canonical.length - lastDot - 1;
    if (dotCount === 1 && trailingDigits >= 1 && trailingDigits <= 2) {
      canonical = canonical.replace(".", ",");
    } else {
      canonical = canonical.replace(/\./g, "");
    }
  }

  // Collapse extra commas (keep first).
  const firstComma = canonical.indexOf(",");
  if (firstComma >= 0) {
    canonical =
      canonical.slice(0, firstComma + 1) +
      canonical.slice(firstComma + 1).replace(/,/g, "");
  }

  if (canonical === "") return "";

  let intPart: string;
  let fracPart: string | null;
  if (firstComma >= 0) {
    const parts = canonical.split(",");
    intPart = parts[0] ?? "";
    fracPart = (parts[1] ?? "").slice(0, 2);
  } else {
    intPart = canonical;
    fracPart = null;
  }

  // Strip leading zeros except keep the last digit; "00012" → "12",
  // "0" → "0", "0001234" → "1234". Then handle the "0,5" case where
  // the comma was typed but the int side ended up empty.
  intPart = intPart.replace(/^0+(?=\d)/, "");
  if (intPart === "" && fracPart !== null) {
    intPart = "0";
  }

  // Insert thousand separators (dots) into the integer part.
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  return fracPart !== null ? `${intFormatted},${fracPart}` : intFormatted;
}
