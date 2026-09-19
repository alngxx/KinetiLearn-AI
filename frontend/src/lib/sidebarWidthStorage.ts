// A per-viewer convenience, not shared data — kept in localStorage, never the
// database. Wrapped in try/catch since a blocked or private-browsing store
// throws on read and write alike, and losing the remembered width should
// never break the layout.

const SIDEBAR_WIDTH_KEY = "kinetilearn_admin_sidebar_width"

export function getStoredSidebarWidth(): number | null {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (stored === null) return null
    const width = Number(stored)
    return Number.isFinite(width) ? width : null
  } catch {
    return null
  }
}

export function setStoredSidebarWidth(width: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width))
  } catch {
    // Blocked storage — the width just won't survive a reload this session.
  }
}
