// ─── COOKIE / ANONYMOUS USER ID ──────────────────────────────────
function getCookieId() {
  let id = localStorage.getItem('fs_cookie_id');
  if (!id) {
    id = 'anon_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    localStorage.setItem('fs_cookie_id', id);
  }
  return id;
}

// Track attempted quiz IDs in localStorage as a fast local check
function markAttemptedLocally(quizId) {
  const attempted = JSON.parse(localStorage.getItem('fs_attempted') || '[]');
  if (!attempted.includes(quizId)) {
    attempted.push(quizId);
    localStorage.setItem('fs_attempted', JSON.stringify(attempted));
  }
}

function hasAttemptedLocally(quizId) {
  const attempted = JSON.parse(localStorage.getItem('fs_attempted') || '[]');
  return attempted.includes(quizId);
}

// ─── CHECK IF USER ATTEMPTED A QUIZ ──────────────────────────────
async function hasAttemptedQuiz(quizId) {
  // Fast local check first
  if (hasAttemptedLocally(quizId)) return true;

  const cookieId = getCookieId();
  const { data: { user } } = await supabase.auth.getUser();

  // Check by cookie_id (covers both guests and logged-in users who played as guest)
  const { data: byCookie } = await supabase
    .from('attempts')
    .select('id')
    .eq('quiz_id', quizId)
    .eq('cookie_id', cookieId)
    .limit(1);
  if (byCookie && byCookie.length > 0) {
    markAttemptedLocally(quizId);
    return true;
  }

  // If logged in, also check by user_id
  if (user) {
    const { data: byUser } = await supabase
      .from('attempts')
      .select('id')
      .eq('quiz_id', quizId)
      .eq('user_id', user.id)
      .limit(1);
    if (byUser && byUser.length > 0) {
      markAttemptedLocally(quizId);
      return true;
    }
  }

  return false;
}

// ─── SAVE ATTEMPT ────────────────────────────────────────────────
async function saveAttempt(quizId, score, timeTakenSeconds, answers) {
  // Guard: never save a second attempt
  if (hasAttemptedLocally(quizId)) {
    console.warn('Attempt already saved for quiz', quizId);
    return null;
  }

  const { data: { user } } = await supabase.auth.getUser();
  const cookieId = getCookieId();
  const attemptData = {
    quiz_id: quizId,
    score: score,
    time_taken_seconds: timeTakenSeconds,
    answers: answers,
    cookie_id: cookieId
  };
  if (user) attemptData.user_id = user.id;

  const { data, error } = await supabase.from('attempts').insert(attemptData).select().single();
  if (error) {
    console.error('Save attempt error:', error);
    return null;
  }

  // Mark locally so we never double-save
  markAttemptedLocally(quizId);
  return data;
}

// ─── GET PERCENTILE ──────────────────────────────────────────────
async function getPercentile(quizId, score) {
  const { data, error } = await supabase
    .from('attempts')
    .select('score')
    .eq('quiz_id', quizId);
  if (error || !data || data.length === 0) return null;
  const total = data.length;
  const beaten = data.filter(a => score > a.score).length;
  return Math.round((beaten / total) * 100);
}

// ─── TOAST NOTIFICATIONS ─────────────────────────────────────────
function showToast(msg, type = 'default') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    toast.innerHTML = '<span class="toast-icon"></span><span class="toast-msg"></span>';
    document.body.appendChild(toast);
  }
  const icons = { success: '✅', error: '❌', default: '💬' };
  toast.querySelector('.toast-icon').textContent = icons[type] || '💬';
  toast.querySelector('.toast-msg').textContent = msg;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => toast.classList.remove('show'), 3500);
}

// ─── AUTH STATE ───────────────────────────────────────────────────
async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ─── SIGN UP ─────────────────────────────────────────────────────
async function signUp(email, password, username) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } }
  });
  return { data, error };
}

// ─── SIGN IN ─────────────────────────────────────────────────────
async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

// ─── SIGN OUT ────────────────────────────────────────────────────
async function signOut() {
  await supabase.auth.signOut();
  updateNavAuth();
}

// ─── UPDATE NAV FOR AUTH STATE ────────────────────────────────────
async function updateNavAuth() {
  const user = await getCurrentUser();
  const navActions = document.getElementById('nav-actions');
  if (!navActions) return;
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).single();
    const username = profile?.username || user.email;
    navActions.innerHTML = `
      <span style="color:var(--gray);font-size:0.85rem;font-family:'Barlow Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">
        👤 ${username}
      </span>
      <button class="btn btn-ghost btn-sm" onclick="signOut()">Sign Out</button>
    `;
  } else {
    navActions.innerHTML = `
      <button class="btn btn-ghost btn-sm" onclick="openModal('login')">Log In</button>
      <button class="btn btn-primary btn-sm" onclick="openModal('signup')">Sign Up</button>
    `;
  }
}

// ─── AUTH MODAL ────────────────────────────────────────────────────
function openModal(mode = 'login') {
  let modal = document.getElementById('auth-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'auth-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <button class="modal-close" onclick="closeModal()">✕</button>
        <div class="modal-logo"><img src="/images/logo-wordmark.png" alt="FlurrySports"></div>
        <h2 id="modal-title">Log In</h2>
        <p class="modal-sub" id="modal-sub">Welcome back! Sign in to track your scores.</p>
        <form id="auth-form" onsubmit="handleAuth(event)">
          <div class="form-group" id="username-group" style="display:none">
            <label class="form-label">Username</label>
            <input class="form-input" id="auth-username" type="text" placeholder="Choose a username" autocomplete="username">
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input class="form-input" id="auth-email" type="email" placeholder="you@example.com" required autocomplete="email">
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input class="form-input" id="auth-password" type="password" placeholder="••••••••" required autocomplete="current-password">
          </div>
          <div class="form-error hidden" id="auth-error"></div>
          <button type="submit" class="btn btn-primary" style="width:100%;margin-top:0.5rem;justify-content:center;" id="auth-submit-btn">Log In</button>
        </form>
        <div class="auth-switch">
          <span id="auth-switch-text">Don't have an account? </span>
          <a id="auth-switch-link" onclick="switchAuthMode()">Sign Up</a>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  }
  modal.style.display = 'flex';
  window._authMode = mode;
  if (mode === 'signup') switchToSignup();
  else switchToLogin();
}

function closeModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.style.display = 'none';
}

function switchAuthMode() {
  window._authMode = window._authMode === 'login' ? 'signup' : 'login';
  if (window._authMode === 'signup') switchToSignup();
  else switchToLogin();
}

function switchToLogin() {
  document.getElementById('modal-title').textContent = 'Log In';
  document.getElementById('modal-sub').textContent = 'Welcome back! Sign in to track your scores.';
  document.getElementById('username-group').style.display = 'none';
  document.getElementById('auth-submit-btn').textContent = 'Log In';
  document.getElementById('auth-switch-text').textContent = "Don't have an account? ";
  document.getElementById('auth-switch-link').textContent = 'Sign Up';
}

function switchToSignup() {
  document.getElementById('modal-title').textContent = 'Create Account';
  document.getElementById('modal-sub').textContent = 'Join FlurrySports and compete on the leaderboard!';
  document.getElementById('username-group').style.display = 'block';
  document.getElementById('auth-submit-btn').textContent = 'Create Account';
  document.getElementById('auth-switch-text').textContent = 'Already have an account? ';
  document.getElementById('auth-switch-link').textContent = 'Log In';
}

// ─── LINK COOKIE ATTEMPTS TO USER AFTER LOGIN ───────────────────
async function linkCookieAttemptsToUser(userId) {
  const cookieId = getCookieId();
  // Update any guest attempts with this cookie_id to also have the user_id
  // This prevents double-counting on leaderboard and blocks re-attempts
  const { error } = await supabase
    .from('attempts')
    .update({ user_id: userId })
    .eq('cookie_id', cookieId)
    .is('user_id', null);
  if (error) console.error('Error linking attempts:', error);
}

async function handleAuth(e) {
  e.preventDefault();
  const errEl = document.getElementById('auth-error');
  errEl.classList.add('hidden');
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  const btn = document.getElementById('auth-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Please wait...';

  if (window._authMode === 'signup') {
    const username = document.getElementById('auth-username').value.trim();
    if (!username) { errEl.textContent = 'Please choose a username.'; errEl.classList.remove('hidden'); btn.disabled = false; btn.textContent = 'Create Account'; return; }
    const { data, error } = await signUp(email, password, username);
    if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); btn.disabled = false; btn.textContent = 'Create Account'; return; }
    // Link any guest attempts to this new account
    if (data?.user) await linkCookieAttemptsToUser(data.user.id);
    showToast('Account created! Check your email to confirm.', 'success');
    closeModal();
    updateNavAuth();
  } else {
    const { data, error } = await signIn(email, password);
    if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); btn.disabled = false; btn.textContent = 'Log In'; return; }
    // Link any guest attempts to this account
    if (data?.user) await linkCookieAttemptsToUser(data.user.id);
    showToast('Welcome back!', 'success');
    closeModal();
    updateNavAuth();
    if (window._onAuthSuccess) window._onAuthSuccess();
  }
  btn.disabled = false;
}

// ─── SHARE SCORE ─────────────────────────────────────────────────
function shareScore(quizTitle, score, quizUrl) {
  const sport = quizTitle.match(/NFL|NBA|NHL|MLB|WWE|football|basketball|hockey|baseball|wrestling/i)?.[0] || 'sports';
  const message = `I just scored ${score} points on this ${sport} trivia quiz from FlurrySports! Think you can beat me? 🏆 ${quizUrl}`;
  return {
    sms: `sms:?body=${encodeURIComponent(message)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(quizUrl)}&quote=${encodeURIComponent(message)}`,
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`
  };
}

// ─── FORMAT HELPERS ────────────────────────────────────────────────
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2,'0')}` : `${s}s`;
}

function getOrdinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

// ─── STREAK SYSTEM ────────────────────────────────────────────────
const STREAK_KEY = 'fs_streak';
const STREAK_DATE_KEY = 'fs_streak_date';
const STREAK_FIRE_KEY = 'fs_on_fire';
const FIRE_THRESHOLD = 7;
const FIRE_BONUS = 1.10; // 10% boost

function getStreak() {
  return parseInt(localStorage.getItem(STREAK_KEY) || '0');
}

function getLastPlayedDate() {
  return localStorage.getItem(STREAK_DATE_KEY) || null;
}

function isOnFire() {
  return localStorage.getItem(STREAK_FIRE_KEY) === '1';
}

function getTodayString() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function updateStreak() {
  const today = getTodayString();
  const last = getLastPlayedDate();
  let streak = getStreak();

  if (last === today) {
    // Already played today, no change
    return streak;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  if (last === yesterdayStr) {
    // Consecutive day — increment streak
    streak++;
  } else if (last === null) {
    // First ever play
    streak = 1;
  } else {
    // Missed a day — reset
    streak = 1;
    localStorage.removeItem(STREAK_FIRE_KEY);
  }

  localStorage.setItem(STREAK_KEY, streak);
  localStorage.setItem(STREAK_DATE_KEY, today);

  if (streak >= FIRE_THRESHOLD) {
    localStorage.setItem(STREAK_FIRE_KEY, '1');
  }

  return streak;
}

function applyFireBonus(score) {
  if (!isOnFire()) return score;
  return Math.round(score * FIRE_BONUS);
}

function getStreakDisplay() {
  const streak = getStreak();
  const fire = isOnFire();
  return { streak, fire };
}

// Revive streak (called after $1 payment flow - payment handled externally)
function reviveStreak() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  localStorage.setItem(STREAK_DATE_KEY, yesterdayStr);
  showToast('Streak revived! 🔥 Play today to keep it going!', 'success');
}

// Show streak badge in UI
function renderStreakBadge(container) {
  const { streak, fire } = getStreakDisplay();
  if (streak === 0) return;
  const badge = document.createElement('div');
  badge.id = 'streak-badge';
  badge.style.cssText = `
    display:inline-flex;align-items:center;gap:0.4rem;
    background:${fire ? 'rgba(255,100,0,0.15)' : 'rgba(245,197,24,0.12)'};
    border:1px solid ${fire ? 'rgba(255,100,0,0.4)' : 'rgba(245,197,24,0.3)'};
    border-radius:50px;padding:0.3rem 0.85rem;
    font-family:'Barlow Condensed',sans-serif;font-weight:700;
    font-size:0.85rem;letter-spacing:0.05em;text-transform:uppercase;
    color:${fire ? '#ff6400' : 'var(--gold)'};
    cursor:pointer;transition:all 0.2s;
  `;
  badge.innerHTML = `${fire ? '🔥' : '⚡'} ${streak}-Day Streak${fire ? ' · ON FIRE!' : ''}`;
  badge.title = fire ? `You're on fire! All points boosted by 10%!` : `${FIRE_THRESHOLD - streak} more days to go On Fire!`;
  badge.onclick = () => showStreakModal();
  if (container) container.appendChild(badge);
}

function showStreakModal() {
  const { streak, fire } = getStreakDisplay();
  const last = getLastPlayedDate();
  const today = getTodayString();
  const playedToday = last === today;

  // Check if streak is broken (missed a day)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  const streakBroken = last && last !== today && last !== yesterdayStr;

  let modal = document.getElementById('streak-modal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'streak-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width:420px;text-align:center;">
      <button class="modal-close" onclick="document.getElementById('streak-modal').remove()">✕</button>
      <div style="font-size:4rem;margin-bottom:0.5rem;">${fire ? '🔥' : streakBroken ? '💔' : '⚡'}</div>
      <h2 style="font-size:1.8rem;margin-bottom:0.35rem;">
        ${fire ? 'ON FIRE!' : streakBroken ? 'Streak Broken' : `${streak}-Day Streak`}
      </h2>
      <p style="color:var(--gray-light);margin-bottom:1.25rem;font-size:0.95rem;">
        ${fire
          ? `🔥 You've played ${streak} days in a row! All your points are boosted by <strong style="color:#ff6400">+10%</strong>. Keep it going!`
          : streakBroken
          ? `Your streak was broken. But you can revive it for just $1 and pick up where you left off!`
          : `${FIRE_THRESHOLD - streak} more day${FIRE_THRESHOLD - streak !== 1 ? 's' : ''} to go until you're On Fire 🔥 (+10% points boost!)`
        }
      </p>
      ${streakBroken ? `
        <button class="btn btn-primary btn-lg" style="width:100%;justify-content:center;margin-bottom:0.75rem;background:#ff6400;border-color:#ff6400;" onclick="handleStreakRevive()">
          🔥 Revive Streak for $1
        </button>
        <p style="font-size:0.78rem;color:var(--gray);">Payment opens a secure checkout. Your streak is restored instantly after.</p>
      ` : `
        <div style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap;">
          ${[...Array(7)].map((_, i) => `
            <div style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1rem;
              background:${i < streak ? (fire ? '#ff6400' : 'var(--gold)') : 'rgba(255,255,255,0.06)'};
              border:2px solid ${i < streak ? (fire ? '#ff6400' : 'var(--gold)') : 'rgba(255,255,255,0.1)'};">
              ${i < streak ? '✓' : i + 1}
            </div>
          `).join('')}
        </div>
        <p style="font-size:0.78rem;color:var(--gray);margin-top:1rem;">Play daily to reach 7 days and unlock the 🔥 On Fire bonus!</p>
      `}
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function handleStreakRevive() {
  // In production, replace this URL with your actual payment link (e.g. Stripe, Gumroad, etc.)
  // After payment, redirect back to the site with ?streak_revived=1
  const paymentUrl = 'https://buy.stripe.com/YOUR_PAYMENT_LINK'; // ← REPLACE WITH YOUR STRIPE LINK
  const params = new URLSearchParams(window.location.search);
  if (params.get('streak_revived') === '1') {
    reviveStreak();
    return;
  }
  alert('Payment integration: Replace the Stripe link in js/auth.js to enable $1 streak revival. For now, reviving for free as a test!');
  reviveStreak();
  document.getElementById('streak-modal')?.remove();
}

// Call on page load to check for post-payment redirect
(function checkStreakReviveRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('streak_revived') === '1') {
    reviveStreak();
    // Clean up URL
    const url = new URL(window.location);
    url.searchParams.delete('streak_revived');
    window.history.replaceState({}, '', url);
  }
})();
