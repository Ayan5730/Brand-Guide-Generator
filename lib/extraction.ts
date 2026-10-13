import type { BrandGuide, EvidenceColor, EvidenceFont, EvidenceMessage, RenderedEvidence } from "./types";
import type { FetchedPage } from "./tinyfish";
import { normalizePage, type NormalizedPage } from "./normalization";
import { canonicalizeUrl, domainStem } from "./urls";

const unique = <T,>(items: T[]) => [...new Set(items)];
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const hexes = (text: string) => unique((text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((hex) => hex.length === 4 ? `#${hex.slice(1).split("").map((char) => char + char).join("")}`.toUpperCase() : hex.toUpperCase()));
const rgbToHex = (red: string, green: string, blue: string) => `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, Number(value))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
const sourceFor = (page: NormalizedPage) => page.final_url ?? page.url;
const legalOrNoise = /\b(privacy|cookie|cookies|terms of (use|service)|legal disclaimer|opt[- ]?out|do not sell|personal information|data protection|copyright|all rights reserved|consent|annual\b.*\breport|full[- ]year report|nine[- ]month report|three[- ]month report|quarterly report|latest reports?|reports? and presentations?|investor|investors|financial|careers|jobs|contact us|customer service|sign in|log in|developer documentation|api reference|software development kit|sdk documentation|newsroom|press release|media contact|press contact)\b/i;
const systemMessage = /\b(something went wrong|try reloading|reload the page|error occurred|page not found|javascript required|enable javascript|browser does not support|please try again|access denied|server error|loading\.\.\.)\b/i;
const navigationOrUrl = /^(https?:\/\/|www\.|home$|menu$|search$|close$|skip to|read more$|learn more$|view all$|shop now$|buy now$|cookie|privacy|terms|accept all|manage preferences|back to top|click here)/i;
const developerDocumentation = /(^|\/\/)(developer|docs)\.|\/(documentation|docs|api)(\/|$)/i;
const commerceNoise = /\b(shop now|shop all|add to cart|worn by|price:|sale|quick view|best sellers|new arrivals|shop by|recommended for you|reviews?)\b/i;
const meaningfulMessage = (line: string, pageTitle = "") => {
  const normalized = line.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const title = pageTitle.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  return line.length >= 8
    && line.length <= 180
    && words.length >= 2
    && normalized !== title
    && !legalOrNoise.test(line)
    && !systemMessage.test(line)
    && !navigationOrUrl.test(line)
    && !commerceNoise.test(line)
    && !/[?&](utm_|gclid|fbclid|srsltid)=/i.test(line)
    && !/\b(?:https?:\/\/|www\.|1-\d{3}[-.\s]\d{3}[-.\s]\d{4})\b/i.test(line)
    && !/^[-#\d\s\W]+$/.test(line);
};
function brandNameFrom(page: NormalizedPage, website: string) {
  const hostName = domainStem(website);
  const pageTitle = page.title?.split(/\s+[|—–:-]\s+/)[0]?.replace(/[®™©]/g, "").trim() || "";
  const normalizedHost = hostName.toLowerCase();
  if (pageTitle && pageTitle.toLowerCase() === normalizedHost) return pageTitle;
  if (pageTitle && new RegExp(`^${normalizedHost}(?:\\s|[.!?])`, "i").test(pageTitle)) return pageTitle.match(new RegExp(`^${normalizedHost}`, "i"))?.[0] ?? pageTitle;
  return hostName ? hostName.toUpperCase() : "Brand";
}

function extractColors(pages: NormalizedPage[]): EvidenceColor[] {
  const found: EvidenceColor[] = [];
  for (const page of pages) {
    const content = `${page.cleanText}\n${JSON.stringify(page.text ?? "")}`;
    for (const hex of hexes(content)) found.push({ hex, category: "detected", evidence: "Hexadecimal color token exposed in fetched page data.", source: sourceFor(page) });
    for (const match of content.matchAll(/rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/gi)) {
      found.push({ hex: rgbToHex(match[1], match[2], match[3]), category: "detected", evidence: "RGB color declaration exposed in fetched page data.", source: sourceFor(page) });
    }
  }
  const distinct = unique(found.map((color) => color.hex)).slice(0, 8);
  return distinct.map((hex) => {
    const evidence = found.find((color) => color.hex === hex) as EvidenceColor;
    const textEvidence = /text|foreground|color:/i.test(evidence.evidence);
    const backgroundEvidence = /background/i.test(evidence.evidence);
    return { ...evidence, category: textEvidence ? "text" : backgroundEvidence ? "background" : "detected" };
  });
}

function extractFonts(pages: NormalizedPage[]): EvidenceFont[] {
  const found: EvidenceFont[] = [];
  for (const page of pages) {
    const content = `${page.cleanText}\n${JSON.stringify(page.text ?? "")}`;
    for (const match of content.matchAll(/(?:\bfont-family\b|\bfontFamily\b|@font-face)["'\s:=]+([A-Za-z][A-Za-z0-9 +.'-]{1,45})/gi)) {
      const font = clean(match[1]).replace(/["';},].*$/, "").replace(/\s*!important.*$/i, "");
      if (!font || /size|weight|style|display|fallback|refresh|image|page|used|primary|body|heading|fontawesome|awesome|url|https/i.test(font) || font.split(/\s+/).length > 5) continue;
      found.push({ font, type: "other", evidence: "Font-family evidence exposed in fetched page data.", source: sourceFor(page) });
    }

  }
  return unique(found.map((item) => item.font.toLowerCase())).map((font) => found.find((item) => item.font.toLowerCase() === font) as EvidenceFont).slice(0, 5);
}

function normalizeFonts(fonts: EvidenceFont[]) {
  const cleaned = fonts
    .filter((font) => !/fontawesome|awesome|fallback|url|https|^(serif|sans-serif|monospace)$/i.test(font.font))
    .map((font) => ({ ...font, font: font.font.replace(/^['"]|['"]$/g, "").replace(/\s*,.*$/, "").trim() }))
    .filter((font) => font.font.length > 1 && !/^(to use|use|font family|font face|inherit|initial|unset)$/i.test(font.font));
  const seen = new Set<string>();
  return cleaned.filter((font) => {
    const key = font.font.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeColors(colors: EvidenceColor[]) {
  const seen = new Set<string>();
  return colors.filter((color) => {
    const hex = color.hex.toUpperCase();
    if (seen.has(hex)) return false;
    seen.add(hex);
    color.hex = hex;
    return true;
  });
}

function messages(pages: NormalizedPage[]): EvidenceMessage[] {
  const seen = new Set<string>();
  const guidelinesBoilerplate = /\b(these guidelines|how to use our|download (our |the )?assets|brand resource|please (follow|refer|review|read|see) (our|the)|approved (by|through)|do not (alter|modify|distort|stretch)|must (be used|not be|always)|usage guidelines|terms of use apply)\b/i;
  const pageScore = (pt: string) => pt === "Homepage" ? 3 : pt === "About / Company" ? 2 : pt === "Brand / Design" ? -1 : pt === "Product / Service" ? -1 : 0;
  const candidates = pages.flatMap((page) => page.cleanText.split("\n")
    .map((text) => clean(text))
    .filter(() => !developerDocumentation.test(sourceFor(page)))
    .filter(() => page.pageType !== "Press / News" && page.pageType !== "Support") // Prevent news headlines and support boilerplate from dominating core messaging
    .filter((text) => meaningfulMessage(text, page.title ?? ""))
    .filter((text) => !guidelinesBoilerplate.test(text))
    .filter((text) => {
      const key = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if ([...seen].some((existing) => existing.includes(key) || key.includes(existing) || similarity(existing, key) > 0.82)) return false;
      seen.add(key);
      return true;
    })
    .map((text) => ({ text, source: sourceFor(page), _pageType: page.pageType })));
    
  return candidates.sort((a, b) => {
    let scoreA = /\b(we|our|mission|purpose|believe|brand|always|commit|inspire|built)\b/i.test(a.text) ? 1 : 0;
    let scoreB = /\b(we|our|mission|purpose|believe|brand|always|commit|inspire|built)\b/i.test(b.text) ? 1 : 0;
    scoreA += pageScore(a._pageType);
    scoreB += pageScore(b._pageType);
    if (a.source === sourceFor(pages[0])) scoreA += 0.5;
    if (b.source === sourceFor(pages[0])) scoreB += 0.5;
    return scoreB - scoreA;
  }).map(({ text, source }) => ({ text, source })).slice(0, 10);
}

function similarity(left: string, right: string) {
  const a = new Set(left.split(" "));
  const b = new Set(right.split(" "));
  const intersection = [...a].filter((word) => b.has(word)).length;
  return intersection / Math.max(a.size, b.size);
}

function keywords(text: string) {
  const stop = /^(about|there|their|which|where|these|those|with|from|your|have|that|this|will|more|what|when|into|also|just|then|than|they|them|were|been|being|because|while|would|could|should|company|website)$/;
  return unique((text.toLowerCase().match(/\b[a-z]{5,}\b/g) ?? []).filter((word) => !stop.test(word))).slice(0, 12);
}

function isLikelyBrandAsset(url: string, website: string, brandName: string) {
  if (/\b(onetrust|cookie|consent|tracking|analytics|tag[-_ ]?manager|doubleclick|pixel|social|facebook|twitter|linkedin|instagram|youtube|payment|visa|mastercard|paypal|apple[-_ ]?pay|google[-_ ]?pay|trustpilot|review)\b/i.test(url)) return false;
  try {
    const asset = new URL(url, website);
    const site = new URL(website);
    const siteHost = site.hostname.replace(/^www\./i, "").toLowerCase();
    const assetHost = asset.hostname.replace(/^www\./i, "").toLowerCase();
    const stem = domainStem(website).toLowerCase();
    const name = brandName.toLowerCase().replace(/[^a-z0-9]/g, "");
    return assetHost === siteHost || assetHost.includes(stem) || asset.pathname.toLowerCase().includes(stem) || asset.pathname.toLowerCase().includes(name);
  } catch {
    return false;
  }
}

export function extractBrandGuide(rawPages: FetchedPage[], website: string, rendered: RenderedEvidence | null = null): BrandGuide {
  const pages = rawPages.map(normalizePage);
  const first = pages[0];
  const brandName = brandNameFrom(first, website);
  const colors = normalizeColors([...(rendered?.colors ?? []).map((color) => ({ ...color, source: website })), ...extractColors(pages)]);
  const fonts = normalizeFonts([...(rendered?.fonts ?? []).map((font) => ({ ...font, source: website })), ...extractFonts(pages)]);
  const copy = messages(pages);
  const storeCopy = /\b(shop now|add to cart|free shipping|checkout|lowest price|buy online|order now)\b/i;
  const descriptionCandidates = pages.filter(p => p.pageType === "Homepage" || p.pageType === "About / Company");
  const descriptionPage = descriptionCandidates.find(p => p.description && !storeCopy.test(p.description)) ?? descriptionCandidates[0] ?? first;
  const tagline = descriptionPage?.description && descriptionPage.description.length < 140 ? descriptionPage.description : "";
  const valueProposition = copy.find((item) => item.source === sourceFor(descriptionPage) && item.text.length > 60) ?? null;
  const marketingText = copy.map((item) => item.text).join("\n");
  const tone = unique([
    /innov|future|technology|platform|engineer/i.test(marketingText) ? "forward-looking" : "",
    /best|leading|power|built|designed|proven|performance/i.test(marketingText) ? "confident" : "",
    /easy|simple|discover|enjoy|love|inspire|together/i.test(marketingText) ? "inviting" : "",
    /premium|beautiful|elegant|exclusive|crafted/i.test(marketingText) ? "premium" : ""
  ].filter(Boolean));
  const pageSources = unique(pages.filter((page) => !page.isStyleSheet).map((page) => canonicalizeUrl(sourceFor(page)))).map((url) => {
    const page = pages.find((candidate) => canonicalizeUrl(sourceFor(candidate)) === url) as NormalizedPage;
    return { url, title: page.title ?? url, pageType: page.pageType, whyUseful: page.whyUseful };
  });
  const fallbackLogoCandidates = pages
    .flatMap((page) => (page.image_links ?? []).map((url) => ({ url, source: sourceFor(page) })))
    .filter((asset) => /logo|brand|mark|wordmark/i.test(asset.url) && isLikelyBrandAsset(asset.url, website, brandName));
  const logoCounts = fallbackLogoCandidates.reduce((acc, asset) => { acc.set(asset.url, (acc.get(asset.url) || 0) + 1); return acc; }, new Map<string, number>());
  const fallbackLogo = fallbackLogoCandidates.sort((a, b) => (logoCounts.get(b.url) || 0) - (logoCounts.get(a.url) || 0))[0];
  const isSystemFont = (font: string) => /^(arial|helvetica|helvetica neue|segoe ui|roboto|apple system|blinkmacsystemfont|system-ui|sans-serif|serif|monospace|verdana|tahoma|trebuchet ms|times new roman|georgia|garamond|courier new|brush script mt)$/i.test(font);
  const customFonts = fonts.filter(f => !isSystemFont(f.font));
  const isValidLogoUrl = (url: string) => { try { return /^https?:$/i.test(new URL(url).protocol); } catch { return false; } };
  const resolvedLogo = rendered?.logo?.url && isValidLogoUrl(rendered.logo.url) && isLikelyBrandAsset(rendered.logo.url, website, brandName)
    ? { url: rendered.logo.url, alt: rendered.logo.alt || `${brandName} logo`, source: website }
    : fallbackLogo && isValidLogoUrl(fallbackLogo.url)
      ? { url: fallbackLogo.url, alt: `${brandName} logo`, source: fallbackLogo.source }
      : null;
  const hasPrimaryColor = colors.some(c => c.category === "primary");
  return {
    brandName, website, description: descriptionPage?.description || valueProposition?.text || `${brandName}'s public website communicates its products and services through the pages analyzed.`,
    logo: resolvedLogo,
    colors: { primary: colors.filter((color) => color.category === "primary"), secondary: colors.filter((color) => color.category === "secondary"), accent: colors.filter((color) => color.category === "accent"), detected: colors.filter((color) => color.category === "detected" || color.category === "background" || color.category === "text"), evidence: [colors.length ? `${colors.length} distinct color token(s) were found in fetched page data or rendered CSS/SVG evidence.` : "No reliable CSS, SVG, RGB, or hexadecimal color tokens were exposed by the fetched pages."] },
    typography: { headingFont: fonts.find((font) => font.type === "heading")?.font || (fonts.length === 1 ? fonts[0].font : "Not confidently detected"), bodyFont: fonts.find((font) => font.type === "body")?.font || fonts[0]?.font || "Not confidently detected", otherFonts: fonts.slice(2).map((font) => font.font), evidence: [fonts.length ? `Font-family evidence was found. ${customFonts.length === 0 ? "Only fallback/system fonts were reliably detected." : ""}` : "No reliable font-family or @font-face evidence was exposed by the fetched pages."], detected: fonts },
    voice: { tone: tone.length ? tone : ["Not confidently detected"], description: tone.length ? `Messaging is ${tone.slice(0, 3).join(", ")} across the analyzed live copy.` : "Not enough evidence was available to characterize the brand voice.", evidence: [`Analyzed ${pages.length} cleaned live page(s); navigation, legal, duplicate, and contact boilerplate were removed.`], examples: copy.slice(0, 3) },
    messaging: { tagline: meaningfulMessage(tagline) ? tagline : "", keyMessages: copy.slice(0, 6), valueProposition, keywords: [] },
    visualStyle: { description: colors.length || fonts.length || first?.image_links?.length ? `The live site shows ${colors.length ? "verifiable color usage" : "limited color evidence"}${fonts.length ? ` and ${fonts.length} detected font family evidence${fonts.length === 1 ? "" : "s"}` : ""}${first?.image_links?.length ? ", supported by rendered or fetched visual assets" : ""}.` : "Visual evidence was limited in the fetched content; conclusions are intentionally conservative.", characteristics: unique([colors.length ? "Defined color tokens" : "", fonts.length ? "Observed typography" : "", first?.image_links?.length ? "Branded imagery" : "", pages.length > 1 ? "Consistent multi-page system" : ""].filter(Boolean)) },
    pagesAnalyzed: pageSources, sources: pageSources.map((page) => page.url),
    confidence: { 
      overall: (colors.length >= 2 && hasPrimaryColor && customFonts.length > 0 && copy.length >= 3 && resolvedLogo) ? "High" : (colors.length > 0 || copy.length >= 2) ? "Medium" : "Low", 
      colors: colors.length >= 2 && hasPrimaryColor ? "High" : colors.length >= 2 ? "Medium" : colors.length === 1 ? "Low" : "Low", 
      typography: customFonts.length >= 2 ? "High" : customFonts.length === 1 ? "Medium" : fonts.length > 0 ? "Low (System Fonts Only)" : "Low", 
      voice: copy.length >= 4 ? "High" : copy.length >= 2 ? "Medium" : "Low", 
      messaging: copy.length >= 4 && valueProposition ? "High" : copy.length >= 2 ? "Medium" : "Low" 
    }
  };
}
