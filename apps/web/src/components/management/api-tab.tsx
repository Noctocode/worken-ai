"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Copy,
  MoreVertical,
  Link2,
  Trash2,
  AlertTriangle,
  Loader2,
  Eye,
  EyeOff,
  Check,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchApiKeys,
  mintApiKey,
  revokeApiKey,
  type ApiKeySummary,
  type MintedApiKey,
} from "@/lib/api";
import { useAuth } from "@/components/providers";
import { DisabledReasonTooltip } from "@/components/ui/tooltip";
import { useLanguage } from "@/lib/i18n";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Display form when the plaintext is no longer available — `sk-wai-…xyz9`. */
function maskedKey(prefix: string): string {
  return `sk-wai-…${prefix}`;
}

export function ApiTab() {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [linkName, setLinkName] = useState("");
  const [revealed, setRevealed] = useState<MintedApiKey | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKeySummary | null>(
    null,
  );
  const [copyToast, setCopyToast] = useState<string | null>(null);

  const keysQuery = useQuery<ApiKeySummary[]>({
    queryKey: ["api-keys"],
    queryFn: fetchApiKeys,
  });

  const mintMutation = useMutation({
    mutationFn: (name: string) => mintApiKey(name),
    onSuccess: (minted) => {
      setRevealed(minted);
      setLinkName("");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => {
      setConfirmRevoke(null);
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const handleGenerate = () => {
    const trimmed = linkName.trim();
    if (!trimmed || mintMutation.isPending) return;
    mintMutation.mutate(trimmed);
  };

  const handleCopy = async (text: string, toastKey: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyToast(toastKey);
    } catch {
      // Clipboard API rejects in insecure contexts (HTTP origins, sandboxed
      // iframes) — surface a fallback so the user sees the click registered.
      setCopyToast(`${toastKey}:err`);
    }
  };

  useEffect(() => {
    if (!copyToast) return;
    const t = setTimeout(() => setCopyToast(null), 1500);
    return () => clearTimeout(t);
  }, [copyToast]);

  const keys = keysQuery.data ?? [];

  // Page API keys — usually a small set (<20) so the Pagination
  // component auto-hides on a single page, but power users can have
  // many keys and the picker is the cheapest way to keep the table
  // bounded.
  const KEYS_PAGE_SIZE = 10;
  const [keysPage, setKeysPage] = useState(1);
  const keysTotalPages = Math.max(1, Math.ceil(keys.length / KEYS_PAGE_SIZE));
  const pagedKeys = keys.slice(
    (keysPage - 1) * KEYS_PAGE_SIZE,
    keysPage * KEYS_PAGE_SIZE,
  );
  useEffect(() => {
    if (keysPage > keysTotalPages) setKeysPage(keysTotalPages);
  }, [keysPage, keysTotalPages]);

  return (
    <div className="py-5">
      <div className="flex items-center justify-between mb-5">
        <span className="text-[18px] font-bold text-black-900">{t("mgmt.api.title")}</span>
        <Link
          href="/docs/api"
          className="text-[13px] text-primary-5 hover:underline"
        >
          {t("mgmt.api.documentation")}
        </Link>
      </div>

      <div className="bg-bg-white rounded-lg border border-bg-1 px-4 sm:px-6 py-5 mb-5">
        <p className="text-[14px] font-semibold text-text-1 mb-1">
          {t("mgmt.api.generateLink")}
        </p>
        <p className="text-[12px] text-text-3 mb-3">
          {t("mgmt.api.generateDescPrefix")}
          <strong>{t("mgmt.api.generateDescBold")}</strong>
          {t("mgmt.api.generateDescSuffix")}
        </p>
        <p className="text-[12px] text-text-2 mb-1">{t("mgmt.api.linkName")}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            placeholder={t("mgmt.api.linkNamePlaceholder")}
            value={linkName}
            onChange={(e) => setLinkName(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && isAdmin && handleGenerate()
            }
            className="flex-1"
            disabled={mintMutation.isPending || !isAdmin}
            maxLength={80}
            title={isAdmin ? undefined : t("mgmt.api.adminOnly")}
          />
          {isAdmin ? (
            <Button
              onClick={handleGenerate}
              disabled={!linkName.trim() || mintMutation.isPending}
              className="shrink-0 gap-2 bg-primary-6 hover:bg-primary-6/90 text-white w-full sm:w-auto"
            >
              {mintMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              {t("mgmt.api.generateButton")}
            </Button>
          ) : (
            <DisabledReasonTooltip
              disabled
              reason={t("mgmt.api.adminOnly")}
              className="w-full sm:w-auto"
            >
              <Button
                disabled
                className="shrink-0 gap-2 bg-primary-6 text-white w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Link2 className="h-4 w-4" />
                {t("mgmt.api.generateButton")}
              </Button>
            </DisabledReasonTooltip>
          )}
        </div>
        {mintMutation.isError && (
          <p className="mt-2 text-[12px] text-danger-6">
            {mintMutation.error instanceof Error
              ? mintMutation.error.message
              : t("mgmt.api.failedMint")}
          </p>
        )}
      </div>

      <div className="bg-bg-white rounded-lg border border-bg-1 overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-bg-1">
          <p className="text-[14px] font-semibold text-text-1">{t("mgmt.api.myKeys")}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[580px]">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 sm:px-6 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("mgmt.api.colName")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("mgmt.api.colLink")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("mgmt.api.colCreated")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("mgmt.api.colLastUsed")}
                </th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">
                  {t("mgmt.api.colAction")}
                </th>
              </tr>
            </thead>
            <tbody>
              {keysQuery.isLoading && (
                <tr>
                  <td colSpan={5} className="py-12 text-center">
                    <Loader2 className="h-6 w-6 animate-spin text-text-3 mx-auto" />
                  </td>
                </tr>
              )}
              {keysQuery.isError && !keysQuery.isLoading && (
                <tr>
                  <td
                    colSpan={5}
                    className="py-12 text-center text-sm text-danger-6"
                  >
                    {t("mgmt.api.failedLoad")}
                  </td>
                </tr>
              )}
              {!keysQuery.isLoading &&
                !keysQuery.isError &&
                keys.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-12 text-center text-sm text-text-3"
                    >
                      {t("mgmt.api.noKeys")}
                    </td>
                  </tr>
                )}
              {pagedKeys.map((key) => (
                <tr
                  key={key.id}
                  className="h-14 border-b border-bg-1 last:border-0 transition-colors hover:bg-bg-1/50"
                >
                  <td className="px-4 sm:px-6 align-middle text-[13px] font-medium text-text-1 whitespace-nowrap">
                    {key.name}
                  </td>
                  <td className="px-4 align-middle">
                    <span className="text-[13px] text-text-3 whitespace-nowrap font-mono">
                      {maskedKey(key.prefix)}
                    </span>
                  </td>
                  <td className="px-4 align-middle text-[13px] text-text-1 whitespace-nowrap">
                    {formatDate(key.createdAt)}
                  </td>
                  <td className="px-4 align-middle text-[13px] text-text-1 whitespace-nowrap">
                    {formatDate(key.lastUsedAt)}
                  </td>
                  <td className="px-4 align-middle text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-text-3 hover:text-text-1"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="gap-2 text-danger-6 focus:text-danger-6"
                          onClick={() => setConfirmRevoke(key)}
                          disabled={!isAdmin}
                          title={
                            isAdmin ? undefined : t("mgmt.api.revokeAdminOnly")
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                          {t("mgmt.api.revoke")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={keysPage}
            totalPages={keysTotalPages}
            onPageChange={setKeysPage}
            className="px-4"
          />
        </div>
      </div>

      {/* One-time reveal modal — plaintext is only visible right after mint.
          mintMutation.reset() also wipes the plaintext from React Query's
          mutation cache so it can't be inspected via devtools after close. */}
      <RevealDialog
        minted={revealed}
        copyToast={copyToast}
        onCopy={(text) => handleCopy(text, "minted")}
        onClose={() => {
          setRevealed(null);
          mintMutation.reset();
        }}
      />

      {/* Revoke confirm */}
      <Dialog
        open={!!confirmRevoke}
        onOpenChange={(open) => !open && setConfirmRevoke(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-danger-6" />
              {t("mgmt.api.revokeTitle")}
            </DialogTitle>
            <DialogDescription>
              {confirmRevoke?.name
                ? `“${confirmRevoke.name}” ${t("mgmt.api.revokeDescNamed")}`
                : t("mgmt.api.revokeDescUnnamed")}{" "}
              {t("mgmt.api.revokeDescSuffix")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmRevoke(null)}
              disabled={revokeMutation.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              className="bg-danger-6 hover:bg-danger-6/90 text-white"
              onClick={() =>
                confirmRevoke && revokeMutation.mutate(confirmRevoke.id)
              }
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              {t("mgmt.api.revoke")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RevealDialog({
  minted,
  copyToast,
  onCopy,
  onClose,
}: {
  minted: MintedApiKey | null;
  copyToast: string | null;
  onCopy: (text: string) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [show, setShow] = useState(false);
  // Reset visibility when the dialog opens so the next key isn't pre-revealed.
  useEffect(() => {
    if (minted) setShow(false);
  }, [minted]);

  if (!minted) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("mgmt.api.saveYourKey")}</DialogTitle>
          <DialogDescription>
            {t("mgmt.api.saveDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-bg-1 bg-bg-1/40 p-3">
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all font-mono text-[12px] text-text-1">
              {show ? minted.plaintext : `sk-wai-${"•".repeat(20)}`}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => setShow((v) => !v)}
              title={show ? t("mgmt.api.hide") : t("mgmt.api.reveal")}
            >
              {show ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => onCopy(minted.plaintext)}
              title={t("mgmt.api.copy")}
            >
              {copyToast === "minted" ? (
                <Check className="h-4 w-4 text-success-7" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          {copyToast === "minted:err" ? (
            <p className="mt-2 text-[11px] text-danger-6">
              {t("mgmt.api.copyFailed")}
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-text-3">
              {t("mgmt.api.usedAsPrefix")}
              <code>Authorization: Bearer &lt;key&gt;</code>
              {t("mgmt.api.usedAsSuffix")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t("mgmt.api.savedIt")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
