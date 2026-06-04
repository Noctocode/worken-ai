"use client";

import { ChevronDown, Globe } from "lucide-react";

import { useLanguage, type Language } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const LANGUAGES: Array<{ code: Language; label: string }> = [
  { code: "en", label: "English" },
  { code: "sl", label: "Slovenščina" },
];

export function LanguageSelector({
  collapsed,
  // Dropdown placement. Defaults match the sidebar (menu opens upward);
  // top-of-page callers (login / register / onboarding) pass
  // side="bottom" so it opens downward instead of off-screen.
  side = "top",
  align,
}: {
  collapsed: boolean;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}) {
  const { language, setLanguage, t } = useLanguage();
  const current = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {collapsed ? (
          <Button
            variant="ghost"
            aria-label={t("sidebar.language")}
            title={t("sidebar.language")}
            className="h-[40px] w-[40px] p-0 justify-center text-text-2 hover:text-text-1"
          >
            <Globe className="size-5 text-text-3" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="nav"
            aria-label={t("sidebar.language")}
            title={t("sidebar.language")}
            className="w-full cursor-pointer justify-start gap-3 font-normal text-text-2 hover:text-text-1"
          >
            <Globe className="size-5 shrink-0 text-text-3" />
            <span>{current.label}</span>
            <ChevronDown className="ml-auto size-4 shrink-0 text-text-3" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align ?? (collapsed ? "end" : "center")}
        side={side}
      >
        {LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => setLanguage(lang.code)}
            className={
              language === lang.code ? "font-semibold text-primary-6" : ""
            }
          >
            {lang.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
