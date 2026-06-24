export const DEFAULT_LIST_LIMIT = 20;
export const DEFAULT_SEARCH_LIMIT = 10;
export const DEFAULT_OUTPUT_MAX_CHARS = 4000;
export const DEFAULT_OUTPUT_MAX_LINES = 80;

export interface ParsedIntegerOptions {
  defaultValue?: number | null;
  minimum?: number;
  maximum?: number;
  label?: string;
}

export function parseIntegerOption(
  value: string | number | undefined,
  {
    defaultValue = null,
    minimum = 0,
    maximum = Number.MAX_SAFE_INTEGER,
    label = "value",
  }: ParsedIntegerOptions = {},
): number | null {
  if (value === undefined || value === "") return defaultValue;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return parsed;
}

export function truncateText(value: unknown, maxChars = 80): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return text.slice(0, maxChars);
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function paginate<T>(
  rows: T[],
  {
    limit,
    offset = 0,
  }: {
    limit: number | null;
    offset?: number;
  },
): T[] {
  if (limit === null) return rows.slice(offset);
  return rows.slice(offset, offset + limit);
}

export interface TextTableColumn<T> {
  header: string;
  width: number;
  value: (row: T) => unknown;
}

export function formatTextTable<T>(
  rows: T[],
  columns: Array<TextTableColumn<T>>,
): string {
  const header = columns
    .map((column) => column.header.padEnd(column.width))
    .join("  ")
    .trimEnd();
  const divider = columns
    .map((column) => "-".repeat(column.width))
    .join("  ")
    .trimEnd();
  const body = rows.map((row) =>
    columns
      .map((column) =>
        truncateText(column.value(row), column.width).padEnd(column.width),
      )
      .join("  ")
      .trimEnd(),
  );
  return [header, divider, ...body].join("\n");
}

export interface OutputSummary {
  text: string;
  truncated: boolean;
  omittedChars: number;
  omittedLines: number;
}

export function summarizeOutput(
  text: string,
  {
    maxChars = DEFAULT_OUTPUT_MAX_CHARS,
    maxLines = DEFAULT_OUTPUT_MAX_LINES,
  }: {
    maxChars?: number;
    maxLines?: number;
  } = {},
): OutputSummary {
  const source = text.trimEnd();
  const lines = source.split(/\r?\n/);
  let visible = lines.slice(0, maxLines).join("\n");
  const omittedLines = Math.max(0, lines.length - maxLines);
  let omittedChars = Math.max(0, source.length - visible.length);

  if (visible.length > maxChars) {
    visible = visible.slice(0, maxChars);
    omittedChars = Math.max(omittedChars, source.length - visible.length);
  }

  return {
    text: visible,
    truncated: omittedLines > 0 || omittedChars > 0,
    omittedChars,
    omittedLines,
  };
}

export function formatTruncationHint(
  summary: Pick<OutputSummary, "omittedChars" | "omittedLines">,
  detailHint: string,
): string {
  const parts: string[] = [];
  if (summary.omittedLines > 0) parts.push(`${summary.omittedLines} line(s)`);
  if (summary.omittedChars > 0) parts.push(`${summary.omittedChars} char(s)`);
  return `[output truncated: omitted ${parts.join(", ") || "content"}; ${detailHint}]`;
}

export function formatPageHint({
  shown,
  total,
  limit,
  offset = 0,
  detailHint,
}: {
  shown: number;
  total: number;
  limit: number | null;
  offset?: number;
  detailHint: string;
}): string {
  const end = offset + shown;
  const base =
    limit === null
      ? `Showing ${shown} of ${total}.`
      : `Showing ${shown} of ${total} (offset ${offset}, next offset ${end < total ? end : "none"}).`;
  return end < total ? `${base} ${detailHint}` : base;
}
