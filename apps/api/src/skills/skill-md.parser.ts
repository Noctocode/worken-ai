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
 * Executable skills (Option #3): fenced code blocks whose info string carries
 * `name=<file>` are extracted into `scripts[]` — e.g.
 *
 *   ```python name=generate_report.py entrypoint
 *   ...code...
 *   ```
 *
 * The first bare token is the `language`, `name=` is the filename, and a bare
 * `entrypoint` token marks the entry script. Extraction is **non-destructive**:
 * `instructions` is still the full body (so ordinary code examples and #2
 * skills are unaffected), and a block WITHOUT `name=` is left alone. If no
 * named blocks exist, `scripts` is empty and the skill is instructional (#2).
 */
export interface ParsedSkillScript {
  name: string;
  language: string;
  entrypoint?: boolean;
  content: string;
}

export interface ParsedSkillMd {
  name?: string;
  description?: string;
  instructions: string;
  /** Frontmatter keys other than name/description, kept verbatim. */
  extraFrontmatter: Record<string, string>;
  /** Named fenced code blocks (Option #3). Empty for instructional skills. */
  scripts: ParsedSkillScript[];
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

const FENCE_OPEN = /^```(.*)$/;
const FENCE_CLOSE = /^```\s*$/;

/** Parse a fence info string like `python name=gen.py entrypoint`. */
function parseInfoString(info: string): {
  language?: string;
  name?: string;
  entrypoint: boolean;
} {
  let language: string | undefined;
  let name: string | undefined;
  let entrypoint = false;
  for (const tok of info.split(/\s+/).filter(Boolean)) {
    if (tok === 'entrypoint') {
      entrypoint = true;
      continue;
    }
    const eq = tok.indexOf('=');
    if (eq === -1) {
      if (!language) language = tok; // first bare token = language
      continue;
    }
    if (tok.slice(0, eq) === 'name') name = unquote(tok.slice(eq + 1));
    // other key=val tokens ignored (forward-compat)
  }
  return { language, name, entrypoint };
}

/** Extract named fenced code blocks from a Markdown body into scripts.
 *  Non-destructive: the body is left intact; only blocks with `name=` and a
 *  proper closing fence are collected. */
function extractScripts(body: string): ParsedSkillScript[] {
  const lines = body.split('\n');
  const scripts: ParsedSkillScript[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open) continue;
    let j = i + 1;
    while (j < lines.length && !FENCE_CLOSE.test(lines[j])) j++;
    if (j < lines.length) {
      // closing fence found
      const meta = parseInfoString(open[1].trim());
      if (meta.name) {
        scripts.push({
          name: meta.name,
          language: meta.language || 'text',
          ...(meta.entrypoint ? { entrypoint: true } : {}),
          content: lines.slice(i + 1, j).join('\n'),
        });
      }
    }
    i = j; // skip past this block (its body isn't re-scanned for fences)
  }
  return scripts;
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
    return {
      instructions: text.trim(),
      extraFrontmatter: {},
      scripts: extractScripts(text),
    };
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
    return {
      instructions: text.trim(),
      extraFrontmatter: {},
      scripts: extractScripts(text),
    };
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
  return {
    name,
    description,
    instructions,
    extraFrontmatter,
    scripts: extractScripts(instructions),
  };
}
