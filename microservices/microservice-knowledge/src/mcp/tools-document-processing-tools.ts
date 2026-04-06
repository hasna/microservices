// --- Document processing tools ---

server.tool(
  "knowledge_detect_document_format",
  "Detect the format of document content",
  {
    content: z.string().optional().describe("Document content as string"),
    filename: z.string().optional().describe("Filename to detect format from extension"),
    mime_type: z.string().optional().describe("MIME type hint"),
  },
  async ({ content, filename, mime_type }) => {
    const format = filename
      ? detectFormatFromFilename(filename)
      : content
        ? detectFormat(content, mime_type)
        : "unknown";
    return text({ format, filename, mime_type });
  },
);

server.tool(
  "knowledge_process_document",
  "Process raw document content and extract structured text and metadata",
  {
    content: z.string().describe("Document content as string"),
    filename: z.string().optional().describe("Filename for format detection"),
    mime_type: z.string().optional().describe("MIME type hint"),
  },
  async ({ content, filename, mime_type }) =>
    text(processDocument(content, filename, mime_type)),
);

