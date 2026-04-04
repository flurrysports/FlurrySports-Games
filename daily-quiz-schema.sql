-- ─────────────────────────────────────────────────────────────────────────────
-- Daily Quiz — Supabase Schema
-- Run this in your Supabase SQL editor
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_quizzes (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date       DATE NOT NULL UNIQUE,
  theme      TEXT NOT NULL,
  emoji      TEXT NOT NULL DEFAULT '🎯',
  questions  JSONB NOT NULL,
  -- questions format: [{ q, o: [4 options], c: correct_index }]
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_quizzes_date ON daily_quizzes(date DESC);

-- Public read, service role only writes
ALTER TABLE daily_quizzes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dq_public_read" ON daily_quizzes;
CREATE POLICY "dq_public_read"
  ON daily_quizzes FOR SELECT
  USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: today's quiz so you can test immediately
-- The worker will generate real AI quizzes from here on
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO daily_quizzes (date, theme, emoji, questions)
VALUES (
  CURRENT_DATE,
  'NFL Legends',
  '🏈',
  '[
    {"q":"How many Super Bowl titles did Tom Brady win total in his career?","o":["5","6","7","8"],"c":2},
    {"q":"Jerry Rice set the NFL record for most career receiving yards with which franchise?","o":["Dallas Cowboys","San Francisco 49ers","Oakland Raiders","Green Bay Packers"],"c":1},
    {"q":"Who holds the NFL record for most career rushing yards?","o":["Barry Sanders","Walter Payton","Emmitt Smith","Adrian Peterson"],"c":2},
    {"q":"Which QB threw for the most yards in a single Super Bowl, setting a record with 505 yards in Super Bowl LV?","o":["Tom Brady","Patrick Mahomes","Peyton Manning","Kurt Warner"],"c":0},
    {"q":"Who was the only player to win the NFL MVP award unanimously (all 50 votes) in the 2018 season?","o":["Tom Brady","Drew Brees","Patrick Mahomes","Aaron Rodgers"],"c":2}
  ]'::jsonb
)
ON CONFLICT (date) DO NOTHING;
