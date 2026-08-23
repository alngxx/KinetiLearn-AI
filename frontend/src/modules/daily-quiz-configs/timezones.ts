// Intl.supportedValuesOf("timeZone") only lists ICU's canonical spelling of each
// zone. The server's own default, "Asia/Ho_Chi_Minh", canonicalises to
// "Asia/Saigon" and so is absent from that list — without this, an existing
// row's zone would match no option, the select would silently fall back to its
// placeholder, and saving from there would rewrite the config's zone out from
// under it. Prepending the current value keeps it selected even when the list
// itself doesn't carry it.
export function timezoneOptions(current?: string | null): string[] {
  const zones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : ["UTC"]
  if (current !== undefined && current !== null && current !== "" && !zones.includes(current)) {
    return [current, ...zones]
  }
  return zones
}
