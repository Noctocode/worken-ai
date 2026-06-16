/**
 * Minimal parser for the agentskills.io `SKILL.md` format:
 *
 *   ---
 *   name: Client proposal
 *   description: Use when drafting a client-facing proposal or quote.
 *   ---
 *   <Markdown body — the instructions>
 *
 * The YAML frontmatter (delimited by `---` lines) carries `name` +
 * `description`; everything after the closing fence is the instructions
 * body. We hand-roll the frontmatter scan rather than pull in a YAML
 * dependency — only flat `key: value` pairs are needed, and quoted values
 * are unwrapped.
 *
 * Forward-compatibility with Option #3 (executable skills): unknown
 * frontmatter keys and any script/resource sections in the body are
 * **preserved, not rejected** — `name`/`description` are lifted out and the
 * full remaining body becomes `instructions`. A future executable-skills
 * PR can re-parse the same body for its script blocks without a format
 * break here.
 */
export interface ParsedSkillMd {
  name?: string;
  description?: string;
  instructions: string;
  /** Frontmatter keys other than name/description, kept verbatim so a
   *  later (Option #3) parser can read script/resource declarations. */
  extraFrontmatter: Record<string, string>;
}

const FENCE = /^---[ \t]*$/;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseSkillMd(raw: string): ParsedSkillMd {
  // Normalize newlines so the fence scan is CRLF-safe.
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  // Frontmatter only counts when the very first non-empty line is a `---`
  // fence. Leading blank lines are tolerated.
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;

  if (i >= lines.length || !FENCE.test(lines[i])) {
    // No frontmatter — the whole document is the instructions.
    return { instructions: text.trim(), extraFrontmatter: {} };
  }

  // Collect frontmatter lines until the closing fence.
  const fmStart = i + 1;
  let fmEnd = -1;
  for (let j = fmStart; j < lines.length; j++) {
    if (FENCE.test(lines[j])) {
      fmEnd = j;
      break;
    }
  }
  if (fmEnd === -1) {
    // Unterminated frontmatter — treat the whole thing as instructions
    // rather than guessing where it ends.
    return { instructions: text.trim(), extraFrontmatter: {} };
  }

  const frontmatter: Record<string, string> = {};
  for (let j = fmStart; j < fmEnd; j++) {
    const line = lines[j];
    if (line.trim() === '') continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue; // skip malformed / list lines
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = unquote(line.slice(colon + 1));
    if (key) frontmatter[key] = value;
  }

  const instructions = lines
    .slice(fmEnd + 1)
    .join('\n')
    .trim();

  const { name, description, ...extraFrontmatter } = frontmatter;
  return { name, description, instructions, extraFrontmatter };
}
