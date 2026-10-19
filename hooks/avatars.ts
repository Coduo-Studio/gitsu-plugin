// an assignee's GitHub photo for the band's 20px circle. The row is one self-contained SVG,
// which cannot load a URL, so the photo rides in it as a data: URI: fetched once per login at
// 40px (2x the circle), cached base64 in $.store across sessions, initials until then

// a photo is good for a week; a failed fetch (no network, a 404) is tried again after an hour
export const FRESH_MS = 7 * 24 * 60 * 60 * 1000
export const RETRY_MS = 60 * 60 * 1000
// keeps the store well under its 4 MiB: a 40px avatar is ~2-5 KB of base64
export const MAX_CACHED = 100
// a 40px photo is a few KB; anything far past that is not the picture asked for
const MAX_BASE64 = 64 * 1024
export const avatarKey = (login: string) => `avatar:${login}`
export const isAvatarKey = (key: string) => key.startsWith('avatar:')

// data: what was fetched, absent after a failure; at: when the fetch ended
export type AvatarEntry = { url: string; data?: string; at: number }

// the snapshot's avatar URL at 40px; https only, so curl never reads a file:// or other scheme
export const sizedAvatarUrl = (url: string | undefined) => {
  const u = url?.trim()
  if (!u || !/^https:\/\/[^\s"'\\]+$/.test(u)) return undefined
  const [base, query = ''] = u.split('?', 2)
  const kept = query.split('&').filter(p => p && !/^(s|size)=/.test(p))
  return `${base}?${[...kept, 's=40'].join('&')}`
}

// the picture's type from its first bytes; anything else (an HTML error page, nothing) is no photo
const MIMES: [string, string][] = [
  ['iVBORw0KGgo', 'image/png'],
  ['/9j/', 'image/jpeg'],
  ['R0lGOD', 'image/gif'],
  ['UklGR', 'image/webp'],
]
const mimeOf = (base64: string) =>
  MIMES.find(([p]) => base64.startsWith(p))?.[1]
// `curl | base64`'s output as one base64 string, or undefined when it is not a picture: a failed
// curl writes nothing into the pipe, so the pipe prints nothing, whatever the shell
export const AVATAR_FETCH = [
  'sh',
  '-c',
  'curl -fsSL --max-time 5 -- "$1" | base64',
  'gitsu-avatar',
]
export const photoBase64 = (stdout: string) => {
  const b64 = stdout.replace(/\s+/g, '')
  return b64.length <= MAX_BASE64 &&
    /^[A-Za-z0-9+/]+=*$/.test(b64) &&
    mimeOf(b64)
    ? b64
    : undefined
}
export const avatarDataUri = (base64: string | undefined) => {
  const mime = base64 && mimeOf(base64)
  return mime ? `data:${mime};base64,${base64}` : undefined
}

// what the cache says for this URL now: the photo to draw (a stale one still draws while it is
// fetched again), and whether to fetch
export const fromCache = (
  entry: AvatarEntry | undefined,
  url: string,
  now: number
) => {
  if (!entry || entry.url !== url) return { data: undefined, fetch: true }
  const age = now - entry.at
  return {
    data: entry.data,
    fetch: age >= (entry.data ? FRESH_MS : RETRY_MS),
  }
}
