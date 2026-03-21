export type SearchMode = "search" | "select";

export interface SearchViewStateInput {
  mode: SearchMode;
  cursor: number;
  queryLength: number;
  resultsLength: number;
  hasConfirm: boolean;
}

export interface SearchViewState {
  mode: SearchMode;
  cursor: number;
  totalItems: number;
}

export function normalizeSearchViewState(
  input: SearchViewStateInput
): SearchViewState {
  const totalItems = input.resultsLength + 1 + (input.hasConfirm ? 1 : 0);
  const shouldForceSearch = input.queryLength < 2 || input.resultsLength === 0;

  if (shouldForceSearch) {
    return {
      mode: "search",
      cursor: 0,
      totalItems,
    };
  }

  return {
    mode: input.mode,
    cursor: Math.max(0, Math.min(input.cursor, totalItems - 1)),
    totalItems,
  };
}
