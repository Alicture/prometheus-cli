import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import type { ExecResult } from '../types.js';
import type { DockerConfig } from '../config/index.js';
import { spawnCapture, truncate } from '../utils/proc.js';
import { registerTeardown } from './cleanup.js';
import type { Sandbox, SandboxStatus } from './types.js';

// Containers we create are tagged so they can be recognised later: OWNER_LABEL
// holds the PID of the CLI that created them, which lets a new run tell its own
// throwaway containers apart from those of another live session.
const SANDBOX_LABEL = 'prometheus.sandbox';
const OWNER_LABEL = 'prometheus.owner';

// Runs commands inside a Docker container via the `docker` CLI, mirroring the
// original Bun server's sandbox manager (docker run / exec / tee / cat).
export class DockerSandbox implements Sandbox {
  readonly workdir: string;
  private cfg: DockerConfig;
  private maxOutputSize: number;
  private commandTimeoutMs: number;
  private containerId = '';
  private ownsContainer = false;
  private unregisterTeardown: (() => void) | null = null;

  constructor(cfg: DockerConfig, maxOutputSize: number, commandTimeoutMs: number) {
    this.cfg = cfg;
    this.workdir = cfg.workspace;
    this.maxOutputSize = maxOutputSize;
    this.commandTimeoutMs = commandTimeoutMs;
  }

  describe(): string {
    const id = this.containerId ? this.containerId.slice(0, 12) : this.cfg.image;
    return `Docker: ${id}`;
  }

  private async docker(args: string[], opts: { input?: string; timeoutMs?: number } = {}): Promise<ExecResult> {
    return spawnCapture('docker', args, { input: opts.input, timeoutMs: opts.timeoutMs, env: this.dockerEnv() });
  }

  // Point the docker CLI at a custom daemon when configured (config wins over
  // any inherited DOCKER_HOST so behaviour is reproducible).
  private dockerEnv(): NodeJS.ProcessEnv {
    return this.cfg.host ? { ...process.env, DOCKER_HOST: this.cfg.host } : process.env;
  }

  async start(onStatus?: SandboxStatus): Promise<void> {
    onStatus?.('creating');

    // 1. Verify docker is installed and the daemon is reachable.
    const ver = await this.docker(['version', '--format', '{{.Server.Version}}'], { timeoutMs: 10_000 });
    if (ver.exitCode !== 0) {
      const where = this.cfg.host || process.env.DOCKER_HOST || 'the default Docker socket';
      const hint =
        `Cannot reach the Docker daemon at ${where}. ` +
        `Start Docker (or colima), set the daemon endpoint with ` +
        `\`prometheus config set docker.host <DOCKER_HOST>\`, or switch to local ` +
        `execution with \`prometheus config set environment local\`.`;
      onStatus?.('error', hint);
      throw new Error('docker CLI unavailable: ' + (ver.stderr.trim() || hint));
    }

    // 2. Reuse an existing container if one was configured and is present.
    if (this.cfg.containerId) {
      const inspect = await this.docker(['inspect', '-f', '{{.State.Running}}', this.cfg.containerId]);
      if (inspect.exitCode === 0) {
        this.containerId = this.cfg.containerId;
        this.ownsContainer = false;
        if (inspect.stdout.trim() !== 'true') {
          await this.docker(['start', this.containerId]);
        }
        await this.ensureWorkdir();
        onStatus?.('ready');
        return;
      }
      onStatus?.('error', `Configured container ${this.cfg.containerId} not found.`);
      throw new Error(`container ${this.cfg.containerId} not found`);
    }

    // 3. Ensure the image exists locally.
    const img = await this.docker(['image', 'inspect', this.cfg.image], { timeoutMs: 15_000 });
    if (img.exitCode !== 0) {
      onStatus?.('error', `Image "${this.cfg.image}" not found. Run: docker pull ${this.cfg.image} (or docker build).`);
      throw new Error(`docker image not found: ${this.cfg.image}`);
    }

    // 4. Create a fresh container. Containers left behind by sessions that were
    // killed before they could clean up are removed first.
    await this.reapOrphans();
    const name = `prometheus-sandbox-${randomUUID().slice(0, 8)}`;
    const run = await this.docker(
      [
        'run',
        '-d',
        '--name',
        name,
        '--label',
        `${SANDBOX_LABEL}=1`,
        '--label',
        `${OWNER_LABEL}=${process.pid}`,
        '--memory',
        this.cfg.memory,
        '--cpus',
        this.cfg.cpu,
        '--network=bridge',
        '--security-opt',
        'no-new-privileges',
        '-w',
        this.workdir,
        this.cfg.image,
        'sleep',
        'infinity',
      ],
      { timeoutMs: 30_000 },
    );
    if (run.exitCode !== 0) {
      onStatus?.('error', run.stderr.trim());
      throw new Error('docker run failed: ' + run.stderr.trim());
    }
    this.containerId = run.stdout.trim();
    this.ownsContainer = true;
    // Ink exits without unwinding the React tree, so removal is also driven by
    // process teardown; otherwise every session would leak its container.
    if (!this.cfg.persistent) {
      const id = this.containerId;
      this.unregisterTeardown = registerTeardown(() => this.removeSync(id));
    }
    await this.ensureWorkdir();
    onStatus?.('ready');
  }

  // Remove throwaway containers whose creating process is gone. Containers
  // belonging to a still-running session (or created without our labels) are
  // left untouched.
  private async reapOrphans(): Promise<void> {
    const list = await this.docker(
      ['ps', '-aq', '--filter', `label=${SANDBOX_LABEL}=1`],
      { timeoutMs: 10_000 },
    );
    const ids = list.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return;

    const inspect = await this.docker(
      ['inspect', '-f', `{{.Id}} {{index .Config.Labels "${OWNER_LABEL}"}}`, ...ids],
      { timeoutMs: 15_000 },
    );
    const orphans: string[] = [];
    for (const line of inspect.stdout.split('\n')) {
      const [id, owner] = line.trim().split(/\s+/);
      if (!id) continue;
      const pid = Number(owner);
      // No owner recorded, or the owner is no longer running.
      if (!Number.isInteger(pid) || pid <= 0 || !isProcessAlive(pid)) orphans.push(id);
    }
    if (orphans.length > 0) {
      await this.docker(['rm', '-f', ...orphans], { timeoutMs: 30_000 });
    }
  }

  // Synchronous counterpart of stop(), for use from process exit handlers where
  // pending promises will never settle.
  private removeSync(id: string): void {
    spawnSync('docker', ['rm', '-f', id], {
      env: this.dockerEnv(),
      timeout: 10_000,
      stdio: 'ignore',
    });
  }

  private async ensureWorkdir(): Promise<void> {
    await this.docker(['exec', this.containerId, 'mkdir', '-p', this.workdir]);
  }

  async exec(command: string, opts: { cwd?: string; timeoutMs?: number } = {}): Promise<ExecResult> {
    const cwd = opts.cwd ?? this.workdir;
    const res = await this.docker(['exec', '-w', cwd, this.containerId, 'bash', '-c', command], {
      timeoutMs: opts.timeoutMs ?? this.commandTimeoutMs,
    });
    return {
      stdout: truncate(res.stdout, this.maxOutputSize),
      stderr: truncate(res.stderr, this.maxOutputSize),
      exitCode: res.exitCode,
    };
  }

  async readFile(path: string): Promise<string> {
    const res = await this.docker(['exec', this.containerId, 'cat', path]);
    if (res.exitCode !== 0) {
      throw new Error(res.stderr.trim() || `cannot read ${path}`);
    }
    return res.stdout;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const dir = dirname(path);
    await this.docker(['exec', this.containerId, 'mkdir', '-p', dir]);
    // Pipe content via stdin into `tee` to avoid shell-escaping issues.
    const res = await this.docker(['exec', '-i', this.containerId, 'tee', path], { input: content });
    if (res.exitCode !== 0) {
      throw new Error(res.stderr.trim() || `cannot write ${path}`);
    }
  }

  async stop(): Promise<void> {
    this.unregisterTeardown?.();
    this.unregisterTeardown = null;
    if (this.ownsContainer && !this.cfg.persistent && this.containerId) {
      await this.docker(['rm', '-f', this.containerId]);
    }
    this.containerId = '';
    this.ownsContainer = false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission/existence check without delivering it.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
