import { describe, expect, test } from "bun:test";
import { normalizeSearchViewState } from "./search-view-state.js";

describe("search view state", () => {
  test("forces search mode when query is too short", () => {
    expect(
      normalizeSearchViewState({
        mode: "select",
        cursor: 3,
        queryLength: 1,
        resultsLength: 4,
        hasConfirm: true,
      })
    ).toEqual({
      mode: "search",
      cursor: 0,
      totalItems: 6,
    });
  });

  test("forces search mode when no results remain", () => {
    expect(
      normalizeSearchViewState({
        mode: "select",
        cursor: 2,
        queryLength: 4,
        resultsLength: 0,
        hasConfirm: false,
      })
    ).toEqual({
      mode: "search",
      cursor: 0,
      totalItems: 1,
    });
  });

  test("clamps cursor to available items when results shrink", () => {
    expect(
      normalizeSearchViewState({
        mode: "select",
        cursor: 10,
        queryLength: 5,
        resultsLength: 2,
        hasConfirm: true,
      })
    ).toEqual({
      mode: "select",
      cursor: 3,
      totalItems: 4,
    });
  });
});
