// Which conversation the chat panel reopens on. Only a pointer — the messages
// themselves live server-side and are fetched by id, so a stale or foreign id
// costs nothing worse than a 404 the panel recovers from.

const CHAT_SESSION_KEY = "kinetilearn_chat_session"

export function getStoredChatSession(): string | null {
  return localStorage.getItem(CHAT_SESSION_KEY)
}

export function setStoredChatSession(id: string): void {
  localStorage.setItem(CHAT_SESSION_KEY, id)
}

export function clearStoredChatSession(): void {
  localStorage.removeItem(CHAT_SESSION_KEY)
}
