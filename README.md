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

## What the prompt band does

The band is a Claude Code mod in `hooks/`. Everything it runs or reads is
listed here.

Programs it runs, each with fixed arguments:

- `sh -c 'echo $HOME'`, to find your home folder.
- `defaults read -g AppleInterfaceStyle`, to match the band to macOS dark or
  light mode.
- `git remote get-url origin`, to learn which GitHub repo the session is in, so
  `#N` resolves to that repo's item.
- `sh -c 'curl -fsSL --max-time 5 -- "$1" | base64'` with one `https://` URL,
  to fetch an assignee's avatar picture from `avatars.githubusercontent.com`.
  The picture is shown in the band and cached. Nothing is sent except the
  request for that picture. The script never runs what it downloads.
- `open gitsu://item/<project>/<item>`, when you press Open Gitsu.

Files it reads:

- `~/Library/Application Support/Claude/config.json`, for the Claude theme.
- `~/Library/Application Support/co.coduo.gitsu/cache/mcp-snapshot.json`, the
  board snapshot the Gitsu app writes, to describe the items you mention.

Tool calls it makes without the model asking:

- When a session ends, it calls the Gitsu MCP tool `finish_work` for each item
  Claude started work on in that session, so the item does not stay marked as
  in progress.

What it reads from the conversation: the numbers you write as `#N` in a prompt,
to look them up in the local snapshot. The prompt text is not sent anywhere.

## Credentials

The plugin itself reads no credential. The Gitsu app's own `gitsu-mcp` binary
reads the GitHub token that Gitsu stored in your keychain when you signed in,
and uses it only for calls to `api.github.com`.

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

Exported from source commit 16a8c722082e6f1a2eece346e5b4f894502398d5.
