/**
 * Clean Sweep — Daily Puzzle Generator
 * Cloudflare Worker with scheduled cron trigger
 *
 * Cron: 0 8 * * *  (8:00 AM UTC = midnight Pacific Standard / 1:00 AM Pacific Daylight)
 *
 * Environment variables (set in Cloudflare dashboard, never commit values):
 *   ANTHROPIC_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/generate') {
      const result = await generateAndStore(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname === '/preview') {
      const result = await generatePuzzle(env, []);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('Clean Sweep generator. GET /generate to run, GET /preview to test without saving.');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(generateAndStore(env));
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SPORT DISTRIBUTION OVER 120 DAYS
// NFL: ~35%, NBA: ~35%, CFB: ~12%, CBB: ~12%, NHL: ~6%
// ─────────────────────────────────────────────────────────────────────────────
const SPORT_WEIGHTS = [
  { sport: 'NFL',                weight: 35 },
  { sport: 'NBA',                weight: 35 },
  { sport: 'College Football',   weight: 12 },
  { sport: 'College Basketball', weight: 12 },
  { sport: 'NHL',                weight: 6  },
];

function pickSport(usedSports) {
  const recent = usedSports.slice(0, 20);
  const counts = {};
  SPORT_WEIGHTS.forEach(s => counts[s.sport] = 0);
  recent.forEach(s => { if (counts[s] !== undefined) counts[s]++; });
  const adjusted = SPORT_WEIGHTS.map(s => ({
    sport: s.sport,
    weight: Math.max(1, s.weight - counts[s.sport] * 3)
  }));
  const total = adjusted.reduce((sum, s) => sum + s.weight, 0);
  let rand = Math.random() * total;
  for (const s of adjusted) {
    rand -= s.weight;
    if (rand <= 0) return s.sport;
  }
  return 'NFL';
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN — fills the next 30 days as drafts, generates as many as needed
// ─────────────────────────────────────────────────────────────────────────────
async function generateAndStore(env) {
  const today = getPacificDateString();
  const log = [];
  const results = [];

  try {
    // Find which dates in the next 30 days are missing puzzles
    const future = getDateString(30);
    const existing = await sbFetch(env, 'GET',
      `/rest/v1/clean_sweep_puzzles?date=gte.${today}&date=lte.${future}&select=date&order=date.asc`);
    const existingDates = new Set(existing.map(r => r.date));

    const missingDates = [];
    for (let i = 0; i < 30; i++) {
      const d = getDateString(i);
      if (!existingDates.has(d)) missingDates.push(d);
    }

    log.push(`Existing puzzles in next 30 days: ${existingDates.size}`);
    log.push(`Missing dates: ${missingDates.length}`);

    if (missingDates.length === 0) {
      return { status: 'skipped', reason: 'All 30 days already have puzzles', log };
    }

    // Fetch recent puzzles for no-repeat check
    const recent = await sbFetch(env, 'GET',
      `/rest/v1/clean_sweep_puzzles?select=prompt,sport_category&order=date.desc&limit=120`);
    const usedPrompts = recent.map(p => p.prompt);
    const usedSports  = recent.map(p => p.sport_category);
    log.push(`Avoiding ${usedPrompts.length} recent prompts`);

    // Generate one puzzle per missing date
    for (const date of missingDates) {
      log.push(`\n--- Generating for ${date} ---`);
      try {
        const chosenSport = pickSport(usedSports);
        log.push(`Sport: ${chosenSport}`);

        let puzzle = null;
        let verFlag = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
          log.push(`Attempt ${attempt}...`);
          try {
            puzzle = await generatePuzzle(env, usedPrompts, chosenSport, attempt > 1 ? [`Previous attempt ${attempt-1} failed verification`] : []);
            const verified = await verifyPuzzle(env, puzzle);
            if (verified.passed) {
              log.push(`Verified OK on attempt ${attempt}`);
              verFlag = null;
              break;
            } else {
              log.push(`Verification failed: ${verified.issues.join('; ')}`);
              verFlag = verified.issues.join('; ');
              if (attempt === 3) {
                puzzle.verification_flag = verFlag;
              }
            }
          } catch (e) {
            log.push(`Attempt ${attempt} error: ${e.message}`);
            if (attempt === 3) throw e;
          }
        }

        await storePuzzle(env, date, puzzle, log);
        usedPrompts.unshift(puzzle.prompt);
        usedSports.unshift(puzzle.sport_category);
        results.push({ date, status: 'created', prompt: puzzle.prompt, flagged: !!puzzle.verification_flag });

      } catch (err) {
        log.push(`Failed for ${date}: ${err.message}`);
        results.push({ date, status: 'error', error: err.message });
      }
    }

    return { status: 'success', generated: results.filter(r => r.status === 'created').length, results, log };

  } catch (err) {
    return { status: 'error', error: err.message, log };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STORE PUZZLE — always as draft for admin review
// ─────────────────────────────────────────────────────────────────────────────
async function storePuzzle(env, date, puzzle, log) {
  const tiles_shuffled = shuffle([
    ...puzzle.correct_tiles.map(n => ({ name: n, correct: true })),
    ...puzzle.decoy_tiles.map(n => ({ name: n, correct: false }))
  ]);

  await sbFetch(env, 'POST', '/rest/v1/clean_sweep_puzzles?on_conflict=date', {
    date,
    prompt:            puzzle.prompt,
    sport_category:    puzzle.sport_category,
    difficulty:        puzzle.difficulty || 'medium',
    correct_tiles:     puzzle.correct_tiles,
    decoy_tiles:       puzzle.decoy_tiles,
    tiles_shuffled,
    edge_case_note:    puzzle.edge_case_note || null,
    verification_flag: puzzle.verification_flag || null,
    status:            'draft',
    created_at:        new Date().toISOString()
  });

  log.push(`Stored draft for ${date}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE PUZZLE
// ─────────────────────────────────────────────────────────────────────────────
async function generatePuzzle(env, usedPrompts, forceSport = null, priorIssues = []) {
  const sportNote = forceSport
    ? `You MUST use this sport: ${forceSport}`
    : 'Pick a sport from the distribution rules.';

  const issueNote = priorIssues.length > 0
    ? `\n\nA previous attempt had these issues — avoid them:\n${priorIssues.map(i => `- ${i}`).join('\n')}`
    : '';

  const avoidList = usedPrompts.length > 0
    ? `\n\nDO NOT repeat or closely duplicate any of these recent prompts:\n${usedPrompts.slice(0, 50).map((p,i) => `${i+1}. ${p}`).join('\n')}`
    : '';

  const system = `You are a sports trivia puzzle designer for "Clean Sweep," a daily game where users pick players from a 3×3 grid. Some tiles are correct (match the prompt), some are decoys. A wrong pick loses ALL points, so decoys must be believable but verifiably wrong to a knowledgeable fan. Return ONLY valid JSON. No markdown, no backticks, no explanation.`;

  const user = `Design one Clean Sweep daily puzzle following every rule exactly.

SPORT DISTRIBUTION:
${sportNote}
- NFL and NBA together = ~70% of puzzles over time
- College Football and College Basketball = ~20%
- NHL = ~10% (NHL prompts must be about major awards: Hart Trophy, Vezina, Norris, Conn Smythe, Art Ross, or Stanley Cup wins)

PROMPT RULES:
- Must be a single factual, verifiable criterion with a clear yes/no answer per player
- Prefer criteria that are well-documented and unambiguous (championships won, awards received, teams played for, draft position)
- AVOID criteria that depend on subjective thresholds or could be disputed
- AVOID prompts about "career stats" where exact numbers matter — stick to milestones and records that are clearly documented
- For NHL only: limit to top awards (Hart, Vezina, Norris, Conn Smythe, Art Ross) or Stanley Cup wins

ACCURACY RULES — THIS IS CRITICAL:
- Only include a player as CORRECT if you are 100% certain they meet the criterion
- If you are even slightly unsure about a player, make them a DECOY instead
- Double-check edge cases: a player on a championship team may not have been the "starting" player, a player may have won an award in a different season than you think
- Do not confuse similar players, similar team names, or similar award names
- When in doubt, leave a player out of the correct list

COMPLETENESS RULES:
- AVOID prompts where the full answer set is too large or hard to enumerate
- PREFER prompts with a bounded, well-known answer set
- If you cannot confidently verify every name you include, choose a different prompt

TILE RULES:
- 4 to 7 correct answers (players who genuinely meet the criterion)
- Enough decoys to total exactly 9 tiles (9 minus correct count)
- Decoys: famous players from same sport/era who do NOT meet criterion — tempt users into wrong picks
- ALWAYS include at least one edge case: a player who barely qualifies

DIFFICULTY SCALING within each puzzle:
- 1–2 obvious correct answers (all-time legends clearly qualify)
- 2–3 medium (well-known players, fans might second-guess)
- 1–2 hard or edge case (only true fans know, or barely qualifies)
- Decoys: stars from same era who are CLOSE but don't qualify${avoidList}${issueNote}

Return this exact JSON:
{
  "prompt": "string shown to player",
  "sport_category": "NFL" | "NBA" | "College Football" | "College Basketball" | "NHL",
  "difficulty": "easy" | "medium" | "hard",
  "correct_tiles": ["Name1", "Name2", ...],
  "decoy_tiles": ["Decoy1", "Decoy2", ...],
  "edge_case_note": "Explain which answer barely qualifies and why",
  "reasoning": "Brief note on why each decoy is tempting but wrong"
}`;

  const raw = await claudeCall(env, system, user, 1200);
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const puzzle = JSON.parse(cleaned);

  const required = ['prompt','sport_category','correct_tiles','decoy_tiles','edge_case_note'];
  for (const f of required) {
    if (!puzzle[f]) throw new Error(`Missing field: ${f}`);
  }
  if (!Array.isArray(puzzle.correct_tiles) || !Array.isArray(puzzle.decoy_tiles)) {
    throw new Error('Tile fields must be arrays');
  }
  if (puzzle.correct_tiles.length < 4 || puzzle.correct_tiles.length > 7) {
    throw new Error(`Bad correct count: ${puzzle.correct_tiles.length}`);
  }
  if (puzzle.correct_tiles.length + puzzle.decoy_tiles.length !== 9) {
    throw new Error(`Total tiles must = 9, got ${puzzle.correct_tiles.length + puzzle.decoy_tiles.length}`);
  }
  return puzzle;
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY PUZZLE
// ─────────────────────────────────────────────────────────────────────────────
async function verifyPuzzle(env, puzzle) {
  const system = `You are an extremely strict sports fact-checker. For each person listed, answer a single yes/no question based solely on the prompt criterion. Be precise — do not guess. If you are not 100% certain, answer "uncertain".
Return ONLY valid JSON. No markdown, no backticks.`;

  const allTiles = [
    ...puzzle.correct_tiles.map(n => ({ name: n, labeled: 'correct' })),
    ...puzzle.decoy_tiles.map(n => ({ name: n, labeled: 'decoy' }))
  ];

  const user = `For each person below, independently answer: does this person meet the criterion?

CRITERION: "${puzzle.prompt}"
SPORT: ${puzzle.sport_category}

${allTiles.map((t, i) => `${i+1}. ${t.name}`).join('\n')}

For each person, answer only:
- "yes" — they definitely meet the criterion
- "no" — they definitely do NOT meet the criterion
- "uncertain" — you are not 100% sure

Do NOT consider how they are labeled. Judge each independently based only on the criterion.

Return this exact JSON:
{
  "checks": [
    {
      "name": "Person Name",
      "labeled": "correct" | "decoy",
      "qualifies": "yes" | "no" | "uncertain",
      "reason": "one short sentence"
    }
  ]
}`;

  const raw = await claudeCall(env, system, user, 1500);
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

  let result;
  try { result = JSON.parse(cleaned); }
  catch(e) { throw new Error(`Verification JSON parse failed: ${e.message}. Raw: ${raw.substring(0, 200)}`); }

  const checks = result.checks || [];
  const issues = [];
  let passed = true;

  const uncertain = checks.filter(c => c.qualifies === 'uncertain').map(c => c.name);
  puzzle.correct_tiles = puzzle.correct_tiles.filter(n => !uncertain.includes(n));
  puzzle.decoy_tiles   = puzzle.decoy_tiles.filter(n => !uncertain.includes(n));

  for (const c of checks) {
    if (c.qualifies === 'yes' && c.labeled === 'decoy') {
      puzzle.decoy_tiles   = puzzle.decoy_tiles.filter(n => n !== c.name);
      if (!puzzle.correct_tiles.includes(c.name)) puzzle.correct_tiles.push(c.name);
      issues.push(`FIXED: moved ${c.name} from decoy to correct — ${c.reason}`);
    } else if (c.qualifies === 'no' && c.labeled === 'correct') {
      puzzle.correct_tiles = puzzle.correct_tiles.filter(n => n !== c.name);
      if (!puzzle.decoy_tiles.includes(c.name)) puzzle.decoy_tiles.push(c.name);
      issues.push(`FIXED: moved ${c.name} from correct to decoy — ${c.reason}`);
    }
  }

  const correctCount = puzzle.correct_tiles.length;
  const total = puzzle.correct_tiles.length + puzzle.decoy_tiles.length;

  if (correctCount < 4) { issues.push(`Too few correct answers after verification: ${correctCount} (need 4-7)`); passed = false; }
  else if (correctCount > 7) { issues.push(`Too many correct answers after verification: ${correctCount} (need 4-7)`); passed = false; }
  if (total !== 9) { issues.push(`Total tiles after verification: ${total} (need exactly 9)`); passed = false; }
  if (uncertain.length > 2) { issues.push(`Too many uncertain items (${uncertain.length}) — regenerate with a clearer prompt`); passed = false; }

  return { passed, issues, checks };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLAUDE API
// ─────────────────────────────────────────────────────────────────────────────
async function claudeCall(env, system, user, maxTokens = 1000) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`); }
  const data = await res.json();
  return data.content[0].text.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE
// ─────────────────────────────────────────────────────────────────────────────
async function sbFetch(env, method, path, body = null) {
  const res = await fetch(env.SUPABASE_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Prefer': method === 'POST' ? 'return=representation,resolution=merge-duplicates' : ''
    },
    body: body ? JSON.stringify(body) : null
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`Supabase ${method} ${path}: ${res.status} — ${err.slice(0, 300)}`); }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function getPacificDateString() {
  return getDateString(0);
}

function getDateString(daysAhead) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const dstStart = new Date(Date.UTC(y, 2, 14 - (new Date(Date.UTC(y, 2, 1)).getUTCDay() + 6) % 7, 10));
  const dstEnd   = new Date(Date.UTC(y, 10, 7 - (new Date(Date.UTC(y, 10, 1)).getUTCDay() + 6) % 7, 9));
  const offsetMs = (now >= dstStart && now < dstEnd ? -7 : -8) * 60 * 60 * 1000;
  const pacific = new Date(now.getTime() + offsetMs + daysAhead * 24 * 60 * 60 * 1000);
  return pacific.toISOString().slice(0, 10);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
