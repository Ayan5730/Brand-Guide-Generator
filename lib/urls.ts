const trackingParameters = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "srsltid", "dclid", "msclkid", "mc_cid", "mc_eid"
]);

export function canonicalizeUrl(value: string) {
  const parsed = new URL(value);
  [...parsed.searchParams.keys()].forEach((key) => {
    if (trackingParameters.has(key.toLowerCase())) parsed.searchParams.delete(key);
  });
  parsed.hash = "";
  if (parsed.pathname === "") parsed.pathname = "/";
  return parsed.toString();
}

export function registrableDomain(value: string) {
  const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  const parts = hostname.split(".");
  if (parts.length >= 3 && /^(co|com|org|net|gov|ac)$/i.test(parts[parts.length - 2])) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

export function domainStem(value: string) {
  return registrableDomain(value).split(".")[0];
}

export function canonicalRoot(value: string) {
  const parsed = new URL(canonicalizeUrl(value));
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}
