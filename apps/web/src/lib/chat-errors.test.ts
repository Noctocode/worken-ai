import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { humanizeChatError } from "./chat-errors";

// humanizeChatError logs the raw breadcrumb via console.warn — silence it
// so expected error states don't spam the test output.
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// Restore the console spy so the mock doesn't leak into other test files
// sharing this worker.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("humanizeChatError — web search not enabled", () => {
  const enabledCases = [
    "Web search is not enabled for this organization",
    "web_search is not allowed for this account",
    'web search tool is disabled; enable web search in settings',
    "permission denied for web search",
  ];

  it.each(enabledCases)("points the key owner to the Console: %s", (raw) => {
    expect(humanizeChatError(new Error(raw))).toBe(
      "Web search isn't enabled on this Anthropic account. The key owner needs to turn it on in the Anthropic Console (Settings → Privacy), then try again — or pick a different model.",
    );
  });

  it("does not trip on a normal answer that merely mentions web search", () => {
    expect(
      humanizeChatError(
        new Error("I used web search to find the latest results for you."),
      ),
    ).toBe("Something went wrong. Please try again.");
  });
});
