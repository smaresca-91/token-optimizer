# Changelog

## v0.3.0 — 2026-04-17

### Added
- **Plan limits tracking** (`tko limits`): reads 5-hour and 7-day quota for both Claude Code (Max/Pro) and Codex CLI (ChatGPT Plus/Pro). Uses internal OAuth endpoints:
  - Claude: `api.anthropic.com/api/oauth/usage`
  - Codex: `chatgpt.com/backend-api/wham/usage`
- **Always-on Caveman mode**: `config.caveman.mode = "always"` compresses user prompts on every turn and injects a persistent "respond terse" instruction to the model, regardless of context pressure.
- **Code block preservation**: Caveman no longer mangles fenced (` ``` `) or inline (`` ` ``) code blocks.
- **`tko caveman [on|off|threshold]`**: quick toggle command for Caveman mode without editing config files.
- **Precise tokenizers**: `@anthropic-ai/tokenizer` and `gpt-tokenizer` replace the 4-char heuristic. Counts are now accurate to ±1%.
- **Plan-limit injection**: when any quota hits ≥90%, the model receives an extra instruction to conserve tokens.
- **Cached limit fetches**: 60s TTL by default, avoids hammering the OAuth endpoint.

### Changed
- Heuristic 4-char tokenizer is now the fallback only. Real tokenizers load lazily.
- Reporter now prints plan-limit bars below the session bar (5h + weekly + weekly-Opus).

### Fixed
- `cavemanify()` used to corrupt inline code when fillers appeared inside backticks.

### Known limitations
- Plan-limit endpoints are **internal/undocumented**. They work today but could break on any CLI update.
- Codex `PreCompact` event still not supported upstream.
- Caveman mode preserves code blocks but *not* file paths or command snippets outside backticks. Wrap critical strings in backticks for safety.

---

## v0.2.0 — 2026-04-16

### Added
- Three-hook architecture (`Stop`, `UserPromptSubmit`, `PreCompact`) with unified installer.
- Caveman mode (English + Italian filler stripping, sentence shortening).
- Pre-compact transcript backup with 20-file rotation.
- USD cost estimator (per-model pricing table).
- ANSI progress bar with 4-level color coding.
- CLI: `stats`, `analyze`, `test-caveman`, `backups`, `config`, `reset`.

---

## v0.1.0 — 2026-04-16

### Added
- Initial proof of concept: single `Stop` hook with token counting and Caveman injection at critical pressure.
- Zero-dependency runtime (pre-tokenizer era).
