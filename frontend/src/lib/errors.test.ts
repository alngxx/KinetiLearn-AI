import { describe, expect, it } from "vitest"
import { networkError, normalizeError, type ApiError } from "@/lib/errors"

// Both real shapes: {"detail": "message"} from HTTPException, and
// {"detail": [...]} from Pydantic. Bodies below are copied from live responses.
const cases: { name: string; status: number; body: unknown; expected: ApiError }[] = [
  {
    name: "string detail (401 from /auth/login)",
    status: 401,
    body: { detail: "Invalid credentials" },
    expected: { status: 401, message: "Invalid credentials" },
  },
  {
    name: "string detail (404)",
    status: 404,
    body: { detail: "Chat session not found." },
    expected: { status: 404, message: "Chat session not found." },
  },
  {
    name: "validation list with one field",
    status: 422,
    body: {
      detail: [
        {
          loc: ["body", "email"],
          msg: "value is not a valid email address",
          type: "value_error",
        },
      ],
    },
    expected: {
      status: 422,
      message: "value is not a valid email address",
      fields: { email: "value is not a valid email address" },
    },
  },
  {
    name: "validation list with several fields",
    status: 422,
    body: {
      detail: [
        { loc: ["body", "email"], msg: "Field required", type: "missing" },
        {
          loc: ["body", "password"],
          msg: "String should have at least 8 characters",
          type: "string_too_short",
        },
      ],
    },
    expected: {
      status: 422,
      message: "Field required; String should have at least 8 characters",
      fields: {
        email: "Field required",
        password: "String should have at least 8 characters",
      },
    },
  },
  {
    name: "nested loc keeps the leaf field name",
    status: 422,
    body: {
      detail: [
        { loc: ["body", "answers", 0, "question_id"], msg: "Field required", type: "missing" },
      ],
    },
    expected: {
      status: 422,
      message: "Field required",
      fields: { question_id: "Field required" },
    },
  },
  {
    name: "query-param loc drops the source prefix",
    status: 422,
    body: {
      detail: [{ loc: ["query", "role"], msg: "Input should be a valid string", type: "string_type" }],
    },
    expected: {
      status: 422,
      message: "Input should be a valid string",
      fields: { role: "Input should be a valid string" },
    },
  },
  {
    name: "empty body falls back to the generic message",
    status: 500,
    body: null,
    expected: { status: 500, message: "Something went wrong. Please try again." },
  },
  {
    name: "unrecognised body falls back to the generic message",
    status: 500,
    body: { error: "boom" },
    expected: { status: 500, message: "Something went wrong. Please try again." },
  },
  {
    name: "empty detail array falls back to the generic message",
    status: 422,
    body: { detail: [] },
    expected: { status: 422, message: "Something went wrong. Please try again." },
  },
]

describe("normalizeError", () => {
  it.each(cases)("$name", ({ status, body, expected }) => {
    expect(normalizeError(status, body)).toEqual(expected)
  })

  it("keeps the first message when one field fails twice", () => {
    const result = normalizeError(422, {
      detail: [
        { loc: ["body", "password"], msg: "Field required", type: "missing" },
        { loc: ["body", "password"], msg: "String should have at least 8 characters", type: "x" },
      ],
    })
    expect(result.fields).toEqual({ password: "Field required" })
  })
})

describe("networkError", () => {
  it("reports status 0 because no response arrived", () => {
    expect(networkError()).toEqual({
      status: 0,
      message: "Could not reach the server. Check your connection.",
    })
  })
})
