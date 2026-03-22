#!/usr/bin/env bun

import { Command } from "commander";
import {
  createAsset,
  getAsset,
  listAssets,
  updateAsset,
  deleteAsset,
  searchAssets,
  listByType,
  listByTag,
  getAssetStats,
} from "../db/assets.js";
import {
  createCollection,
  listCollections,
  addToCollection,
  removeFromCollection,
  getCollectionAssets,
} from "../db/assets.js";

const program = new Command();

program
  .name("microservice-assets")
  .description("Digital asset management microservice")
  .version("0.0.1");

// --- Assets ---

program
  .command("create")
  .description("Create a new asset")
  .requiredOption("--name <name>", "Asset name")
  .option("--description <desc>", "Description")
  .option("--type <type>", "Asset type (image, video, document, audio, template, logo, font, other)")
  .option("--file-path <path>", "File path")
  .option("--file-size <size>", "File size in bytes")
  .option("--mime-type <mime>", "MIME type")
  .option("--dimensions <dims>", "Dimensions (e.g. 1920x1080)")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--category <cat>", "Category")
  .option("--uploaded-by <user>", "Uploaded by")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const asset = createAsset({
      name: opts.name,
      description: opts.description,
      type: opts.type,
      file_path: opts.filePath,
      file_size: opts.fileSize ? parseInt(opts.fileSize) : undefined,
      mime_type: opts.mimeType,
      dimensions: opts.dimensions,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
      category: opts.category,
      uploaded_by: opts.uploadedBy,
    });

    if (opts.json) {
      console.log(JSON.stringify(asset, null, 2));
    } else {
      console.log(`Created asset: ${asset.name} (${asset.id})`);
    }
  });

program
  .command("get")
  .description("Get an asset by ID")
  .argument("<id>", "Asset ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const asset = getAsset(id);
    if (!asset) {
      console.error(`Asset '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(asset, null, 2));
    } else {
      console.log(`${asset.name}`);
      if (asset.type) console.log(`  Type: ${asset.type}`);
      if (asset.file_path) console.log(`  Path: ${asset.file_path}`);
      if (asset.file_size) console.log(`  Size: ${asset.file_size} bytes`);
      if (asset.mime_type) console.log(`  MIME: ${asset.mime_type}`);
      if (asset.dimensions) console.log(`  Dimensions: ${asset.dimensions}`);
      if (asset.category) console.log(`  Category: ${asset.category}`);
      if (asset.tags.length) console.log(`  Tags: ${asset.tags.join(", ")}`);
      if (asset.uploaded_by) console.log(`  Uploaded by: ${asset.uploaded_by}`);
    }
  });

program
  .command("list")
  .description("List assets")
  .option("--search <query>", "Search by name, description, or tags")
  .option("--type <type>", "Filter by type")
  .option("--category <cat>", "Filter by category")
  .option("--tag <tag>", "Filter by tag")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const assets = listAssets({
      search: opts.search,
      type: opts.type,
      category: opts.category,
      tag: opts.tag,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(assets, null, 2));
    } else {
      if (assets.length === 0) {
        console.log("No assets found.");
        return;
      }
      for (const a of assets) {
        const type = a.type ? ` [${a.type}]` : "";
        const tags = a.tags.length ? ` (${a.tags.join(", ")})` : "";
        console.log(`  ${a.name}${type}${tags}`);
      }
      console.log(`\n${assets.length} asset(s)`);
    }
  });

program
  .command("update")
  .description("Update an asset")
  .argument("<id>", "Asset ID")
  .option("--name <name>", "Name")
  .option("--description <desc>", "Description")
  .option("--type <type>", "Type")
  .option("--file-path <path>", "File path")
  .option("--file-size <size>", "File size")
  .option("--mime-type <mime>", "MIME type")
  .option("--dimensions <dims>", "Dimensions")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--category <cat>", "Category")
  .option("--uploaded-by <user>", "Uploaded by")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.description !== undefined) input.description = opts.description;
    if (opts.type !== undefined) input.type = opts.type;
    if (opts.filePath !== undefined) input.file_path = opts.filePath;
    if (opts.fileSize !== undefined) input.file_size = parseInt(opts.fileSize);
    if (opts.mimeType !== undefined) input.mime_type = opts.mimeType;
    if (opts.dimensions !== undefined) input.dimensions = opts.dimensions;
    if (opts.tags !== undefined) input.tags = opts.tags.split(",").map((t: string) => t.trim());
    if (opts.category !== undefined) input.category = opts.category;
    if (opts.uploadedBy !== undefined) input.uploaded_by = opts.uploadedBy;

    const asset = updateAsset(id, input);
    if (!asset) {
      console.error(`Asset '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(asset, null, 2));
    } else {
      console.log(`Updated: ${asset.name}`);
    }
  });

program
  .command("delete")
  .description("Delete an asset")
  .argument("<id>", "Asset ID")
  .action((id) => {
    const deleted = deleteAsset(id);
    if (deleted) {
      console.log(`Deleted asset ${id}`);
    } else {
      console.error(`Asset '${id}' not found.`);
      process.exit(1);
    }
  });

program
  .command("search")
  .description("Search assets")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .action((query, opts) => {
    const results = searchAssets(query);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log(`No assets matching "${query}".`);
        return;
      }
      for (const a of results) {
        const type = a.type ? ` [${a.type}]` : "";
        console.log(`  ${a.name}${type}`);
      }
    }
  });

program
  .command("by-type")
  .description("List assets by type")
  .argument("<type>", "Asset type")
  .option("--json", "Output as JSON", false)
  .action((type, opts) => {
    const assets = listByType(type);

    if (opts.json) {
      console.log(JSON.stringify(assets, null, 2));
    } else {
      if (assets.length === 0) {
        console.log(`No assets of type "${type}".`);
        return;
      }
      for (const a of assets) {
        console.log(`  ${a.name}`);
      }
      console.log(`\n${assets.length} asset(s)`);
    }
  });

program
  .command("by-tag")
  .description("List assets by tag")
  .argument("<tag>", "Tag")
  .option("--json", "Output as JSON", false)
  .action((tag, opts) => {
    const assets = listByTag(tag);

    if (opts.json) {
      console.log(JSON.stringify(assets, null, 2));
    } else {
      if (assets.length === 0) {
        console.log(`No assets with tag "${tag}".`);
        return;
      }
      for (const a of assets) {
        console.log(`  ${a.name} (${a.tags.join(", ")})`);
      }
      console.log(`\n${assets.length} asset(s)`);
    }
  });

program
  .command("stats")
  .description("Get asset statistics")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getAssetStats();

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(`Total assets: ${stats.total_assets}`);
      console.log(`Total size: ${stats.total_size} bytes`);
      if (Object.keys(stats.by_type).length) {
        console.log("By type:");
        for (const [type, count] of Object.entries(stats.by_type)) {
          console.log(`  ${type}: ${count}`);
        }
      }
      if (Object.keys(stats.by_category).length) {
        console.log("By category:");
        for (const [cat, count] of Object.entries(stats.by_category)) {
          console.log(`  ${cat}: ${count}`);
        }
      }
    }
  });

// --- Collections ---

const collectionCmd = program
  .command("collection")
  .description("Collection management");

collectionCmd
  .command("create")
  .description("Create a collection")
  .requiredOption("--name <name>", "Collection name")
  .option("--description <desc>", "Description")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const collection = createCollection({
      name: opts.name,
      description: opts.description,
    });

    if (opts.json) {
      console.log(JSON.stringify(collection, null, 2));
    } else {
      console.log(`Created collection: ${collection.name} (${collection.id})`);
    }
  });

collectionCmd
  .command("list")
  .description("List collections")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const collections = listCollections();

    if (opts.json) {
      console.log(JSON.stringify(collections, null, 2));
    } else {
      if (collections.length === 0) {
        console.log("No collections found.");
        return;
      }
      for (const c of collections) {
        const desc = c.description ? ` — ${c.description}` : "";
        console.log(`  ${c.name}${desc}`);
      }
    }
  });

collectionCmd
  .command("add")
  .description("Add an asset to a collection")
  .requiredOption("--collection <id>", "Collection ID")
  .requiredOption("--asset <id>", "Asset ID")
  .action((opts) => {
    const added = addToCollection(opts.collection, opts.asset);
    if (added) {
      console.log(`Added asset ${opts.asset} to collection ${opts.collection}`);
    } else {
      console.error("Failed to add asset to collection.");
      process.exit(1);
    }
  });

collectionCmd
  .command("remove")
  .description("Remove an asset from a collection")
  .requiredOption("--collection <id>", "Collection ID")
  .requiredOption("--asset <id>", "Asset ID")
  .action((opts) => {
    const removed = removeFromCollection(opts.collection, opts.asset);
    if (removed) {
      console.log(`Removed asset ${opts.asset} from collection ${opts.collection}`);
    } else {
      console.error("Asset not in collection or collection not found.");
      process.exit(1);
    }
  });

collectionCmd
  .command("assets")
  .description("List assets in a collection")
  .argument("<collection-id>", "Collection ID")
  .option("--json", "Output as JSON", false)
  .action((collectionId, opts) => {
    const assets = getCollectionAssets(collectionId);

    if (opts.json) {
      console.log(JSON.stringify(assets, null, 2));
    } else {
      if (assets.length === 0) {
        console.log("No assets in collection.");
        return;
      }
      for (const a of assets) {
        const type = a.type ? ` [${a.type}]` : "";
        console.log(`  ${a.name}${type}`);
      }
      console.log(`\n${assets.length} asset(s)`);
    }
  });

program.parse(process.argv);
