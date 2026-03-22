import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-assets-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createAsset,
  getAsset,
  listAssets,
  updateAsset,
  deleteAsset,
  searchAssets,
  listByType,
  listByTag,
  listByCategory,
  getAssetStats,
  createCollection,
  getCollection,
  listCollections,
  deleteCollection,
  addToCollection,
  removeFromCollection,
  getCollectionAssets,
} from "./assets";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Assets", () => {
  test("create and get asset", () => {
    const asset = createAsset({
      name: "Logo.png",
      description: "Company logo",
      type: "logo",
      file_path: "/uploads/logo.png",
      file_size: 25600,
      mime_type: "image/png",
      dimensions: "512x512",
      tags: ["brand", "logo"],
      category: "branding",
      uploaded_by: "alice",
    });

    expect(asset.id).toBeTruthy();
    expect(asset.name).toBe("Logo.png");
    expect(asset.description).toBe("Company logo");
    expect(asset.type).toBe("logo");
    expect(asset.file_path).toBe("/uploads/logo.png");
    expect(asset.file_size).toBe(25600);
    expect(asset.mime_type).toBe("image/png");
    expect(asset.dimensions).toBe("512x512");
    expect(asset.tags).toEqual(["brand", "logo"]);
    expect(asset.category).toBe("branding");
    expect(asset.uploaded_by).toBe("alice");

    const fetched = getAsset(asset.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(asset.id);
    expect(fetched!.name).toBe("Logo.png");
  });

  test("create asset with minimal fields", () => {
    const asset = createAsset({ name: "Minimal Asset" });
    expect(asset.id).toBeTruthy();
    expect(asset.name).toBe("Minimal Asset");
    expect(asset.description).toBeNull();
    expect(asset.type).toBeNull();
    expect(asset.tags).toEqual([]);
    expect(asset.metadata).toEqual({});
  });

  test("get non-existent asset returns null", () => {
    const result = getAsset("non-existent-id");
    expect(result).toBeNull();
  });

  test("list assets", () => {
    createAsset({ name: "Image1.jpg", type: "image", category: "photos" });
    const all = listAssets();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("list assets with limit", () => {
    const limited = listAssets({ limit: 1 });
    expect(limited.length).toBe(1);
  });

  test("search assets by name", () => {
    const results = searchAssets("Logo");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((a) => a.name === "Logo.png")).toBe(true);
  });

  test("search assets by description", () => {
    const results = searchAssets("Company logo");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("search assets by tag", () => {
    const results = searchAssets("brand");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("list by type", () => {
    const images = listByType("image");
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(images.every((a) => a.type === "image")).toBe(true);
  });

  test("list by tag", () => {
    const results = listByTag("logo");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((a) => a.tags.includes("logo"))).toBe(true);
  });

  test("list by category", () => {
    const results = listByCategory("branding");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((a) => a.category === "branding")).toBe(true);
  });

  test("update asset", () => {
    const asset = createAsset({ name: "OldName.txt", type: "document" });
    const updated = updateAsset(asset.id, {
      name: "NewName.txt",
      description: "Updated description",
      tags: ["updated"],
      file_size: 1024,
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("NewName.txt");
    expect(updated!.description).toBe("Updated description");
    expect(updated!.tags).toEqual(["updated"]);
    expect(updated!.file_size).toBe(1024);
  });

  test("update non-existent asset returns null", () => {
    const result = updateAsset("non-existent-id", { name: "Nope" });
    expect(result).toBeNull();
  });

  test("update asset with no changes returns existing", () => {
    const asset = createAsset({ name: "Stable.pdf" });
    const updated = updateAsset(asset.id, {});
    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Stable.pdf");
  });

  test("delete asset", () => {
    const asset = createAsset({ name: "DeleteMe.tmp" });
    expect(deleteAsset(asset.id)).toBe(true);
    expect(getAsset(asset.id)).toBeNull();
  });

  test("delete non-existent asset returns false", () => {
    expect(deleteAsset("non-existent-id")).toBe(false);
  });

  test("get asset stats", () => {
    const stats = getAssetStats();
    expect(stats.total_assets).toBeGreaterThanOrEqual(3);
    expect(stats.total_size).toBeGreaterThanOrEqual(0);
    expect(typeof stats.by_type).toBe("object");
    expect(typeof stats.by_category).toBe("object");
  });

  test("asset stats by_type counts are correct", () => {
    // Create a known video asset
    createAsset({ name: "StatsVideo.mp4", type: "video", file_size: 5000 });
    const stats = getAssetStats();
    expect(stats.by_type["video"]).toBeGreaterThanOrEqual(1);
  });

  test("create asset with metadata", () => {
    const asset = createAsset({
      name: "WithMeta.png",
      metadata: { source: "camera", resolution: "4k" },
    });
    expect(asset.metadata).toEqual({ source: "camera", resolution: "4k" });
  });
});

describe("Collections", () => {
  test("create and get collection", () => {
    const collection = createCollection({
      name: "Brand Assets",
      description: "Official brand assets",
    });

    expect(collection.id).toBeTruthy();
    expect(collection.name).toBe("Brand Assets");
    expect(collection.description).toBe("Official brand assets");

    const fetched = getCollection(collection.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Brand Assets");
  });

  test("list collections", () => {
    createCollection({ name: "Marketing" });
    const collections = listCollections();
    expect(collections.length).toBeGreaterThanOrEqual(2);
  });

  test("delete collection", () => {
    const collection = createCollection({ name: "ToDelete" });
    expect(deleteCollection(collection.id)).toBe(true);
    expect(getCollection(collection.id)).toBeNull();
  });

  test("delete non-existent collection returns false", () => {
    expect(deleteCollection("non-existent-id")).toBe(false);
  });
});

describe("Collection-Asset relationships", () => {
  test("add asset to collection and list", () => {
    const collection = createCollection({ name: "Test Collection" });
    const asset1 = createAsset({ name: "Asset1.png", type: "image" });
    const asset2 = createAsset({ name: "Asset2.pdf", type: "document" });

    expect(addToCollection(collection.id, asset1.id)).toBe(true);
    expect(addToCollection(collection.id, asset2.id)).toBe(true);

    const assets = getCollectionAssets(collection.id);
    expect(assets.length).toBe(2);
    expect(assets.some((a) => a.name === "Asset1.png")).toBe(true);
    expect(assets.some((a) => a.name === "Asset2.pdf")).toBe(true);
  });

  test("remove asset from collection", () => {
    const collection = createCollection({ name: "RemoveTest" });
    const asset = createAsset({ name: "Removable.png" });
    addToCollection(collection.id, asset.id);

    expect(removeFromCollection(collection.id, asset.id)).toBe(true);
    const assets = getCollectionAssets(collection.id);
    expect(assets.length).toBe(0);
  });

  test("remove non-existent asset from collection returns false", () => {
    const collection = createCollection({ name: "EmptyCol" });
    expect(removeFromCollection(collection.id, "non-existent-id")).toBe(false);
  });

  test("adding duplicate asset to collection is idempotent", () => {
    const collection = createCollection({ name: "DupeTest" });
    const asset = createAsset({ name: "Dupe.png" });
    addToCollection(collection.id, asset.id);
    addToCollection(collection.id, asset.id); // duplicate add
    const assets = getCollectionAssets(collection.id);
    expect(assets.length).toBe(1);
  });

  test("deleting asset cascades to collection_assets", () => {
    const collection = createCollection({ name: "CascadeTest" });
    const asset = createAsset({ name: "Cascade.png" });
    addToCollection(collection.id, asset.id);
    deleteAsset(asset.id);
    const assets = getCollectionAssets(collection.id);
    expect(assets.length).toBe(0);
  });

  test("deleting collection cascades to collection_assets", () => {
    const collection = createCollection({ name: "CascadeCol" });
    const asset = createAsset({ name: "StillHere.png" });
    addToCollection(collection.id, asset.id);
    deleteCollection(collection.id);
    // Asset should still exist
    expect(getAsset(asset.id)).toBeDefined();
  });

  test("empty collection returns empty list", () => {
    const collection = createCollection({ name: "EmptyList" });
    const assets = getCollectionAssets(collection.id);
    expect(assets.length).toBe(0);
  });
});
