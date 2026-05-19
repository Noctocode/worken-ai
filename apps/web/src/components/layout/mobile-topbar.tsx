"use client";

import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SidebarContent } from "./sidebar";

/**
 * Mobile menu glyph from Figma node 4750:32081 (icons/Menu). Differs
 * from lucide's `Menu` in one beat: the bottom line is shorter and
 * right-aligned — gives the icon a subtle "stacked content" feel that
 * the brand specs. Stroke uses currentColor so the wrapping Button
 * controls the colour state (default text-text-2, hover text-text-1).
 *
 * 1.5px stroke (vs the Figma source's hairline 1px) gives the glyph
 * enough visual weight to read at the larger render size used by
 * MobileTopbar — without it the icon looks anaemic next to the brand
 * logo on the left, even though the geometry is Figma-correct.
 */
function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M3 6H21" />
      <path d="M3 12H21" />
      <path d="M9 18H21" />
    </svg>
  );
}

/**
 * Mobile-only sticky topbar — logo on the left, hamburger on the right.
 * Reused by every appbar variant when `<md`. Matches Figma node
 * 4752:32095: 56px tall, white bg, 16px horizontal padding, the brand
 * "WA" mark linking back to /, and a Sheet trigger that opens the
 * collapsed sidebar from the left edge.
 *
 * The sticky positioning matches the desktop header above so swapping
 * variants doesn't shift the content scroll position.
 */
export function MobileTopbar() {
  return (
    <header className="md:hidden sticky top-0 z-20 flex h-14 items-center justify-between border-b border-bg-1 bg-bg-white px-4">
      <Link href="/" className="flex items-center">
        <Image
          src="/main-logo.png"
          alt="WorkenAI"
          width={30}
          height={14}
          priority
        />
      </Link>
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 text-text-2 hover:bg-bg-1 hover:text-text-1"
            aria-label="Open menu"
          >
            <MenuIcon className="h-7 w-7" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-[88px]">
          <SidebarContent showToggle={false} forceCollapsed />
        </SheetContent>
      </Sheet>
    </header>
  );
}
