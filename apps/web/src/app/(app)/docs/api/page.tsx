"use client";

import Link from "next/link";
import { useState } from "react";
import {
  KeyRound,
  Terminal,
  ShieldAlert,
  ListOrdered,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations/en";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function CodeBlock({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Insecure context (no clipboard API). Fail silently — user can
      // still triple-click to select.
    }
  };
  return (
    <div className="relative group">
      <pre className="overflow-x-auto rounded-md border border-bg-1 bg-[#0F172A] p-4 text-[12px] leading-[1.6] text-slate-100 font-mono">
        {language && (
          <span className="absolute top-2 right-12 text-[10px] uppercase tracking-wide text-slate-500">
            {language}
          </span>
        )}
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-100"
        title={t("apiDocs.copy")}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-success-7" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

function Endpoint({
  method,
  path,
  summary,
  description,
  example,
}: {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  summary: string;
  description?: string;
  example?: string;
}) {
  const methodColor: Record<string, string> = {
    GET: "bg-primary-1 text-primary-7",
    POST: "bg-success-7/15 text-success-7",
    PATCH: "bg-warning-1 text-warning-7",
    PUT: "bg-warning-1 text-warning-7",
    DELETE: "bg-danger-1 text-danger-6",
  };
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-bg-1 bg-bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            methodColor[method] ?? "bg-bg-1 text-text-2"
          }`}
        >
          {method}
        </span>
        <code className="text-[13px] font-mono text-text-1">{path}</code>
      </div>
      <p className="text-[13px] text-text-1">{summary}</p>
      {description && (
        <p className="text-[12px] text-text-3 leading-relaxed">{description}</p>
      )}
      {example && <CodeBlock code={example} language="bash" />}
    </div>
  );
}

function Section({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="flex flex-col gap-4 scroll-mt-20">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-bg-1">
          <Icon className="h-4 w-4 text-primary-7" strokeWidth={2} />
        </div>
        <h2 className="text-[18px] font-bold text-text-1">{title}</h2>
      </div>
      {children}
    </section>
  );
}

const TOC: { id: string; labelKey: TranslationKey }[] = [
  { id: "introduction", labelKey: "apiDocs.introduction" },
  { id: "authentication", labelKey: "apiDocs.authentication" },
  { id: "quickstart", labelKey: "apiDocs.quickstart" },
  { id: "endpoints", labelKey: "apiDocs.endpoints" },
  { id: "errors", labelKey: "apiDocs.errors" },
  { id: "revoking", labelKey: "apiDocs.revoking" },
];

export default function ApiDocsPage() {
  const { t } = useLanguage();
  const exampleCurl = `curl ${BASE_URL}/auth/me \\
  -H "Authorization: Bearer sk-wai-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"`;

  const exampleChat = `curl ${BASE_URL}/chat \\
  -H "Authorization: Bearer sk-wai-XXXX..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "conversationId": "<existing conversation uuid>",
    "content": "Summarize this PR in one sentence.",
    "model": "anthropic/claude-3.5-sonnet"
  }'`;

  const exampleNewConvo = `curl -X POST ${BASE_URL}/projects/<projectId>/conversations \\
  -H "Authorization: Bearer sk-wai-XXXX..."`;

  return (
    <div className="flex gap-8 py-6">
      {/* Sidebar TOC */}
      <aside className="hidden lg:block w-56 shrink-0">
        <div className="sticky top-6 flex flex-col gap-1">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">
            {t("apiDocs.onThisPage")}
          </p>
          {TOC.map((entry) => (
            <a
              key={entry.id}
              href={`#${entry.id}`}
              className="rounded px-2 py-1.5 text-[13px] text-text-2 transition-colors hover:bg-bg-1 hover:text-text-1"
            >
              {t(entry.labelKey)}
            </a>
          ))}
          <div className="mt-3 border-t border-bg-1 pt-3">
            <Link
              href="/teams?tab=api"
              className="inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-[13px] text-primary-6 hover:underline"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {t("apiDocs.manageKeys")}
            </Link>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col gap-10 max-w-3xl">
        <Section id="introduction" title={t("apiDocs.introduction")} icon={Terminal}>
          <p className="text-[14px] leading-relaxed text-text-1">
            {t("apiDocs.introPara1")}
          </p>
          <p className="text-[14px] leading-relaxed text-text-1">
            {t("apiDocs.introPara2")}
          </p>
          <div className="rounded-md border border-warning-7/30 bg-warning-1 p-4">
            <p className="text-[12px] leading-relaxed text-text-1">
              <strong>{t("apiDocs.headsUpBold")}</strong> {t("apiDocs.headsUp")}
            </p>
          </div>
        </Section>

        <Section id="authentication" title={t("apiDocs.authentication")} icon={KeyRound}>
          <p className="text-[14px] leading-relaxed text-text-1">
            {t("apiDocs.authPara1Pre")} <code className="rounded bg-bg-1 px-1 py-0.5 text-[12px] font-mono">sk-wai-&lt;32 chars&gt;</code>{" "}
            {t("apiDocs.authPara1Mid")}{" "}
            <Link
              href="/teams?tab=api"
              className="text-primary-6 hover:underline"
            >
              {t("apiDocs.authMgmtApi")}
            </Link>
            {t("apiDocs.authPara1Post")}{" "}
            <code className="rounded bg-bg-1 px-1 py-0.5 text-[12px] font-mono">Authorization</code>{" "}
            {t("apiDocs.authPara1End")}
          </p>
          <CodeBlock code={exampleCurl} language="bash" />
          <p className="text-[12px] text-text-3">
            {t("apiDocs.authPara2Pre")}{" "}
            <code className="rounded bg-bg-1 px-1 py-0.5 text-[11px] font-mono">last_used_at</code>{" "}
            {t("apiDocs.authPara2End")}
          </p>
        </Section>

        <Section id="quickstart" title={t("apiDocs.quickstartTitle")} icon={Terminal}>
          <p className="text-[14px] leading-relaxed text-text-1">
            {t("apiDocs.quickstartPara")}
          </p>
          <ol className="flex flex-col gap-2 pl-5 text-[13px] text-text-1 list-decimal">
            <li>
              {t("apiDocs.step1Pre")}{" "}
              <code className="rounded bg-bg-1 px-1 py-0.5 text-[11px] font-mono">GET /projects</code>.
            </li>
            <li>
              {t("apiDocs.step2Pre")}{" "}
              <code className="rounded bg-bg-1 px-1 py-0.5 text-[11px] font-mono">
                POST /projects/&lt;projectId&gt;/conversations
              </code>
              .
            </li>
            <li>
              {t("apiDocs.step3Pre")}{" "}
              <code className="rounded bg-bg-1 px-1 py-0.5 text-[11px] font-mono">POST /chat</code>.
            </li>
          </ol>
          <CodeBlock code={exampleNewConvo} language="bash" />
          <CodeBlock code={exampleChat} language="bash" />
          <p className="text-[12px] text-text-3 leading-relaxed">
            {t("apiDocs.quickResp1")}{" "}
            <code className="rounded bg-bg-1 px-1 py-0.5 text-[11px] font-mono">conversationId</code>{" "}
            {t("apiDocs.quickResp2")}
          </p>
        </Section>

        <Section id="endpoints" title={t("apiDocs.endpoints")} icon={ListOrdered}>
          <p className="text-[14px] leading-relaxed text-text-1">
            {t("apiDocs.endpointsPara")}
          </p>

          <div className="flex flex-col gap-3">
            <h3 className="mt-2 text-[13px] font-semibold uppercase tracking-wide text-text-3">
              {t("apiDocs.profile")}
            </h3>
            <Endpoint
              method="GET"
              path="/auth/me"
              summary="Returns the authenticated user's profile."
              description="Use as a smoke test that your token is valid. The response includes id, email, role, and onboarding state."
            />

            <h3 className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-text-3">
              {t("apiDocs.models")}
            </h3>
            <Endpoint
              method="GET"
              path="/models/effective"
              summary="Lists models the authenticated user can call."
              description="Combines the org's enabled catalog with the user's BYOK integrations. Use the returned slugs as the `model` field on /chat."
            />

            <h3 className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-text-3">
              {t("apiDocs.projectsConvos")}
            </h3>
            <Endpoint
              method="GET"
              path="/projects"
              summary="Lists projects the authenticated user can access."
            />
            <Endpoint
              method="POST"
              path="/projects/:projectId/conversations"
              summary="Creates a new conversation in a project."
              description="No body required. Returns the new conversation with an empty message list and an auto-generated title that you can rename later from the UI."
            />
            <Endpoint
              method="GET"
              path="/projects/:projectId/conversations"
              summary="Lists conversations under a project."
            />
            <Endpoint
              method="GET"
              path="/conversations/:id"
              summary="Returns a conversation with its full message history."
            />
            <Endpoint
              method="DELETE"
              path="/conversations/:id"
              summary="Deletes a conversation and all its messages."
            />

            <h3 className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-text-3">
              {t("apiDocs.chat")}
            </h3>
            <Endpoint
              method="POST"
              path="/chat"
              summary="Sends a user message to the model and returns the assistant's reply."
              description='Body: { conversationId, content, model?, projectId?, enableReasoning? }. The conversation must already exist. Routes through your BYOK provider if /models/effective marks the model as BYOK; otherwise routes through the WorkenAI default under your team budget.'
            />

            <h3 className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-text-3">
              {t("apiDocs.integrations")}
            </h3>
            <Endpoint
              method="GET"
              path="/integrations"
              summary="Lists your predefined provider cards plus any custom LLM endpoints."
            />
            <Endpoint
              method="POST"
              path="/integrations"
              summary="Upserts a BYOK key on a predefined provider, or creates a custom LLM."
              description="Body: { providerId, apiKey?, apiUrl?, isEnabled? }. The submitted key is encrypted before storage."
            />

            <h3 className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-text-3">
              {t("apiDocs.apiKeyMgmt")}
            </h3>
            <Endpoint
              method="GET"
              path="/api-keys"
              summary="Lists your active API keys (metadata only — plaintext is never returned)."
            />
            <Endpoint
              method="POST"
              path="/api-keys"
              summary="Mints a new API key. The plaintext is included once in the response — store it now."
              description="Body: { name: string }. Useful for rotating credentials from an automation rather than the UI."
            />
            <Endpoint
              method="DELETE"
              path="/api-keys/:id"
              summary="Soft-revokes a key. The token immediately stops authenticating."
            />
          </div>
        </Section>

        <Section id="errors" title={t("apiDocs.errors")} icon={ShieldAlert}>
          <p className="text-[14px] leading-relaxed text-text-1">
            {t("apiDocs.errorsPara")}{" "}
            <code className="rounded bg-bg-1 px-1 py-0.5 text-[11px] font-mono">
              {`{ "statusCode": …, "message": "…" }`}
            </code>
            .
          </p>
          <ul className="flex flex-col gap-2.5 text-[13px] text-text-1">
            <li>
              <strong className="font-mono text-[12px] text-danger-6">401</strong>{" "}
              <span className="text-text-2">{t("apiDocs.err401")}</span>
            </li>
            <li>
              <strong className="font-mono text-[12px] text-warning-7">402</strong>{" "}
              <span className="text-text-2">{t("apiDocs.err402")}</span>
            </li>
            <li>
              <strong className="font-mono text-[12px] text-danger-6">404</strong>{" "}
              <span className="text-text-2">{t("apiDocs.err404")}</span>
            </li>
            <li>
              <strong className="font-mono text-[12px] text-warning-7">422</strong>{" "}
              <span className="text-text-2">
                {t("apiDocs.err422Pre")}{" "}
                <code className="rounded bg-bg-1 px-1 py-0.5 text-[11px] font-mono">message</code>{" "}
                {t("apiDocs.err422Post")}
              </span>
            </li>
            <li>
              <strong className="font-mono text-[12px] text-danger-6">5xx</strong>{" "}
              <span className="text-text-2">{t("apiDocs.err5xx")}</span>
            </li>
          </ul>
        </Section>

        <Section id="revoking" title={t("apiDocs.revoking")} icon={ShieldAlert}>
          <p className="text-[14px] leading-relaxed text-text-1">
            {t("apiDocs.revokingPara1Pre")}{" "}
            <Link
              href="/teams?tab=api"
              className="inline-flex items-center gap-1 text-primary-6 hover:underline"
            >
              {t("apiDocs.authMgmtApi")}
              <ExternalLink className="h-3 w-3" />
            </Link>
            {t("apiDocs.revokingPara1Post")}
          </p>
          <p className="text-[14px] leading-relaxed text-text-1">
            {t("apiDocs.revokingPara2")}
          </p>
        </Section>
      </div>
    </div>
  );
}
