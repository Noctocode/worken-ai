"use client";

import Link from "next/link";
import { Menu, ChevronRight, Search, Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SidebarContent } from "./sidebar";
import { useBreadcrumbs } from "@/hooks/use-breadcrumbs";

export const Appbar = () => {
  const breadcrumbs = useBreadcrumbs();

  return (
    <header className="sticky top-0 z-20 flex h-[4.5rem] items-center justify-between border-b border-slate-200/80 bg-white/85 px-6 backdrop-blur-md">
      <div className="flex items-center gap-4">
        {/* Mobile Menu Trigger */}
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-slate-500 hover:bg-slate-100 md:hidden"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72">
            <SidebarContent />
          </SheetContent>
        </Sheet>

        {/* Breadcrumbs */}
        <nav className="hidden items-center text-sm font-medium text-slate-500 sm:flex">
          {breadcrumbs.map((crumb, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span key={i} className="flex items-center">
                {i > 0 && (
                  <ChevronRight className="mx-2 h-4 w-4 text-slate-400" />
                )}
                {isLast ? (
                  <Badge
                    variant="secondary"
                    className="rounded-md bg-slate-100 px-2 py-0.5 font-normal text-slate-900 hover:bg-slate-100"
                  >
                    {crumb.label}
                  </Badge>
                ) : crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="cursor-pointer transition-colors hover:text-slate-800"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="cursor-default">{crumb.label}</span>
                )}
              </span>
            );
          })}
        </nav>
      </div>

      {/* Right Header Controls */}
      <div className="flex items-center gap-3">
        <div className="relative hidden group sm:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-blue-500" />
          <Input
            type="text"
            placeholder="Search projects..."
            className="w-64 border-slate-200 bg-white pl-10 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-500/10 focus-visible:ring-offset-0 focus-visible:border-blue-500"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <kbd className="hidden h-5 items-center rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-medium text-slate-400 lg:inline-flex">
              ⌘K
            </kbd>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full border-2 border-white bg-red-500"></span>
        </Button>
      </div>
    </header>
  );
};
