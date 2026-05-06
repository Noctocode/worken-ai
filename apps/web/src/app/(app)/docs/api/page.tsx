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

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function CodeBlock({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
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
        title="Copy"
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

const TOC = [
  { id: "introduction", label: "Introduction" },
  { id: "authentication", label: "Authentication" },
  { id: "quickstart", label: "Quick start" },
  { id: "endpoints", label: "Endpoints" },
  { id: "errors", label: "Errors" },
  { id: "revoking", label: "Revoking keys" },
];

export default function ApiDocsPage() {
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
            On this page
          </p>
          {TOC.map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              className="rounded px-2 py-1.5 text-[13px] text-text-2 transition-colors hover:bg-bg-1 hover:text-text-1"
            >
              {t.label}
            </a>
          ))}
          <div className="mt-3 border-t border-bg-1 pt-3">
            <Link
              href="/teams?tab=api"
              className="inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-[13px] text-primary-6 hover:underline"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Manage your keys
            </Link>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col gap-10 max-w-3xl">
        <Section id="introduction" title="Introduction" icon={Terminal}>
          <p className="text-[14px] leading-relaxed text-text-1">
            The WorkenAI REST API lets external systems — CI/CD pipelines,
            internal bots, mobile clients, automation scripts — call the same
            endpoints the WorkenAI app uses, without going through the browser
            login flow. You authenticate with a long-lived API token instead
            of a session cookie.
          </p>
          <p className="text-[14px] leading-relaxed text-text-1">
            All endpoints respect the same per-user budget, BYOK provider
            routing, and team-scoped permissions as the UI. A request made
            with an API token is indistinguishable on the backend from a
            request the token&apos;s owner makes from the app.
          </p>
          <div className="rounded-md border border-warning-7/30 bg-warning-1 p-4">
            <p className="text-[12px] leading-relaxed text-text-1">
              <strong>Heads up:</strong> API tokens currently inherit the
              owner&apos;s full set of permissions — there is no
              per-token scope or rate limit. Treat them as primary credentials
              and rotate them when an integration retires.
            </p>
          </div>
        </Section>

        <Section id="authentication" title="Authentication" icon={KeyRound}>
          <p className="text-[14px] leading-relaxed text-text-1">
            Tokens have the form <code className="rounded bg-bg-1 px-1 py-0.5 text-[12px] font-mono">sk-wai-&lt;32 chars&gt;</code>{" "}
            and are minted from{" "}
            <Link
              href="/teams?tab=api"
              className="text-primary-6 hover:underline"
            >
              Management → API
            </Link>
            . The plaintext is shown once at creation; only the SHA-256 hash
            is stored. Send the token in the standard{" "}
            <code className="rounded bg-bg-1 px-1 py-0.5 text-[12px] font-mono">Authorization</code>{" "}
            header:
          </p>
          <CodeBlock code={exampleCurl} language="bash" />
          <p className="text-[12px] text-text-3">
            A successful response returns the token owner&apos;s profile —
            useful as a smoke test that your token is wired up correctly.
            Every authenticated call updates the token&apos;s{" "}
            <code className="rounded bg-bg-1 px-1 py-0.5 text-[11px] font-mono">last_used_at</code>{" "}
            timestamp visible in the My Keys table.
          </p>
        </Section>

        <Section id="quickstart" title="Quick start: send a chat message" icon={Terminal}>
          <p className="text-[14px] leading-relaxed text-text-1">
            The chat endpoint is the most common reason to use the API. It
            requires an existing conversation, so the typical flow is:
            create a conversation under a project, then post messages to it.
          </p>
          <ol className="flex flex-col gap-2 pl-5 text-[13px] text-text-1 list-decimal">
            <li>
              Find a project you have access to with{" "}
              <code className="rounded bg-bg-1 px-1 py-0.5 text-[11px] font-mono">GET /projects</code>.
            </li>
            <li>
              Create a conversation under it with{" "}
              <code className="rounded bg-bg-1 px-1 py-0.5 text-[11px] font-mono">
                POST /projects/&lt;projectId&gt;/conversations
              </code>
              .
            </li>
            <li>
              Post a message to the conversation with{" "}
              <code className="rounded bg-bg-1 px-1 py-0.5 text-[11px] font-mono">POST /chat</code>.
            </li>
          </ol>
          <CodeBlock code={exampleNewConvo} language="bash" />
          <CodeBlock code={exampleChat} language="bash" />
          <p className="text-[12px] text-text-3 leading-relaxed">
            The response body contains the assistant message plus token usage
            and cost metadata. Subsequent messages on the same{" "}
            <code className="rounded bg-bg-1 px-1 py-0.5 text-[11px] font-mono">conversationId</code>{" "}
            preserve history, so the model sees the full thread.
          </p>
        </Section>

        <Section id="endpoints" title="Endpoints" icon={ListOrdered}>
          <p className="text-[14px] leading-relaxed text-text-1">
            The endpoints below are the subset designed for programmatic use.
            Other routes the UI calls are technically reachable with an API
            token but their shape may change without notice.
          </p>

          <div className="flex flex-col gap-3">
            <h3 className="mt-2 text-[13px] font-semibold uppercase tracking-wide text-text-3">
              Profile
            </h3>
            <Endpoint
              method="GET"
              path="/auth/me"
              summary="Returns the authenticated user's profile."
              description="Use as a smoke test that your token is valid. The response includes id, email, role, and onboarding state."
            />

            <h3 className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-text-3">
              Models
            </h3>
            <Endpoint
              method="GET"
              path="/models/effective"
              summary="Lists models the authenticated user can call."
              description="Combines the org's enabled catalog with the user's BYOK integrations. Use the returned slugs as the `model` field on /chat."
            />

            <h3 className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-text-3">
              Projects & conversations
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
              Chat
            </h3>
            <Endpoint
              method="POST"
              path="/chat"
              summary="Sends a user message to the model and returns the assistant's reply."
              description='Body: { conversationId, content, model?, projectId?, enableReasoning? }. The conversation must already exist. Routes through your BYOK provider if /models/effective marks the model as BYOK; otherwise routes through the WorkenAI default under your team budget.'
            />

            <h3 className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-text-3">
              Integrations (BYOK)
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
              API key management
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

        <Section id="errors" title="Errors" icon={ShieldAlert}>
          <p className="text-[14px] leading-relaxed text-text-1">
            The API uses standard HTTP status codes and returns JSON error
            bodies of the form{" "}
            <code className="rounded bg-bg-1 px-1 py-0.5 text-[11px] font-mono">
              {`{ "statusCode": …, "message": "…" }`}
            </code>
            .
          </p>
          <ul className="flex flex-col gap-2.5 text-[13px] text-text-1">
            <li>
              <strong className="font-mono text-[12px] text-danger-6">401</strong>{" "}
              <span className="text-text-2">
                — Token is missing, malformed, or revoked. Mint a new one.
              </span>
            </li>
            <li>
              <strong className="font-mono text-[12px] text-warning-7">402</strong>{" "}
              <span className="text-text-2">
                — Monthly budget exceeded for the user or team backing this
                token. Increase the budget or wait for the next cycle.
              </span>
            </li>
            <li>
              <strong className="font-mono text-[12px] text-danger-6">404</strong>{" "}
              <span className="text-text-2">
                — Resource (conversation, project, model) doesn&apos;t exist
                or you don&apos;t have access to it.
              </span>
            </li>
            <li>
              <strong className="font-mono text-[12px] text-warning-7">422</strong>{" "}
              <span className="text-text-2">
                — Validation error in the request body. The{" "}
                <code className="rounded bg-bg-1 px-1 py-0.5 text-[11px] font-mono">message</code>{" "}
                field describes which field is wrong.
              </span>
            </li>
            <li>
              <strong className="font-mono text-[12px] text-danger-6">5xx</strong>{" "}
              <span className="text-text-2">
                — Upstream provider (Anthropic, OpenAI, etc.) error or
                internal failure. Safe to retry with backoff.
              </span>
            </li>
          </ul>
        </Section>

        <Section id="revoking" title="Revoking keys" icon={ShieldAlert}>
          <p className="text-[14px] leading-relaxed text-text-1">
            If a token leaks, revoke it immediately from{" "}
            <Link
              href="/teams?tab=api"
              className="inline-flex items-center gap-1 text-primary-6 hover:underline"
            >
              Management → API
              <ExternalLink className="h-3 w-3" />
            </Link>
            . Revocation is instantaneous: the very next request using that
            token returns 401. Revoked keys keep their row in the database so
            audit lookups by id remain valid; they simply no longer
            authenticate.
          </p>
          <p className="text-[14px] leading-relaxed text-text-1">
            There is no server-side recovery for the plaintext — if you lose
            it, revoke and mint a new one.
          </p>
        </Section>
      </div>
    </div>
  );
}
