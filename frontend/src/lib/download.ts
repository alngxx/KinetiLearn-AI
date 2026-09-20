// Navigating to a signed URL, kept in its own module for two reasons: the
// server signs these with Content-Disposition: attachment, so a click here
// saves the file without leaving the page, and window.open would be judged a
// popup because the URL only arrives after an await, outside the gesture that
// asked for it. Being a module of its own also means tests can mock it rather
// than fight jsdom, which implements no navigation at all.
export function startDownload(url: string): void {
  const link = document.createElement("a")
  link.href = url
  // The signed URL carries a credential in its query string; noreferrer keeps
  // it out of the Referer header of whatever it opens.
  link.rel = "noopener noreferrer"
  document.body.appendChild(link)
  link.click()
  link.remove()
}
