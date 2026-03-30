"use client";

import { useState } from "react";
import { BookOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Switch } from "@/components/ui/switch";
import { SettingsDialog } from "@/components/settings-dialog";

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
      <path
        d="M12 2C12 2 7 7 7 12C7 17 12 22 12 22C12 22 17 17 17 12C17 7 12 2 12 2Z"
        fill="url(#gemini-grad)"
      />
      <path
        d="M2 12C2 12 7 7 12 7C17 7 22 12 22 12C22 12 17 17 12 17C7 17 2 12 2 12Z"
        fill="url(#gemini-grad)"
        opacity="0.6"
      />
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
    <SettingsDialog
      open
      onClose={onClose}
      title={provider.name}
      description={`Configure ${provider.name} integration settings.`}
      headerIcon={provider.icon}
      headerContent={
        <Switch checked={provider.enabled} onCheckedChange={onToggle} />
      }
    >
      <div className="space-y-5">
        {/* Stats row */}
        <div className="flex items-start gap-8">
          <div>
            <p className="text-[16px] font-normal text-text-1 mb-0.5">Success rate:</p>
            <p className="text-[18px] font-bold text-text-1">{provider.successRate}%</p>
          </div>
          <div>
            <p className="text-[16px] font-normal text-text-1 mb-0.5">API calls:</p>
            <p className="text-[18px] font-bold text-text-1">{provider.apiCalls}</p>
          </div>
          <div>
            <p className="text-[16px] font-normal text-text-1 mb-0.5">Rate limit:</p>
            <p className="text-[18px] font-bold text-text-1">
              {provider.rateLimit}
              <span className="text-[13px] font-normal text-text-3 ml-2">requests/day</span>
            </p>
          </div>
        </div>

        {/* WorkenAI API */}
        <div>
          <p className="text-[14px] font-normal leading-[20px] text-text-2 mb-1.5">Use WORKENAI API</p>
          <textarea
            readOnly
            className="w-full rounded-lg bg-bg-3 px-[17px] py-[13px] text-[16px] leading-[24px] text-text-1 resize-none outline-none"
            rows={1}
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
              className="h-3.5 w-3.5 rounded-[5px] border border-border-4 accent-success-7"
            />
            <span className="text-[14px] font-normal leading-[20px] text-text-2">Use your own API KEY</span>
          </label>
          {useOwnKey && (
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
              className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[16px] leading-[24px] text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
            />
          )}
          {!useOwnKey && (
            <input
              type="text"
              readOnly
              value="12er1te2r1sa3df1ó5a5s1fd5ad5as"
              className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[16px] leading-[24px] text-text-1 outline-none"
            />
          )}
        </div>

        <p className="text-[16px] font-normal leading-[24px] text-text-1">
          API calls will incur a small Technology fee
        </p>
      </div>
    </SettingsDialog>
  );
}

function AddCustomLLMDialog({ onClose }: { onClose: () => void }) {
  const [apiLink, setApiLink] = useState("");

  return (
    <SettingsDialog open onClose={onClose} title="Add Custom LLM">
      <div className="space-y-4">
        <div>
          <p className="text-[14px] font-normal text-text-2 mb-1.5">API Link</p>
          <input
            type="text"
            value={apiLink}
            onChange={(e) => setApiLink(e.target.value)}
            placeholder="Put link here"
            className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[13px] text-black placeholder:text-text-3 placeholder:text-[13px] placeholder:font-normal outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
          />
        </div>
        <button className="inline-flex h-[48px] items-center gap-2 rounded-md border border-border-2 px-4 text-[16px] font-normal text-text-1 hover:bg-slate-50 transition-colors">
          <BookOpen className="h-4 w-4 text-success-7" />
          Integration documentation
        </button>
      </div>
    </SettingsDialog>
  );
}

export function IntegrationTab() {
  const [search, setSearch] = useState("");
  const [providers, setProviders] = useState<LLMProvider[]>(INITIAL_PROVIDERS);
  const [selected, setSelected] = useState<LLMProvider | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);

  const toggle = (id: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    );
    if (selected?.id === id) {
      setSelected((prev) => (prev ? { ...prev, enabled: !prev.enabled } : null));
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
        <Button variant="plusAction" onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 text-black-900" />
          Add Custom LLM
        </Button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filtered.map((provider) => (
          <div
            key={provider.id}
            className="flex flex-col rounded-[4px] border border-border-3 bg-white p-5 h-[165px] cursor-pointer hover:border-border-4 transition-colors"
            onClick={() => setSelected(provider)}
          >
            {/* Header: icon + name + toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {provider.icon}
                <span className="text-[16px] font-normal text-text-1">{provider.name}</span>
              </div>
              <Switch
                checked={provider.enabled}
                onCheckedChange={() => toggle(provider.id)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Description */}
            <p className="mt-3 text-[16px] font-normal text-text-2">{provider.description}</p>

            {/* Settings link */}
            <div className="mt-auto flex justify-end">
              <span className="text-[14px] font-normal text-text-3">Settings</span>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-sm text-slate-400">
            No integrations match your search.
          </div>
        )}
      </div>

      {/* Provider settings dialog */}
      {selected && (
        <ProviderSettingsDialog
          provider={providers.find((p) => p.id === selected.id) ?? selected}
          onClose={() => setSelected(null)}
          onToggle={() => toggle(selected.id)}
        />
      )}

      {/* Add custom LLM dialog */}
      {showAddDialog && (
        <AddCustomLLMDialog onClose={() => setShowAddDialog(false)} />
      )}
    </div>
  );
}