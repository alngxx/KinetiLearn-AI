import { describe, expect, it } from "vitest"
import {
  clearToken,
  decodeToken,
  getToken,
  isExpired,
  setToken,
  type TokenClaims,
} from "@/lib/tokenStorage"

// Issued by app/core/security.create_access_token, so the encoding under test is
// the real one rather than something this file invented.
const REAL_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJzdWIiOiIzZjFiMGM5ZS0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlIjoiYWRtaW4iLCJleHAiOjE3ODcwNTc2OTl9." +
  "MpXadvQV3M4nWEF0e6X2_6FpSCuo3F51zZht9vMgeao"

const REAL_CLAIMS: TokenClaims = {
  sub: "3f1b0c9e-0000-4000-8000-000000000001",
  role: "admin",
  exp: 1787057699,
}

function base64url(value: object): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

export function makeToken(claims: object): string {
  return `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url(claims)}.signature`
}

describe("decodeToken", () => {
  it("reads sub, role and exp from a token the backend actually issued", () => {
    expect(decodeToken(REAL_TOKEN)).toEqual(REAL_CLAIMS)
  })

  const rejected = [
    { name: "not a JWT at all", token: "garbage" },
    { name: "only two segments", token: "header.payload" },
    { name: "payload is not base64", token: "header.!!!!.signature" },
    { name: "payload is not JSON", token: `header.${btoa("not json")}.signature` },
    { name: "missing role claim", token: makeToken({ sub: "u1", exp: 100 }) },
    { name: "missing sub claim", token: makeToken({ role: "admin", exp: 100 }) },
    { name: "exp is a string", token: makeToken({ sub: "u1", role: "admin", exp: "100" }) },
  ]

  it.each(rejected)("returns null when $name", ({ token }) => {
    expect(decodeToken(token)).toBeNull()
  })
})

describe("isExpired", () => {
  // exp is seconds since the epoch; Date.now() is milliseconds.
  const claims: TokenClaims = { sub: "u1", role: "learner", exp: 1_000 }

  it("is false a minute before expiry", () => {
    expect(isExpired(claims, 940_000)).toBe(false)
  })

  it("is true at the exact expiry instant", () => {
    expect(isExpired(claims, 1_000_000)).toBe(true)
  })

  it("is true a second after expiry", () => {
    expect(isExpired(claims, 1_001_000)).toBe(true)
  })
})

describe("token storage", () => {
  it("round-trips a token and clears it", () => {
    expect(getToken()).toBeNull()
    setToken(REAL_TOKEN)
    expect(getToken()).toBe(REAL_TOKEN)
    clearToken()
    expect(getToken()).toBeNull()
  })
})
