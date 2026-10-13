# Brand Guide Generator

Brand Guide Generator turns a company name or URL into a structured, evidence-aware brand guide. It reads the live public website, discovers a focused set of relevant pages, and presents brand identity findings for marketers, designers, developers, and AI systems.

## TinyFish integration

- **TinyFish Search** runs for company-name inputs to find the most likely official public site.
- **TinyFish Fetch** reads the homepage and up to five same-domain pages whose paths suggest useful context (about, brand, product, service, press, or contact).
- **TinyFish Browser** connects to a rendered TinyFish browser session through `playwright-core` when available, inspecting visible computed colors, rendered font families, and primary logo assets. This is used because clean Fetch content does not always expose the page's loaded CSS or image DOM.
- A normalization layer removes navigation, legal/contact boilerplate, extraction labels, and duplicate sentences before analysis.
- When TinyFish exposes stylesheet links, the server fetches a small number of those CSS resources too and inspects directly returned color/font declarations. If no style evidence is available, the guide reports that conservatively.
- The server-side extraction layer converts the cleaned page titles, descriptions, links, images, copy, and exposed color/font evidence into typed JSON with source URLs and evidence notes.
- The UI presents the guide with source links, confidence labels, copyable JSON, and a JSON download.

The app uses the TinyFish CLI's current `search query` and `fetch content get` commands. The API key is only read in the Next.js route handler and is never sent to the browser.

## Why TinyFish matters

Static profiles quickly become stale and cannot reliably represent a company's current messaging, design tokens, or public pages. TinyFish supplies clean content from live websites at request time, while this application preserves the pages used and avoids presenting unsupported guesses as facts.

## Architecture

```text
User → Search (if needed) → official website → Fetch relevant pages
     → evidence-aware extraction → structured Brand Guide → UI / JSON
```

## Demo brands

The UI includes Nike, Spotify, and Apple as example inputs. These are not hardcoded profiles: each generation searches or fetches the live public website.

## Setup

```bash
npm install
copy .env.example .env.local
# Put your TinyFish key in .env.local
npm run dev
```

Open http://localhost:3000. A valid `TINYFISH_API_KEY` is required for generation.

## Security

`.env.local` is ignored by git. TinyFish credentials are consumed only by the server route and are never included in client JavaScript or API responses.

## Limitations

The extraction layer is deliberately conservative. It reports “Not confidently detected” when a fetched site does not expose reliable font/color/image evidence. Dynamic sites may provide limited clean content through Fetch, in which case the UI shows lower confidence rather than fabricated data.
