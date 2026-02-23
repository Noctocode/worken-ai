"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sendQuestionToCompareModels } from "@/lib/api";
import { MODELS } from "@/lib/models";
import { useState } from "react";

// Types for evaluation JSON
type ModelEvaluation = {
  name: string;
  score: number;
  advantages: string[];
  disadvantages: string[];
  summary: string;
  totalTokens?: number;
  totalCost?: number;
  time?: number;
};

export default function CompareModelsPage() {
  const [modelA, setModelA] = useState<string>(MODELS[0].id);
  const [modelB, setModelB] = useState<string>(MODELS[1].id);
  const [question, setQuestion] = useState("");
  const [expectedOutput, setExpectedOutput] = useState(""); // Added for expected output
  const [responseA, setResponseA] = useState<string | null>(null);
  const [responseB, setResponseB] = useState<string | null>(null);
  const [evaluationA, setEvaluationA] = useState<ModelEvaluation | null>(null);
  const [evaluationB, setEvaluationB] = useState<ModelEvaluation | null>(null);
  const [loading, setLoading] = useState(false);

  async function compareModels(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResponseA(null);
    setResponseB(null);
    setEvaluationA(null);
    setEvaluationB(null);

    const response = await sendQuestionToCompareModels(
      [modelA, modelB],
      question,
      expectedOutput
    );
    console.log("response", response);

    // Simulate parallel responses and evaluations
    await new Promise((res) => setTimeout(res, 1200));
    setResponseA(
      response.responses.find((r) => r.model === modelA)?.response.content ??
        null
    );
    setResponseB(
      response.responses.find((r) => r.model === modelB)?.response.content ??
        null
    );

    setEvaluationA(response.comparison.find((c) => c.name === modelA) ?? null);
    setEvaluationB(response.comparison.find((c) => c.name === modelB) ?? null);

    setLoading(false);
  }

  // Helper for rendering evaluation card
  function EvaluationBox({
    evaluation,
  }: {
    evaluation: ModelEvaluation | null;
  }) {
    if (!evaluation) {
      return (
        <div className="text-slate-400 text-center">
          No evaluation available
        </div>
      );
    }
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-blue-700">{evaluation.name}</span>
          <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 font-bold">
            Score: {evaluation.score}
          </span>
        </div>
        <div className="flex items-center gap-4 mb-2 text-xs text-slate-500">
          {evaluation.totalTokens !== undefined && (
            <span>
              Tokens:{" "}
              <span className="font-semibold text-slate-700">
                {evaluation.totalTokens}
              </span>
            </span>
          )}
          {evaluation.totalCost !== undefined && (
            <span>
              Cost:{" "}
              <span className="font-semibold text-slate-700">
                ${Number(evaluation.totalCost).toFixed(5)}
              </span>
            </span>
          )}
          {evaluation.time !== undefined && (
            <span>
              Time:{" "}
              <span className="font-semibold text-slate-700">
                {evaluation.time} ms
              </span>
            </span>
          )}
        </div>
        <div className="mb-2">
          <span className="font-medium text-xs text-slate-600">
            Advantages:
          </span>
          <ul className="list-disc list-inside text-sm pl-3 mb-1 text-green-700">
            {evaluation.advantages.map((adv, idx) => (
              <li key={idx}>{adv}</li>
            ))}
          </ul>
          <span className="font-medium text-xs text-slate-600">
            Disadvantages:
          </span>
          <ul className="list-disc list-inside text-sm pl-3 mb-1 text-red-700">
            {evaluation.disadvantages.map((dis, idx) => (
              <li key={idx}>{dis}</li>
            ))}
          </ul>
        </div>
        <div className="text-slate-800 text-sm font-normal italic">
          {evaluation.summary}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start justify-start gap-8 w-full">
      {/* Title and Subtitle */}
      <div className="w-full flex flex-col items-start gap-2">
        <h1 className="text-3xl font-semibold">Compare AI Models</h1>
        <p className="text-slate-600 text-base">
          Select two AI models, ask a question, and compare their responses side
          by side.
        </p>
      </div>

      {/* Model Selectors */}
      <div className="flex flex-row gap-6 w-full justify-center">
        {/* Model A */}
        <Card className="flex-1 p-6 flex flex-col gap-2 items-center">
          <span className="font-bold text-slate-700 mb-2">Model A</span>
          <Select
            value={modelA}
            onValueChange={(value) => setModelA(value as typeof modelA)}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Card>
        {/* Model B */}
        <Card className="flex-1 p-6 flex flex-col gap-2 items-center">
          <span className="font-bold text-slate-700 mb-2">Model B</span>
          <Select
            value={modelB}
            onValueChange={(value) => setModelB(value as typeof modelB)}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Card>
      </div>

      {/* Chat Box */}
      <form
        className="flex flex-col items-center gap-3 w-full"
        onSubmit={compareModels}
      >
        {/* Use a textarea for a bigger question box */}
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Enter your question to compare..."
          className="w-full flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[200px] resize-y transition-all duration-150"
          disabled={loading}
          rows={3}
        />
        {/* Expected Output Textarea */}
        <textarea
          value={expectedOutput}
          onChange={(e) => setExpectedOutput(e.target.value)}
          placeholder="Enter your expected output..."
          className="w-full flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[120px] resize-y transition-all duration-150"
          disabled={loading}
          rows={2}
        />
        <Button
          type="submit"
          className="min-w-max w-full"
          disabled={!question.trim() || !expectedOutput.trim() || loading}
        >
          {loading ? "Comparing..." : "Compare"}
        </Button>
      </form>

      {/* Response Comparison */}
      {(responseA || responseB) && (
        <>
          <div className="flex flex-row gap-6 w-full">
            <Card className="flex-1 min-h-[140px] p-5 max-w-[50%] overflow-x-scroll bg-slate-50">
              <div className="text-xs font-semibold mb-2 text-blue-700">
                {MODELS.find((m) => m.id === modelA)?.label}
              </div>
              <div className="prose prose-slate max-w-none text-slate-800">
                {responseA ? (
                  <AiResponseRender content={responseA} />
                ) : (
                  <span className="text-slate-400">No response</span>
                )}
              </div>
            </Card>
            <Card className="flex-1 min-h-[140px] p-5 max-w-[50%] bg-slate-50">
              <div className="text-xs font-semibold mb-2 text-blue-700">
                {MODELS.find((m) => m.id === modelB)?.label}
              </div>
              <div className="prose prose-slate max-w-none text-slate-800">
                {responseB ? (
                  <AiResponseRender content={responseB} />
                ) : (
                  <span className="text-slate-400">No response</span>
                )}
              </div>
            </Card>
          </div>
          {/* Evaluation Comparison */}
          <div className="flex flex-row gap-6 w-full mt-4">
            <Card className="flex-1 min-h-[140px] p-5 border-blue-100 bg-white border-2">
              <EvaluationBox evaluation={evaluationA} />
            </Card>
            <Card className="flex-1 min-h-[140px] p-5 border-blue-100 bg-white border-2">
              <EvaluationBox evaluation={evaluationB} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Converts plain AI text output to HTML with basic formatting:
 * - Headings: ### for h3, ## for h2, # for h1
 * - Horizontal rules: --- or ***
 * - Newlines/line breaks as <br>
 * - Escaped HTML correctly to avoid XSS
 * - Trims text and handles code blocks minimally
 */
function aiResponseToHtml(raw: string): string {
  if (!raw) return "";

  let lines = raw.split(/\r?\n/);

  let htmlLines: string[] = [];
  let i = 0;
  let inCodeBlock = false;

  // Helper to replace **bold** with <strong>bold</strong>, ensuring no XSS.
  function processBold(text: string): string {
    // This reg-ex matches pairs of **, non-greedy to support multiple in a line.
    // It escapes inner text to avoid XSS
    return text.replace(
      /\*\*(.+?)\*\*/g,
      (_, inner) => `<strong>${escapeHtml(inner)}</strong>`
    );
  }

  while (i < lines.length) {
    let line = lines[i];

    // Detect start/end of code block
    if (/^```/.test(line.trim())) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        htmlLines.push("<pre><code>");
      } else {
        inCodeBlock = false;
        htmlLines.push("</code></pre>");
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      // Make sure to escape code
      htmlLines.push(
        line.replace(
          /[&<>"']/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#039;",
            })[c]!
        )
      );
      i++;
      continue;
    }

    // Table detection: start of markdown table (at least 2 rows starting with |, second is ---)
    if (
      /^\s*\|(.+\|)+\s*$/.test(line) && // first table row
      i + 1 < lines.length &&
      /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[i + 1])
    ) {
      // Parse the header
      const header = lines[i]
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => processBold(escapeHtml(cell.trim())));
      // Parse column alignments from --- row, but for simplicity we ignore here
      i += 2; // Skip header and separator

      // Parse data rows
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|(.+\|)+\s*$/.test(lines[i])) {
        const row = lines[i]
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => processBold(escapeHtml(cell.trim())));
        rows.push(row);
        i++;
      }

      // Build the HTML table
      let tableHtml = '<table class="prose-table w-full my-4 border-collapse">';
      tableHtml += "<thead><tr>";
      for (const h of header) {
        tableHtml += `<th class="border-b px-4 py-2 text-left font-medium">${h}</th>`;
      }
      tableHtml += "</tr></thead>\n<tbody>";
      for (const row of rows) {
        tableHtml += "<tr>";
        for (const cell of row) {
          tableHtml += `<td class="border-b px-4 py-2 align-top">${cell}</td>`;
        }
        tableHtml += "</tr>";
      }
      tableHtml += "</tbody></table>";
      htmlLines.push(tableHtml);
      continue;
    }

    // Headings: start of line with #, ##, ###
    if (/^###\s+/.test(line)) {
      htmlLines.push(
        `<h3 class="mt-4 mb-1 font-bold text-lg">${processBold(
          line.replace(/^###\s+/, "")
        )}</h3>`
      );
      i++;
      continue;
    }
    if (/^##\s+/.test(line)) {
      htmlLines.push(
        `<h2 class="mt-4 mb-2 font-bold text-xl">${processBold(
          line.replace(/^##\s+/, "")
        )}</h2>`
      );
      i++;
      continue;
    }
    if (/^#\s+/.test(line)) {
      htmlLines.push(
        `<h1 class="mt-5 mb-2 font-bold text-2xl">${processBold(
          line.replace(/^#\s+/, "")
        )}</h1>`
      );
      i++;
      continue;
    }

    // Horizontal rules: --- or ***
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      htmlLines.push("<br />");
      htmlLines.push("<hr />");
      i++;
      continue;
    }

    // Treat as bullet if line starts with "- " or "* "
    if (/^\s*[-*]\s+/.test(line)) {
      // Gather consecutive bullets into <ul>
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(
          `<li>${processBold(escapeHtml(lines[i].replace(/^\s*[-*]\s+/, "")))}</li>`
        );
        i++;
      }
      htmlLines.push("<ul>" + items.join("") + "</ul>");
      continue;
    }

    // Simple numbered list (1. 2. 3.)
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(
          `<li>${processBold(escapeHtml(lines[i].replace(/^\s*\d+\.\s+/, "")))}</li>`
        );
        i++;
      }
      htmlLines.push("<ol>" + items.join("") + "</ol>");
      continue;
    }

    // Otherwise, treat as paragraph, but preserve <br> for inline newlines within paragraphs
    if (line.trim() !== "") {
      htmlLines.push("<p>" + processBold(escapeHtml(line)) + "</p>");
    } else {
      // For blank lines, insert nothing (could insert <br> if preferred)
    }
    i++;
  }

  return htmlLines.join("\n");
}

function escapeHtml(unsafe: string) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function AiResponseRender({ content }: { content: string }) {
  return (
    <div
      className="prose max-w-none"
      dangerouslySetInnerHTML={{ __html: aiResponseToHtml(content) }}
    />
  );
}
