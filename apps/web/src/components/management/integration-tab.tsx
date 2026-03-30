"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface LLMProvider {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  icon: React.ReactNode;
  successRate: number;
  apiCalls: number;
  rateLimit: number;
}

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
  { id: "gemini", name: "Gemini", description: "Short text describing this", enabled: true, icon: <GeminiIcon />, successRate: 98.5, apiCalls: 3456, rateLimit: 4000 },
  { id: "chatgpt", name: "Chat GPT", description: "Short text describing this", enabled: false, icon: <BrandIcon color="#10a37f" letter="G" />, successRate: 97.2, apiCalls: 1200, rateLimit: 4000 },
  { id: "deepseek", name: "Deepseek", description: "Short text describing this", enabled: true, icon: <BrandIcon color="#1a73e8" letter="D" />, successRate: 95.1, apiCalls: 800, rateLimit: 2000 },
  { id: "mistral", name: "Mistral", description: "Short text describing this", enabled: false, icon: <BrandIcon color="#f7931e" letter="M" />, successRate: 96.8, apiCalls: 540, rateLimit: 3000 },
  { id: "claude", name: "Claude", description: "Short text describing this", enabled: false, icon: <BrandIcon color="#d97706" letter="C" />, successRate: 99.1, apiCalls: 2100, rateLimit: 5000 },
  { id: "preplexity", name: "Preplexity", description: "Short text describing this", enabled: false, icon: <BrandIcon color="#20b2aa" letter="P" />, successRate: 94.3, apiCalls: 320, rateLimit: 1000 },
  { id: "qwen", name: "Qwen", description: "Short text describing this", enabled: true, icon: <BrandIcon color="#7c3aed" letter="Q" />, successRate: 93.7, apiCalls: 670, rateLimit: 2000 },
  { id: "copilot", name: "Copilot", description: "Short text describing this", enabled: false, icon: <BrandIcon color="#0078d4" letter="Co" />, successRate: 97.9, apiCalls: 1890, rateLimit: 4000 },
  { id: "grok", name: "Grok", description: "Short text describing this", enabled: true, icon: <BrandIcon color="#1a1a1a" letter="X" />, successRate: 96.0, apiCalls: 430, rateLimit: 1500 },
];

function ProviderSettingsDialog({
  provider,
  onClose,
  onToggle,
}: {
  provider: LLMProvider;
  onClose: () => void;
  onToggle: () => void;
}) {
  const [useOwnKey, setUseOwnKey] = useState(false);
  const [apiKey, setApiKey] = useState("");

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden" showCloseButton={false}>
        <DialogTitle className="sr-only">{provider.name} Settings</DialogTitle>
        <DialogDescription className="sr-only">Configure {provider.name} integration settings.</DialogDescription>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bg-1">
          <div className="flex items-center gap-3">
            {provider.icon}
            <span className="text-[16px] font-semibold text-black">{provider.name}</span>
            <Switch checked={provider.enabled} onCheckedChange={onToggle} />
          </div>
          <button onClick={onClose} className="shrink-0 text-success-7 hover:text-success-7/80">
           <X size={24} strokeWidth={1.7} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Stats row */}
          <div className="flex items-start gap-8">
            <div>
              <p className="text-[12px] text-slate-500 mb-0.5">Success rate:</p>
              <p className="text-[18px] font-semibold text-black">{provider.successRate}%</p>
            </div>
            <div>
              <p className="text-[12px] text-slate-500 mb-0.5">API calls:</p>
              <p className="text-[18px] font-semibold text-black">{provider.apiCalls.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[12px] text-slate-500 mb-0.5">Rate limit:</p>
              <p className="text-[18px] font-semibold text-black">
                {provider.rateLimit.toLocaleString()}
                <span className="text-[12px] font-normal text-slate-500 ml-1">requests/day</span>
              </p>
            </div>
          </div>

          {/* WorkenAI API */}
          <div>
            <p className="text-[13px] font-medium text-black mb-1.5">Use WORKENAI API</p>
            <textarea
              readOnly
              className="w-full rounded-md border border-black-600 bg-slate-50 px-3 py-2 text-[12px] text-slate-500 resize-none outline-none"
              rows={2}
              defaultValue="additional costs on his WorkenAI subscription will be added"
            />
          </div>

          {/* Own API key */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useOwnKey}
                onChange={(e) => setUseOwnKey(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 accent-primary-5"
              />
              <span className="text-[13px] font-medium text-black">Use your own API KEY</span>
            </label>
            {useOwnKey && (
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key"
                className="w-full rounded-md border border-black-600 bg-transparent px-3 py-2 text-[13px] text-black outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
              />
            )}
            {!useOwnKey && (
              <input
                type="text"
                readOnly
                value="12er1te2r1sa3df1ó5a5s1fd5ad5as"
                className="w-full rounded-md border border-black-600 bg-transparent px-3 py-2 text-[13px] text-slate-400 outline-none"
              />
            )}
          </div>

          {/* Fee note */}
          <p className="text-[12px] text-slate-400">
            API calls will incur a small Technology fee
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-bg-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onClose}>Apply</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function IntegrationTab() {
  const [search, setSearch] = useState("");
  const [providers, setProviders] = useState<LLMProvider[]>(INITIAL_PROVIDERS);
  const [selected, setSelected] = useState<LLMProvider | null>(null);

  const toggle = (id: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    );
    if (selected?.id === id) {
      setSelected((prev) => prev ? { ...prev, enabled: !prev.enabled } : null);
    }
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
            className="flex flex-col rounded-lg border border-bg-1 bg-white p-4 cursor-pointer hover:border-slate-300 transition-colors"
            onClick={() => setSelected(provider)}
          >
            {/* Header: icon + name + toggle */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {provider.icon}
                <span className="text-[14px] font-medium text-black">{provider.name}</span>
              </div>
              <Switch
                checked={provider.enabled}
                onCheckedChange={() => toggle(provider.id)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Description */}
            <p className="text-[12px] text-slate-500 mb-4 flex-1">{provider.description}</p>

            {/* Settings link */}
            <div className="flex justify-end">
              <span className="text-[13px] font-medium text-primary-5">Settings</span>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-4 py-12 text-center text-sm text-slate-400">
            No integrations match your search.
          </div>
        )}
      </div>

      {/* Settings dialog */}
      {selected && (
        <ProviderSettingsDialog
          provider={providers.find((p) => p.id === selected.id) ?? selected}
          onClose={() => setSelected(null)}
          onToggle={() => toggle(selected.id)}
        />
      )}
    </div>
  );
}