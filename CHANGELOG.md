# Changelog

## 0.1.0 — 2026-11-01

Initial public shape of the extension formerly developed as
`hide-tool-calls.ts`.

- Four display levels: `name`, `none`, `collapsed`, `full`.
- `ctrl+shift+o` and `/quiet-tools` control the current level.
- Errors remain visible at every level.
- Level persists in `~/.pi/agent/quiet-tools.json`; the old
  `hide-tool-calls.json` is read once and migrated.
- `QUIET_TOOLS_EXEMPT` keeps selected tools at their native rendering.
- Unit tests for mode cycling, labels, error text, and state migration.
