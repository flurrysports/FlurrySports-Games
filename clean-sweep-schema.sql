-- ─────────────────────────────────────────────────────────────────────────────
-- Clean Sweep — Supabase Schema
-- Run this in your Supabase SQL editor (supabase.com → project → SQL editor)
-- ─────────────────────────────────────────────────────────────────────────────

-- Daily puzzles table
-- Scores are saved to the existing `attempts` table (quiz_id = 'clean-sweep-YYYY-MM-DD')
-- This table just holds the puzzle content served to the game page

CREATE TABLE IF NOT EXISTS clean_sweep_puzzles (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date              DATE NOT NULL UNIQUE,
  prompt            TEXT NOT NULL,
  sport_category    TEXT NOT NULL CHECK (sport_category IN ('NFL','NBA','College Football','College Basketball','NHL')),
  difficulty        TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
  correct_tiles     TEXT[] NOT NULL,
  decoy_tiles       TEXT[] NOT NULL,
  tiles_shuffled    JSONB NOT NULL,       -- [{name, correct}] array, pre-shuffled, served to client
  edge_case_note    TEXT,                 -- explains the borderline answer
  verification_flag TEXT,                 -- set if AI self-verification raised concerns
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Index for fast date lookups (game page fetches by today's date)
CREATE INDEX IF NOT EXISTS idx_cs_puzzles_date ON clean_sweep_puzzles(date DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Puzzles are public read. Only the service role key (worker) can write.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE clean_sweep_puzzles ENABLE ROW LEVEL SECURITY;

-- Anyone can read puzzles (needed for the game page to load)
DROP POLICY IF EXISTS "cs_puzzles_public_read" ON clean_sweep_puzzles;
CREATE POLICY "cs_puzzles_public_read"
  ON clean_sweep_puzzles FOR SELECT
  USING (true);

-- Only service role can insert/update (the worker uses the service key)
-- No INSERT policy needed for anon/authenticated — they can't write

-- ─────────────────────────────────────────────────────────────────────────────
-- SCORES
-- Clean Sweep scores go into the existing `attempts` table used by all games.
-- quiz_id format: 'clean-sweep-YYYY-MM-DD'  (e.g. 'clean-sweep-2026-04-01')
-- The leaderboard page already reads from `attempts` and filters by quiz_id prefix.
-- No new table needed — just add the filter in leaderboard.html (done separately).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: insert a sample puzzle for today so you can test immediately
-- You can delete this row once the worker is running.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO clean_sweep_puzzles (
  date, prompt, sport_category, difficulty,
  correct_tiles, decoy_tiles,
  edge_case_note, tiles_shuffled
)
VALUES (
  CURRENT_DATE,
  'Won at least one Super Bowl championship as the starting quarterback',
  'NFL', 'medium',
  ARRAY['Tom Brady','Peyton Manning','Joe Montana','Patrick Mahomes','Jeff Hostetler'],
  ARRAY['Dan Marino','Jim Kelly','Donovan McNabb','Fran Tarkenton'],
  'Jeff Hostetler won Super Bowl XXV with the Giants as a backup who became the starter mid-season when Phil Simms was injured — the minimum possible championship, and many fans forget he qualifies.',
  '[
    {"name":"Tom Brady","correct":true},
    {"name":"Dan Marino","correct":false},
    {"name":"Peyton Manning","correct":true},
    {"name":"Jim Kelly","correct":false},
    {"name":"Joe Montana","correct":true},
    {"name":"Patrick Mahomes","correct":true},
    {"name":"Jeff Hostetler","correct":true},
    {"name":"Donovan McNabb","correct":false},
    {"name":"Fran Tarkenton","correct":false}
  ]'::jsonb
)
ON CONFLICT (date) DO NOTHING;
