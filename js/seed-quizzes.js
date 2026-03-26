// ─── QUIZ SEED DATA ────────────────────────────────────────────────────────
// Run this once in browser console after Supabase is configured,
// OR paste into a <script> tag temporarily on index.html to seed your DB.
// After seeding, remove the script tag.

async function seedAllQuizzes() {
  console.log('Seeding quizzes...');

  const quizzes = [
    // ── NFL MC ──
    {
      quiz: { title: 'NFL Trivia: Test Your Football IQ', description: 'Think you know the NFL? Prove it with 10 challenging football questions.', type: 'multiple_choice', theme: 'NFL', timer_seconds: 20, is_active: true },
      questions: [
        { question_text: 'Who holds the NFL record for most career passing touchdowns?', choices: ['Tom Brady', 'Drew Brees', 'Peyton Manning', 'Brett Favre'], answer: 'Tom Brady', points: 100 },
        { question_text: 'Which team has won the most Super Bowl championships?', choices: ['Dallas Cowboys', 'San Francisco 49ers', 'New England Patriots', 'Pittsburgh Steelers'], answer: 'New England Patriots', points: 100 },
        { question_text: 'Who was the first overall pick in the 2023 NFL Draft?', choices: ['C.J. Stroud', 'Bryce Young', 'Anthony Richardson', 'Will Anderson Jr.'], answer: 'Bryce Young', points: 100 },
        { question_text: 'Which player has the most receiving yards in a single NFL season?', choices: ['Jerry Rice', 'Calvin Johnson', 'Julio Jones', 'Cooper Kupp'], answer: 'Calvin Johnson', points: 100 },
        { question_text: 'What is the penalty for a false start in the NFL?', choices: ['10 yards', '5 yards', '15 yards', '3 yards'], answer: '5 yards', points: 100 },
        { question_text: 'Which NFL team plays their home games at Lambeau Field?', choices: ['Chicago Bears', 'Minnesota Vikings', 'Green Bay Packers', 'Detroit Lions'], answer: 'Green Bay Packers', points: 100 },
        { question_text: 'Who holds the record for most rushing yards in a single NFL season?', choices: ['Barry Sanders', 'Eric Dickerson', 'Adrian Peterson', 'Jamal Lewis'], answer: 'Eric Dickerson', points: 100 },
        { question_text: 'Which quarterback threw the most touchdown passes in a single NFL season?', choices: ['Tom Brady', 'Peyton Manning', 'Patrick Mahomes', 'Drew Brees'], answer: 'Peyton Manning', points: 100 },
        { question_text: 'How many players are on the field per team during a standard NFL play?', choices: ['10', '12', '11', '9'], answer: '11', points: 100 },
        { question_text: 'Which city hosted Super Bowl I in 1967?', choices: ['Miami', 'New Orleans', 'Los Angeles', 'Green Bay'], answer: 'Los Angeles', points: 100 }
      ]
    },
    // ── NBA MC ──
    {
      quiz: { title: 'NBA Trivia: Basketball Knowledge Check', description: 'From hardwood legends to modern superstars — how deep does your NBA knowledge go?', type: 'multiple_choice', theme: 'NBA', timer_seconds: 20, is_active: true },
      questions: [
        { question_text: 'Who holds the NBA record for most career points scored?', choices: ['Kareem Abdul-Jabbar', 'LeBron James', 'Karl Malone', 'Kobe Bryant'], answer: 'LeBron James', points: 100 },
        { question_text: 'Which NBA team has won the most championships?', choices: ['Los Angeles Lakers', 'Chicago Bulls', 'Boston Celtics', 'Golden State Warriors'], answer: 'Boston Celtics', points: 100 },
        { question_text: 'Who won the NBA MVP award in the 2022-23 season?', choices: ['LeBron James', 'Nikola Jokić', 'Giannis Antetokounmpo', 'Joel Embiid'], answer: 'Joel Embiid', points: 100 },
        { question_text: 'How many points is a shot worth from behind the three-point line?', choices: ['2', '3', '4', '1'], answer: '3', points: 100 },
        { question_text: 'Which player is nicknamed "The Greek Freak"?', choices: ['Nikola Jokić', 'Luka Dončić', 'Giannis Antetokounmpo', 'Rudy Gobert'], answer: 'Giannis Antetokounmpo', points: 100 },
        { question_text: 'What year did the NBA first allow players to enter the draft straight from high school?', choices: ['1990', '1995', '1974', '2005'], answer: '1995', points: 100 },
        { question_text: 'Which player holds the NBA record for most points scored in a single game?', choices: ['Michael Jordan', 'Kobe Bryant', 'Wilt Chamberlain', 'LeBron James'], answer: 'Wilt Chamberlain', points: 100 },
        { question_text: 'How long is an NBA quarter?', choices: ['10 minutes', '15 minutes', '12 minutes', '8 minutes'], answer: '12 minutes', points: 100 },
        { question_text: 'Which city do the Jazz play their home games in?', choices: ['Las Vegas', 'Salt Lake City', 'Denver', 'Phoenix'], answer: 'Salt Lake City', points: 100 },
        { question_text: 'Who won the first NBA Slam Dunk Contest in 1984?', choices: ['Julius Erving', 'Michael Jordan', 'Larry Nance', 'Dominique Wilkins'], answer: 'Larry Nance', points: 100 }
      ]
    },
    // ── NHL MC ──
    {
      quiz: { title: 'NHL Trivia: Hockey Head-to-Head', description: 'From the crease to center ice — how well do you know the world\'s fastest sport?', type: 'multiple_choice', theme: 'NHL', timer_seconds: 20, is_active: true },
      questions: [
        { question_text: 'Who holds the NHL record for most career goals?', choices: ['Mario Lemieux', 'Gordie Howe', 'Wayne Gretzky', 'Brett Hull'], answer: 'Wayne Gretzky', points: 100 },
        { question_text: 'How many players per team are on the ice at once in standard NHL play?', choices: ['5', '6', '7', '4'], answer: '6', points: 100 },
        { question_text: 'Which trophy is awarded to the NHL\'s regular season MVP?', choices: ['Vezina Trophy', 'Norris Trophy', 'Hart Trophy', 'Conn Smythe Trophy'], answer: 'Hart Trophy', points: 100 },
        { question_text: 'Which team has won the most Stanley Cup championships?', choices: ['Montreal Canadiens', 'Toronto Maple Leafs', 'Detroit Red Wings', 'Boston Bruins'], answer: 'Montreal Canadiens', points: 100 },
        { question_text: 'How long is each period in an NHL game?', choices: ['15 minutes', '20 minutes', '25 minutes', '12 minutes'], answer: '20 minutes', points: 100 },
        { question_text: 'What is the term for scoring three goals in one game?', choices: ['Perfect game', 'Hat trick', 'Triple play', 'Grand slam'], answer: 'Hat trick', points: 100 },
        { question_text: 'Which city do the Maple Leafs play their home games in?', choices: ['Montreal', 'Vancouver', 'Toronto', 'Ottawa'], answer: 'Toronto', points: 100 },
        { question_text: 'Which goalie holds the NHL record for most career wins?', choices: ['Patrick Roy', 'Martin Brodeur', 'Roberto Luongo', 'Dominik Hasek'], answer: 'Martin Brodeur', points: 100 },
        { question_text: 'What is it called when a player scores while their team is short-handed?', choices: ['Power play goal', 'Empty net goal', 'Shorthanded goal', 'Overtime goal'], answer: 'Shorthanded goal', points: 100 },
        { question_text: 'In what year was the NHL founded?', choices: ['1917', '1925', '1910', '1930'], answer: '1917', points: 100 }
      ]
    },
    // ── MLB MC ──
    {
      quiz: { title: 'MLB Trivia: America\'s Pastime', description: 'Batter up! Test your baseball knowledge from the minors to the World Series.', type: 'multiple_choice', theme: 'MLB', timer_seconds: 20, is_active: true },
      questions: [
        { question_text: 'Who holds the MLB record for most career home runs?', choices: ['Babe Ruth', 'Hank Aaron', 'Barry Bonds', 'Alex Rodriguez'], answer: 'Barry Bonds', points: 100 },
        { question_text: 'How many strikes does it take to strikeout a batter?', choices: ['2', '4', '3', '5'], answer: '3', points: 100 },
        { question_text: 'Which team has won the most World Series championships?', choices: ['Boston Red Sox', 'Los Angeles Dodgers', 'New York Yankees', 'San Francisco Giants'], answer: 'New York Yankees', points: 100 },
        { question_text: 'What is the distance between home plate and the pitcher\'s mound?', choices: ['55 feet', '65 feet', '60 feet 6 inches', '58 feet'], answer: '60 feet 6 inches', points: 100 },
        { question_text: 'Which player is nicknamed "The Say Hey Kid"?', choices: ['Willie Mays', 'Ted Williams', 'Mickey Mantle', 'Joe DiMaggio'], answer: 'Willie Mays', points: 100 },
        { question_text: 'How many innings are in a standard MLB game?', choices: ['7', '8', '9', '10'], answer: '9', points: 100 },
        { question_text: 'What is a "perfect game" in baseball?', choices: ['A no-hitter with 27 strikeouts', 'Retiring all 27 batters faced without any reaching base', 'Winning 1-0', 'Hitting a grand slam and winning'], answer: 'Retiring all 27 batters faced without any reaching base', points: 100 },
        { question_text: 'Which pitcher holds the MLB record for most career strikeouts?', choices: ['Roger Clemens', 'Randy Johnson', 'Nolan Ryan', 'Steve Carlton'], answer: 'Nolan Ryan', points: 100 },
        { question_text: 'What is the term for hitting singles, doubles, triples, and a home run in one game?', choices: ['Grand cycle', 'Natural cycle', 'Hitting for the cycle', 'Perfect hitting'], answer: 'Hitting for the cycle', points: 100 },
        { question_text: 'Which team plays at Fenway Park?', choices: ['New York Yankees', 'Chicago Cubs', 'Boston Red Sox', 'Baltimore Orioles'], answer: 'Boston Red Sox', points: 100 }
      ]
    },
    // ── WWE MC ──
    {
      quiz: { title: 'WWE Trivia: Step Into the Ring', description: 'Think you know your superstars, championships, and WrestleMania moments? Prove it!', type: 'multiple_choice', theme: 'WWE', timer_seconds: 20, is_active: true },
      questions: [
        { question_text: 'Who is known as "The Deadman" in WWE?', choices: ['Kane', 'The Undertaker', 'Mankind', 'Goldberg'], answer: 'The Undertaker', points: 100 },
        { question_text: 'What is the name of John Cena\'s finishing move?', choices: ['F-5', 'RKO', 'Attitude Adjustment', 'Pedigree'], answer: 'Attitude Adjustment', points: 100 },
        { question_text: 'How many times did Ric Flair win the World Heavyweight Championship?', choices: ['8', '12', '16', '10'], answer: '16', points: 100 },
        { question_text: 'Which WWE event is considered the "Showcase of the Immortals"?', choices: ['SummerSlam', 'Royal Rumble', 'WrestleMania', 'Survivor Series'], answer: 'WrestleMania', points: 100 },
        { question_text: 'What is The Rock\'s finishing move?', choices: ['Stunner', 'Rock Bottom', 'People\'s Elbow', 'Both Rock Bottom and People\'s Elbow'], answer: 'Both Rock Bottom and People\'s Elbow', points: 100 },
        { question_text: 'Who won the first-ever Women\'s Royal Rumble match in 2018?', choices: ['Ronda Rousey', 'Charlotte Flair', 'Sasha Banks', 'Asuka'], answer: 'Asuka', points: 100 },
        { question_text: 'What is Stone Cold Steve Austin\'s finishing move?', choices: ['Stone Cold Stunner', 'RKO', 'Tombstone Piledriver', 'FU'], answer: 'Stone Cold Stunner', points: 100 },
        { question_text: 'Which WWE Hall of Famer is known as "The Nature Boy"?', choices: ['Hulk Hogan', 'Randy Savage', 'Ric Flair', 'Dusty Rhodes'], answer: 'Ric Flair', points: 100 },
        { question_text: 'How many people compete in a standard Royal Rumble match?', choices: ['20', '25', '30', '40'], answer: '30', points: 100 },
        { question_text: 'Which wrestler is nicknamed "The Beast Incarnate"?', choices: ['Roman Reigns', 'Goldberg', 'Brock Lesnar', 'Bobby Lashley'], answer: 'Brock Lesnar', points: 100 }
      ]
    },
    // ── NFL RANKINGS - RUSHING ──
    {
      quiz: { title: '2025-26 NFL Rushing Leaders: Name Them All', description: 'Can you name the top 10 rushing yard leaders from the 2025-26 NFL regular season? You have 90 seconds!', type: 'rankings', theme: 'NFL', timer_seconds: 90, is_active: true },
      questions: [
        {
          question_text: 'Name the Top 10 Rushing Yard Leaders from the 2025-26 NFL Regular Season (in order)',
          answer: JSON.stringify([
            'James Cook III (1,621 yds)',
            'Derrick Henry (1,595 yds)',
            'Jonathan Taylor (1,585 yds)',
            'Bijan Robinson (1,478 yds)',
            "De'Von Achane (1,350 yds)",
            'Kyren Williams (1,252 yds)',
            'Jahmyr Gibbs (1,223 yds)',
            'Christian McCaffrey (1,202 yds)',
            'Javonte Williams (1,201 yds)',
            'Saquon Barkley (1,140 yds)'
          ]),
          type: 'rankings'
        }
      ]
    },
    // ── NFL RANKINGS - PLAYOFFS AFC ──
    {
      quiz: { title: '2026 NFL Playoffs: AFC Seeds 1-7', description: 'Can you name all 7 AFC playoff teams from the 2026 NFL Playoffs in order of their seed? You have 60 seconds!', type: 'rankings', theme: 'NFL', timer_seconds: 60, is_active: true },
      questions: [
        {
          question_text: 'Name the 7 AFC Teams in the 2026 NFL Playoffs, in order of their playoff seed (1-7)',
          answer: JSON.stringify([
            'Denver Broncos',
            'New England Patriots',
            'Jacksonville Jaguars',
            'Pittsburgh Steelers',
            'Houston Texans',
            'Buffalo Bills',
            'Los Angeles Chargers'
          ]),
          type: 'rankings'
        }
      ]
    },
    // ── NFL RANKINGS - PLAYOFFS NFC ──
    {
      quiz: { title: '2026 NFL Playoffs: NFC Seeds 1-7', description: 'Can you name all 7 NFC playoff teams from the 2026 NFL Playoffs in order of their seed? You have 60 seconds!', type: 'rankings', theme: 'NFL', timer_seconds: 60, is_active: true },
      questions: [
        {
          question_text: 'Name the 7 NFC Teams in the 2026 NFL Playoffs, in order of their playoff seed (1-7)',
          answer: JSON.stringify([
            'Seattle Seahawks',
            'Chicago Bears',
            'Philadelphia Eagles',
            'Carolina Panthers',
            'Los Angeles Rams',
            'San Francisco 49ers',
            'Green Bay Packers'
          ]),
          type: 'rankings'
        }
      ]
    }
  ];

  for (const { quiz, questions } of quizzes) {
    const { data: quizData, error: qErr } = await supabase.from('quizzes').insert(quiz).select().single();
    if (qErr) { console.error('Quiz insert error:', qErr.message); continue; }
    const rows = questions.map((q, i) => ({ quiz_id: quizData.id, question_text: q.question_text, type: q.type || 'multiple_choice', choices: q.choices || null, answer: q.answer, points: q.points || 100, sort_order: i }));
    const { error: rErr } = await supabase.from('questions').insert(rows);
    if (rErr) console.error('Questions insert error for', quiz.title, rErr.message);
    else console.log('✅ Seeded:', quiz.title);
  }
  console.log('All done!');
}

seedAllQuizzes();
