import type { ExecResult } from '../types.js';

export interface SandboxStatus {
  (status: 'creating' | 'ready' | 'error', detail?: string): void;
}

// A Sandbox is an isolated (or local) environment where tool commands run and
// files are read/written. Docker, SSH and local backends all implement this.
export interface Sandbox {
  // The working directory inside the environment.
  readonly workdir: string;

  // Human-readable description for the status bar (e.g. "Docker: claude-sandbox").
  describe(): string;

  // Provision and become ready. Idempotent.
  start(onStatus?: SandboxStatus): Promise<void>;

  // Run a shell command inside the environment.
  exec(command: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<ExecResult>;

  // Read a file's full contents.
  readFile(path: string): Promise<string>;

  // Write a file (creating parent directories as needed).
  writeFile(path: string, content: string): Promise<void>;

  // Tear down (no-op for local/persistent backends).
  stop(): Promise<void>;
}
