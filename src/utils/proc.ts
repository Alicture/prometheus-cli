import { spawn } from 'node:child_process';
import type { ExecResult } from '../types.js';

export interface SpawnOptions {
  input?: string;
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

// Spawn a local process and capture stdout/stderr with a hard timeout.
export function spawnCapture(
  cmd: string,
  args: string[],
  opts: SpawnOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill('SIGKILL');
          resolve({
            stdout,
            stderr: stderr + `\n[command timed out after ${opts.timeoutMs}ms]`,
            exitCode: 124,
          });
        }, opts.timeoutMs)
      : null;

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ stdout, stderr: stderr + `\n${err.message}`, exitCode: 127 });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}

// Truncate large tool output, mirroring the server's maxOutputSize behavior.
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n[output truncated at ${max} bytes]`;
}
