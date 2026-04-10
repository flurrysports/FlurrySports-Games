/**
 * Daily Quiz Generator — Cloudflare Worker
 * Generates a fresh sports trivia quiz every day at midnight Pacific.
 *
 * Cron: 0 8 * * *  (8:00 AM UTC = midnight Pacific Standard Time)
 *
 * Environment variables (set in Cloudflare dashboard as Secrets):
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
      const quiz = await generateQuiz(env, [], null);
      return new Response(JSON.stringify(quiz, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('Daily Quiz generator. GET /generate to run, GET /preview to test without saving.');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(generateAndStore(env));
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// THEME POOL — rotates across sports, never repeats themes in the last 30 days
// ─────────────────────────────────────────────────────────────────────────────
const ALL_THEMES = [
  // NFL
  'NFL Legends', 'Super Bowl History', 'NFL Draft History', 'NFL MVPs',
  'NFL Quarterbacks', 'NFL Running Backs', 'NFL Wide Receivers', 'NFL Defensive Greats',
  'NFL Coaches', 'NFL Records & Milestones', 'NFL Playoff History', 'AFC Teams & History',
  'NFC Teams & History', 'NFL Rule Oddities', 'NFL All-Time Stats',
  // NBA
  'NBA Legends', 'NBA Championship History', 'NBA MVP History', 'NBA Draft History',
  'NBA Records & Milestones', 'NBA All-Star History', 'NBA Coaches', 'NBA Teams & History',
  'NBA Rookies of the Year', 'NBA Defensive Greats', 'NBA Scoring Titles',
  // MLB
  'MLB Legends', 'World Series History', 'MLB Hall of Fame', 'MLB Records',
  'MLB Pitching Greats', 'MLB Home Run History', 'No-Hitters & Perfect Games',
  // NHL
  'NHL Legends', 'Stanley Cup History', 'NHL Records', 'Hart Trophy Winners',
  // College Football
  'Heisman Trophy History', 'College Football Dynasties', 'CFP & BCS History',
  'College Football Coaches', 'Famous College Football Rivalries',
  // College Basketball
  'March Madness History', 'NCAA Champions', 'College Basketball Legends',
  // Multi-sport
  'Olympic Sports History', 'Sports Records Across All Sports',
  'Famous Sports Moments', 'Sports Hall of Fame Trivia',
  'Athletes Who Switched Sports', 'Sports Nicknames',
  'Jersey Numbers & Their Legends', 'Sports Firsts',
];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function generateAndStore(env) {
  const today = getPacificDateString();
  const log = [];

  try {
    // 1. Check if today's quiz already exists
    const existing = await sbFetch(env, 'GET',
      `/rest/v1/daily_quizzes?date=eq.${today}&select=date`);
    if (existing.length > 0) {
      return { status: 'skipped', reason: 'Quiz already exists for today', date: today };
    }

    // 2. Fetch recent themes to avoid repeats
    const recent = await sbFetch(env, 'GET',
      `/rest/v1/daily_quizzes?select=theme&order=date.desc&limit=30`);
    const usedThemes = recent.map(q => q.theme);
    log.push(`Avoiding ${usedThemes.length} recent themes`);

    // 3. Pick a theme not used recently
    const available = ALL_THEMES.filter(t => !usedThemes.includes(t));
    const themePool = available.length > 0 ? available : ALL_THEMES;
    const chosenTheme = themePool[Math.floor(Math.random() * themePool.length)];
    log.push(`Chosen theme: ${chosenTheme}`);

    // 4. Generate quiz
    log.push('Generating quiz with Claude...');
    const quiz = await generateQuiz(env, usedThemes, chosenTheme);
    log.push(`Generated ${quiz.questions.length} questions on theme: ${quiz.theme}`);

    // 5. Validate
    if (!quiz.questions || quiz.questions.length !== 5) {
      throw new Error(`Expected 5 questions, got ${quiz.questions?.length}`);
    }
    for (const q of quiz.questions) {
      if (!q.q || !q.o || q.o.length !== 4 || typeof q.c !== 'number') {
        throw new Error(`Invalid question format: ${JSON.stringify(q)}`);
      }
    }

    // 6. Store
    await sbFetch(env, 'POST', '/rest/v1/daily_quizzes', {
      date: today,
      theme: quiz.theme,
      emoji: quiz.emoji,
      questions: quiz.questions,
      created_at: new Date().toISOString()
    });

    log.push(`Stored quiz for ${today}`);
    return { status: 'success', date: today, quiz, log };

  } catch (err) {
    return { status: 'error', error: err.message, date: today, log };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE QUIZ VIA CLAUDE
// ─────────────────────────────────────────────────────────────────────────────
async function generateQuiz(env, usedThemes, forcedTheme) {
  const avoidNote = usedThemes.length > 0
    ? `\n\nDo NOT reuse these recent themes: ${usedThemes.slice(0, 20).join(', ')}`
    : '';

  const themeNote = forcedTheme
    ? `Use this theme: "${forcedTheme}"`
    : 'Pick any sports theme not in the avoid list.';

  const system = `You are a sports trivia quiz designer for a daily sports app called FlurrySports. 
You generate fresh, fun, accurate 5-question multiple choice quizzes on sports topics.
Return ONLY valid JSON. No markdown, no backticks, no preamble.`;

  const user = `Generate one daily sports trivia quiz.

RULES:
1. ${themeNote}
2. Exactly 5 questions on that theme
3. Each question has exactly 4 answer options
4. Questions should vary in difficulty: 2 easy (most fans know), 2 medium (true fans know), 1 hard (only superfans know)
5. All facts must be 100% accurate and verifiable
6. Questions must be clearly about the theme — no random tangents
7. Do not repeat question styles (don't ask "who won X" 5 times)${avoidNote}

Return this exact JSON structure:
{
  "theme": "Exact theme name",
  "emoji": "One relevant emoji",
  "questions": [
    {
      "q": "Question text",
      "o": ["Option A", "Option B", "Option C", "Option D"],
      "c": 0
    }
  ]
}

Where "c" is the zero-based index of the correct answer in the "o" array.
Return only the JSON object, nothing else.`;

  const raw = await claudeCall(env, system, user, 1200);
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

  let quiz;
  try {
    quiz = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Failed to parse Claude JSON: ${e.message}. Raw: ${raw.substring(0, 300)}`);
  }

  if (!quiz.theme || !quiz.questions || !Array.isArray(quiz.questions)) {
    throw new Error(`Invalid quiz structure: ${JSON.stringify(quiz).substring(0, 200)}`);
  }

  return quiz;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
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

function getPacificDateString() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const dstStart = new Date(Date.UTC(y, 2, 14 - (new Date(Date.UTC(y, 2, 1)).getUTCDay() + 6) % 7, 10));
  const dstEnd   = new Date(Date.UTC(y, 10, 7 - (new Date(Date.UTC(y, 10, 1)).getUTCDay() + 6) % 7, 9));
  const offsetMs = (now >= dstStart && now < dstEnd ? -7 : -8) * 60 * 60 * 1000;
  return new Date(now.getTime() + offsetMs).toISOString().slice(0, 10);
}
