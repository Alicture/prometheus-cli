import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { ExecResult } from '../types.js';
import type { LocalConfig } from '../config/index.js';
import { spawnCapture, truncate } from '../utils/proc.js';
import type { Sandbox, SandboxStatus } from './types.js';

// Runs commands directly on the local machine. No isolation — handy for
// development or when the user has no Docker / remote host.
export class LocalSandbox implements Sandbox {
  readonly workdir: string;
  private maxOutputSize: number;

  constructor(cfg: LocalConfig, maxOutputSize: number) {
    this.workdir = resolve(cfg.workspace || process.cwd());
    this.maxOutputSize = maxOutputSize;
  }

  describe(): string {
    return `Local: ${this.workdir}`;
  }

  async start(onStatus?: SandboxStatus): Promise<void> {
    onStatus?.('creating');
    await mkdir(this.workdir, { recursive: true });
    onStatus?.('ready');
  }

  async exec(command: string, opts: { cwd?: string; timeoutMs?: number } = {}): Promise<ExecResult> {
    const res = await spawnCapture('bash', ['-c', command], {
      cwd: opts.cwd ?? this.workdir,
      timeoutMs: opts.timeoutMs,
    });
    return {
      stdout: truncate(res.stdout, this.maxOutputSize),
      stderr: truncate(res.stderr, this.maxOutputSize),
      exitCode: res.exitCode,
    };
  }

  private resolvePath(path: string): string {
    return isAbsolute(path) ? path : resolve(this.workdir, path);
  }

  async readFile(path: string): Promise<string> {
    return readFile(this.resolvePath(path), 'utf8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    const full = this.resolvePath(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  async stop(): Promise<void> {
    /* nothing to tear down */
  }
}
