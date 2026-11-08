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

The plugin starts `bin/gitsu-mcp`, a short shell launcher. It finds your
installed Gitsu.app and replaces itself (`exec`) with the `gitsu-mcp` binary
inside the app, which is signed by Coduo. If Gitsu is not installed, the
launcher prints an install message and exits.

The server is not bundled in the plugin on purpose. Your GitHub token sits in
the macOS keychain, and the keychain gives it only to the sidecar binary that
ships inside the signed Gitsu.app. A copy of that binary in the plugin folder
would not be trusted.

The `hooks/` code draws the band above the prompt. It runs inside Claude Code.

## Tools

`list_projects`, `list_items`, `get_item`, `list_fields`, `surface_info`,
`create_item`, `add_comment`, `add_labels`, `remove_labels`, `close_item`,
`reopen_item`, `set_field_value`, `start_work`, `finish_work`.

## What the prompt band does

The band is a Claude Code mod in `hooks/`. Everything it runs, reads and calls
is listed here.

### Programs it runs

Each one is fixed text. No shell is used and nothing is downloaded.

- `defaults read -g AppleInterfaceStyle`, only when Claude Code's theme is
  auto. It tells the band whether macOS is in dark or light mode.
- `git remote get-url origin`, to learn which GitHub repo the session is in,
  so `#N` resolves to that repo's item.
- `open gitsu://item/<project>/<item>`, when you press Open Gitsu. It opens
  the item in the Gitsu app.

### Network

The band makes no network requests.

### Tool calls it makes without the model asking

Both go to the local `gitsu-mcp` server, which talks only to `api.github.com`.

- `finish_work`, when the session ends, for each item Claude started work on in
  that session. It sends the item number, and the repo, project id and item id
  when they are known. The item then no longer shows as in progress.
- `get_item`, when you press Open Gitsu on an item that the local snapshot has
  no ids for. It sends the same fields, to find the project and item ids to
  open.

### Files it reads

Only the board snapshots the Gitsu app writes:

- `~/Library/Application Support/co.coduo.gitsu/cache/mcp-snapshot.json`
- `~/Library/Application Support/co.coduo.gitsu.dev/cache/mcp-snapshot.json`
  (the development build)

It reads the `HOME` variable to find them, and Claude Code's own `theme`
setting to pick dark or light.

### Hooks

- `prompt.submit` reads the `#N` numbers in your prompt (up to five) and looks
  them up in the snapshot. For each one it finds, it adds a short line with the
  item's title, status and board as extra context for Claude, and shows the
  item in the band. It does not change your prompt text or block the prompt.
  The prompt is not sent anywhere.
- `tool.call` on `start_work` and `finish_work` runs after the call returns.
  It reads the item number, repo, project id and item id from the call, and
  the title from the result, to record which items are in progress. It does
  not change the call or its result.
- `classic.Stop`: when Claude stops while items are still in progress, it asks
  Claude once to call `finish_work` for each, or to say why the item stays in
  progress. It asks again only if the set of items changes.
- `session.start` sets the band's theme and the status line, and starts a
  30-second timer. The timer refreshes the theme, fills in rows the snapshot
  did not have yet, updates the elapsed time and the status line.
- `session.end` calls `finish_work` as described above.
- `ui.render` on `AbovePrompt` draws the band: one row per item in progress
  and per item you mentioned, each with Open Gitsu and a close button. Closing
  a row only hides it.

## Credentials

The plugin reads no credentials. The Gitsu app's `gitsu-mcp` binary reads the
GitHub token that Gitsu stored in your keychain when you signed in, and uses it
only for calls to `api.github.com`.

## What leaves your machine

- The Gitsu app talks to the GitHub API with the token it already holds.
  `gitsu-mcp` reads GitHub (`api.github.com/graphql`) only when a tool asks for
  fresh data, and otherwise answers from the app's local cache.
- The band above the prompt sends nothing.
- The plugin and `gitsu-mcp` contain no analytics. We found no PostHog or other
  telemetry call in either, and nothing is sent to Coduo servers by them. The
  Gitsu app itself is a separate product with its own behavior.

## Support

hello@coduo.co

License: MIT. See LICENSE.

Exported from source commit 6e7fd81a24faf7eb4907c44b8d5233a728498317.
