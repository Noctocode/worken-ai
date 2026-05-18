"use client";

import Image from "next/image";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SidebarContent } from "./sidebar";

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
            className="h-9 w-9 text-text-2 hover:bg-bg-1 hover:text-text-1"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-[88px]">
          <SidebarContent showToggle={false} forceCollapsed />
        </SheetContent>
      </Sheet>
    </header>
  );
}
