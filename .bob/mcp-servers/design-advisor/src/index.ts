#!/usr/bin/env node
/**
 * design-advisor MCP server
 *
 * Exposes AI-powered design review tools to IBM Bob.
 * External models act as advisors only — they never modify files.
 *
 * Tools:
 *   review_ui           — visual / Carbon / UX review (optional screenshot)
 *   second_opinion      — independent critique from a different provider
 *   review_carbon_code  — @carbon/react implementation review
 *   brainstorm_product_ux — open-ended product/interaction brainstorm
 *
 * Required environment variables (at least one must be set):
 *   ANTHROPIC_API_KEY   — Claude (default reviewer)
 *   OPENAI_API_KEY      — GPT-4o (default second-opinion provider)
 *   GEMINI_API_KEY      — Gemini (optional third reviewer)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ── Types ─────────────────────────────────────────────────────

type Provider = "claude" | "openai" | "gemini";

type AnthropicMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

interface ImageData {
  base64: string;
  mediaType: AnthropicMediaType;
}

// ── Client initialisation ─────────────────────────────────────
// Clients are created only if the corresponding API key is present.

const anthropicClient: Anthropic | null = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const openaiClient: OpenAI | null = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const geminiClient: GoogleGenerativeAI | null = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// ── Image helpers ─────────────────────────────────────────────

function loadImage(imagePath: string): ImageData {
  const resolved = path.resolve(imagePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Image file not found: ${resolved}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  const mediaTypeMap: Record<string, AnthropicMediaType> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  const mediaType = mediaTypeMap[ext];
  if (!mediaType) {
    throw new Error(`Unsupported image format: ${ext}. Supported: png, jpg, gif, webp`);
  }
  const buffer = fs.readFileSync(resolved);
  return { base64: buffer.toString("base64"), mediaType };
}

// ── Prompt builders ───────────────────────────────────────────

function buildDesignReviewPrompt(params: {
  userObjective: string;
  code?: string;
  css?: string;
  hasImage: boolean;
}): string {
  const sections: string[] = [];

  sections.push(`# IBM Carbon / React UI Design Review

You are a senior IBM Carbon Design System expert and enterprise UX architect.
Review the provided UI ${params.hasImage ? "screenshot, " : ""}code and CSS/SCSS.
Return structured, actionable recommendations only. Be concise and specific.

## User objective
${params.userObjective}`);

  if (params.code) {
    sections.push(`## React / TypeScript component code
\`\`\`tsx
${params.code}
\`\`\``);
  }

  if (params.css) {
    sections.push(`## CSS / SCSS
\`\`\`scss
${params.css}
\`\`\``);
  }

  if (params.hasImage) {
    sections.push(`## Screenshot\n[attached image]`);
  }

  sections.push(`## Required output format

Return exactly this JSON structure (no prose outside the JSON):

\`\`\`json
{
  "provider": "<claude|openai|gemini>",
  "summary": "<one paragraph overall assessment>",
  "severity": "<ok|minor|major|critical>",
  "recommendations": {
    "visual_hierarchy": ["<specific actionable recommendation>"],
    "carbon_usage": ["<specific Carbon component or token recommendation>"],
    "layout_grid": ["<Carbon Grid / Column usage feedback>"],
    "spacing": ["<Carbon spacing token feedback>"],
    "typography": ["<IBM Plex Sans / Carbon type scale feedback>"],
    "responsiveness": ["<breakpoint / responsive feedback>"],
    "accessibility": ["<a11y feedback: ARIA, contrast, keyboard nav>"],
    "ux_issues": ["<interaction or flow problems>"],
    "implementation": ["<concrete code change to make>"]
  },
  "priority_actions": ["<top 3 most impactful changes, in priority order>"]
}
\`\`\``);

  return sections.join("\n\n");
}

function buildCarbonCodeReviewPrompt(code: string, css?: string): string {
  return `# IBM Carbon / React Code Review

You are a Carbon Design System expert. Review this React + @carbon/react implementation for:
- Incorrect or non-idiomatic Carbon component usage
- Custom CSS/SCSS that conflicts with or duplicates Carbon tokens
- Missing accessibility attributes (aria-*, role, etc.)
- Poor responsive behavior (fixed widths, magic numbers)
- Better Carbon components or patterns that should be used instead

## Component code
\`\`\`tsx
${code}
\`\`\`
${css ? `\n## CSS / SCSS\n\`\`\`scss\n${css}\n\`\`\`` : ""}

## Required output format

Return exactly this JSON (no prose outside the JSON):

\`\`\`json
{
  "provider": "<claude|openai|gemini>",
  "summary": "<one paragraph assessment>",
  "severity": "<ok|minor|major|critical>",
  "issues": [
    {
      "category": "<carbon_usage|custom_css|accessibility|responsiveness|pattern>",
      "severity": "<ok|minor|major|critical>",
      "description": "<what the issue is>",
      "current_code": "<offending snippet if applicable>",
      "recommended_fix": "<exactly what to change>"
    }
  ],
  "priority_fixes": ["<top 3 fixes>"]
}
\`\`\``;
}

function buildBrainstormPrompt(topic: string, context?: string): string {
  return `# Product UX Brainstorm — IBM Enterprise Console

You are a senior UX architect specialising in IBM enterprise products (IBM Cloud, watsonx, OpenShift Console quality).
The product uses React + @carbon/react exclusively.

## Topic / question
${topic}
${context ? `\n## Additional context\n${context}` : ""}

## Required output format

Return exactly this JSON (no prose outside the JSON):

\`\`\`json
{
  "provider": "<claude|openai|gemini>",
  "summary": "<brief framing of the problem>",
  "options": [
    {
      "name": "<option name>",
      "description": "<what it is and how it works>",
      "carbon_patterns": ["<Carbon components / patterns to use>"],
      "pros": ["<advantage>"],
      "cons": ["<disadvantage>"],
      "recommended_for": "<when to choose this>"
    }
  ],
  "recommendation": "<which option is best and why>",
  "implementation_notes": ["<key implementation consideration>"]
}
\`\`\``;
}

function buildSecondOpinionPrompt(params: {
  proposal: string;
  originalFeedback?: string;
  focusAreas?: string;
  code?: string;
  css?: string;
  provider: Provider;
}): string {
  const sections: string[] = [
    `# Second Opinion — Independent UI/UX Critique\n\nYou are an independent IBM Carbon design reviewer providing a second opinion. Form your own view.`,
    `## Proposal\n${params.proposal}`,
  ];
  if (params.originalFeedback) {
    sections.push(`## First reviewer's feedback (for context only — form your own view)\n${params.originalFeedback}`);
  }
  if (params.focusAreas) {
    sections.push(`## Focus areas requested\n${params.focusAreas}`);
  }
  if (params.code) {
    sections.push(`## Code\n\`\`\`tsx\n${params.code}\n\`\`\``);
  }
  if (params.css) {
    sections.push(`## CSS/SCSS\n\`\`\`scss\n${params.css}\n\`\`\``);
  }

  sections.push(`## Required output format

Return exactly this JSON (no prose outside the JSON):

\`\`\`json
{
  "provider": "${params.provider}",
  "agrees_with_original": null,
  "summary": "<independent assessment>",
  "points_of_agreement": ["<where you agree>"],
  "points_of_disagreement": ["<where you disagree or see differently>"],
  "additional_concerns": ["<issues not raised in original review>"],
  "recommendations": ["<specific actionable changes>"],
  "verdict": "<proceed|revise|reconsider>"
}
\`\`\``);

  return sections.join("\n\n");
}

// ── Provider API calls ────────────────────────────────────────

async function callClaude(prompt: string, image?: ImageData): Promise<string> {
  if (!anthropicClient) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to the env block in .bob/mcp.json.");
  }

  type AnthropicContent =
    | { type: "text"; text: string }
    | {
        type: "image";
        source: {
          type: "base64";
          media_type: AnthropicMediaType;
          data: string;
        };
      };

  const content: AnthropicContent[] = [];

  if (image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.base64 },
    });
  }
  content.push({ type: "text", text: prompt });

  const response = await anthropicClient.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 2048,
    messages: [{ role: "user", content }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text block");
  }
  return textBlock.text;
}

async function callOpenAI(prompt: string, image?: ImageData): Promise<string> {
  if (!openaiClient) {
    throw new Error("OPENAI_API_KEY is not set. Add it to the env block in .bob/mcp.json.");
  }

  type OpenAIContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };

  const content: OpenAIContentPart[] = [];

  if (image) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
    });
  }
  content.push({ type: "text", text: prompt });

  const response = await openaiClient.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 2048,
    messages: [{ role: "user", content }],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned no content");
  return text;
}

async function callGemini(prompt: string, image?: ImageData): Promise<string> {
  if (!geminiClient) {
    throw new Error("GEMINI_API_KEY is not set. Add it to the env block in .bob/mcp.json.");
  }

  const model = geminiClient.getGenerativeModel({ model: "gemini-3.6-flash" });

  type GeminiPart =
    | { text: string }
    | { inlineData: { mimeType: string; data: string } };

  const parts: GeminiPart[] = [];
  if (image) {
    parts.push({ inlineData: { mimeType: image.mediaType, data: image.base64 } });
  }
  parts.push({ text: prompt });

  const result = await model.generateContent(parts);
  const text = result.response.text();
  if (!text) throw new Error("Gemini returned no content");
  return text;
}

async function callProvider(provider: Provider, prompt: string, image?: ImageData): Promise<string> {
  switch (provider) {
    case "claude":  return callClaude(prompt, image);
    case "openai":  return callOpenAI(prompt, image);
    case "gemini":  return callGemini(prompt, image);
  }
}

/** Extract JSON from a model response that may be wrapped in ```json fences */
function extractAndFormatJSON(text: string, provider: Provider): string {
  try {
    const fenced = text.match(/```json\s*([\s\S]*?)```/);
    const jsonStr = fenced ? fenced[1].trim() : text.trim();
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    if (!parsed.provider) parsed.provider = provider;
    return JSON.stringify(parsed, null, 2);
  } catch {
    // Model returned non-JSON — wrap it in a safe envelope
    return JSON.stringify({ provider, raw_response: text.slice(0, 4000) }, null, 2);
  }
}

// ── MCP Server ────────────────────────────────────────────────

const server = new McpServer({
  name: "design-advisor",
  version: "0.1.0",
});

// ── Tool: review_ui ───────────────────────────────────────────

server.registerTool(
  "review_ui",
  {
    description:
      "Review UI for visual hierarchy, Carbon Design System usage, layout, typography, " +
      "accessibility, and UX quality. Optionally attach a screenshot path. Default provider: claude.",
    inputSchema: z.object({
      user_objective: z
        .string()
        .describe("What are you trying to achieve, or what specific problem should the reviewer focus on?"),
      code: z
        .string()
        .optional()
        .describe("Relevant React/TypeScript component code"),
      css: z
        .string()
        .optional()
        .describe("Relevant CSS/SCSS"),
      screenshot_path: z
        .string()
        .optional()
        .describe("Absolute or workspace-relative path to a screenshot (PNG/JPG/WebP)"),
      provider: z
        .enum(["claude", "openai", "gemini"])
        .optional()
        .default("claude")
        .describe("AI provider. Default: claude"),
    }),
  },
  async ({ user_objective, code, css, screenshot_path, provider }) => {
    const chosen: Provider = (provider ?? "claude") as Provider;
    try {
      let image: ImageData | undefined;
      if (screenshot_path) {
        image = loadImage(screenshot_path);
        console.error(`[design-advisor] review_ui: loaded screenshot ${screenshot_path}`);
      }

      const prompt = buildDesignReviewPrompt({ userObjective: user_objective, code, css, hasImage: !!image });
      console.error(`[design-advisor] review_ui → ${chosen}`);
      const raw = await callProvider(chosen, prompt, image);
      const formatted = extractAndFormatJSON(raw, chosen);

      return {
        content: [{
          type: "text" as const,
          text: `## UI Review (${chosen})\n\n\`\`\`json\n${formatted}\n\`\`\``,
        }],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[design-advisor] review_ui error: ${msg}`);
      return { content: [{ type: "text" as const, text: `review_ui failed: ${msg}` }], isError: true };
    }
  }
);

// ── Tool: second_opinion ──────────────────────────────────────

server.registerTool(
  "second_opinion",
  {
    description:
      "Get an independent critique of a design or implementation proposal from a different AI provider. " +
      "Default second-opinion provider: openai.",
    inputSchema: z.object({
      proposal: z
        .string()
        .describe("The design or implementation proposal to critique"),
      original_feedback: z
        .string()
        .optional()
        .describe("Feedback already received from a first reviewer (optional context)"),
      focus_areas: z
        .string()
        .optional()
        .describe("Specific aspects to focus on"),
      code: z.string().optional().describe("Relevant code"),
      css: z.string().optional().describe("Relevant CSS/SCSS"),
      screenshot_path: z.string().optional().describe("Path to screenshot"),
      provider: z
        .enum(["claude", "openai", "gemini"])
        .optional()
        .default("openai")
        .describe("Provider for second opinion. Default: openai"),
    }),
  },
  async ({ proposal, original_feedback, focus_areas, code, css, screenshot_path, provider }) => {
    const chosen: Provider = (provider ?? "openai") as Provider;
    try {
      let image: ImageData | undefined;
      if (screenshot_path) {
        image = loadImage(screenshot_path);
      }

      const prompt = buildSecondOpinionPrompt({
        proposal,
        originalFeedback: original_feedback,
        focusAreas: focus_areas,
        code,
        css,
        provider: chosen,
      });
      if (image) {
        // Append image note to prompt (image passed as content block)
        console.error(`[design-advisor] second_opinion: loaded screenshot ${screenshot_path!}`);
      }

      console.error(`[design-advisor] second_opinion → ${chosen}`);
      const raw = await callProvider(chosen, prompt, image);
      const formatted = extractAndFormatJSON(raw, chosen);

      return {
        content: [{
          type: "text" as const,
          text: `## Second Opinion (${chosen})\n\n\`\`\`json\n${formatted}\n\`\`\``,
        }],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[design-advisor] second_opinion error: ${msg}`);
      return { content: [{ type: "text" as const, text: `second_opinion failed: ${msg}` }], isError: true };
    }
  }
);

// ── Tool: review_carbon_code ──────────────────────────────────

server.registerTool(
  "review_carbon_code",
  {
    description:
      "Review React + @carbon/react implementation code for incorrect Carbon usage, " +
      "custom CSS fighting Carbon, accessibility issues, and poor responsive behavior.",
    inputSchema: z.object({
      code: z.string().describe("React/TypeScript component code to review"),
      css: z.string().optional().describe("Associated CSS/SCSS"),
      context: z
        .string()
        .optional()
        .describe("What this component does and what Carbon patterns it should use"),
      provider: z
        .enum(["claude", "openai", "gemini"])
        .optional()
        .default("claude")
        .describe("AI provider. Default: claude"),
    }),
  },
  async ({ code, css, context, provider }) => {
    const chosen: Provider = (provider ?? "claude") as Provider;
    try {
      let prompt = buildCarbonCodeReviewPrompt(code, css);
      if (context) {
        prompt = `## Component context\n${context}\n\n${prompt}`;
      }

      console.error(`[design-advisor] review_carbon_code → ${chosen}`);
      const raw = await callProvider(chosen, prompt);
      const formatted = extractAndFormatJSON(raw, chosen);

      return {
        content: [{
          type: "text" as const,
          text: `## Carbon Code Review (${chosen})\n\n\`\`\`json\n${formatted}\n\`\`\``,
        }],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[design-advisor] review_carbon_code error: ${msg}`);
      return { content: [{ type: "text" as const, text: `review_carbon_code failed: ${msg}` }], isError: true };
    }
  }
);

// ── Tool: brainstorm_product_ux ───────────────────────────────

server.registerTool(
  "brainstorm_product_ux",
  {
    description:
      "Use an external AI model to brainstorm solutions for difficult product UX or interaction " +
      "design decisions in an IBM Carbon enterprise application.",
    inputSchema: z.object({
      topic: z
        .string()
        .describe(
          "The UX/product design question to brainstorm " +
          "(e.g. 'Best way to surface NO-GO blockers in a Carbon dashboard')"
        ),
      context: z
        .string()
        .optional()
        .describe(
          "Additional context: current approach, constraints, user goals, existing Carbon components"
        ),
      provider: z
        .enum(["claude", "openai", "gemini"])
        .optional()
        .default("claude")
        .describe("AI provider. Default: claude"),
    }),
  },
  async ({ topic, context, provider }) => {
    const chosen: Provider = (provider ?? "claude") as Provider;
    try {
      const prompt = buildBrainstormPrompt(topic, context);
      console.error(`[design-advisor] brainstorm_product_ux → ${chosen}`);
      const raw = await callProvider(chosen, prompt);
      const formatted = extractAndFormatJSON(raw, chosen);

      return {
        content: [{
          type: "text" as const,
          text: `## UX Brainstorm (${chosen})\n\n\`\`\`json\n${formatted}\n\`\`\``,
        }],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[design-advisor] brainstorm_product_ux error: ${msg}`);
      return { content: [{ type: "text" as const, text: `brainstorm_product_ux failed: ${msg}` }], isError: true };
    }
  }
);

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const available: string[] = [];
  if (anthropicClient) available.push("claude");
  if (openaiClient) available.push("openai");
  if (geminiClient) available.push("gemini");

  if (available.length === 0) {
    console.error(
      "[design-advisor] WARNING: No API keys configured. " +
      "Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY in .bob/mcp.json env block."
    );
  } else {
    console.error(`[design-advisor] Available providers: ${available.join(", ")}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[design-advisor] MCP server running on stdio");
}

main().catch((error: unknown) => {
  console.error("[design-advisor] Fatal error:", error);
  process.exit(1);
});
