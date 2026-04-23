/**
 * Griekse Wijn Sommelier — proxy server
 *
 * Vereisten:  node >= 18
 * Installeer: npm install
 * Start:      node proxy.js
 *
 * Zet je secrets in een .env bestand (zie .env.example)
 */

import dotenv from 'dotenv';
dotenv.config({ override: true });
import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const app  = express();
const port = process.env.PORT || 3000;

const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static(__dirname));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/* ════════════════════════════════════════════════════════
   WooCommerce product fetch
════════════════════════════════════════════════════════ */
async function fetchWines() {
  const { WC_URL, WC_KEY, WC_SECRET } = process.env;
  if (!WC_URL || !WC_KEY || !WC_SECRET) {
    console.log('ℹ️  Geen WooCommerce-gegevens — gebruik demo-assortiment');
    return DEMO_WINES;
  }

  try {
    const credentials = Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString('base64');
    const url = `${WC_URL}/wp-json/wc/v3/products?per_page=100&status=publish&stock_status=instock`;
    console.log(`🔗 WooCommerce ophalen: ${url}`);

    const res = await fetch(url, {
      headers: { Authorization: `Basic ${credentials}` },
    });

    if (!res.ok) {
      console.error(`⚠️  WooCommerce HTTP ${res.status} — gebruik demo-assortiment`);
      return DEMO_WINES;
    }

    const products = await res.json();
    console.log(`✅ ${products.length} wijnen opgehaald uit WooCommerce`);

    // Vervang elk domein in de URL door het correcte WC_URL
    const base = WC_URL.replace(/\/$/, '');
    const fixUrl = (url) => url ? url.replace(/^https?:\/\/[^/]+/, base) : url;


    return products
      .filter(p => p.stock_status === 'instock')
      .map(p => {
        // Haal Vivino-IDs op:
        // 1. Eigen sommelier-sleutel (_sommelier_vivino_id) — URL of ID opgeslagen via beheerpagina
        // 2. Originele vivino_widget HTML — voor producten die al gekoppeld waren
        const sommelierMeta = p.meta_data?.find(m => m.key === '_sommelier_vivino_id')?.value || '';
        const vivinoWidget  = p.meta_data?.find(m => m.key === 'vivino_widget')?.value || '';
        const { vintageId: vivinoVintageId, wineId: vivinoWineId } =
          parseVivinoIds(sommelierMeta || vivinoWidget);

        return {
          id:     p.id,
          name:   p.name,
          price:  p.price,
          url:    fixUrl(p.permalink),
          add_to_cart_url: `${fixUrl(p.permalink)}?add-to-cart=${p.id}`,
          image:  p.images?.[0]?.src || null,
          attributes: Object.fromEntries(
            (p.attributes || []).map(a => [a.name.toLowerCase(), a.options.join(', ')])
          ),
          tags: (p.tags || []).map(t => t.name),
          short_description: p.short_description?.replace(/<[^>]+>/g, '') || '',
          vivinoVintageId,
          vivinoWineId,
        };
      });
  } catch (err) {
    console.error(`⚠️  WooCommerce verbindingsfout: ${err.message} — gebruik demo-assortiment`);
    return DEMO_WINES;
  }
}

/* ════════════════════════════════════════════════════════
   Claude API call
════════════════════════════════════════════════════════ */
async function getRecommendations(preferences, wines) {
  const wineList = wines.map(w => {
    const attrs = Object.entries(w.attributes)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');
    return `ID ${w.id} | ${w.name} | €${w.price}\n${attrs}\n  tags: ${w.tags.join(', ')}\n  ${w.short_description}`;
  }).join('\n\n');

  const tasteDesc = [
    `Droog/zoet schaal (1=droog, 10=zoet): ${preferences.taste.sweetness} → ${sweetnessWord(preferences.taste.sweetness)}`,
    `Body (1=licht, 10=vol): ${preferences.taste.body} → ${bodyWord(preferences.taste.body)}`,
    `Tannine/structuur (1=zacht, 10=robuust): ${preferences.taste.tannins} → ${tanninWord(preferences.taste.tannins)}`,
  ].join('\n');

  const wijntype = preferences.wijntype && preferences.wijntype !== 'Verras me!'
    ? preferences.wijntype
    : 'geen voorkeur (verras me)';

  const userProfile = `
Bekende wijnen die klant lekker vindt: ${preferences.familiar.length ? preferences.familiar.join(', ') : 'niet opgegeven'}
Gewenst wijntype: ${wijntype}
Gelegenheid: ${preferences.occasion}
Gerecht: ${preferences.food}
Smaakprofiel:
${tasteDesc}
Budget: tot €${preferences.budget >= 58 ? '60+' : preferences.budget} per fles
`.trim();

  const systemPrompt = `Je bent een warme, enthousiaste sommelier gespecialiseerd in Griekse wijnen.
Je helpt klanten Griekse wijnen ontdekken die passen bij hun smaak.
Je spreekt vloeiend Nederlands en bent beknopt maar persoonlijk.

Griekse druivenrassen zijn voor veel mensen onbekend. Leg altijd kort uit:
- Hoe het Griekse ras zich verhoudt tot bekende internationale druiven
- Waarom de wijn past bij dit specifieke smaakprofiel en deze gelegenheid

Geef je antwoord ALTIJD als valide JSON (geen markdown, geen extra tekst), precies in dit formaat:
{
  "introduction": "Persoonlijke, warme intro van 2-3 zinnen gebaseerd op hun profiel",
  "recommendations": [
    {
      "product_id": 123,
      "grape": "Druivenras",
      "region": "Regio, Griekenland",
      "why": "1-2 zinnen waarom deze wijn perfect past bij hun smaak en gelegenheid",
      "grape_explanation": "1 zin: vergelijk het Griekse ras met wat ze kennen"
    }
  ]
}

Geef 2 tot 3 aanbevelingen, gesorteerd op beste match.
Verzin NOOIT URLs of prijzen — die voegen wij zelf toe op basis van product_id.`;

  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1024,
    system:     systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Klantprofiel:\n${userProfile}\n\nBeschikbaar assortiment:\n${wineList}`,
      },
    ],
  });

  const raw = message.content[0].text.trim();
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const result = JSON.parse(text);

  // Strip dubbele streepjes en overbodige markdown uit tekstvelden
  const cleanText = (t) => (t || '')
    .replace(/\u2014|\u2013/g, ', ')  // em-dash (—) en en-dash (–) → komma
    .replace(/(-{2,}|_{2,}|\*{2,})/g, '')  // --- __ ** horizontale regels
    .replace(/\*\*(.*?)\*\*/g, '$1')  // **bold** → plain
    .replace(/\*(.*?)\*/g, '$1')      // *italic* → plain
    .replace(/^\s*[-*]\s+/gm, '')     // bullet points
    .replace(/\n{3,}/g, '\n\n')       // meerdere lege regels → max 2
    .replace(/\s+([,;:.!?])/g, '$1')  // spatie vóór leesteken verwijderen
    .trim();

  if (result.introduction) result.introduction = cleanText(result.introduction);

  // Verrijk aanbevelingen met correcte data uit WooCommerce (nooit van Claude)
  const wineIndex = Object.fromEntries(wines.map(w => [w.id, w]));
  result.recommendations = result.recommendations.map(r => {
    const wine = wineIndex[r.product_id] || {};
    return {
      ...r,
      name:              wine.name  || r.name || '',
      price:             wine.price || '',
      url:               wine.url   || '',
      add_to_cart_url:   wine.add_to_cart_url || '',
      image:             wine.image || '',
      why:               cleanText(r.why),
      grape_explanation: cleanText(r.grape_explanation),
    };
  });

  // Vivino-scores parallel ophalen
  const vivinoResults = await Promise.all(
    result.recommendations.map(r => {
      const wine = wineIndex[r.product_id] || {};
      return fetchVivinoRating(r.name, wine.vivinoVintageId, wine.vivinoWineId);
    })
  );
  result.recommendations = result.recommendations.map((r, i) => ({
    ...r,
    vivino: vivinoResults[i] || null,
  }));

  return result;
}

/* ════════════════════════════════════════════════════════
   Vivino OAuth + rating lookup
════════════════════════════════════════════════════════ */

// Token cache — voorkomt onnodige OAuth-aanroepen
let vivinoTokenCache  = { token: null, expiresAt: 0 };
let vivinoTokenPromise = null;   // voorkomt dubbele fetches bij parallel gebruik

async function getVivinoToken() {
  const { VIVINO_CLIENT_ID, VIVINO_CLIENT_SECRET } = process.env;
  if (!VIVINO_CLIENT_ID || !VIVINO_CLIENT_SECRET) {
    console.log('ℹ️  Vivino: geen CLIENT_ID/SECRET in .env');
    return null;
  }

  // Gebruik gecachte token als die nog 60 seconden geldig is
  if (vivinoTokenCache.token && Date.now() < vivinoTokenCache.expiresAt - 60_000) {
    return vivinoTokenCache.token;
  }

  // Voorkom dubbele fetches bij parallelle aanroepen
  if (vivinoTokenPromise) return vivinoTokenPromise;

  vivinoTokenPromise = (async () => {
  try {
    const { VIVINO_USERNAME, VIVINO_PASSWORD } = process.env;
    if (!VIVINO_USERNAME || !VIVINO_PASSWORD) {
      console.log('ℹ️  Vivino: geen USERNAME/PASSWORD in .env');
      return null;
    }

    const res = await fetch('https://api.vivino.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'password',
        client_id:     VIVINO_CLIENT_ID,
        client_secret: VIVINO_CLIENT_SECRET,
        username:      VIVINO_USERNAME,
        password:      VIVINO_PASSWORD,
      }),
    });

    console.log(`🍇 Vivino OAuth status: ${res.status}`);
    if (!res.ok) {
      const errText = await res.text();
      console.error(`⚠️  Vivino OAuth fout: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    // Vivino geeft 'expires' als Unix timestamp of 'expires_in' als seconden
    const expiresAt = data.expires
      ? data.expires * 1000
      : Date.now() + (data.expires_in ?? 3600) * 1000;

    vivinoTokenCache = { token: data.access_token, expiresAt };
    console.log('✅ Vivino token opgehaald');
    return vivinoTokenCache.token;
  } catch (err) {
    console.warn(`⚠️  Vivino OAuth fout: ${err.message}`);
    return null;
  } finally {
    vivinoTokenPromise = null;
  }
  })();
  return vivinoTokenPromise;
}

async function vivinoSearch(token, query) {
  // Probeer meerdere endpoint-varianten
  const endpoints = [
    `https://api.vivino.com/wines/search?q=${encodeURIComponent(query)}&limit=1`,
    `https://api.vivino.com/wines/search?query=${encodeURIComponent(query)}&limit=1`,
    `https://api.vivino.com/search?q=${encodeURIComponent(query)}&limit=1`,
    `https://api.vivino.com/explore?q=${encodeURIComponent(query)}&limit=1`,
  ];

  for (const url of endpoints) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const raw = await res.text();
    console.log(`🍇 [${res.status}] ${url.replace('https://api.vivino.com','')}`);
    console.log(`🍇 Response: ${raw.slice(0, 150)}`);
    if (!res.ok) continue;
    try {
      const data = JSON.parse(raw);
      const wine = data?.wines?.[0] || data?.records?.[0] || data?.results?.[0] || data?.[0];
      if (wine) return wine;
    } catch { continue; }
  }
  return null;
}

// Genereer steeds kortere zoekvarianten van de naam
function searchVariants(name) {
  const clean = name.replace(/\s+\d{4}$/, '').trim(); // strip jaartal
  const words = clean.split(/\s+/);
  const variants = [clean];
  // Voeg progressief kortere versies toe: laatste woord weglaten
  for (let i = words.length - 1; i >= 2; i--) {
    variants.push(words.slice(0, i).join(' '));
  }
  return [...new Set(variants)];
}

async function fetchVivinoRating(wineName, vintageId = null, wineId = null) {
  const token = await getVivinoToken();
  if (!token) return null;

  try {
    // Voorkeursmethode: directe lookup via vintage-ID (opgeslagen in WooCommerce meta)
    if (vintageId) {
      const res = await fetch(`https://api.vivino.com/vintages/${vintageId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const stats = data.statistics || {};
        const score = stats.ratings_average ?? null;
        const count = stats.ratings_count  ?? null;
        if (score) {
          console.log(`✅ Vivino vintage-ID ${vintageId} voor "${wineName}": ${score} (${count} ratings)`);
          return {
            score: parseFloat(score).toFixed(1),
            count: count ? Number(count).toLocaleString('nl-NL') : null,
          };
        }
      } else {
        console.log(`⚠️  Vivino vintages/${vintageId} status ${res.status}`);
      }
    }

    // Tweede optie: directe lookup via wijn-ID
    if (wineId) {
      const res = await fetch(`https://api.vivino.com/wines/${wineId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const stats = data.statistics || data.stats || {};
        const score = stats.ratings_average ?? stats.average ?? null;
        const count = stats.ratings_count  ?? stats.count   ?? null;
        if (score) {
          console.log(`✅ Vivino wijn-ID ${wineId} voor "${wineName}": ${score} (${count} ratings)`);
          return {
            score: parseFloat(score).toFixed(1),
            count: count ? Number(count).toLocaleString('nl-NL') : null,
          };
        }
      }
    }

    // Fallback: zoek op naam
    for (const variant of searchVariants(wineName)) {
      const wine = await vivinoSearch(token, variant);
      if (!wine) continue;

      const stats = wine.statistics || wine.stats || {};
      const score = stats.ratings_average ?? stats.average ?? null;
      const count = stats.ratings_count  ?? stats.count   ?? null;

      if (!score) continue;
      console.log(`✅ Vivino naam-match voor "${wineName}" via "${variant}": ${score} (${count} ratings)`);
      return {
        score: parseFloat(score).toFixed(1),
        count: count ? Number(count).toLocaleString('nl-NL') : null,
      };
    }
    console.log(`ℹ️  Vivino: geen match voor "${wineName}"`);
    return null;
  } catch (err) {
    console.warn(`⚠️  Vivino lookup mislukt voor "${wineName}": ${err.message}`);
    return null;
  }
}

/* ════════════════════════════════════════════════════════
   Route
════════════════════════════════════════════════════════ */
app.post('/advies', async (req, res) => {
  try {
    const preferences = req.body;

    if (!preferences.wijntype || !preferences.occasion || !preferences.food) {
      return res.status(400).json({ error: 'Wijntype, gelegenheid en gerecht zijn verplicht' });
    }

    console.log(`📥 Verzoek: ${preferences.wijntype} | ${preferences.occasion} | ${preferences.food} | budget €${preferences.budget}`);

    const wines = await fetchWines();

    console.log('🤖 Claude aanroepen...');
    const result = await getRecommendations(preferences, wines);
    console.log(`✅ ${result.recommendations?.length || 0} aanbevelingen teruggestuurd`);

    res.json(result);
  } catch (err) {
    console.error('❌ Fout:', err.message);
    console.error(err.stack);
    res.status(500).json({ error: 'Interne fout', detail: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

/* ════════════════════════════════════════════════════════
   Vivino-koppeling beheer
════════════════════════════════════════════════════════ */

// GET /vivino-koppelen/producten — alle producten met Vivino-status
app.get('/vivino-koppelen/producten', async (_req, res) => {
  try {
    const { WC_URL, WC_KEY, WC_SECRET } = process.env;
    const credentials = Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString('base64');
    const base = WC_URL.replace(/\/$/, '');

    // Haal alle producten op (meerdere pagina's)
    let allProducts = [];
    for (let page = 1; page <= 10; page++) {
      const r = await fetch(
        `${WC_URL}/wp-json/wc/v3/products?per_page=100&status=publish&page=${page}`,
        { headers: { Authorization: `Basic ${credentials}` } }
      );
      if (!r.ok) break;
      const batch = await r.json();
      if (!batch.length) break;
      allProducts = allProducts.concat(batch);
      if (batch.length < 100) break;
    }

    const producten = allProducts.map(p => {
      const sommelierMeta = p.meta_data?.find(m => m.key === '_sommelier_vivino_id')?.value || '';
      const vivinoWidget  = p.meta_data?.find(m => m.key === 'vivino_widget')?.value || '';
      const { vintageId, wineId } = parseVivinoIds(sommelierMeta || vivinoWidget);
      const gekoppeldVia = sommelierMeta ? 'sommelier' : (vivinoWidget ? 'widget' : null);
      return {
        id:        p.id,
        name:      p.name,
        url:       p.permalink?.replace(/^https?:\/\/[^/]+/, base),
        gekoppeld: !!(vintageId || wineId),
        gekoppeldVia,
        vintageId,
        wineId,
      };
    });

    // Sorteer: ongekoppeld eerst, daarna alfabetisch
    producten.sort((a, b) => {
      if (a.gekoppeld !== b.gekoppeld) return a.gekoppeld ? 1 : -1;
      return a.name.localeCompare(b.name, 'nl');
    });

    res.json(producten);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /vivino-koppelen/opslaan — sla Vivino-koppeling op in WooCommerce
app.post('/vivino-koppelen/opslaan', async (req, res) => {
  try {
    const { productId, vivinoInput } = req.body;
    if (!productId) return res.status(400).json({ error: 'productId ontbreekt' });

    const { WC_URL, WC_KEY, WC_SECRET } = process.env;
    const credentials = Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString('base64');

    // Verifieer dat het een geldig Vivino-ID of URL is
    const { vintageId, wineId } = parseVivinoIds(vivinoInput || '');
    if (!vintageId && !wineId) {
      return res.status(400).json({ error: 'Geen geldig Vivino-ID of URL herkend' });
    }

    // Haal eventueel de rating op ter verificatie
    let rating = null;
    const token = await getVivinoToken();
    if (token) {
      rating = await fetchVivinoRating('', vintageId, wineId);
    }

    // Sla op in WooCommerce meta — probeer PUT, dan POST als fallback
    const wcBody = JSON.stringify({
      meta_data: [
        { key: '_sommelier_vivino_id',    value: vivinoInput.trim() },
        { key: '_sommelier_vivino_score', value: rating ? String(rating.score) : '' },
        { key: '_sommelier_vivino_count', value: rating ? String(rating.count) : '' },
      ],
    });
    const wcHeaders = {
      Authorization:  `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    };

    let wcRes = await fetch(`${WC_URL}/wp-json/wc/v3/products/${productId}`, {
      method: 'PUT', headers: wcHeaders, body: wcBody,
    });

    // Sommige servers blokkeren PUT — probeer POST met method-override
    if (!wcRes.ok) {
      wcRes = await fetch(`${WC_URL}/wp-json/wc/v3/products/${productId}`, {
        method: 'POST',
        headers: { ...wcHeaders, 'X-HTTP-Method-Override': 'PUT' },
        body: wcBody,
      });
    }

    if (!wcRes.ok) {
      const errText = await wcRes.text();
      return res.status(500).json({ error: `WooCommerce fout (${wcRes.status}): ${errText.slice(0, 200)}` });
    }

    console.log(`✅ Vivino gekoppeld: product ${productId} → vintageId=${vintageId} wineId=${wineId}`);
    res.json({ ok: true, vintageId, wineId, rating });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════════════════════════════════════════
   Vivino score refresh — automatisch elke nacht + handmatig
════════════════════════════════════════════════════════ */

let refreshRunning = false;

async function refreshVivinoScores() {
  if (refreshRunning) {
    console.log('⏭️  Vivino refresh al actief, overgeslagen');
    return { skipped: true };
  }
  refreshRunning = true;

  const { WC_URL, WC_KEY, WC_SECRET } = process.env;
  if (!WC_URL || !WC_KEY || !WC_SECRET) {
    refreshRunning = false;
    console.log('⏭️  Vivino refresh: geen WooCommerce-gegevens');
    return { skipped: true };
  }

  console.log('🔄 Vivino score refresh gestart…');
  const credentials = Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString('base64');
  const wcHeaders = {
    Authorization:  `Basic ${credentials}`,
    'Content-Type': 'application/json',
    Accept:         'application/json',
  };

  let updated = 0, skipped = 0, failed = 0;

  try {
    // Haal alle producten op
    let allProducts = [];
    for (let page = 1; page <= 10; page++) {
      const r = await fetch(
        `${WC_URL}/wp-json/wc/v3/products?per_page=100&status=publish&page=${page}`,
        { headers: { Authorization: `Basic ${credentials}` } }
      );
      if (!r.ok) break;
      const batch = await r.json();
      if (!batch.length) break;
      allProducts = allProducts.concat(batch);
      if (batch.length < 100) break;
    }

    // Filter op producten met een Vivino-koppeling
    const gekoppeld = allProducts.filter(p => {
      const sommelier = p.meta_data?.find(m => m.key === '_sommelier_vivino_id')?.value || '';
      const widget    = p.meta_data?.find(m => m.key === 'vivino_widget')?.value || '';
      const { vintageId, wineId } = parseVivinoIds(sommelier || widget);
      return !!(vintageId || wineId);
    });

    console.log(`🍇 ${gekoppeld.length} gekoppelde producten gevonden — scores bijwerken…`);

    for (const p of gekoppeld) {
      try {
        const sommelier = p.meta_data?.find(m => m.key === '_sommelier_vivino_id')?.value || '';
        const widget    = p.meta_data?.find(m => m.key === 'vivino_widget')?.value || '';
        const { vintageId, wineId } = parseVivinoIds(sommelier || widget);

        const rating = await fetchVivinoRating(p.name, vintageId, wineId);
        if (!rating) { skipped++; continue; }

        const wcBody = JSON.stringify({
          meta_data: [
            { key: '_sommelier_vivino_score', value: String(rating.score) },
            { key: '_sommelier_vivino_count', value: rating.count ? String(rating.count) : '' },
          ],
        });

        let wcRes = await fetch(`${WC_URL}/wp-json/wc/v3/products/${p.id}`, {
          method: 'PUT', headers: wcHeaders, body: wcBody,
        });
        if (!wcRes.ok) {
          wcRes = await fetch(`${WC_URL}/wp-json/wc/v3/products/${p.id}`, {
            method: 'POST',
            headers: { ...wcHeaders, 'X-HTTP-Method-Override': 'PUT' },
            body: wcBody,
          });
        }

        if (wcRes.ok) {
          console.log(`  ✅ ${p.name}: ${rating.score} (${rating.count ?? '?'} beoordelingen)`);
          updated++;
        } else {
          console.warn(`  ⚠️  ${p.name}: WooCommerce opslaan mislukt (${wcRes.status})`);
          failed++;
        }

        // Kleine pauze om de API niet te overbelasten
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.warn(`  ⚠️  ${p.name}: ${err.message}`);
        failed++;
      }
    }

    const samenvatting = `🏁 Vivino refresh klaar — ${updated} bijgewerkt, ${skipped} overgeslagen, ${failed} mislukt`;
    console.log(samenvatting);
    return { updated, skipped, failed, total: gekoppeld.length };
  } catch (err) {
    console.error(`❌ Vivino refresh fout: ${err.message}`);
    return { error: err.message };
  } finally {
    refreshRunning = false;
  }
}

// Handmatig endpoint: POST /vivino-refresh
app.post('/vivino-refresh', async (_req, res) => {
  const result = await refreshVivinoScores();
  res.json(result);
});

// Automatisch: elke nacht om 03:00
function scheduleNightlyRefresh() {
  const now   = new Date();
  const next  = new Date();
  next.setHours(3, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next - now;
  console.log(`⏰ Volgende Vivino refresh: ${next.toLocaleString('nl-NL')}`);
  setTimeout(() => {
    refreshVivinoScores();
    setInterval(refreshVivinoScores, 24 * 60 * 60 * 1000); // daarna elke 24u
  }, delay);
}

app.listen(port, () => {
  console.log(`Sommelier proxy draait op http://localhost:${port}`);
  console.log(`Endpoint: POST http://localhost:${port}/advies`);
  scheduleNightlyRefresh();
});

/* ════════════════════════════════════════════════════════
   Helpers
════════════════════════════════════════════════════════ */

/**
 * Haal Vivino-IDs op uit meerdere invoerformaten:
 *  - Volledige widget-HTML  → data-vivino-vintage-id + /w/{id}
 *  - Vivino-URL             → /w/{wine_id}
 *  - Los getal              → behandel als vintageId
 */
function parseVivinoIds(input) {
  if (!input) return { vintageId: null, wineId: null };
  const s = input.trim();

  // Widget-HTML: data-vivino-vintage-id="12345"
  const vintageHtmlMatch = s.match(/data-vivino-vintage-id="(\d+)"/);
  // URL of HTML: /w/12345
  const wineUrlMatch = s.match(/\/w\/(\d+)/);
  // Los getal
  const bareNumberMatch = /^\d+$/.test(s) ? s : null;

  return {
    vintageId: vintageHtmlMatch ? vintageHtmlMatch[1] : (bareNumberMatch || null),
    wineId:    wineUrlMatch    ? wineUrlMatch[1]    : null,
  };
}
function sweetnessWord(v) {
  if (v <= 3) return 'droog';
  if (v <= 5) return 'halfdroog';
  if (v <= 7) return 'halfzoet';
  return 'zoet';
}
function bodyWord(v) {
  if (v <= 2) return 'licht';
  if (v <= 4) return 'medium-licht';
  if (v <= 6) return 'medium';
  if (v <= 8) return 'medium-vol';
  return 'vol & krachtig';
}
function tanninWord(v) {
  if (v <= 3) return 'zacht & fris';
  if (v <= 5) return 'licht tanninrijk';
  if (v <= 7) return 'stevig tanninrijk';
  return 'robuust & krachtig';
}

/* ════════════════════════════════════════════════════════
   Demo-assortiment (actief als WooCommerce niet geconfigureerd is)
════════════════════════════════════════════════════════ */
const DEMO_WINES = [
  {
    id: 1, name: 'Domaine Sigalas Assyrtiko Santorini', price: '24.95',
    url: '#', add_to_cart_url: '#',
    attributes: { druivenras: 'Assyrtiko', regio: 'Santorini', kleur: 'Wit', smaakprofiel: 'Droog, mineraal, citrus, hoge zuurgraad' },
    tags: ['droog', 'mineraal', 'wit', 'Santorini'],
    short_description: 'Iconische witte wijn van het vulkanische Santorini. Fris, zoutig en complex.',
  },
  {
    id: 2, name: 'Kir-Yianni Xinomavro Naoussa', price: '18.50',
    url: '#', add_to_cart_url: '#',
    attributes: { druivenras: 'Xinomavro', regio: 'Naoussa, Noord-Griekenland', kleur: 'Rood', smaakprofiel: 'Droog, hoge tannines, kers, tomaat' },
    tags: ['droog', 'tanninrijk', 'rood', 'Naoussa'],
    short_description: 'De "Barolo van Griekenland". Elegant en complex met een lange afdronk.',
  },
  {
    id: 3, name: 'Gaia Wines Moschofilero', price: '14.95',
    url: '#', add_to_cart_url: '#',
    attributes: { druivenras: 'Moschofilero', regio: 'Mantineia, Peloponnesos', kleur: 'Wit', smaakprofiel: 'Droog, bloemig, fris, licht' },
    tags: ['droog', 'fris', 'wit', 'aromatisch'],
    short_description: 'Licht en aromatisch met rozenwater en citrusbloesem. Uitstekend als aperitief.',
  },
  {
    id: 4, name: 'Alpha Estate Malagousia', price: '16.50',
    url: '#', add_to_cart_url: '#',
    attributes: { druivenras: 'Malagousia', regio: 'Florina, Noord-Griekenland', kleur: 'Wit', smaakprofiel: 'Droog, exotisch fruit, jasmijn, vol' },
    tags: ['droog', 'aromatisch', 'vol', 'wit'],
    short_description: 'Bijna uitgestorven druif, herontdekt door Alpha Estate. Exotisch en vol van smaak.',
  },
  {
    id: 5, name: 'Boutari Naoussa Xinomavro Rosé', price: '13.95',
    url: '#', add_to_cart_url: '#',
    attributes: { druivenras: 'Xinomavro', regio: 'Naoussa', kleur: 'Rosé', smaakprofiel: 'Droog, aardbei, granaatappel, fris' },
    tags: ['droog', 'rosé', 'fris', 'zomer'],
    short_description: 'Levendige droge rosé met rood fruit. Perfect voor de zomer.',
  },
  {
    id: 6, name: 'Tsantali Rapsani Reserve', price: '19.95',
    url: '#', add_to_cart_url: '#',
    attributes: { druivenras: 'Xinomavro, Krassato, Stavroto', regio: 'Rapsani, Thessalië', kleur: 'Rood', smaakprofiel: 'Droog, kruiden, donker fruit, zijdezacht' },
    tags: ['droog', 'rood', 'krachtig', 'Olympus'],
    short_description: 'Gebotteld aan de voet van de Olympus. Drie inheemse druiven in perfecte harmonie.',
  },
];
