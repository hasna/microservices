import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createAnnotation, listAnnotations, deleteAnnotation } from "../../db/annotations.js";

export function registerAnnotationsTools(server: McpServer) {
  // ---------------------------------------------------------------------------
  // add_annotation
  // ---------------------------------------------------------------------------

  server.registerTool(
    "add_annotation",
    {
      title: "Add Annotation",
      description: "Add a timestamped annotation/bookmark to a transcript.",
      inputSchema: {
        transcript_id: z.string(), timestamp_sec: z.number(), note: z.string(),
      },
    },
    async ({ transcript_id, timestamp_sec, note }) => {
      const anno = createAnnotation(transcript_id, timestamp_sec, note);
      return { content: [{ type: "text", text: JSON.stringify(anno, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // list_annotations
  // ---------------------------------------------------------------------------

  server.registerTool(
    "list_annotations",
    {
      title: "List Annotations",
      description: "List all annotations for a transcript.",
      inputSchema: { transcript_id: z.string() },
    },
    async ({ transcript_id }) => {
      return { content: [{ type: "text", text: JSON.stringify(listAnnotations(transcript_id), null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // delete_annotation
  // ---------------------------------------------------------------------------

  server.registerTool(
    "delete_annotation",
    {
      title: "Delete Annotation",
      description: "Delete an annotation by ID.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const ok = deleteAnnotation(id);
      if (!ok) return { content: [{ type: "text", text: "Annotation not found." }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify({ id, deleted: true }) }] };
    }
  );
}
