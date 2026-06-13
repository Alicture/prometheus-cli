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
environment: Local: ~/project

› refactor the auth module and run the tests

● Bash  npm test (2.4s)
  ...
```

## Features

- **Claude-compatible API** (required): native Anthropic Messages API by default,
  with full streaming and tool-use. OpenAI-compatible `/v1/chat/completions` is
  also supported (`apiFormat: openai`) for proxy gateways.
- **Configurable environment** (the core feature):
  - `local` — runs directly on your machine (default)
  - `docker` — spins up / reuses a container via the `docker` CLI (set
    `docker.host` for a custom daemon such as colima)
  - `ssh` — runs on any remote Linux host over SSH (SFTP for file I/O)
- **Three model tiers** — Hermes / Athena / Zeus (haiku / sonnet / opus by
  default), fully configurable and switchable at runtime with `/model`.
- **Six tools** — Bash, FileRead, FileWrite, FileEdit, Grep, Glob — mirrored
  from the original sandbox toolset.
- **Skills** — install agent skills from GitHub (`prometheus skill install owner/repo`);
  installed skills are surfaced to the model and loaded on demand via a `Skill` tool.
- **Slash-command autocomplete** — type `/` for a live suggestion menu (↑↓ to
  select, Tab to complete).
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

# 2. Pick an environment (defaults to `local`)
prometheus config set environment local         # local | docker | ssh
# For Docker, optionally point at a custom daemon (e.g. colima):
# prometheus config set environment docker
# prometheus config set docker.host unix:///Users/me/.colima/default/docker.sock

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
| `environment` | `local` / `docker` / `ssh` | `local` |
| `docker.image` | sandbox image | `claude-sandbox` |
| `docker.host` | Docker daemon endpoint (else `DOCKER_HOST`) | (default socket) |
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
| `/skills` | list installed skills |
| `/skill install <repo>` | install a skill from GitHub |
| `/skill remove <name>` | remove an installed skill |
| `/env` | show current environment + API base URL |
| `/clear` | clear the conversation |
| `/quit` | exit |
| `Esc` | abort the current turn |
| `Ctrl+C` | exit |

Type `/` to open the **command autocomplete** menu — `↑`/`↓` to select, `Tab` to complete.

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

## Skills

Prometheus supports installable **agent skills** — a directory containing a
`SKILL.md` with `name` and `description` frontmatter plus instructions. Install
skills directly from GitHub:

```bash
prometheus skill install owner/repo                 # SKILL.md at repo root
prometheus skill install owner/repo/skills/pdf      # SKILL.md in a subdirectory
prometheus skill install owner/repo#v2              # a specific branch/tag
prometheus skill install https://github.com/owner/repo/tree/main/skills/pdf
prometheus skill list
prometheus skill remove pdf
```

You can also manage skills inside the TUI with `/skill install <repo>`,
`/skill remove <name>`, and `/skills`.

Installed skills live in `~/.prometheus/skills/`. Their `name` + `description`
are injected into the system prompt, and the agent loads a skill's full
instructions on demand by calling the built-in `Skill` tool — so skills extend
what Prometheus can do without bloating every prompt.

## Architecture

```
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
