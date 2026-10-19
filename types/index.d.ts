export type WorkItem = {
  number: number
  repo?: string
  project_id?: string
  item_id?: string
  server?: string
  title?: string
  startedAt: number
  // the item as Gitsu's snapshot has it, when found there; the band draws the list row from it
  detail?: MentionedItem
}

// a #N a prompt named that Gitsu's snapshot knows; isDev: found in the dev build's snapshot
export type MentionedItem = {
  number: number
  title: string
  status?: string
  priority?: string
  labels: string[]
  // label name -> hex colour, from the snapshot
  labelColors: Record<string, string>
  assignees: string[]
  // assignee login -> avatar URL, from the snapshot; absent on a row kept from an older build
  avatars?: Record<string, string>
  repo?: string
  boardTitle: string
  projectId: string
  itemId?: string
  isDev: boolean
}

declare module 'claude-code' {
  interface PluginState {
    gitsu: {
      claimed: WorkItem[]
      tick: number
      mentioned: MentionedItem[]
      // claimed rows the person hid with ✕: `${keyOf(w)}@${startedAt}`, so a new start_work shows
      // the item again; only the claimed list's own keys are kept (bounded by the claimed count)
      hidden: string[]
      // the Claude app's resolved theme, so the drawings carry explicit colours
      isDark: boolean
      // assignee login -> their photo as a data: URI, once loaded (hooks/avatars.ts)
      avatars: Record<string, string>
    }
  }
}
