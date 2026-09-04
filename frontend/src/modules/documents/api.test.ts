import { describe, expect, it } from "vitest"
import { MAX_FILE_SIZE, buildUploadForm } from "@/modules/documents/api"
import { titleFromFilename, validateFile } from "@/modules/documents/UploadDialog"

const PDF_MIME = "application/pdf"
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

function file(name: string, type: string, size = 10) {
  return new File(["x".repeat(size)], name, { type })
}

describe("buildUploadForm", () => {
  it("carries every field the endpoint takes", () => {
    const form = buildUploadForm({
      title: "Safety handbook",
      category_id: "c1",
      description: "How the fire drill runs.",
      change_note: "Adds the 2026 drill",
      file: file("handbook.pdf", PDF_MIME),
    })

    expect(form.get("title")).toBe("Safety handbook")
    expect(form.get("category_id")).toBe("c1")
    expect(form.get("description")).toBe("How the fire drill runs.")
    expect(form.get("change_note")).toBe("Adds the 2026 drill")
    expect((form.get("file") as File).name).toBe("handbook.pdf")
  })

  // Sending "" would store an empty description rather than leaving it null.
  it("leaves blank optional fields out entirely", () => {
    const form = buildUploadForm({
      title: "Safety handbook",
      category_id: "c1",
      description: "",
      change_note: "",
      file: file("handbook.pdf", PDF_MIME),
    })

    expect(form.has("description")).toBe(false)
    expect(form.has("change_note")).toBe(false)
    expect(form.has("title")).toBe(true)
  })
})

describe("validateFile", () => {
  it("accepts the types the server allows", () => {
    expect(validateFile(file("a.pdf", PDF_MIME))).toBeUndefined()
    expect(validateFile(file("a.docx", DOCX_MIME))).toBeUndefined()
    expect(validateFile(file("notes.md", "text/markdown"))).toBeUndefined()
  })

  // Browsers report .md's Content-Type inconsistently (text/plain,
  // application/octet-stream, or empty), so the filename decides — same rule
  // the server applies.
  it("accepts a .md file regardless of its reported type", () => {
    expect(validateFile(file("notes.md", ""))).toBeUndefined()
    expect(validateFile(file("notes.md", "text/plain"))).toBeUndefined()
    expect(validateFile(file("NOTES.MD", ""))).toBeUndefined()
  })

  it("rejects any other type, in the server's own words", () => {
    expect(validateFile(file("notes.txt", "text/plain"))).toBe(
      "File must be a PDF, DOCX, or Markdown file",
    )
    // Some systems report no type at all; the server would reject it too.
    expect(validateFile(file("mystery", ""))).toBe(
      "File must be a PDF, DOCX, or Markdown file",
    )
  })

  // MAX_FILE_SIZE is 20 MiB, so a file between 20,000,000 and 20,971,520 bytes
  // must still pass here — rounding it to 20 MB would reject what the server
  // accepts.
  it("uses the same 20 MiB ceiling as the server", () => {
    expect(MAX_FILE_SIZE).toBe(20 * 1024 * 1024)
    expect(validateFile(file("big.pdf", PDF_MIME, MAX_FILE_SIZE))).toBeUndefined()
    expect(validateFile(file("big.pdf", PDF_MIME, MAX_FILE_SIZE + 1))).toBe(
      "File exceeds the 20 MB limit",
    )
  })

  it("asks for a file when none was chosen", () => {
    expect(validateFile(null)).toBe("Choose a PDF, DOCX, or Markdown file.")
  })
})

describe("titleFromFilename", () => {
  it("strips the extension and leaves everything else untouched", () => {
    expect(titleFromFilename("NguyenAnLoc_Resume (CCAs).pdf")).toBe(
      "NguyenAnLoc_Resume (CCAs)",
    )
  })

  it("does not touch separators or casing", () => {
    expect(titleFromFilename("Claude-101-Training.pdf")).toBe("Claude-101-Training")
    expect(titleFromFilename("SAFETY_handbook.docx")).toBe("SAFETY_handbook")
  })

  it("only strips the final extension", () => {
    expect(titleFromFilename("v1.2-notes.md")).toBe("v1.2-notes")
  })
})
