/** Importa somente metadados; URLs e credenciais nunca fazem parte do retorno. */
export type MarketingServer = "GF" | "Five" | "Club";
export type MarketingKind = "filme" | "serie";
export type MarketingEntry = {
  server: MarketingServer;
  content_key: string;
  title: string;
  kind: MarketingKind;
  release_year: number | null;
  last_seen_at: string;
};
export const MARKETING_SERVERS: MarketingServer[] = ["GF", "Five", "Club"];

export function normalizeMarketingTitle(input: string, kind: MarketingKind) {
  const yearMatch = input.match(/(?:^|[\s([])((?:19|20)\d{2})(?:$|[\s)\]])/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const title = input
    .replace(/\b(?:S\d{1,2}\s*E\d{1,3}|temporada\s*\d+|epis[oó]dio\s*\d+)\b/gi, " ")
    .replace(/\b(?:1080p|720p|2160p|4k|fhd|uhd|hd|h\.?264|x265|dublado|legendado|dual audio|pt-br|web-dl|bluray)\b/gi," ")
    .replace(/(?:^|[\s([])(?:19|20)\d{2}(?=$|[\s)\]])/g, " ")
    .replace(/^[\s|:.\-]+|[\s|:.\-]+$/g, "")
    .replace(/\s+/g, " ").trim();
  const slug = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (title.length < 3 || title.length > 200 || slug.length < 3) return null;
  return {
    title, kind, release_year: year,
    content_key: kind + ":" + slug + ":" + (year ?? "sem-ano"),
  };
}

export function parseMarketingM3U(text: string, server: MarketingServer, maxTitles = 12000) {
  const found = new Map<string, MarketingEntry>();
  let pending = "";
  let skipped = 0;
  const lastSeenAt = new Date().toISOString();
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#EXTINF:")) { pending = line; continue; }
    if (!pending || !line.trim() || line.startsWith("#")) continue;
    const group = /group-title="([^"]*)"/i.exec(pending)?.[1] ?? "";
    const rawTitle = /tvg-name="([^"]+)"/i.exec(pending)?.[1] ||
      pending.slice(pending.lastIndexOf(",") + 1);
    let kind: MarketingKind | null = null;
    if (/s[eé]ries?|temporadas?|season/i.test(group) || /\/series?\//i.test(line)) kind = "serie";
    else if (/filmes?|movies?|vod|cinema/i.test(group) || /\/movies?\//i.test(line)) kind = "filme";
    else if (/\bS\d{1,2}\s*E\d{1,3}\b/i.test(rawTitle)) kind = "serie";
    pending = "";
    if (!kind) { skipped++; continue; }
    const parsed = normalizeMarketingTitle(rawTitle,kind);
    if (!parsed) { skipped++; continue; }
    found.set(parsed.content_key, { ...parsed, server, last_seen_at:lastSeenAt });
    if (found.size >= maxTitles) break;
  }
  return { entries:[...found.values()], skipped, truncated:found.size >= maxTitles };
}
