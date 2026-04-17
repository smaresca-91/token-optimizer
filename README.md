# token-optimizer

> Post-turn token tracker, cost estimator, and context compactor for **Claude Code** and **Codex CLI**.

Every turn in an AI coding session eats context. Once you hit ~80% of the context window, quality starts to degrade: responses get slower, more expensive, and occasionally lose track of details. `token-optimizer` is a small, zero-config plugin that sits between your CLI and the model and keeps an eye on things for you.

## What it does

After every turn:

- **Measures** real token usage by parsing the session transcript with proper tokenizers (`@anthropic-ai/tokenizer` for Claude, `gpt-tokenizer` for Codex)
- **Shows** a colored pressure bar (`OK` / `WARN` / `HIGH` / `CRITICAL`)
- **Displays** your plan quota (5-hour session + weekly + Opus-weekly) with reset countdown
- **Estimates** the running USD cost of the session
- **Logs** every session to a JSONL file for trend analysis

When the context gets tight:

- **Warns you** to run `/compact` at `HIGH` (75%)
- **Injects** a Caveman-mode instruction into the model's context at `CRITICAL` (90%), nudging it to produce shorter, filler-free replies
- **Compresses** your own verbose prompts automatically (English + Italian)
- **Backs up** the full transcript before any `/compact` so nothing is lost

## Hooks installed

| Hook | Claude Code | Codex CLI | Purpose |
|---|:-:|:-:|---|
| `Stop` | ✅ | ✅ | Post-turn report + critical-pressure injection |
| `UserPromptSubmit` | ✅ | ✅ | Caveman-compress prompt when pressure is high |
| `PreCompact` | ✅ | ❌* | Archive transcript before `/compact` (20-file rotation) |

*Codex CLI does not yet expose a `PreCompact` event. The installer skips it gracefully.*

## How it looks

After a turn, printed on stderr (visible to you, invisible to the model):

```
 CRITICAL  COMPACT NOW  91.2%  ██████████████████░░
tokens:182,400  turns:47  u:320  a:175,080  t:7,000  cost:$2.7360
>> Run /compact now. Auto-trim armed.

Plan limits (claude-code):
  5-hour     ██████░░░░░░░░░░░░  34%  reset:2h30m
  7-day      ████████████░░░░░░  67%  reset:3d4h
  7-day Opus █████████████████░  92%  reset:3d4h
```

- **Session bar** (first line) = current context window usage
- **Plan limits** = your Max/Pro/ChatGPT subscription quota (5-hour + weekly, reset countdown)
- Colors: green <50%, blue <75%, yellow <90%, red ≥90%

At critical pressure, the hook emits JSON on stdout that Claude Code / Codex feeds back into the model:

```json
{
  "hookSpecificOutput": {
    "additionalContext": "[token-optimizer] Context 91% full. Apply Caveman mode: short sentences, no filler. Suggest /compact."
  }
}
```

## Caveman mode

Strips filler words (articles, prepositions, intensifiers) and truncates overly long sentences. Works in English and Italian. **Preserves code blocks verbatim** (fenced ` ``` ` and inline `` ` ``).

Two modes:

- **`always`** *(maximum savings, aggressive)* — compresses every user prompt and instructs the model to respond terse on every turn, regardless of pressure. Estimated savings: 30–50% on full session tokens.
- **`threshold`** *(default, bandwidth-safe)* — kicks in only when context ≥ 75%.

Toggle from CLI without editing config:

```bash
node bin/cli.js caveman on         # always mode (maximum savings)
node bin/cli.js caveman off        # disable completely
node bin/cli.js caveman threshold  # only compress when context fills up
```

Example compression (English):

```
Input:  "Basically, I think that we should actually implement the auth module with a really simple JWT flow"
Output: "I think we should implement auth module simple JWT flow"
Savings: 41%
```

Italian also works:

```
Input:  "Praticamente dovremmo implementare il modulo di autenticazione con un flusso JWT molto semplice"
Output: "dovremmo implementare modulo autenticazione flusso JWT semplice"
Savings: 40%
```

**Escape hatch.** If you need a detailed answer on a specific turn, include the phrase *"explain in detail"* in your prompt — the model is instructed to ignore Caveman for that turn only.

## Install

Requires Node.js ≥ 18.

```bash
git clone https://github.com/smaresca-91/token-optimizer.git
cd token-optimizer
npm install
node bin/install.js install all
```

Then **restart your Claude Code / Codex CLI session**. The hooks activate on startup.

Install selectively if you only use one CLI:

```bash
node bin/install.js install claude   # Claude Code only
node bin/install.js install codex    # Codex CLI only
```

To remove:

```bash
node bin/install.js uninstall all
```

The installer merges into your existing `~/.claude/settings.json` and `~/.codex/hooks.json`. It never overwrites other hooks.

## CLI

```bash
node bin/cli.js stats                  # aggregate usage across sessions
node bin/cli.js limits                 # show plan quota (5h + weekly) for Claude + Codex
node bin/cli.js caveman [on|off|threshold]  # toggle always-on compression
node bin/cli.js analyze <file.jsonl>   # inspect a single transcript
node bin/cli.js test-caveman "<text>"  # preview caveman compression
node bin/cli.js backups                # list pre-compact backups
node bin/cli.js config                 # show active config + tokenizer status
node bin/cli.js reset                  # clear usage log
```

Tip: add an alias to your shell rc:

```bash
alias tko='node ~/path/to/token-optimizer/bin/cli.js'
```

## Configuration

Override defaults at `~/.token-optimizer/config.json`:

```json
{
  "thresholds": {
    "warn": 0.60,
    "compact": 0.75,
    "critical": 0.90
  },
  "contextWindow": {
    "claude-code": 200000,
    "codex": 200000
  },
  "compaction": {
    "mode": "hybrid"
  },
  "caveman": {
    "enabled": true,
    "stripFillers": true,
    "maxSentenceWords": 12
  },
  "reporting": {
    "showCost": true,
    "showPlanLimits": true,
    "planLimitsCacheSeconds": 60,
    "persistLog": true
  }
}
```

`compaction.mode` options:

- `manual` — just show the alert, let the user decide
- `trim` — drop middle turns, keep first 2 + last N
- `summarize` — call Claude Haiku 4.5 to summarize old turns (needs `ANTHROPIC_API_KEY`)
- `hybrid` *(default)* — alert + Caveman injection + `/compact` suggestion

## How it works

The plugin relies on two CLI lifecycle features that both Claude Code and Codex CLI expose:

1. **Dual-channel output.** stderr is shown to the user, stdout is parsed by the host as JSON and can feed instructions back to the model. `token-optimizer` uses stderr for the pressure bar and stdout (sparingly) only when context is critical.
2. **Transcript on disk.** Both CLIs pass the path to the current session transcript in the hook payload. The plugin reads it, counts tokens with a real tokenizer, and derives everything from there.

```
┌───────────────┐   hook event    ┌──────────────────┐
│ Claude Code / │ ──────────────► │ token-optimizer  │
│   Codex CLI   │   JSON stdin    │    hook script   │
└───────────────┘                 └────────┬─────────┘
        ▲                                  │
        │   stderr: bar + cost             │
        │   stdout: additionalContext      │
        └──────────────────────────────────┘
```

## Project layout

```
token-optimizer/
├── bin/
│   ├── cli.js                  # CLI entry point
│   ├── hook.js                 # Stop hook
│   ├── hook-user-prompt.js     # UserPromptSubmit hook
│   ├── hook-precompact.js      # PreCompact hook (Claude only)
│   └── install.js              # Hook registration / removal
├── src/
│   ├── core.js                 # Config, transcript parsing, logging
│   ├── tokenizer.js            # Multi-provider tokenizer with fallback
│   ├── caveman.js              # Filler stripping (EN + IT)
│   ├── cost.js                 # USD estimation
│   ├── reporter.js             # ANSI pressure bar
│   └── strategies/
│       ├── trim.js             # Keep first + last turns
│       └── summarize.js        # Haiku-based summary
└── config/default.json
```

Around 700 lines of plain JavaScript, two runtime deps (both tokenizers), fully ESM.

## Known limitations

- **Plan limits use undocumented endpoints.** Claude Code reads `api.anthropic.com/api/oauth/usage` and Codex reads `chatgpt.com/backend-api/wham/usage`. Both are internal APIs the CLIs use themselves — they work today but Anthropic / OpenAI could change them without notice. Falls back gracefully if unavailable.
- **Auth tokens.** Claude reads the OAuth token from the macOS Keychain (`Claude Code-credentials`) or `~/.claude/.credentials.json` on Linux. Codex reads `~/.codex/auth.json`. If you use an API key instead of subscription auth, plan-limit endpoints won't work — only token/cost tracking will.
- **Codex hooks are experimental upstream.** OpenAI may change the API; raise an issue if something breaks.
- **Windows.** Codex hooks are currently disabled on Windows by OpenAI. Claude Code hooks work fine.
- **Context window.** The default of 200k tokens matches the current Claude / GPT-5 families. If you use a model with a different window, adjust `contextWindow` in your config.
- **`summarize` strategy** needs `ANTHROPIC_API_KEY` in your environment.

## Roadmap

- [ ] Actual auto-compact (call `/compact` programmatically, not just suggest)
- [ ] Local web dashboard on a configurable port
- [ ] Shared MCP server for team-wide metrics
- [ ] Per-tool heatmap (which tools burn the most context)
- [ ] Side-by-side benchmark mode: same task on Claude Code vs Codex

Pull requests welcome.

## License

MIT

## Credits

Hook specs based on official [Claude Code](https://code.claude.com/docs/en/hooks) and [Codex CLI](https://developers.openai.com/codex/hooks) documentation.
