// pure: what a prompt names (#123) and what Gitsu's MCP snapshot says about it
type SnapItem = {
  id?: string
  number?: number
  labels?: string[]
  // label name -> hex colour, as Gitsu's cache has it (src/services/mcp-snapshot.ts)
  label_colors?: Record<string, string>
  assignees?: string[]
  // assignee login -> avatar URL, where Gitsu's read carried one
  avatars?: Record<string, string>
  repo?: string
  title?: string
  fields?: Record<string, unknown>
}
type SnapBoard = { title?: string; items?: SnapItem[] }
export type Snapshot = {
  saved_at?: string
  open_board?: string
  boards?: Record<string, SnapBoard>
}

export const numbersIn = (text: string) => {
  const out: number[] = []
  for (const m of text.matchAll(/(^|[^\w/])#(\d{1,6})\b/g)) {
    const n = Number(m[2])
    if (!out.includes(n)) out.push(n)
    if (out.length === 5) break
  }
  return out
}

const ago = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000))
  if (m < 60) return `${m}m`
  return m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`
}

// a #N the snapshot knows: what a Gitsu list row shows, and where to open it
export type FoundItem = {
  number: number
  title: string
  status?: string
  priority?: string
  labels: string[]
  labelColors: Record<string, string>
  assignees: string[]
  avatars: Record<string, string>
  repo?: string
  boardTitle: string
  projectId: string
  itemId?: string
}

const field = (item: SnapItem, name: string) => {
  const v = item.fields?.[name]
  return typeof v === 'string' && v ? v : undefined
}

// per number: the cwd repo's item on any board first, else the open board's
export const findItems = (
  snap: Snapshot,
  numbers: number[],
  repo: string | undefined
) => {
  const boards = Object.entries(snap.boards ?? {})
  const open = snap.open_board ? snap.boards?.[snap.open_board] : undefined
  const found: FoundItem[] = []
  for (const n of numbers) {
    let hit: { item: SnapItem; board: SnapBoard; id: string } | undefined
    if (repo)
      for (const [id, board] of boards) {
        const item = board.items?.find(
          i => i.number === n && i.repo?.toLowerCase() === repo
        )
        if (item) hit = { item, board, id }
        if (hit) break
      }
    if (!hit && open && snap.open_board) {
      const item = open.items?.find(i => i.number === n)
      if (item) hit = { item, board: open, id: snap.open_board }
    }
    if (!hit) continue
    found.push({
      number: n,
      title: hit.item.title ?? '',
      status: field(hit.item, 'Status'),
      priority: field(hit.item, 'Priority'),
      labels: hit.item.labels ?? [],
      labelColors: hit.item.label_colors ?? {},
      assignees: hit.item.assignees ?? [],
      avatars: hit.item.avatars ?? {},
      repo: hit.item.repo?.toLowerCase(),
      boardTitle: hit.board.title ?? 'board',
      projectId: hit.id,
      itemId: hit.item.id,
    })
  }
  return found
}

// one context line per found item
export const describeItems = (
  snap: Snapshot,
  numbers: number[],
  repo: string | undefined,
  now: number
) => {
  const saved = Date.parse(snap.saved_at ?? '')
  const cached = Number.isNaN(saved) ? '' : `, cached ${ago(now - saved)} ago`
  return findItems(snap, numbers, repo).map(
    f =>
      `Gitsu: #${f.number} "${f.title}"${f.status ? ` — ${f.status}` : ''} (${f.boardTitle}${cached})`
  )
}

// Gitsu's own mapping (src/domain/mapping.ts), cut to the names a board commonly uses
const STATUS: Record<
  string,
  'backlog' | 'todo' | 'in-progress' | 'done' | 'cancelled'
> = {
  backlog: 'backlog',
  triage: 'backlog',
  new: 'backlog',
  todo: 'todo',
  'to do': 'todo',
  open: 'todo',
  ready: 'todo',
  planned: 'todo',
  'up next': 'todo',
  next: 'todo',
  'in progress': 'in-progress',
  doing: 'in-progress',
  started: 'in-progress',
  active: 'in-progress',
  wip: 'in-progress',
  'in review': 'in-progress',
  review: 'in-progress',
  'in dev': 'in-progress',
  done: 'done',
  complete: 'done',
  completed: 'done',
  closed: 'done',
  shipped: 'done',
  merged: 'done',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  'wont do': 'cancelled',
  wontfix: 'cancelled',
}
const PRIORITY: Record<string, 'low' | 'medium' | 'high' | 'urgent'> = {
  low: 'low',
  p3: 'low',
  minor: 'low',
  medium: 'medium',
  normal: 'medium',
  p2: 'medium',
  high: 'high',
  major: 'high',
  important: 'high',
  p1: 'high',
  urgent: 'urgent',
  critical: 'urgent',
  blocker: 'urgent',
  highest: 'urgent',
  p0: 'urgent',
}
const canonicalStatus = (s?: string) =>
  STATUS[s?.trim().toLowerCase() ?? ''] ?? 'backlog'
const canonicalPriority = (p?: string) =>
  PRIORITY[p?.trim().toLowerCase() ?? ''] ?? 'none'

// the list row's priority + status glyphs (PriorityGlyph, StatusGlyph), 14px each, theme-aware
const PRIORITY_FILL = {
  none: '',
  low: '#71717a',
  medium: '#ca8a04',
  high: '#d97706',
  urgent: '#dc2626',
}
// explicit colours for the app's resolved theme: the drawn image does not see the app's theme
// through prefers-color-scheme, so the mod resolves it and passes it in
const STYLE = (dark: boolean) =>
  dark
    ? '<style>.s{stroke:#e8e8e8}.f{fill:#e8e8e8}.k{stroke:#1f1f1f}.m{fill:rgba(113,113,122,.3)}</style>'
    : '<style>.s{stroke:#1f1f1f}.f{fill:#1f1f1f}.k{stroke:#fff}.m{fill:rgba(113,113,122,.3)}</style>'
export const svgRoot = (w: number, h: number, dark: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="background:transparent;color-scheme:${dark ? 'dark' : 'light'}">`
// every row drawing is 4px taller than its content: 2px above, 2px below
const PAD_Y = 2
const xml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    c =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[c] ?? c
  )
// a <title> would be the hover tooltip, but only an isInteractive Svg shows it
// w: the drawing's width, the 14px glyph centred in it (the icon slot is 18 wide)
const glyph14 = (body: string, tip: string, dark: boolean, w = 14) =>
  `${svgRoot(w, 14 + 2 * PAD_Y, dark)}<title>${xml(tip)}</title>${STYLE(dark)}<svg x="${(w - 14) / 2}" y="${PAD_Y}" width="14" height="14" viewBox="0 0 16 16">${body}</svg></svg>`
// the native banner's icon slot: priority on a mentioned row, the Gitsu mark on a claimed one
export const SLOT_W = 18
// the #N column: a fixed-width image, number left-aligned in 15px SF Mono as the native PR
// banner draws its #N, so every row's status glyph starts on one x (4ch + 12px wide)
// (the band's own text is proportional, so padding with spaces could not line it up)
export const NUMBER_W = 40
export const numberSvg = (n: number, dark = false) =>
  `${svgRoot(NUMBER_W, 14 + 2 * PAD_Y, dark)}<text x="0" y="${7 + PAD_Y}" dominant-baseline="central" text-anchor="start" font-family="ui-monospace,'SF Mono',Menlo,monospace" font-size="12" fill="${dark ? '#8e8e8e' : '#71717a'}">#${n}</text></svg>`
export const priorityGlyph = (priority?: string, dark = false) => {
  const p = canonicalPriority(priority)
  const bars =
    p === 'urgent'
      ? `<path d="M8 2.5 14 13.5H2Z" fill="${PRIORITY_FILL.urgent}"/>`
      : [
          [1.5, 9, 5],
          [6.5, 6, 8],
          [11.5, 3, 11],
        ]
          .map(([x, y, h], i) => {
            const filled = i < { none: 0, low: 1, medium: 2, high: 3 }[p]
            return `<rect x="${x}" y="${y}" width="3" height="${h}" rx="0.9" ${filled ? `fill="${PRIORITY_FILL[p]}"` : 'class="m"'}/>`
          })
          .join('')
  return glyph14(bars, `Priority: ${priority ?? 'None'}`, dark, SLOT_W)
}
export const statusGlyph = (status?: string, dark = false) => {
  const st = canonicalStatus(status)
  const ring =
    '<circle cx="8" cy="8" r="6" class="s" fill="none" stroke-width="1.5"/>'
  const glyph = {
    backlog:
      '<circle cx="8" cy="8" r="6" class="s" fill="none" stroke-width="1.5" stroke-dasharray="2 2.5" stroke-linecap="round"/>',
    todo: ring,
    'in-progress': `${ring}<path d="M8 2A6 6 0 0 1 8 14L8 8Z" class="f" opacity="0.9"/>`,
    done: '<circle cx="8" cy="8" r="6" class="f"/><path d="M5 8.25 7 10.25 11 6.25" class="k" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    cancelled: `${ring}<path d="M4 12 12 4" class="s" stroke-width="1.5" stroke-linecap="round"/>`,
  }[st]
  return glyph14(glyph, `Status: ${status ?? 'No status'}`, dark)
}

// owner/name from an origin URL (https or ssh), lowercased
export const repoFromRemote = (url: string) =>
  url
    .trim()
    .match(/[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1]
    ?.toLowerCase()

// the list row's label chips (LabelChip: outline pill, 10px dot in the label's colour, 12px
// medium text, max-w-24) then the assignee (AssigneeAvatar, 20px circle: their photo when
// `photo` carries it as a data: URI, their initials until then); one Svg per row
const MAX_CHIPS = 3
const CHIP_STYLE = (dark: boolean) =>
  dark
    ? '<style>.p{fill:#18181b;stroke:#3f3f46}.t{fill:#d4d4d8}.a{fill:#5059ff}.i{fill:#fff}</style>'
    : '<style>.p{fill:#fff;stroke:#e4e4e7}.t{fill:#3f3f46}.a{fill:#5059ff}.i{fill:#fff}</style>'
const FONT =
  'font-family="-apple-system,BlinkMacSystemFont,\'Segoe UI\',system-ui,sans-serif" font-size="12" font-weight="500"'
// an over-estimate of 12px system-face text, so a drawing never cuts its own text off:
// wide (CJK, fullwidth, emoji) ~12px, capitals, digits, m and w ~8px, the rest ~6.6px
const WIDE =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\p{Extended_Pictographic}]/u
const textWidth = (s: string) => {
  let w = 0
  for (const c of s) w += WIDE.test(c) ? 12 : /[A-Z0-9mw]/.test(c) ? 8 : 6.6
  return Math.ceil(w)
}
// names past 16 characters cut
const cutName = (s: string) => (s.length > 16 ? `${s.slice(0, 15)}…` : s)
const labelColor = (hex?: string) => {
  const d = hex?.trim().replace(/^#/, '').toLowerCase()
  return d && /^[0-9a-f]{6}$/.test(d) ? `#${d}` : '#a1a1aa'
}
export const chipsSvg = (
  labels: string[],
  colors: Record<string, string>,
  assignee?: string,
  dark = false,
  photo?: string
) => {
  const H = 24
  const parts: string[] = []
  let x = 0.5
  const pill = (w: number, tip: string, body: string) => {
    parts.push(
      `<g><title>${xml(tip)}</title><rect class="p" x="${x}" y="1.5" width="${w}" height="${H - 3}" rx="${(H - 3) / 2}"/>${body}</g>`
    )
    x += w + 4
  }
  for (const name of labels.slice(0, MAX_CHIPS)) {
    const shown = cutName(name)
    // one padding P left of the dot, between dot and label, and right of the label;
    // (the label width is textWidth's over-estimate, so a short name sits a little loose)
    const P = 7
    const tw = textWidth(shown)
    const w = P + 10 + P + tw + P
    pill(
      w,
      name,
      `<circle cx="${x + P + 5}" cy="${H / 2}" r="5" fill="${labelColor(colors[name])}"/><text class="t" x="${x + P + 10 + P}" y="${H / 2 + 4}" ${FONT}>${xml(shown)}</text>`
    )
  }
  const rest = labels.length - MAX_CHIPS
  if (rest > 0) {
    const t = `+${rest}`
    pill(
      textWidth(t) + 14,
      labels.slice(MAX_CHIPS).join(', '),
      `<text class="t" x="${x + 7}" y="${H / 2 + 4}" ${FONT}>${t}</text>`
    )
  }
  if (assignee) {
    if (parts.length) x += 2
    const cx = x + 10
    // the photo clipped to the circle, over the brand fill a transparent photo shows through;
    // initials from the login while there is none
    // a clip id of this row's own (login and x): drawings that share one page never borrow
    // another row's circle
    const clip = `avatar-${assignee.replace(/[^\w-]/g, '_')}-${Math.round(cx * 10)}`
    const face = photo
      ? `<clipPath id="${clip}"><circle cx="${cx}" cy="${H / 2}" r="10"/></clipPath><circle class="a" cx="${cx}" cy="${H / 2}" r="10"/><image href="${xml(photo)}" x="${cx - 10}" y="${H / 2 - 10}" width="20" height="20" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>`
      : `<circle class="a" cx="${cx}" cy="${H / 2}" r="10"/><text class="i" x="${cx}" y="${H / 2 + 3}" text-anchor="middle" ${FONT.replace('"12"', '"9"')}>${xml(assignee.slice(0, 2).toUpperCase())}</text>`
    parts.push(
      `<g><title>${xml(`Assigned to ${assignee}`)}</title>${face}<circle cx="${cx}" cy="${H / 2}" r="9.75" fill="none" class="p" style="fill:none"/></g>`
    )
    x += 20
  }
  if (parts.length === 0) return undefined
  const width = Math.ceil(x + 0.5)
  return {
    width,
    height: H + 2 * PAD_Y,
    source: `${svgRoot(width, H + 2 * PAD_Y, dark)}${CHIP_STYLE(dark)}<g transform="translate(0 ${PAD_Y})">${parts.join('')}</g></svg>`,
  }
}

// the status text, 2px under the band's own text: a drawing, since Text has no size
export const statusTextSvg = (status: string, dark = false) => {
  const width = textWidth(status) + 2
  return {
    width,
    source: `${svgRoot(width, 14 + 2 * PAD_Y, dark)}<text x="0" y="${7 + PAD_Y}" dominant-baseline="central" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="12" fill="${dark ? '#8e8e8e' : '#71717a'}">${xml(status)}</text></svg>`,
  }
}
