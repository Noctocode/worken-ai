"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Wrench, Search } from "lucide-react";
import { useAuth } from "@/components/providers";
import { useLanguage } from "@/lib/i18n";
import {
  fetchTools,
  createTool,
  updateTool,
  deleteTool,
  type AiTool,
  type AiToolInput,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ToolsTab() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();

  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AiTool | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AiTool | null>(null);

  const { data: tools = [], isLoading } = useQuery({
    queryKey: ["tools"],
    queryFn: fetchTools,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter((tool) =>
      `${tool.displayName} ${tool.name} ${tool.description}`
        .toLowerCase()
        .includes(q),
    );
  }, [tools, query]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTool(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tools"] });
      toast.success(t("tools.toast.deleted"));
      setConfirmDelete(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (tool: AiTool) => {
    setEditing(tool);
    setDialogOpen(true);
  };

  return (
    <div className="py-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-[16px] font-semibold text-black-900 lg:text-[18px] lg:font-bold">
            {t("tools.title")}
          </h3>
          <p className="mt-1 max-w-2xl text-[13px] text-text-3">
            {t("tools.desc")}
          </p>
          <p className="mt-1 max-w-2xl text-[12px] text-text-3">
            {t("tools.registryNote")}
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={openCreate}
            className="mt-3 shrink-0 cursor-pointer bg-primary-6 hover:bg-primary-7 sm:mt-0"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t("tools.add")}
          </Button>
        )}
      </div>

      <div className="relative mt-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("tools.search")}
          className="pl-9"
        />
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {isLoading ? null : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-2 py-12 text-center">
            <Wrench className="h-7 w-7 text-text-3" strokeWidth={1.5} />
            <p className="text-[13px] text-text-2">{t("tools.empty")}</p>
            <p className="text-[12px] text-text-3">
              {isAdmin ? t("tools.emptyAdmin") : t("tools.readOnlyNote")}
            </p>
          </div>
        ) : (
          filtered.map((tool) => (
            <div
              key={tool.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border-2 bg-bg-white p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-text-1">
                    {tool.displayName}
                  </span>
                  <code className="rounded bg-bg-1 px-1.5 py-0.5 text-[11px] text-text-2">
                    {tool.name}
                  </code>
                  <Badge variant={tool.isEnabled ? "default" : "secondary"}>
                    {tool.isEnabled ? t("tools.enabled") : t("tools.disabled")}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-[13px] text-text-2">
                  {tool.description}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-3">
                  <span className="font-medium">{tool.httpMethod}</span>
                  <span className="truncate">{hostOf(tool.urlTemplate)}</span>
                  <span>
                    {tool.hasApiKey ? t("tools.keySet") : t("tools.noKey")}
                  </span>
                  <span>
                    {tool.visibility === "admins"
                      ? t("tools.vis.admins")
                      : t("tools.vis.all")}
                  </span>
                </div>
              </div>
              {isAdmin && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="cursor-pointer"
                    onClick={() => openEdit(tool)}
                    title={t("tools.edit")}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="cursor-pointer text-danger-6 hover:text-danger-7"
                    onClick={() => setConfirmDelete(tool)}
                    title={t("tools.delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Conditionally mounted → fresh form state on every open. */}
      {dialogOpen && (
        <ToolFormDialog
          tool={editing}
          onClose={() => setDialogOpen(false)}
        />
      )}

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("tools.confirmDeleteTitle")}</DialogTitle>
            <DialogDescription>{t("tools.confirmDelete")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="cursor-pointer"
              onClick={() => setConfirmDelete(null)}
            >
              {t("tools.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="cursor-pointer"
              disabled={deleteMutation.isPending}
              onClick={() =>
                confirmDelete && deleteMutation.mutate(confirmDelete.id)
              }
            >
              {deleteMutation.isPending
                ? t("tools.deleting")
                : t("tools.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const PRETTY = (v: unknown) => JSON.stringify(v ?? {}, null, 2);

function ToolFormDialog({
  tool,
  onClose,
}: {
  tool: AiTool | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const isEdit = !!tool;

  const [displayName, setDisplayName] = useState(tool?.displayName ?? "");
  const [name, setName] = useState(tool?.name ?? "");
  const [description, setDescription] = useState(tool?.description ?? "");
  const [httpMethod, setHttpMethod] = useState(tool?.httpMethod ?? "GET");
  const [urlTemplate, setUrlTemplate] = useState(tool?.urlTemplate ?? "");
  const [visibility, setVisibility] = useState(tool?.visibility ?? "all");
  const [authType, setAuthType] = useState(tool?.authType ?? "none");
  const [authParamName, setAuthParamName] = useState(tool?.authParamName ?? "");
  const [apiKey, setApiKey] = useState("");
  const [responsePath, setResponsePath] = useState(tool?.responsePath ?? "");
  const [inputSchema, setInputSchema] = useState(PRETTY(tool?.inputSchema));
  const [headers, setHeaders] = useState(PRETTY(tool?.headersTemplate));
  const [queryT, setQueryT] = useState(PRETTY(tool?.queryTemplate));
  const [body, setBody] = useState(PRETTY(tool?.bodyTemplate));
  const [callLimit, setCallLimit] = useState(
    tool?.monthlyCallLimit != null ? String(tool.monthlyCallLimit) : "",
  );
  const [timeoutMs, setTimeoutMs] = useState(String(tool?.timeoutMs ?? 8000));
  const [isEnabled, setIsEnabled] = useState(tool?.isEnabled ?? true);

  const needsParam = authType === "api_key_header" || authType === "api_key_query";

  const mutation = useMutation({
    mutationFn: (input: AiToolInput) =>
      isEdit ? updateTool(tool!.id, input) : createTool(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tools"] });
      toast.success(isEdit ? t("tools.toast.updated") : t("tools.toast.created"));
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const parseJson = (raw: string): Record<string, unknown> | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      const v = JSON.parse(trimmed);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return v as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
    return undefined;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedSchema = parseJson(inputSchema);
    const parsedHeaders = parseJson(headers);
    const parsedQuery = parseJson(queryT);
    const parsedBody = parseJson(body);
    if (!parsedSchema || !parsedHeaders || !parsedQuery || !parsedBody) {
      toast.error(t("tools.toast.invalidJson"));
      return;
    }

    const input: AiToolInput = {
      name: name.trim(),
      displayName: displayName.trim(),
      description: description.trim(),
      inputSchema: parsedSchema,
      httpMethod,
      urlTemplate: urlTemplate.trim(),
      headersTemplate: parsedHeaders as Record<string, string>,
      queryTemplate: parsedQuery as Record<string, string>,
      bodyTemplate: parsedBody,
      authType,
      authParamName: needsParam ? authParamName.trim() || null : null,
      responsePath: responsePath.trim() || null,
      visibility,
      isEnabled,
      monthlyCallLimit: callLimit.trim() ? Number(callLimit) : null,
      timeoutMs: Number(timeoutMs) || 8000,
    };
    // Only send the key when the admin actually typed one (write-only).
    if (apiKey.trim()) input.apiKey = apiKey.trim();
    mutation.mutate(input);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("tools.editTitle") : t("tools.createTitle")}
          </DialogTitle>
          <DialogDescription>{t("tools.dialogDesc")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tool-displayName">
                {t("tools.field.displayName")}
              </Label>
              <Input
                id="tool-displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t("tools.field.displayNamePh")}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tool-name">{t("tools.field.name")}</Label>
              <Input
                id="tool-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("tools.field.namePh")}
                required
              />
              <p className="text-[12px] text-text-3">
                {t("tools.field.nameHint")}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tool-description">
              {t("tools.field.description")}
            </Label>
            <Textarea
              id="tool-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("tools.field.descriptionPh")}
              rows={2}
              required
            />
            <p className="text-[12px] text-text-3">
              {t("tools.field.descriptionHint")}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[120px_1fr]">
            <div className="space-y-2">
              <Label>{t("tools.field.method")}</Label>
              <Select value={httpMethod} onValueChange={setHttpMethod}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tool-url">{t("tools.field.url")}</Label>
              <Input
                id="tool-url"
                value={urlTemplate}
                onChange={(e) => setUrlTemplate(e.target.value)}
                placeholder={t("tools.field.urlPh")}
                required
              />
              <p className="text-[12px] text-text-3">
                {t("tools.field.urlHint")}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tool-schema">{t("tools.field.inputSchema")}</Label>
            <Textarea
              id="tool-schema"
              value={inputSchema}
              onChange={(e) => setInputSchema(e.target.value)}
              rows={5}
              className="font-mono text-[12px]"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tool-headers">{t("tools.field.headers")}</Label>
              <Textarea
                id="tool-headers"
                value={headers}
                onChange={(e) => setHeaders(e.target.value)}
                rows={3}
                className="font-mono text-[12px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tool-query">{t("tools.field.query")}</Label>
              <Textarea
                id="tool-query"
                value={queryT}
                onChange={(e) => setQueryT(e.target.value)}
                rows={3}
                className="font-mono text-[12px]"
              />
            </div>
          </div>

          {httpMethod === "POST" && (
            <div className="space-y-2">
              <Label htmlFor="tool-body">{t("tools.field.body")}</Label>
              <Textarea
                id="tool-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                className="font-mono text-[12px]"
              />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("tools.field.auth")}</Label>
              <Select value={authType} onValueChange={setAuthType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("tools.auth.none")}</SelectItem>
                  <SelectItem value="api_key_header">
                    {t("tools.auth.api_key_header")}
                  </SelectItem>
                  <SelectItem value="api_key_query">
                    {t("tools.auth.api_key_query")}
                  </SelectItem>
                  <SelectItem value="bearer">{t("tools.auth.bearer")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {needsParam && (
              <div className="space-y-2">
                <Label htmlFor="tool-authParam">
                  {t("tools.field.authParam")}
                </Label>
                <Input
                  id="tool-authParam"
                  value={authParamName}
                  onChange={(e) => setAuthParamName(e.target.value)}
                  placeholder={t("tools.field.authParamPh")}
                />
              </div>
            )}
          </div>

          {authType !== "none" && (
            <div className="space-y-2">
              <Label htmlFor="tool-apiKey">{t("tools.field.apiKey")}</Label>
              <Input
                id="tool-apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  isEdit && tool?.hasApiKey
                    ? t("tools.field.apiKeyKept")
                    : t("tools.field.apiKeyPh")
                }
                autoComplete="off"
              />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>{t("tools.field.visibility")}</Label>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("tools.vis.all")}</SelectItem>
                  <SelectItem value="admins">{t("tools.vis.admins")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tool-limit">{t("tools.field.callLimit")}</Label>
              <Input
                id="tool-limit"
                type="number"
                min="0"
                value={callLimit}
                onChange={(e) => setCallLimit(e.target.value)}
                placeholder={t("tools.field.callLimitPh")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tool-timeout">{t("tools.field.timeout")}</Label>
              <Input
                id="tool-timeout"
                type="number"
                min="1000"
                max="30000"
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tool-responsePath">
              {t("tools.field.responsePath")}
            </Label>
            <Input
              id="tool-responsePath"
              value={responsePath}
              onChange={(e) => setResponsePath(e.target.value)}
              placeholder={t("tools.field.responsePathPh")}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border-2 px-3 py-2">
            <Label htmlFor="tool-enabled" className="cursor-pointer">
              {t("tools.field.isEnabled")}
            </Label>
            <Switch
              id="tool-enabled"
              checked={isEnabled}
              onCheckedChange={setIsEnabled}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              onClick={onClose}
            >
              {t("tools.cancel")}
            </Button>
            <Button
              type="submit"
              className="cursor-pointer bg-primary-6 hover:bg-primary-7"
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? isEdit
                  ? t("tools.saving")
                  : t("tools.creating")
                : isEdit
                  ? t("tools.save")
                  : t("tools.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
