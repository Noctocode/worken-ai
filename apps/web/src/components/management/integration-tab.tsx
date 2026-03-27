"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Switch } from "@/components/ui/switch";

interface LLMProvider {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  icon: React.ReactNode;
}

// Simple colored icon circles to represent each LLM brand
function GeminiIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <defs>
        <linearGradient id="gemini-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="100%" stopColor="#A142F4" />
        </linearGradient>
      </defs>
      <path d="M12 2C12 2 7 7 7 12C7 17 12 22 12 22C12 22 17 17 17 12C17 7 12 2 12 2Z" fill="url(#gemini-grad)" />
      <path d="M2 12C2 12 7 7 12 7C17 7 22 12 22 12C22 12 17 17 12 17C7 17 2 12 2 12Z" fill="url(#gemini-grad)" opacity="0.6" />
    </svg>
  );
}

function BrandIcon({ color, letter }: { color: string; letter: string }) {
  return (
    <div
      className="flex h-5 w-5 items-center justify-center rounded-sm text-[10px] font-bold text-white"
      style={{ backgroundColor: color }}
    >
      {letter}
    </div>
  );
}

const INITIAL_PROVIDERS: LLMProvider[] = [
  {
    id: "gemini",
    name: "Gemini",
    description: "Short text describing this",
    enabled: true,
    icon: <GeminiIcon />,
  },
  {
    id: "chatgpt",
    name: "Chat GPT",
    description: "Short text describing this",
    enabled: false,
    icon: <BrandIcon color="#10a37f" letter="G" />,
  },
  {
    id: "deepseek",
    name: "Deepseek",
    description: "Short text describing this",
    enabled: true,
    icon: <BrandIcon color="#1a73e8" letter="D" />,
  },
  {
    id: "mistral",
    name: "Mistral",
    description: "Short text describing this",
    enabled: false,
    icon: <BrandIcon color="#f7931e" letter="M" />,
  },
  {
    id: "claude",
    name: "Claude",
    description: "Short text describing this",
    enabled: false,
    icon: <BrandIcon color="#d97706" letter="C" />,
  },
  {
    id: "preplexity",
    name: "Preplexity",
    description: "Short text describing this",
    enabled: false,
    icon: <BrandIcon color="#20b2aa" letter="P" />,
  },
  {
    id: "qwen",
    name: "Qwen",
    description: "Short text describing this",
    enabled: true,
    icon: <BrandIcon color="#7c3aed" letter="Q" />,
  },
  {
    id: "copilot",
    name: "Copilot",
    description: "Short text describing this",
    enabled: false,
    icon: <BrandIcon color="#0078d4" letter="Co" />,
  },
  {
    id: "grok",
    name: "Grok",
    description: "Short text describing this",
    enabled: true,
    icon: <BrandIcon color="#1a1a1a" letter="X" />,
  },
];

export function IntegrationTab() {
  const [search, setSearch] = useState("");
  const [providers, setProviders] = useState<LLMProvider[]>(INITIAL_PROVIDERS);

  const toggle = (id: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    );
  };

  const filtered = providers.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="py-5">
      {/* Toolbar */}
      <div className="flex items-center gap-4 mb-6">
        <SearchInput
          className="flex-1"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button variant="plusAction">
          <Plus className="h-4 w-4 text-black-900" />
          Add Custom LLM
        </Button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-4 gap-4">
        {filtered.map((provider) => (
          <div
            key={provider.id}
            className="flex flex-col rounded-lg border border-bg-1 bg-white p-4"
          >
            {/* Header: icon + name + toggle */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {provider.icon}
                <span className="text-[14px] font-medium text-black">
                  {provider.name}
                </span>
              </div>
              <Switch
                checked={provider.enabled}
                onCheckedChange={() => toggle(provider.id)}
              />
            </div>

            {/* Description */}
            <p className="text-[12px] text-slate-500 mb-4 flex-1">
              {provider.description}
            </p>

            {/* Settings link */}
            <div className="flex justify-end">
              <button className="text-[13px] font-medium text-primary-5 hover:underline">
                Settings
              </button>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-4 py-12 text-center text-sm text-slate-400">
            No integrations match your search.
          </div>
        )}
      </div>
    </div>
  );
}
