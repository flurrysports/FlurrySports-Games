// ─── COOKIE / ANONYMOUS USER ID ───────────────────────────────────
function getCookieId() {
  let id = localStorage.getItem('fs_cookie_id');
  if (!id) {
    id = 'anon_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    localStorage.setItem('fs_cookie_id', id);
  }
  return id;
}

function markAttemptedLocally(gameId) {
  try {
    const attempted = JSON.parse(localStorage.getItem('fs_attempted') || '[]');
    if (!attempted.includes(gameId)) { attempted.push(gameId); localStorage.setItem('fs_attempted', JSON.stringify(attempted)); }
  } catch(e) {}
}

function hasAttemptedLocally(gameId) {
  try { return JSON.parse(localStorage.getItem('fs_attempted') || '[]').includes(gameId); } catch(e) { return false; }
}

// ─── DATE HELPERS (Pacific Time) ──────────────────────────────────
function getPacificDateString() {
  // Returns YYYY-MM-DD in Pacific time
  const now = new Date();
  const pacificOffset = getPacificOffset(now);
  const pacific = new Date(now.getTime() + pacificOffset * 60 * 1000);
  return pacific.toISOString().slice(0, 10);
}

function getPacificOffset(date) {
  // Returns offset in minutes from UTC to Pacific (handles DST)
  const jan = new Date(date.getFullYear(), 0, 1);
  const jul = new Date(date.getFullYear(), 6, 1);
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
  const isDST = date.getTimezoneOffset() < stdOffset;
  // Pacific Standard = UTC-8, Pacific Daylight = UTC-7
  return isDST ? -7 * 60 : -8 * 60;
}

function getPacificDateSeed() {
  return parseInt(getPacificDateString().replace(/-/g, ''));
}

function getTodayString() {
  return getPacificDateString();
}

// ─── CHECK IF USER ATTEMPTED A GAME ───────────────────────────────
async function hasAttemptedQuiz(gameId) {
  if (hasAttemptedLocally(gameId)) return true;
  const cookieId = getCookieId();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: byCookie } = await supabase.from('attempts').select('id').eq('quiz_id', gameId).eq('cookie_id', cookieId).limit(1);
  if (byCookie && byCookie.length > 0) { markAttemptedLocally(gameId); return true; }
  if (user) {
    const { data: byUser } = await supabase.from('attempts').select('id').eq('quiz_id', gameId).eq('user_id', user.id).limit(1);
    if (byUser && byUser.length > 0) { markAttemptedLocally(gameId); return true; }
  }
  return false;
}

// ─── SAVE ATTEMPT ─────────────────────────────────────────────────
// game_type: 'trivia' | 'snap_decision' | 'whos_that_player'
async function saveAttempt(gameId, score, timeTakenSeconds, answers, gameType) {
  const { data: { user } } = await supabase.auth.getUser();
  const cookieId = getCookieId();
  const { fire } = getStreakDisplay();
  const finalScore = fire ? Math.round(score * 1.10) : score;
  const attemptData = {
    quiz_id: gameId,
    score: finalScore,
    time_taken_seconds: timeTakenSeconds,
    answers: answers,
    cookie_id: cookieId,
    game_type: gameType || 'trivia'
  };
  if (user) attemptData.user_id = user.id;
  const { data, error } = await supabase.from('attempts').insert(attemptData).select().single();
  if (error) { console.error('Save attempt error:', error); return null; }
  markAttemptedLocally(gameId);
  updateStreak();
  return data;
}

// ─── SAVE PENDING SCORE (for post-game sign-up) ────────────────────
function savePendingScore(gameId, score, gameType, gameTitle) {
  const pending = { gameId, score, gameType, gameTitle, ts: Date.now() };
  localStorage.setItem('fs_pending_score', JSON.stringify(pending));
}

function getPendingScore() {
  try { return JSON.parse(localStorage.getItem('fs_pending_score')); } catch(e) { return null; }
}

function clearPendingScore() {
  localStorage.removeItem('fs_pending_score');
}

async function claimPendingScore(userId) {
  const pending = getPendingScore();
  if (!pending) return;
  const cookieId = getCookieId();
  const { fire } = getStreakDisplay();
  const finalScore = fire ? Math.round(pending.score * 1.10) : pending.score;
  const attemptData = {
    quiz_id: pending.gameId,
    score: finalScore,
    time_taken_seconds: 0,
    answers: {},
    cookie_id: cookieId,
    user_id: userId,
    game_type: pending.gameType || 'trivia'
  };
  const { error } = await supabase.from('attempts').insert(attemptData);
  if (!error) { clearPendingScore(); markAttemptedLocally(pending.gameId); updateStreak(); }
}

// ─── GET PERCENTILE ───────────────────────────────────────────────
async function getPercentile(gameId, score) {
  const { data, error } = await supabase.from('attempts').select('score').eq('quiz_id', gameId);
  if (error || !data || data.length === 0) return null;
  const beaten = data.filter(a => score > a.score).length;
  return Math.round((beaten / data.length) * 100);
}

// ─── TOAST ────────────────────────────────────────────────────────
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

async function signUp(email, password, username) {
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username } } });
  return { data, error };
}

async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

async function signOut() {
  await supabase.auth.signOut();
  updateNavAuth();
}

async function updateNavAuth() {
  const user = await getCurrentUser();
  const navActions = document.getElementById('nav-actions');
  if (!navActions) return;
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).single();
    const username = profile?.username || user.email;
    navActions.innerHTML = `
      <span style="color:var(--gray);font-size:0.85rem;font-family:'Barlow Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">👤 ${username}</span>
      <button class="btn btn-ghost btn-sm" onclick="signOut()">Sign Out</button>
    `;
  } else {
    navActions.innerHTML = `
      <button class="btn btn-ghost btn-sm" onclick="openModal('login')">Log In</button>
      <button class="btn btn-primary btn-sm" onclick="openModal('signup')">Sign Up</button>
    `;
  }
}

// ─── POST-GAME AUTH PROMPT ─────────────────────────────────────────
function showPostGameAuthPrompt(gameId, score, gameType, gameTitle, onClaimed) {
  savePendingScore(gameId, score, gameType, gameTitle);
  let modal = document.getElementById('postgame-auth-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'postgame-auth-modal';
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal" style="max-width:460px;">
      <button class="modal-close" onclick="document.getElementById('postgame-auth-modal').remove()">✕</button>
      <div class="modal-logo"><img src="/images/logo-wordmark.png" alt="FlurrySports"></div>
      <div style="text-align:center;margin-bottom:1.5rem;">
        <div style="font-size:2.5rem;margin-bottom:0.5rem;">🏆</div>
        <h2 style="font-size:1.6rem;margin-bottom:0.25rem;">Nice game!</h2>
        <p style="color:var(--gray-light);font-size:0.95rem;">You scored <strong style="color:var(--gold);">${score.toLocaleString()} pts</strong> on ${gameTitle}.</p>
        <p style="color:var(--gray);font-size:0.875rem;margin-top:0.4rem;">Sign in or create a free account to save your score to the leaderboard. Your score and daily attempt will be counted.</p>
      </div>
      <form id="postgame-auth-form" onsubmit="handlePostGameAuth(event)">
        <div class="form-group" id="pg-username-group" style="display:none;">
          <label class="form-label">Username</label>
          <input class="form-input" id="pg-username" type="text" placeholder="Choose a username" autocomplete="username">
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input class="form-input" id="pg-email" type="email" placeholder="you@example.com" required autocomplete="email">
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input class="form-input" id="pg-password" type="password" placeholder="••••••••" required autocomplete="current-password">
        </div>
        <div class="form-error hidden" id="pg-error"></div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:0.5rem;" id="pg-submit-btn">Log In & Save Score</button>
      </form>
      <div class="auth-switch" style="margin-top:1rem;">
        <span id="pg-switch-text">Don't have an account? </span>
        <a id="pg-switch-link" onclick="togglePostGameMode()" style="cursor:pointer;color:var(--gold);">Sign Up</a>
      </div>
      <button onclick="document.getElementById('postgame-auth-modal').remove()" style="width:100%;background:transparent;border:none;color:var(--gray);margin-top:0.75rem;cursor:pointer;font-size:0.85rem;padding:0.5rem;">Skip — don't save score</button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  window._pgMode = 'login';
  window._pgOnClaimed = onClaimed;
}

function togglePostGameMode() {
  window._pgMode = window._pgMode === 'login' ? 'signup' : 'login';
  const isSignup = window._pgMode === 'signup';
  document.getElementById('pg-username-group').style.display = isSignup ? 'block' : 'none';
  document.getElementById('pg-submit-btn').textContent = isSignup ? 'Sign Up & Save Score' : 'Log In & Save Score';
  document.getElementById('pg-switch-text').textContent = isSignup ? 'Already have an account? ' : "Don't have an account? ";
  document.getElementById('pg-switch-link').textContent = isSignup ? 'Log In' : 'Sign Up';
}

async function handlePostGameAuth(e) {
  e.preventDefault();
  const errEl = document.getElementById('pg-error');
  errEl.classList.add('hidden');
  const email = document.getElementById('pg-email').value;
  const password = document.getElementById('pg-password').value;
  const btn = document.getElementById('pg-submit-btn');
  btn.disabled = true; btn.textContent = 'Please wait...';

  let userId = null;
  if (window._pgMode === 'signup') {
    const username = document.getElementById('pg-username').value.trim();
    if (!username) { errEl.textContent = 'Please choose a username.'; errEl.classList.remove('hidden'); btn.disabled = false; btn.textContent = 'Sign Up & Save Score'; return; }
    const { data, error } = await signUp(email, password, username);
    if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); btn.disabled = false; btn.textContent = 'Sign Up & Save Score'; return; }
    userId = data?.user?.id;
  } else {
    const { data, error } = await signIn(email, password);
    if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); btn.disabled = false; btn.textContent = 'Log In & Save Score'; return; }
    userId = data?.user?.id;
  }

  if (userId) {
    await linkCookieAttemptsToUser(userId);
    await claimPendingScore(userId);
    showToast('Score saved to leaderboard! 🏆', 'success');
    document.getElementById('postgame-auth-modal').remove();
    updateNavAuth();
    if (window._pgOnClaimed) window._pgOnClaimed();
  }
  btn.disabled = false;
}

// ─── SHARE SCORE ──────────────────────────────────────────────────
function buildShareText(gameTitle, score, emoji, extraLine) {
  const base = `FlurrySports · ${gameTitle}\n${emoji}\nScore: ${score.toLocaleString()} pts${extraLine ? '\n' + extraLine : ''}\nPlay at flurrysportsgames.pages.dev`;
  return base;
}

function showShareModal(shareText) {
  let modal = document.getElementById('share-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'share-modal';
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';
  const encoded = encodeURIComponent(shareText);
  modal.innerHTML = `
    <div class="modal" style="max-width:440px;">
      <button class="modal-close" onclick="document.getElementById('share-modal').remove()">✕</button>
      <div style="text-align:center;margin-bottom:1.5rem;">
        <div style="font-size:2rem;margin-bottom:0.5rem;">📣</div>
        <h2 style="font-size:1.6rem;">Share Your Score</h2>
      </div>
      <div style="background:rgba(255,255,255,0.04);border:1px solid var(--card-border);border-radius:10px;padding:1rem;font-family:monospace;font-size:0.83rem;color:var(--gray-light);white-space:pre-wrap;margin-bottom:1.25rem;">${shareText}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:0.75rem;">
        <a href="https://twitter.com/intent/tweet?text=${encoded}" target="_blank" class="btn btn-ghost" style="justify-content:center;">🐦 Post on X</a>
        <a href="https://www.facebook.com/sharer/sharer.php?u=https://flurrysportsgames.pages.dev&quote=${encoded}" target="_blank" class="btn btn-ghost" style="justify-content:center;">📘 Facebook</a>
      </div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="navigator.clipboard.writeText(${JSON.stringify(shareText)}).then(()=>showToast('Copied!','success'))">📋 Copy to Clipboard</button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ─── COUNTDOWN OVERLAY ────────────────────────────────────────────
function showCountdown(onComplete) {
  let overlay = document.getElementById('countdown-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'countdown-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(8,12,46,0.97);z-index:999;display:flex;flex-direction:column;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <img src="/images/logo-icon-noborder.png" style="height:70px;margin-bottom:1.5rem;opacity:0.9;">
    <div id="countdown-num" style="font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:min(22vw,140px);color:var(--gold);line-height:1;letter-spacing:-2px;">3</div>
    <div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:1rem;letter-spacing:0.2em;text-transform:uppercase;color:var(--gray);margin-top:1rem;">GET READY</div>
  `;
  document.body.appendChild(overlay);
  let count = 3;
  const tick = () => {
    const el = document.getElementById('countdown-num');
    if (!el) return;
    if (count <= 0) { overlay.remove(); onComplete(); return; }
    el.textContent = count;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = 'countPop 0.7s ease';
    count--;
    setTimeout(tick, 900);
  };
  // Add animation if not present
  if (!document.getElementById('countdown-style')) {
    const s = document.createElement('style');
    s.id = 'countdown-style';
    s.textContent = '@keyframes countPop { 0%{transform:scale(1.3);opacity:0.5} 50%{transform:scale(1);opacity:1} 100%{transform:scale(0.9);opacity:0.7} }';
    document.head.appendChild(s);
  }
  tick();
}

// ─── AUTH MODAL ───────────────────────────────────────────────────
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
  if (mode === 'signup') switchToSignup(); else switchToLogin();
}

function closeModal() { const m = document.getElementById('auth-modal'); if (m) m.style.display = 'none'; }
function switchAuthMode() { window._authMode = window._authMode === 'login' ? 'signup' : 'login'; if (window._authMode === 'signup') switchToSignup(); else switchToLogin(); }
function switchToLogin() { document.getElementById('modal-title').textContent='Log In'; document.getElementById('modal-sub').textContent='Welcome back! Sign in to track your scores.'; document.getElementById('username-group').style.display='none'; document.getElementById('auth-submit-btn').textContent='Log In'; document.getElementById('auth-switch-text').textContent="Don't have an account? "; document.getElementById('auth-switch-link').textContent='Sign Up'; }
function switchToSignup() { document.getElementById('modal-title').textContent='Create Account'; document.getElementById('modal-sub').textContent='Join FlurrySports and compete on the leaderboard!'; document.getElementById('username-group').style.display='block'; document.getElementById('auth-submit-btn').textContent='Create Account'; document.getElementById('auth-switch-text').textContent='Already have an account? '; document.getElementById('auth-switch-link').textContent='Log In'; }

async function linkCookieAttemptsToUser(userId) {
  const cookieId = getCookieId();
  await supabase.from('attempts').update({ user_id: userId }).eq('cookie_id', cookieId).is('user_id', null);
}

async function handleAuth(e) {
  e.preventDefault();
  const errEl = document.getElementById('auth-error');
  errEl.classList.add('hidden');
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  const btn = document.getElementById('auth-submit-btn');
  btn.disabled = true; btn.textContent = 'Please wait...';
  if (window._authMode === 'signup') {
    const username = document.getElementById('auth-username').value.trim();
    if (!username) { errEl.textContent='Please choose a username.'; errEl.classList.remove('hidden'); btn.disabled=false; btn.textContent='Create Account'; return; }
    const { data, error } = await signUp(email, password, username);
    if (error) { errEl.textContent=error.message; errEl.classList.remove('hidden'); btn.disabled=false; btn.textContent='Create Account'; return; }
    if (data?.user) { await linkCookieAttemptsToUser(data.user.id); await claimPendingScore(data.user.id); }
    showToast('Account created! Check your email to confirm.', 'success');
    closeModal(); updateNavAuth();
  } else {
    const { data, error } = await signIn(email, password);
    if (error) { errEl.textContent=error.message; errEl.classList.remove('hidden'); btn.disabled=false; btn.textContent='Log In'; return; }
    if (data?.user) { await linkCookieAttemptsToUser(data.user.id); await claimPendingScore(data.user.id); }
    showToast('Welcome back!', 'success');
    closeModal(); updateNavAuth();
    if (window._onAuthSuccess) window._onAuthSuccess();
  }
  btn.disabled = false;
}

// ─── FORMAT HELPERS ───────────────────────────────────────────────
function formatTime(seconds) { const m=Math.floor(seconds/60),s=seconds%60; return m>0?`${m}:${s.toString().padStart(2,'0')}`:`${s}s`; }
function getOrdinal(n) { const s=['th','st','nd','rd'],v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); }

// ─── STREAK SYSTEM (Pacific-time aware) ───────────────────────────
const STREAK_KEY = 'fs_streak';
const STREAK_DATE_KEY = 'fs_streak_date';
const STREAK_FIRE_KEY = 'fs_on_fire';
const FIRE_THRESHOLD = 7;

function getStreak() { return parseInt(localStorage.getItem(STREAK_KEY) || '0'); }
function getLastPlayedDate() { return localStorage.getItem(STREAK_DATE_KEY) || null; }
function isOnFire() { return localStorage.getItem(STREAK_FIRE_KEY) === '1'; }

function updateStreak() {
  const today = getPacificDateString();
  const last = getLastPlayedDate();
  let streak = getStreak();
  if (last === today) return streak;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = new Date(yesterday.getTime() + getPacificOffset(yesterday) * 60000).toISOString().slice(0,10);
  if (last === yesterdayStr) { streak++; }
  else if (last === null) { streak = 1; }
  else { streak = 1; localStorage.removeItem(STREAK_FIRE_KEY); }
  localStorage.setItem(STREAK_KEY, streak);
  localStorage.setItem(STREAK_DATE_KEY, today);
  if (streak >= FIRE_THRESHOLD) localStorage.setItem(STREAK_FIRE_KEY, '1');
  return streak;
}

function applyFireBonus(score) { return isOnFire() ? Math.round(score * 1.10) : score; }
function getStreakDisplay() { return { streak: getStreak(), fire: isOnFire() }; }

function reviveStreak() {
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
  const ys = new Date(yesterday.getTime() + getPacificOffset(yesterday)*60000).toISOString().slice(0,10);
  localStorage.setItem(STREAK_DATE_KEY, ys);
  showToast('Streak revived! 🔥 Play today to keep it going!', 'success');
}

function renderStreakBadge(container) {
  const { streak, fire } = getStreakDisplay();
  if (streak === 0) return;
  const badge = document.createElement('div');
  badge.id = 'streak-badge';
  badge.style.cssText = `display:inline-flex;align-items:center;gap:0.4rem;background:${fire?'rgba(255,100,0,0.15)':'rgba(245,197,24,0.12)'};border:1px solid ${fire?'rgba(255,100,0,0.4)':'rgba(245,197,24,0.3)'};border-radius:50px;padding:0.3rem 0.85rem;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:0.85rem;letter-spacing:0.05em;text-transform:uppercase;color:${fire?'#ff6400':'var(--gold)'};cursor:pointer;`;
  badge.innerHTML = `${fire?'🔥':'⚡'} ${streak}-Day Streak${fire?' · ON FIRE!':''}`;
  badge.onclick = () => showStreakModal();
  if (container) container.appendChild(badge);
}

function showStreakModal() {
  const { streak, fire } = getStreakDisplay();
  const last = getLastPlayedDate(), today = getTodayString();
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
  const ys = new Date(yesterday.getTime()+getPacificOffset(yesterday)*60000).toISOString().slice(0,10);
  const streakBroken = last && last !== today && last !== ys;
  let modal = document.getElementById('streak-modal'); if (modal) modal.remove();
  modal = document.createElement('div'); modal.id='streak-modal'; modal.className='modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width:420px;text-align:center;">
      <button class="modal-close" onclick="document.getElementById('streak-modal').remove()">✕</button>
      <div style="font-size:4rem;margin-bottom:0.5rem;">${fire?'🔥':streakBroken?'💔':'⚡'}</div>
      <h2 style="font-size:1.8rem;margin-bottom:0.35rem;">${fire?'ON FIRE!':streakBroken?'Streak Broken':`${streak}-Day Streak`}</h2>
      <p style="color:var(--gray-light);margin-bottom:1.25rem;font-size:0.95rem;">
        ${fire?`🔥 You've played ${streak} days in a row! All points boosted <strong style="color:#ff6400">+10%</strong> across all games!`:streakBroken?`Your streak was broken. Revive it for just $1!`:`${FIRE_THRESHOLD-streak} more day${FIRE_THRESHOLD-streak!==1?'s':''} to go On Fire 🔥 (+10% on all games!)`}
      </p>
      ${streakBroken?`<button class="btn btn-primary btn-lg" style="width:100%;justify-content:center;margin-bottom:0.75rem;background:#ff6400;" onclick="handleStreakRevive()">🔥 Revive Streak for $1</button>`:
      `<div style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap;">${[...Array(7)].map((_,i)=>`<div style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${i<streak?(fire?'#ff6400':'var(--gold)'):'rgba(255,255,255,0.06)'};border:2px solid ${i<streak?(fire?'#ff6400':'var(--gold)'):'rgba(255,255,255,0.1)'};font-weight:700;font-size:0.8rem;color:${i<streak?'var(--navy-dark)':'var(--gray)'};">${i<streak?'✓':i+1}</div>`).join('')}</div>
      <p style="font-size:0.78rem;color:var(--gray);margin-top:1rem;">Plays across Trivia, Snap Decision, and Who's That Player all count toward your streak!</p>`}
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target===modal) modal.remove(); });
}

function handleStreakRevive() {
  alert('Payment integration: Replace the Stripe link in js/auth.js to enable $1 streak revival. For now, reviving for free as a test!');
  reviveStreak();
  document.getElementById('streak-modal')?.remove();
}

(function checkStreakReviveRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('streak_revived') === '1') {
    reviveStreak();
    const url = new URL(window.location); url.searchParams.delete('streak_revived'); window.history.replaceState({}, '', url);
  }
})();
