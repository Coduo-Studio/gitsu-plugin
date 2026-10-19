# Gitsu for Claude Code

Gitsu is a macOS app for GitHub Projects v2 boards. This plugin lets Claude Code
read and update the items on your boards, and shows the items Claude is working
on, plus any `#N` you mention, above the prompt.

## Requirements

- macOS only.
- The Gitsu app, installed from https://gitsu.app and signed in to GitHub.
- A Gitsu Pro subscription. Without it, every tool answers that agent access needs Pro.
- For writes (anything that changes an item), the Gitsu app must be open and
  agent writes must be on. Reads work with the app closed.

## Install

```
/plugin marketplace add Coduo-Studio/gitsu-plugin
/plugin install gitsu@gitsu
```

## What it runs

The plugin starts `bin/gitsu-mcp`, a small launcher. It finds your installed
Gitsu.app and hands over to the `gitsu-mcp` binary inside it. The plugin
contains no server code of its own. If Gitsu is not installed, the launcher
prints an install message and exits.

The `hooks/` code draws the band above the prompt. It runs inside Claude Code.

## Tools

`list_projects`, `list_items`, `get_item`, `list_fields`, `surface_info`,
`create_item`, `add_comment`, `add_labels`, `remove_labels`, `close_item`,
`reopen_item`, `set_field_value`, `start_work`, `finish_work`.

## What leaves your machine

- The Gitsu app talks to the GitHub API with the token it already holds.
  `gitsu-mcp` reads GitHub (`api.github.com/graphql`) only when a tool asks for
  fresh data, and otherwise answers from the app's local cache.
- The band above the prompt fetches avatar images from
  `avatars.githubusercontent.com` with `curl`.
- The plugin and `gitsu-mcp` contain no analytics. We found no PostHog or other
  telemetry call in either, and nothing is sent to Coduo servers by them. The
  Gitsu app itself is a separate product with its own behavior.

## Support

hello@coduo.co

License: MIT. See LICENSE.

Exported from source commit 49bc6506efb8255a790771d60979646df5c6a2bf.
