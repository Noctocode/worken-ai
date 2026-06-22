# Executable skills (Option #3) — operator & author guide

Executable skills run as a **server-side agent loop**: the model can search the
user's Knowledge Core, run the skill's own scripts in a hardened sandbox, and
return generated files as downloadable artifacts. This is distinct from
instructional skills (Option #2), which only inject Markdown into a chat turn.

> Companion design doc: [`skills-option3-plan.md`](./skills-option3-plan.md).

## Enabling

Executable skills are **off by default** and gated in two independent layers:

1. **Per-tenant feature flag** — turn the whole surface on for an org from the
   admin org-settings UI. With the flag off, every executable endpoint 404s and
   the UI affordance is hidden.
2. **Env kill-switch** — `EXECUTABLE_SKILLS_KILL_SWITCH=true` disables the
   feature everywhere instantly, regardless of per-tenant flags.

Running the skill's *own scripts* additionally requires the sandbox:

3. **Sandbox switch** — `SKILL_SANDBOX_DOCKER=true` enables the self-hosted
   Docker runtime on a host where a Docker daemon is available. With it off the
   sandbox is **deny-by-default**: the agent loop still runs (KC tools), but
   `run_script` is not offered and no script executes.

The model must route to an **Anthropic-native model on a BYOK Anthropic key**
(`kind === 'anthropic-sdk'`). Any other route is rejected with a clear 400; the
run dialog only offers eligible models.

## Configuration reference

All knobs are env vars read at startup; invalid/non-positive values fall back to
the default (a guard is never disabled by a bad value). See
[`apps/api/src/skills/skill-config.ts`](../apps/api/src/skills/skill-config.ts).

| Env var | Default | Meaning |
| --- | --- | --- |
| `EXECUTABLE_SKILLS_KILL_SWITCH` | _(unset)_ | `true` disables the feature everywhere |
| `SKILL_SANDBOX_DOCKER` | _(unset)_ | `true` enables the container runtime (else deny-by-default) |
| `SKILL_SANDBOX_DOCKER_BIN` | `docker` | Docker binary path |
| `SKILL_SANDBOX_IMAGE_PYTHON` | `python:3.12-slim` | Image for `python` scripts |
| `SKILL_SANDBOX_IMAGE_NODE` | `node:20-alpine` | Image for `node` scripts |
| `SKILL_SANDBOX_IMAGE_SHELL` | `alpine:3.20` | Image for `bash`/`sh` scripts |
| `SKILL_MAX_ITERATIONS` | `8` | Hard cap on model↔tool round-trips per run |
| `SKILL_MAX_RUN_COST_USD` | `1.0` | Per-run cost ceiling (USD); the loop stops before a round that would breach it |
| `SKILL_FALLBACK_USD_PER_1K_TOKENS` | `0.02` | Price used when the catalog has no entry for the model |
| `SKILL_SANDBOX_TIMEOUT_MS` | `30000` | Wall-clock cap per script run |
| `SKILL_SANDBOX_MEMORY_MB` | `256` | Memory cap (swap disabled) |
| `SKILL_SANDBOX_CPUS` | `1` | CPU cap |
| `SKILL_SANDBOX_MAX_OUTPUT_BYTES` | `65536` | stdout+stderr capture cap (truncated beyond) |
| `SKILL_SANDBOX_MAX_ARTIFACT_BYTES` | `26214400` | Total produced-file size cap (run fails beyond) |
| `SKILL_ARTIFACT_RETENTION_MS` | `604800000` (7 d) | How long generated artifacts are kept before the reaper deletes them |

## Security model

- **`run_script` runs only the skill author's vetted scripts** — never
  model-authored code. The model picks *which* named script to run, not its
  contents.
- **Container hardening** (`container-sandbox.ts`): `--network none`,
  `--read-only` root, `--cap-drop ALL`, `--security-opt no-new-privileges:true`,
  non-root `--user 1000:1000`, memory (swap off) / CPU / pids caps, a host-side
  wall-clock kill, and output/artifact size caps. Inputs mount read-only at
  `/work`; the only writable surfaces are a tmpfs `/tmp` and the `/out` artifact
  dir.
- **Artifacts** are stored under `uploads/skill-artifacts/<runId>/`,
  basename-only (no path traversal), and served as **owner-only attachments**.
- **Input guardrails**: the run's kick-off message is gated through the same
  `GuardrailEvaluatorService` as chat (`target: 'input'`, team-scoped from the
  launching project) *before* the stream opens — a blocked message returns a
  clean 422, never starts a run.
- **Prompt-injection awareness**: the agent reads untrusted content (KC chunks,
  files). Skill instructions and tool results stay in separate roles, tool scope
  is fixed per run, and every tool call is recorded in `skill_run_steps`.
- CI never runs a live container — the hardening args, language resolution, and
  gating are unit-tested; real execution is validated manually on a Docker host.

## Authoring a SKILL.md with scripts

Frontmatter sets the skill's identity; fenced code blocks with a `name=` info
string become runnable scripts. Mark the default with `entrypoint`.

````markdown
---
name: Monthly revenue report
description: Use when asked to build the monthly revenue spreadsheet.
---

Search the Knowledge Core for the latest figures, then run the report script.

```python name=build_report.py entrypoint
import openpyxl
# … writes /out/report.xlsx
```

```bash name=setup.sh
pip install openpyxl
```
````

Rules enforced by the parser:

- A block needs both a closing fence and a `name=` to be collected.
- **Names are de-duplicated** (first wins); a duplicate block is ignored.
- **At most one `entrypoint`** (first marked wins). `run_script` with no
  `scriptName` runs the entrypoint; otherwise pass the exact `name`.
- A skill is a **package**: when a script runs, the skill's other named blocks
  are written read-only alongside it in `/work` (by their `name`), so a script
  can `import` a helper module or read a bundled resource file (e.g.
  `name=data.csv`, `name=helper.py`).
- Scripts write output files to `/out`; everything there is collected as an
  artifact (subject to the size cap).

## API surface

- `POST /skills/:id/run` — SSE stream: `run_started` → `cost_estimate` →
  `text` / `tool_call` / `tool_result` / `usage` / `artifact` → `run_done`
  (carries the rolled-up `costUsd`) / `error`.
- `GET /skills/runs` — the caller's run history.
- `GET /skills/runs/:id` — one run + its ordered steps.
- `GET /skills/runs/:id/artifacts` — a run's artifacts (owner-only).
- `GET /skills/artifacts/:id/download` — stream an artifact (owner-only).
- `DELETE /skills/runs/active` — cancel the caller's in-flight run.

Every endpoint 404s when the feature flag is off.

## Observability & billing

Each upstream call records one `observability_events` row tagged with the run id
(`turn_id`), so a multi-call run rolls up via `getTurnRollup`. The budget gate
runs before every call (a no-op on the BYOK route) and the per-run cost ceiling
is the active guard. The run persists its rolled-up `costUsd`.
