import { describe, expect, test } from "bun:test";
import * as cache from "./index.js";

describe("cache library exports", () => {
  test("exposes cache operations and migration entrypoints", () => {
    expect(typeof cache.migrate).toBe("function");
    expect(typeof cache.set).toBe("function");
    expect(typeof cache.get).toBe("function");
    expect(typeof cache.getOrSet).toBe("function");
    expect(typeof cache.createNamespace).toBe("function");
    expect(typeof cache.getNamespaceStats).toBe("function");
  });
});
