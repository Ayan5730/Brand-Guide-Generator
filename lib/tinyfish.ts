import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { canonicalRoot, canonicalizeUrl, domainStem, registrableDomain } from "./urls";
import type { RenderedEvidence } from "./types";
import { chromium } from "playwright-core";

const run = promisify(execFile);

async function tinyfish(args: string[]) {
  if (!process.env.TINYFISH_API_KEY) throw new Error("TinyFish is not configured. Add TINYFISH_API_KEY to .env.local.");
  try {
    const windows = process.platform === "win32";
    const executable = windows ? "tinyfish.cmd" : "tinyfish";
    const safeArgs = windows
      ? args.map((arg) => `"${arg.replace(/(["\\])/g, "\\$1")}"`)
      : args;
    const { stdout } = await run(executable, safeArgs, { env: process.env, maxBuffer: 8 * 1024 * 1024, windowsHide: true, shell: windows });
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "TinyFish request failed.";
    throw new Error(`TinyFish request failed: ${message}`);
  }

}

function parseJsonObject(output: string) {
  const start = output.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < output.length; index += 1) {
    const char = output[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") quoted = false;
      continue;
    }
    if (char === "\"") quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(output.slice(start, index + 1)) as RenderedEvidence;
    }
  }
  return null;
}

export async function inspectRenderedBrand(url: string): Promise<RenderedEvidence | null> {
  const goal = `Inspect the rendered live website and return JSON only with this exact shape: {"logo":{"url":"","alt":"","evidence":""},"colors":[{"hex":"#RRGGBB","category":"primary|secondary|accent|background|text","evidence":""}],"fonts":[{"font":"","type":"heading|body|other","evidence":""}]} Inspect the header/logo, loaded stylesheets, CSS variables, SVG fills/strokes, computed styles, document fonts, and visible brand colors. Only include values directly observed on the page. Use empty strings or empty arrays when unavailable. Do not infer or guess.`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await tinyfish(["agent", "run", "--url", url, "--sync", goal, "--pretty"]) as unknown;
      const evidence = parseJsonObject(typeof raw === "string" ? raw : JSON.stringify(raw));
      if (evidence) return evidence;
    } catch {
      if (attempt === 1) return null;
    }

  }
  return null;
}

export async function inspectBrowserBrand(url: string): Promise<RenderedEvidence | null> {
  try {
    const session = await tinyfish(["browser", "session", "create", "--url", url]) as { cdp_url?: string };
    if (!session.cdp_url) return null;
    const browser = await chromium.connectOverCDP(session.cdp_url);
    const page = browser.contexts()[0]?.pages()[0];
    if (!page) {
      await browser.close();
      return null;
    }
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.waitForTimeout(3000);
    const evidence = await page.evaluate(() => {
      const colors = new Map<string, { count: number; evidence: string[] }>();
      const fonts = new Map<string, { count: number; evidence: string }>();
      const headingFonts = new Set<string>();
      const colorHex = (value: string) => {
        const rgb = value.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
        if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
        const shortHex = value.match(/^#([0-9a-f]{3})$/i);
        if (shortHex) return `#${shortHex[1].split("").map((part) => part + part).join("")}`.toUpperCase();
        return value.toUpperCase();
      };
      const addColor = (value: string, evidence: string) => {
        if (!value || value === "transparent" || /^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/i.test(value)) return;
        if (!/^#(?:[0-9a-f]{3,8})$/i.test(value) && !/^rgba?\(/i.test(value)) return;
        const hex = colorHex(value);
        if (!/^#[0-9A-F]{6,8}$/.test(hex)) return;
        const existing = colors.get(hex) ?? { count: 0, evidence: [] };
        existing.count += 1;
        if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence);
        colors.set(hex, existing);
      };
      const addFont = (value: string, isHeading: boolean, evidence: string) => {
        const family = value.split(",")[0].replace(/["']/g, "").trim();
        if (!family || /^(inherit|initial|unset)$/i.test(family)) return;
        const existing = fonts.get(family) ?? { count: 0, evidence };
        fonts.set(family, { count: existing.count + 1, evidence: existing.evidence });
        if (isHeading) headingFonts.add(family);
      };
      const elements = Array.from(document.querySelectorAll("body, body *")).slice(0, 1200);
      for (const element of elements) {
        const style = getComputedStyle(element);
        addColor(style.color, "Computed text color on a rendered element.");
        addColor(style.backgroundColor, "Computed background color on a rendered element.");
        addColor(style.borderTopColor, "Computed border color on a rendered element.");
        addColor(style.borderRightColor, "Computed border color on a rendered element.");
        addColor(style.borderBottomColor, "Computed border color on a rendered element.");
        addColor(style.borderLeftColor, "Computed border color on a rendered element.");
        addFont(style.fontFamily, /^H[1-6]$/.test(element.tagName), "Computed font-family on rendered elements.");
      }
      for (const element of Array.from(document.querySelectorAll("svg [fill], svg [stroke]"))) {
        addColor(element.getAttribute("fill") ?? "", "SVG fill color exposed by a rendered element.");
        addColor(element.getAttribute("stroke") ?? "", "SVG stroke color exposed by a rendered element.");
      }
      const rootStyle = getComputedStyle(document.documentElement);
      for (let index = 0; index < rootStyle.length; index += 1) {
        const property = rootStyle.item(index);
        if (property.startsWith("--")) addColor(rootStyle.getPropertyValue(property).trim(), `CSS variable ${property} resolved on the document root.`);
      }
      const theme = document.querySelector('meta[name="theme-color"]')?.getAttribute("content");
      addColor(theme ?? "", "Theme color meta tag exposed by the live document.");
      for (const selector of ["h1", "h2", "h3", "body", "p", "button", "nav"]) {
        const element = document.querySelector(selector);
        if (element) addFont(getComputedStyle(element).fontFamily, /^h[1-3]$/i.test(selector), `Computed font-family on ${selector}.`);
      }
      for (const font of Array.from(document.fonts)) {
        if (font.status === "loaded") addFont(font.family, false, "Loaded web font reported by document.fonts.");
      }
      const siteHost = window.location.hostname.replace(/^www\./i, "").toLowerCase();
      const siteStem = siteHost.split(".")[0];
      const vendorAsset = /\b(onetrust|cookie|consent|tracking|analytics|tag[-_ ]?manager|doubleclick|pixel|social|facebook|twitter|linkedin|instagram|youtube|payment|visa|mastercard|paypal)\b/i;
      const imageCandidates = Array.from(document.images).filter((image) => {
        const details = `${image.alt} ${image.currentSrc} ${image.className}`.toLowerCase();
        if (!image.currentSrc || image.currentSrc.startsWith("data:") || vendorAsset.test(details)) return false;
        try {
          const url = new URL(image.currentSrc, window.location.href);
          const imageHost = url.hostname.replace(/^www\./i, "").toLowerCase();
          const isSameDomain = imageHost === siteHost || imageHost.includes(siteStem);
          const hasBrandKeyword = details.includes(siteStem) || /logo|brand|wordmark/.test(details);
          const isIcon = (image.naturalWidth && image.naturalWidth <= 32 && image.naturalHeight <= 32) || /icon|favicon/.test(details);
          if (isIcon && !hasBrandKeyword) return false;
          return isSameDomain || hasBrandKeyword;
        } catch {
          return false;
        }
      });
      const logoImage = imageCandidates
        .map((image) => {
          let score = 0;
          const details = `${image.alt} ${image.currentSrc} ${image.className}`.toLowerCase();
          if (/logo|brand|wordmark/i.test(details)) score += 5;
          if (image.closest("header, nav")) score += 4;
          if (image.naturalWidth > 40 && image.naturalWidth > image.naturalHeight) score += 2; // Favor horizontal logos
          if (/icon|avatar|profile/i.test(details)) score -= 3;
          return { image, score };
        })
        .sort((left, right) => right.score - left.score)[0]?.image;
      const logoSvg = Array.from(document.querySelectorAll("header svg, nav svg, svg.logo, svg[class*='logo']")).find((svg) => {
        const details = `${svg.getAttribute("aria-label") ?? ""} ${String(svg.className)} ${svg.innerHTML}`.toLowerCase();
        return !vendorAsset.test(details) && (/logo|brand|wordmark/i.test(details) || details.includes(siteStem));
      });
      const logoImgUrl = logoImage ? (logoImage.currentSrc || logoImage.src) : "";
      const svgUseHref = !logoImage && logoSvg ? (logoSvg.querySelector("use")?.getAttribute("href") ?? "") : "";
      const logo = logoImgUrl && /^https?:\/\//i.test(logoImgUrl)
        ? { url: logoImgUrl, alt: logoImage!.alt, evidence: "Logo image found in rendered header/navigation." }
        : svgUseHref && /^https?:\/\//i.test(svgUseHref)
          ? { url: svgUseHref, alt: logoSvg!.getAttribute("aria-label") ?? "", evidence: "SVG logo found in rendered header/navigation." }
          : null;
      const isNeutral = (hex: string) => {
        if (!/^#[0-9A-F]{6}$/i.test(hex)) return false;
        const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return (lum > 0.92 || lum < 0.08) && Math.abs(r - g) < 15 && Math.abs(g - b) < 15;
      };
      const classifyColor = (hex: string, item: { count: number; evidence: string[] }, index: number) => {
        const text = item.evidence.join(" ").toLowerCase();
        if (text.includes("theme color") || text.includes("--primary") || text.includes("--brand")) return "primary";
        if (isNeutral(hex)) return parseInt(hex.slice(1, 3), 16) > 128 ? "background" : "text";
        if (text.includes("--accent")) return "accent";
        if (text.includes("--secondary")) return "secondary";
        if (text.includes("background color") && index < 4) return "background";
        if (text.includes("text color") && index < 4) return "text";
        if (text.includes("svg fill") || text.includes("border color")) return "accent";
        return index < 2 ? "primary" : index < 5 ? "secondary" : "accent";
      };
      return {
        logo,
        colors: Array.from(colors.entries()).sort((left, right) => right[1].count - left[1].count).slice(0, 8).map(([hex, item], index) => ({ hex, category: classifyColor(hex, item, index) as any, evidence: item.evidence.join(" | ") })),
        fonts: Array.from(fonts.entries()).sort((left, right) => right[1].count - left[1].count).slice(0, 5).map(([font, item]) => ({ font, type: (headingFonts.has(font) ? "heading" : "body") as "heading" | "body" | "other", evidence: item.evidence }))
      };
    });
    await browser.close();
    if (!evidence.logo && evidence.colors.length === 0 && evidence.fonts.length === 0) return null;
    return evidence;
  } catch (err) {
    console.error("inspectBrowserBrand error:", err);
    return null;
  }
}

export type SearchResult = { title: string; url: string; snippet?: string };
export async function searchOfficialSite(query: string) {
  const queries = [`${query} official website brand`, `${query} official about products company`];
  const responses = await Promise.all(queries.map((searchQuery) => tinyfish(["search", "query", searchQuery]) as Promise<{ results?: SearchResult[] }>));
  const results = [...new Map(responses.flatMap((response) => response.results ?? []).map((item) => [item.url, item])).values()];
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
  const candidates = results.map((item) => {
    try {
      const url = canonicalizeUrl(item.url);
      const parsed = new URL(url);
      const stem = domainStem(url);
      const exactMatch = terms.some((term) => stem === term);
      const blocked = /wikipedia|linkedin|instagram|facebook|youtube|x\.com|pinterest/i.test(parsed.hostname);
      const regional = exactMatch && !blocked;
      return { ...item, url, regional };
    } catch {
      return null;
    }
  }).filter((item): item is SearchResult & { regional: boolean } => item !== null);
  const score = (item: SearchResult) => {
    try {
      const normalized = canonicalizeUrl(item.url);
      const parsed = new URL(normalized);
      const hostStem = domainStem(normalized);
      let value = terms.some((term) => hostStem === term) ? 20 : terms.some((term) => parsed.hostname.includes(term)) ? 3 : 0;
      if (/^www\./i.test(parsed.hostname)) value += 5;
      if (/^about\./i.test(parsed.hostname)) value += 8;
      if (/\b(company|mission|vision|values|purpose|about|brand|sustainability)\b/i.test(`${parsed.pathname} ${item.title} ${item.snippet ?? ""}`)) value += 6;
      if (/\.com$/i.test(parsed.hostname)) value += 3;
      if (/\.(?:in|co\.uk|co\.in|com\.au|ca)$/i.test(parsed.hostname)) value -= 2;
      if (parsed.pathname === "/" || parsed.pathname === "") value += 4;
      if (/open\.|developer\.|newsroom\.|support\.|help\.|wikipedia|linkedin|instagram|facebook/i.test(parsed.hostname)) value -= 8;
      if (/contact|legal|privacy|terms|cookie|support|help/i.test(parsed.pathname)) value -= 12;
      value -= parsed.pathname.split("/").filter(Boolean).length * 8;
      if (/official|brand|company/i.test(`${item.title} ${item.snippet ?? ""}`)) value += 1;
      return value;
    } catch { return -100; }
  };
  const preferred = [...candidates].sort((left, right) => score(right) - score(left))[0];
  if (!preferred) return null;
  const preferredUrl = canonicalizeUrl(preferred.url);
  const preferredParsed = new URL(preferredUrl);
  const preferredDomain = registrableDomain(preferredUrl);
  const preferredRoot = /^(open|developer|newsroom|support|m|blog)$/i.test(preferredParsed.hostname.split(".")[0])
    ? `https://www.${preferredDomain}/`
    : canonicalRoot(preferredUrl);
  const siteSearch = await tinyfish(["search", "query", `site:${preferredDomain} ${query} about mission products values sustainability brand`]) as { results?: SearchResult[] };
  const enrichedCandidates = [...candidates, ...(siteSearch.results ?? [])].map((item) => {
    try {
      return { ...item, url: canonicalizeUrl(item.url) };
    } catch {
      return null;
    }
  }).filter((item): item is SearchResult => item !== null);
  const officialCandidates = enrichedCandidates
    .filter((candidate) => terms.some((term) => domainStem(candidate.url) === term) && !/legal|privacy|terms|cookie|login|account|checkout|careers|investor|reports?|presentations?/i.test(new URL(candidate.url).pathname))
    .map((candidate) => canonicalizeUrl(candidate.url));
  return { website: preferredRoot, candidates: [...new Set([preferredRoot, ...officialCandidates])] };
}

export type FetchedPage = { url: string; final_url?: string; title?: string; description?: string; links?: string[]; image_links?: string[]; text?: unknown; isStyleSheet?: boolean };
export async function fetchPages(urls: string[]) {
  const normalizedUrls = [...new Set(urls.map(canonicalizeUrl))];
  const response = await tinyfish(["fetch", "content", "get", "--format", "json", "--links", "--image-links", ...normalizedUrls]) as { results?: FetchedPage[]; errors?: unknown[] };
  if (!response.results?.length) throw new Error("TinyFish returned no readable content for this website.");
  return response.results.map((page) => ({ ...page, url: canonicalizeUrl(page.url), final_url: page.final_url ? canonicalizeUrl(page.final_url) : undefined }));
}
