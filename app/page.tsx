"use client";

import { useState } from "react";
import type { BrandGuide } from "../lib/types";

const steps = ["Finding official website", "Discovering relevant brand pages", "Reading live website with TinyFish", "Extracting brand identity", "Building brand guide"];

export default function Home() {
  const [input, setInput] = useState("");
  const [guide, setGuide] = useState<BrandGuide | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState(-1);
  const [loading, setLoading] = useState(false);

  async function generate() {
    if (!input.trim()) return;
    setLoading(true); setError(""); setGuide(null); setStep(0);
    const timer = window.setInterval(() => setStep((value) => Math.min(value + 1, 4)), 1800);
    try {
      const response = await fetch("/api/brand-guide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input }) });
      const data = await response.json() as { success: boolean; brandGuide?: BrandGuide; error?: string };
      if (!response.ok || !data.success || !data.brandGuide) throw new Error(data.error ?? "Unable to generate a brand guide.");
      setGuide(data.brandGuide); setStep(5);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to generate a brand guide.");
    } finally { window.clearInterval(timer); setLoading(false); }
  }

  function download() {
    if (!guide) return;
    const blob = new Blob([JSON.stringify(guide, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${guide.brandName.toLowerCase().replace(/\W+/g, "-")}-brand-guide.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <main>
    <header className="topbar"><div className="mark">BG</div><span>BRAND GUIDE GENERATOR</span><span className="live-pill">● LIVE WEB INTELLIGENCE</span></header>
    <section className="hero">
      <div className="eyebrow">A brand system, extracted from reality</div>
      <h1>Turn any live website<br /><em>into a brand guide.</em></h1>
      <p>Give us a company name or URL. TinyFish reads the live site, discovers the pages that matter, and turns real evidence into a reusable identity system.</p>
      <div className="input-row"><input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && generate()} placeholder="Enter a company name or URL..." /><button onClick={generate} disabled={loading || !input.trim()}>{loading ? "Analyzing..." : "Generate guide →"}</button></div>
      <div className="examples">Try a live site <button onClick={() => setInput("Nike")}>Nike</button><button onClick={() => setInput("Spotify")}>Spotify</button><button onClick={() => setInput("Apple")}>Apple</button></div>
    </section>
    {loading && <section className="progress panel"><div className="section-label">WORKFLOW STATUS</div>{steps.map((label, index) => <div className={`progress-item ${index < step ? "done" : index === step ? "active" : ""}`} key={label}><span>{index < step ? "✓" : index + 1}</span>{label}</div>)}</section>}
    {error && <div className="error panel">{error}</div>}
    {guide && <Guide guide={guide} download={download} />}
    {!loading && !guide && !error && <section className="how panel"><div><div className="section-label">HOW IT WORKS</div><h2>Not a homepage summary.</h2><p>We inspect a focused set of public pages — about, product, brand, press, and contact — then preserve the evidence and confidence behind every finding.</p></div><div className="pipeline"><b>SEARCH</b><i>→</i><b>FETCH</b><i>→</i><b>EXTRACT</b><i>→</i><b>GUIDE</b></div></section>}
    <footer>TinyFish Search + Fetch · Live sources, not hardcoded profiles</footer>
  </main>;
}

function Guide({ guide, download }: { guide: BrandGuide; download: () => void }) {
  return <section className="guide">
    <div className="guide-head"><div><div className="section-label">GENERATED BRAND GUIDE</div><h2>{guide.brandName}</h2><a href={guide.website} target="_blank">{guide.website}</a></div><div className="actions"><button onClick={() => navigator.clipboard.writeText(JSON.stringify(guide, null, 2))}>Copy JSON</button><button onClick={download}>Download</button></div></div>
    <div className="grid">
      <article className="card overview"><label>OVERVIEW</label>{guide.logo?.url && <img src={guide.logo.url} alt={guide.logo.alt || `${guide.brandName} logo`} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />}{guide.description && <p>{guide.description}</p>}<div className="confidence">Overall confidence: <strong>{guide.confidence.overall}</strong></div></article>
      <article className="card colors"><label>COLOR PALETTE</label><div className="swatches">{[...guide.colors.primary, ...guide.colors.secondary, ...guide.colors.accent, ...guide.colors.detected].map((color) => <div className="swatch" key={`${color.hex}-${color.category}`}><span style={{ background: color.hex }} /><b>{color.hex}</b><small>{color.category}</small><i>{color.source}</i></div>)}</div>{guide.colors.evidence.map((item) => <p className="evidence" key={item}>{item}</p>)}</article>
      <article className="card"><label>TYPOGRAPHY</label><div className="type-row"><span>HEADINGS</span><b>{guide.typography.headingFont}</b></div><div className="type-row"><span>BODY</span><b>{guide.typography.bodyFont}</b></div>{guide.typography.evidence.map((item) => <p className="evidence" key={item}>{item}</p>)}</article>
      <article className="card"><label>VOICE & TONE</label><div className="tags">{guide.voice.tone.map((tone) => <span key={tone}>{tone}</span>)}</div><p>{guide.voice.description}</p>{guide.voice.examples.map((example) => <p className="evidence" key={example.text}>“{example.text}” · {example.source}</p>)}{guide.voice.evidence.map((item) => <p className="evidence" key={item}>{item}</p>)}</article>
      <article className="card wide"><label>KEY MESSAGING</label>{guide.messaging.tagline && <h3>“{guide.messaging.tagline}”</h3>}{guide.messaging.valueProposition && <p>{guide.messaging.valueProposition.text}<br /><small className="evidence">{guide.messaging.valueProposition.source}</small></p>}<ul>{guide.messaging.keyMessages.map((message) => <li key={message.text}>{message.text}<br /><small className="evidence">{message.source}</small></li>)}</ul><div className="tags">{guide.messaging.keywords.map((keyword) => <span key={keyword}>#{keyword}</span>)}</div></article>
      <article className="card"><label>VISUAL STYLE</label><p>{guide.visualStyle.description}</p><ul>{guide.visualStyle.characteristics.map((item) => <li key={item}>{item}</li>)}</ul></article>
      <article className="card wide"><label>SOURCES · {guide.pagesAnalyzed.length} PAGES ANALYZED</label><div className="sources">{guide.pagesAnalyzed.map((source) => <a href={source.url} target="_blank" key={source.url}><b>{source.title || source.url}</b><small>{source.pageType} · {source.whyUseful}</small><span>↗</span></a>)}</div></article>
    </div>
    <details className="json card"><summary>Developer output · View JSON</summary><pre>{JSON.stringify(guide, null, 2)}</pre></details>
  </section>;
}
