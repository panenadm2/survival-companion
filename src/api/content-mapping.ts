import type { Anime, Episode, SiteSettings, Tag } from './types';

/** Row shapes matching the verified live database columns. */
export interface AnimeRow {
  id: string; title: string; slug: string;
  synopsis: string | null; poster_url: string | null;
  type: Anime['type']; status: Anime['status'];
  season: string | null; year: number | null;
  is_published: boolean; created_at: string; updated_at: string;
}
export interface EpisodeRow {
  id: string; anime_id: string; episode_number: number; title: string | null;
  embed_url: string | null; thumbnail_url: string | null; is_published: boolean;
  published_at: string | null; created_at: string; updated_at: string;
}
export interface SettingsRow {
  id: number; site_name: string; tagline: string | null; logo_url: string | null;
  footer_text: string | null; updated_at: string;
}
export interface AnimeTagRow { anime_id: string; tag_id: string }
export function mapAnime(row: AnimeRow, links: AnimeTagRow[]): Anime {
  return {
    id: row.id, title: row.title, slug: row.slug,
    synopsis: row.synopsis ?? '', posterUrl: row.poster_url ?? '',
    type: row.type, status: row.status, season: row.season ?? '',
    year: row.year ?? 0, isPublished: row.is_published,
    tagIds: links.filter(link => link.anime_id === row.id).map(link => link.tag_id),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
export function mapEpisode(row: EpisodeRow): Episode {
  return { id: row.id, animeId: row.anime_id, number: row.episode_number, title: row.title ?? '',
    embedUrl: row.embed_url ?? '', thumbnailUrl: row.thumbnail_url ?? '',
    isPublished: row.is_published, publishedAt: row.published_at ?? '', updatedAt: row.updated_at };
}
export function mapSettings(row: SettingsRow): SiteSettings {
  return { siteName: row.site_name, tagline: row.tagline ?? '', logoUrl: row.logo_url,
    footerText: row.footer_text ?? '' };
}
export type TagRow = Tag;
