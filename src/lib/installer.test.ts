import { describe, test, expect } from "bun:test";
import { getInstalledMicroservices, getMicroserviceStatus, microserviceExists } from "./installer.js";
import { MICROSERVICES } from "./registry.js";

describe("Installer", () => {
  test("getInstalledMicroservices returns array", () => {
    const installed = getInstalledMicroservices();
    expect(Array.isArray(installed)).toBe(true);
    // All entries should be valid service names
    for (const name of installed) {
      expect(MICROSERVICES.some((m) => m.name === name)).toBe(true);
    }
  });

  test("getMicroserviceStatus returns correct shape for known service", () => {
    const status = getMicroserviceStatus("auth");
    expect(status.name).toBe("auth");
    expect(typeof status.installed).toBe("boolean");
    expect(status.meta).toBeDefined();
    expect(status.meta!.package).toBe("@hasna/microservice-auth");
  });

  test("getMicroserviceStatus returns unknown=false meta for nonexistent", () => {
    const status = getMicroserviceStatus("nonexistent");
    expect(status.installed).toBe(false);
    expect(status.meta).toBeUndefined();
  });

  test("microserviceExists returns boolean", () => {
    expect(typeof microserviceExists("auth")).toBe("boolean");
    expect(typeof microserviceExists("nonexistent")).toBe("boolean");
    expect(microserviceExists("nonexistent")).toBe(false);
  });

  test("all 8 services have valid metadata", () => {
    for (const ms of MICROSERVICES) {
      const status = getMicroserviceStatus(ms.name);
      expect(status.name).toBe(ms.name);
      expect(status.meta).toBeDefined();
    }
  });
});
