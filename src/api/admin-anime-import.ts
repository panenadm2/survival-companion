import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/db-types";
import { slugify } from "./admin-validation";
import { imageObjectPath } from "./storage-image";
import type { Anime, Tag } from "./types";

type AnimeType = Database["public"]["Enums"]["anime_type"];
type AnimeStatus = Database["public"]["Enums"]["anime_status"];

export const CSV_HEADERS = ["title", "alt_title", "type", "status", "season", "year", "studio", "rating", "duration_minutes", "total_episodes", "genres", "synopsis", "poster_url"] as const;

const SAMPLE_ROWS = [
  ["Contoh Judul Anime", "Example Anime Title", "tv", "ongoing", "Spring", "2025", "Nama Studio", "8.5", "24", "12", "Action, Fantasy", "Sinopsis singkat anime.", ""],
  ["Contoh Judul Movie", "", "movie", "completed", "", "2024", "Nama Studio", "", "110", "1", "Drama", "Sinopsis singkat film.", "https://contoh.com/poster.jpg"],
];

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildTemplateCsv(): string {
  return "\uFEFF" + [CSV_HEADERS as readonly string[], ...SAMPLE_ROWS].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const TYPE_ALIASES: Record<string, AnimeType> = { tv: "tv", movie: "movie", film: "movie", ova: "ova", ona: "ona", special: "special" };
const STATUS_ALIASES: Record<string, AnimeStatus> = { ongoing: "ongoing", completed: "completed", tamat: "completed", selesai: "completed", upcoming: "upcoming", segera: "upcoming" };

/** Exact-match normalization only: case, accents, punctuation and spacing. Similar titles are not merged. */
export function normalizeTitle(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export type ImportRowStatus = "baru" | "duplikat" | "invalid";

export interface ImportRow {
  lineNumber: number;
  status: ImportRowStatus;
  reasons: string[];
  title: string;
  altTitle: string;
  slug: string;
  type: AnimeType | null;
  status_: AnimeStatus | null;
  season: string;
  year: number | null;
  studio: string;
  rating: number | null;
  durationMinutes: number | null;
  totalEpisodes: number | null;
  genres: string[];
  tagIds: string[];
  synopsis: string;
  posterPath: string | null;
}

function optionalInt(raw: string, label: string, min: number, max: number, reasons: string[]): number | null {
  const v = raw.trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) { reasons.push(`${label} harus bilangan bulat ${min}–${max}.`); return null; }
  return n;
}

function optionalRating(raw: string, reasons: string[]): number | null {
  const value = raw.trim();
  if (!value) return null;
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
    reasons.push("Rating harus berupa angka antara 0–10.");
    return null;
  }
  return rating;
}

export function analyzeCsv(text: string, existing: Anime[], tags: Tag[]): { rows: ImportRow[]; headerError: string | null } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], headerError: "File CSV kosong." };
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const missing = ["title", "type", "status"].filter((h) => !header.includes(h));
  if (missing.length) return { rows: [], headerError: `Kolom wajib tidak ada: ${missing.join(", ")}. Gunakan template resmi.` };
  const col = (r: string[], name: string) => { const i = header.indexOf(name); return i >= 0 ? (r[i] ?? "").trim() : ""; };

  const existingTitles = new Set<string>();
  const existingSlugs = new Set<string>();
  for (const a of existing) {
    if (a.title) existingTitles.add(normalizeTitle(a.title));
    if (a.altTitle) existingTitles.add(normalizeTitle(a.altTitle));
    existingSlugs.add(a.slug);
  }
  const tagByKey = new Map<string, Tag>();
  for (const t of tags) { tagByKey.set(t.name.trim().toLowerCase(), t); tagByKey.set(t.slug, t); }

  const seenTitles = new Map<string, number>();
  const seenSlugs = new Map<string, number>();
  const rows: ImportRow[] = [];

  table.slice(1).forEach((r, index) => {
    const lineNumber = index + 2;
    const invalid: string[] = [];
    const dup: string[] = [];
    const title = col(r, "title");
    const altTitle = col(r, "alt_title");
    if (!title) invalid.push("Judul wajib diisi.");
    const slug = slugify(title);
    if (title && !slug) invalid.push("Judul tidak dapat dijadikan slug.");
    const typeRaw = col(r, "type").toLowerCase();
    const type = TYPE_ALIASES[typeRaw] ?? null;
    if (!type) invalid.push(`Tipe "${col(r, "type")}" tidak dikenal (tv, movie, ova, ona, special).`);
    const statusRaw = col(r, "status").toLowerCase();
    const status = STATUS_ALIASES[statusRaw] ?? null;
    if (!status) invalid.push(`Status "${col(r, "status")}" tidak dikenal (ongoing, completed, upcoming).`);
    const year = optionalInt(col(r, "year"), "Tahun", 1900, 2200, invalid);
    const rating = optionalRating(col(r, "rating"), invalid);
    const durationMinutes = optionalInt(col(r, "duration_minutes"), "Durasi", 1, 100000, invalid);
    const totalEpisodes = optionalInt(col(r, "total_episodes"), "Total episode", 1, 100000, invalid);

    let posterPath: string | null = null;
    const poster = col(r, "poster_url");
    if (poster) {
      try {
        const url = new URL(poster);
        if (url.protocol !== "https:") throw new Error();
        posterPath = imageObjectPath("posters", poster);
      } catch { invalid.push("poster_url harus URL https:// yang valid."); }
    }

    const genres = col(r, "genres").split(/[,;|]/).map((g) => g.trim()).filter(Boolean);
    const tagIds: string[] = [];
    const unknown: string[] = [];
    for (const g of genres) {
      const t = tagByKey.get(g.toLowerCase()) ?? tagByKey.get(slugify(g));
      if (t) { if (!tagIds.includes(t.id)) tagIds.push(t.id); } else unknown.push(g);
    }
    if (unknown.length) invalid.push(`Genre belum terdaftar: ${unknown.join(", ")}.`);

    if (title) {
      const keys = [normalizeTitle(title), altTitle ? normalizeTitle(altTitle) : ""].filter(Boolean);
      if (keys.some((k) => existingTitles.has(k))) dup.push("Judul atau judul alternatif sudah ada di katalog.");
      if (slug && existingSlugs.has(slug)) dup.push(`Slug "${slug}" sudah digunakan.`);
      const prevLine = keys.map((k) => seenTitles.get(k)).find(Boolean) ?? (slug ? seenSlugs.get(slug) : undefined);
      if (prevLine) dup.push(`Sama dengan baris ${prevLine} di file ini.`);
      keys.forEach((k) => { if (!seenTitles.has(k)) seenTitles.set(k, lineNumber); });
      if (slug && !seenSlugs.has(slug)) seenSlugs.set(slug, lineNumber);
    }

    rows.push({
      lineNumber,
      status: invalid.length ? "invalid" : dup.length ? "duplikat" : "baru",
      reasons: [...invalid, ...dup],
      title, altTitle, slug, type, status_: status,
      season: col(r, "season"), year, studio: col(r, "studio"), rating,
      durationMinutes, totalEpisodes, genres, tagIds,
      synopsis: col(r, "synopsis"), posterPath,
    });
  });
  return { rows, headerError: null };
}

export interface ImportResult { lineNumber: number; title: string; ok: boolean; message: string }

/** Insert-only import. Never updates existing anime; every row is saved as a draft. */
export async function importAnimeRows(rows: ImportRow[]): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const row of rows) {
    if (row.status !== "baru" || !row.type || !row.status_) {
      results.push({ lineNumber: row.lineNumber, title: row.title, ok: false, message: "Baris tidak valid atau duplikat." });
      continue;
    }
    const { data: clash, error: clashError } = await supabase.from("anime").select("id").eq("slug", row.slug).maybeSingle();
    if (clashError) { results.push({ lineNumber: row.lineNumber, title: row.title, ok: false, message: `Gagal memeriksa slug: ${clashError.message}` }); continue; }
    if (clash) { results.push({ lineNumber: row.lineNumber, title: row.title, ok: false, message: `Slug "${row.slug}" sudah digunakan.` }); continue; }

    const payload: Database["public"]["Tables"]["anime"]["Insert"] = {
      title: row.title,
      alt_title: row.altTitle || null,
      slug: row.slug,
      synopsis: row.synopsis ?? "",
      poster_path: row.posterPath,
      studio: row.studio || null,
      rating: row.rating,
      type: row.type,
      status: row.status_,
      season: row.season || null,
      year: row.year,
      duration_minutes: row.durationMinutes,
      total_episodes: row.totalEpisodes,
      is_published: false,
    };
    const { data: saved, error } = await supabase.from("anime").insert(payload).select("id").single();
    if (error || !saved) {
      const msg = error?.code === "23505" ? "Data sudah ada (slug ganda)." : `Ditolak database: ${error?.message ?? "tidak diketahui"}`;
      results.push({ lineNumber: row.lineNumber, title: row.title, ok: false, message: msg });
      continue;
    }
    if (row.tagIds.length) {
      const { error: tagError } = await supabase.from("anime_tags").insert(row.tagIds.map((tag_id) => ({ anime_id: saved.id, tag_id })));
      if (tagError) { results.push({ lineNumber: row.lineNumber, title: row.title, ok: true, message: `Tersimpan sebagai draf, tetapi genre gagal disimpan: ${tagError.message}` }); continue; }
    }
    results.push({ lineNumber: row.lineNumber, title: row.title, ok: true, message: "Tersimpan sebagai draf." });
  }
  return results;
}
