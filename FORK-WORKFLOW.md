# Pi-Mono Fork Workflow

How to maintain a patched fork of pi-mono alongside the production install.

## Current Setup

- Production pi: `/opt/homebrew/bin/pi` → `../lib/node_modules/@mariozechner/pi-coding-agent/dist/cli.js`
- Version: 0.54.2
- Installed via: `npm install -g @mariozechner/pi-coding-agent`

Do not touch the global install. It stays as your stable daily driver.

## Initial Setup (One Time)

### 1. Fork and clone

```bash
cd ~/pi/workspace
gh repo fork badlogic/pi-mono --clone -- pi-mono-fork
cd pi-mono-fork
```

### 2. Create your branch

```bash
git checkout -b ttsr-hook
```

### 3. Install dependencies

```bash
npm install
```

### 4. Build everything

```bash
npm run build
```

This compiles all packages in dependency order: `tui` → `ai` → `agent` → `coding-agent` → others. Each package gets a `dist/` directory with compiled JS.

### 5. Set up the alias

Add to your `~/.zshrc` (or `~/.bashrc`):

```bash
alias pi-dev="node ~/pi/workspace/pi-mono-fork/packages/coding-agent/dist/cli.js"
```

Then reload:

```bash
source ~/.zshrc
```

### 6. Verify it works

```bash
pi --version      # should show 0.54.2 (production)
pi-dev --version  # should show whatever version is in the fork
```

## Daily Usage

### Two commands, two versions

| Command | What it runs | When to use |
|---|---|---|
| `pi` | Global install (stable, unmodified) | Normal work |
| `pi-dev` | Your fork (with TTSR patch + any other changes) | Testing your changes |

### Your extensions work with both

Extensions like megapowers, pi-web-tools, pi-agent-browser declare `peerDependencies` on `@mariozechner/pi-coding-agent`. When you run `pi-dev`, the fork's packages resolve automatically. The extensions are loaded by the running pi instance — no dependency changes needed in your extension repos.

## Making Changes

### Edit → Build → Test cycle

```bash
cd ~/pi/workspace/pi-mono-fork

# 1. Edit source files
#    e.g. packages/agent/src/agent-loop.ts

# 2. Build
npm run build

# 3. Test
pi-dev
```

### Faster iteration with watch mode

Terminal 1:
```bash
cd ~/pi/workspace/pi-mono-fork
npm run dev    # watches all packages, auto-rebuilds on save
```

Terminal 2:
```bash
pi-dev         # restart after each rebuild to pick up changes
```

### Running checks before committing

```bash
cd ~/pi/workspace/pi-mono-fork
npm run check   # type checking, linting — must pass clean
./test.sh       # full test suite
```

## Keeping in Sync with Upstream

Mario pushes updates to `badlogic/pi-mono`. Periodically pull those in:

```bash
cd ~/pi/workspace/pi-mono-fork

# First time only: add upstream remote
git remote add upstream https://github.com/badlogic/pi-mono.git

# Sync
git fetch upstream
git rebase upstream/main    # rebases your ttsr-hook branch onto latest main
npm install                 # in case dependencies changed
npm run build               # rebuild with upstream changes + your patch
```

The TTSR patch is ~75 lines across 4 files. Rebase conflicts should be rare. If a conflict hits a file you modified, resolve it manually. If it's in a file you didn't touch, something went wrong — abort and investigate.

```bash
# If rebase goes sideways
git rebase --abort
# Then try again or ask for help
```

## Updating the Production Install

When Mario releases a new pi version and you want it:

```bash
npm install -g @mariozechner/pi-coding-agent@latest
pi --version   # should show new version
```

This doesn't affect your fork. The two are completely independent.

## Submitting the PR (When Ready)

If the patch is solid and Mario is receptive:

```bash
cd ~/pi/workspace/pi-mono-fork
git push origin ttsr-hook
```

Then on GitHub: open a PR from `your-username:ttsr-hook` → `badlogic:main`.

Per CONTRIBUTING.md:
1. Open an issue first describing the change (one screen max)
2. Wait for `lgtm` from Mario
3. Then submit the PR
4. Do NOT edit CHANGELOG.md — maintainers handle that

## File Map

Where things live:

```
~/pi/workspace/
  pi-mono-audit/          # this audit repo (docs, analysis)
    AUDIT-OPUS.md         # SOTA comparison
    UPGRADE-PLAN.md       # prioritized feature plan
    TTSR.md               # TTSR spec (patch + extension)
    FORK-WORKFLOW.md      # this file
  pi-mono-fork/           # your fork of pi-mono (after setup)
    packages/
      agent/src/          # where TTSR patch goes (agent-loop.ts, types.ts)
      coding-agent/src/   # where extension API changes go
      ai/src/             # LLM provider code (no changes needed)
      tui/src/            # terminal UI (no changes needed)
  pi-prompt-assembler/    # standalone extension repo
    PI-PROMPT-ASSEMBLER.md
  pi-megapowers/          # your workflow extension
  pi-web-tools/           # your web search extension
  pi-agent-browser/       # your browser extension
```

## Troubleshooting

**`pi-dev` command not found**: Reload shell (`source ~/.zshrc`) or check the alias path.

**Build fails after upstream rebase**: `npm install` first (dependencies may have changed), then `npm run build`.

**Extensions not loading with `pi-dev`**: Make sure you're running `pi-dev` from the project directory where the extensions are installed (where `.pi/` lives).

**Type errors after editing**: Run `npm run check` to see the full error output. Fix all errors before testing — partial builds can cause confusing runtime failures.
