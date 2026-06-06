// Formatting helpers for Smart Citation: render an in-text marker (APA or
// numeric) and a full reference-list entry from a citation's stored metadata.
// Pure functions, no editor/store deps — so the NodeView chip and the
// references panel share one source of truth.

export type CitationStyle = "apa" | "numeric";

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
};

/** Best clickable link for a citation: prefer the resolvable source URL, then
 * the DOI. Returns "" when neither is known (older chips saved before `url`). */
export function referenceHref(attrs: CitationAttrs): string {
  return attrs.url || attrs.doi || "";
}

export type CitationLink = { kind: "fulltext" | "doi" | "source"; href: string };

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

/** In-text APA marker, e.g. "(Vaswani et al., 2017)". */
export function apaInText(authors: string, year: number | null): string {
  const list = authorList(authors);
  const y = year ?? "n.d.";
  if (list.length === 0) return `(Anon., ${y})`;
  if (list.length === 1) return `(${lastName(list[0])}, ${y})`;
  if (list.length === 2)
    return `(${lastName(list[0])} & ${lastName(list[1])}, ${y})`;
  return `(${lastName(list[0])} et al., ${y})`;
}

/** The in-text marker shown inside the editor for a given style. */
export function inTextLabel(
  attrs: CitationAttrs,
  style: CitationStyle,
  number: number
): string {
  return style === "numeric"
    ? `[${number}]`
    : apaInText(attrs.authors, attrs.year);
}

/** One line in the 參考文獻 / References tab. */
export function fullReference(
  attrs: CitationAttrs,
  style: CitationStyle,
  number: number
): string {
  const authors = attrs.authors || "Anon.";
  const year = attrs.year ?? "n.d.";
  const head = attrs.title || "(untitled)";
  const venue = attrs.venue ? `. ${attrs.venue}` : "";
  return style === "numeric"
    ? `[${number}] ${authors}. ${head}${venue}, ${year}.`
    : `${authors} (${year}). ${head}${venue}.`;
}
