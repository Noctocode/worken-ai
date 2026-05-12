import { describe, expect, it } from "vitest";
import { parseSSEFrames } from "./sse-parser";

/**
 * Frame-level tests for the SSE parser used by streamChatMessage /
 * streamCompareModels. The parser is the only place where wire-
 * format quirks (partial frames at TCP boundary, multi-line data,
 * missing event header) need to be tolerated — the discriminated-
 * union mapping above it is straight-line code already covered by
 * the chat / arena consumers.
 */
describe("parseSSEFrames", () => {
  it("parses a single complete frame", () => {
    const { frames, rest } = parseSSEFrames(
      'event: delta\ndata: {"text":"hi"}\n\n',
    );
    expect(frames).toEqual([
      { event: "delta", data: '{"text":"hi"}' },
    ]);
    expect(rest).toBe("");
  });

  it("parses multiple frames in one buffer", () => {
    const { frames, rest } = parseSSEFrames(
      'event: delta\ndata: {"text":"a"}\n\n' +
        'event: delta\ndata: {"text":"b"}\n\n' +
        'event: done\ndata: {}\n\n',
    );
    expect(frames).toHaveLength(3);
    expect(frames[0]).toEqual({ event: "delta", data: '{"text":"a"}' });
    expect(frames[2]).toEqual({ event: "done", data: "{}" });
    expect(rest).toBe("");
  });

  it("returns a partial trailing frame as `rest`", () => {
    // Stream chopped mid-frame at the TCP boundary — the second
    // frame's terminating `\n\n` hasn't arrived yet.
    const { frames, rest } = parseSSEFrames(
      'event: delta\ndata: {"text":"a"}\n\nevent: delta\ndata: {"text',
    );
    expect(frames).toEqual([
      { event: "delta", data: '{"text":"a"}' },
    ]);
    expect(rest).toBe('event: delta\ndata: {"text');
  });

  it("yields zero frames when the buffer never reaches a separator", () => {
    const { frames, rest } = parseSSEFrames("event: delta\ndata: {");
    expect(frames).toEqual([]);
    expect(rest).toBe("event: delta\ndata: {");
  });

  it("defaults event to 'message' when the frame omits the header", () => {
    // SSE spec compliance — our BE always sets `event:`, but a
    // permissive reader is the right default.
    const { frames } = parseSSEFrames('data: {"text":"hi"}\n\n');
    expect(frames).toEqual([{ event: "message", data: '{"text":"hi"}' }]);
  });

  it("joins multi-line data with a newline boundary", () => {
    // Our BE doesn't emit multi-line data today, but the spec
    // allows it and an intermediary proxy could rewrite a single
    // line into multiple ones. Concatenate so the JSON parser
    // upstream still gets a valid blob.
    const { frames } = parseSSEFrames(
      'event: blob\ndata: {"a":1,\ndata: "b":2}\n\n',
    );
    expect(frames).toEqual([
      { event: "blob", data: '{"a":1,\n"b":2}' },
    ]);
  });

  it("drops unrecognised SSE headers silently", () => {
    // id: / retry: / : (comment) lines should not crash the
    // parser. They're not used by our wire format.
    const { frames } = parseSSEFrames(
      "id: 42\n: keepalive\nretry: 1000\nevent: ping\ndata: {}\n\n",
    );
    expect(frames).toEqual([{ event: "ping", data: "{}" }]);
  });

  it("returns the data field empty when frame has only an event header", () => {
    // BE emits `event: done\ndata: {}\n\n` so this shouldn't happen
    // in practice, but a malformed frame from a flaky source still
    // shouldn't crash — empty `data` lets the consumer skip it.
    const { frames } = parseSSEFrames("event: ping\n\n");
    expect(frames).toEqual([{ event: "ping", data: "" }]);
  });
});
