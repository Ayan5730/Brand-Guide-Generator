import { NextResponse } from "next/server";
import { extractBrandGuide } from "../../../lib/extraction";
import { fetchPages, inspectBrowserBrand, inspectRenderedBrand, searchOfficialSite } from "../../../lib/tinyfish";
import { rankLinks } from "../../../lib/normalization";
import { canonicalizeUrl } from "../../../lib/urls";

export const runtime = "nodejs";

function normalizeInput(input: string) {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) return `https://${value}`;
  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { input?: unknown };
    if (typeof body.input !== "string" || !body.input.trim()) return NextResponse.json({ success: false, error: "Enter a company name or website URL." }, { status: 400 });
    const direct = normalizeInput(body.input);
    const discovery = direct ? { website: canonicalizeUrl(direct), candidates: [canonicalizeUrl(direct)] } : await searchOfficialSite(body.input);
    if (!discovery) return NextResponse.json({ success: false, error: "We could not find an official public website for that company." }, { status: 404 });
    const website = discovery.website;
    const homepage = (await fetchPages([website]))[0];
    const discoveryBase = homepage.final_url ?? website;
    const searchPages = discovery.candidates.filter((candidate) => candidate !== website);
    const urls = [website, discoveryBase, ...searchPages, ...rankLinks(discoveryBase, homepage.links ?? [])].slice(0, 8);
    const pages = urls.length > 1 ? await fetchPages(urls) : [homepage];
    const stylesheetUrls = (homepage.links ?? []).filter((url) => /\.css(?:[?#]|$)/i.test(url)).slice(0, 3);
    const stylesheets = stylesheetUrls.length
      ? (await fetchPages(stylesheetUrls)).map((page) => ({ ...page, isStyleSheet: true }))
      : [];
    const allPages = [...pages, ...stylesheets].filter((page, index, collection) => collection.findIndex((candidate) => (candidate.final_url ?? candidate.url) === (page.final_url ?? page.url)) === index);
    const rendered = await inspectBrowserBrand(website) ?? await inspectRenderedBrand(website);
    return NextResponse.json({ success: true, brandGuide: extractBrandGuide(allPages, website, rendered), sources: allPages.filter((page) => !page.isStyleSheet).map((page) => page.final_url ?? page.url) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate a brand guide.";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
