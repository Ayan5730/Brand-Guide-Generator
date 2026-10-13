export type EvidenceColor = { hex: string; category: "primary" | "secondary" | "accent" | "background" | "text" | "detected"; evidence: string; source: string };
export type EvidenceFont = { font: string; type: "heading" | "body" | "other"; evidence: string; source: string };
export type EvidenceMessage = { text: string; source: string };
export type RenderedEvidence = {
  logo: { url: string; alt: string; evidence: string } | null;
  colors: Array<{ hex: string; category: "primary" | "secondary" | "accent" | "background" | "text" | "detected"; evidence: string }>;
  fonts: Array<{ font: string; type: "heading" | "body" | "other"; evidence: string }>;
};
export type PageSource = { url: string; title: string; pageType: string; whyUseful: string };
export type BrandGuide = {
  brandName: string; website: string; description: string;
  logo: { url: string; alt: string; source: string } | null;
  colors: { primary: EvidenceColor[]; secondary: EvidenceColor[]; accent: EvidenceColor[]; detected: EvidenceColor[]; evidence: string[] };
  typography: { headingFont: string; bodyFont: string; otherFonts: string[]; evidence: string[]; detected: EvidenceFont[] };
  voice: { tone: string[]; description: string; evidence: string[]; examples: EvidenceMessage[] };
  messaging: { tagline: string; keyMessages: EvidenceMessage[]; valueProposition: EvidenceMessage | null; keywords: string[] };
  visualStyle: { description: string; characteristics: string[] };
  pagesAnalyzed: PageSource[]; sources: string[];
  confidence: { overall: string; colors: string; typography: string; voice: string; messaging: string };
};
