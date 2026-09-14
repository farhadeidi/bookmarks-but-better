import type { BookmarkNode } from "../types"
import { deriveBookmarkTitle } from "./netscape-parser"

const POCKET_FOLDER_NAME = "Pocket"

type CsvFormat = "raindrop" | "pocket" | "fallback"

interface DetectedFormat {
  format: CsvFormat
  urlIndex: number
  titleIndex: number
  folderIndex: number
}

export interface CsvImportResult {
  nodes: BookmarkNode[]
  /** Rows dropped for lacking a valid http(s) URL. */
  skipped: number
}

/**
 * Tokenizes RFC 4180 CSV text into rows of fields.
 *
 * Handles quoted fields (embedded commas and newlines) and the doubled-quote
 * escape (`""` inside a quoted field means a literal `"`). `\r\n`, `\n`, and a
 * bare `\r` inside quotes are all treated as ordinary characters or row breaks
 * the same way real-world exporters emit them.
 */
function tokenizeCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += char
      i++
      continue
    }

    if (char === '"') {
      inQuotes = true
      i++
      continue
    }
    if (char === ",") {
      row.push(field)
      field = ""
      i++
      continue
    }
    if (char === "\r") {
      i++
      continue
    }
    if (char === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
      i++
      continue
    }

    field += char
    i++
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.length > 1 || r[0].trim() !== "")
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase()
}

function detectFormat(headerRow: string[]): DetectedFormat | null {
  const normalized = headerRow.map(normalizeHeader)
  const urlIndex = normalized.indexOf("url")
  if (urlIndex === -1) return null

  const titleIndex = normalized.indexOf("title")
  const folderIndex = normalized.indexOf("folder")

  if (folderIndex !== -1) {
    return { format: "raindrop", urlIndex, titleIndex, folderIndex }
  }
  if (normalized.includes("time_added") || normalized.includes("status")) {
    return { format: "pocket", urlIndex, titleIndex, folderIndex: -1 }
  }
  return { format: "fallback", urlIndex, titleIndex, folderIndex: -1 }
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value.trim()).protocol
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

/** Strips a leading directory and trailing extension: `a/b/My Export.csv` -> `My Export`. */
function baseFileName(fileName: string): string {
  const withoutPath = fileName.split(/[/\\]/).pop() ?? fileName
  const dot = withoutPath.lastIndexOf(".")
  const stem = dot > 0 ? withoutPath.slice(0, dot) : withoutPath
  return stem.trim() || "Imported"
}

/** Finds or creates the nested folder chain for a Raindrop `Parent/Child` path. */
function getOrCreateFolder(
  rootChildren: BookmarkNode[],
  folderMap: Map<string, BookmarkNode>,
  segments: string[],
  generateId: () => string
): BookmarkNode | null {
  let siblings = rootChildren
  let path = ""
  let folder: BookmarkNode | null = null

  for (const segment of segments) {
    path = path ? `${path}/${segment}` : segment
    let existing = folderMap.get(path)
    if (!existing) {
      existing = { id: generateId(), title: segment, children: [] }
      folderMap.set(path, existing)
      siblings.push(existing)
    }
    folder = existing
    siblings = folder.children!
  }

  return folder
}

/**
 * Parses a Raindrop or Pocket CSV export (or an unrecognized CSV with a `url`
 * column) into the same bookmark tree shape `parseNetscapeBookmarks` produces,
 * so the existing import plan, preview and conflict handling apply unchanged.
 *
 * Format is detected from the header row: a `folder` column means Raindrop
 * (its `Parent/Child` path becomes nested folders); `time_added` or `status`
 * means Pocket (everything lands in one "Pocket" folder); otherwise any `url`
 * column falls back to a single folder named after the file.
 */
export function parseCsvBookmarks(
  csv: string,
  fileName: string
): CsvImportResult {
  const withoutBom = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv
  const rows = tokenizeCsv(withoutBom)
  if (rows.length === 0) return { nodes: [], skipped: 0 }

  const [headerRow, ...dataRows] = rows
  const detected = detectFormat(headerRow)
  if (!detected) return { nodes: [], skipped: 0 }

  const { format, urlIndex, titleIndex, folderIndex } = detected

  let idCounter = 1
  const generateId = () => String(idCounter++)

  const rootChildren: BookmarkNode[] = []
  const folderMap = new Map<string, BookmarkNode>()
  const singleFolderName =
    format === "pocket" ? POCKET_FOLDER_NAME : baseFileName(fileName)
  let skipped = 0

  for (const row of dataRows) {
    const rawUrl = row[urlIndex] ?? ""
    if (!isHttpUrl(rawUrl)) {
      skipped += 1
      continue
    }
    const url = rawUrl.trim()
    const rawTitle = titleIndex !== -1 ? (row[titleIndex] ?? "") : ""
    const title = deriveBookmarkTitle(rawTitle, url)

    let targetChildren: BookmarkNode[]

    if (format === "raindrop") {
      const folderPath = folderIndex !== -1 ? (row[folderIndex] ?? "") : ""
      const segments = folderPath
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean)
      const folder = getOrCreateFolder(
        rootChildren,
        folderMap,
        segments,
        generateId
      )
      targetChildren = folder ? folder.children! : rootChildren
    } else {
      let folder = folderMap.get(singleFolderName)
      if (!folder) {
        folder = { id: generateId(), title: singleFolderName, children: [] }
        folderMap.set(singleFolderName, folder)
        rootChildren.push(folder)
      }
      targetChildren = folder.children!
    }

    targetChildren.push({
      id: generateId(),
      title,
      url,
      children: undefined,
    })
  }

  return { nodes: rootChildren, skipped }
}
