# Changelog

## 0.3.1

- The band no longer fetches assignee photos. It shows initials.
- The band no longer runs a shell. It reads `HOME` directly.
- The band takes its theme from Claude Code's `theme` setting, and asks macOS
  only when that setting is auto. It no longer reads the Claude app's
  `config.json`.
- Open Gitsu on a development-build item shows a note instead of starting the
  dev binary.
- Each `tool.call` hook names its tool in full.
- `plugin.json` drops the `types` field.

## 0.3.0

- Ships the Gitsu MCP server through the plugin, alongside the band above the prompt.
