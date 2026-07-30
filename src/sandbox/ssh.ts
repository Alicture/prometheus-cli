import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Client, type SFTPWrapper } from 'ssh2';
import type { ExecResult } from '../types.js';
import type { SSHConfig } from '../config/index.js';
import { truncate } from '../utils/proc.js';
import type { Sandbox, SandboxStatus } from './types.js';

// Runs commands on a remote host over SSH. This is the "remote environment"
// option — the user points Prometheus at any Linux box they can SSH into.
export class SSHSandbox implements Sandbox {
  workdir: string;
  readonly isHost = false;
  private cfg: SSHConfig;
  private maxOutputSize: number;
  private commandTimeoutMs: number;
  private conn: Client | null = null;
  private home = '';

  constructor(cfg: SSHConfig, maxOutputSize: number, commandTimeoutMs: number) {
    this.cfg = cfg;
    this.workdir = cfg.workspace;
    this.maxOutputSize = maxOutputSize;
    this.commandTimeoutMs = commandTimeoutMs;
  }

  describe(): string {
    return `SSH: ${this.cfg.username}@${this.cfg.host}`;
  }

  async start(onStatus?: SandboxStatus): Promise<void> {
    onStatus?.('creating');
    if (!this.cfg.host) {
      onStatus?.('error', 'SSH host not configured.');
      throw new Error('ssh host not configured');
    }

    const conn = new Client();
    await new Promise<void>((res, rej) => {
      conn.on('ready', () => res());
      conn.on('error', (err) => rej(err));
      try {
        conn.connect({
          host: this.cfg.host,
          port: this.cfg.port,
          username: this.cfg.username,
          privateKey: this.cfg.privateKeyPath ? readFileSync(this.cfg.privateKeyPath) : undefined,
          password: this.cfg.password || undefined,
          readyTimeout: 15_000,
        });
      } catch (err) {
        rej(err);
      }
    }).catch((err) => {
      onStatus?.('error', `SSH connect failed: ${(err as Error).message}`);
      throw err;
    });
    this.conn = conn;

    // Resolve $HOME so we can expand "~" for SFTP paths.
    const home = await this.rawExec('echo $HOME');
    this.home = home.stdout.trim() || '/root';
    this.workdir = this.expand(this.cfg.workspace);
    await this.rawExec(`mkdir -p ${this.shellQuote(this.workdir)}`);
    onStatus?.('ready');
  }

  private expand(path: string): string {
    if (path === '~') return this.home;
    if (path.startsWith('~/')) return this.home + path.slice(1);
    return path;
  }

  private shellQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
  }

  private rawExec(command: string, timeoutMs?: number): Promise<ExecResult> {
    const conn = this.conn;
    if (!conn) return Promise.reject(new Error('ssh not connected'));
    return new Promise<ExecResult>((resolve, reject) => {
      conn.exec(command, (err, stream) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        let code = 0;
        const timer = timeoutMs
          ? setTimeout(() => {
              stream.close();
              resolve({ stdout, stderr: stderr + `\n[timed out after ${timeoutMs}ms]`, exitCode: 124 });
            }, timeoutMs)
          : null;
        stream
          .on('close', (c: number) => {
            if (timer) clearTimeout(timer);
            code = c ?? 0;
            resolve({ stdout, stderr, exitCode: code });
          })
          .on('data', (d: Buffer) => (stdout += d.toString()))
          .stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      });
    });
  }

  async exec(command: string, opts: { cwd?: string; timeoutMs?: number } = {}): Promise<ExecResult> {
    const cwd = this.expand(opts.cwd ?? this.workdir);
    const wrapped = `cd ${this.shellQuote(cwd)} && ${command}`;
    const res = await this.rawExec(wrapped, opts.timeoutMs ?? this.commandTimeoutMs);
    return {
      stdout: truncate(res.stdout, this.maxOutputSize),
      stderr: truncate(res.stderr, this.maxOutputSize),
      exitCode: res.exitCode,
    };
  }

  private sftp(): Promise<SFTPWrapper> {
    const conn = this.conn;
    if (!conn) return Promise.reject(new Error('ssh not connected'));
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
    });
  }

  async readFile(path: string): Promise<string> {
    const sftp = await this.sftp();
    const full = this.expand(path);
    return new Promise((resolve, reject) => {
      sftp.readFile(full, (err, buf) => (err ? reject(err) : resolve(buf.toString('utf8'))));
    });
  }

  async writeFile(path: string, content: string): Promise<void> {
    const full = this.expand(path);
    const dir = full.slice(0, full.lastIndexOf('/')) || '/';
    await this.rawExec(`mkdir -p ${this.shellQuote(dir)}`);
    const sftp = await this.sftp();
    return new Promise((resolve, reject) => {
      sftp.writeFile(full, content, (err) => (err ? reject(err) : resolve()));
    });
  }

  // Ship the directory as a gzipped tarball (over SFTP, so it is not limited by
  // the shell's argument size) and unpack it remotely. tar preserves the
  // permission bits that make bundled scripts executable.
  async pushDir(hostDir: string, dest: string): Promise<void> {
    const tar = execFileSync('tar', ['-czf', '-', '-C', hostDir, '.'], {
      maxBuffer: 256 * 1024 * 1024,
    });
    const remoteDest = this.expand(dest);
    const tmp = `/tmp/prometheus-push-${randomUUID().slice(0, 8)}.tgz`;
    const sftp = await this.sftp();
    await new Promise<void>((resolve, reject) => {
      sftp.writeFile(tmp, tar, (err) => (err ? reject(err) : resolve()));
    });
    const res = await this.rawExec(
      `mkdir -p ${this.shellQuote(remoteDest)} && tar -xzf ${this.shellQuote(tmp)} -C ${this.shellQuote(remoteDest)}; rc=$?; rm -f ${this.shellQuote(tmp)}; exit $rc`,
      120_000,
    );
    if (res.exitCode !== 0) {
      throw new Error(res.stderr.trim() || `cannot copy ${hostDir} to the remote host`);
    }
  }

  async stop(): Promise<void> {
    this.conn?.end();
    this.conn = null;
  }
}
