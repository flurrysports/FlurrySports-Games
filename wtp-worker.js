/**
 * Who's That, Player? — Daily Player Generator
 * Cloudflare Worker
 *
 * Runs every night at midnight Pacific. Picks tomorrow's player,
 * validates their photo URL server-side, and stores everything in
 * Supabase so the frontend never has to guess at CDN patterns.
 *
 * Cron: 0 8 * * *  (8:00 AM UTC = midnight Pacific Standard Time)
 *
 * Environment variables — add as Secrets in Cloudflare dashboard:
 *   SUPABASE_URL         https://your-project.supabase.co
 *   SUPABASE_SERVICE_KEY  your Supabase service role key (NOT the anon key)
 *
 * No Anthropic key needed — player selection is deterministic, not AI-generated.
 */

export default {
  // Manual trigger via HTTP for testing
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/generate') {
      const result = await generateAndStore(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/preview') {
      const player = getDailyPlayer(getPacificDateString());
      const photo  = await resolvePhotoUrl(player);
      return new Response(JSON.stringify({ player, photo }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, time: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(
      'WTP Worker\n  GET /generate  — run generation and save to Supabase\n  GET /preview   — preview today\'s player without saving\n  GET /health    — health check'
    );
  },

  // Automatic cron trigger
  async scheduled(event, env, ctx) {
    ctx.waitUntil(generateAndStore(env));
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN GENERATION FUNCTION
// ─────────────────────────────────────────────────────────────────────────────
async function generateAndStore(env) {
  const today = getPacificDateString();
  const log   = [];

  try {
    // 1. Check if today already exists — skip if so
    const existing = await sbFetch(env, 'GET',
      `/rest/v1/wtp_daily?date=eq.${today}&select=date`);
    if (existing.length > 0) {
      return { status: 'skipped', reason: 'Player already exists for today', date: today };
    }

    // 2. Pick today's player using the same deterministic shuffle as the frontend
    const player = getDailyPlayer(today);
    log.push(`Selected: ${player.name} (${player.league})`);

    // 3. Validate and resolve the best working photo URL
    const photoUrl = await resolvePhotoUrl(player);
    log.push(`Photo URL resolved: ${photoUrl || 'none — will use placeholder'}`);

    // 4. Store in Supabase
    await sbFetch(env, 'POST', '/rest/v1/wtp_daily', {
      date:        today,
      player_json: player,
      photo_url:   photoUrl,
      league:      player.league,
      player_name: player.name,
      created_at:  new Date().toISOString()
    });

    log.push(`Stored player for ${today}`);
    return { status: 'success', date: today, player: player.name, league: player.league, photoUrl, log };

  } catch (err) {
    return { status: 'error', error: err.message, date: today, log };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHOTO RESOLUTION — tries each URL server-side, returns first working one
// Server-side requests bypass the hotlink blocking that breaks browser requests
// ─────────────────────────────────────────────────────────────────────────────
async function resolvePhotoUrl(player) {
  const candidates = getPhotoCandidates(player);

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: {
          // Mimic a browser request to avoid CDN bot blocks
          'User-Agent': 'Mozilla/5.0 (compatible; FlurrySports/1.0)',
          'Accept': 'image/webp,image/png,image/*'
        }
      });
      if (res.ok && res.status === 200) {
        return url;
      }
    } catch (_) {
      // Network error for this candidate — try next
    }
  }

  // None worked — return null so frontend can show placeholder
  return null;
}

function getPhotoCandidates(player) {
  if (player.league === 'NBA') {
    const id = player.nbaId || player.espnId;
    return [
      // NBA CDN is reliable and public
      `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`,
      `https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`,
      // ESPN as final fallback — works server-side even though it hotlink-blocks browsers
      `https://a.espncdn.com/i/headshots/nba/players/full/${player.espnId}.png`
    ];
  } else {
    // NFL — ESPN CDN works perfectly server-side
    // static.www.nfl.com is unreliable because it uses NFL.com IDs, not ESPN IDs
    return [
      `https://a.espncdn.com/i/headshots/nfl/players/full/${player.espnId}.png`,
      `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${player.espnId}.png&w=350&h=254`
    ];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER SELECTION — identical deterministic logic to the frontend
// Both must stay in sync so worker and frontend always pick the same player
// ─────────────────────────────────────────────────────────────────────────────
function getDailyPlayer(dateStr) {
  const seed   = parseInt(dateStr.replace(/-/g, ''), 10);
  const jan1   = new Date(dateStr.slice(0, 4) + '-01-01T00:00:00Z');
  const doy    = Math.floor((new Date(dateStr + 'T00:00:00Z') - jan1) / 86400000);
  const useNFL = (doy % 2 === 0);
  const pool   = useNFL ? shufflePool(NFL_PLAYERS, seed + 1) : shufflePool(NBA_PLAYERS, seed + 2);
  const idx    = Math.floor(doy / 2) % pool.length;
  return Object.assign({}, pool[idx], {
    league: useNFL ? 'NFL' : 'NBA',
    id: 'wtp-' + seed
  });
}

function shufflePool(arr, seed) {
  const a = arr.slice();
  let s = seed;
  function rng() { s = (s * 9301 + 49297) % 233280; return s / 233280; }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATE HELPER — DST-aware Pacific time
// ─────────────────────────────────────────────────────────────────────────────
function getPacificDateString() {
  const now = new Date();
  const y   = now.getUTCFullYear();
  // Second Sunday in March at 2am = DST start
  const dstStart = new Date(Date.UTC(y, 2, 14 - (new Date(Date.UTC(y, 2, 1)).getUTCDay() + 6) % 7, 10));
  // First Sunday in November at 2am = DST end
  const dstEnd   = new Date(Date.UTC(y, 10, 7 - (new Date(Date.UTC(y, 10, 1)).getUTCDay() + 6) % 7, 9));
  const offsetMs = (now >= dstStart && now < dstEnd ? -7 : -8) * 3600000;
  return new Date(now.getTime() + offsetMs).toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE HELPER
// ─────────────────────────────────────────────────────────────────────────────
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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${method} ${path}: ${res.status} — ${err.slice(0, 300)}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER DATA — keep this in sync with whos-that-player.html
// ─────────────────────────────────────────────────────────────────────────────
const NFL_PLAYERS = [
  {name:"Patrick Mahomes",espnId:"3139477",pos:"QB",team:"Kansas City Chiefs",college:"Texas Tech",drafted:"2017 · 1st · Pick 10",clues:[{label:"Position",text:"Quarterback in the AFC West"},{label:"College",text:"Played at Texas Tech"},{label:"Draft",text:"10th overall pick in 2017"},{label:"Titles",text:"Multiple Super Bowl wins with Kansas City"},{label:"Award",text:"Won the NFL MVP in just his second season as a starter"}]},
  {name:"Josh Allen",espnId:"3918298",pos:"QB",team:"Buffalo Bills",college:"Wyoming",drafted:"2018 · 1st · Pick 7",clues:[{label:"Position",text:"Quarterback in the AFC East"},{label:"College",text:"Played at Wyoming, was not a top recruit"},{label:"Draft",text:"7th overall pick in 2018"},{label:"Style",text:"Known for elite arm strength and rushing ability"},{label:"Leader",text:"Rebuilt the Buffalo Bills into consistent playoff contenders"}]},
  {name:"Jalen Hurts",espnId:"4040715",pos:"QB",team:"Philadelphia Eagles",college:"Alabama/Oklahoma",drafted:"2020 · 2nd · Pick 53",clues:[{label:"Position",text:"Quarterback in the NFC East"},{label:"College",text:"Started at Alabama, transferred to Oklahoma"},{label:"Draft",text:"53rd overall pick in 2020"},{label:"Rise",text:"Won the starting job from Carson Wentz in his rookie year"},{label:"Season",text:"Led the Eagles to the Super Bowl in the 2022 season"}]},
  {name:"Lamar Jackson",espnId:"3916387",pos:"QB",team:"Baltimore Ravens",college:"Louisville",drafted:"2018 · 1st · Pick 32",clues:[{label:"Position",text:"Quarterback in the AFC North"},{label:"College",text:"Won the Heisman Trophy at Louisville"},{label:"Draft",text:"32nd pick — last in the first round in 2018"},{label:"Award",text:"Won the NFL MVP in 2019 and 2023"},{label:"Style",text:"Revolutionized the QB position with his rushing ability"}]},
  {name:"Joe Burrow",espnId:"3915511",pos:"QB",team:"Cincinnati Bengals",college:"LSU",drafted:"2020 · 1st · Pick 1",clues:[{label:"Position",text:"Quarterback in the AFC North"},{label:"College",text:"Won the Heisman Trophy and National Championship at LSU"},{label:"Draft",text:"#1 overall pick in 2020"},{label:"Rise",text:"Led Cincinnati to the Super Bowl in just his second season"},{label:"Injury",text:"Has dealt with significant injuries throughout his career"}]},
  {name:"Justin Jefferson",espnId:"4262921",pos:"WR",team:"Minnesota Vikings",college:"LSU",drafted:"2020 · 1st · Pick 22",clues:[{label:"Position",text:"Wide Receiver in the NFC North"},{label:"College",text:"Played at LSU alongside Joe Burrow"},{label:"Draft",text:"22nd overall pick in 2020"},{label:"Record",text:"Set the NFL record for receiving yards in a player's first two seasons"},{label:"Award",text:"Won the NFL Offensive Player of the Year in 2022"}]},
  {name:"Tyreek Hill",espnId:"3054188",pos:"WR",team:"Miami Dolphins",college:"West Alabama",drafted:"2016 · 5th · Pick 165",clues:[{label:"Position",text:"Wide Receiver in the AFC East"},{label:"College",text:"Played at West Alabama after being dismissed from Oklahoma State"},{label:"Draft",text:"5th round pick in 2016"},{label:"Nickname",text:"Known as Cheetah for his elite speed"},{label:"Trade",text:"Was traded from Kansas City to Miami in 2022"}]},
  {name:"Travis Kelce",espnId:"15847",pos:"TE",team:"Kansas City Chiefs",college:"Cincinnati",drafted:"2013 · 3rd · Pick 63",clues:[{label:"Position",text:"Tight End in the AFC West"},{label:"College",text:"Played at the University of Cincinnati"},{label:"Draft",text:"63rd overall pick in 2013"},{label:"Records",text:"The most prolific receiving tight end in NFL history"},{label:"Titles",text:"Multiple Super Bowl championships with the Chiefs"}]},
  {name:"Nick Bosa",espnId:"3728263",pos:"DE",team:"San Francisco 49ers",college:"Ohio State",drafted:"2019 · 1st · Pick 2",clues:[{label:"Position",text:"Defensive End in the NFC West"},{label:"College",text:"Played at Ohio State before a foot injury ended his season early"},{label:"Draft",text:"2nd overall pick in 2019"},{label:"Award",text:"Won the NFL Defensive Player of the Year in 2022"},{label:"Family",text:"His father and brother both played in the NFL"}]},
  {name:"T.J. Watt",espnId:"3052876",pos:"LB",team:"Pittsburgh Steelers",college:"Wisconsin",drafted:"2017 · 1st · Pick 30",clues:[{label:"Position",text:"Linebacker in the AFC North"},{label:"College",text:"Played at Wisconsin"},{label:"Draft",text:"30th overall pick in 2017"},{label:"Record",text:"Tied the all-time NFL sack record in a single season"},{label:"Award",text:"Won the NFL Defensive Player of the Year award"}]},
  {name:"Davante Adams",espnId:"16737",pos:"WR",team:"New York Jets",college:"Fresno State",drafted:"2014 · 2nd · Pick 53",clues:[{label:"Position",text:"Wide Receiver in the AFC East"},{label:"College",text:"Played at Fresno State"},{label:"Draft",text:"53rd overall pick in 2014"},{label:"Partnership",text:"One of the best WR-QB duos with Aaron Rodgers in Green Bay"},{label:"Trade",text:"Was traded to the Raiders to reunite with his college QB"}]},
  {name:"CeeDee Lamb",espnId:"4259545",pos:"WR",team:"Dallas Cowboys",college:"Oklahoma",drafted:"2020 · 1st · Pick 17",clues:[{label:"Position",text:"Wide Receiver in the NFC East"},{label:"College",text:"Played at Oklahoma"},{label:"Draft",text:"17th overall pick in 2020"},{label:"Surprise",text:"Fell to Dallas due to off-field concerns, considered a steal"},{label:"Season",text:"Broke the Cowboys single-season receiving record in 2023"}]},
  {name:"Stefon Diggs",espnId:"2980453",pos:"WR",team:"Houston Texans",college:"Maryland",drafted:"2015 · 5th · Pick 145",clues:[{label:"Position",text:"Wide Receiver in the AFC South"},{label:"College",text:"Played at Maryland"},{label:"Draft",text:"5th round pick in 2015"},{label:"Miracle",text:"Caught the Minneapolis Miracle in the 2017 NFC playoffs"},{label:"Trade",text:"Was traded from Minnesota to Buffalo in 2020"}]},
  {name:"Micah Parsons",espnId:"4569618",pos:"LB",team:"Dallas Cowboys",college:"Penn State",drafted:"2021 · 1st · Pick 12",clues:[{label:"Position",text:"Linebacker in the NFC East"},{label:"College",text:"Played at Penn State"},{label:"Draft",text:"12th overall pick in 2021"},{label:"Rookie",text:"Was a Defensive Rookie of the Year finalist in 2021"},{label:"Versatility",text:"Lines up as both a linebacker and edge rusher"}]},
  {name:"Cooper Kupp",espnId:"3054220",pos:"WR",team:"Los Angeles Rams",college:"Eastern Washington",drafted:"2017 · 3rd · Pick 69",clues:[{label:"Position",text:"Wide Receiver in the NFC West"},{label:"College",text:"Came from small-school Eastern Washington"},{label:"Draft",text:"69th overall pick in 2017"},{label:"Season",text:"Had one of the greatest receiving seasons in NFL history in 2021"},{label:"Award",text:"Won the Super Bowl MVP and Triple Crown in 2021"}]},
  {name:"Quenton Nelson",espnId:"3915400",pos:"G",team:"Indianapolis Colts",college:"Notre Dame",drafted:"2018 · 1st · Pick 6",clues:[{label:"Position",text:"Offensive Guard in the AFC South"},{label:"College",text:"Played at Notre Dame"},{label:"Draft",text:"6th overall pick in 2018"},{label:"Debut",text:"Made the Pro Bowl in his rookie season"},{label:"Style",text:"Known for his rare ability to pull and lead block at his size"}]},
  {name:"Darius Leonard",espnId:"3051922",pos:"LB",team:"Indianapolis Colts",college:"South Carolina State",drafted:"2018 · 2nd · Pick 36",clues:[{label:"Position",text:"Linebacker in the AFC South"},{label:"College",text:"Came from South Carolina State, an HBCU"},{label:"Draft",text:"36th overall pick in 2018"},{label:"Rookie",text:"Won Defensive Rookie of the Year in 2018"},{label:"Nickname",text:"Known as the Maniac for his relentless play style"}]},
  {name:"Demario Davis",espnId:"14975",pos:"LB",team:"New Orleans Saints",college:"Arkansas State",drafted:"2012 · 3rd · Pick 77",clues:[{label:"Position",text:"Linebacker in the NFC South"},{label:"College",text:"Played at Arkansas State"},{label:"Draft",text:"3rd round pick in 2012"},{label:"Longevity",text:"Has been a consistent Pro Bowler well into his 30s"},{label:"Leadership",text:"Known as one of the most respected team leaders in the league"}]},
  {name:"Dalvin Cook",espnId:"3054245",pos:"RB",team:"Free Agent",college:"Florida State",drafted:"2017 · 2nd · Pick 41",clues:[{label:"Position",text:"Running Back, most recently with the Jets"},{label:"College",text:"Played at Florida State"},{label:"Draft",text:"41st overall pick in 2017"},{label:"Injury",text:"Suffered a torn ACL in his rookie season"},{label:"Peak",text:"Had back-to-back 1,000+ yard seasons for the Vikings"}]},
  {name:"Austin Ekeler",espnId:"3054246",pos:"RB",team:"Free Agent",college:"Western Colorado",drafted:"Undrafted 2017",clues:[{label:"Position",text:"Running Back, currently a free agent"},{label:"College",text:"Came from Division II Western Colorado, went undrafted"},{label:"Receiving",text:"One of the best pass-catching backs in the NFL"},{label:"Season",text:"Had 20 total touchdowns in the 2022 season"},{label:"Contract",text:"Became a starter after holding out and renegotiating his deal"}]}
];

const NBA_PLAYERS = [
  {name:"LeBron James",espnId:"1966",nbaId:"2544",pos:"SF",team:"Los Angeles Lakers",college:"None (HS)",drafted:"2003 · 1st · Pick 1",clues:[{label:"Position",text:"Small Forward in the Western Conference"},{label:"Draft",text:"#1 pick straight from high school in Akron, Ohio"},{label:"Record",text:"The NBA's all-time leading scorer"},{label:"Championships",text:"4 NBA titles with 3 different franchises"},{label:"Nickname",text:"Known as The King and LBJ"}]},
  {name:"Stephen Curry",espnId:"3975",nbaId:"201939",pos:"PG",team:"Golden State Warriors",college:"Davidson",drafted:"2009 · 1st · Pick 7",clues:[{label:"Position",text:"Point Guard in the Western Conference"},{label:"College",text:"Played at small-school Davidson, wasn't recruited by major programs"},{label:"Draft",text:"7th overall pick in 2009"},{label:"Impact",text:"Transformed basketball with his historic three-point shooting"},{label:"Championships",text:"4 NBA titles, all with the Warriors"}]},
  {name:"Kevin Durant",espnId:"3202",nbaId:"201142",pos:"SF",team:"Phoenix Suns",college:"Texas",drafted:"2007 · 1st · Pick 2",clues:[{label:"Position",text:"Small Forward in the Western Conference"},{label:"College",text:"Played one season at Texas"},{label:"Draft",text:"2nd overall pick in 2007"},{label:"Awards",text:"Multiple scoring titles and an NBA MVP award"},{label:"Championships",text:"Won 2 NBA titles with the Golden State Warriors"}]},
  {name:"Giannis Antetokounmpo",espnId:"3032977",nbaId:"203507",pos:"PF",team:"Milwaukee Bucks",college:"International",drafted:"2013 · 1st · Pick 15",clues:[{label:"Position",text:"Power Forward in the Eastern Conference"},{label:"Origin",text:"Grew up in Greece with Nigerian heritage"},{label:"Nickname",text:"Known as The Greek Freak"},{label:"Championship",text:"Led Milwaukee to their first title in 50 years"},{label:"Awards",text:"Won back-to-back MVP awards in 2019 and 2020"}]},
  {name:"Nikola Jokic",espnId:"3112335",nbaId:"203999",pos:"C",team:"Denver Nuggets",college:"International",drafted:"2014 · 2nd · Pick 41",clues:[{label:"Position",text:"Center in the Western Conference"},{label:"Draft",text:"41st pick - announced during a Taco Bell commercial"},{label:"Awards",text:"3 MVP awards in 4 seasons"},{label:"Championship",text:"Led Denver to their first NBA title in 2023"},{label:"Skill",text:"Considered the greatest passing center in NBA history"}]},
  {name:"Luka Doncic",espnId:"3945274",nbaId:"1629029",pos:"PG",team:"Dallas Mavericks",college:"International",drafted:"2018 · 1st · Pick 3",clues:[{label:"Position",text:"Point Guard in the Western Conference"},{label:"Pre-NBA",text:"Won EuroLeague MVP before coming to the NBA"},{label:"Draft",text:"Drafted by Atlanta, traded to Dallas on draft night"},{label:"Country",text:"Led Slovenia to the Olympics"},{label:"Signature",text:"Known for his step-back three and elite court vision"}]},
  {name:"Joel Embiid",espnId:"3059318",nbaId:"203954",pos:"C",team:"Philadelphia 76ers",college:"Kansas",drafted:"2014 · 1st · Pick 3",clues:[{label:"Position",text:"Center in the Eastern Conference"},{label:"Origin",text:"Grew up in Cameroon, didn't play basketball until his teens"},{label:"Award",text:"Won the 2022-23 NBA MVP"},{label:"Era",text:"The cornerstone of Philadelphia's Process rebuild"},{label:"College",text:"Played one year at Kansas before the draft"}]},
  {name:"Jayson Tatum",espnId:"4065648",nbaId:"1628369",pos:"SF",team:"Boston Celtics",college:"Duke",drafted:"2017 · 1st · Pick 3",clues:[{label:"Position",text:"Small Forward in the Eastern Conference"},{label:"College",text:"One-and-done at Duke"},{label:"Idol",text:"Grew up idolizing Kobe Bryant"},{label:"Finals",text:"Led Boston to back-to-back Finals in 2022 and 2024"},{label:"Championship",text:"Won the 2024 NBA title and Finals MVP"}]},
  {name:"Shai Gilgeous-Alexander",espnId:"4278073",nbaId:"1628983",pos:"PG",team:"Oklahoma City Thunder",college:"Kentucky",drafted:"2018 · 1st · Pick 11",clues:[{label:"Position",text:"Point Guard in the Western Conference"},{label:"College",text:"Played one year at Kentucky"},{label:"Trade",text:"Drafted by Charlotte, came to OKC via the Clippers"},{label:"Country",text:"From Canada, known by his initials SGA"},{label:"Award",text:"Won the 2024-25 NBA MVP"}]},
  {name:"Devin Booker",espnId:"3136195",nbaId:"1626164",pos:"SG",team:"Phoenix Suns",college:"Kentucky",drafted:"2015 · 1st · Pick 13",clues:[{label:"Position",text:"Shooting Guard in the Western Conference"},{label:"College",text:"Played one year at Kentucky"},{label:"Draft",text:"13th overall pick in 2015"},{label:"Record",text:"Scored 70 points in a single game at just 20 years old"},{label:"Olympics",text:"Won a gold medal with Team USA at the Tokyo Olympics"}]},
  {name:"Anthony Edwards",espnId:"4432174",nbaId:"1630162",pos:"SG",team:"Minnesota Timberwolves",college:"Georgia",drafted:"2020 · 1st · Pick 1",clues:[{label:"Position",text:"Shooting Guard in the Western Conference"},{label:"College",text:"One-and-done at the University of Georgia"},{label:"Draft",text:"#1 overall pick in 2020"},{label:"Nickname",text:"Known as Ant-Man"},{label:"Team",text:"Led Minnesota to the Western Conference Finals in 2024"}]},
  {name:"Ja Morant",espnId:"4279888",nbaId:"1629630",pos:"PG",team:"Memphis Grizzlies",college:"Murray State",drafted:"2019 · 1st · Pick 2",clues:[{label:"Position",text:"Point Guard in the Western Conference"},{label:"College",text:"Came from small-school Murray State"},{label:"Award",text:"Won Rookie of the Year in 2019-20"},{label:"Athleticism",text:"Known for some of the most explosive dunks in NBA history"},{label:"Stats",text:"Averaged 25+ points per game during his peak seasons"}]},
  {name:"Damian Lillard",espnId:"6606",nbaId:"203081",pos:"PG",team:"Milwaukee Bucks",college:"Weber State",drafted:"2012 · 1st · Pick 6",clues:[{label:"Position",text:"Point Guard in the Eastern Conference"},{label:"College",text:"Came from mid-major Weber State"},{label:"Draft",text:"6th overall pick in 2012"},{label:"Loyalty",text:"Spent over a decade in Portland before being traded"},{label:"Signature",text:"Known for hitting clutch shots from well beyond the arc"}]},
  {name:"Kawhi Leonard",espnId:"6450",nbaId:"202695",pos:"SF",team:"Los Angeles Clippers",college:"San Diego State",drafted:"2011 · 1st · Pick 15",clues:[{label:"Position",text:"Small Forward in the Western Conference"},{label:"College",text:"Played at San Diego State"},{label:"Championships",text:"Won titles with two different franchises"},{label:"Nickname",text:"Known as The Klaw for his large hands and defensive dominance"},{label:"Award",text:"Won Finals MVP with both of his championship teams"}]},
  {name:"Jimmy Butler",espnId:"6430",nbaId:"202710",pos:"SF",team:"Golden State Warriors",college:"Marquette",drafted:"2011 · 1st · Pick 30",clues:[{label:"Position",text:"Small Forward in the Western Conference"},{label:"College",text:"Played at Marquette"},{label:"Draft",text:"30th pick - last in the first round in 2011"},{label:"Rise",text:"Went from a late first-round pick to a perennial All-Star"},{label:"Style",text:"Known for his unmatched competitiveness and big-game performances"}]},
  {name:"Bam Adebayo",espnId:"4066697",nbaId:"1628389",pos:"C",team:"Miami Heat",college:"Kentucky",drafted:"2017 · 1st · Pick 14",clues:[{label:"Position",text:"Center in the Eastern Conference"},{label:"College",text:"Played one year at Kentucky"},{label:"Draft",text:"14th overall pick in 2017"},{label:"Defense",text:"Won the NBA Defensive Player of the Year award"},{label:"Style",text:"Known for his versatility guarding multiple positions"}]},
  {name:"Karl-Anthony Towns",espnId:"3136195",nbaId:"1626157",pos:"C",team:"New York Knicks",college:"Kentucky",drafted:"2015 · 1st · Pick 1",clues:[{label:"Position",text:"Center in the Eastern Conference"},{label:"College",text:"Played one year at Kentucky"},{label:"Draft",text:"#1 overall pick in 2015"},{label:"Skill",text:"One of the best shooting big men in NBA history"},{label:"Trade",text:"Was traded from Minnesota to New York in 2024"}]},
  {name:"Rudy Gobert",espnId:"3032976",nbaId:"203497",pos:"C",team:"Minnesota Timberwolves",college:"International",drafted:"2013 · 1st · Pick 27",clues:[{label:"Position",text:"Center in the Western Conference"},{label:"Country",text:"From France, known for his elite wingspan"},{label:"Award",text:"Has won Defensive Player of the Year four times"},{label:"Trade",text:"Was traded from Utah to Minnesota for a massive package of picks"},{label:"Nickname",text:"Known as the Stifle Tower"}]},
  {name:"Draymond Green",espnId:"6589",nbaId:"203110",pos:"PF",team:"Golden State Warriors",college:"Michigan State",drafted:"2012 · 2nd · Pick 35",clues:[{label:"Position",text:"Power Forward in the Western Conference"},{label:"College",text:"Played four years at Michigan State"},{label:"Draft",text:"35th pick in 2012"},{label:"Championships",text:"4 NBA titles with Golden State"},{label:"Style",text:"Known more for defense and playmaking than scoring"}]},
  {name:"Klay Thompson",espnId:"6475",nbaId:"202691",pos:"SG",team:"Dallas Mavericks",college:"Washington State",drafted:"2011 · 1st · Pick 11",clues:[{label:"Position",text:"Shooting Guard in the Western Conference"},{label:"College",text:"Played at Washington State"},{label:"Draft",text:"11th overall pick in 2011"},{label:"Record",text:"Once hit 14 three-pointers in a single game"},{label:"Championships",text:"Won 4 NBA titles with the Golden State Warriors"}]},
  {name:"Kyrie Irving",espnId:"6442",nbaId:"202681",pos:"PG",team:"Dallas Mavericks",college:"Duke",drafted:"2011 · 1st · Pick 1",clues:[{label:"Position",text:"Point Guard in the Western Conference"},{label:"College",text:"One-and-done at Duke"},{label:"Draft",text:"#1 overall pick in 2011"},{label:"Championship",text:"Hit the go-ahead three in Game 7 of the 2016 Finals"},{label:"Teams",text:"Has played for Cleveland, Boston, Brooklyn, and Dallas"}]},
  {name:"James Harden",espnId:"3992",nbaId:"201935",pos:"PG",team:"Los Angeles Clippers",college:"Arizona State",drafted:"2009 · 1st · Pick 3",clues:[{label:"Position",text:"Point Guard in the Western Conference"},{label:"College",text:"Played at Arizona State"},{label:"Style",text:"Perfected the step-back three into a signature move"},{label:"Award",text:"Won the NBA MVP award in 2017-18"},{label:"Season",text:"Averaged 36.1 points per game in 2018-19"}]},
  {name:"Zion Williamson",espnId:"4395628",nbaId:"1629627",pos:"PF",team:"New Orleans Pelicans",college:"Duke",drafted:"2019 · 1st · Pick 1",clues:[{label:"Position",text:"Power Forward in the Western Conference"},{label:"College",text:"One-and-done at Duke, was a massive recruit"},{label:"Draft",text:"#1 overall pick in 2019"},{label:"Athleticism",text:"Known for an incredibly rare combination of size and explosiveness"},{label:"Injury",text:"Has been hampered by foot and leg injuries throughout his career"}]},
  {name:"Trae Young",espnId:"4277905",nbaId:"1629027",pos:"PG",team:"Atlanta Hawks",college:"Oklahoma",drafted:"2018 · 1st · Pick 5",clues:[{label:"Position",text:"Point Guard in the Eastern Conference"},{label:"College",text:"Played one year at Oklahoma, led NCAA in scoring"},{label:"Draft",text:"5th pick - traded to Atlanta from Dallas on draft night"},{label:"Signature",text:"Known for deep pull-up threes from 30+ feet out"},{label:"Playoff",text:"Led Atlanta on a Cinderella run to the 2021 ECF"}]},
  {name:"Donovan Mitchell",espnId:"3908809",nbaId:"1628378",pos:"SG",team:"Cleveland Cavaliers",college:"Louisville",drafted:"2017 · 1st · Pick 13",clues:[{label:"Position",text:"Shooting Guard in the Eastern Conference"},{label:"College",text:"Played at Louisville"},{label:"Draft",text:"13th pick - traded to Utah on draft night"},{label:"Nickname",text:"Known as Spida"},{label:"Trade",text:"Was traded from Utah to Cleveland in a blockbuster deal"}]},
  {name:"Victor Wembanyama",espnId:"5104157",nbaId:"1641705",pos:"C",team:"San Antonio Spurs",college:"International",drafted:"2023 · 1st · Pick 1",clues:[{label:"Position",text:"Center in the Western Conference"},{label:"Country",text:"From France, considered the most unique prospect in NBA history"},{label:"Draft",text:"#1 overall pick in 2023"},{label:"Size",text:"Stands over 7 feet tall with an 8-foot wingspan"},{label:"Award",text:"Won Rookie of the Year in 2023-24"}]},
  {name:"Cade Cunningham",espnId:"4432816",nbaId:"1630595",pos:"PG",team:"Detroit Pistons",college:"Oklahoma State",drafted:"2021 · 1st · Pick 1",clues:[{label:"Position",text:"Point Guard in the Eastern Conference"},{label:"College",text:"Played one year at Oklahoma State"},{label:"Draft",text:"#1 overall pick in 2021"},{label:"Role",text:"The face of Detroit's rebuilding franchise"},{label:"Style",text:"Known for his size and playmaking at point guard"}]},
  {name:"Tyrese Haliburton",espnId:"4396993",nbaId:"1630169",pos:"PG",team:"Indiana Pacers",college:"Iowa State",drafted:"2020 · 1st · Pick 12",clues:[{label:"Position",text:"Point Guard in the Eastern Conference"},{label:"College",text:"Played two years at Iowa State"},{label:"Draft",text:"12th overall pick in 2020"},{label:"Trade",text:"Was traded from Sacramento to Indiana in 2022"},{label:"Season",text:"Led the NBA in assists in the 2023-24 season"}]},
  {name:"Alperen Sengun",espnId:"4871144",nbaId:"1631094",pos:"C",team:"Houston Rockets",college:"International",drafted:"2021 · 1st · Pick 16",clues:[{label:"Position",text:"Center in the Western Conference"},{label:"Country",text:"From Turkey, played professionally in Europe before the NBA"},{label:"Draft",text:"16th overall pick in 2021"},{label:"Skill",text:"Known for his elite post moves and passing for a big man"},{label:"Rise",text:"Emerged as an All-Star caliber player in his third NBA season"}]}
];
