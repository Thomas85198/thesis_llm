// Formatting helpers for Smart Citation: render an in-text marker and a full
// reference-list entry from a citation's stored metadata, in any supported
// style. Pure functions, no editor/store deps — so the NodeView chip and the
// references panel share one source of truth (and the backend export mirrors
// this exact logic in app/export_doc.py).

export type CitationStyle =
  | "apa"
  | "mla"
  | "chicago"
  | "harvard"
  | "ieee"
  | "numeric";

/** Selectable styles, in display order. */
export const CITATION_STYLES: CitationStyle[] = [
  "apa",
  "mla",
  "chicago",
  "harvard",
  "ieee",
  "numeric",
];

/** Short label for the style picker (acronyms are language-neutral). */
export const CITATION_STYLE_LABEL: Record<CitationStyle, string> = {
  apa: "APA",
  mla: "MLA",
  chicago: "Chicago",
  harvard: "Harvard",
  ieee: "IEEE",
  numeric: "[1]",
};

/** Styles that render in-text as a bracketed number rather than author–year. */
export function isNumberedStyle(style: CitationStyle): boolean {
  return style === "ieee" || style === "numeric";
}

// Mirrors the attrs stored on the citation node (authors flattened to a single
// comma-joined string so it survives ProseMirror JSON without nesting).
export type CitationAttrs = {
  openalexId: string;
  authors: string; // "Ashish Vaswani, Noam Shazeer"
  year: number | null;
  title: string;
  venue: string;
  doi: string;
  oaUrl: string; // open-access full text — most useful, but can rot ("" if none)
  url: string; // always-resolvable source link (OA full text → DOI → … )
  // Recognized-but-unresolved citation (detected in text, no source linked yet).
  unlinked?: boolean;
  kind?: "academic" | "web";
  raw?: string; // the original in-text marker text, for re-search / display
  // Narrative citation ("Author (year) argued…") — the author stays prose, so the
  // chip renders "Author (year)" instead of the parenthetical "(Author, year)".
  narrative?: boolean;
};

/** Stable identity for numbering/dedup: the OpenAlex id when linked, else a
 * normalized authors|year key so unlinked chips still group + number correctly. */
export function citeKey(a: CitationAttrs): string {
  return (
    a.openalexId ||
    `${(a.authors || "").toLowerCase().replace(/\s+/g, " ").trim()}|${a.year ?? ""}`
  );
}

/** Best clickable link for a citation: prefer the resolvable source URL, then
 * the DOI. Returns "" when neither is known (older chips saved before `url`). */
export function referenceHref(attrs: CitationAttrs): string {
  return attrs.url || attrs.doi || "";
}

export type CitationLink = {
  kind: "fulltext" | "doi" | "source";
  href: string;
};

/** Links to offer for a reference. The OA full text is the most useful but can
 * rot, so we pair it with the DOI as a stable anchor. When neither exists, fall
 * back to the always-resolvable source link so there is always one way in. */
export function referenceLinks(attrs: CitationAttrs): CitationLink[] {
  const links: CitationLink[] = [];
  if (attrs.oaUrl) links.push({ kind: "fulltext", href: attrs.oaUrl });
  if (attrs.doi && attrs.doi !== attrs.oaUrl)
    links.push({ kind: "doi", href: attrs.doi });
  if (links.length === 0 && attrs.url)
    links.push({ kind: "source", href: attrs.url });
  return links;
}

function authorList(authors: string): string[] {
  return authors
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1] || full;
}

/** Shortened author list for an in-text marker: "Vaswani", "Vaswani & Shazeer",
 * or "Vaswani et al." (3+). */
function authorsShort(authors: string): string {
  const list = authorList(authors);
  if (list.length === 0) return "Anon.";
  if (list.length === 1) return lastName(list[0]);
  if (list.length === 2) return `${lastName(list[0])} & ${lastName(list[1])}`;
  return `${lastName(list[0])} et al.`;
}

/** The in-text marker shown inside the editor for a given style. */
export function inTextLabel(
  attrs: CitationAttrs,
  style: CitationStyle,
  number: number,
): string {
  // Narrative: author named in the sentence, only the year (or [n]) parenthesized.
  if (attrs.narrative) {
    const short = authorsShort(attrs.authors);
    if (isNumberedStyle(style)) return `${short} [${number}]`;
    if (style === "mla") return short;
    return `${short} (${attrs.year ?? "n.d."})`;
  }
  if (isNumberedStyle(style)) return `[${number}]`;
  const short = authorsShort(attrs.authors);
  const y = attrs.year ?? "n.d.";
  switch (style) {
    case "mla":
      return `(${short})`; // MLA uses author (+ page, which we don't have)
    case "chicago":
      return `(${short} ${y})`; // Chicago author–date, no comma
    default:
      return `(${short}, ${y})`; // apa, harvard
  }
}

/** One line in the 參考文獻 / References tab. */
export function fullReference(
  attrs: CitationAttrs,
  style: CitationStyle,
  number: number,
): string {
  const authors = attrs.authors || "Anon.";
  const year = attrs.year ?? "n.d.";
  const title = attrs.title || "(untitled)";
  const venue = attrs.venue;
  // Web sources (a URL but no DOI) append the link, per APA web style.
  const web = attrs.url && !attrs.doi ? ` ${attrs.url}` : "";
  switch (style) {
    case "mla":
      return `${authors}. “${title}.”${venue ? ` ${venue},` : ""} ${year}.${web}`;
    case "chicago":
      return `${authors}. “${title}.”${venue ? ` ${venue}` : ""} (${year}).${web}`;
    case "harvard":
      return `${authors} (${year}) ‘${title}’${venue ? `, ${venue}` : ""}.${web}`;
    case "ieee":
    case "numeric":
      return `[${number}] ${authors}, “${title},”${venue ? ` ${venue},` : ""} ${year}.${web}`;
    default: // apa
      return `${authors} (${year}). ${title}${venue ? `. ${venue}` : ""}.${web}`;
  }
}
