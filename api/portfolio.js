// api/portfolio.js
// Vercel serverless function — fetches all entries from Notion database with pagination
// Requires env variable: NOTION_API_KEY
// Database: portafolio_heyne_producciones_93/26

const DATABASE_ID = '342e603d505e80629d4cf51e05b90426';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://cristianheyne.xyz');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const key = process.env.NOTION_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'NOTION_API_KEY not set in environment variables.' });
  }

  try {
    const entries = [];
    let cursor  = undefined;
    let page    = 0;
    const MAX   = 20; // safety cap on pages (20 × 100 = 2000 entries max)

    do {
      page++;
      const body = {
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      };

      const r = await fetch(
        `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );

      if (!r.ok) {
        const err = await r.text();
        return res.status(r.status).json({ error: `Notion API error: ${err}` });
      }

      const data = await r.json();

      for (const p of data.results) {
        const props = p.properties;
        const artist = props['Artista / Proyecto']?.title?.[0]?.plain_text?.trim() || '';
        const title  = props['Título']?.rich_text?.[0]?.plain_text?.trim() || '';
        const format = props['Formato']?.rich_text?.[0]?.plain_text?.trim() || '';
        const role   = props['Rol']?.rich_text?.[0]?.plain_text?.trim() || '';
        const year   = props['Año']?.number ?? null;

        if (artist) { // only include rows with an artist
          entries.push({ id: p.id, artist, title, format, role, year });
        }
      }

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor && page < MAX);

    // Cache on Vercel CDN for 1 hour — re-fetches from Notion when stale
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ entries, total: entries.length });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
