/**
 * Pure SSE frame parser. Pulled out of the streaming chat / arena
 * helpers in `api.ts` so it can be tested without spinning up a
 * fetch mock — the buffer-and-split-on-blank-line logic is the
 * subtle bit, the surrounding async iteration is plumbing.
 *
 * Frames look like:
 *
 *     event: <name>\n
 *     data: <json>\n
 *     \n
 *
 * Multiple `data:` lines concatenate. Unrecognised header lines are
 * ignored. Multi-line data continuations get joined with a newline
 * boundary, matching how the BE writes them today (one JSON blob
 * per data line, so the join is harmless when there's only one).
 */
export interface SSEFrame {
  event: string;
  data: string;
}

export interface SSEFrameBatch {
  /** Frames pulled out of `buf` since the last call. */
  frames: SSEFrame[];
  /** Bytes left in `buf` that don't yet form a complete frame.
   *  The caller should feed this to the next `parseSSEFrames` call
   *  prefixed in front of whatever new bytes the stream produces. */
  rest: string;
}

/**
 * Pull every complete frame (`...\n\n`) out of `buf`. Partial
 * trailing content is returned in `rest` for the caller to splice
 * in front of the next batch of bytes. `event` defaults to
 * "message" when the frame omits the header — matches the SSE
 * spec, even though our wire format always sets it explicitly.
 */
export function parseSSEFrames(buf: string): SSEFrameBatch {
  const frames: SSEFrame[] = [];
  let rest = buf;
  let sepIdx = rest.indexOf("\n\n");
  while (sepIdx !== -1) {
    const rawFrame = rest.slice(0, sepIdx);
    rest = rest.slice(sepIdx + 2);
    sepIdx = rest.indexOf("\n\n");

    let event = "message";
    let data = "";
    for (const line of rawFrame.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        // Multi-line data: spec says join with `\n`, but our BE
        // never emits multi-line data so the empty separator is a
        // safe default. Trim each line for tolerance.
        data += (data ? "\n" : "") + line.slice("data:".length).trim();
      }
      // Other SSE headers (id, retry, …) are not used by our
      // wire format and are dropped.
    }
    frames.push({ event, data });
  }
  return { frames, rest };
}
