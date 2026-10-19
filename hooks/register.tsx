import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MentionedItem, WorkItem } from '../types'
import type { AvatarEntry } from './avatars'
import {
  AVATAR_FETCH,
  avatarDataUri,
  avatarKey,
  FRESH_MS,
  fromCache,
  isAvatarKey,
  MAX_CACHED,
  photoBase64,
  RETRY_MS,
  sizedAvatarUrl,
} from './avatars'
import type { Snapshot } from './prompt-items'
import {
  chipsSvg,
  describeItems,
  findItems,
  numbersIn,
  numberSvg,
  statusTextSvg,
  NUMBER_W,
  priorityGlyph,
  svgRoot,
  repoFromRemote,
  SLOT_W,
  statusGlyph,
} from './prompt-items'

// the server name is the person's own config: Gitsu writes `gitsu` (the dev build `gitsu-dev`);
// `gitsu-mcp` and `gitsu-mcp-dev` are the names before the 2026-10-03 rename (#1014), still matched
const SERVERS = ['gitsu', 'gitsu-dev', 'gitsu-mcp', 'gitsu-mcp-dev'] as const
const DEV_SERVERS: ReadonlySet<string> = new Set(['gitsu-dev', 'gitsu-mcp-dev'])
const DEFAULT_SERVER = 'gitsu'
const claimed = atom({ plugin: 'gitsu', key: 'claimed' } as const, [])
const mentioned = atom({ plugin: 'gitsu', key: 'mentioned' } as const, [])
const tick = atom({ plugin: 'gitsu', key: 'tick' } as const, 0)
const isDark = atom({ plugin: 'gitsu', key: 'isDark' } as const, false)
const hidden = atom({ plugin: 'gitsu', key: 'hidden' } as const, [])
const avatars = atom({ plugin: 'gitsu', key: 'avatars' } as const, {})

// the band's own colours: Gitsu's brand fill, the hover card's background, the mark's ink
const COLORS = {
  brand: '#5059ff',
  cardDark: '#27272a',
  cardLight: '#ffffff',
  // the band's background, ringing the mark's badge so it reads as cut out of the cat
  bandDark: '#222222',
  bandLight: '#ffffff',
  inkDark: '#e8e8e8',
  inkLight: '#1f1f1f',
} as const

// the Gitsu cat (the silhouette path of public/logo.svg), drawn in the theme's text colour, in the
// 18px icon slot with a blinking badge dot in Gitsu's primary (--brand, COLORS.brand) at its
// bottom right; drawn as an image so it sits on the band's own background
const CAT =
  'm200.998 399.232.248-.644v1.408q-.622.004-1.246.004c-68.463 0-128.888-34.402-164.94-86.859zm.089-36.25.159-.307v15.972L37.747 293.934c.746-4.521 1.612-9.32 2.625-14.332zm.159-225.904h34.841a36.63 36.63 0 0 1 34.738 24.854c11.628 34.322 26.906 57.028 43.021 63.934l8.616 3.694-11.57 43.387a64.305 64.305 0 0 1-63.929 47.809 179.7 179.7 0 0 0-45.717 4.76v18.779L44.129 262.903q.55-2.218 1.139-4.466c6.19-23.639 14.289-44.764 24.072-62.787 11.608-21.388 25.655-38.493 41.802-50.916 2.338-14.29 7.378-33.397 18.218-50.717 15.036-24.029 36.887-38.243 64.938-42.25L201.246 50z'
const MARK = (dark: boolean) =>
  `${svgRoot(SLOT_W, 18, dark)}<style>.c{fill:${dark ? COLORS.inkDark : COLORS.inkLight}}</style><defs><clipPath id="r"><circle cx="200" cy="200" r="200"/></clipPath></defs><svg x="1" y="2" width="14" height="14" viewBox="0 0 400 400"><path class="c" clip-path="url(#r)" d="${CAT}"/></svg><circle cx="14" cy="14.5" r="3.5" fill="${COLORS.brand}" stroke="${dark ? COLORS.bandDark : COLORS.bandLight}" stroke-width="1.5"><animate attributeName="opacity" values="1;0.2;1" dur="1.4s" repeatCount="indefinite"/></circle></svg>`

type Raw = Record<string, unknown>
const str = (v: unknown) =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined
const keyOf = (w: {
  number: number
  repo?: string
  project_id?: string
  server?: string
}) =>
  `${w.server ?? DEFAULT_SERVER}:${w.repo ?? ''}#${w.number}@${w.project_id ?? ''}`
// one claim, not one item: a new start_work on a hidden item draws it again
const hideKey = (w: WorkItem) => `${keyOf(w)}@${w.startedAt}`
const argsOf = (w: WorkItem) => {
  const a: Record<string, unknown> = { number: w.number }
  if (w.repo) a.repo = w.repo
  if (w.project_id) a.project_id = w.project_id
  if (w.item_id) a.item_id = w.item_id

  return a
}
// best effort: the first line naming #N, with the number and separators cut
const titleFrom = (text: string | undefined, n: number) => {
  // the server now answers JSON: {"item":{"number":1,"title":"…",…}}
  try {
    const t = str((JSON.parse(text ?? '') as { item?: Raw }).item?.title)
    if (t) return t.slice(0, 80)
  } catch {
    // not JSON: the older `#N title` line
  }
  const line = text?.split('\n').find(l => l.includes(`#${n}`))
  const t = line
    ?.slice(line.indexOf(`#${n}`) + `#${n}`.length)
    .replace(/^[\s:·—-]+/, '')
    .replace(/^(open|closed|merged)\s*·\s*/i, '')
    .split(' · ')[0]
    .replace(/["*`]/g, '')
    .trim()

  return t ? t.slice(0, 80) : undefined
}
const elapsed = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000))

  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}
// the status line mirrors the band, for surfaces that do not draw AbovePrompt
const showStatus = async ($: EngineInterface) => {
  const list = await read($, claimed)
  const w = list[0]
  if (!w) return $.ui.status(undefined)
  const now = await $.clock.now()
  const more = list.length > 1 ? ` +${list.length - 1}` : ''
  $.ui.status(
    `● Working on #${w.number}${more} · ${elapsed(now - w.startedAt)}`
  )
}

// the Claude app's theme: config.json userThemeMode, and for `system` (or no answer) macOS's
// AppleInterfaceStyle, which `defaults` prints as Dark and exits non-zero for light
const refreshTheme = async ($: EngineInterface) => {
  const home = (await $.process.run(['sh', '-c', 'echo $HOME'])).stdout.trim()
  let mode: unknown
  try {
    const cfg = await $.fs.read(
      `${home}/Library/Application Support/Claude/config.json`
    )
    mode = (JSON.parse(cfg) as Raw).userThemeMode
  } catch {
    mode = undefined
  }
  let dark = mode === 'dark'
  if (mode !== 'dark' && mode !== 'light') {
    const r = await $.process
      .run(['defaults', 'read', '-g', 'AppleInterfaceStyle'])
      .catch(() => undefined)
    dark = r?.exitCode === 0 && r.stdout.trim() === 'Dark'
  }
  if ((await read($, isDark)) !== dark) await update($, isDark, () => dark)
}

// Gitsu's MCP snapshot, dev build first, then release
const SNAPSHOTS = ['co.coduo.gitsu.dev', 'co.coduo.gitsu'].map(id => ({
  rel: `Library/Application Support/${id}/cache/mcp-snapshot.json`,
  isDev: id.endsWith('.dev'),
}))
// the repo this session's directory belongs to (owner/name), null when it has no GitHub origin
const originRepo = async ($: EngineInterface) => {
  const r = await $.process
    .run(['git', 'remote', 'get-url', 'origin'])
    .catch(() => undefined)
  return (r?.exitCode === 0 && repoFromRemote(r.stdout)) || null
}
// the first snapshot (dev, then release) that knows any of the numbers
const lookUp = async (
  $: EngineInterface,
  home: string,
  numbers: number[],
  inRepo: string | undefined,
  now: number
) => {
  for (const { rel, isDev } of SNAPSHOTS) {
    const text = await $.fs.read(`${home}/${rel}`).catch(() => undefined)
    if (text === undefined) continue
    const snap = JSON.parse(text) as Snapshot
    const lines = describeItems(snap, numbers, inRepo, now)
    if (lines.length === 0) continue
    const found: MentionedItem[] = findItems(snap, numbers, inRepo).map(f => ({
      ...f,
      isDev,
    }))
    return { lines, found }
  }
  return { lines: [] as string[], found: [] as MentionedItem[] }
}
const homeOf = async ($: EngineInterface) =>
  (await $.process.run(['sh', '-c', 'echo $HOME'])).stdout.trim()

// a claim's own item: read only its server's snapshot (dev or release), only the board it named,
// and accept a hit only in its repo. Never the open board's same-numbered item from elsewhere,
// which a mid-walk snapshot would otherwise hand back and freeze into the row.
const lookUpClaim = async (
  $: EngineInterface,
  home: string,
  w: WorkItem,
  inRepo: string | undefined
): Promise<MentionedItem | undefined> => {
  const isDev = DEV_SERVERS.has(w.server ?? DEFAULT_SERVER)
  const own = SNAPSHOTS.find(s => s.isDev === isDev)
  if (!own) return undefined
  const text = await $.fs.read(`${home}/${own.rel}`).catch(() => undefined)
  if (text === undefined) return undefined
  let snap = JSON.parse(text) as Snapshot
  const pid = w.project_id
  if (pid) {
    const board = snap.boards?.[pid]
    snap = { ...snap, open_board: pid, boards: board ? { [pid]: board } : {} }
  }
  const f = findItems(snap, [w.number], inRepo)[0]
  if (!f || (inRepo && f.repo !== inRepo) || (pid && f.projectId !== pid))
    return undefined
  return { ...f, isDev }
}
// Gitsu leaves a board out of the snapshot while it walks it, so a claim made then has no
// detail: look each such item up again, and fill in the ones the snapshot now has. Reads home
// and origin (when register has not cached them) only while some row is bare.
const fillClaimed = async (
  $: EngineInterface,
  home: string | undefined,
  repo: string | null | undefined
) => {
  const bare = (await read($, claimed)).filter(w => !w.detail)
  if (bare.length === 0) return
  home ??= await homeOf($)
  if (repo === undefined) repo = await originRepo($)
  const filled = new Map<string, MentionedItem>()
  for (const w of bare) {
    const inRepo = (w.repo ?? repo ?? undefined)?.toLowerCase()
    const found = await lookUpClaim($, home, w, inRepo)
    if (found) filled.set(keyOf(w), found)
  }
  if (filled.size === 0) return
  await update($, claimed, list =>
    list.map(w => {
      const detail = filled.get(keyOf(w))
      return detail && !w.detail
        ? { ...w, detail, title: detail.title || w.title }
        : w
    })
  )
}

// drops the oldest photos past MAX_CACHED
const pruneAvatars = async ($: EngineInterface) => {
  const keys = (await $.store.keys()).filter(isAvatarKey)
  if (keys.length <= MAX_CACHED) return
  const aged: { k: string; at: number }[] = []
  for (const k of keys)
    aged.push({
      k,
      at: ((await $.store.get(k)) as AvatarEntry | undefined)?.at ?? 0,
    })
  aged.sort((x, y) => x.at - y.at)
  for (const { k } of aged.slice(0, keys.length - MAX_CACHED))
    await $.store.delete(k)
}
// one fetch per login at a time, across every row and timer of this module
const inFlight = new Set<string>()
// the login's photo as a data: URI: from the cache, else fetched and cached; undefined while there
// is none (no URL, no network, still failing), so the row keeps its initials
const loadAvatar = async (
  $: EngineInterface,
  login: string,
  avatarUrl: string | undefined
) => {
  const url = sizedAvatarUrl(avatarUrl)
  if (!url || inFlight.has(login)) return undefined
  const key = avatarKey(login)
  const now = await $.clock.now()
  const cached = fromCache(
    (await $.store.get(key)) as AvatarEntry | undefined,
    url,
    now
  )
  if (!cached.fetch) return avatarDataUri(cached.data)
  inFlight.add(login)
  try {
    const r = await $.process
      .run([...AVATAR_FETCH, url], { timeoutMs: 10000 })
      .catch(() => undefined)
    const data = r?.exitCode === 0 ? photoBase64(r.stdout) : undefined
    // a failed refetch keeps the stale photo, dated so it is tried again after RETRY_MS
    const entry: AvatarEntry = data
      ? { url, data, at: now }
      : cached.data
        ? { url, data: cached.data, at: now - FRESH_MS + RETRY_MS }
        : { url, at: now }
    await $.store.set(key, entry)
    if (data) await pruneAvatars($)
    return avatarDataUri(entry.data)
  } finally {
    inFlight.delete(login)
  }
}
// each drawn row's assignee photo, loaded into `avatars` for the rows to draw; a login with no
// photo yet (no URL, pending, no network) keeps its initials and is tried again on the next call
const warmAvatars = async ($: EngineInterface) => {
  const rows = [
    ...(await read($, claimed)).flatMap(w => (w.detail ? [w.detail] : [])),
    ...(await read($, mentioned)),
  ]
  const have = await read($, avatars)
  const want = new Map<string, string>()
  for (const m of rows) {
    const login = m.assignees[0]
    const url = login ? m.avatars?.[login] : undefined
    if (login && url && !have[login]) want.set(login, url)
  }
  for (const [login, url] of want) {
    const photo = await loadAvatar($, login, url).catch(() => undefined)
    if (photo) await update($, avatars, all => ({ ...all, [login]: photo }))
  }
}
const warmLater = ($: EngineInterface) =>
  $.clock.after(0, () => warmAvatars($).catch(() => undefined))

// a claimed row wins over a mentioned row for the same item
const isClaimed = (m: MentionedItem, list: WorkItem[]) =>
  list.some(
    w =>
      w.number === m.number &&
      (w.item_id === undefined ||
        m.itemId === undefined ||
        w.item_id === m.itemId)
  )

export const register: Register = on => {
  let blockedFor = '' // the claimed set the Stop guard last sent back
  let home: string | undefined
  let repo: string | null | undefined // null: looked, no origin

  // attach what Gitsu knows about each #N the prompt names, so Claude needs no tool call
  on('prompt.submit', async ($, e, next) => {
    $.clock.after(0, () => refreshTheme($).catch(() => undefined))
    // off the prompt path: a bare row's lookup never delays the prompt
    $.clock.after(0, async () => {
      await fillClaimed($, home, repo).catch(() => undefined)
      await warmAvatars($).catch(() => undefined)
    })
    let lines: string[] = []
    let found: MentionedItem[] = []
    try {
      const numbers = numbersIn(e.text)
      if (numbers.length > 0) {
        home ??= await homeOf($)
        if (repo === undefined) repo = await originRepo($)
        const now = await $.clock.now()
        ;({ lines, found } = await lookUp(
          $,
          home,
          numbers,
          repo ?? undefined,
          now
        ))
      }
    } catch {
      lines = [] // never block a prompt on the snapshot
      found = []
    }
    if (lines.length === 0) return next(e)
    await update($, mentioned, () => found)
    warmLater($)

    return next({ ...e, context: [...(e.context ?? []), lines.join('\n')] })
  })

  for (const server of SERVERS) {
    on(
      'tool.call',
      { tool: `mcp__${server}__start_work` },
      async ($, e, next) => {
        const ran = await next(e)
        const raw = e as unknown as Raw
        if (
          ran.deny !== undefined ||
          ran.isError ||
          typeof raw.number !== 'number'
        )
          return ran
        const item: WorkItem = {
          number: raw.number,
          repo: str(raw.repo),
          project_id: str(raw.project_id),
          item_id: str(raw.item_id),
          server,
          title: titleFrom(ran.text, raw.number),
          startedAt: await $.clock.now(),
        }
        try {
          home ??= await homeOf($)
          if (repo === undefined) repo = await originRepo($)
          const inRepo = (item.repo ?? repo ?? undefined)?.toLowerCase()
          item.detail = await lookUpClaim($, home, item, inRepo)
          if (item.detail) item.title = item.detail.title || item.title
        } catch {
          // no snapshot: the minimal row
        }
        await update($, claimed, list => [
          ...list.filter(w => keyOf(w) !== keyOf(item)),
          item,
        ])
        warmLater($)
        await showStatus($)

        return ran
      }
    )

    on(
      'tool.call',
      { tool: `mcp__${server}__finish_work` },
      async ($, e, next) => {
        const ran = await next(e)
        const raw = e as unknown as Raw
        if (
          ran.deny !== undefined ||
          ran.isError ||
          typeof raw.number !== 'number'
        )
          return ran
        // match on number (and repo when given): finish may omit the project the start named
        const repo = str(raw.repo)
        await update($, claimed, list =>
          list.filter(
            w =>
              (w.server ?? DEFAULT_SERVER) !== server ||
              w.number !== raw.number ||
              (repo !== undefined && w.repo !== undefined && w.repo !== repo)
          )
        )
        await showStatus($)

        return ran
      }
    )
  }

  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    const list = await read($, claimed)
    const set = list.map(keyOf).sort().join(',')
    if (
      result.block ||
      list.length === 0 ||
      e.stop_hook_active ||
      set === blockedFor
    )
      return result
    blockedFor = set
    const ns = list.map(w => `#${w.number}`).join(', ')

    return {
      ...result,
      block: `gitsu: ${ns} still claimed. Call finish_work for each, or say why it stays claimed.`,
    }
  })

  on('session.start', async ($, e, next) => {
    $.clock.every(30000, async () => {
      await refreshTheme($).catch(() => undefined)
      await fillClaimed($, home, repo).catch(() => undefined)
      if ((await read($, claimed)).length > 0) await update($, tick, n => n + 1)
      await showStatus($)
      // off the tick: a slow or blocked photo fetch never holds up the status line
      warmLater($)
    })
    await refreshTheme($).catch(() => undefined)
    await showStatus($)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    for (const w of await read($, claimed)) {
      try {
        await $.mcp.call(w.server ?? DEFAULT_SERVER, 'finish_work', argsOf(w))
      } catch {
        // the session is going away; nothing to tell
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, claimed)
    const hid = await read($, hidden)
    const shown = list.filter(w => !hid.includes(hideKey(w)))
    // a hidden claim still keeps its item out of the mentioned rows
    const mentions = (await read($, mentioned))
      .filter(m => !isClaimed(m, list))
      .slice(0, 5)
    await read($, tick)
    const dark = await read($, isDark)
    const photos = await read($, avatars)
    if (e.props.hasSurvey || (shown.length === 0 && mentions.length === 0))
      return next(e)
    const t = $.ui.resolve(e)
    const { Box, Button, Text } = t
    const Svg = 'Svg' in t ? t.Svg : null
    const now = await $.clock.now()
    const room = Math.max(10, e.props.bodyColumns - 30)
    const ok = (r: { exitCode: number } | undefined) =>
      r !== undefined && r.exitCode === 0

    // opens the item's detail in Gitsu through its gitsu://item/<project>/<item> link (src-tauri/src/open_link.rs)
    const openItem = async (o: {
      projectId: string
      itemId: string
      isDev: boolean
    }) => {
      const url = `${o.isDev ? 'gitsu-dev' : 'gitsu'}://item/${o.projectId}/${o.itemId}`
      if (!o.isDev) {
        if (!ok(await $.process.run(['open', url]).catch(() => undefined)))
          $.ui.toast('Could not open Gitsu')
        return
      }
      // the dev build is a bare binary macOS has no scheme for: a second instance hands the link
      // to the running one through the single-instance plugin, then exits
      const pid = (
        await $.process
          .run(['pgrep', '-n', '-f', '/debug/gitsu$'])
          .catch(() => undefined)
      )?.stdout.trim()
      const bin =
        pid && /^\d+$/.test(pid)
          ? (
              await $.process
                .run(['ps', '-o', 'comm=', '-p', pid])
                .catch(() => undefined)
            )?.stdout.trim()
          : undefined
      if (!bin) return $.ui.toast('Gitsu (dev) is not running')
      if (
        !ok(
          await $.process
            .run([bin, url], { timeoutMs: 10000 })
            .catch(() => undefined)
        )
      )
        $.ui.toast('Could not open Gitsu')
    }

    // the snapshot's ids first; a claimed item outside the snapshot may lack them: ask the sidecar
    const openClaimed = async (w: WorkItem) => {
      let projectId = w.detail?.projectId ?? w.project_id
      let itemId = w.detail?.itemId ?? w.item_id
      if (!projectId || !itemId) {
        const r = await $.mcp
          .call(w.server ?? DEFAULT_SERVER, 'get_item', argsOf(w))
          .catch(() => undefined)
        const text = (r?.content ?? [])
          .map(c => ('text' in c && typeof c.text === 'string' ? c.text : ''))
          .join('\n')
        const m = text.match(/\((PVT_[\w-]+)\) as (PVTI_[\w-]+)/)
        projectId ??= m?.[1]
        itemId ??= m?.[2]
      }
      if (!projectId || !itemId)
        return $.ui.toast(`Could not find #${w.number} on a Gitsu board`)
      await openItem({
        projectId,
        itemId,
        isDev: DEV_SERVERS.has(w.server ?? DEFAULT_SERVER),
      })
    }

    const cut = (s: string, n: number) =>
      s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s

    const mark = Svg ? (
      <Svg
        source={MARK(dark)}
        alt="Gitsu: working"
        width={SLOT_W}
        height={18}
      />
    ) : (
      <Text color="blue">●</Text>
    )
    // every row's last control, a plain ✕: the desktop drew role="dismiss" as a labelled button, not its close glyph
    const close = (key: string, _n: number, onPress: () => unknown) => (
      <Button key={key} label={'✕\u2009'} plain dimColor onPress={onPress} />
    )
    const openButton = (key: string, onPress: () => unknown) => (
      <Button
        key={key}
        label="Open Gitsu"
        variant="secondary"
        onPress={onPress}
      />
    )

    // a hover card: a hidden absolutely-placed Box the hover reveals; top -1 centres its 3 rows
    // on the 1-row line so the band's top and bottom rows lose at most a border line
    const tip = (key: string, text: string, child: JSX.Element) => (
      <Box key={key} position="relative" flexShrink={0}>
        {child}
        <Box
          position="absolute"
          top={-1}
          left={2}
          display="none"
          hover={{ display: 'flex' }}
          backgroundColor={dark ? COLORS.cardDark : COLORS.cardLight}
          borderStyle="round"
          borderDimColor
          paddingX={1}
        >
          <Text wrap="truncate">{text}</Text>
        </Box>
      </Box>
    )

    // the Gitsu list row (src/features/items/components/IssueRowView.tsx): priority, #N,
    // status, title, status text, label chips + assignee. `icon` takes priority's slot (the
    // claimed row's mark), `afterStatus` follows the status text, `tail` closes the row
    const itemRow = (
      key: string,
      m: MentionedItem,
      icon: JSX.Element | null,
      afterStatus: JSX.Element | null,
      tail: JSX.Element[]
    ) => {
      const login = m.assignees[0]
      const chips = chipsSvg(
        m.labels,
        m.labelColors ?? {},
        login,
        dark,
        login ? photos[login] : undefined
      )

      return (
        <Box key={key} flexDirection="row" alignItems="center" gap={1}>
          {icon ? (
            <Box flexShrink={0}>{icon}</Box>
          ) : Svg ? (
            tip(
              `${key}:p`,
              `Priority: ${m.priority ?? 'none'}`,
              <Svg
                source={priorityGlyph(m.priority, dark)}
                alt={`Priority ${m.priority ?? 'none'}`}
                width={SLOT_W}
                height={18}
              />
            )
          ) : null}
          <Box flexShrink={0}>
            {Svg ? (
              <Svg
                source={numberSvg(m.number, dark)}
                alt={`#${m.number}`}
                width={NUMBER_W}
                height={18}
              />
            ) : (
              <Text dimColor>{`#${m.number}`}</Text>
            )}
          </Box>
          {Svg
            ? tip(
                `${key}:s`,
                `Status: ${m.status ?? 'No status'}`,
                <Svg
                  source={statusGlyph(m.status, dark)}
                  alt={m.status ?? 'No status'}
                  width={14}
                  height={18}
                />
              )
            : null}
          <Text wrap="truncate">{cut(m.title, room - 20)}</Text>
          {m.status ? (
            <Box flexShrink={0}>
              {Svg ? (
                <Svg
                  source={statusTextSvg(m.status, dark).source}
                  alt={m.status}
                  width={statusTextSvg(m.status, dark).width}
                  height={18}
                />
              ) : (
                <Text dimColor>{m.status}</Text>
              )}
            </Box>
          ) : null}
          {afterStatus}
          {Svg && chips
            ? tip(
                `${key}:c`,
                [...m.labels, ...(login ? [`Assigned to ${login}`] : [])].join(
                  ', '
                ),
                <Svg
                  source={chips.source}
                  alt={[
                    ...m.labels,
                    ...(login ? [`assigned to ${login}`] : []),
                  ].join(', ')}
                  width={chips.width}
                  height={chips.height}
                />
              )
            : m.labels.slice(0, 3).map(l => (
                <Box key={l} flexShrink={0}>
                  <Text dimColor>{cut(l, 16)}</Text>
                </Box>
              ))}
          {tail}
        </Box>
      )
    }

    // a claim Gitsu's snapshot had no detail for (mid-walk, or off every board) draws through
    // the same row: its number and title, no status, labels or assignee
    const claimItem = (w: WorkItem): MentionedItem =>
      w.detail ?? {
        number: w.number,
        title: w.title ?? '',
        labels: [],
        labelColors: {},
        assignees: [],
        repo: w.repo,
        boardTitle: '',
        projectId: w.project_id ?? '',
        itemId: w.item_id,
        isDev: DEV_SERVERS.has(w.server ?? DEFAULT_SERVER),
      }
    // hides the row only: the claim, the status line and the Stop guard stay. Keeps only live
    // claims' keys, so the list never outgrows the claimed list
    const hide = async (w: WorkItem) => {
      const live = (await read($, claimed)).map(hideKey)
      await update($, hidden, xs => [
        ...xs.filter(k => live.includes(k) && k !== hideKey(w)),
        hideKey(w),
      ])
    }

    return (
      <Box flexDirection="column" gap={1}>
        {shown.map(w =>
          itemRow(
            keyOf(w),
            claimItem(w),
            mark,
            <Box key="elapsed" flexShrink={0}>
              <Text dimColor>· {elapsed(now - w.startedAt)}</Text>
            </Box>,
            [
              <Box key="spacer" flexGrow={1} />,
              openButton(`open-${w.number}`, () => openClaimed(w)),
              close(`hide-${w.number}`, w.number, () => hide(w)),
            ]
          )
        )}
        {mentions.map(m => {
          const id = `${m.isDev ? 'dev' : 'rel'}:${m.projectId}#${m.number}`

          return itemRow(id, m, null, null, [
            <Box key="spacer" flexGrow={1} />,
            openButton(`open-mention-${m.number}`, () =>
              m.itemId
                ? openItem({
                    projectId: m.projectId,
                    itemId: m.itemId,
                    isDev: m.isDev,
                  })
                : $.ui.toast(`Could not find #${m.number} on a Gitsu board`)
            ),
            close(`dismiss-${m.number}`, m.number, () =>
              update($, mentioned, xs =>
                xs.filter(
                  x =>
                    `${x.isDev ? 'dev' : 'rel'}:${x.projectId}#${x.number}` !==
                    id
                )
              )
            ),
          ])
        })}
      </Box>
    )
  })
}
