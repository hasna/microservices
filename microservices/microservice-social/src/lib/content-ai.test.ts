import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "social-contentai-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import { closeDatabase } from "../db/database";
import { PLATFORM_LIMITS } from "../db/social";
import {
  buildGeneratePostPrompt,
  buildSuggestHashtagsPrompt,
  buildOptimizePostPrompt,
  buildGenerateThreadPrompt,
  buildRepurposePostPrompt,
  getDefaultAIProvider,
  generatePost,
  suggestHashtags,
  optimizePost,
  generateThread,
  repurposePost,
  callOpenAI,
  callAnthropic,
  type AIProvider,
  type Tone,
} from "./content-ai";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ---- Prompt Building Tests ----

describe("buildGeneratePostPrompt", () => {
  test("includes topic, platform, and character limit", () => {
    const prompt = buildGeneratePostPrompt("AI trends", "x");
    expect(prompt).toContain("AI trends");
    expect(prompt).toContain("x");
    expect(prompt).toContain("280");
  });

  test("includes tone option", () => {
    const prompt = buildGeneratePostPrompt("AI trends", "linkedin", { tone: "witty" });
    expect(prompt).toContain("Tone: witty");
  });

  test("defaults to professional tone", () => {
    const prompt = buildGeneratePostPrompt("AI trends", "x");
    expect(prompt).toContain("Tone: professional");
  });

  test("includes language option", () => {
    const prompt = buildGeneratePostPrompt("AI trends", "x", { language: "Spanish" });
    expect(prompt).toContain("Language: Spanish");
  });

  test("defaults to English language", () => {
    const prompt = buildGeneratePostPrompt("AI trends", "x");
    expect(prompt).toContain("Language: English");
  });

  test("requests hashtags by default", () => {
    const prompt = buildGeneratePostPrompt("AI trends", "x");
    expect(prompt).toContain("Include 3-5 relevant hashtags");
  });

  test("can disable hashtags", () => {
    const prompt = buildGeneratePostPrompt("AI trends", "x", { includeHashtags: false });
    expect(prompt).toContain("Do NOT include hashtags");
  });

  test("can enable emojis", () => {
    const prompt = buildGeneratePostPrompt("AI trends", "x", { includeEmoji: true });
    expect(prompt).toContain("Use emojis where appropriate");
  });

  test("disables emojis by default", () => {
    const prompt = buildGeneratePostPrompt("AI trends", "x");
    expect(prompt).toContain("Do not use emojis");
  });

  test("uses correct platform limit for linkedin", () => {
    const prompt = buildGeneratePostPrompt("AI trends", "linkedin");
    expect(prompt).toContain("3000");
  });

  test("uses correct platform limit for instagram", () => {
    const prompt = buildGeneratePostPrompt("AI trends", "instagram");
    expect(prompt).toContain("2200");
  });

  test("requests JSON response format", () => {
    const prompt = buildGeneratePostPrompt("AI trends", "x");
    expect(prompt).toContain("valid JSON");
    expect(prompt).toContain('"content"');
    expect(prompt).toContain('"hashtags"');
    expect(prompt).toContain('"suggested_media_prompt"');
  });
});

describe("buildSuggestHashtagsPrompt", () => {
  test("includes content and platform", () => {
    const prompt = buildSuggestHashtagsPrompt("Check out our new product!", "instagram", 5);
    expect(prompt).toContain("Check out our new product!");
    expect(prompt).toContain("instagram");
    expect(prompt).toContain("5");
  });

  test("uses custom count", () => {
    const prompt = buildSuggestHashtagsPrompt("Post content", "x", 10);
    expect(prompt).toContain("10");
  });

  test("requests JSON array format", () => {
    const prompt = buildSuggestHashtagsPrompt("Post content", "x", 5);
    expect(prompt).toContain("JSON array");
  });
});

describe("buildOptimizePostPrompt", () => {
  test("includes content and platform limit", () => {
    const prompt = buildOptimizePostPrompt("My post about AI", "x");
    expect(prompt).toContain("My post about AI");
    expect(prompt).toContain("280");
  });

  test("requests JSON with optimized_content and improvements", () => {
    const prompt = buildOptimizePostPrompt("My post", "linkedin");
    expect(prompt).toContain('"optimized_content"');
    expect(prompt).toContain('"improvements"');
  });

  test("uses correct limit for threads", () => {
    const prompt = buildOptimizePostPrompt("Content", "threads");
    expect(prompt).toContain("500");
  });
});

describe("buildGenerateThreadPrompt", () => {
  test("includes topic and tweet count", () => {
    const prompt = buildGenerateThreadPrompt("Machine learning basics", 7);
    expect(prompt).toContain("Machine learning basics");
    expect(prompt).toContain("7");
    expect(prompt).toContain("280");
  });

  test("defaults to numbering format", () => {
    const prompt = buildGenerateThreadPrompt("Topic", 5);
    expect(prompt).toContain("1/5");
  });

  test("requests JSON array format", () => {
    const prompt = buildGenerateThreadPrompt("Topic", 5);
    expect(prompt).toContain("JSON array");
  });
});

describe("buildRepurposePostPrompt", () => {
  test("includes source and target platforms", () => {
    const prompt = buildRepurposePostPrompt("Original tweet", "x", "linkedin");
    expect(prompt).toContain("x");
    expect(prompt).toContain("linkedin");
    expect(prompt).toContain("Original tweet");
  });

  test("uses target platform character limit", () => {
    const prompt = buildRepurposePostPrompt("Post", "x", "linkedin");
    expect(prompt).toContain("3000");
  });

  test("mentions adapting tone and formatting", () => {
    const prompt = buildRepurposePostPrompt("Post", "x", "instagram");
    expect(prompt).toContain("tone");
    expect(prompt).toContain("formatting");
  });
});

// ---- Provider Detection Tests ----

describe("getDefaultAIProvider", () => {
  const origOpenAI = process.env["OPENAI_API_KEY"];
  const origAnthropic = process.env["ANTHROPIC_API_KEY"];

  afterAll(() => {
    // Restore env
    if (origOpenAI) process.env["OPENAI_API_KEY"] = origOpenAI;
    else delete process.env["OPENAI_API_KEY"];
    if (origAnthropic) process.env["ANTHROPIC_API_KEY"] = origAnthropic;
    else delete process.env["ANTHROPIC_API_KEY"];
  });

  test("returns openai when OPENAI_API_KEY is set", () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";
    expect(getDefaultAIProvider()).toBe("openai");
  });

  test("returns anthropic when only ANTHROPIC_API_KEY is set", () => {
    delete process.env["OPENAI_API_KEY"];
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";
    expect(getDefaultAIProvider()).toBe("anthropic");
  });

  test("returns null when no keys are set", () => {
    delete process.env["OPENAI_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    expect(getDefaultAIProvider()).toBeNull();
  });
});

// ---- Error Handling Tests ----

describe("AI caller error handling", () => {
  test("callOpenAI throws when OPENAI_API_KEY is not set", async () => {
    const orig = process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    try {
      await expect(callOpenAI("test", 100)).rejects.toThrow("OPENAI_API_KEY is not set");
    } finally {
      if (orig) process.env["OPENAI_API_KEY"] = orig;
    }
  });

  test("callAnthropic throws when ANTHROPIC_API_KEY is not set", async () => {
    const orig = process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    try {
      await expect(callAnthropic("test", 100)).rejects.toThrow("ANTHROPIC_API_KEY is not set");
    } finally {
      if (orig) process.env["ANTHROPIC_API_KEY"] = orig;
    }
  });

  test("generatePost throws when no API keys are set", async () => {
    const origOAI = process.env["OPENAI_API_KEY"];
    const origAnth = process.env["ANTHROPIC_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    try {
      await expect(generatePost("topic", "x")).rejects.toThrow("No AI API key found");
    } finally {
      if (origOAI) process.env["OPENAI_API_KEY"] = origOAI;
      if (origAnth) process.env["ANTHROPIC_API_KEY"] = origAnth;
    }
  });
});

// ---- Platform Limits Enforcement in Prompts ----

describe("platform limit enforcement in prompts", () => {
  const platforms: Array<{ name: string; platform: "x" | "linkedin" | "instagram" | "threads" | "bluesky"; limit: number }> = [
    { name: "X", platform: "x", limit: 280 },
    { name: "LinkedIn", platform: "linkedin", limit: 3000 },
    { name: "Instagram", platform: "instagram", limit: 2200 },
    { name: "Threads", platform: "threads", limit: 500 },
    { name: "Bluesky", platform: "bluesky", limit: 300 },
  ];

  for (const { name, platform, limit } of platforms) {
    test(`generate prompt enforces ${name} limit (${limit})`, () => {
      const prompt = buildGeneratePostPrompt("topic", platform);
      expect(prompt).toContain(String(limit));
      expect(prompt).toContain("MUST be within this limit");
    });

    test(`optimize prompt enforces ${name} limit (${limit})`, () => {
      const prompt = buildOptimizePostPrompt("content", platform);
      expect(prompt).toContain(String(limit));
      expect(prompt).toContain("MUST be within this limit");
    });

    test(`repurpose prompt enforces ${name} target limit (${limit})`, () => {
      const prompt = buildRepurposePostPrompt("content", "x", platform);
      expect(prompt).toContain(String(limit));
      expect(prompt).toContain("MUST be within this limit");
    });
  }
});

// ---- Response Parsing Tests (mock fetch) ----

describe("response parsing with mocked fetch", () => {
  const originalFetch = globalThis.fetch;

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("generatePost parses valid JSON response", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    const mockResponse = {
      content: "AI is transforming the world!",
      hashtags: ["AI", "tech", "future"],
      suggested_media_prompt: "Futuristic AI brain illustration",
    };
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockResponse) } }],
      }),
    })) as any;

    const result = await generatePost("AI trends", "x", {}, "openai");
    expect(result.content).toBe("AI is transforming the world!");
    expect(result.hashtags).toEqual(["AI", "tech", "future"]);
    expect(result.suggested_media_prompt).toBe("Futuristic AI brain illustration");
  });

  test("generatePost returns fallback on invalid JSON", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "not valid json at all" } }],
      }),
    })) as any;

    const result = await generatePost("AI trends", "x", {}, "openai");
    expect(result.content).toBe("");
    expect(result.hashtags).toEqual([]);
  });

  test("suggestHashtags parses array response", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '["AI", "ML", "tech"]' } }],
      }),
    })) as any;

    const result = await suggestHashtags("AI post", "x", 3, "openai");
    expect(result).toEqual(["AI", "ML", "tech"]);
  });

  test("suggestHashtags returns empty array on invalid response", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "bad response" } }],
      }),
    })) as any;

    const result = await suggestHashtags("post", "x", 5, "openai");
    expect(result).toEqual([]);
  });

  test("optimizePost parses response correctly", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    const mockResponse = {
      optimized_content: "Better version of the post!",
      improvements: ["Added a hook", "Shortened sentences"],
    };
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockResponse) } }],
      }),
    })) as any;

    const result = await optimizePost("Original post", "x", "openai");
    expect(result.optimized_content).toBe("Better version of the post!");
    expect(result.improvements).toHaveLength(2);
  });

  test("generateThread parses array of tweets", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    const tweets = ["1/3 First tweet", "2/3 Second tweet", "3/3 Third tweet"];
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(tweets) } }],
      }),
    })) as any;

    const result = await generateThread("Topic", 3, "openai");
    expect(result).toHaveLength(3);
    expect(result[0]).toContain("1/3");
  });

  test("repurposePost parses response correctly", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"content": "Adapted for LinkedIn!"}' } }],
      }),
    })) as any;

    const result = await repurposePost("Tweet text", "x", "linkedin", "openai");
    expect(result.content).toBe("Adapted for LinkedIn!");
  });

  test("handles markdown-fenced JSON in response", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '```json\n{"content": "Post!", "hashtags": [], "suggested_media_prompt": "img"}\n```' } }],
      }),
    })) as any;

    const result = await generatePost("topic", "x", {}, "openai");
    expect(result.content).toBe("Post!");
  });

  test("anthropic provider uses correct response format", async () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: '["hash1", "hash2"]' }],
      }),
    })) as any;

    const result = await suggestHashtags("post", "x", 2, "anthropic");
    expect(result).toEqual(["hash1", "hash2"]);
  });

  test("throws on API error response", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    globalThis.fetch = (async () => ({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    })) as any;

    await expect(generatePost("topic", "x", {}, "openai")).rejects.toThrow("OpenAI API error 429");
  });
});
