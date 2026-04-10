/**
 * Who's That, Player? — AI Daily Player Generator
 * Cloudflare Worker
 *
 * Cron: 0 8 * * *  (8:00 AM UTC = midnight Pacific)
 *
 * Secrets needed:
 *   ANTHROPIC_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/generate') {
      const result = await generateAndStore(env);
      return new Response(JSON.stringify(result, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/preview') {
      const player = await generatePlayer(env);
      const photo  = await resolvePhotoUrl(player);
      return new Response(JSON.stringify({ player, photo }, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, time: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('WTP Worker\n  GET /generate\n  GET /preview\n  GET /health');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(generateAndStore(env));
  }
};

async function generateAndStore(env) {
  const today = getPacificDateString();
  const log   = [];

  try {
    const existing = await sbFetch(env, 'GET', `/rest/v1/wtp_daily?date=eq.${today}&select=date`);
    if (existing.length > 0) return { status: 'skipped', reason: 'Already exists', date: today };

    const recent = await sbFetch(env, 'GET', `/rest/v1/wtp_daily?select=player_name,league&order=date.desc&limit=14`);
    const recentNames = recent.map(r => r.player_name);
    log.push(`Avoiding: ${recentNames.join(', ') || 'none'}`);

    let player = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      log.push(`Attempt ${attempt}...`);
      try {
        player = await generatePlayer(env, recentNames);
        log.push(`Generated: ${player.name} (${player.league})`);
        break;
      } catch (e) {
        log.push(`Attempt ${attempt} failed: ${e.message}`);
        if (attempt === 3) throw new Error('All 3 generation attempts failed');
      }
    }

    const photoUrl = await resolvePhotoUrl(player);
    log.push(`Photo: ${photoUrl || 'none'}`);

    await sbFetch(env, 'POST', '/rest/v1/wtp_daily', {
      date:        today,
      player_json: player,
      photo_url:   photoUrl,
      league:      player.league,
      player_name: player.name,
      created_at:  new Date().toISOString()
    });

    log.push(`Stored for ${today}`);
    return { status: 'success', date: today, player: player.name, league: player.league, photoUrl, log };

  } catch (err) {
    return { status: 'error', error: err.message, date: today, log };
  }
}

async function generatePlayer(env, recentNames = []) {
  // Weighted league: 55% NFL, 30% NBA, 15% MLB
  const roll   = Math.random();
  const league = roll < 0.55 ? 'NFL' : roll < 0.85 ? 'NBA' : 'MLB';

  const avoidStr = recentNames.length > 0
    ? `\nDo NOT pick any of these recently used players: ${recentNames.join(', ')}`
    : '';

  const system = `You are a sports trivia clue writer for a daily "Who's That, Player?" guessing game.
You pick a real, well-known, currently active ${league} player and write 5 progressive clues from vague to specific.
Return ONLY valid JSON. No markdown, no backticks, no extra text.`;

  const user = `Pick one well-known, currently active ${league} player and write 5 clues.
Clue 1 = vague (position/conference only, not guessable alone).
Clue 5 = very specific signature fact that makes the answer obvious.${avoidStr}

You MUST include accurate numeric IDs for photo lookup:
- ALL leagues: espnId (from espn.com/nfl/player/_/id/XXXXX or similar)
- NBA only: also include nbaId (NBA.com person ID)
- MLB only: also include mlbId (MLB.com person ID)

Return this exact JSON (omit nbaId/mlbId if not applicable):
{
  "name": "Full Player Name",
  "league": "${league}",
  "espnId": "12345",
  "nbaId": "12345",
  "mlbId": "12345",
  "pos": "QB",
  "team": "Team Name",
  "college": "School or International",
  "drafted": "2020 · 1st · Pick 5",
  "clues": [
    {"label": "Position", "text": "..."},
    {"label": "College", "text": "..."},
    {"label": "Draft", "text": "..."},
    {"label": "Award", "text": "..."},
    {"label": "Signature", "text": "..."}
  ]
}

Return only the JSON, nothing else.`;

  const raw     = await claudeCall(env, system, user, 800);
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

  let player;
  try { player = JSON.parse(cleaned); }
  catch (e) { throw new Error(`JSON parse failed: ${e.message}. Raw: ${raw.substring(0, 300)}`); }

  if (!player.name || !player.league || !player.clues || player.clues.length !== 5) {
    throw new Error(`Invalid player structure: ${JSON.stringify(player).substring(0, 200)}`);
  }
  if (!player.espnId) throw new Error(`Missing espnId for ${player.name}`);

  return player;
}

async function resolvePhotoUrl(player) {
  for (const url of getPhotoCandidates(player)) {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FlurrySports/1.0)', 'Accept': 'image/*' }
      });
      if (res.ok && res.status === 200) return url;
    } catch (_) {}
  }
  return null;
}

function getPhotoCandidates(player) {
  const league = (player.league || '').toUpperCase();

  if (league === 'NBA') {
    const id = player.nbaId || player.espnId;
    return [
      `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`,
      `https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`,
      `https://a.espncdn.com/i/headshots/nba/players/full/${player.espnId}.png`
    ];
  }

  if (league === 'MLB') {
    const mlbId = player.mlbId || player.espnId;
    return [
      `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${mlbId}/headshot/67/current`,
      `https://a.espncdn.com/i/headshots/mlb/players/full/${player.espnId}.png`
    ];
  }

  // NFL
  return [
    `https://a.espncdn.com/i/headshots/nfl/players/full/${player.espnId}.png`,
    `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${player.espnId}.png&w=350&h=254`
  ];
}

async function claudeCall(env, system, user, maxTokens = 800) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`); }
  const data = await res.json();
  return data.content[0].text.trim();
}

async function sbFetch(env, method, path, body = null) {
  const res = await fetch(env.SUPABASE_URL + path, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':         env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Prefer':         method === 'POST' ? 'return=representation' : ''
    },
    body: body ? JSON.stringify(body) : null
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`Supabase ${method} ${path}: ${res.status} — ${err.slice(0, 300)}`); }
  return res.json();
}

function getPacificDateString() {
  const now = new Date();
  const y   = now.getUTCFullYear();
  const dstStart = new Date(Date.UTC(y, 2, 14 - (new Date(Date.UTC(y, 2, 1)).getUTCDay() + 6) % 7, 10));
  const dstEnd   = new Date(Date.UTC(y, 10, 7 - (new Date(Date.UTC(y, 10, 1)).getUTCDay() + 6) % 7, 9));
  const offsetMs = (now >= dstStart && now < dstEnd ? -7 : -8) * 3600000;
  return new Date(now.getTime() + offsetMs).toISOString().slice(0, 10);
}
