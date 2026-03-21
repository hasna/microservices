/**
 * RSS feed parsing for podcast auto-transcription.
 * Fetches RSS XML, extracts audio enclosure URLs for new episodes.
 */

export interface FeedEpisode {
  title: string | null;
  url: string;
  published: string | null;
  duration: string | null;
}

export interface Feed {
  url: string;
  title: string | null;
  lastChecked: string | null;
}

/**
 * Fetch and parse an RSS feed, returning audio episodes.
 */
export async function fetchFeedEpisodes(feedUrl: string): Promise<{ feedTitle: string | null; episodes: FeedEpisode[] }> {
  const res = await fetch(feedUrl);
  if (!res.ok) throw new Error(`Failed to fetch feed: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  return parseRss(xml);
}

/**
 * Simple RSS XML parser — extracts items with audio enclosures.
 * No XML library needed — uses regex for the simple RSS structure.
 */
function parseRss(xml: string): { feedTitle: string | null; episodes: FeedEpisode[] } {
  // Feed title
  const channelTitleMatch = xml.match(/<channel>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
  const feedTitle = channelTitleMatch?.[1]?.trim() ?? null;

  // Extract items
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const episodes: FeedEpisode[] = [];

  for (const item of items) {
    // Find audio enclosure
    const enclosureMatch = item.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']audio\/[^"']+["']/i)
      || item.match(/<enclosure[^>]+type=["']audio\/[^"']+["'][^>]*url=["']([^"']+)["']/i);
    if (!enclosureMatch) continue;

    const url = enclosureMatch[1];
    const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
    const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
    const durationMatch = item.match(/<itunes:duration>(.*?)<\/itunes:duration>/);

    episodes.push({
      title: titleMatch?.[1]?.trim() ?? null,
      url,
      published: pubDateMatch?.[1]?.trim() ?? null,
      duration: durationMatch?.[1]?.trim() ?? null,
    });
  }

  return { feedTitle, episodes };
}
