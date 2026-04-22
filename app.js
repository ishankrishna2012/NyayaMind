'use strict';

// ================================================
// BACKEND URL — auto-detects Netlify vs localhost
// ================================================
const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? '' // relative URLs work on localhost (server.js serves everything)
  : ''; // on Netlify, /api/* is redirected to /.netlify/functions/api via netlify.toml

// ================================================
// CASE DATA — Loaded from backend (server.js)
// Falls back to empty array until loaded
// ================================================
let CASES = [];
let _casesLoaded = false;
let _casesFetchInterval = null;

// IMPORTANT: Supabase credentials are loaded at runtime from /api/config
// They are NEVER hardcoded in this file. Set SUPABASE_URL and SUPABASE_ANON_KEY
// as Netlify environment variables.
let SUPABASE_URL = '';
let SUPABASE_KEY = '';

// Load config from backend on startup
const _configLoaded = (async () => {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const cfg = await res.json();
      SUPABASE_URL = cfg.supabaseUrl || '';
      SUPABASE_KEY = cfg.supabaseAnonKey || '';
    }
  } catch (e) {
    console.warn('[Config] Could not load backend config:', e.message);
  }
})();

let supabaseClient = null;

async function initSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  
  if (window._supabase) {
    supabaseClient = window._supabase;
    console.log('[Supabase] Using cached client');
    return supabaseClient;
  }

  // Wait for config to load if not already done
  await _configLoaded;
  
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('[Supabase] No credentials available — auth features disabled');
    return null;
  }
  
  if (!window.supabase || !window.supabase.createClient) {
    console.error('[Supabase] Supabase library not loaded');
    return null;
  }
  
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    window._supabase = supabaseClient;
    console.log('[Supabase] Client initialized');
    return supabaseClient;
  } catch(err) {
    console.error('[Supabase] Failed to initialize:', err);
    return null;
  }
}

// Initialize on script load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initSupabaseClient());
} else {
  initSupabaseClient();
}

// ================================================
// CRITICAL PAGE NAVIGATION - DEFINE EARLY
// ================================================
function showPage(name) {
  if (typeof document === 'undefined') return false;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  const page = document.getElementById('page-' + name); 
  if (page) page.classList.add('active');
  const link = document.querySelector(`.nav-links a[data-page="${name}"]`); 
  if (link) link.classList.add('active');

  const robotLayer = document.getElementById('robot-bg-layer');
  if (robotLayer) robotLayer.classList.toggle('active', name === 'signup' || name === 'login');

  if (name === 'home' && typeof initTypewriter !== 'undefined') initTypewriter();
  if (name === 'compare' && typeof renderComparePage !== 'undefined') renderComparePage();
  if (name === 'dashboard' && typeof initDashboard !== 'undefined') {
    initDashboard();
    if (typeof filterCases !== 'undefined') filterCases();
    const dashPage = document.getElementById('page-dashboard');
    const currentUser = getUser();
    if (dashPage) dashPage.classList.toggle('law-firm-view', !!(currentUser && currentUser.role === 'professional'));
  }
  if (name === 'bookmarks' && typeof bmBack !== 'undefined') bmBack('bm-menu');
  if (name === 'history' && typeof histBack !== 'undefined') { 
    histBack('hist-menu');
    if (typeof loadAllHistory !== 'undefined') loadAllHistory();
  }
  if (name === 'login' && typeof initLoginPage !== 'undefined') initLoginPage();
  if (name === 'signup' && typeof initSignupPage !== 'undefined') initSignupPage();
  if (name === 'profile' && typeof initProfilePage !== 'undefined') initProfilePage();
  if (name === 'docparser' && typeof initDocParser !== 'undefined') initDocParser();
  
  // Handle moving the shared Cases UI
  const casesUi = document.getElementById('shared-cases-ui');
  if (casesUi) {
    if (name === 'cases') {
      const casesMount = document.getElementById('page-cases-inner');
      if (casesMount) casesMount.appendChild(casesUi);
      if (typeof filterCases !== 'undefined') filterCases();
    } else if (name === 'dashboard' && getUser()?.role === 'professional') {
      const proMount = document.getElementById('dash-pro-cases-mount');
      if (proMount) proMount.appendChild(casesUi);
    }
  }

  // Instantly jump to top so user sees the new page, not leftover scroll position
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.scrollTo(0, 0);
  return false;
}

function closeMobile() {
  const mobileMenu = document.getElementById('mobile-menu');
  if (mobileMenu) mobileMenu.classList.remove('active');
  return false;
}

async function logout() {
  const client = await initSupabaseClient();
  if (client && client.auth) {
    client.auth.signOut().catch(e => console.warn('Logout error:', e));
  }
  saveUser(null);
  localStorage.removeItem('nyayaUser');
  if (typeof updateNavForUser !== 'undefined') updateNavForUser(null);
  showPage('login');
}

// Setup auth state change listener when Supabase is ready
async function setupAuthStateListener() {
  const client = await initSupabaseClient();
  if (!client || !client.auth) {
    console.log('[Auth] Supabase not ready, will retry...');
    setTimeout(setupAuthStateListener, 500);
    return;
  }
  
  console.log('[Auth] Setting up auth state listener');
  client.auth.onAuthStateChange(async (event, session) => {
    console.log('[Auth] Auth state changed:', event, !!session?.user);
    if (session?.user) {
      try {
        let profile = null;
        try {
          const { data, error } = await client.from('user_profiles').select('*').eq('id', session.user.id).single();
          if (!error && data) profile = data;
        } catch(e) {
          console.log('[Auth] Profile fetch error (normal for first login):', e.message);
        }
        
        const userObj = profile ? { ...profile, email: session.user.email } : {
          email: session.user.email,
          id: session.user.id,
          name: session.user.user_metadata?.name || session.user.email.split('@')[0],
          role: session.user.user_metadata?.role || 'public',
          language: session.user.user_metadata?.language || 'en'
        };
        
        saveUser(userObj);
        if (typeof updateNavForUser !== 'undefined') updateNavForUser(userObj);
        
        const activePage = document.querySelector('.page.active');
        if (activePage && (activePage.id === 'page-login' || activePage.id === 'page-signup')) {
            showPage('dashboard');
        }
      } catch(e) {
        console.log('[Auth] Error in auth listener:', e.message);
      }
    } else {
      saveUser(null);
      if (typeof updateNavForUser !== 'undefined') updateNavForUser(null);
    }
  });
}

// Set up auth listener when document is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupAuthStateListener);
} else {
  setupAuthStateListener();
}

async function loadCasesFromBackend(query = '', filter = 'all') {
  try {
    const res = await fetch('/api/cases?limit=200');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to fetch cases');
    const data = json.cases;

    if (data && Array.isArray(data)) {
      CASES = data.map(c => ({
        id: c.id,
        title: c.title,
        court: c.court,
        year: c.year,
        type: c.type || 'Case Law',
        outcome: c.outcome || '',
        summary: c.summary,
        keywords: c.tags || [],
        views: c.views || 0,
        source: c.source || 'supabase'
      }));
      _casesLoaded = true;

      const badge = document.getElementById('live-case-count');
      if (badge) badge.textContent = `${data.length} cases loaded`;

      return true;
    }
  } catch (err) {
    console.warn('[NyayaMind] Supabase not reachable.', err.message);
  }
  return false;
}

// Poll backend every 15s to pick up newly fetched live cases
function startLiveCasePolling() {
  if (_casesFetchInterval) return;
  _casesFetchInterval = setInterval(async () => {
    const ok = await loadCasesFromBackend(currentQuery, currentFilter);
    if (ok) { filterCases(); fetchLiveStats(); updateDashboardCaseCount(); } // re-render with fresh data
  }, 15000);
}

// Update case count on dashboard
function updateDashboardCaseCount() {
  if (CASES.length === 0) {
    // Load initial cases if not loaded yet
    loadCasesFromBackend().then(ok => {
      if (ok) {
        const caseCountEl = document.getElementById('case-count');
        if (caseCountEl) caseCountEl.textContent = `${CASES.length} cases available`;
        const heroStatEl = document.getElementById('hero-stat-cases');
        if (heroStatEl) heroStatEl.textContent = CASES.length;
        
        // Re-render dashboard if user is on it
        const activePage = document.querySelector('.page.active');
        if (activePage && activePage.id === 'page-dashboard') {
          const user = getUser();
          if (user) {
            if (user.role === 'professional') initProDash(user);
            else if (user.role === 'public') initPubDash(user);
            else initDefaultDash();
          }
        }
      }
    });
  } else {
    const caseCountEl = document.getElementById('case-count');
    if (caseCountEl) caseCountEl.textContent = `${CASES.length} cases available`;
    const heroStatEl = document.getElementById('hero-stat-cases');
    if (heroStatEl) heroStatEl.textContent = CASES.length;
    const liveCountEl = document.getElementById('live-case-count');
    if (liveCountEl) liveCountEl.textContent = `${CASES.length} cases loaded`;
  }
}

let currentFilter = 'all';
let currentCases = [];
let currentQuery = '';

// ================================================
// CASE COMPARISON ENGINE
// ================================================
let compareList = []; // array of case IDs, max 3

const COMPARE_COLORS = [
  { bg: 'rgba(201,168,76,0.15)',  border: 'rgba(201,168,76,0.45)',  text: '#c9a84c',  label: 'A' },
  { bg: 'rgba(91,141,238,0.15)', border: 'rgba(91,141,238,0.45)', text: '#5b8dee',  label: 'B' },
  { bg: 'rgba(167,139,250,0.15)', border: 'rgba(167,139,250,0.45)', text: '#a78bfa', label: 'C' },
];

function toggleCompare(id, e) {
  if (e) e.stopPropagation();
  const idx = compareList.indexOf(id);
  if (idx > -1) {
    compareList.splice(idx, 1);
  } else {
    if (compareList.length >= 3) {
      showCompareToast('Maximum 3 cases can be compared at once. Remove one first.');
      return;
    }
    compareList.push(id);
  }
  renderCompareTray();
  updateCompareButtons();
}

function renderCompareTray() {
  const tray = document.getElementById('compare-tray');
  if (!tray) return; // tray is optional (removed from HTML)
  const ctCases = document.getElementById('ct-cases');
  const ctLabel = document.getElementById('ct-label');
  const ctBtn = document.getElementById('ct-compare-btn');
  if (!ctCases || !ctLabel || !ctBtn) return;

  tray.classList.toggle('visible', compareList.length > 0);
  ctLabel.textContent = `${compareList.length} case${compareList.length !== 1 ? 's' : ''} selected`;

  // Disable compare btn until 2+ cases
  ctBtn.disabled = compareList.length < 2;
  ctBtn.classList.toggle('disabled', compareList.length < 2);

  ctCases.innerHTML = compareList.map((id, i) => {
    const c = CASES.find(x => x.id === id);
    const col = COMPARE_COLORS[i];
    return `
      <div class="ct-case-chip" style="background:${col.bg};border-color:${col.border}">
        <span class="ct-chip-label" style="color:${col.text}">${col.label}</span>
        <span class="ct-chip-title">${c.title.length > 28 ? c.title.slice(0, 28) + '…' : c.title}</span>
        <button class="ct-chip-remove" onclick="toggleCompare(${id}, event)" title="Remove">✕</button>
      </div>`;
  }).join('');
}

function updateCompareButtons() {
  document.querySelectorAll('.cc-btn-compare').forEach(btn => {
    const id = parseInt(btn.dataset.id);
    const inList = compareList.includes(id);
    const idx = compareList.indexOf(id);
    const col = inList ? COMPARE_COLORS[idx] : null;
    btn.classList.toggle('in-compare', inList);
    btn.textContent = inList ? `⊖ ${COMPARE_COLORS[idx].label}` : '⊕ Compare';
    btn.style.background = inList ? col.bg : '';
    btn.style.borderColor = inList ? col.border : '';
    btn.style.color = inList ? col.text : '';
  });
}

function clearAllCompare() {
  compareList = [];
  renderCompareTray();
  updateCompareButtons();
  // clear compare page results
  const results = document.getElementById('compare-results');
  if (results) results.innerHTML = '';
  renderComparePage();
}

function goToComparePage() {
  showPage('compare');
}

function renderComparePage() {
  const emptyState = document.getElementById('compare-empty-state');
  const activeView = document.getElementById('compare-active-view');
  if (!emptyState || !activeView) return;

  if (compareList.length === 0) {
    emptyState.style.display = 'block';
    activeView.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  activeView.style.display = 'block';

  const countLabel = document.getElementById('compare-count-label');
  if (countLabel) countLabel.textContent = `${compareList.length} case${compareList.length !== 1 ? 's' : ''} selected`;

  // Render chips
  const chipsRow = document.getElementById('compare-chips-row');
  if (chipsRow) {
    chipsRow.innerHTML = compareList.map((id, i) => {
      const c = CASES.find(x => x.id === id);
      const col = COMPARE_COLORS[i];
      return `
        <div class="compare-chip-full" style="background:${col.bg};border-color:${col.border}">
          <span class="ccf-badge" style="background:${col.text};color:#06080f">${col.label}</span>
          <div class="ccf-info">
            <strong>${c.title}</strong>
            <span>${c.court} · ${c.year} · ${c.type}</span>
          </div>
          <button class="ccf-remove" onclick="toggleCompare(${id}, event)">✕</button>
        </div>`;
    }).join('');
  }

  // Clear results - wait for user to click "Run"
  const runBtn = document.getElementById('compare-run-btn');
  if (runBtn) runBtn.disabled = compareList.length < 2;
}

function runComparison() {
  if (compareList.length < 2) return;
  const cases = compareList.map(id => CASES.find(c => c.id === id));
  const results = document.getElementById('compare-results');
  if (!results) return;

  results.innerHTML = buildComparisonHTML(cases);

  // Animate bars in
  setTimeout(() => {
    results.querySelectorAll('.sim-fill').forEach(bar => {
      const w = bar.dataset.width;
      bar.style.width = w + '%';
    });
  }, 80);
}

// Core similarity: Jaccard on keyword sets + text overlap
function computeSimilarity(cA, cB) {
  const setA = new Set(cA.keywords.map(k => k.toLowerCase()));
  const setB = new Set(cB.keywords.map(k => k.toLowerCase()));

  const intersection = [...setA].filter(k => setB.has(k));
  const union = new Set([...setA, ...setB]);
  const kwScore = union.size > 0 ? (intersection.length / union.size) * 100 : 0;

  // Court match bonus
  const courtMatch = cA.court === cB.court ? 15 : 0;
  // Type match bonus
  const typeMatch = cA.type === cB.type ? 20 : 0;
  // Year proximity (within 10 years = partial bonus)
  const yearDiff = Math.abs(cA.year - cB.year);
  const yearScore = yearDiff <= 5 ? 10 : yearDiff <= 15 ? 5 : 0;

  // Word overlap in summaries
  const wordsA = new Set(cA.summary.toLowerCase().split(/\W+/).filter(w => w.length > 4));
  const wordsB = new Set(cB.summary.toLowerCase().split(/\W+/).filter(w => w.length > 4));
  const wordInter = [...wordsA].filter(w => wordsB.has(w));
  const wordUnion = new Set([...wordsA, ...wordsB]);
  const textScore = wordUnion.size > 0 ? (wordInter.length / wordUnion.size) * 35 : 0;

  const raw = kwScore * 0.4 + textScore + courtMatch + typeMatch + yearScore;
  return Math.min(Math.round(raw), 100);
}

function getSimLabel(score) {
  if (score >= 75) return { label: 'Highly Similar', cls: 'sim-high' };
  if (score >= 50) return { label: 'Moderately Similar', cls: 'sim-mid' };
  if (score >= 25) return { label: 'Somewhat Related', cls: 'sim-low' };
  return { label: 'Distinct Cases', cls: 'sim-none' };
}

function getSharedKeywords(cA, cB) {
  const setA = new Set(cA.keywords.map(k => k.toLowerCase()));
  return cB.keywords.filter(k => setA.has(k.toLowerCase()));
}

function getUniqueKeywords(c, others) {
  const otherKws = new Set(others.flatMap(o => o.keywords.map(k => k.toLowerCase())));
  return c.keywords.filter(k => !otherKws.has(k.toLowerCase()));
}

function buildComparisonHTML(cases) {
  const n = cases.length;
  const colWidth = n === 2 ? '50%' : '33.33%';

  // --- Overall similarity section ---
  let simPairsHTML = '';
  if (n >= 2) {
    const pairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const score = computeSimilarity(cases[i], cases[j]);
        const { label, cls } = getSimLabel(score);
        pairs.push({ i, j, score, label, cls });
      }
    }

    simPairsHTML = `
      <div class="comp-section">
        <div class="comp-section-title">📊 Similarity Scores</div>
        <div class="sim-pairs-grid">
          ${pairs.map(p => `
            <div class="sim-pair-card">
              <div class="sim-pair-labels">
                <span class="sim-pair-badge" style="background:${COMPARE_COLORS[p.i].bg};border-color:${COMPARE_COLORS[p.i].border};color:${COMPARE_COLORS[p.i].text}">${COMPARE_COLORS[p.i].label}</span>
                <span class="sim-pair-vs">vs</span>
                <span class="sim-pair-badge" style="background:${COMPARE_COLORS[p.j].bg};border-color:${COMPARE_COLORS[p.j].border};color:${COMPARE_COLORS[p.j].text}">${COMPARE_COLORS[p.j].label}</span>
              </div>
              <div class="sim-score-row">
                <div class="sim-track"><div class="sim-fill ${p.cls}" data-width="${p.score}" style="width:0%"></div></div>
                <span class="sim-pct ${p.cls}">${p.score}%</span>
              </div>
              <div class="sim-label-text ${p.cls}">${p.label}</div>
              <div class="sim-case-names">
                <span>${cases[p.i].title.length > 30 ? cases[p.i].title.slice(0,30)+'…' : cases[p.i].title}</span>
                <span>${cases[p.j].title.length > 30 ? cases[p.j].title.slice(0,30)+'…' : cases[p.j].title}</span>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  // --- Keyword analysis ---
  // Shared across all
  const allKwSets = cases.map(c => new Set(c.keywords.map(k => k.toLowerCase())));
  const sharedByAll = cases[0].keywords.filter(k =>
    allKwSets.every(s => s.has(k.toLowerCase()))
  );
  // Shared between pairs (if 3 cases)
  const pairShared = n === 3 ? [
    getSharedKeywords(cases[0], cases[1]).filter(k => !sharedByAll.includes(k)),
    getSharedKeywords(cases[0], cases[2]).filter(k => !sharedByAll.includes(k)),
    getSharedKeywords(cases[1], cases[2]).filter(k => !sharedByAll.includes(k)),
  ] : [];

  const kwSectionHTML = `
    <div class="comp-section">
      <div class="comp-section-title">🏷️ Keyword Analysis</div>
      ${sharedByAll.length ? `
        <div class="kw-shared-all">
          <span class="kw-shared-label">Common to all ${n} cases:</span>
          ${sharedByAll.map(k => `<span class="kw-chip kw-shared">${k}</span>`).join('')}
        </div>` : '<div class="kw-shared-all kw-none-shared">No keywords shared across all selected cases</div>'}
      ${n === 3 && pairShared.some(ps => ps.length > 0) ? `
        <div class="kw-pair-shares">
          ${pairShared.map((ps, pi) => ps.length ? `
            <div class="kw-pair-row">
              <span class="kw-pair-label" style="color:${COMPARE_COLORS[Math.floor(pi/1.5)].text}">
                ${COMPARE_COLORS[pi === 0 ? 0 : pi === 1 ? 0 : 1].label} & ${COMPARE_COLORS[pi === 0 ? 1 : pi === 1 ? 2 : 2].label} only:
              </span>
              ${ps.map(k => `<span class="kw-chip kw-pair">${k}</span>`).join('')}
            </div>` : '').join('')}
        </div>` : ''}
    </div>`;

  // --- Side-by-side columns ---
  const columnsHTML = `
    <div class="comp-section">
      <div class="comp-section-title">📋 Side-by-Side Details</div>
      <div class="comp-columns" style="--col-width:${colWidth}">
        ${cases.map((c, i) => {
          const col = COMPARE_COLORS[i];
          const uniqueKws = getUniqueKeywords(c, cases.filter((_, j) => j !== i));
          return `
            <div class="comp-col" style="border-top:3px solid ${col.text}">
              <div class="comp-col-header" style="background:${col.bg}">
                <span class="comp-col-badge" style="background:${col.text};color:#06080f">${col.label}</span>
                <h3 class="comp-col-title">${c.title}</h3>
              </div>
              <div class="comp-col-body">
                <div class="comp-field">
                  <span class="comp-field-label">Court</span>
                  <span class="comp-field-value">${c.court}</span>
                </div>
                <div class="comp-field">
                  <span class="comp-field-label">Year</span>
                  <span class="comp-field-value">${c.year}</span>
                </div>
                <div class="comp-field">
                  <span class="comp-field-label">Type</span>
                  <span class="comp-field-value comp-type-badge" style="background:var(--blue-soft);color:var(--blue)">${c.type}</span>
                </div>
                <div class="comp-field">
                  <span class="comp-field-label">Outcome</span>
                  <span class="comp-field-value comp-outcome">${c.outcome}</span>
                </div>
                <div class="comp-field comp-field-summary">
                  <span class="comp-field-label">Summary</span>
                  <p class="comp-summary-text">${c.summary}</p>
                </div>
                <div class="comp-field">
                  <span class="comp-field-label">All Keywords</span>
                  <div class="comp-kw-list">
                    ${c.keywords.map(k => {
                      const isShared = sharedByAll.includes(k.toLowerCase()) || sharedByAll.includes(k);
                      return `<span class="kw-chip ${isShared ? 'kw-shared' : 'kw-unique'}" title="${isShared ? 'Shared with other cases' : 'Unique to this case'}">${k}</span>`;
                    }).join('')}
                  </div>
                </div>
                ${uniqueKws.length ? `
                  <div class="comp-field">
                    <span class="comp-field-label">Unique to this case</span>
                    <div class="comp-kw-list">
                      ${uniqueKws.map(k => `<span class="kw-chip kw-exclusive" style="border-color:${col.border};color:${col.text}">${k}</span>`).join('')}
                    </div>
                  </div>` : ''}
                <div class="comp-col-actions">
                  <button class="comp-view-btn" onclick="openCase('${c.id}')">View Full Case →</button>
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;

  // --- Quick stats comparison table ---
  const statsHTML = `
    <div class="comp-section">
      <div class="comp-section-title">📈 Quick Comparison Table</div>
      <div class="comp-table-wrap">
        <table class="comp-table">
          <thead>
            <tr>
              <th>Attribute</th>
              ${cases.map((c, i) => `<th><span class="ct-th-badge" style="background:${COMPARE_COLORS[i].bg};border:1px solid ${COMPARE_COLORS[i].border};color:${COMPARE_COLORS[i].text}">${COMPARE_COLORS[i].label}</span></th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr><td class="ct-attr">Case Title</td>${cases.map(c => `<td>${c.title}</td>`).join('')}</tr>
            <tr><td class="ct-attr">Court</td>${cases.map(c => `<td>${c.court}</td>`).join('')}</tr>
            <tr><td class="ct-attr">Year</td>${cases.map(c => `<td>${c.year}</td>`).join('')}</tr>
            <tr><td class="ct-attr">Law Type</td>${cases.map(c => `<td><span class="comp-type-badge" style="background:var(--blue-soft);color:var(--blue);padding:2px 8px;border-radius:999px;font-size:11px">${c.type}</span></td>`).join('')}</tr>
            <tr><td class="ct-attr">Keywords</td>${cases.map(c => `<td>${c.keywords.length}</td>`).join('')}</tr>
            <tr><td class="ct-attr">Outcome</td>${cases.map(c => `<td style="font-size:12px">${c.outcome}</td>`).join('')}</tr>
          </tbody>
        </table>
      </div>
    </div>`;

  return `
    <div class="comparison-view">
      ${simPairsHTML}
      ${kwSectionHTML}
      ${columnsHTML}
      ${statsHTML}
      <div class="comp-footer">
        <button class="btn-secondary" onclick="clearAllCompare()">✕ Clear Comparison</button>
        <button class="btn-primary" onclick="showPage('cases')">+ Add More Cases</button>
      </div>
    </div>`;
}

// Toast for compare limit
function showCompareToast(msg) {
  // Use pdf-toast style (dynamically created) since translate-toast was removed
  showPdfToast(msg);
}

// ================================================
// CONFIDENCE SCORING
// ================================================
function computeConfidence(c, query) {
  if (!query || query.length < 2) return null;
  const q = query.toLowerCase();
  let score = 0;
  const titleLow = c.title.toLowerCase();
  if (titleLow === q) score += 35;
  else if (titleLow.includes(q)) score += 28;
  else if (q.split(' ').some(w => w.length > 2 && titleLow.includes(w))) score += 16;
  const kwMatches = c.keywords.filter(k => k.includes(q) || q.includes(k) || q.split(' ').some(w => w.length > 2 && k.includes(w)));
  score += Math.min(kwMatches.length * 12, 35);
  const sumLow = c.summary.toLowerCase();
  if (sumLow.includes(q)) score += 20;
  else if (q.split(' ').filter(w => w.length > 3).some(w => sumLow.includes(w))) score += 10;
  if (c.court.toLowerCase().includes(q) || c.type.toLowerCase().includes(q)) score += 10;
  if (String(c.year).includes(q)) score += 5;
  return Math.min(score, 100);
}
function getConfidenceClass(score) { if (score >= 65) return 'high'; if (score >= 35) return 'mid'; return 'low'; }
function getConfidenceLabel(score) { if (score >= 80) return 'Strong Match'; if (score >= 65) return 'Good Match'; if (score >= 45) return 'Partial Match'; return 'Weak Match'; }

// ================================================
// FEEDBACK SYSTEM
// ================================================
function getFeedbacks() { try { return JSON.parse(localStorage.getItem('caseFeedback') || '{}'); } catch(e) { return {}; } }
function saveFeedbacks(f) { localStorage.setItem('caseFeedback', JSON.stringify(f)); }
function submitFeedback(caseId, type) {
  const f = getFeedbacks();
  if (f[caseId] === type) { delete f[caseId]; } else { f[caseId] = type; }
  saveFeedbacks(f);
  updateCardFeedback(caseId);
  updateModalFeedback(caseId);
}
function getFeedbackForCase(id) { return getFeedbacks()[id] || null; }
function updateCardFeedback(caseId) {
  const row = document.getElementById(`fb-row-${caseId}`);
  if (!row) return;
  const current = getFeedbackForCase(caseId);
  row.querySelector('.fb-btn.fb-useful').classList.toggle('active', current === 'useful');
  row.querySelector('.fb-btn.fb-irrelevant').classList.toggle('active', current === 'not_relevant');
}
function updateModalFeedback(caseId) {
  const note = document.getElementById('modal-fb-note');
  const usefulBtn = document.getElementById('modal-fb-useful');
  const irrelevantBtn = document.getElementById('modal-fb-irrelevant');
  if (!note || !usefulBtn || !irrelevantBtn) return;
  const current = getFeedbackForCase(caseId);
  usefulBtn.className = 'modal-fb-btn' + (current === 'useful' ? ' active-useful' : '');
  irrelevantBtn.className = 'modal-fb-btn' + (current === 'not_relevant' ? ' active-irrelevant' : '');
  if (current === 'useful') note.textContent = '✅ Marked as useful — helps improve recommendations';
  else if (current === 'not_relevant') note.textContent = '🚫 Marked not relevant — we\'ll refine your results';
  else note.textContent = '';
}
function getUsefulVotesCount() { const f = getFeedbacks(); return Object.values(f).filter(v => v === 'useful').length; }

// ================================================
// NOTES SYSTEM
// ================================================
function getNotes() { try { return JSON.parse(localStorage.getItem('caseNotes') || '{}'); } catch(e) { return {}; } }
function saveNotes(n) { localStorage.setItem('caseNotes', JSON.stringify(n)); }
function saveNoteForCase(caseId, text) { const n = getNotes(); if (text.trim()) n[caseId] = text.trim(); else delete n[caseId]; saveNotes(n); }
function getNoteForCase(id) { return getNotes()[id] || ''; }
function toggleNotePanel(caseId) {
  const panel = document.getElementById(`note-panel-${caseId}`);
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  if (!isOpen) { const ta = panel.querySelector('textarea'); if (ta) ta.focus(); }
}
function saveNoteUI(caseId) {
  const ta = document.getElementById(`note-ta-${caseId}`);
  const btn = document.getElementById(`note-btn-${caseId}`);
  if (!ta) return;
  saveNoteForCase(caseId, ta.value);
  const note = getNoteForCase(caseId);
  if (btn) { btn.classList.toggle('has-note', !!note); btn.textContent = note ? '📝 Notes ✓' : '📝 Notes'; }
  const preview = document.getElementById(`note-preview-${caseId}`);
  if (preview) { preview.textContent = note ? note.slice(0, 100) + (note.length > 100 ? '…' : '') : ''; preview.style.display = note ? 'block' : 'none'; }
  const footer = document.getElementById(`note-chars-${caseId}`);
  if (footer) { footer.textContent = '✅ Saved!'; setTimeout(() => { if(footer) footer.textContent = ta.value.length + ' chars'; }, 1500); }
}

// ================================================
// VOICE SEARCH
// ================================================
let recognition = null;
let isListening = false;
function toggleVoiceSearch() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) { alert('Voice search is not supported in your browser.'); return; }
  if (isListening) { stopVoice(); return; }
  recognition = new SpeechRec();
  recognition.lang = 'en-IN'; recognition.interimResults = false; recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    isListening = true;
    const mb = document.getElementById('micBtn'); if (mb) mb.classList.add('listening');
    // voice-toast is optional
    const vt = document.getElementById('voice-toast'); if (vt) vt.classList.add('show');
    showPdfToast('🎤 Listening…');
  };
  recognition.onresult = (event) => {
    const t = event.results[0][0].transcript;
    const inp = document.getElementById('searchInput') || document.getElementById('searchInputPub');
    if (inp) { inp.value = t; filterCases(); }
    stopVoice();
  };
  recognition.onerror = (event) => { stopVoice(); if (event.error === 'not-allowed') alert('Microphone access denied.'); };
  recognition.onend = () => { stopVoice(); };
  recognition.start();
}
function stopVoice() {
  isListening = false;
  const mb = document.getElementById('micBtn'); if (mb) mb.classList.remove('listening');
  const vt = document.getElementById('voice-toast'); if (vt) vt.classList.remove('show');
  if (recognition) { try { recognition.stop(); } catch(e) {} recognition = null; }
}

// ================================================
// STORAGE HELPERS
// ================================================
function getAllAccounts() { try { return JSON.parse(localStorage.getItem('nyayaAccounts') || '[]'); } catch(e) { return []; } }
function saveAllAccounts(accounts) { localStorage.setItem('nyayaAccounts', JSON.stringify(accounts)); }
function getUser() { try { return JSON.parse(localStorage.getItem('nyayaUser') || 'null'); } catch(e) { return null; } }
function saveUser(u) { localStorage.setItem('nyayaUser', JSON.stringify(u)); }



// ================================================
// PAGE NAVIGATION (Duplicates removed - defined at top of file)
// ================================================


// ================================================
// TYPEWRITER
// ================================================
function initTypewriter() {
  const el = document.getElementById('typewriter-text'); if (!el) return;
  const text = 'Your Personal Law Assistant'; let i = 0;
  el.innerHTML = '<span class="cursor"></span>';
  function type() { if (i <= text.length) { el.textContent = text.slice(0, i); el.appendChild(Object.assign(document.createElement('span'), { className: 'cursor' })); i++; setTimeout(type, 75); } }
  type();
}

// ================================================
// LOGIN
// ================================================
function initLoginPage() {
  const loginError = document.getElementById('login-error'); const emailInput = document.getElementById('login-email'); const passInput = document.getElementById('login-password');
  if (loginError) loginError.style.display = 'none'; if (emailInput) emailInput.value = ''; if (passInput) passInput.value = '';
  const savedSection = document.getElementById('saved-accounts-section'); 
  if (savedSection) savedSection.style.display = 'none';
}
async function doLogin() {
  const email = (document.getElementById('login-email')?.value || '').trim().toLowerCase(); 
  const password = document.getElementById('login-password')?.value || '';
  const errorEl = document.getElementById('login-error');
  
  console.log('[Login] Starting login for:', email);
  
  if (!email || !email.includes('@')) { 
    showAuthError(errorEl, 'Please enter a valid email address.'); 
    return; 
  }
  if (!password) { 
    showAuthError(errorEl, 'Please enter a password.'); 
    return; 
  }
  
  // Show loading state
  const loginBtn = document.querySelector('.su-btn[onclick="doLogin()"]');
  if (loginBtn) loginBtn.disabled = true;
  
  try {
    // Ensure Supabase is initialized
    const client = await initSupabaseClient();
    console.log('[Login] Supabase client ready:', !!client);
    
    if (!client || !client.auth) {
      throw new Error('Supabase client not available');
    }
    
    console.log('[Login] Attempting authentication...');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    
    console.log('[Login] Auth response - error:', error, 'data:', data);
    
    if (error) { 
      console.error('[Login] Auth error:', error);
      
      // Fallback for Demo Accounts
      if (password === 'NyayaMind@123') {
        console.log('[Login] Using demo fallback for:', email);
        const isPro = email.toLowerCase().includes('pro');
        const userObj = {
          email: email,
          id: 'demo-user-' + Date.now(),
          name: email.split('@')[0],
          role: isPro ? 'professional' : 'public',
          language: 'en'
        };
        saveUser(userObj);
        if (typeof updateNavForUser !== 'undefined') updateNavForUser(userObj);
        showPage('dashboard');
        if (loginBtn) loginBtn.disabled = false;
        return;
      }
      
      showAuthError(errorEl, error.message);
      if (loginBtn) loginBtn.disabled = false;
      return;
    }
    
    // Successful login — build user object
    console.log('[Login] Login successful, user:', data?.user?.email);
    
    const userMetadata = data.user.user_metadata || {};
    let userObj = {
      email: data.user.email,
      id: data.user.id,
      name: userMetadata.name || data.user.email.split('@')[0],
      role: userMetadata.role || 'public',
      language: userMetadata.language || 'en'
    };

    // Try to get richer profile from user_profiles table
    try {
      const { data: profile, error: profileErr } = await client
        .from('user_profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();
      if (!profileErr && profile) {
        userObj = { ...profile, email: data.user.email };
        console.log('[Login] Profile loaded from DB:', profile.name, '|', profile.role);
      }
    } catch(profileEx) {
      console.log('[Login] Could not fetch profile (using metadata):', profileEx.message);
    }

    // Save to localStorage and refresh nav immediately
    saveUser(userObj);
    if (typeof updateNavForUser !== 'undefined') updateNavForUser(userObj);
    
    console.log('[Login] User ready:', userObj.name, '| Role:', userObj.role);
    console.log('[Login] Navigating to dashboard...');
    showPage('dashboard');
    if (loginBtn) loginBtn.disabled = false;
    
  } catch(err) {
    console.error('[Login] Caught error:', err);
    showAuthError(errorEl, 'Login error: ' + (err.message || 'Unknown error'));
    if (loginBtn) loginBtn.disabled = false;
  }
}
function showAuthError(el, msg) { if (!el) return; el.innerHTML = msg; el.style.display = 'block'; setTimeout(() => { if (el) el.style.display = 'none'; }, 5000); }
function confirmLogout() { if (confirm('Are you sure you want to sign out?')) logout(); }
function updateNavForUser(user) {
  const guestActions = document.getElementById('nav-guest-actions'); const navUser = document.getElementById('nav-user'); const navUserName = document.getElementById('nav-user-name'); const navAvatar = document.getElementById('nav-user-avatar');
  const casesLink = document.getElementById('nav-cases-link');
  if (user) { 
    if (guestActions) guestActions.style.display = 'none'; 
    if (navUser) navUser.style.display = 'flex'; 
    if (navUserName) navUserName.textContent = user.name.split(' ')[0]; 
    if (navAvatar) navAvatar.textContent = user.name.charAt(0).toUpperCase(); 
    if (casesLink) casesLink.style.display = user.role === 'public' ? 'inline-block' : 'none';
  } else { 
    if (guestActions) guestActions.style.display = 'flex'; 
    if (navUser) navUser.style.display = 'none'; 
    if (casesLink) casesLink.style.display = 'none';
  }
}

// ================================================
// SIGN UP
// ================================================
let suData = { name: '', email: '', password: '', role: '' };
function initSignupPage() {
  suData = { name: '', email: '', password: '', role: '' };
  goToStep(1);
  document.getElementById('su-name').value = ''; document.getElementById('su-email').value = ''; document.getElementById('su-password').value = ''; document.getElementById('su-auth-error').style.display = 'none';
  document.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
  
  const signupPage = document.getElementById('page-signup');
  if (signupPage) signupPage.classList.remove('professional-signup');
  const robotLayer = document.getElementById('robot-bg-layer');
  if (robotLayer) robotLayer.classList.add('active');
}

function suNext(step) {
  if (step === 1) {
    const name = document.getElementById('su-name').value.trim(); const email = document.getElementById('su-email').value.trim().toLowerCase(); const password = document.getElementById('su-password').value; const errorEl = document.getElementById('su-auth-error');
    if (!name) { shakeField('su-name', 'Please enter your name'); return; }
    if (!email || !email.includes('@')) { shakeField('su-email', 'Enter a valid email'); return; }
    if (password.length < 6) { shakeField('su-password', 'Password must be 6+ chars'); return; }
    errorEl.style.display = 'none'; suData.name = name; suData.email = email; suData.password = password; goToStep(2);
  }
}
function suBack(step) { goToStep(step - 1); }
function goToStep(n) {
  document.querySelectorAll('.signup-step').forEach(s => s.style.display = 'none');
  const target = document.getElementById('step-' + n); if (target) target.style.display = 'block';
  [1,2].forEach(i => { const dot = document.getElementById('sdot-' + i); if (!dot) return; dot.classList.toggle('active', i <= n); dot.classList.toggle('done', i < n); });
}
function selectRole(role) {
  suData.role = role;
  document.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
  document.getElementById(role === 'professional' ? 'role-pro' : 'role-pub').classList.add('selected');
  const signupPage = document.getElementById('page-signup');
  const robotLayer = document.getElementById('robot-bg-layer');
  if (role === 'professional') {
    if (signupPage) signupPage.classList.add('professional-signup');
    if (robotLayer) robotLayer.classList.remove('active');
  } else {
    if (signupPage) signupPage.classList.remove('professional-signup');
    if (robotLayer) robotLayer.classList.add('active');
  }
}

async function suSubmit() {
  if (!suData.role) { alert('Please select a role.'); return; }
  
  const client = initSupabaseClient();
  if (!client || !client.auth) {
    alert('Signup error: Supabase not available');
    return;
  }
  
  const { data, error } = await client.auth.signUp({
    email: suData.email,
    password: suData.password,
    options: { data: { name: suData.name, role: suData.role } }
  });
  if (error) { alert('Signup error: ' + error.message); return; }
  
  document.querySelectorAll('.signup-step').forEach(s => s.style.display = 'none');
  document.getElementById('step-success').style.display = 'block';
  const roleLabel = suData.role === 'professional' ? 'Law Professional' : 'General Public';
  document.getElementById('su-welcome-msg').textContent = `You're registered as a ${roleLabel}.`;
}
function goToDashboard() { showPage('dashboard'); }
function shakeField(id, placeholder) { const el = document.getElementById(id); if (!el) return; el.placeholder = placeholder; el.style.borderColor = '#ef4444'; el.classList.add('field-error'); setTimeout(() => { el.classList.remove('field-error'); el.style.borderColor = ''; }, 1800); }

// ================================================
// CASES
// ================================================

let searchDebounceTimer = null;

async function doAISearch(query) {
  if (!query) return query;
  try {
    const res = await fetch('/api/ai-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    if (data.success && data.optimized) {
      console.log('AI Optimized Search:', data.optimized);
      return data.optimized.toLowerCase();
    }
  } catch(e) {
    console.warn("AI search error", e);
  }
  return query;
}

async function filterCases() {
  const rawQuery = (document.getElementById('searchInput')?.value || document.getElementById('searchInputPub')?.value || '').toLowerCase().trim();
  
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  
  searchDebounceTimer = setTimeout(async () => {
    currentQuery = rawQuery;
    let searchTerms = currentQuery;
    
    // If it's a long natural language query, ask AI to extract keywords
    if (currentQuery.length > 15) {
      document.getElementById('case-count').innerHTML = `<i>AI optimizing search...</i>`;
      searchTerms = await doAISearch(currentQuery);
    }
    
    // split terms if it's comma separated
    const keywords = searchTerms.split(',').map(s => s.trim()).filter(Boolean);
    
    currentCases = CASES.filter(c => {
      const matchFilter = currentFilter === 'all' || c.court.includes(currentFilter) || c.type === currentFilter;
      if (!currentQuery) return matchFilter;
      
      let matchQuery = false;
      for (const kw of keywords) {
          if (c.title.toLowerCase().includes(kw) || 
              c.court.toLowerCase().includes(kw) || 
              c.type.toLowerCase().includes(kw) || 
              c.keywords.some(k => k.includes(kw) || kw.includes(k)) || 
              c.summary.toLowerCase().includes(kw) || 
              String(c.year).includes(kw)) {
              matchQuery = true;
              break;
          }
      }
      return matchFilter && matchQuery;
    });

    if (currentQuery) { 
      currentCases.sort((a, b) => (computeConfidence(b, currentQuery) || 0) - (computeConfidence(a, currentQuery) || 0)); 
    } else {
      currentCases.forEach(c => { if (c.views === undefined) c.views = Math.floor(Math.random() * 5000) + 500; });
      currentCases.sort((a, b) => b.views - a.views);
    }
    
    // Limit to 4 max cases for the dashboard integration in Pro view, but public view could use more.
    // Let's limit to 10.
    currentCases = currentCases.slice(0, 10);
    renderCases();
    
    if (currentQuery.length > 2) {
      const hist = JSON.parse(localStorage.getItem('searchHistory') || '[]');
      if (!hist.includes(currentQuery)) { hist.unshift(currentQuery); localStorage.setItem('searchHistory', JSON.stringify(hist.slice(0, 50))); }
    }
  }, 500);
}
function setFilter(filter, btn) { currentFilter = filter; document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); filterCases(); }

let currentGallery = null;

function renderCases() {
  const container = document.getElementById('gallery-container');
  const countEl = document.getElementById('case-count');
  if (!container) return;
  countEl.textContent = `Showing ${currentCases.length} of ${CASES.length} cases`;
  
  if (currentGallery) {
    currentGallery.destroy();
    currentGallery = null;
  }

  if (!currentCases.length) {
    container.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-dim)"><div style="font-size:40px;margin-bottom:16px">🔍</div>No cases found. Try a different search.</div>`;
    return;
  }
  container.innerHTML = ''; // clear error msg if any

  const items = currentCases.map(c => {
    return {
      caseData: c
    };
  });

  // Initialize WebGL gallery (handle case where module might still be loading)
  if (window.initCircularGallery) {
    currentGallery = window.initCircularGallery(container, items, renderActiveCaseBoard);
  } else {
    // Retry shortly if the module is parsing
    setTimeout(renderCases, 100);
  }
}

function renderActiveCaseBoard(c) {
  const board = document.getElementById('active-case-board');
  if (!board) return;
  if (!c) {
    board.classList.remove('show');
    return;
  }
  
  const inCompare = compareList.includes(c.id);
  const compareIdx = compareList.indexOf(c.id);
  const col = inCompare ? COMPARE_COLORS[compareIdx] : null;
  const feedback = getFeedbackForCase(c.id);
  
  board.innerHTML = `
    <div class="acb-title">${c.title}</div>
    <div class="acb-meta">${c.court} • ${c.year} • ${c.type} Law</div>
    <div class="acb-summary">${c.summary.substring(0, 250)}...</div>
    <div class="acb-actions">
      <button class="cc-btn-bm" id="acb-bm-btn-${c.id}" onclick="toggleBookmark('${c.id}', event); renderActiveCaseBoard(CASES.find(x => x.id == '${c.id}'))">${isBookmarked(c.id) ? '🔖 Saved' : '+ Save'}</button>
      <button class="cc-btn-compare ${inCompare ? 'in-compare' : ''}" onclick="toggleCompare('${c.id}', event); renderActiveCaseBoard(CASES.find(x => x.id == '${c.id}'))"
        style="${inCompare ? `background:${col.bg};border-color:${col.border};color:${col.text}` : ''}">
        ${inCompare ? `⊖ ${col.label}` : '⊕ Compare'}
      </button>
      <button class="cc-btn-pdf" onclick="downloadCasePDF('${c.id}', event)">⬇ PDF</button>
      <button class="fb-btn ${feedback === 'useful' ? 'active-useful' : ''}" onclick="submitFeedback('${c.id}', 'useful'); renderActiveCaseBoard(CASES.find(x => x.id == '${c.id}'))" style="${feedback === 'useful' ? 'background:rgba(74,222,128,0.1);color:#4ade80' : ''}">👍</button>
      <button class="fb-btn ${feedback === 'not_relevant' ? 'active-irrelevant' : ''}" onclick="submitFeedback('${c.id}', 'not_relevant'); renderActiveCaseBoard(CASES.find(x => x.id == '${c.id}'))" style="${feedback === 'not_relevant' ? 'background:rgba(248,113,113,0.1);color:#f87171' : ''}">👎</button>
    </div>
  `;
  board.classList.add('show');
}


// ================================================
// BOOKMARKS
// ================================================
function getBookmarks() { return JSON.parse(localStorage.getItem('bookmarks') || '[]'); }
function saveBookmarks(b) { localStorage.setItem('bookmarks', JSON.stringify(b)); }
function isBookmarked(id) { return getBookmarks().some(b => b.id == id); }
function toggleBookmark(id, e) {
  if (e) e.stopPropagation();
  const c = CASES.find(x => x.id == id); if (!c) return;
  let b = getBookmarks();
  let saved = false;
  if (isBookmarked(id)) { 
    b = b.filter(x => x.id != id); 
  } else { 
    b.push({ id: c.id, title: c.title, court: c.court, year: c.year, type: c.type, savedAt: Date.now() }); 
    saved = true;
  }
  saveBookmarks(b); 
  if (typeof renderCases === 'function') renderCases();
  if (typeof filterCases === 'function') filterCases(); // in case user is in list view
  
  // Show toast notification
  if (typeof showPdfToast === 'function') {
    showPdfToast(saved ? 'Case Saved to Bookmarks!' : 'Removed from Bookmarks');
  } else {
    // Basic fallback notification if showPdfToast not available
    const toast = document.createElement('div');
    toast.className = 'pdf-toast';
    toast.textContent = saved ? 'Case Saved to Bookmarks!' : 'Removed from Bookmarks';
    document.body.appendChild(toast);
    setTimeout(() => { toast.classList.add('show'); }, 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
  }
}
function bmOpen(sid) {
  document.getElementById('bm-menu').style.display = 'none';
  document.querySelectorAll('.sub-section').forEach(s => { if (s.closest('#page-bookmarks')) s.style.display = 'none'; });
  const sec = document.getElementById(sid); if (sec) sec.style.display = 'block';
  if (sid === 'bm-saved') renderBmList(); if (sid === 'bm-stats') renderBmStats();
}
function bmBack(menuId) { document.querySelectorAll('#page-bookmarks .sub-section').forEach(s => s.style.display = 'none'); document.getElementById(menuId).style.display = 'block'; }
function renderBmList() {
  const b = getBookmarks(); const el = document.getElementById('bm-list');
  if (!b.length) { el.innerHTML = `<div class="empty-state"><div class="es-icon">🔖</div>No bookmarks yet. Save cases while searching!</div>`; return; }
  el.innerHTML = b.map((c, i) => {
    const note = getNoteForCase(c.id); const feedback = getFeedbackForCase(c.id);
    const fbBadge = feedback === 'useful' ? ' <span style="color:#4ade80;font-size:11px">👍 Useful</span>' : feedback === 'not_relevant' ? ' <span style="color:#f87171;font-size:11px">👎 Not Relevant</span>' : '';
    return `<div class="data-card"><h4>${c.title}${fbBadge}</h4><p>${c.court} • ${c.year} • ${c.type}${note ? ' · 📝 Has note' : ''}</p>
      <div class="dc-actions">
        <button class="cc-btn cc-btn-view" onclick="openCase('${c.id}')">View</button>
        <button id="note-btn-${c.id}" class="notes-toggle-btn ${note ? 'has-note' : ''}" onclick="toggleNotePanel(${c.id})">📝 ${note ? 'Notes ✓' : 'Notes'}</button>
        <button class="danger-btn" onclick="removeBm(${i})" style="padding:7px 14px;font-size:12px">Remove</button>
      </div>
      <div class="notes-panel ${note ? 'open' : ''}" id="note-panel-${c.id}">
        <textarea id="note-ta-${c.id}" placeholder="Add your notes about this case…" oninput="document.getElementById('note-chars-${c.id}').textContent=this.value.length+' chars'">${note}</textarea>
        <div class="notes-panel-footer"><span class="note-chars" id="note-chars-${c.id}">${note.length} chars</span><button class="save-note-btn" onclick="saveNoteUI(${c.id})">Save Note</button></div>
      </div>
      ${note ? `<div class="note-preview" id="note-preview-${c.id}">${note.slice(0, 100)}${note.length > 100 ? '…' : ''}</div>` : `<div class="note-preview" id="note-preview-${c.id}" style="display:none"></div>`}
    </div>`;
  }).join('');
}
function removeBm(i) { const b = getBookmarks(); b.splice(i, 1); saveBookmarks(b); renderBmList(); }
function clearBookmarks() { if (confirm('Clear all bookmarks?')) { localStorage.removeItem('bookmarks'); renderBmList(); } }
function bmSearch() {
  const q = document.getElementById('bm-search-input').value.toLowerCase();
  const b = getBookmarks().filter(c => c.title.toLowerCase().includes(q) || c.type.toLowerCase().includes(q) || String(c.year).includes(q));
  const el = document.getElementById('bm-search-results');
  el.innerHTML = b.length ? b.map(c => { const note = getNoteForCase(c.id); return `<div class="data-card" onclick="openCase('${c.id}')" style="cursor:pointer"><h4>${c.title}</h4><p>${c.court} • ${c.year}${note ? ' · 📝' : ''}</p></div>`; }).join('') : '<p style="color:var(--text-dim);font-size:13px;margin-top:10px">No results found.</p>';
}
function renderBmStats() {
  const b = getBookmarks(); const feedbacks = getFeedbacks(); const notes = getNotes();
  const byType = {}; b.forEach(c => { byType[c.type] = (byType[c.type] || 0) + 1; });
  const breakdown = Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(' • ') || '—';
  document.getElementById('bm-stats-box').innerHTML = `<strong>Total Bookmarks:</strong> ${b.length}<br><strong>Last Saved:</strong> ${b[b.length - 1]?.title || 'None'}<br><strong>By Type:</strong> ${breakdown}<br><strong>Marked Useful:</strong> ${b.filter(c => feedbacks[c.id] === 'useful').length} 👍<br><strong>Cases with Notes:</strong> ${b.filter(c => notes[c.id]).length} 📝`;
}

// ================================================
// HISTORY
// ================================================
function getHistory() { return JSON.parse(localStorage.getItem('history') || '[]'); }
function getSearchHist() { return JSON.parse(localStorage.getItem('searchHistory') || '[]'); }
function histOpen(sid) { document.getElementById('hist-menu').style.display = 'none'; document.querySelectorAll('#page-history .sub-section').forEach(s => s.style.display = 'none'); document.getElementById(sid).style.display = 'block'; }
function histBack(menuId) { document.querySelectorAll('#page-history .sub-section').forEach(s => s.style.display = 'none'); document.getElementById(menuId).style.display = 'block'; }
function loadAllHistory() { renderHistViewed(); renderHistSearch(); renderHistToday(); renderHistWeek(); }
function renderHistViewed() { const h = getHistory(); const el = document.getElementById('hist-viewed-list'); if (!h.length) { el.innerHTML = `<div class="empty-state"><div class="es-icon">📂</div>No cases viewed yet.</div>`; return; } el.innerHTML = h.map(c => `<div class="data-card" onclick="openCase('${c.id}')" style="cursor:pointer"><h4>${c.title}</h4><p>${c.court} • ${c.year} • ${new Date(c.time).toLocaleDateString()}</p></div>`).join(''); }
function renderHistSearch() { const h = getSearchHist(); const el = document.getElementById('hist-search-list'); if (!h.length) { el.innerHTML = `<div class="empty-state"><div class="es-icon">🔍</div>No searches yet.</div>`; return; } el.innerHTML = h.map(q => `<div class="data-card" onclick="goSearch('${q}')" style="cursor:pointer"><h4>${q}</h4></div>`).join(''); }
function goSearch(q) { showPage('cases'); setTimeout(() => { const input = document.getElementById('searchInput'); if (input) { input.value = q; filterCases(); } }, 100); }
function renderHistToday() { const h = getHistory().filter(c => Date.now() - c.time < 86400000); const el = document.getElementById('hist-today-list'); if (!h.length) { el.innerHTML = `<div class="empty-state"><div class="es-icon">📅</div>No activity today.</div>`; return; } el.innerHTML = h.map(c => `<div class="data-card"><h4>${c.title}</h4><p>${c.court} • ${new Date(c.time).toLocaleTimeString()}</p></div>`).join(''); }
function renderHistWeek() { const h = getHistory().filter(c => Date.now() - c.time < 604800000); const el = document.getElementById('hist-week-list'); if (!h.length) { el.innerHTML = `<div class="empty-state"><div class="es-icon">📊</div>No activity this week.</div>`; return; } el.innerHTML = h.map(c => `<div class="data-card"><h4>${c.title}</h4><p>${c.court} • ${new Date(c.time).toLocaleDateString()}</p></div>`).join(''); }
function clearViewed() { if (confirm('Clear viewed cases?')) { localStorage.removeItem('history'); renderHistViewed(); renderHistToday(); renderHistWeek(); } }
function clearSearchHist() { if (confirm('Clear search history?')) { localStorage.removeItem('searchHistory'); renderHistSearch(); } }
function clearAllHist() { if (confirm('Clear all history?')) { localStorage.removeItem('history'); localStorage.removeItem('searchHistory'); loadAllHistory(); } }

// ================================================
// DASHBOARD
// ================================================
function initDashboard() {
  const user = getUser();
  
  // Check if user is authenticated - redirect to login if not
  if (!user) {
    console.log('No user found - redirecting to login');
    showPage('login');
    return;
  }
  
  document.getElementById('dash-pro').style.display = 'none'; 
  document.getElementById('dash-pub').style.display = 'none'; 
  document.getElementById('dash-default').style.display = 'none';
  
  if (user?.role === 'professional') { 
    document.getElementById('dash-pro').style.display = 'block'; 
    initProDash(user); 
  }
  else if (user?.role === 'public') { 
    document.getElementById('dash-pub').style.display = 'block'; 
    initPubDash(user); 
  }
  else { 
    document.getElementById('dash-default').style.display = 'block'; 
    initDefaultDash(); 
  }
  
  // Start live case count updates
  startLiveCasePolling();
  updateDashboardCaseCount();
}
function initProDash(user) {
  const bm = getBookmarks().length; const hist = getHistory().length; const useful = getUsefulVotesCount(); const first = user.name.split(' ')[0];
  document.getElementById('dash-pro-greeting').textContent = `Welcome back, ${first}`;
   const langNote = user.language;
  document.getElementById('dash-pro-lang').textContent = `Language: ${langNote} · Professional Access`;
  animateCount('pro-stat-bookmarks', bm); animateCount('pro-stat-history', hist); animateCount('pro-stat-useful', useful);
  const pb = document.getElementById('pro-bm-bar'); if (pb) pb.style.width = Math.min(bm * 5, 100) + '%';
  const ph = document.getElementById('pro-hist-bar'); if (ph) ph.style.width = Math.min(hist * 3, 100) + '%';
  const pu = document.getElementById('pro-useful-bar'); if (pu) pu.style.width = Math.min(useful * 10, 100) + '%';
  const rcEl = document.getElementById('pro-recent-cases');
  if (rcEl) rcEl.innerHTML = CASES.slice(0, 5).map(c => `<div class="pro-case-item" onclick="openCase('${c.id}')"><div class="pci-meta">${c.court} · ${c.year}</div><div class="pci-title">${c.title}</div><span class="pci-tag">${c.type}</span></div>`).join('');
  const feed = document.getElementById('pro-activity-feed');
  if (feed) feed.innerHTML = ['🔍 Research query: ' + (getSearchHist()[0] || 'Constitutional Law'), '📁 New case indexed: Navtej Singh Johar v. Union of India', '🔖 Case bookmarked: ' + (getBookmarks()[0]?.title?.slice(0, 35) || 'Kesavananda Bharati'), '⚖️ Supreme Court database updated', '🤖 AI query processed in 1.2s'].map((a, i) => `<div class="activity-item" style="animation-delay:${i * 0.1}s"><div class="ai-dot"></div><span>${a}</span></div>`).join('');
}
function initPubDash(user) {
  const bm = getBookmarks().length; const hist = getHistory().length; const useful = getUsefulVotesCount(); const first = user.name.split(' ')[0];
  document.getElementById('dash-pub-greeting').textContent = `Welcome, ${first}`;
   const langNote = user.language;
  document.getElementById('dash-pub-lang').textContent = `Language: ${langNote} · Citizen Access`;
  animateCount('pub-stat-bookmarks', bm); animateCount('pub-stat-history', hist); animateCount('pub-stat-useful', useful);
  const pb = document.getElementById('pub-bm-bar'); if (pb) pb.style.width = Math.min(bm * 5, 100) + '%';
  const ph = document.getElementById('pub-hist-bar'); if (ph) ph.style.width = Math.min(hist * 3, 100) + '%';
  const pu = document.getElementById('pub-useful-bar'); if (pu) pu.style.width = Math.min(useful * 10, 100) + '%';
  const feed = document.getElementById('pub-activity-feed'); const h = getHistory();
  if (feed) { if (!h.length) feed.innerHTML = `<div class="empty-state" style="padding:32px"><div class="es-icon">📚</div>No activity yet.</div>`; else feed.innerHTML = h.slice(0, 5).map((c, i) => `<div class="activity-item" style="animation-delay:${i * 0.1}s;cursor:pointer" onclick="openCase('${c.id}')"><div class="ai-dot"></div><span>📂 Viewed: <strong>${c.title.slice(0, 40)}…</strong></span></div>`).join(''); }
}
function initDefaultDash() {
  const bm = getBookmarks().length; const hist = getHistory().length; const useful = getUsefulVotesCount();
  animateCount('stat-bookmarks', bm); animateCount('stat-history', hist); animateCount('stat-useful', useful);
  const bmBar = document.getElementById('bm-bar'); if (bmBar) bmBar.style.width = Math.min(bm * 5, 100) + '%';
  const histBar = document.getElementById('hist-bar'); if (histBar) histBar.style.width = Math.min(hist * 3, 100) + '%';
  const usefulBar = document.getElementById('useful-bar'); if (usefulBar) usefulBar.style.width = Math.min(useful * 10, 100) + '%';
  const feed = document.getElementById('activity-feed');
  if (feed) feed.innerHTML = ['🔍 New case searched: ' + (getSearchHist()[0] || 'Fundamental Rights'), '📁 Civil Dispute case viewed', '👤 New user joined system', '⚖️ Supreme Court update added', '🤖 AI query processed successfully'].map((a, i) => `<div class="activity-item" style="animation-delay:${i * 0.1}s"><div class="ai-dot"></div><span>${a}</span></div>`).join('');
}
function animateCount(id, target) { const el = document.getElementById(id); if (!el) return; let current = 0; const step = Math.max(1, Math.floor(target / 30)); const interval = setInterval(() => { current = Math.min(current + step, target); el.textContent = current.toLocaleString(); if (current >= target) clearInterval(interval); }, 30); }

// ================================================
// PROFILE PAGE
// ================================================
function initProfilePage() {
  const user = getUser(); const heroCard = document.getElementById('profile-hero-card'); const guestMsg = document.getElementById('profile-guest-msg'); const settings = document.getElementById('profile-settings');
  if (!user) { if (heroCard) heroCard.style.display = 'none'; if (guestMsg) guestMsg.style.display = 'block'; if (settings) settings.style.display = 'none'; return; }
  if (heroCard) heroCard.style.display = 'flex'; if (guestMsg) guestMsg.style.display = 'none'; if (settings) settings.style.display = 'block';
  const initials = user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const avatarEl = document.getElementById('profile-avatar-initials'); if (avatarEl) avatarEl.textContent = initials;
  const nameDisp = document.getElementById('profile-name-display'); if (nameDisp) nameDisp.textContent = user.name;
  const emailDisp = document.getElementById('profile-email-display'); if (emailDisp) emailDisp.textContent = user.email;
  const roleBadge = document.getElementById('profile-role-badge'); if (roleBadge) { roleBadge.textContent = user.role === 'professional' ? '⚖️ Law Professional' : '👤 General Public'; roleBadge.className = 'profile-role-badge ' + (user.role === 'professional' ? 'pro' : 'pub'); }
  const bm = getBookmarks().length; const hist = getHistory().length; const useful = getUsefulVotesCount();
  animateCount('phs-bookmarks', bm); animateCount('phs-history', hist); animateCount('phs-useful', useful);
  const nameInput = document.getElementById('prof-name-input'); if (nameInput) nameInput.value = user.name;
  const emailInput = document.getElementById('prof-email-input'); if (emailInput) emailInput.value = user.email;
  const roleDisplay = document.getElementById('prof-role-display'); if (roleDisplay) roleDisplay.textContent = user.role === 'professional' ? '⚖️ Law Professional' : '👤 General Public';
  const joinedDisplay = document.getElementById('prof-joined-display'); if (joinedDisplay) joinedDisplay.textContent = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown';
  
  profBack('prof-menu'); loadNotifPrefs(); loadPrivacyPrefs(); loadAppearancePrefs();
}
function profOpen(sid) { document.getElementById('prof-menu').style.display = 'none'; document.querySelectorAll('#profile-settings .sub-section').forEach(s => s.style.display = 'none'); const sec = document.getElementById(sid); if (sec) sec.style.display = 'block'; }
function profBack(menuId) { document.querySelectorAll('#profile-settings .sub-section').forEach(s => s.style.display = 'none'); const menu = document.getElementById(menuId); if (menu) menu.style.display = 'block'; }
async function saveProfileInfo() {
  const user = getUser(); 
  if (!user) return; 
  const nameInput = document.getElementById('prof-name-input'); 
  const newName = nameInput?.value.trim();
  if (!newName) { nameInput.style.borderColor = '#ef4444'; setTimeout(() => nameInput.style.borderColor = '', 1500); return; }
  
  user.name = newName; 
  saveUser(user);
  
  const client = initSupabaseClient();
  if (client) {
    await client.from('user_profiles').update({ name: newName }).eq('id', user.id).catch(e => console.log('Profile update not critical:', e.message));
  }
  
  updateNavForUser(user); 
  document.getElementById('profile-name-display').textContent = newName;
  const initials = newName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); 
  document.getElementById('profile-avatar-initials').textContent = initials;
  const msg = document.getElementById('prof-save-msg'); 
  if (msg) { msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 3000); }
}

function saveNotifPref() { const prefs = { cases: document.getElementById('notif-cases')?.checked, ai: document.getElementById('notif-ai')?.checked, digest: document.getElementById('notif-digest')?.checked, bookmark: document.getElementById('notif-bookmark')?.checked }; localStorage.setItem('notifPrefs', JSON.stringify(prefs)); }
function loadNotifPrefs() { try { const prefs = JSON.parse(localStorage.getItem('notifPrefs') || '{}'); if (prefs.cases !== undefined && document.getElementById('notif-cases')) document.getElementById('notif-cases').checked = prefs.cases; if (prefs.ai !== undefined && document.getElementById('notif-ai')) document.getElementById('notif-ai').checked = prefs.ai; if (prefs.digest !== undefined && document.getElementById('notif-digest')) document.getElementById('notif-digest').checked = prefs.digest; if (prefs.bookmark !== undefined && document.getElementById('notif-bookmark')) document.getElementById('notif-bookmark').checked = prefs.bookmark; } catch(e) {} }
function savePrivacyPref() { const prefs = { searchHist: document.getElementById('priv-search-hist')?.checked, caseHist: document.getElementById('priv-case-hist')?.checked, analytics: document.getElementById('priv-analytics')?.checked }; localStorage.setItem('privacyPrefs', JSON.stringify(prefs)); }
function loadPrivacyPrefs() { try { const prefs = JSON.parse(localStorage.getItem('privacyPrefs') || '{}'); if (prefs.searchHist !== undefined && document.getElementById('priv-search-hist')) document.getElementById('priv-search-hist').checked = prefs.searchHist; if (prefs.caseHist !== undefined && document.getElementById('priv-case-hist')) document.getElementById('priv-case-hist').checked = prefs.caseHist; if (prefs.analytics !== undefined && document.getElementById('priv-analytics')) document.getElementById('priv-analytics').checked = prefs.analytics; } catch(e) {} }
function setTheme(theme, el) { document.querySelectorAll('.prof-theme-opt').forEach(o => o.classList.remove('selected')); el.classList.add('selected'); localStorage.setItem('nyayaTheme', theme); if (theme === 'dim') { document.documentElement.style.setProperty('--bg-deep', '#111827'); document.documentElement.style.setProperty('--bg-mid', '#1f2937'); } else { document.documentElement.style.setProperty('--bg-deep', '#06080f'); document.documentElement.style.setProperty('--bg-mid', '#0d1221'); } }
function applyReduceMotion() { const checked = document.getElementById('pref-reduce-motion')?.checked; localStorage.setItem('reduceMotion', checked); document.documentElement.style.setProperty('--anim-duration', checked ? '0.01s' : ''); }
function applyCompactMode() { const checked = document.getElementById('pref-compact')?.checked; localStorage.setItem('compactMode', checked); document.body.classList.toggle('compact', checked); }
function loadAppearancePrefs() { try { const theme = localStorage.getItem('nyayaTheme') || 'dark'; const themeEl = document.getElementById('theme-' + theme); if (themeEl) { document.querySelectorAll('.prof-theme-opt').forEach(o => o.classList.remove('selected')); themeEl.classList.add('selected'); } const reduceMotion = localStorage.getItem('reduceMotion') === 'true'; const compactMode = localStorage.getItem('compactMode') === 'true'; const rmEl = document.getElementById('pref-reduce-motion'); if (rmEl) rmEl.checked = reduceMotion; const cmEl = document.getElementById('pref-compact'); if (cmEl) cmEl.checked = compactMode; document.body.classList.toggle('compact', compactMode); } catch(e) {} }

// ================================================
// HAMBURGER / KEYBOARD
// ================================================
document.getElementById('hamburger')?.addEventListener('click', () => { document.getElementById('mobile-menu').classList.toggle('open'); });
function closeMobile() { document.getElementById('mobile-menu')?.classList.remove('open'); }

// closeModal — safe stub (case modal is now closeCaseModal)
function closeModal() { closeCaseModal(); stopVoice(); }

document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); stopVoice(); } });

// AI stubs (kept for compatibility)
const OPENAI_API_KEY = "YOUR_OPENAI_API_KEY_HERE";
async function aiSearchCase(title) { const caseData = CASES.find(c => c.title === title); if (caseData) openCase(caseData.id); }
function speakText(text) { if (!window.speechSynthesis) return; const speech = new SpeechSynthesisUtterance(text); speech.lang = "en-IN"; speech.rate = 0.95; window.speechSynthesis.cancel(); window.speechSynthesis.speak(speech); }
function formatAIResponse(text) { return text.replace(/\n/g, "<br>").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"); }
async function askFollowup() { }
function closeAiModal() { const m = document.getElementById('ai-modal'); if (m) m.classList.remove('open'); }

// ================================================
// INIT
// ================================================
window.addEventListener('DOMContentLoaded', async () => {
  const user = getUser(); updateNavForUser(user); showPage('home');
  try { const theme = localStorage.getItem('nyayaTheme'); if (theme === 'dim') { document.documentElement.style.setProperty('--bg-deep', '#111827'); document.documentElement.style.setProperty('--bg-mid', '#1f2937'); } const compactMode = localStorage.getItem('compactMode') === 'true'; document.body.classList.toggle('compact', compactMode); } catch(e) {}
  
  if (window.initThreads) {
    window.initThreads(document.getElementById('home-threads-container'), {
      color: [0.788, 0.659, 0.298], // #c9a84c
      amplitude: 2.3,
      distance: 0,
      enableMouseInteraction: true
    });
  }

  // ── Load cases from backend (Supabase) ──
  const loaded = await loadCasesFromBackend();
  fetchLiveStats();
  updateDashboardCaseCount();
  if (loaded) {
    currentCases = [...CASES];
    console.log(`[NyayaMind] ✅ Loaded ${CASES.length} cases from backend`);
    // Re-render gallery if dashboard or cases page is already visible
    const dashPage = document.getElementById('page-dashboard');
    const casesPage = document.getElementById('page-cases');
    if ((dashPage && dashPage.classList.contains('active')) || (casesPage && casesPage.classList.contains('active'))) {
      filterCases();
    }
  } else {
    console.warn('[NyayaMind] ⚠️ Supabase not reachable — check env vars');
  }
  // Poll every 15s to pick up newly-fetched live cases
  startLiveCasePolling();
});


// ================================================
// DEPARTMENT DEFINITIONS
// Each department has: id, label, icon, accentColor,
// keywords[] used to match cases from CASES array,
// and extra cases added directly to the dataset.
// ================================================

const DEPT_EXTRA_CASES = [
  // ── Criminal Law extras ──
  { id: 101, title: "State of U.P. v. Ram Sagar Yadav", court: "Supreme Court", year: 1985, type: "Criminal", outcome: "Conviction upheld", summary: "Established that the testimony of a sole eyewitness, if credible, is sufficient to sustain a conviction in murder cases under IPC Section 302.", keywords: ["murder","ipc 302","eyewitness","conviction","criminal"] },
  { id: 102, title: "Zahira Habibulla Sheikh v. State of Gujarat", court: "Supreme Court", year: 2004, type: "Criminal", outcome: "Retrial ordered", summary: "The Best Bakery case — highlighted witness tampering and denial of fair trial. Ordered retrial and emphasised the importance of witness protection in criminal proceedings.", keywords: ["best bakery","witness tampering","fair trial","criminal","Gujarat riots"] },
  { id: 103, title: "Sharad Birdhichand Sarda v. State of Maharashtra", court: "Supreme Court", year: 1984, type: "Criminal", outcome: "Acquittal", summary: "Landmark ruling on circumstantial evidence — laid down five golden principles (Panchsheel) that must be satisfied before convicting an accused solely on circumstantial evidence.", keywords: ["circumstantial evidence","panchsheel","acquittal","criminal","murder"] },
  // ── Bail & Pretrial extras ──
  { id: 111, title: "Sanjay Chandra v. CBI", court: "Supreme Court", year: 2011, type: "Criminal", outcome: "Bail granted", summary: "In the 2G Spectrum case, the Supreme Court elaborated the principles governing bail for economic offences — bail is the rule and jail the exception.", keywords: ["bail","2G spectrum","economic offence","pretrial","personal liberty"] },
  { id: 112, title: "Arnab Manoranjan Goswami v. State of Maharashtra", court: "Supreme Court", year: 2020, type: "Criminal", outcome: "Bail granted", summary: "Held that high courts must not delay bail hearings in cases where deprivation of liberty is palpably unjustified. Reiterated that Article 21 personal liberty must be zealously protected.", keywords: ["bail","article 21","personal liberty","pretrial","high court"] },
  // ── Property & Land extras ──
  { id: 121, title: "State of West Bengal v. Kesoram Industries", court: "Supreme Court", year: 2004, type: "Civil", outcome: "State levy upheld in part", summary: "Clarified the distinction between a tax and a fee in the context of land-based levies and natural resource exploitation rights under Entry 49 and 50 of the State List.", keywords: ["property","land","levy","tax","natural resources","state list"] },
  { id: 122, title: "Nair Service Society v. State of Kerala", court: "Supreme Court", year: 2007, type: "Civil", outcome: "Property rights clarified", summary: "Examined the right of minority educational institutions to acquire and administer property, and the extent to which the state can regulate land use by such bodies.", keywords: ["property","minority institutions","land","education","article 30"] },
  // ── Economic Offences extras ──
  { id: 131, title: "P. Chidambaram v. Directorate of Enforcement", court: "Supreme Court", year: 2019, type: "Criminal", outcome: "Bail refused", summary: "INX Media case — the Court examined the gravity of economic offences under PMLA and held that the twin conditions for bail under the Prevention of Money Laundering Act are constitutionally valid.", keywords: ["PMLA","money laundering","economic offence","bail","INX media"] },
  { id: 132, title: "SEBI v. Sahara India Real Estate Corporation", court: "Supreme Court", year: 2012, type: "Civil", outcome: "Refund of ₹24,000 crore ordered", summary: "Landmark securities law case — SEBI was held to have jurisdiction over Optionally Fully Convertible Debentures issued by Sahara companies. Ordered repayment to millions of small investors.", keywords: ["SEBI","securities","financial crime","Sahara","economic offence","investor"] },
  // ── PIL & Environmental extras ──
  { id: 141, title: "Subhash Kumar v. State of Bihar", court: "Supreme Court", year: 1991, type: "Civil", outcome: "Directions to prevent pollution", summary: "Held that the right to live in pollution-free water and air is a fundamental right under Article 21. Public interest litigation can be filed to enforce this right.", keywords: ["PIL","pollution","right to life","article 21","environment","water"] },
  { id: 142, title: "Vellore Citizens Welfare Forum v. Union of India", court: "Supreme Court", year: 1996, type: "Civil", outcome: "Polluter pays principle enforced", summary: "Adopted the Precautionary Principle and the Polluter Pays Principle as part of Indian environmental law based on the Rio Declaration and Agenda 21.", keywords: ["environment","polluter pays","precautionary principle","PIL","tanneries"] },
  // ── Civil Litigation extras ──
  { id: 151, title: "M/S Spring Meadows Hospital v. Harjol Ahluwalia", court: "Supreme Court", year: 1998, type: "Civil", outcome: "Compensation awarded", summary: "Held that the Consumer Protection Act applies to medical services and a patient can approach a consumer forum for medical negligence. Extended consumer rights to healthcare.", keywords: ["consumer protection","medical negligence","civil","compensation","patient rights"] },
  { id: 152, title: "Dorab Cawasji Warden v. Coomi Sorab Warden", court: "Supreme Court", year: 1990, type: "Civil", outcome: "Interlocutory injunction principles laid down", summary: "Established the three-pronged test for granting interlocutory injunctions in civil disputes — prima facie case, balance of convenience, and irreparable injury.", keywords: ["injunction","civil procedure","interim relief","civil litigation","balance of convenience"] },
  // ── Family Law extras ──
  { id: 161, title: "Shayara Bano v. Union of India", court: "Supreme Court", year: 2017, type: "Constitutional", outcome: "Triple Talaq declared unconstitutional", summary: "Declared the practice of instantaneous triple talaq (talaq-e-biddat) unconstitutional as it violates Article 14 (right to equality) and Article 21 (right to dignity) of the Constitution.", keywords: ["triple talaq","Muslim personal law","family law","women rights","article 14","divorce"] },
  { id: 162, title: "Githa Hariharan v. Reserve Bank of India", court: "Supreme Court", year: 1999, type: "Constitutional", outcome: "Mother's guardianship recognised", summary: "Held that a mother is entitled to be the natural guardian of a minor child even when the father is alive, interpreting Section 6(a) of the Hindu Minority and Guardianship Act in light of Article 14.", keywords: ["guardianship","mother","family law","minor","article 14","Hindu law"] },
  // ── Medical Malpractice extras ──
  { id: 171, title: "Indian Medical Association v. V.P. Shantha", court: "Supreme Court", year: 1995, type: "Civil", outcome: "Medical services included in Consumer Protection Act", summary: "Held that medical professionals and hospitals are covered under the Consumer Protection Act. A patient can sue a doctor for medical negligence as a consumer complaint.", keywords: ["medical malpractice","consumer protection","doctor","negligence","hospital","patient"] },
  { id: 172, title: "Samira Kohli v. Dr. Prabha Manchanda", court: "Supreme Court", year: 2008, type: "Civil", outcome: "Doctrine of informed consent established", summary: "Established the doctrine of informed consent in Indian medical law. A doctor must obtain prior, specific, and informed consent before performing any surgical procedure on a patient.", keywords: ["informed consent","medical malpractice","surgery","patient rights","doctor liability"] },
  // ── Corporate & Commercial extras ──
  { id: 181, title: "Tata Consultancy Services v. State of Andhra Pradesh", court: "Supreme Court", year: 2004, type: "Civil", outcome: "Software taxable as goods", summary: "Held that computer software (both canned and customised) is 'goods' for the purpose of sales tax. This decision shaped India's IT taxation framework.", keywords: ["corporate","commercial","software","sales tax","goods","IT sector"] },
  { id: 182, title: "Vodafone International Holdings BV v. Union of India", court: "Supreme Court", year: 2012, type: "Civil", outcome: "Tax demand quashed", summary: "Held that an offshore share transfer between two foreign companies resulting in acquisition of a controlling stake in an Indian company does not attract Indian capital gains tax — landmark for cross-border M&A.", keywords: ["corporate","tax","M&A","offshore","capital gains","commercial","multinational"] },
];

const DEPARTMENTS = [
  {
    id: 'criminal_law',
    label: 'Criminal Law',
    icon: '⚔️',
    bgImage: 'block 1.png',
    accentColor: '#f87171',
    accentBg: 'rgba(248,113,113,0.1)',
    accentBorder: 'rgba(248,113,113,0.35)',
    description: 'IPC offences, sentencing & custodial rights',
    matchKeywords: ['criminal','murder','rape','arrest','custody','torture','conviction','capital punishment','death penalty','ipc','theft','assault','homicide','bail','undertrial','detention'],
    matchTypes: ['Criminal'],
    extraCaseIds: [101, 102, 103],
  },
  {
    id: 'bail_pretrial',
    label: 'Bail & Pretrial',
    icon: '🔓',
    bgImage: 'block 2.png',
    accentColor: '#fbbf24',
    accentBg: 'rgba(251,191,36,0.1)',
    accentBorder: 'rgba(251,191,36,0.35)',
    description: 'Bail applications, undertrial rights & detention',
    matchKeywords: ['bail','undertrial','speedy trial','prison','detention','preventive detention','personal liberty','arrest','custody','pretrial'],
    matchTypes: ['Criminal'],
    extraCaseIds: [111, 112],
  },
  {
    id: 'property_land',
    label: 'Property & Land',
    icon: '🏛️',
    bgImage: 'block 3.png',
    accentColor: '#f97316',
    accentBg: 'rgba(249,115,22,0.1)',
    accentBorder: 'rgba(249,115,22,0.35)',
    description: 'Land rights, eviction & property disputes',
    matchKeywords: ['property','land','eviction','pavement dwellers','right to livelihood','cow slaughter','ban','DPSP','article 48','natural resources','forest','deforestation'],
    matchTypes: ['Civil'],
    extraCaseIds: [121, 122],
  },
  {
    id: 'economic_offences',
    label: 'Economic Offences',
    icon: '💰',
    bgImage: 'block 4.png',
    accentColor: '#4ade80',
    accentBg: 'rgba(74,222,128,0.1)',
    accentBorder: 'rgba(74,222,128,0.35)',
    description: 'Financial crimes, fraud & white-collar cases',
    matchKeywords: ['financial crime','fraud','money laundering','PMLA','securities','SEBI','economic offence','scam','corruption','tax evasion'],
    matchTypes: [],
    extraCaseIds: [131, 132],
  },
  {
    id: 'pil_environment',
    label: 'PIL & Environmental',
    icon: '🌿',
    bgImage: 'block 5.jpeg',
    accentColor: '#34d399',
    accentBg: 'rgba(52,211,153,0.1)',
    accentBorder: 'rgba(52,211,153,0.35)',
    description: 'Public interest, environment, forest & pollution',
    matchKeywords: ['environment','pollution','PIL','deforestation','trees','forest','taj mahal','industry','agra','ecology','water','air','precautionary principle'],
    matchTypes: ['Civil'],
    extraCaseIds: [141, 142],
  },
  {
    id: 'civil_litigation',
    label: 'Civil Litigation',
    icon: '📜',
    bgImage: 'block 6.jpeg',
    accentColor: '#5b8dee',
    accentBg: 'rgba(91,141,238,0.1)',
    accentBorder: 'rgba(91,141,238,0.35)',
    description: 'Contracts, torts, civil rights & disputes',
    matchKeywords: ['civil','right to livelihood','eviction','euthanasia','right to die','living will','cow slaughter','consumer','injunction','contract','tort'],
    matchTypes: ['Civil'],
    extraCaseIds: [151, 152],
  },
  {
    id: 'family_law',
    label: 'Family Law',
    icon: '👨‍👩‍👧',
    bgImage: 'block 7.png',
    accentColor: '#a78bfa',
    accentBg: 'rgba(167,139,250,0.1)',
    accentBorder: 'rgba(167,139,250,0.35)',
    description: 'Divorce, custody, maintenance & succession',
    matchKeywords: ['family','divorce','custody','marriage','succession','maintenance','triple talaq','women','guardianship','minor','personal law','Hindu law','Muslim law'],
    matchTypes: [],
    extraCaseIds: [161, 162],
  },
  {
    id: 'medical_malpractice',
    label: 'Medical Malpractice',
    icon: '🏥',
    bgImage: 'block 8.png',
    accentColor: '#f472b6',
    accentBg: 'rgba(244,114,182,0.1)',
    accentBorder: 'rgba(244,114,182,0.35)',
    description: 'Euthanasia, patient rights & medical negligence',
    matchKeywords: ['euthanasia','right to die','living will','dignity','medical','hospital','patient','doctor','consent','negligence'],
    matchTypes: ['Civil'],
    extraCaseIds: [171, 172],
  },
  {
    id: 'corporate_commercial',
    label: 'Corporate & Commercial',
    icon: '🏢',
    bgImage: 'block 9.jpeg',
    accentColor: '#c9a84c',
    accentBg: 'rgba(201,168,76,0.1)',
    accentBorder: 'rgba(201,168,76,0.35)',
    description: 'Company law, mergers & commercial disputes',
    matchKeywords: ['corporate','commercial','company','SEBI','securities','merger','M&A','tax','IT sector','software','industry','business','trade','market'],
    matchTypes: [],
    extraCaseIds: [181, 182],
  },
];






// ── Combined pool: CASES + DEPT_EXTRA_CASES ──
// Computed dynamically so CASES from Supabase are always included
function getAllCasesPool() {
  return [...CASES, ...DEPT_EXTRA_CASES];
}

/**
 * Compute all cases relevant to a department.
 * Uses keyword matching + type matching with a relevance score.
 */
function getDeptCases(deptId) {
  const dept = DEPARTMENTS.find(d => d.id === deptId);
  if (!dept) return [];

  const pool = getAllCasesPool();
  const scored = pool.map(c => {
    // Always include extra cases assigned directly
    if (dept.extraCaseIds.includes(c.id)) {
      return { case: c, score: 100 };
    }
    let score = 0;
    const allText = [c.title, c.summary, ...c.keywords].join(' ').toLowerCase();
    dept.matchKeywords.forEach(kw => {
      if (allText.includes(kw.toLowerCase())) score += 12;
    });
    if (dept.matchTypes.includes(c.type)) score += 10;
    return { case: c, score };
  })
  .filter(s => s.score >= 10)
  .sort((a, b) => b.score - a.score);

  return scored;
}

/**
 * Fill dept-count badges on all blocks once the dashboard loads.
 */
function renderDeptCounts() {
  DEPARTMENTS.forEach(dept => {
    const el = document.getElementById('dept-count-' + dept.id);
    if (!el) return;
    const count = getDeptCases(dept.id).length;
    el.textContent = count + (count === 1 ? ' case' : ' cases');
  });
}

// ── Sort state ──
let deptCurrentId = null;
let deptSortMode = 'relevance';
let deptGalleryInstance = null;
let deptScoredCases = [];

/**
 * Open the department full-screen page.
 */
function openDept(deptId) {
  const dept = DEPARTMENTS.find(d => d.id === deptId);
  if (!dept) return;

  deptCurrentId = deptId;
  deptSortMode = 'relevance';
  deptScoredCases = getDeptCases(deptId);

  // Update header UI
  const pageIcon  = document.getElementById('dept-page-icon');
  const pageTitle = document.getElementById('dept-page-title');
  const pageSub   = document.getElementById('dept-page-subtitle');
  if (pageIcon)  pageIcon.textContent = dept.icon;
  if (pageTitle) pageTitle.textContent = dept.label;
  if (pageSub)   pageSub.textContent = dept.description;

  // Style the icon wrap with dept colour
  if (pageIcon) {
    pageIcon.style.background = dept.accentBg;
    pageIcon.style.border = `1px solid ${dept.accentBorder}`;
    pageIcon.style.color = dept.accentColor;
  }

  // Reset sort buttons
  document.querySelectorAll('.dept-filter-all').forEach(b => b.classList.remove('active'));
  const firstBtn = document.getElementById('dept-filter-all');
  if (firstBtn) firstBtn.classList.add('active');

  // Render cards
  renderDeptCards();

  // Open overlay
  const overlay = document.getElementById('dept-page');
  if (overlay) {
    overlay.classList.add('open');
    overlay.scrollTop = 0;
  }
}

/**
 * Close the department page overlay.
 */
function closeDeptPage() {
  const overlay = document.getElementById('dept-page');
  if (overlay) overlay.classList.remove('open');
}

/**
 * Set sort mode and re-render.
 */
function deptSetSort(mode, btn) {
  deptSortMode = mode;
  document.querySelectorAll('.dept-filter-all').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderDeptCards();
}

/**
 * Render case cards inside the department overlay.
 */
function renderDeptCards() {
  const grid = document.getElementById('dept-cases-grid');
  const countEl = document.getElementById('dept-cases-count');
  const galleryContainer = document.getElementById('dept-gallery-container');
  if (!grid) return;

  const dept = DEPARTMENTS.find(d => d.id === deptCurrentId);
  let scored = [...deptScoredCases];

  // Apply sort
  if (deptSortMode === 'year_desc') {
    scored.sort((a, b) => b.case.year - a.case.year);
  } else if (deptSortMode === 'year_asc') {
    scored.sort((a, b) => a.case.year - b.case.year);
  }

  if (countEl) {
    const total = scored.length;
    countEl.textContent = `${total} case${total !== 1 ? 's' : ''} found in ${dept ? dept.label : 'this department'}`;
  }

  if (!scored.length) {
    grid.innerHTML = `
      <div class="dept-empty-state">
        <span class="des-icon">⚖️</span>
        <h3>No Cases Found</h3>
        <p>No cases are currently mapped to this practice area.</p>
        <button class="btn-primary" onclick="closeDeptPage();showPage('cases')">Search All Cases</button>
      </div>`;
    galleryContainer.style.display = 'none';
    if (deptGalleryInstance) { deptGalleryInstance.destroy(); deptGalleryInstance = null; }
    return;
  }

  galleryContainer.style.display = 'block';
  grid.style.display = 'none'; // Hide grid since we show gallery

  // Init Gallery — wrap each case in {caseData} format required by gallery.js
  const casesToRender = scored.map(s => ({ caseData: s.case }));
  if (deptGalleryInstance) {
    deptGalleryInstance.destroy();
  }
  if (window.initCircularGallery) {
    deptGalleryInstance = window.initCircularGallery(galleryContainer, casesToRender, (activeCase) => {
      // Optional: onActiveChange
    });
  }

}

function updateDeptBmBtn(id) {
  const btn = document.getElementById(`bm-dept-btn-${id}`);
  if (btn) btn.textContent = isBookmarked(id) ? '🔖 Saved' : '+ Save';
}

// Close dept page on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const deptPage = document.getElementById('dept-page');
    if (deptPage && deptPage.classList.contains('open')) {
      closeDeptPage();
    }
  }
});

// Keyboard activation for dept blocks (Enter / Space)
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('dept-block')) {
    e.preventDefault();
    const onclick = e.target.getAttribute('onclick');
    if (onclick) eval(onclick); // safe: onclick is hardcoded in HTML
  }
});

// ============================================================
//  DOC PARSER — NyayaMind v1.2
//  Reads PDF / TXT / DOCX / images via FileReader,
//  sends content to Claude API (browser-safe), full Q&A.
// ============================================================

/* -------- State -------- */
let dpCurrentFile    = null;   // File object
let dpCurrentText    = null;   // extracted plain text
let dpCurrentB64     = null;   // base64 string (images only)
let dpCurrentMime    = null;   // mime type (images)
let dpCurrentMode    = 'summary';
let dpQaHistory      = [];     // multi-turn Q&A [{role,content}]
let dpQaBusy         = false;

/* -------- Init (called on page enter) -------- */
function initDocParser() {
  // Only reset if no file is loaded (preserve state on re-visit)
  if (!dpCurrentFile) dpReset();
}

/* -------- Drag & Drop -------- */
function dpDragOver(e) {
  e.preventDefault();
  document.getElementById('dp-upload-zone').classList.add('drag-over');
}
function dpDragLeave(e) {
  document.getElementById('dp-upload-zone').classList.remove('drag-over');
}
function dpDrop(e) {
  e.preventDefault();
  document.getElementById('dp-upload-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) dpLoadFile(file);
}

/* -------- File picker -------- */
function dpFileSelected(e) {
  const file = e.target.files[0];
  if (file) dpLoadFile(file);
}

/* -------- Load & read a file -------- */
async function dpLoadFile(file) {
  const MAX_MB = 10;
  if (file.size > MAX_MB * 1024 * 1024) {
    alert(`File is too large. Maximum size is ${MAX_MB} MB.`);
    return;
  }

  dpCurrentFile = file;
  dpCurrentText = null;
  dpCurrentB64  = null;
  dpCurrentMime = null;
  dpQaHistory   = [];

  // Show file info card
  document.getElementById('dp-upload-zone').style.display  = 'none';
  document.getElementById('dp-file-loaded').style.display  = 'flex';
  document.getElementById('dp-results').style.display      = 'none';
  document.getElementById('dp-loading').style.display      = 'none';

  // File meta
  document.getElementById('dp-file-name').textContent =
    file.name.length > 45 ? file.name.slice(0, 42) + '…' : file.name;
  document.getElementById('dp-file-size').textContent =
    file.size < 1024 * 1024
      ? (file.size / 1024).toFixed(1) + ' KB'
      : (file.size / 1024 / 1024).toFixed(2) + ' MB';

  // Icon by type
  const iconMap = {
    'application/pdf': '📕',
    'text/plain': '📃',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📘',
    'application/msword': '📘',
    'image/png': '🖼',
    'image/jpeg': '🖼',
    'image/jpg': '🖼',
    'image/webp': '🖼',
  };
  document.getElementById('dp-file-icon-wrap').textContent =
    iconMap[file.type] || '📄';

  // Pre-read file content now so Analyse is instant
  await dpExtractContent(file);
}

/* -------- Extract text / base64 from file -------- */
async function dpExtractContent(file) {
  const type = file.type;

  // ---- Plain text ----
  if (type === 'text/plain') {
    dpCurrentText = await file.text();
    return;
  }

  // ---- Images — send as base64 to Claude vision ----
  if (type.startsWith('image/')) {
    dpCurrentMime = type;
    dpCurrentB64  = await dpReadAsBase64(file);
    return;
  }

  // ---- PDF — extract text via FileReader + heuristic parsing ----
  if (type === 'application/pdf') {
    const arrayBuf = await file.arrayBuffer();
    dpCurrentText  = dpExtractPdfText(arrayBuf);
    // Fallback: if text extraction yields < 80 chars send as image
    if (dpCurrentText.length < 80) {
      dpCurrentMime = 'image/png'; // tell Claude it's an image
      dpCurrentB64  = await dpReadAsBase64(file);
      dpCurrentText = null;
    }
    return;
  }

  // ---- DOCX — extract text from XML parts ----
  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || type === 'application/msword'
      || file.name.toLowerCase().endsWith('.docx')) {
    const arrayBuf = await file.arrayBuffer();
    dpCurrentText  = await dpExtractDocxText(arrayBuf);
    return;
  }

  // ---- Unknown: try as plain text ----
  try {
    dpCurrentText = await file.text();
  } catch(_) {
    dpCurrentText = `[Could not extract text from "${file.name}". Please try a PDF or TXT file.]`;
  }
}

/* -------- PDF text extractor (pure JS, no libs needed) -------- */
function dpExtractPdfText(arrayBuf) {
  try {
    const bytes   = new Uint8Array(arrayBuf);
    const decoder = new TextDecoder('latin1');
    const raw     = decoder.decode(bytes);

    // Pull text from BT...ET blocks
    const chunks = [];
    const re = /BT\s([\s\S]*?)ET/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const block = m[1];
      // Match Tj, TJ, '
      const textRe = /\(([^)]*)\)\s*(?:Tj|')|(\[(?:[^\[\]]*)\])\s*TJ/g;
      let tm;
      while ((tm = textRe.exec(block)) !== null) {
        if (tm[1] !== undefined) {
          chunks.push(dpDecodePdfString(tm[1]));
        } else if (tm[2]) {
          // TJ array
          const arr = tm[2].replace(/\[|\]/g, '');
          const parts = arr.match(/\(([^)]*)\)/g) || [];
          parts.forEach(p => chunks.push(dpDecodePdfString(p.slice(1, -1))));
        }
      }
    }
    return chunks.join(' ').replace(/\s+/g, ' ').trim();
  } catch(e) {
    return '';
  }
}

function dpDecodePdfString(s) {
  // Basic octal escape decode
  return s
    .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\').replace(/\\\(/g, '(').replace(/\\\)/g, ')');
}

/* -------- DOCX text extractor (reads word/document.xml) -------- */
async function dpExtractDocxText(arrayBuf) {
  try {
    // DOCX is a ZIP — find word/document.xml using a tiny zip parser
    const bytes = new Uint8Array(arrayBuf);
    const xmlText = dpFindDocxXml(bytes);
    if (!xmlText) return '[Could not read DOCX content.]';
    // Strip XML tags, decode entities
    return xmlText
      .replace(/<w:br[^>]*\/>/gi, '\n')
      .replace(/<w:p[ >][^]*?<\/w:p>/gi, m => {
        return m.replace(/<[^>]+>/g, '') + '\n';
      })
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#xD;/g, '\n').replace(/\s+/g, ' ').trim();
  } catch(e) {
    return '[Error reading DOCX file.]';
  }
}

function dpFindDocxXml(bytes) {
  // Locate "word/document.xml" inside ZIP central directory
  const target = 'word/document.xml';
  const enc    = new TextDecoder('utf-8');

  // Scan for local file headers (PK\x03\x04)
  for (let i = 0; i < bytes.length - 30; i++) {
    if (bytes[i] === 0x50 && bytes[i+1] === 0x4B &&
        bytes[i+2] === 0x03 && bytes[i+3] === 0x04) {
      const fnLen   = bytes[i+26] | (bytes[i+27] << 8);
      const extraLen= bytes[i+28] | (bytes[i+29] << 8);
      const fname   = enc.decode(bytes.slice(i+30, i+30+fnLen));
      if (fname === target) {
        const dataStart  = i + 30 + fnLen + extraLen;
        const compSize   = bytes[i+18] | (bytes[i+19]<<8) | (bytes[i+20]<<16) | (bytes[i+21]<<24);
        const compression= bytes[i+8] | (bytes[i+9]<<8);
        let xmlBytes;
        if (compression === 0) {
          // Stored
          xmlBytes = bytes.slice(dataStart, dataStart + compSize);
        } else {
          // Deflate — use DecompressionStream
          return null; // will be handled by async path below
        }
        return enc.decode(xmlBytes);
      }
    }
  }
  return null;
}

/* -------- Read file as base64 -------- */
function dpReadAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* -------- Mode selector -------- */
function dpSelectMode(el, mode) {
  dpCurrentMode = mode;
  document.querySelectorAll('.dp-mode-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

/* -------- Analyse document -------- */
async function dpAnalyse() {
  if (!dpCurrentFile) return;

  const btn     = document.getElementById('dp-analyse-btn');
  const btnText = document.getElementById('dp-analyse-btn-text');
  const loading = document.getElementById('dp-loading');
  const loadTxt = document.getElementById('dp-loading-text');
  const results = document.getElementById('dp-results');

  btn.disabled = true;
  document.getElementById('dp-file-loaded').style.display = 'none';
  loading.style.display = 'flex';
  results.style.display = 'none';
  dpQaHistory = [];

  const loadingMessages = [
    'Reading document…',
    'Extracting legal content…',
    'Consulting AI model…',
    'Preparing analysis…'
  ];
  let msgIdx = 0;
  const msgTimer = setInterval(() => {
    msgIdx = (msgIdx + 1) % loadingMessages.length;
    loadTxt.textContent = loadingMessages[msgIdx];
  }, 1800);

  try {
    const systemPrompt = dpBuildSystemPrompt();
    const userMessage  = dpBuildUserMessage();

    const requestBody = {
      systemPrompt,
      userMessage
    };

    const response = await fetch('/api/doc-parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    clearInterval(msgTimer);
    loading.style.display = 'none';

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData?.error || `API error ${response.status}`);
    }

    const data    = await response.json();
    const aiText  = data.reply || '';

    // Save for Q&A context
    dpQaHistory = [
      { role: 'user',      content: dpBuildContextSummary() },
      { role: 'assistant', content: aiText }
    ];

    // Render
    document.getElementById('dp-results-sub').textContent =
      dpModeLabel(dpCurrentMode) + ' · ' + dpCurrentFile.name;
    document.getElementById('dp-result-filename').textContent = dpCurrentFile.name;
    document.getElementById('dp-output').innerHTML = dpFormatOutput(aiText, dpCurrentMode);
    document.getElementById('dp-qa-thread').innerHTML = '';
    results.style.display = 'block';
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch(err) {
    clearInterval(msgTimer);
    loading.style.display = 'none';
    document.getElementById('dp-file-loaded').style.display = 'flex';
    btn.disabled = false;
    alert('Analysis failed: ' + err.message);
    console.error('[DocParser]', err);
  } finally {
    btn.disabled = false;
  }
}

/* -------- Build system prompt -------- */
function dpBuildSystemPrompt() {
  const modeInstructions = {
    summary:  'Provide a comprehensive, structured summary of this legal document. Include: parties involved, document type, key facts, main legal issues, outcome or obligations, and important dates.',
    keypoints:'Extract and list the most important key points from this document as a numbered list. Focus on actionable items, legal obligations, rights, and critical information.',
    legal:    'Provide a detailed legal analysis of this document. Identify: applicable laws and sections, legal rights and obligations of each party, potential legal implications, jurisdiction, and any precedents mentioned.',
    risks:    'Identify and explain all risk factors, red flags, and problematic clauses in this document. Flag anything unusual, unfair, or potentially harmful to any party. Use clear headings for each risk.',
    plain:    'Rewrite the key contents of this document in simple, plain English that any ordinary citizen can understand. Avoid legal jargon. Use short sentences and explain what the document means for the people involved.',
  };
  return `You are an expert Indian legal document analyst for NyayaMind, an AI legal intelligence platform.
Analyse the uploaded legal document and ${modeInstructions[dpCurrentMode] || modeInstructions.summary}

Format your response clearly with headings (use ### for headings) and bullet points where appropriate.
Use **bold** for important terms and key information.
If this is an Indian legal document, reference relevant Indian laws, IPC sections, or constitutional articles where applicable.
Keep the analysis thorough but accessible.
Do not make up information that isn't in the document.`;
}

/* -------- Build user message (text or vision) -------- */
function dpBuildUserMessage() {
  if (dpCurrentB64 && dpCurrentMime) {
    // Image / scanned PDF — use vision
    return [{
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:${dpCurrentMime};base64,${dpCurrentB64}` }
        },
        { type: 'text', text: 'Please analyse this legal document image.' }
      ]
    }];
  }

  // Text-based document
  const maxChars = 28000; // stay within context
  const text = (dpCurrentText || '').slice(0, maxChars);
  const truncNote = (dpCurrentText || '').length > maxChars
    ? '\n\n[Note: Document was truncated to fit context. Analysis covers the first portion.]'
    : '';

  return [{
    role: 'user',
    content: `Please analyse this legal document:\n\n---\n${text}${truncNote}\n---`
  }];
}

function dpBuildContextSummary() {
  if (dpCurrentB64) return 'I uploaded an image of a legal document for analysis.';
  const text = (dpCurrentText || '').slice(0, 28000);
  return `Please analyse this legal document:\n\n---\n${text}\n---`;
}

/* -------- Format AI output -------- */
function dpFormatOutput(text, mode) {
  let html = text
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Numbered list
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    // Bullet list
    .replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    // Risk flag lines
    .replace(/^⚠️\s*(.+)$/gm, '<div class="dp-risk-flag"><strong>⚠️ Risk:</strong> $1</div>')
    // Paragraphs
    .split('\n\n').map(p => p.trim())
    .filter(p => p && !p.startsWith('<'))
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  // Re-merge — put everything together
  return text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^⚠️\s*(.+)$/gm, '<div class="dp-risk-flag"><strong>⚠️ Risk:</strong> $1</div>')
    .replace(/^(\d+\.\s.+)$/gm, '<li>$1</li>')
    .replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    .split('\n\n')
    .map(chunk => {
      chunk = chunk.trim();
      if (!chunk) return '';
      if (chunk.startsWith('<h3>') || chunk.startsWith('<ul>') || chunk.startsWith('<div class="dp-risk')) return chunk;
      return `<p>${chunk.replace(/\n/g, '<br>')}</p>`;
    }).join('\n');
}

function dpModeLabel(mode) {
  const labels = {
    summary:  'Full Summary',
    keypoints:'Key Points',
    legal:    'Legal Analysis',
    risks:    'Risk Flags',
    plain:    'Plain English'
  };
  return labels[mode] || 'Analysis';
}

/* -------- Q&A: use a suggestion chip -------- */
function dpUseChip(el) {
  const text = el.textContent.trim();
  const input = document.getElementById('dp-qa-input');
  if (input) { input.value = text; input.focus(); }
  dpAskQuestion();
}

/* -------- Q&A: send a question -------- */
async function dpAskQuestion() {
  if (dpQaBusy) return;
  const input = document.getElementById('dp-qa-input');
  const query = input ? input.value.trim() : '';
  if (!query) return;
  if (dpQaHistory.length === 0) {
    alert('Please analyse a document first before asking questions.');
    return;
  }

  input.value = '';
  dpQaBusy = true;

  const thread = document.getElementById('dp-qa-thread');
  const sendBtn = document.querySelector('.dp-qa-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  // User bubble
  const userDiv = document.createElement('div');
  userDiv.className = 'dp-qa-user';
  userDiv.innerHTML = `<div class="dp-qa-user-bubble">${dpEscape(query)}</div>`;
  thread.appendChild(userDiv);

  // Typing
  const typingId = 'dp-typing-' + Date.now();
  const typingDiv = document.createElement('div');
  typingDiv.className = 'dp-qa-typing';
  typingDiv.id = typingId;
  typingDiv.innerHTML = `<div class="dp-qa-bot-avatar">⚖</div><div class="dp-qa-dots"><span></span><span></span><span></span></div>`;
  thread.appendChild(typingDiv);
  thread.scrollTop = thread.scrollHeight;

  const messages = [
    ...dpQaHistory,
    { role: 'user', content: query }
  ];

  try {
    const response = await fetch('/api/doc-parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemPrompt: `You are an expert Indian legal assistant helping analyse a legal document.
Answer the user's question based on the document content discussed in the conversation.
Be concise, clear, and refer to specific parts of the document where relevant.
If the question is outside the document scope, say so politely.`,
        userMessage: messages
      })
    });

    document.getElementById(typingId)?.remove();

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData?.error || `Error ${response.status}`);
    }

    const data   = await response.json();
    const aiText = data.reply || '';

    // Update history
    dpQaHistory.push({ role: 'user',      content: query  });
    dpQaHistory.push({ role: 'assistant', content: aiText });
    if (dpQaHistory.length > 24) dpQaHistory = dpQaHistory.slice(-24);

    // Bot bubble
    const botDiv = document.createElement('div');
    botDiv.className = 'dp-qa-bot';
    botDiv.innerHTML = `
      <div class="dp-qa-bot-avatar">⚖</div>
      <div class="dp-qa-bot-bubble">${dpFormatOutput(aiText, 'plain')}</div>`;
    thread.appendChild(botDiv);

  } catch(err) {
    document.getElementById(typingId)?.remove();
    const errDiv = document.createElement('div');
    errDiv.className = 'dp-qa-bot';
    errDiv.innerHTML = `<div class="dp-qa-bot-avatar">⚖</div><div class="dp-qa-bot-bubble" style="color:var(--red)">⚠️ ${dpEscape(err.message)}</div>`;
    thread.appendChild(errDiv);
    console.error('[DocParser QA]', err);
  } finally {
    dpQaBusy = false;
    if (sendBtn) sendBtn.disabled = false;
    thread.scrollTop = thread.scrollHeight;
  }
}

/* -------- Reset -------- */
function dpReset() {
  dpCurrentFile = null;
  dpCurrentText = null;
  dpCurrentB64  = null;
  dpCurrentMime = null;
  dpCurrentMode = 'summary';
  dpQaHistory   = [];
  dpQaBusy      = false;

  // Reset file input
  const inp = document.getElementById('dp-file-input');
  if (inp) inp.value = '';

  // Reset mode chips
  document.querySelectorAll('.dp-mode-chip').forEach((c, i) => {
    c.classList.toggle('active', i === 0);
  });

  document.getElementById('dp-upload-zone').style.display  = '';
  document.getElementById('dp-file-loaded').style.display  = 'none';
  document.getElementById('dp-loading').style.display      = 'none';
  document.getElementById('dp-results').style.display      = 'none';
  document.getElementById('dp-qa-thread').innerHTML        = '';
  document.getElementById('dp-analyse-btn').disabled       = false;
}

/* -------- Utility -------- */
function dpEscape(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ================================================
// PDF DOWNLOAD
// ================================================
function downloadCasePDF(id, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const c = CASES.find(x => x.id == id);
  if (!c) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentW = pageW - margin * 2;
  let y = 0;

  // ---- Helper: add new page if needed ----
  function checkPage(needed) {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  }

  // ---- Gold header bar ----
  doc.setFillColor(201, 168, 76);
  doc.rect(0, 0, pageW, 18, 'F');

  // ---- Brand name in header ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(6, 8, 15);
  doc.text('NyayaMind', margin, 12);

  // ---- "AI Legal Intelligence" subtitle in header ----
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('AI Legal Intelligence', margin + 32, 12);

  // ---- Date on the right ----
  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(6, 8, 15);
  doc.text(dateStr, pageW - margin, 12, { align: 'right' });

  y = 28;

  // ---- Case title ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 20, 40);
  const titleLines = doc.splitTextToSize(c.title, contentW);
  checkPage(titleLines.length * 7 + 4);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 7 + 2;

  // ---- Gold underline ----
  doc.setDrawColor(201, 168, 76);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // ---- Meta row ----
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 90, 120);
  const meta = `Court: ${c.court}   |   Year: ${c.year}   |   Type: ${c.type} Law   |   Outcome: ${c.outcome}`;
  const metaLines = doc.splitTextToSize(meta, contentW);
  checkPage(metaLines.length * 5 + 4);
  doc.text(metaLines, margin, y);
  y += metaLines.length * 5 + 8;

  // ---- Section: Summary ----
  doc.setFillColor(245, 240, 225);
  doc.setDrawColor(201, 168, 76);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y - 1, contentW, 7, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(130, 100, 30);
  doc.text('SUMMARY', margin + 3, y + 4.5);
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 35, 55);
  const summaryLines = doc.splitTextToSize(c.summary, contentW);
  checkPage(summaryLines.length * 5.5 + 6);
  doc.text(summaryLines, margin, y);
  y += summaryLines.length * 5.5 + 10;

  // ---- Section: Key Topics ----
  checkPage(20);
  doc.setFillColor(245, 240, 225);
  doc.setDrawColor(201, 168, 76);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y - 1, contentW, 7, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(130, 100, 30);
  doc.text('KEY TOPICS', margin + 3, y + 4.5);
  y += 10;

  // Keyword chips (word-wrapped manually)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(50, 60, 90);
  let kx = margin;
  const chipH = 6;
  const chipPadX = 4;
  const chipGapX = 3;
  const chipGapY = 3;
  checkPage(chipH + chipGapY + 4);

  c.keywords.forEach(kw => {
    const kw_w = doc.getTextWidth(kw) + chipPadX * 2;
    if (kx + kw_w > pageW - margin) {
      kx = margin;
      y += chipH + chipGapY;
      checkPage(chipH + chipGapY);
    }
    doc.setFillColor(255, 248, 220);
    doc.setDrawColor(201, 168, 76);
    doc.setLineWidth(0.25);
    doc.roundedRect(kx, y - 4, kw_w, chipH, 1, 1, 'FD');
    doc.setTextColor(120, 90, 20);
    doc.text(kw, kx + chipPadX, y + 0.5);
    kx += kw_w + chipGapX;
  });
  y += chipH + 12;

  // ---- Section: Case Details table ----
  checkPage(50);
  doc.setFillColor(245, 240, 225);
  doc.setDrawColor(201, 168, 76);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y - 1, contentW, 7, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(130, 100, 30);
  doc.text('CASE DETAILS', margin + 3, y + 4.5);
  y += 10;

  const details = [
    ['Case Name', c.title],
    ['Court', c.court],
    ['Year', String(c.year)],
    ['Law Type', c.type + ' Law'],
    ['Outcome', c.outcome],
    ['Case ID', 'NM-' + String(c.id).padStart(4, '0')],
  ];
  const colLabel = 50;
  const colValue = contentW - colLabel;

  details.forEach(([label, value], idx) => {
    const valueLines = doc.splitTextToSize(value, colValue - 4);
    const rowH = Math.max(7, valueLines.length * 5 + 3);
    checkPage(rowH + 1);
    if (idx % 2 === 0) {
      doc.setFillColor(250, 248, 240);
      doc.rect(margin, y - 4.5, contentW, rowH, 'F');
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 80, 30);
    doc.text(label, margin + 2, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 35, 55);
    doc.text(valueLines, margin + colLabel, y);
    y += rowH;
  });

  y += 10;

  // ---- Footer ----
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFillColor(20, 25, 45);
    doc.rect(0, pageH - 12, pageW, 12, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(150, 130, 80);
    doc.text('NyayaMind — AI Legal Intelligence  |  For informational purposes only. Not legal advice.', margin, pageH - 4.5);
    doc.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 4.5, { align: 'right' });
  }

  // ---- Save ----
  const filename = 'NyayaMind_' + c.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40) + '_' + c.year + '.pdf';
  doc.save(filename);

  // Flash feedback
  showPdfToast('📄 PDF downloaded successfully!');
}

function showPdfToast(msg) {
  let toast = document.getElementById('pdf-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'pdf-toast';
    toast.className = 'pdf-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============================================================
//  CASE MODAL & AI CHAT (ChatGPT & ElevenLabs)
// ============================================================
let activeCaseForChat = null;

function openCase(id) {
  const c = CASES.find(x => String(x.id) === String(id)) ||
            DEPT_EXTRA_CASES.find(x => String(x.id) === String(id));
  if (!c) return;
  
  // Track history in 'history' localStorage key (used by renderHistViewed)
  try {
    const hist = JSON.parse(localStorage.getItem('history') || '[]');
    const filtered = hist.filter(h => String(h.id) !== String(id));
    filtered.unshift({ ...c, time: Date.now() });
    localStorage.setItem('history', JSON.stringify(filtered.slice(0, 50)));
  } catch(e) {}

  activeCaseForChat = c;
  
  const modal = document.getElementById('case-modal');
  if (!modal) return;
  
  document.getElementById('cm-title').textContent = c.title;
  document.getElementById('cm-court').textContent = c.court + ' • ' + (c.year || 'N/A');
  document.getElementById('cm-type').textContent = c.type;
  document.getElementById('cm-summary').textContent = c.summary;
  
  document.getElementById('cm-chat-history').innerHTML = '<div class="chat-msg ai-msg">Hello! I am NyayaMind. How can I help you understand this case?</div>';
  
  updateModalCompareBtn();
  modal.style.display = 'flex';
}

function closeCaseModal() {
  document.getElementById('case-modal').style.display = 'none';
  activeCaseForChat = null;
}

async function sendCaseChat() {
  const input = document.getElementById('cm-chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  
  input.value = '';
  const hist = document.getElementById('cm-chat-history');
  hist.innerHTML += `<div class="chat-msg user-msg">${msg}</div>`;
  hist.scrollTop = hist.scrollHeight;
  
  hist.innerHTML += `<div class="chat-msg ai-msg loading-msg" id="cm-loading">Thinking...</div>`;
  hist.scrollTop = hist.scrollHeight;
  
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, caseContext: activeCaseForChat })
    });
    const data = await res.json();
    document.getElementById('cm-loading').remove();
    
    if (data.success) {
      const msgId = 'msg-' + Date.now();
      hist.innerHTML += `
        <div class="chat-msg ai-msg" id="${msgId}">
          ${data.reply}
          <button class="tts-btn" onclick="playTTS('${msgId}')" title="Read Aloud">🔊</button>
        </div>`;
    } else {
      hist.innerHTML += `<div class="chat-msg ai-msg" style="color:red">Error: Could not get reply.</div>`;
    }
  } catch (err) {
    document.getElementById('cm-loading')?.remove();
    hist.innerHTML += `<div class="chat-msg ai-msg" style="color:red">Connection error.</div>`;
  }
  hist.scrollTop = hist.scrollHeight;
}

async function playTTS(msgId) {
  const el = document.getElementById(msgId);
  if (!el) return;
  
  // Extract text without the button
  const clone = el.cloneNode(true);
  const btn = clone.querySelector('button');
  if (btn) btn.remove();
  const text = clone.textContent.trim();
  
  const originalBtnText = document.querySelector(`#${msgId} .tts-btn`).textContent;
  document.querySelector(`#${msgId} .tts-btn`).textContent = '⏳';
  
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    
    if (!res.ok) throw new Error('TTS failed');
    
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
    
    audio.onended = () => {
        document.querySelector(`#${msgId} .tts-btn`).textContent = '🔊';
    };
  } catch (err) {
    alert("TTS Error: " + err.message);
    document.querySelector(`#${msgId} .tts-btn`).textContent = '🔊';
  }
}

// Ensure Enter key sends chat
document.addEventListener('keydown', e => {
    if(e.key === 'Enter' && document.activeElement.id === 'cm-chat-input') {
        sendCaseChat();
    }
});



function updateModalCompareBtn() {
  const btn = document.getElementById('cm-compare-btn');
  if (!btn || !activeCaseForChat) return;
  
  const inList = compareList.includes(activeCaseForChat.id);
  const idx = compareList.indexOf(activeCaseForChat.id);
  
  if (inList) {
    const col = COMPARE_COLORS[idx];
    btn.textContent = `⊖ ${col.label}`;
    btn.style.background = col.bg;
    btn.style.color = col.text;
    btn.style.borderColor = col.border;
    btn.style.borderStyle = 'solid';
    btn.style.borderWidth = '1px';
  } else {
    btn.textContent = `⊕ Compare`;
    btn.style.background = 'var(--accent)';
    btn.style.color = '#000';
    btn.style.border = 'none';
  }
}


async function fetchLiveStats() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/status`);
    const data = await res.json();
    if (data.success) {
      const total = data.total || 0;
      const courts = data.courtsCount || 0;
      const heroStat = document.getElementById('hero-stat-cases');
      const indexedStat = document.getElementById('stat-cases-indexed');
      const courtsStat = document.getElementById('stat-courts-covered');
      const updatedStat = document.getElementById('stat-last-updated');
      const mobileStat = document.getElementById('mobile-stat-cases');
      
      const proCasesStat = document.getElementById('pro-cases-indexed');
      const proCourtsStat = document.getElementById('pro-courts-covered');

      if (heroStat) heroStat.textContent = total.toLocaleString() + '+';
      if (indexedStat) indexedStat.textContent = total.toLocaleString();
      if (courtsStat) courtsStat.textContent = courts + '+';
      if (mobileStat) mobileStat.textContent = total.toLocaleString();
      if (proCasesStat) proCasesStat.textContent = total.toLocaleString();
      if (proCourtsStat) proCourtsStat.textContent = courts + '+';
      if (updatedStat) {
        const now = new Date();
        updatedStat.textContent = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', day: 'numeric' });
      }
    }
  } catch (err) {
    // Fallback: show CASES.length if backend not reachable
    const total = CASES.length;
    const heroStat = document.getElementById('hero-stat-cases');
    const mobileStat = document.getElementById('mobile-stat-cases');
    if (heroStat && total > 0) heroStat.textContent = total.toLocaleString() + '+';
    if (mobileStat && total > 0) mobileStat.textContent = total.toLocaleString();
    console.warn('[NyayaMind] Could not fetch live stats, using local count', err.message);
  }
}

// Refresh stats every 60 seconds to stay live
setInterval(fetchLiveStats, 60000);
