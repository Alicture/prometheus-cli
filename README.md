<div align="center">

# ✶ Prometheus CLI

**Agentic coding in your terminal — powered by any Claude-compatible API, running in the sandbox you choose.**

[![Node](https://img.shields.io/badge/node-%3E%3D18-43853d?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Ink](https://img.shields.io/badge/built%20with-React%20%2B%20Ink-61dafb?logo=react&logoColor=white)](https://github.com/vadimdemedes/ink)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

</div>

---

Prometheus CLI is a terminal client for **agentic coding**. It talks directly to a
**Claude-compatible API** — the native [Anthropic Messages API](https://docs.anthropic.com/en/api/messages),
or any OpenAI-compatible gateway — and executes every tool call inside an
execution environment you control: your **local machine**, a **Docker container**,
or a **remote Linux host over SSH**.

No backend. No server. Everything runs from the CLI.

```text
✶ PROMETHEUS
agentic coding in your terminal · hermes (claude-haiku)
environment: Local: ~/project

› refactor the auth module and run the tests

● Bash  npm test (2.4s)
  ✓ 42 passing
```

## Table of Contents

- [Features](#features)
- [Install](#install)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [In-App Commands](#in-app-commands)
- [Model Tiers](#model-tiers)
- [Permissions](#permissions)
- [Skills](#skills)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🤖 **Claude-compatible API** — native Anthropic Messages API with full streaming
  and tool-use, plus an OpenAI-compatible `/v1/chat/completions` fallback
  (`apiFormat: openai`) for proxy gateways.
- 🧰 **Configurable execution environment** — the core idea:
  - `local` — runs directly on your machine *(default)*
  - `docker` — spins up / reuses a container via the `docker` CLI (point at a custom
    daemon such as colima with `docker.host`)
  - `ssh` — runs on any remote Linux host over SSH (SFTP for file I/O)
- 🎚️ **Three model tiers** — Hermes / Athena / Zeus (haiku / sonnet / opus by
  default), fully configurable and switchable at runtime with `/model`.
- 🔧 **Built-in tools** — Bash, FileRead, FileWrite, FileEdit, Grep, Glob.
- 🔐 **Permission system** — side-effecting tools prompt for approval; read-only
  tools run freely. Approve once, approve for the session, or deny.
- 🧩 **Skills** — install agent skills straight from GitHub and surface them to the
  model on demand.
- ⌨️ **Slash-command autocomplete** — type `/` for a live suggestion menu.
- 📊 **Live TUI** — streaming responses, tool activity log, token + cost status bar.

## Install

```bash
git clone https://github.com/Alicture/prometheus-cli.git
cd prometheus-cli
npm install
npm run build
npm link        # optional: exposes the `prometheus` command globally
```

> **Requirements:** Node 18+. The Docker environment needs Docker installed; the
> SSH environment needs a reachable host.

## Quick Start

```bash
# 1. Configure your Claude-compatible API key
prometheus config set apiKey sk-ant-...        # or export ANTHROPIC_API_KEY

# 2. Pick an environment (defaults to `local`)
prometheus config set environment local         # local | docker | ssh

# 3. Run
prometheus
```

Prefer to run from source without building?

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
| `apiKey` | Claude-compatible API key | env `ANTHROPIC_API_KEY` |
| `baseURL` | Proxy / gateway base URL | provider default |
| `apiFormat` | `anthropic` or `openai` | `anthropic` |
| `selectedTier` | `hermes` / `athena` / `zeus` | `hermes` |
| `modelHermes` / `modelAthena` / `modelZeus` | model IDs per tier | haiku / sonnet / opus |
| `environment` | `local` / `docker` / `ssh` | `local` |
| `docker.image` | sandbox image | `claude-sandbox` |
| `docker.host` | Docker daemon endpoint (else `DOCKER_HOST`) | default socket |
| `docker.containerId` | reuse an existing container | — |
| `docker.persistent` | keep container after exit | `false` |
| `ssh.host` / `ssh.port` / `ssh.username` | remote target | — |
| `ssh.privateKeyPath` / `ssh.password` | auth | — |
| `ssh.workspace` | remote working dir | `~/workspace` |
| `local.workspace` | local working dir | cwd |
| `permissions.mode` | `ask` / `auto` / `readonly` | `ask` |
| `permissions.allow` | tool names allowed without prompting | `[]` |

<details>
<summary><b>Example: remote SSH environment</b></summary>

```bash
prometheus config set environment ssh
prometheus config set ssh.host 203.0.113.10
prometheus config set ssh.username ubuntu
prometheus config set ssh.privateKeyPath ~/.ssh/id_ed25519
prometheus config set ssh.workspace '~/project'
```
</details>

<details>
<summary><b>Example: custom Docker daemon (colima)</b></summary>

```bash
prometheus config set environment docker
prometheus config set docker.host unix:///Users/me/.colima/default/docker.sock
```
</details>

## In-App Commands

Type `/` to open the **command autocomplete** menu — `↑`/`↓` to select, `Tab` to complete.

| Command | Action |
|---------|--------|
| `/help` | show help |
| `/model` | open the interactive model picker |
| `/model <tier>` | switch model tier (hermes / athena / zeus) |
| `/model set <tier> <id>` | set the model ID for a tier |
| `/provider` | show provider settings (API key masked) |
| `/provider key <k>` | set the API key (takes effect immediately) |
| `/provider url <url>` | set the base URL (empty = provider default) |
| `/provider format <anthropic\|openai>` | set the API format |
| `/provider version <v>` | set the `anthropic-version` header |
| `/provider clear <key\|url>` | unset the API key or base URL |
| `/skills` | list installed skills |
| `/skill install <repo>` | install a skill from GitHub |
| `/skill remove <name>` | remove an installed skill |
| `/env` | show the current environment + API base URL |
| `/env <local\|docker\|ssh>` | switch environment and restart the sandbox |
| `/permissions [ask\|auto\|readonly]` | view or set the tool permission mode |
| `/clear` | clear the conversation |
| `/quit` | exit |
| `Esc` | abort the current turn |
| `Ctrl+C` | exit |

## Model Tiers

Prometheus maps three named tiers to model IDs you can change at will:

| Tier | Default model | Use for |
|------|---------------|---------|
| **Hermes** | Claude Haiku | fast, cheap iteration *(default)* |
| **Athena** | Claude Sonnet | balanced everyday work |
| **Zeus** | Claude Opus | the hardest reasoning |

`/model` (no argument) opens an interactive picker:

- `↑` / `↓` — move between tiers
- `↵` — make the highlighted tier active
- `e` — edit the highlighted tier's model ID inline
- `esc` — close

Or configure from the CLI without launching the TUI:

```bash
prometheus models                              # list tiers + model IDs
prometheus models use athena                   # set the active tier
prometheus models set zeus claude-opus-4-1     # change a tier's model ID
```

## Permissions

Because tools can run on your real machine, Prometheus gates side-effecting tools
behind an approval prompt:

- **Read-only tools** (`FileRead`, `Grep`, `Glob`) run without asking.
- **Side-effecting tools** (`Bash`, `FileWrite`, `FileEdit`, `Skill`) prompt before
  running: <kbd>a</kbd>/<kbd>↵</kbd> allow once · <kbd>s</kbd> allow for the session
  · <kbd>d</kbd>/<kbd>esc</kbd> deny.

Set the mode with `/permissions <mode>` or `permissions.mode`:

| Mode | Behavior |
|------|----------|
| `ask` | prompt before every side effect *(default)* |
| `auto` | run everything without prompting |
| `readonly` | auto-deny all side-effecting tools |

## Skills

Install **agent skills** — a directory containing a `SKILL.md` with `name` and
`description` frontmatter plus instructions — straight from GitHub:

```bash
prometheus skill install owner/repo                 # SKILL.md at repo root
prometheus skill install owner/repo/skills/pdf      # SKILL.md in a subdirectory
prometheus skill install owner/repo#v2              # a specific branch/tag
prometheus skill install https://github.com/owner/repo/tree/main/skills/pdf
prometheus skill list
prometheus skill remove pdf
```

Installed skills live in `~/.prometheus/skills/`. Their `name` + `description` are
injected into the system prompt, and the agent loads a skill's full instructions on
demand via the built-in `Skill` tool — so skills extend what Prometheus can do
without bloating every prompt. Manage them in the TUI too with `/skill install`,
`/skill remove`, and `/skills`.

## Architecture

```text
src/
  cli.tsx            entry point + config / models / skill subcommands
  config/            zod-validated config (~/.prometheus/config.json)
  llm/               Claude-compatible + OpenAI-compatible streaming clients
  agent/             agentic loop, system prompt, cost estimate
  tools/             Bash / FileRead / FileWrite / FileEdit / Grep / Glob / Skill
  sandbox/           docker | ssh | local executors (Sandbox interface)
  skills/            SkillManager: install (GitHub) / list / remove
  ui/                Ink components, App, useAgent hook
```

The agent loop streams a model turn, dispatches any `tool_use` calls into the
selected sandbox, feeds `tool_result` blocks back, and repeats until the model
stops or `maxTurns` is reached.

## Contributing

Contributions are welcome! To get started:

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsc → dist/
```

Please keep changes focused and follow [Conventional Commits](https://www.conventionalcommits.org).

## License

[MIT](LICENSE) © Alicture
