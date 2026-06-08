import type { Config } from '../config/index.js';
import type { Sandbox } from './types.js';
import { LocalSandbox } from './local.js';
import { DockerSandbox } from './docker.js';
import { SSHSandbox } from './ssh.js';

export type { Sandbox } from './types.js';

// Build the sandbox backend selected in config (docker | ssh | local).
export function createSandbox(config: Config): Sandbox {
  switch (config.environment) {
    case 'docker':
      return new DockerSandbox(config.docker, config.maxOutputSize, config.commandTimeoutMs);
    case 'ssh':
      return new SSHSandbox(config.ssh, config.maxOutputSize, config.commandTimeoutMs);
    case 'local':
      return new LocalSandbox(config.local, config.maxOutputSize);
  }
}
