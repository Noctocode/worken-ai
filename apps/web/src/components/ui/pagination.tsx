"use client";

import { useMemo } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

interface PaginationProps {
  /** 1-indexed current page. */
  page: number;
  /** Total pages — usually `Math.ceil(total / pageSize)`. */
  totalPages: number;
  onPageChange: (next: number) => void;
  /**
   * Hide the bar entirely when only one page exists. Defaults to
   * *false* to match the Figma comp, which always renders the bar
   * under the table for visual anchoring — even on single-page
   * datasets where Prev/Next are disabled and only "1" is active.
   * Pass `true` to fall back to the hide-when-trivial behavior.
   */
  hideOnSinglePage?: boolean;
  /** Visual sibling count on each side of the current page. Defaults
   *  to 1 so 7 pages renders as `1 … 5 [6] 7 … 10` style layouts. */
  siblingCount?: number;
  className?: string;
}

/**
 * Build the visible run of page numbers + ellipses. Matches the
 * Figma comp's `1, 2, 3, …, 8, 9, 10` shape:
 *  - first and last page always visible
 *  - up to `siblingCount` pages on each side of the current page
 *  - "…" placeholder where the run is non-contiguous
 *
 * Returns an array of items the renderer can map over: either a
 * number (clickable page link) or the literal string `"ellipsis-l"`
 * / `"ellipsis-r"` so React keys stay stable across re-renders.
 */
function paginationRange(
  page: number,
  totalPages: number,
  siblingCount: number,
): Array<number | "ellipsis-l" | "ellipsis-r"> {
  // Tight ranges (≤ siblings*2 + first + last + 2 ellipses ≈ 7 by
  // default) render every number — no ellipses needed.
  const SHOW_ALL_THRESHOLD = siblingCount * 2 + 5;
  if (totalPages <= SHOW_ALL_THRESHOLD) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const leftSibling = Math.max(page - siblingCount, 2);
  const rightSibling = Math.min(page + siblingCount, totalPages - 1);
  const showLeftEllipsis = leftSibling > 2;
  const showRightEllipsis = rightSibling < totalPages - 1;

  const out: Array<number | "ellipsis-l" | "ellipsis-r"> = [1];
  if (showLeftEllipsis) out.push("ellipsis-l");
  for (let p = leftSibling; p <= rightSibling; p++) out.push(p);
  if (showRightEllipsis) out.push("ellipsis-r");
  out.push(totalPages);
  return out;
}

/**
 * Pagination control matching Figma `Centered page numbers/Desktop`.
 *
 * The bar starts with a 1px top divider, then Previous on the left,
 * the page-number run in the middle, and Next on the right —
 * justify-between so the controls always pin to the edges of the
 * surrounding card regardless of how many numbers are visible. The
 * current page gets a 2px primary-blue top border (mirrors the
 * Figma `#33AFF3` accent on the active number link).
 */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  hideOnSinglePage = false,
  siblingCount = 1,
  className,
}: PaginationProps) {
  const items = useMemo(
    () => paginationRange(page, totalPages, siblingCount),
    [page, totalPages, siblingCount],
  );

  if (totalPages <= 1 && hideOnSinglePage) return null;

  const clampedPage = Math.min(Math.max(1, page), Math.max(1, totalPages));
  const prevDisabled = clampedPage <= 1;
  const nextDisabled = clampedPage >= totalPages;

  return (
    <nav
      aria-label="Pagination"
      className={`flex w-full items-stretch justify-between border-t border-border-2 ${className ?? ""}`}
    >
      <StepLink
        direction="prev"
        disabled={prevDisabled}
        onClick={() => onPageChange(clampedPage - 1)}
      />

      <ul className="flex items-stretch">
        {items.map((item) => {
          if (item === "ellipsis-l" || item === "ellipsis-r") {
            return (
              <li
                key={item}
                aria-hidden="true"
                className="flex w-10 items-start justify-center border-t-2 border-transparent pt-4 text-[13px] text-text-3"
              >
                …
              </li>
            );
          }
          const isCurrent = item === clampedPage;
          return (
            <li key={item} className="flex">
              <button
                type="button"
                onClick={() => {
                  if (!isCurrent) onPageChange(item);
                }}
                aria-current={isCurrent ? "page" : undefined}
                aria-label={`Page ${item}`}
                className={`flex min-w-10 items-start justify-center border-t-2 px-4 pt-4 text-[13px] transition-colors ${
                  isCurrent
                    ? "cursor-default border-primary-6 font-medium text-text-1"
                    : "cursor-pointer border-transparent text-text-3 hover:border-border-4 hover:text-text-1"
                }`}
              >
                {item}
              </button>
            </li>
          );
        })}
      </ul>

      <StepLink
        direction="next"
        disabled={nextDisabled}
        onClick={() => onPageChange(clampedPage + 1)}
      />
    </nav>
  );
}

function StepLink({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  const isPrev = direction === "prev";
  const Icon = isPrev ? ArrowLeft : ArrowRight;
  const label = isPrev ? "Previous" : "Next";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`flex items-start gap-3 border-t-2 border-transparent pt-4 text-[13px] transition-colors ${
        isPrev ? "pr-1" : "pl-1"
      } ${
        disabled
          ? "cursor-not-allowed text-text-3/40"
          : "cursor-pointer text-text-3 hover:border-border-4 hover:text-text-1"
      }`}
    >
      {isPrev && <Icon className="h-5 w-5" />}
      {label}
      {!isPrev && <Icon className="h-5 w-5" />}
    </button>
  );
}
