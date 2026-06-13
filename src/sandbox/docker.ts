import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { ExecResult } from '../types.js';
import type { DockerConfig } from '../config/index.js';
import { spawnCapture, truncate } from '../utils/proc.js';
import type { Sandbox, SandboxStatus } from './types.js';

// Runs commands inside a Docker container via the `docker` CLI, mirroring the
// original Bun server's sandbox manager (docker run / exec / tee / cat).
export class DockerSandbox implements Sandbox {
  readonly workdir: string;
  private cfg: DockerConfig;
  private maxOutputSize: number;
  private commandTimeoutMs: number;
  private containerId = '';
  private ownsContainer = false;

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
    // Point the docker CLI at a custom daemon when configured (config wins over
    // any inherited DOCKER_HOST so behaviour is reproducible).
    const env = this.cfg.host
      ? { ...process.env, DOCKER_HOST: this.cfg.host }
      : process.env;
    return spawnCapture('docker', args, { input: opts.input, timeoutMs: opts.timeoutMs, env });
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

    // 4. Create a fresh container.
    const name = `claude-sandbox-${randomUUID().slice(0, 8)}`;
    const run = await this.docker(
      [
        'run',
        '-d',
        '--name',
        name,
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
    await this.ensureWorkdir();
    onStatus?.('ready');
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
    if (this.ownsContainer && !this.cfg.persistent && this.containerId) {
      await this.docker(['rm', '-f', this.containerId]);
    }
  }
}
