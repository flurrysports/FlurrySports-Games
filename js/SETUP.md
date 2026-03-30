# Flurry Sports Trivia — Setup Guide

## 🚀 Getting Started

This app is built with vanilla HTML/CSS/JS + Supabase. No build tools needed!

---

## Step 1: Set Up Supabase

1. Go to **https://supabase.com** and create a free account
2. Create a **New Project** (choose any name, e.g. "flurrysports")
3. Wait for the project to initialize (~1-2 min)
4. Go to **Settings → API** and copy your:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon public key** (long string starting with `eyJ...`)

5. Go to **SQL Editor** and run the full SQL from the comment block in `js/supabase-config.js`

---

## Step 2: Configure Your Keys

Open `js/supabase-config.js` and replace the placeholder values:

```js
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...your-anon-key...';
```

---

## Step 3: Set Your Admin Password

Open `admin/index.html` and find this line near the top of the `<script>`:

```js
const ADMIN_PASSWORD = 'flurryadmin2025'; // ← CHANGE THIS
```

Change it to something secure before deploying!

Your admin panel URL will be: `https://yoursite.netlify.app/admin/`

---

## Step 4: Deploy to Netlify

### Option A — Drag & Drop (Easiest)
1. Go to **https://app.netlify.com**
2. Sign up or log in
3. Drag the entire `flurrysports/` folder onto the Netlify dashboard
4. Done! Your site is live 🎉

### Option B — Git (Recommended for updates)
1. Push your project to a GitHub repository
2. In Netlify, click **"Add new site" → "Import from Git"**
3. Connect your GitHub and select the repo
4. Set **Publish directory** to `/` (root of the repo)
5. Click **Deploy**

---

## Step 5: Enable Supabase Auth Email Confirmations (Optional)

In Supabase → **Authentication → Email Templates**, customize the confirmation email.
For testing, you can disable email confirmation under **Auth → Settings → "Enable email confirmations"**.

---

## 📁 File Structure

```
flurrysports/
├── index.html          ← Home page
├── quizzes.html         ← Browse all quizzes
├── quiz.html            ← Quiz game (MC + Rankings)
├── leaderboard.html     ← Weekly + All-time leaderboard
├── admin/
│   └── index.html       ← Admin panel (password protected)
├── css/
│   └── style.css        ← All styles
├── js/
│   ├── supabase-config.js  ← ⚠️ ADD YOUR KEYS HERE
│   └── auth.js             ← Auth, cookies, utilities
└── images/
    ├── logo-wordmark.png
    ├── logo-icon-gold.png
    ├── logo-icon-blue.png
    ├── logo-icon-noborder.png
    ├── logo-crown.png
    └── logo-yeti-orange.png
```

---

## 🎮 Adding Your First Quiz

1. Go to `/admin/`
2. Enter your admin password
3. Fill in quiz details:
   - **Multiple Choice**: Add questions with 4 choices each
   - **Rankings Fill-In**: Enter the prompt and answers (one per line, in order)
4. Click **Save Quiz**
5. Go to the home page and take it!

---

## 🔒 Security Notes

- The admin password in `admin/index.html` is client-side only — suitable for a small team
- For stronger security, use Supabase Auth roles (set a user as admin in the database)
- Supabase Row Level Security (RLS) is enabled — users can only see/edit their own data
- The anon key is safe to expose publicly (it only has the permissions you set in RLS)

---

## 🧠 Quiz Scoring

**Multiple Choice:**
- Correct answer: 100 base points
- Speed bonus: up to 100 extra points (faster = more)
- Max per question: 200 points

**Rankings Fill-In:**
- Each correct entry: 100 points
- Accept full name OR last name only
- Timer set per quiz in admin panel

---

## 💬 Share Feature

After completing a quiz, players can share via:
- 💬 SMS / Text
- 📘 Facebook
- 𝕏 X (Twitter)

Message: *"I scored X points on the '[Quiz Title]' trivia quiz on Flurry Sports! Think you can beat me? Let's see! [link]"*

## v3 Update — Additional DB Column Required

Run this SQL in your Supabase dashboard to add game_type tracking:

```sql
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS game_type TEXT DEFAULT 'trivia';
```

This enables the per-game leaderboard filtering (Trivia, Snap Decision, Who's That Player).
