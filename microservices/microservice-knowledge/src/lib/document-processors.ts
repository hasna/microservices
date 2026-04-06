/**
 * Multi-format document processing for microservice-knowledge.
 *
 * - Extract text from PDFs, DOCX, HTML, markdown, plain text
 * - Auto-detect document format from content/mime type
 * - Process documents in a unified way regardless of source format
 * - Preserve document structure metadata (headings, lists, tables)
 */

export type DocumentFormat = "pdf" | "docx" | "html" | "markdown" | "plaintext" | "unknown";

export interface ProcessedDocument {
  format: DocumentFormat;
  title: string | null;
  text: string;
  /** Structured content blocks for chunking strategies */
  blocks: ContentBlock[];
  metadata: DocumentMetadata;
  warnings: string[];
}

export interface ContentBlock {
  type: "heading" | "paragraph" | "list_item" | "table" | "code" | "image" | "other";
  text: string;
  level?: number; // For headings (h1=1, h2=2, etc.)
  list_bullet?: string; // For list items
  headers?: string[]; // For tables
  rows?: string[][]; // For tables
}

export interface DocumentMetadata {
  word_count: number;
  char_count: number;
  page_count?: number; // PDF only
  headings: number;
  lists: number;
  tables: number;
  images: number;
  code_blocks: number;
  language: string | null;
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/**
 * Detect document format from content bytes or mime type string.
 */
export function detectFormat(
  content: Uint8Array | string,
  mimeType?: string,
): DocumentFormat {
  if (mimeType) {
    if (mimeType === "application/pdf") return "pdf";
    if (mimeType.includes("word") || mimeType.includes("docx")) return "docx";
    if (mimeType.includes("html")) return "html";
    if (mimeType.includes("markdown") || mimeType.includes("md")) return "markdown";
    if (mimeType.includes("text")) return "plaintext";
  }

  // Heuristic detection from content
  if (typeof content !== "string") {
    // Check for PDF magic bytes
    if (content.length > 4) {
      const header = new TextDecoder().decode(content.slice(0, 8));
      if (header.startsWith("%PDF")) return "pdf";
    }
    return "unknown";
  }

  // Text-based detection
  const trimmed = content.trim();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) return "html";
  if (trimmed.startsWith("#") || trimmed.includes("\n===\n") || trimmed.includes("---\n")) return "markdown";
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return "plaintext"; // Could be JSON

  return "plaintext";
}

/**
 * Detect format from filename extension.
 */
export function detectFormatFromFilename(filename: string): DocumentFormat {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf": return "pdf";
    case "docx":
    case "doc": return "docx";
    case "html":
    case "htm": return "html";
    case "md":
    case "markdown": return "markdown";
    case "txt":
    case "text": return "plaintext";
    default: return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/**
 * Extract text from HTML content, stripping tags but preserving structure.
 */
export function extractFromHtml(html: string): ProcessedDocument {
  const warnings: string[] = [];
  const blocks: ContentBlock[] = [];

  // Strip scripts and styles
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // Extract title
  const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1]!.trim() : null;

  // Extract headings
  const headingRegex = /<h([1-6])[^>]*>([^<]+)<\/h\1>/gi;
  let headingMatch;
  const headings: number[] = [];
  while ((headingMatch = headingRegex.exec(text)) !== null) {
    headings.push(parseInt(headingMatch[1]!, 10));
    blocks.push({
      type: "heading",
      text: headingMatch[2]!.trim(),
      level: parseInt(headingMatch[1]!, 10),
    });
  }

  // Remove headings from text
  text = text.replace(headingRegex, "\n");

  // Extract lists
  const listRegex = /<li[^>]*>([^<]+)<\/li>/gi;
  const lists: string[] = [];
  while ((headingMatch = listRegex.exec(text)) !== null) {
    lists.push(headingMatch[1]!.trim());
    blocks.push({ type: "list_item", text: headingMatch[1]!.trim(), list_bullet: "-" });
  }

  // Extract tables
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  const tables: { headers: string[]; rows: string[][] }[] = [];
  while ((tableMatch = tableRegex.exec(text)) !== null) {
    const tableHtml = tableMatch[1]!;
    const headers: string[] = [];
    const rows: string[][] = [];

    const headerCells = tableHtml.match(/<th[^>]*>([^<]+)<\/th>/gi);
    if (headerCells) {
      for (const cell of headerCells) {
        headers.push(cell.replace(/<[^>]+>/g, "").trim());
      }
    }

    const dataRows = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) ?? [];
    for (const row of dataRows) {
      const cells = row.match(/<td[^>]*>([^<]+)<\/td>/gi);
      if (cells) {
        rows.push(cells.map((c) => c.replace(/<[^>]+>/g, "").trim()));
      }
    }

    if (headers.length > 0 || rows.length > 0) {
      tables.push({ headers, rows });
      blocks.push({ type: "table", text: "", headers, rows });
    }
  }

  // Extract code blocks
  const codeRegex = /<code[^>]*>([\s\S]*?)<\/code>/gi;
  let codeMatch;
  const codeBlocks: string[] = [];
  while ((codeMatch = codeRegex.exec(text)) !== null) {
    const code = codeMatch[1]!.replace(/<[^>]+>/g, "");
    codeBlocks.push(code);
    blocks.push({ type: "code", text: code });
  }

  // Strip remaining HTML tags
  text = text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

  const words = text.split(/\s+/).filter((w) => w.length > 0);

  return {
    format: "html",
    title,
    text,
    blocks,
    metadata: {
      word_count: words.length,
      char_count: text.length,
      headings: headings.length,
      lists: lists.length,
      tables: tables.length,
      images: 0,
      code_blocks: codeBlocks.length,
      language: null,
    },
    warnings,
  };
}

/**
 * Extract text from markdown content.
 */
export function extractFromMarkdown(markdown: string): ProcessedDocument {
  const warnings: string[] = [];
  const blocks: ContentBlock[] = [];
  const lines = markdown.split("\n");

  let title: string | null = null;
  let inCodeBlock = false;
  let codeBlockContent = "";
  let listItems: string[] = [];
  let tableHeaders: string[] = [];
  let tableRows: string[][] = [];
  let inTable = false;

  const processList = () => {
    if (listItems.length > 0) {
      for (const item of listItems) {
        blocks.push({ type: "list_item", text: item, list_bullet: "-" });
      }
      listItems = [];
    }
  };

  const processTable = () => {
    if (tableHeaders.length > 0 || tableRows.length > 0) {
      blocks.push({ type: "table", text: "", headers: tableHeaders, rows: tableRows });
      tableHeaders = [];
      tableRows = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        blocks.push({ type: "code", text: codeBlockContent.trim() });
        codeBlockContent = "";
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent += trimmed + "\n";
      continue;
    }

    if (trimmed.startsWith("# ")) {
      if (!title) title = trimmed.slice(2).trim();
      blocks.push({ type: "heading", text: trimmed.slice(2).trim(), level: 1 });
      continue;
    }
    if (trimmed.startsWith("## ")) {
      blocks.push({ type: "heading", text: trimmed.slice(3).trim(), level: 2 });
      continue;
    }
    if (trimmed.startsWith("### ")) {
      blocks.push({ type: "heading", text: trimmed.slice(4).trim(), level: 3 });
      continue;
    }

    if (trimmed.startsWith("|")) {
      // Table row
      const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => c.match(/^-+$/))) {
        // Separator row
        inTable = true;
        continue;
      }
      if (tableHeaders.length === 0 && inTable) {
        tableHeaders = cells;
      } else {
        tableRows.push(cells);
      }
      continue;
    } else if (inTable) {
      processTable();
      inTable = false;
    }

    if (trimmed.match(/^[-*+]\s/)) {
      listItems.push(trimmed.slice(2).trim());
      continue;
    } else if (listItems.length > 0) {
      processList();
    }

    if (trimmed === "") continue;

    blocks.push({ type: "paragraph", text: trimmed });
  }

  if (listItems.length > 0) processList();
  if (inTable) processTable();
  if (inCodeBlock) {
    warnings.push("Unclosed code block");
    blocks.push({ type: "code", text: codeBlockContent.trim() });
  }

  const text = blocks
    .filter((b) => b.type !== "code" || b.text)
    .map((b) => (b.type === "heading" ? " ".repeat((b.level ?? 1) - 1) + b.text : b.text))
    .join("\n");

  const words = text.split(/\s+/).filter((w) => w.length > 0);

  return {
    format: "markdown",
    title,
    text,
    blocks,
    metadata: {
      word_count: words.length,
      char_count: text.length,
      headings: blocks.filter((b) => b.type === "heading").length,
      lists: blocks.filter((b) => b.type === "list_item").length,
      tables: blocks.filter((b) => b.type === "table").length,
      images: 0,
      code_blocks: blocks.filter((b) => b.type === "code").length,
      language: null,
    },
    warnings,
  };
}

/**
 * Process plain text content.
 */
export function extractFromPlainText(text: string): ProcessedDocument {
  const lines = text.split("\n");
  const blocks: ContentBlock[] = [];
  let listItems: string[] = [];

  const processList = () => {
    if (listItems.length > 0) {
      for (const item of listItems) {
        blocks.push({ type: "list_item", text: item, list_bullet: "-" });
      }
      listItems = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      processList();
      continue;
    }
    if (trimmed.match(/^[-*+]\s/) || trimmed.match(/^\d+\.\s/)) {
      listItems.push(trimmed.replace(/^[-*+]\s/, "").replace(/^\d+\.\s/, ""));
      continue;
    }
    if (listItems.length > 0) processList();
    blocks.push({ type: "paragraph", text: trimmed });
  }

  if (listItems.length > 0) processList();

  const joinedText = blocks.map((b) => b.text).join("\n");
  const words = joinedText.split(/\s+/).filter((w) => w.length > 0);

  return {
    format: "plaintext",
    title: null,
    text: joinedText,
    blocks,
    metadata: {
      word_count: words.length,
      char_count: joinedText.length,
      headings: 0,
      lists: blocks.filter((b) => b.type === "list_item").length,
      tables: 0,
      images: 0,
      code_blocks: 0,
      language: null,
    },
    warnings: [],
  };
}

/**
 * Auto-detect format and process document content.
 */
export function processDocument(
  content: Uint8Array | string,
  filename?: string,
  mimeType?: string,
): ProcessedDocument {
  const format = filename
    ? detectFormatFromFilename(filename)
    : detectFormat(content, mimeType);

  switch (format) {
    case "html":
      return typeof content === "string"
        ? extractFromHtml(content)
        : extractFromHtml(new TextDecoder().decode(content));
    case "markdown":
      return typeof content === "string"
        ? extractFromMarkdown(content)
        : extractFromMarkdown(new TextDecoder().decode(content));
    case "pdf":
      return {
        format: "pdf",
        title: null,
        text: "[PDF extraction requires pdf-parse or similar library - install pdf-parse for PDF support]",
        blocks: [{ type: "paragraph", text: "[PDF extraction requires pdf-parse or similar library]" }],
        metadata: {
          word_count: 0,
          char_count: 0,
          headings: 0,
          lists: 0,
          tables: 0,
          images: 0,
          code_blocks: 0,
          language: null,
        },
        warnings: ["PDF extraction not implemented - requires pdf-parse library"],
      };
    case "docx":
      return {
        format: "docx",
        title: null,
        text: "[DOCX extraction requires mammoth or similar library - install mammoth for DOCX support]",
        blocks: [{ type: "paragraph", text: "[DOCX extraction requires mammoth library]" }],
        metadata: {
          word_count: 0,
          char_count: 0,
          headings: 0,
          lists: 0,
          tables: 0,
          images: 0,
          code_blocks: 0,
          language: null,
        },
        warnings: ["DOCX extraction not implemented - requires mammoth library"],
      };
    default:
      return typeof content === "string"
        ? extractFromPlainText(content)
        : extractFromPlainText(new TextDecoder().decode(content));
  }
}
