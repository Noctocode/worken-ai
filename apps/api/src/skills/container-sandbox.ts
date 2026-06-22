import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  SandboxFile,
  SandboxRunInput,
  SandboxRunResult,
  SkillSandboxRuntime,
} from './skill-sandbox.js';

/**
 * Self-hosted Docker sandbox for executable-skill scripts (Option #3, Phase D /
 * 3b). Runs each script in a throwaway, hardened container:
 *
 *   - `--network none` (offline unless the run opts in),
 *   - `--read-only` root FS; script + inputs mounted read-only at /work, a
 *     writable scratch/output dir at /out, a small tmpfs at /tmp,
 *   - `--cap-drop ALL` + `--security-opt no-new-privileges` + non-root user,
 *   - memory (swap disabled), CPU and pids caps,
 *   - a wall-clock timeout enforced host-side (`docker kill`),
 *   - captured output truncated at the byte cap, total artifact size capped.
 *
 * Gated by `SKILL_SANDBOX_DOCKER=true` (default OFF → {@link isAvailable}
 * false, so the orchestrator falls back to the loop-with-tools behavior). The
 * docker invocation itself is not exercised in CI (no runtime there); the
 * argument construction + language resolution + output handling are.
 */

interface LanguageSpec {
  image: string;
  /** Interpreter argv given the in-container script path. */
  cmd: (scriptPath: string) => string[];
  ext: string;
}

const EXT_MIME: Record<string, string> = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.html': 'text/html',
};

@Injectable()
export class ContainerSandbox implements SkillSandboxRuntime {
  private readonly logger = new Logger(ContainerSandbox.name);
  private readonly dockerBin =
    process.env['SKILL_SANDBOX_DOCKER_BIN'] || 'docker';

  isAvailable(): boolean {
    return process.env['SKILL_SANDBOX_DOCKER'] === 'true';
  }

  /** Image + interpreter for a language, honoring per-language env overrides.
   *  Returns null for an unsupported language. */
  resolveLanguage(language: string): LanguageSpec | null {
    const lang = language.toLowerCase();
    const envImage = (key: string, fallback: string) =>
      process.env[`SKILL_SANDBOX_IMAGE_${key}`] || fallback;

    if (lang === 'python' || lang === 'py') {
      return {
        image: envImage('PYTHON', 'python:3.12-slim'),
        cmd: (p) => ['python', p],
        ext: 'py',
      };
    }
    if (lang === 'node' || lang === 'javascript' || lang === 'js') {
      return {
        image: envImage('NODE', 'node:20-alpine'),
        cmd: (p) => ['node', p],
        ext: 'js',
      };
    }
    if (lang === 'bash' || lang === 'sh' || lang === 'shell') {
      return {
        image: envImage('SHELL', 'alpine:3.20'),
        cmd: (p) => ['sh', p],
        ext: 'sh',
      };
    }
    return null;
  }

  /**
   * Build the hardened `docker run …` argv. Pure + deterministic given its
   * inputs (the container name is passed in) so it can be unit-tested without
   * a Docker daemon.
   */
  buildDockerArgs(
    input: SandboxRunInput,
    lang: LanguageSpec,
    hostWork: string,
    hostOut: string,
    containerName: string,
  ): string[] {
    const { limits } = input;
    const scriptInContainer = `/work/script.${lang.ext}`;
    return [
      'run',
      '--rm',
      '--name',
      containerName,
      // No network unless explicitly opted in.
      '--network',
      limits.network ? 'bridge' : 'none',
      // Hard memory ceiling (swap == memory disables swap growth).
      '--memory',
      `${limits.memoryMb}m`,
      '--memory-swap',
      `${limits.memoryMb}m`,
      '--cpus',
      String(limits.cpus),
      '--pids-limit',
      '256',
      // Drop every capability + block privilege escalation; non-root.
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--user',
      '1000:1000',
      // Read-only root; writable scratch only via tmpfs + the /out mount.
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m',
      '-w',
      '/out',
      '-v',
      `${hostWork}:/work:ro`,
      // /out is writable so the script can produce artifacts. Docker can't set
      // `noexec` on a bind mount (unlike the /tmp tmpfs above), so code written
      // to /out could in principle be exec'd — acceptable here because the
      // container has no network, all caps dropped, no-new-privileges, and runs
      // non-root, so there's no escape vector to leverage it.
      '-v',
      `${hostOut}:/out:rw`,
      lang.image,
      ...lang.cmd(scriptInContainer),
    ];
  }

  /** Map produced files to mime types by extension (untrusted; default blob). */
  private mimeFor(filename: string): string {
    return (
      EXT_MIME[path.extname(filename).toLowerCase()] ||
      'application/octet-stream'
    );
  }

  async run(input: SandboxRunInput): Promise<SandboxRunResult> {
    const lang = this.resolveLanguage(input.language);
    if (!lang) {
      return this.failure(`Unsupported sandbox language: ${input.language}`);
    }

    const id = randomUUID();
    const base = path.join(os.tmpdir(), 'skill-sandbox', id);
    const hostWork = path.join(base, 'work');
    const hostOut = path.join(base, 'out');
    const containerName = `skill-${id}`;

    try {
      await fs.mkdir(hostWork, { recursive: true });
      await fs.mkdir(hostOut, { recursive: true });
      await fs.writeFile(
        path.join(hostWork, `script.${lang.ext}`),
        input.script,
      );
      for (const file of input.inputs ?? []) {
        // Inputs are read-only references; collapse to a basename.
        await fs.writeFile(
          path.join(hostWork, path.basename(file.filename) || 'input'),
          file.content,
        );
      }

      const args = this.buildDockerArgs(
        input,
        lang,
        hostWork,
        hostOut,
        containerName,
      );
      const exec = await this.spawnDocker(args, containerName, input);

      // Collect artifacts from the writable /out mount, enforcing the size cap.
      let artifacts: SandboxFile[] = [];
      if (!exec.timedOut) {
        artifacts = await this.collectArtifacts(
          hostOut,
          input.limits.maxArtifactBytes,
        );
      }

      return {
        exitCode: exec.exitCode,
        stdout: exec.stdout,
        stderr: exec.stderr,
        outputTruncated: exec.outputTruncated,
        artifacts,
        timedOut: exec.timedOut,
        error: exec.timedOut
          ? `Sandbox run exceeded ${input.limits.timeoutMs}ms and was killed.`
          : exec.exitCode === 0
            ? null
            : // A user/Stop abort also surfaces as exitCode -1 — report it as a
              // cancellation rather than an infra failure.
              input.signal?.aborted
              ? 'Sandbox run was cancelled.'
              : // exitCode -1 means docker itself never ran the script (daemon
                // down / image missing / binary not found) — an infra failure,
                // not a script bug. Surface the captured reason instead of a code.
                exec.exitCode === -1
                ? `Sandbox could not start: ${exec.stderr.trim() || 'docker unavailable'}`
                : `Script exited with code ${exec.exitCode}.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.failure(`Sandbox run failed: ${msg}`);
    } finally {
      await fs
        .rm(base, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  /** Read every file in the output dir as an artifact; fail past the byte cap. */
  private async collectArtifacts(
    hostOut: string,
    maxBytes: number,
  ): Promise<SandboxFile[]> {
    const names = await fs.readdir(hostOut).catch(() => [] as string[]);
    const artifacts: SandboxFile[] = [];
    let total = 0;
    for (const name of names) {
      const full = path.join(hostOut, name);
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      total += stat.size;
      if (total > maxBytes) {
        throw new Error(`Produced artifacts exceed the ${maxBytes}-byte cap.`);
      }
      artifacts.push({
        filename: name,
        mimeType: this.mimeFor(name),
        content: await fs.readFile(full),
      });
    }
    return artifacts;
  }

  /**
   * Spawn `docker run …`, capping captured output and enforcing the wall-clock
   * timeout by killing the named container. Not exercised in CI (no daemon).
   */
  private spawnDocker(
    args: string[],
    containerName: string,
    input: SandboxRunInput,
  ): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    outputTruncated: boolean;
    timedOut: boolean;
  }> {
    return new Promise((resolve) => {
      const child = spawn(this.dockerBin, args, { signal: input.signal });
      const cap = input.limits.maxOutputBytes;
      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timedOut = false;

      const append = (buf: Buffer, which: 'out' | 'err') => {
        const cur = which === 'out' ? stdout : stderr;
        if (cur.length >= cap) {
          truncated = true;
          return;
        }
        const room = cap - cur.length;
        const text = buf.toString('utf8');
        const piece = text.length > room ? text.slice(0, room) : text;
        if (text.length > room) truncated = true;
        if (which === 'out') stdout += piece;
        else stderr += piece;
      };

      child.stdout?.on('data', (b: Buffer) => append(b, 'out'));
      child.stderr?.on('data', (b: Buffer) => append(b, 'err'));

      const timer = setTimeout(() => {
        timedOut = true;
        // Best-effort kill of the container; the `docker run` then exits.
        spawn(this.dockerBin, ['kill', containerName]).on('error', () => {
          /* daemon already gone */
        });
      }, input.limits.timeoutMs);
      timer.unref?.();

      child.on('error', (err) => {
        clearTimeout(timer);
        const e = err as NodeJS.ErrnoException;
        const reason =
          e?.code === 'ENOENT'
            ? `docker binary not found ('${this.dockerBin}') — is Docker installed and on PATH?`
            : String(err);
        resolve({
          exitCode: -1,
          stdout,
          stderr: stderr || reason,
          outputTruncated: truncated,
          timedOut,
        });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code ?? -1,
          stdout,
          stderr,
          outputTruncated: truncated,
          timedOut,
        });
      });
    });
  }

  private failure(error: string): SandboxRunResult {
    return {
      exitCode: -1,
      stdout: '',
      stderr: '',
      outputTruncated: false,
      artifacts: [],
      timedOut: false,
      error,
    };
  }
}
