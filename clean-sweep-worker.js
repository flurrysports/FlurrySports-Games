/**
 * Clean Sweep — Daily Puzzle Generator
 * Cloudflare Worker with scheduled cron trigger
 *
 * Cron: 0 8 * * *  (8:00 AM UTC = midnight Pacific Standard / 1:00 AM Pacific Daylight)
 * For exact midnight Pacific, use: 0 8 * * * (PST) or 0 7 * * * (PDT)
 * Cloudflare doesn't support dynamic cron, so set to 8 UTC which covers midnight PST.
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
      // Preview without saving — for testing
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
  // Count recent usage
  const recent = usedSports.slice(0, 20);
  const counts = {};
  SPORT_WEIGHTS.forEach(s => counts[s.sport] = 0);
  recent.forEach(s => { if (counts[s] !== undefined) counts[s]++; });

  // Weighted random with penalty for overuse
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
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function generateAndStore(env) {
  const today = getPacificDateString();
  const log = [];

  try {
    // 1. Check if today's puzzle already exists
    const existing = await sbFetch(env, 'GET',
      `/rest/v1/clean_sweep_puzzles?date=eq.${today}&select=id`);
    if (existing.length > 0) {
      return { status: 'skipped', reason: 'Puzzle already exists', date: today };
    }

    // 2. Fetch last 120 puzzles for no-repeat check
    const recent = await sbFetch(env, 'GET',
      `/rest/v1/clean_sweep_puzzles?select=prompt,sport_category&order=date.desc&limit=120`);
    const usedPrompts = recent.map(p => p.prompt);
    const usedSports  = recent.map(p => p.sport_category);
    log.push(`Found ${usedPrompts.length} recent puzzles to avoid`);

    // 3. Pick sport based on distribution
    const chosenSport = pickSport(usedSports);
    log.push(`Chosen sport: ${chosenSport}`);

    // 4. Generate with Claude
    log.push('Generating puzzle with Claude...');
    const puzzle = await generatePuzzle(env, usedPrompts, chosenSport);
    log.push(`Prompt: "${puzzle.prompt}"`);
    log.push(`Correct (${puzzle.correct_tiles.length}): ${puzzle.correct_tiles.join(', ')}`);
    log.push(`Decoys (${puzzle.decoy_tiles.length}): ${puzzle.decoy_tiles.join(', ')}`);

    // 5. Validate counts
    if (puzzle.correct_tiles.length < 4 || puzzle.correct_tiles.length > 7) {
      throw new Error(`Bad correct count: ${puzzle.correct_tiles.length}`);
    }
    if (puzzle.correct_tiles.length + puzzle.decoy_tiles.length !== 9) {
      throw new Error(`Total tiles must = 9, got ${puzzle.correct_tiles.length + puzzle.decoy_tiles.length}`);
    }

    // 6. Self-verify — up to 3 total attempts
    log.push('Verifying answers with Claude...');
    const verified = await verifyPuzzle(env, puzzle);
    if (!verified.passed) {
      log.push(`Attempt 1 failed: ${verified.issues.join('; ')}`);
      log.push('Regenerating (attempt 2)...');
      const puzzle2 = await generatePuzzle(env, usedPrompts, chosenSport, verified.issues);
      const verified2 = await verifyPuzzle(env, puzzle2);
      if (!verified2.passed) {
        log.push(`Attempt 2 failed: ${verified2.issues.join('; ')}`);
        log.push('Regenerating (attempt 3)...');
        const puzzle3 = await generatePuzzle(env, usedPrompts, chosenSport, verified2.issues);
        const verified3 = await verifyPuzzle(env, puzzle3);
        if (!verified3.passed) {
          log.push('All 3 attempts failed — storing attempt 3 with verification_flag for admin review');
          puzzle3.verification_flag = verified3.issues.join('; ');
          return await storePuzzle(env, today, puzzle3, log);
        }
        log.push('Attempt 3 verification passed ✓');
        return await storePuzzle(env, today, puzzle3, log);
      }
      log.push('Attempt 2 verification passed ✓');
      return await storePuzzle(env, today, puzzle2, log);
    }
    log.push('Attempt 1 verification passed ✓');
    return await storePuzzle(env, today, puzzle, log);

  } catch (err) {
    return { status: 'error', error: err.message, date: today, log };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STORE PUZZLE
// ─────────────────────────────────────────────────────────────────────────────
async function storePuzzle(env, date, puzzle, log) {
  const tiles_shuffled = shuffle([
    ...puzzle.correct_tiles.map(n => ({ name: n, correct: true })),
    ...puzzle.decoy_tiles.map(n => ({ name: n, correct: false }))
  ]);

  await sbFetch(env, 'POST', '/rest/v1/clean_sweep_puzzles', {
    date,
    prompt:           puzzle.prompt,
    sport_category:   puzzle.sport_category,
    difficulty:       puzzle.difficulty || 'medium',
    correct_tiles:    puzzle.correct_tiles,
    decoy_tiles:      puzzle.decoy_tiles,
    tiles_shuffled,
    edge_case_note:   puzzle.edge_case_note || null,
    verification_flag: puzzle.verification_flag || null,
    created_at:       new Date().toISOString()
  });

  log.push(`Stored puzzle for ${date}`);
  return { status: 'success', date, puzzle, log };
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

TILE RULES:
- 4 to 7 correct answers (players who genuinely meet the criterion)
- Enough decoys to total exactly 9 tiles (9 minus correct count)
- Decoys: famous players from same sport/era who do NOT meet criterion — tempt users into wrong picks
- ALWAYS include at least one edge case: a player who barely qualifies (won the award only once, was on the team only 1 season, hit exactly the minimum stat threshold, etc.)

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
  return puzzle;
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY PUZZLE — strict independent fact-check
// ─────────────────────────────────────────────────────────────────────────────
async function verifyPuzzle(env, puzzle) {
  const system = `You are an extremely strict sports fact-checker. You are reviewing puzzles built by someone else and your job is to FIND ERRORS. 
Be skeptical. Do not give the benefit of the doubt. If you are not 100% certain a claim is true, flag it.
You know that puzzle generators frequently make mistakes with:
- Players who are close but don't quite meet a threshold
- Players who qualify for a similar but different criterion
- Stats that are slightly off (e.g. "3 titles" when they won 4, or confusing regular season vs playoff stats)
- Players who qualified at one point but the prompt implies a current or specific timeframe
Return ONLY valid JSON. No markdown, no backticks.`;

  const allTiles = [
    ...puzzle.correct_tiles.map(n => ({ name: n, claimed: 'CORRECT — should qualify' })),
    ...puzzle.decoy_tiles.map(n => ({ name: n, claimed: 'DECOY — should NOT qualify' }))
  ];

  const user = `Fact-check this sports trivia puzzle. Be critical and look for errors.

PROMPT: "${puzzle.prompt}"
SPORT: ${puzzle.sport_category}

For each player below, independently determine whether they meet the criterion in the prompt.
Do NOT trust the label — verify from your own knowledge.

${allTiles.map((t, i) => `${i+1}. ${t.name} (labeled: ${t.claimed})`).join('\n')}

Rules:
- Mark as WRONG if a player labeled CORRECT actually does NOT meet the criterion
- Mark as WRONG if a player labeled DECOY actually DOES meet the criterion  
- If you are less than 90% confident about any player, mark it UNCERTAIN
- Be especially careful about edge cases and exact thresholds

Return this exact JSON (no other text):
{
  "results": [
    {
      "name": "Player Name",
      "labeled_correct": true,
      "actually_qualifies": true,
      "verdict": "OK" | "WRONG" | "UNCERTAIN",
      "reason": "one sentence explanation — required for WRONG or UNCERTAIN"
    }
  ],
  "passed": true,
  "issues": []
}

Set "passed" to false if ANY result has verdict "WRONG".
Set "passed" to false if MORE THAN ONE result has verdict "UNCERTAIN".
List all problems in "issues" array.`;

  const raw = await claudeCall(env, system, user, 1500);
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  
  let result;
  try {
    result = JSON.parse(cleaned);
  } catch(e) {
    throw new Error(`Verification JSON parse failed: ${e.message}. Raw: ${raw.substring(0, 200)}`);
  }

  // Extra safety: re-check passed flag ourselves based on results array
  // Don't trust Claude's self-reported passed value alone
  if (result.results) {
    const wrongs = result.results.filter(r => r.verdict === 'WRONG');
    const uncertains = result.results.filter(r => r.verdict === 'UNCERTAIN');
    if (wrongs.length > 0 || uncertains.length > 1) {
      result.passed = false;
      result.issues = [
        ...wrongs.map(r => `WRONG: ${r.name} — ${r.reason}`),
        ...uncertains.map(r => `UNCERTAIN: ${r.name} — ${r.reason}`),
        ...(result.issues || [])
      ];
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLAUDE API CALL
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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.content[0].text.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE HELPER
// ─────────────────────────────────────────────────────────────────────────────
async function sbFetch(env, method, path, body = null) {
  const res = await fetch(env.SUPABASE_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Prefer': method === 'POST' ? 'return=representation' : ''
    },
    body: body ? JSON.stringify(body) : null
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${method} ${path}: ${res.status} — ${err.slice(0, 200)}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function getPacificDateString() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const dstStart = new Date(Date.UTC(y, 2, 14 - (new Date(Date.UTC(y, 2, 1)).getUTCDay() + 6) % 7, 10));
  const dstEnd   = new Date(Date.UTC(y, 10, 7 - (new Date(Date.UTC(y, 10, 1)).getUTCDay() + 6) % 7, 9));
  const offsetMs = (now >= dstStart && now < dstEnd ? -7 : -8) * 60 * 60 * 1000;
  const pacific = new Date(now.getTime() + offsetMs);
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
