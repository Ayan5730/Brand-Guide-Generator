import type { FetchedPage } from "./tinyfish";
import { canonicalizeUrl } from "./urls";

const boilerplate = /^(menu|navigation|skip to|cookie|privacy|terms|legal|copyright|sign in|log in|subscribe|search|close|open menu|all rights reserved|1-\d{3}-|follow us|select country)/i;
const labels = new Set(["document", "children", "type", "text", "level", "paragraph", "heading", "list", "items", "ordered"]);
const usefulPath = /(about|company|brand|design|product|solution|story|mission|vision|values|shop|store)/i;
const weakPath = /(legal|privacy|terms|cookie|support|contact|login|account|checkout|cart|help|careers|investor|reports?|presentations?|press|news|blog|developer|docs|api|regional|newsroom|article|release|customer[-_]?service|faq|returns|shipping)/i;

export type NormalizedPage = FetchedPage & { cleanText: string; pageType: string; whyUseful: string };

function values(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(values);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => labels.has(key.toLowerCase()) ? values(child) : values(child));
}

function cleanLines(lines: string[]) {
  const seen = new Set<string>();
  return lines
    .flatMap((line) => line.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z0-9“])/))
    .map((line) => line.trim())
    .filter((line) => line.length >= 18 && line.length <= 420)
    .filter((line) => !boilerplate.test(line))
    .filter((line) => {
      const key = line.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 100);
}

export function classifyPage(url: string) {
  const path = new URL(url).pathname;
  if (/\.css$/i.test(path)) return { pageType: "Stylesheet", whyUseful: "Used only for directly observed color and typography declarations." };
  if (path === "/" || !path) return { pageType: "Homepage", whyUseful: "Used for brand overview, core messaging, and visual identity." };
  if (/brand|design|guidelines|identity/i.test(path)) return { pageType: "Brand / Design", whyUseful: "Used for visual identity, design language, or brand standards." };
  if (/about|company|story|mission|vision|values/i.test(path)) return { pageType: "About / Company", whyUseful: "Used for company description, mission, and voice." };
  if (/product|service|solution|shop|store/i.test(path)) return { pageType: "Product / Service", whyUseful: "Used for product positioning, benefits, and calls to action." };
  if (/press|news|blog|article/i.test(path)) return { pageType: "Press / News", whyUseful: "Supplementary evidence, deprioritized for brand messaging to avoid headline pollution." };
  if (/support|help|contact/i.test(path)) return { pageType: "Support", whyUseful: "Low priority evidence, often contains boilerplate or technical instructions." };
  return { pageType: "Public page", whyUseful: "Used as supplementary live website evidence." };
}

export function normalizePage(page: FetchedPage): NormalizedPage {
  const url = canonicalizeUrl(page.final_url ?? page.url);
  const classification = classifyPage(url);
  const lines = cleanLines([page.title ?? "", page.description ?? "", ...values(page.text)]);
  return { ...page, cleanText: lines.join("\n"), ...classification };
}

export function rankLinks(home: string, links: string[]) {
  const origin = new URL(home).origin;
  return [...new Set(links)].map((url) => {
    try {
      const parsed = new URL(canonicalizeUrl(new URL(url, home).toString()));
      if (parsed.origin !== origin || /\.(css|js|xml|json)$/i.test(parsed.pathname)) return null;
      let score = 0;
      const host = parsed.hostname.toLowerCase();
      // Penalize regional subdomains or language paths if we're finding main brand pages
      if (/(^|\.)(uk|us|ca|au|in|africa|eu|fr|de|es|it)\./.test(host)) score -= 4;
      if (/^\/[a-z]{2}(-[a-z]{2})?\//i.test(parsed.pathname)) score -= 2;

      if (usefulPath.test(parsed.pathname)) score += 5;
      if (weakPath.test(parsed.pathname)) score -= 8;
      if (parsed.pathname === "/") score += 2;
      return { url: canonicalizeUrl(parsed.toString()), score };
    } catch { return null; }
  }).filter((item): item is { url: string; score: number } => item !== null)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.url);
}
