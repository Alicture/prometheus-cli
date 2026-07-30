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
- ⚡ **Skills and prompt commands as slash commands** — `/pdf`, `/gsd:add-phase` …
  every installed skill and every Claude Code `commands/*.md` file is invocable directly
- 🧩 **Claude Code compatible skills** — auto-discovers skills from `~/.claude/skills`,
  project `.claude/skills`, and installed Claude Code plugins, and installs new ones
  straight from GitHub (no `git` required).
- ⌨️ **Slash-command autocomplete** — type `/` for a live suggestion menu.
- 📊 **Live TUI** — streaming responses, tool activity log, token + cost status bar.
- 📝 **Markdown rendering** — assistant replies render as real terminal output:
  box-drawn tables that auto-fit your width, headings, bold/italic, inline code,
  fenced code blocks, lists, task lists, blockquotes, and links (CJK-width aware).

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
| `docker.image` | sandbox image (must exist locally) | `claude-sandbox` |
| `docker.workspace` | working dir inside the container | `/home/sandbox/workspace` |
| `docker.host` | Docker daemon endpoint (else `DOCKER_HOST`) | default socket |
| `docker.containerId` | reuse an existing container | — |
| `docker.persistent` | keep container after exit | `false` |
| `ssh.host` / `ssh.port` / `ssh.username` | remote target | — |
| `ssh.privateKeyPath` / `ssh.password` | auth | — |
| `ssh.workspace` | remote working dir | `~/workspace` |
| `local.workspace` | local working dir | cwd |
| `permissions.mode` | `ask` / `auto` / `readonly` | `ask` |
| `permissions.allow` | tool names allowed without prompting | `[]` |
| `skills.includeClaude` | scan Claude Code skill dirs (`~/.claude`, `~/.agents`, plugins) | `true` |
| `skills.paths` | extra directories to scan for skills | `[]` |
| `skills.disabled` | skill names to hide from the model | `[]` |

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

<details>
<summary><b>Example: any Docker image (e.g. Kali)</b></summary>

The image must already exist locally — pull or build it first. Set a workspace
the container's user can write to (Kali runs as `root`):

```bash
docker pull kalilinux/kali-rolling
prometheus config set environment docker
prometheus config set docker.image kalilinux/kali-rolling
prometheus config set docker.workspace /root/workspace
```

Or from inside the TUI, which switches and restarts the sandbox in one step:

```text
/env docker kalilinux/kali-rolling
/env                                  # shows the active image and workdir
```

Containers are throwaway: each session creates one, labels it, and removes it on
exit. A session that was killed before it could clean up leaves a container
behind, which the next run reaps automatically — containers belonging to another
*running* session are never touched. Set `docker.persistent true` to keep yours.
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
| `/skills` | list available skills (all sources) |
| `/skill install <repo> [name…]` | install skills from GitHub |
| `/skill search <repo>` | list the skills a repo provides |
| `/skill info <name>` | show a skill's metadata, path, bundled files |
| `/skill dirs` | show every directory scanned for skills |
| `/skill reload` | rescan skill directories |
| `/skill remove <name>` | remove an installed skill |
| `/commands [filter]` | list prompt commands from `commands/` dirs and skills |
| `/commands dirs` | show every directory scanned for commands |
| `/<skill> [request]` | run an installed skill, e.g. `/pdf merge a.pdf b.pdf` |
| `/<name> [args]` | run a prompt command, e.g. `/gsd:add-phase auth` |
| `/env` | show the current environment + API base URL |
| `/env docker <image>` | switch to docker with a specific image |
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

Prometheus is **compatible with [Claude Code Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview)** —
a directory containing a `SKILL.md` with `name`/`description` frontmatter plus
instructions and optional bundled files.

### Automatic discovery

Skills you already have for Claude Code work with no migration. Prometheus scans,
in precedence order:

| Precedence | Location | Source |
|---|---|---|
| 1 | `./.claude/skills`, `./.agents/skills` | project |
| 2 | `~/.prometheus/skills` | installed by Prometheus |
| 3 | `~/.claude/skills`, `~/.agents/skills` | user |
| 4 | `~/.claude/plugins/**/skills` | Claude Code plugins |
| 5 | `skills.paths` from your config | extra |

```bash
prometheus skill dirs     # show every scanned directory + how many skills it holds
prometheus skill list     # merged, de-duplicated list with its source
```

### Installing

Install from any GitHub repo — including Claude Code skill repos that keep skills
under `skills/` or ship them inside a plugin. Every `SKILL.md` in the tree is
discovered, and downloads use the GitHub tarball API (**no `git` required**, with a
`git clone` fallback for private repos).

```bash
prometheus skill search anthropics/skills             # see what a repo provides
prometheus skill install anthropics/skills            # install all of them
prometheus skill install anthropics/skills pdf docx   # install only these
prometheus skill install owner/repo/skills/pdf        # a specific subdirectory
prometheus skill install owner/repo#v2                # a branch or tag
prometheus skill install ./local/skill-dir            # a local directory
prometheus skill info pdf                             # metadata, path, bundled files
prometheus skill remove pdf
```

Everything is also available in the TUI: `/skills`, `/skill search`,
`/skill install`, `/skill info`, `/skill dirs`, `/skill reload`, `/skill remove`.

### How skills reach the model

Frontmatter (`name`, `description`, `version`, `license`, `allowed-tools`/`tools`,
`metadata`) is parsed, and only each skill's **name + description** is injected into
the system prompt. When a task matches, the agent calls the built-in `Skill` tool,
which returns the full `SKILL.md` body **plus absolute paths to every bundled file**
(`references/`, `scripts/`, `assets/`, …) so it can read or execute them — the same
progressive-disclosure model Claude Code uses.

Skills installed by Prometheus live in `~/.prometheus/skills/`. Skills discovered
from Claude Code directories are read-only (remove them with Claude Code instead).

### Running a skill directly

Any installed skill is also a slash command. `/pdf merge a.pdf b.pdf` starts a turn
that loads the `pdf` skill and passes your request along — no need to hope the model
picks the right skill on its own.

```text
/pdf extract the tables from report.pdf
/gsd understand this repo
```

### Prompt commands

Prometheus also reads Claude Code's `commands/` directories, where each markdown
file is a reusable prompt. Typing the command sends that prompt as your turn.

| Order | Location | Kind |
|:-----:|----------|------|
| 1 | `./.claude/commands`, `./.agents/commands` | project |
| 2 | `~/.prometheus/commands` | yours |
| 3 | `~/.claude/commands`, `~/.agents/commands` | user |
| 4 | `~/.claude/plugins/**/commands` | Claude Code plugins |
| 5 | `<skill>/commands` | bundled by an installed skill |

Subdirectories namespace the command, exactly as in Claude Code — so
`~/.claude/commands/gsd/add-phase.md` becomes `/gsd:add-phase`, and commands
bundled inside a skill are namespaced under that skill's name.

Frontmatter `description` and `argument-hint` show up in autocomplete, and
`allowed-tools` is passed along as a hint to the model. In the body, `$ARGUMENTS`
receives everything you typed and `$1`…`$9` the individual words (quotes are
respected); if a command uses no placeholder, your arguments are appended rather
than dropped.

```bash
prometheus commands           # list every discovered command
prometheus commands gsd       # filter by name or description
prometheus commands dirs      # show every scanned directory + counts
```

In the TUI, `/commands [filter]`, `/commands dirs` and `/commands reload` do the same.
Built-in commands always win, then prompt commands, then skills.

Tune discovery in your config:

| Key | Description | Default |
|-----|-------------|---------|
| `skills.includeClaude` | scan `~/.claude` and `~/.agents` skill and command dirs | `true` |
| `skills.paths` | extra directories to scan | `[]` |
| `skills.disabled` | skill names to hide from the model | `[]` |

## Architecture

```text
src/
  cli.tsx            entry point + config / models / skill subcommands
  config/            zod-validated config (~/.prometheus/config.json)
  llm/               Claude-compatible + OpenAI-compatible streaming clients
  agent/             agentic loop, system prompt, cost estimate
  tools/             Bash / FileRead / FileWrite / FileEdit / Grep / Glob / Skill
  sandbox/           docker | ssh | local executors (Sandbox interface)
  skills/            SkillManager: discovery / install (GitHub) / frontmatter
                     CommandManager: Claude Code commands/*.md as slash commands
  ui/                Ink components, App, useAgent hook, markdown renderer
```

### Markdown output

Assistant replies are parsed by a dependency-light Markdown parser
(`src/ui/markdown.ts`) and rendered as Ink elements (`ui/components/Markdown.tsx`).
Tables are laid out with real column widths — columns take their natural width and
shrink longest-first with word wrapping when the terminal is narrow — and all
measurements use display columns, so CJK and emoji stay aligned:

```text
┌───────────┬─────────────────────────────────────┐
│ Category  │ Example Skills                      │
├───────────┼─────────────────────────────────────┤
│ Frontend  │ frontend-patterns, swiftui-patterns │
│ Utilities │ pdf, youtube-full, agent-browser    │
└───────────┴─────────────────────────────────────┘
```

Soft line breaks are preserved (GFM-style), so the model's intended line structure
survives rendering.

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
