// api/portfolio.js
// Fetches all Notion entries + Spotify popularity scores
// Env vars: NOTION_API_KEY, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET

const DATABASE_ID = '342e603d505e80629d4cf51e05b90426';

async function getSpotifyToken(clientId, clientSecret) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Spotify token failed: ' + JSON.stringify(d));
  return d.access_token;
}

async function getSpotifyScore(token, artist) {
  try {
    const q = encodeURIComponent(artist);
    const r = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=artist&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const a = d.artists?.items?.[0];
    if (!a) return null;
    const pop = a.popularity || 0;
    const fol = Math.min(a.followers?.total || 0, 5000000);
    return Math.round(pop * 0.6 + (fol / 5000000) * 100 * 0.4);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // No cache — always fresh
  res.setHeader('Cache-Control', 'no-store');

  const notionKey     = process.env.NOTION_API_KEY;
  const spotifyId     = process.env.SPOTIFY_CLIENT_ID;
  const spotifySecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!notionKey) return res.status(500).json({ error: 'NOTION_API_KEY not set' });

  try {
    // 1. Fetch all Notion entries
    const entries = [];
    let cursor = undefined;
    let page = 0;

    do {
      page++;
      const body = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) };
      const r = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${notionKey}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      const data = await r.json();

      for (const p of data.results) {
        const props  = p.properties;
        const artist = props['Artista / Proyecto']?.title?.[0]?.plain_text?.trim() || '';
        if (!artist) continue;
        entries.push({
          id:     p.id,
          artist,
          title:  props['Título']?.rich_text?.[0]?.plain_text?.trim() || '',
          format: props['Formato']?.rich_text?.[0]?.plain_text?.trim() || '',
          role:   props['Rol']?.rich_text?.[0]?.plain_text?.trim() || '',
          year:   props['Año']?.number ?? null,
          spotifyScore: null,
        });
      }

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor && page < 20);

    // 2. Spotify scores — parallel batches of 10
    if (spotifyId && spotifySecret) {
      const token   = await getSpotifyToken(spotifyId, spotifySecret);
      const unique  = [...new Set(entries.map(e => e.artist))];
      const scores  = {};
      const BATCH   = 10;

      for (let i = 0; i < unique.length; i += BATCH) {
        const batch   = unique.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(artist => getSpotifyScore(token, artist).then(score => ({ artist, score })))
        );
        results.forEach(({ artist, score }) => { scores[artist] = score; });
      }

      entries.forEach(e => { e.spotifyScore = scores[e.artist] ?? null; });
    }

    return res.status(200).json({ entries, total: entries.length });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
