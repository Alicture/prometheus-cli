# Prometheus CLI

**Agentic coding in your terminal — in a configurable Docker or remote sandbox.**

Prometheus CLI is a terminal reimplementation of the Prometheus SwiftUI desktop
app, built with [React](https://react.dev) + [Ink](https://github.com/vadimdemedes/ink).
It talks directly to a **Claude-compatible API** (the native Anthropic Messages
API, or any OpenAI-compatible gateway) and runs all tool commands inside an
execution environment you choose: a **Docker container**, a **remote host over
SSH**, or your **local machine**.

There is no backend server — everything runs from the CLI.

```
✶ PROMETHEUS
agentic coding in your terminal · hermes (claude-haiku-4-20250414)
environment: Docker: claude-sandbox

› refactor the auth module and run the tests

● Bash  npm test (2.4s)
  ...
```

## Features

- **Claude-compatible API** (required): native Anthropic Messages API by default,
  with full streaming and tool-use. OpenAI-compatible `/v1/chat/completions` is
  also supported (`apiFormat: openai`) for proxy gateways.
- **Configurable environment** (the core feature):
  - `docker` — spins up / reuses a container via the `docker` CLI
  - `ssh` — runs on any remote Linux host over SSH (SFTP for file I/O)
  - `local` — runs directly on your machine
- **Three model tiers** — Hermes / Athena / Zeus (haiku / sonnet / opus by
  default), fully configurable and switchable at runtime with `/model`.
- **Six tools** — Bash, FileRead, FileWrite, FileEdit, Grep, Glob — mirrored
  from the original sandbox toolset.
- **Live TUI** — streaming responses, tool activity log, token + cost status bar.
- **Custom proxy / base URL** — point at your own gateway.

## Install

```bash
npm install
npm run build
npm link        # optional: exposes the `prometheus` command globally
```

Requires Node 18+. For the Docker environment you need Docker installed; for SSH
you need a reachable host.

## Quick start

```bash
# 1. Configure your Claude-compatible API key
prometheus config set apiKey sk-ant-...        # or export ANTHROPIC_API_KEY

# 2. Pick an environment
prometheus config set environment docker        # docker | ssh | local
prometheus config set docker.image claude-sandbox

# 3. Run
prometheus
```

Or skip the build and run from source:

```bash
npm run dev
```

## Configuration

Config lives at `~/.prometheus/config.json`. Inspect or edit it with:

```bash
prometheus config                       # show all values
prometheus config init                  # write defaults
prometheus config set <key> <value>     # dotted keys supported
```

| Key | Description | Default |
|-----|-------------|---------|
| `apiKey` | Claude-compatible API key | (env `ANTHROPIC_API_KEY`) |
| `baseURL` | Proxy / gateway base URL | provider default |
| `apiFormat` | `anthropic` or `openai` | `anthropic` |
| `selectedTier` | `hermes` / `athena` / `zeus` | `hermes` |
| `modelHermes` / `modelAthena` / `modelZeus` | model IDs per tier | claude haiku/sonnet/opus |
| `environment` | `docker` / `ssh` / `local` | `docker` |
| `docker.image` | sandbox image | `claude-sandbox` |
| `docker.containerId` | reuse an existing container | (none) |
| `docker.persistent` | keep container after exit | `false` |
| `ssh.host` / `ssh.port` / `ssh.username` | remote target | |
| `ssh.privateKeyPath` / `ssh.password` | auth | |
| `ssh.workspace` | remote working dir | `~/workspace` |
| `local.workspace` | local working dir | cwd |

### Example: remote SSH environment

```bash
prometheus config set environment ssh
prometheus config set ssh.host 203.0.113.10
prometheus config set ssh.username ubuntu
prometheus config set ssh.privateKeyPath ~/.ssh/id_ed25519
prometheus config set ssh.workspace '~/project'
```

## In-app commands

| Command | Action |
|---------|--------|
| `/help` | show help |
| `/model` | open the interactive model picker |
| `/model <tier>` | switch model tier (hermes / athena / zeus) |
| `/model set <tier> <id>` | set the model ID for a tier |
| `/env` | show current environment + API base URL |
| `/clear` | clear the conversation |
| `/quit` | exit |
| `Esc` | abort the current turn |
| `Ctrl+C` | exit |

### Model picker

`/model` (no argument) opens an interactive picker:

- `↑` / `↓` — move between tiers
- `↵` — make the highlighted tier active
- `e` — edit the highlighted tier's model ID inline
- `esc` — close

The same configuration is available from the CLI without launching the TUI:

```bash
prometheus models                              # list tiers + model IDs
prometheus models use athena                   # set the active tier
prometheus models set zeus claude-opus-4-1     # change a tier's model ID
```

## Architecture

```
src/
  cli.tsx            entry point + `config` subcommand
  config/            zod-validated config (~/.prometheus/config.json)
  llm/               Claude-compatible + OpenAI-compatible streaming clients
  agent/             agentic loop, system prompt, cost estimate
  tools/             Bash / FileRead / FileWrite / FileEdit / Grep / Glob
  sandbox/           docker | ssh | local executors (Sandbox interface)
  ui/                Ink components, App, useAgent hook
```

The agent loop streams a model turn, dispatches any `tool_use` calls into the
selected sandbox, feeds `tool_result` blocks back, and repeats until the model
stops or `maxTurns` is reached.
