/* ═══════════════════════════════════════════
   La Casetta — Caisse POS
   Stockage : localStorage
═══════════════════════════════════════════ */

// ══════════════════════════════════════════
//  LOGIN — code PIN
// ══════════════════════════════════════════
(function initLogin() {
  const DEFAULT_PIN = '1234';
  const getPin = () => localStorage.getItem('pos_pin') || DEFAULT_PIN;

  const screen   = document.getElementById('login-screen');
  const dots     = document.querySelectorAll('#pin-dots span');
  const errorEl  = document.getElementById('pin-error');
  let   entry    = '';

  function updateDots() {
    dots.forEach((d, i) => {
      d.classList.toggle('filled', i < entry.length);
      d.classList.remove('error');
    });
    errorEl.textContent = '';
  }

  function shake() {
    dots.forEach(d => d.classList.add('error'));
    errorEl.textContent = 'Code incorrect';
    entry = '';
    setTimeout(updateDots, 600);
  }

  function tryUnlock() {
    if (entry === getPin()) {
      sessionStorage.setItem('pos_unlocked', '1');
      screen.classList.add('hidden');
      setTimeout(() => screen.style.display = 'none', 300);
    } else {
      shake();
    }
  }

  function pressKey(val) {
    if (entry.length >= 4) return;
    entry += val;
    updateDots();
    if (entry.length === 4) setTimeout(tryUnlock, 150);
  }

  function pressDelete() {
    entry = entry.slice(0, -1);
    updateDots();
  }

  // Clavier PIN
  document.querySelectorAll('.pin-key[data-val]').forEach(btn => {
    btn.addEventListener('click', () => pressKey(btn.dataset.val));
  });
  document.getElementById('pin-del').addEventListener('click', pressDelete);

  // Clavier physique
  document.addEventListener('keydown', e => {
    if (screen.classList.contains('hidden')) return;
    if (e.key >= '0' && e.key <= '9') pressKey(e.key);
    else if (e.key === 'Backspace') pressDelete();
  });

  // Si déjà déverrouillé dans cette session
  if (sessionStorage.getItem('pos_unlocked') === '1') {
    screen.style.display = 'none';
  }

  // Bouton verrou
  document.getElementById('btn-lock').addEventListener('click', () => {
    sessionStorage.removeItem('pos_unlocked');
    entry = '';
    updateDots();
    screen.style.display = 'flex';
    requestAnimationFrame(() => screen.classList.remove('hidden'));
  });

  // Modal changement de PIN
  document.getElementById('btn-lock').addEventListener('dblclick', e => {
    e.stopPropagation();
  });

  // Ouvrir modal PIN depuis un lien dans la page (bouton dans settings futur)
  window.openPinModal = function() {
    document.getElementById('modal-pin').classList.add('open');
    document.getElementById('pin-current').value = '';
    document.getElementById('pin-new').value = '';
    document.getElementById('pin-confirm').value = '';
    document.getElementById('pin-modal-error').textContent = '';
  };

  document.getElementById('btn-pin-cancel').addEventListener('click', () => {
    document.getElementById('modal-pin').classList.remove('open');
  });

  document.getElementById('btn-pin-save').addEventListener('click', () => {
    const current = document.getElementById('pin-current').value.trim();
    const nouveau = document.getElementById('pin-new').value.trim();
    const confirm = document.getElementById('pin-confirm').value.trim();
    const errEl   = document.getElementById('pin-modal-error');

    if (current !== getPin())            { errEl.textContent = 'Code actuel incorrect.'; return; }
    if (!/^\d{4}$/.test(nouveau))        { errEl.textContent = 'Le nouveau PIN doit contenir exactement 4 chiffres.'; return; }
    if (nouveau !== confirm)             { errEl.textContent = 'Les deux PINs ne correspondent pas.'; return; }

    localStorage.setItem('pos_pin', nouveau);
    document.getElementById('modal-pin').classList.remove('open');
    // showToast est défini plus bas — on utilise un event pour ne pas dépendre de l'ordre
    document.dispatchEvent(new CustomEvent('pos:toast', { detail: '✔ Code PIN modifié.' }));
  });
})();

// ── Storage helpers ──────────────────────────────────────────────────────────
const LS = {
  get: (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

// ── Mode formation / test ─────────────────────────────────────────────────────
// En mode formation, les ventes vont dans un espace LOCAL séparé et sont
// synchronisées vers un déploiement Apps Script de TEST (Sheet de test) — jamais
// vers la prod. Le catalogue (articles/catégories) reste partagé entre les modes.
const PROD_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbzxGbmC6fJ2khbh6hYhwGvP-LRCeo3SLX8MCkYYTlDMEdQQ-CY6RRQudqoIaPJ8vYOZ/exec';
const TEST_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbzMZ1t__JojJAREbp7uP6uYyFiVurIIAAT95TwIIUgshJX_sWMBRHjh6vgqkG7B3ig0OA/exec';

function isTestMode() { return LS.get('pos_testmode', false) === true; }
function sheetsUrl()  { return isTestMode() ? TEST_SHEETS_URL : PROD_SHEETS_URL; }
function txKey()      { return isTestMode() ? 'pos_transactions_test' : 'pos_transactions'; }

// ── State ────────────────────────────────────────────────────────────────────
const CATALOGUE_VERSION = 2;
let articles = (LS.get('pos_catalogue_version', 0) < CATALOGUE_VERSION)
  ? (() => { const a = defaultArticles(); LS.set('pos_articles', a); LS.set('pos_catalogue_version', CATALOGUE_VERSION); return a; })()
  : LS.get('pos_articles', defaultArticles());
let ticket    = [];
let payMethod = 'especes';
let currentTx = null;
let editingTxId = null;      // vente rouverte en cours de complément
let editingOriginal = null;  // la transaction d'origine (déjà payée)

// ── Employés ───────────────────────────────────────────────────────────────────
// Liste d'employés ; l'un d'eux est « par défaut » (activé au démarrage du POS)
// et un « courant » est sélectionné pour la session (celui qui encaisse).
const DEFAULT_EMPLOYEES = [
  { id: 'clemence-bailly', name: 'Clémence Bailly' },
];
let employees = LS.get('pos_employees', null) || DEFAULT_EMPLOYEES;
if (!LS.get('pos_employees', null)) LS.set('pos_employees', employees);
// Employé par défaut : Clémence Bailly (activée par défaut sur le POS)
let defaultEmployeeId = LS.get('pos_employee_default', null)
  || (employees[0] && employees[0].id) || null;
if (defaultEmployeeId && !LS.get('pos_employee_default', null)) LS.set('pos_employee_default', defaultEmployeeId);
// Employé courant : chaque nouvelle journée repart sur l'employé par défaut
// (Clémence Bailly) ; en cours de journée on mémorise l'employé sélectionné.
let currentEmployeeId = (() => {
  const today     = todayISO();
  const savedDate = LS.get('pos_employee_current_date', '');
  if (savedDate === today) return LS.get('pos_employee_current', defaultEmployeeId);
  LS.set('pos_employee_current', defaultEmployeeId);
  LS.set('pos_employee_current_date', today);
  return defaultEmployeeId;
})();

// ── Default catalogue (v2 — menu La Casetta) ─────────────────────────────────

function defaultArticles() {
  return [
    // Pizzas petites
    { id: uid(), name: 'Margherita (P)',        category: 'Petite', price: 7,    emoji: '🍕' },
    { id: uid(), name: 'Regina (P)',             category: 'Petite', price: 9,    emoji: '🍕' },
    { id: uid(), name: '4 Formaggi (P)',         category: 'Petite', price: 11,   emoji: '🧀' },
    { id: uid(), name: 'Piccante (P)',           category: 'Petite', price: 9,    emoji: '🌶️' },
    { id: uid(), name: 'Caprino (P)',            category: 'Petite', price: 11,   emoji: '🐐' },
    { id: uid(), name: 'Montarana (P)',          category: 'Petite', price: 11,   emoji: '🏔️' },
    { id: uid(), name: 'Italiana (P)',           category: 'Petite', price: 9,    emoji: '🍅' },
    { id: uid(), name: 'Cesare (P)',             category: 'Petite', price: 11,   emoji: '🍗' },
    { id: uid(), name: 'Sottobosco (P)',         category: 'Petite', price: 9,    emoji: '🍄' },
    { id: uid(), name: 'Sole in vista (P)',      category: 'Petite', price: 9,    emoji: '☀️' },
    { id: uid(), name: 'Carbonara (P)',          category: 'Petite', price: 9,    emoji: '🥓' },
    { id: uid(), name: 'Pollo e Gorgonzola (P)', category: 'Petite', price: 11,   emoji: '🍗' },
    // Pizzas grandes
    { id: uid(), name: 'Margherita (G)',        category: 'Grande', price: 10,   emoji: '🍕' },
    { id: uid(), name: 'Regina (G)',             category: 'Grande', price: 12,   emoji: '🍕' },
    { id: uid(), name: '4 Formaggi (G)',         category: 'Grande', price: 14,   emoji: '🧀' },
    { id: uid(), name: 'Piccante (G)',           category: 'Grande', price: 12,   emoji: '🌶️' },
    { id: uid(), name: 'Caprino (G)',            category: 'Grande', price: 14,   emoji: '🐐' },
    { id: uid(), name: 'Montarana (G)',          category: 'Grande', price: 14,   emoji: '🏔️' },
    { id: uid(), name: 'Italiana (G)',           category: 'Grande', price: 12,   emoji: '🍅' },
    { id: uid(), name: 'Cesare (G)',             category: 'Grande', price: 14,   emoji: '🍗' },
    { id: uid(), name: 'Sottobosco (G)',         category: 'Grande', price: 12,   emoji: '🍄' },
    { id: uid(), name: 'Sole in vista (G)',      category: 'Grande', price: 12,   emoji: '☀️' },
    { id: uid(), name: 'Carbonara (G)',          category: 'Grande', price: 12,   emoji: '🥓' },
    { id: uid(), name: 'Pollo e Gorgonzola (G)', category: 'Grande', price: 14,   emoji: '🍗' },
    // Suppléments
    { id: uid(), name: 'Jambon / Salsiccia / Guanciale / Poulet', category: 'Supp', price: 3,    emoji: '➕' },
    { id: uid(), name: 'Fromages',              category: 'Supp',    price: 2.5,  emoji: '🧀' },
    { id: uid(), name: 'Tomates confites / Poivrons rôtis',       category: 'Supp', price: 2,    emoji: '🍅' },
    { id: uid(), name: 'Champignons / Roquette / Pomme de terre / Olives', category: 'Supp', price: 1.5, emoji: '🥗' },
    { id: uid(), name: 'Sauces',                category: 'Supp',    price: 1,    emoji: '🥫' },
    // Desserts
    { id: uid(), name: 'Tiramisu',              category: 'Desserts',       price: 4.5,  emoji: '🍮' },
    { id: uid(), name: 'Panna cotta',           category: 'Desserts',       price: 4,    emoji: '🍮' },
    { id: uid(), name: 'Brownie',               category: 'Desserts',       price: 4,    emoji: '🍫' },
  ];
}

function uid() { return Math.random().toString(36).slice(2, 10); }

// ── Date helpers ─────────────────────────────────────────────────────────────
function todayISO() { return new Date().toISOString().slice(0, 10); }
function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtEur(n) {
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// ── Transactions store ───────────────────────────────────────────────────────
function getTransactions() { return LS.get(txKey(), []); }
function saveTransactions(txs) { LS.set(txKey(), txs); }

function addTransaction(tx) {
  const txs = getTransactions();
  txs.push(tx);
  saveTransactions(txs);
}

// ── Catalogue partagé (synchronisé entre tous les iPads via Google Sheets) ─────
// Le catalogue passe TOUJOURS par le backend de prod (même en mode formation) :
// c'est le même menu d'articles pour tout le monde.
let catalogueUpdatedAt   = LS.get('pos_catalogue_updatedAt', '');
let cataloguePushPending = false;
let catalogueLoading     = false;

// Sauvegarde locale + envoi au cloud à chaque modification du catalogue.
function saveArticles() {
  LS.set('pos_articles', articles);
  catalogueUpdatedAt = new Date().toISOString();
  LS.set('pos_catalogue_updatedAt', catalogueUpdatedAt);
  pushCatalogue();
}

// Envoie tout le catalogue au Google Sheet (avec reprise si hors-ligne).
async function pushCatalogue() {
  const payload = {
    catalogue: articles.map((a, i) => ({
      id: a.id, name: a.name, category: a.category,
      price: a.price, emoji: a.emoji || '', order: i, active: a.active !== false
    })),
    updatedAt: catalogueUpdatedAt
  };
  try {
    const res = await fetch(PROD_SHEETS_URL, { method: 'POST', body: JSON.stringify(payload) });
    const j = await res.json();
    if (j && j.ok) { cataloguePushPending = false; setSyncStatus('ok'); setTimeout(() => setSyncStatus('idle'), 2000); }
    else cataloguePushPending = true;
  } catch {
    cataloguePushPending = true;   // repartira via l'écouteur online / la relance périodique
  }
}

// Récupère le catalogue partagé au démarrage (et au besoin) — JSONP, sans CORS.
function pullCatalogue() {
  if (catalogueLoading) return;
  catalogueLoading = true;
  const cbName = '__catCb' + Date.now();
  let script;
  const cleanup = () => { try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
    if (script) script.remove(); catalogueLoading = false; clearTimeout(timer); };
  const timer = setTimeout(cleanup, 20000);
  window[cbName] = data => {
    cleanup();
    if (!data || !data.ok || !Array.isArray(data.articles)) return;
    const remoteAt = data.updatedAt || '';
    if (data.articles.length === 0) {
      // Cloud vide : le 1er iPad amorce le catalogue partagé avec ses articles.
      if (articles.length && !remoteAt) {
        catalogueUpdatedAt = new Date().toISOString();
        LS.set('pos_catalogue_updatedAt', catalogueUpdatedAt);
        pushCatalogue();
      }
      return;
    }
    // On adopte le catalogue distant s'il est plus récent et qu'on n'a pas d'édition locale en attente.
    if (!cataloguePushPending && (!catalogueUpdatedAt || remoteAt > catalogueUpdatedAt)) {
      articles = data.articles.map(a => ({
        id: a.id, name: a.name, category: a.category,
        price: Number(a.price), emoji: a.emoji || '', active: a.active !== false
      }));
      LS.set('pos_articles', articles);          // adoption locale SANS repousser au cloud
      catalogueUpdatedAt = remoteAt;
      LS.set('pos_catalogue_updatedAt', catalogueUpdatedAt);
      renderCategories();
      renderArticles();
    }
  };
  script = document.createElement('script');
  script.src = PROD_SHEETS_URL + '?action=catalogue&callback=' + cbName + '&t=' + Date.now();
  script.onerror = cleanup;
  document.body.appendChild(script);
}

// ── Rouvrir une vente payée pour encaisser un complément ──────────────────────
function reopenTransaction(id) {
  if (ticket.length) { showToast('Terminez ou videz le ticket en cours avant de rouvrir une vente.'); return; }
  // cherche dans la source fusionnée (local + Google Sheets), pas seulement en local
  const tx = reportSource().find(t => t.id === id);
  if (!tx || tx.cancelled) { showToast('Vente introuvable.'); return; }
  editingTxId = id;
  editingOriginal = tx;
  ticket = [];
  exitOfferMode();
  document.querySelector('.tab-btn[data-tab="caisse"]').click();
  renderEditBanner();
  renderTicket();
  showToast('🔁 Vente rouverte — ajoutez les articles à encaisser.');
}

function renderEditBanner() {
  const el = document.getElementById('edit-tx-banner');
  if (!editingTxId || !editingOriginal) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const items = editingOriginal.lines.map(l => `${emojiFor(l)}${l.name} ×${l.qty}`).join(', ');
  el.style.display = 'block';
  el.innerHTML = `
    <div class="etb-top"><b>🔁 Complément de vente</b><button id="btn-cancel-edit" class="etb-cancel">✕ Annuler</button></div>
    <div class="etb-info">Déjà payé : <b>${fmtEur(editingOriginal.total)}</b> · ${{especes:'espèces',carte:'carte'}[editingOriginal.method]||editingOriginal.method} · ${fmtTime(editingOriginal.date)}</div>
    <div class="etb-items">${items}</div>
    <div class="etb-hint">Ajoutez les nouveaux articles — seul leur montant sera encaissé.</div>`;
  document.getElementById('btn-cancel-edit').addEventListener('click', cancelEdit);
}

function cancelEdit() {
  editingTxId = null;
  editingOriginal = null;
  ticket = [];
  exitOfferMode();
  setTicketClient(null);
  document.getElementById('cash-given').value = '';
  renderEditBanner();
  renderTicket();
}

function cancelTransaction(id) {
  const txs = getTransactions();
  const t = txs.find(t => t.id === id);
  if (t) { t.cancelled = true; saveTransactions(txs); }
  // met aussi à jour le snapshot chargé depuis Sheets (affichage immédiat)
  if (reportTransactions) {
    const rt = reportTransactions.find(x => x.id === id);
    if (rt) rt.cancelled = true;
  }
  // propage l'annulation au Google Sheet (statut → Annulé + recalcul des onglets)
  cancelOnSheets(id, !!(t && t.synced));
}

// Marque le ticket « Annulé » dans le Google Sheet (via JSONP).
function cancelOnSheets(id, wasSynced) {
  if (!sheetsUrl()) return;   // mode test sans backend configuré : rien à propager
  const cbName = '__cancelCb' + Date.now();
  let script;
  const cleanup = () => { try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
    if (script) script.remove(); clearTimeout(timer); };
  const timer = setTimeout(cleanup, 20000);
  window[cbName] = data => {
    cleanup();
    if (data && data.ok && data.cancelled > 0) showToast('Vente annulée aussi dans Google Sheets.');
    else if (!wasSynced) { /* pas encore dans le Sheet : partira en « Annulé » à la sync */ }
  };
  script = document.createElement('script');
  script.src = sheetsUrl() + '?action=cancel&id=' + encodeURIComponent(id) + '&callback=' + cbName + '&t=' + Date.now();
  script.onerror = cleanup;
  document.body.appendChild(script);
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'memo') { renderMemo(); autoLoadSheets(); }
    if (btn.dataset.tab === 'reporting') { renderReporting(); autoLoadSheets(); }
    if (btn.dataset.tab === 'dashboard') { renderDashboard(); autoLoadSheets(); }
    if (btn.dataset.tab === 'horaires') { renderHoraires(); }
    if (btn.dataset.tab === 'clients') { renderClients(); autoLoadSheets(); }
  });
});

// ══════════════════ TABLEAU DE BORD ════════════════════════════════════════════
let dashPeriod = 'all'; // par défaut : toutes les ventes (vue globale, comme le PDF)

document.querySelectorAll('.dash-period').forEach(b => {
  b.addEventListener('click', () => {
    dashPeriod = b.dataset.period;
    document.querySelectorAll('.dash-period').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    renderDashboard();
  });
});

function dashRange() {
  const end = todayISO();
  const shift = (iso, d) => { const t = new Date(iso + 'T12:00:00'); t.setDate(t.getDate() + d); return t.toISOString().slice(0, 10); };
  if (dashPeriod === 'today') return [end, end];
  if (dashPeriod === '7')     return [shift(end, -6), end];
  if (dashPeriod === '30')    return [shift(end, -29), end];
  const days = reportSource().filter(t => !t.cancelled).map(t => t.date.slice(0, 10)).sort();
  return [days[0] || end, end];
}

function dbCols(items) { // [{label, sub, value, hot}]
  const max = Math.max(...items.map(i => i.value), 1);
  return `<div class="db-cols">${items.map(i => `
    <div class="db-colbar${i.hot ? ' hot' : ''}" title="${i.title || ''}">
      <span class="db-cv">${i.vlabel}</span>
      <div class="db-bar" style="height:${Math.max(i.value / max * 100, 3)}%"></div>
      <div class="db-cx"><b>${i.label}</b>${i.sub || ''}</div>
    </div>`).join('')}</div>`;
}

function dbRows(items) { // [{name, right, value, lead}]
  const max = Math.max(...items.map(i => i.value), 1);
  return `<div class="db-rows">${items.map(i => `
    <div class="db-row">
      <div class="db-rtop"><span>${i.name}</span><span class="db-rval">${i.right}</span></div>
      <div class="db-track"><div class="db-fill${i.lead ? ' lead' : ''}" style="width:${Math.max(i.value / max * 100, 2)}%"></div></div>
    </div>`).join('')}</div>`;
}

function renderDashboard() {
  const [start, end] = dashRange();
  const txs = txsForRange(start, end);
  document.getElementById('dash-updated').textContent =
    'Mis à jour ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const body = document.getElementById('dashboard-body');
  if (!txs.length) { body.innerHTML = '<p class="empty-msg">Aucune vente sur cette période.</p>'; return; }

  const CA   = txs.reduce((s, t) => s + t.total, 0);
  const nbtk = txs.length;
  const nbart = txs.reduce((s, t) => s + t.lines.reduce((a, l) => a + l.qty, 0), 0);
  const panier = CA / nbtk;

  // agrégations
  const byDay = {}, byLoc = {}, byCat = {}, byHour = {}, byPay = { especes: 0, carte: 0 }, byArt = {};
  const A = (m, k, n) => { m[k] = (m[k] || 0) + n; };
  txs.forEach(t => {
    const d = t.date.slice(0, 10);
    (byDay[d] = byDay[d] || { n: 0, ca: 0, art: 0 });
    byDay[d].n++; byDay[d].ca += t.total; byDay[d].art += t.lines.reduce((a, l) => a + l.qty, 0);
    A(byLoc, t.location || '(non défini)', t.total);
    A(byHour, String(new Date(t.date).getHours()).padStart(2, '0'), t.total);
    byPay[t.method] = (byPay[t.method] || 0) + t.total;
    t.lines.forEach(l => { A(byCat, l.category || '—', l.subtotal); if (/pizza/i.test(l.category || '')) A(byArt, l.name, l.subtotal); });
  });

  // attache (chaque tx = 1 ticket)
  const withDessert = txs.filter(t => t.lines.some(l => /dessert/i.test(l.category || ''))).length;
  const withSupp    = txs.filter(t => t.lines.some(l => /suppl/i.test(l.category || ''))).length;
  const withBoisson = txs.filter(t => t.lines.some(l => /boisson/i.test(l.category || ''))).length;

  // jours (max 12 récents)
  const dayKeys = Object.keys(byDay).sort().slice(-12);
  const peakDayCA = Math.max(...dayKeys.map(d => byDay[d].ca));
  const dayItems = dayKeys.map(d => {
    const dd = new Date(d + 'T12:00:00');
    return { label: dd.toLocaleDateString('fr-FR', { weekday: 'short' }), sub: dd.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      value: byDay[d].ca, vlabel: Math.round(byDay[d].ca) + '€', hot: byDay[d].ca === peakDayCA,
      title: `${byDay[d].n} tickets · ${fmtEur(byDay[d].ca)}` };
  });

  // articles vendus par jour
  const peakDayArt = Math.max(...dayKeys.map(d => byDay[d].art));
  const artDayItems = dayKeys.map(d => {
    const dd = new Date(d + 'T12:00:00');
    return { label: dd.toLocaleDateString('fr-FR', { weekday: 'short' }), sub: dd.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      value: byDay[d].art, vlabel: String(byDay[d].art), hot: byDay[d].art === peakDayArt,
      title: `${byDay[d].art} articles` };
  });

  // heures
  const hourKeys = Object.keys(byHour).sort();
  const peakHourCA = Math.max(...hourKeys.map(h => byHour[h]));
  const hourItems = hourKeys.map(h => ({ label: h + 'h', value: byHour[h], vlabel: Math.round(byHour[h]) + '€',
    hot: byHour[h] === peakHourCA, title: fmtEur(byHour[h]) }));

  const locRows = Object.entries(byLoc).sort((a, b) => b[1] - a[1]).map(([k, v], i) =>
    ({ name: '📍 ' + k, right: `<b>${fmtEur(v)}</b> · ${Math.round(v / CA * 100)}%`, value: v, lead: i === 0 }));
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v], i) =>
    ({ name: k, right: `<b>${fmtEur(v)}</b> · ${Math.round(v / CA * 100)}%`, value: v, lead: i === 0 }));
  const topArt = Object.entries(byArt).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const cartePct = Math.round(byPay.carte / CA * 100);
  const espPct = 100 - cartePct;

  body.innerHTML = `
    <div class="db-kpis">
      <div class="db-kpi"><span class="n">${fmtEur(CA)}</span><div class="l">CA total</div><div class="s">${dayKeys.length} jour(s)</div></div>
      <div class="db-kpi"><span class="n">${nbtk}</span><div class="l">Tickets</div><div class="s">${nbart} articles</div></div>
      <div class="db-kpi"><span class="n">${fmtEur(panier)}</span><div class="l">Panier moyen</div><div class="s">${(nbart / nbtk).toFixed(2)} art./ticket</div></div>
      <div class="db-kpi"><span class="n">${fmtEur(CA / (dayKeys.length || 1))}</span><div class="l">CA / jour</div><div class="s">moyenne</div></div>
    </div>
    <div class="db-grid">
      <div class="db-card"><h3>Chiffre d'affaires par jour</h3><p class="cap">Jour le plus fort surligné.</p>${dbCols(dayItems)}</div>
      <div class="db-card"><h3>Articles vendus par jour</h3><p class="cap">Nombre d'articles écoulés.</p>${dbCols(artDayItems)}</div>
      <div class="db-card"><h3>Affluence par heure</h3><p class="cap">Ton pic de vente.</p>${dbCols(hourItems)}</div>
      <div class="db-card"><h3>CA par emplacement</h3><p class="cap">Part du CA total.</p>${dbRows(locRows)}</div>
      <div class="db-card"><h3>CA par catégorie</h3><p class="cap">Ce qui fait le chiffre.</p>${dbRows(catRows)}</div>
      <div class="db-card"><h3>Moyens de paiement</h3><p class="cap">Garde le TPE chargé.</p>
        <div class="db-split"><span style="width:${cartePct}%;background:var(--terracotta)"></span><span style="width:${espPct}%;background:var(--olive)"></span></div>
        <div class="db-legend"><div><span class="db-sw" style="background:var(--terracotta)"></span>Carte ${fmtEur(byPay.carte)} · ${cartePct}%</div><div><span class="db-sw" style="background:var(--olive)"></span>Espèces ${fmtEur(byPay.especes)} · ${espPct}%</div></div>
      </div>
      <div class="db-card"><h3>Taux d'attache · top pizzas</h3><p class="cap">Leviers de panier moyen.</p>
        <div class="db-meter"><div class="db-mtop"><span>Boisson</span><b>${Math.round(withBoisson / nbtk * 100)}%</b></div><div class="db-track"><div class="db-fill" style="width:${Math.max(Math.round(withBoisson / nbtk * 100), 1)}%;background:#2b7a9e"></div></div></div>
        <div class="db-meter"><div class="db-mtop"><span>Dessert</span><b>${Math.round(withDessert / nbtk * 100)}%</b></div><div class="db-track"><div class="db-fill" style="width:${Math.round(withDessert / nbtk * 100)}%;background:var(--olive)"></div></div></div>
        <div class="db-meter"><div class="db-mtop"><span>Supplément</span><b>${Math.round(withSupp / nbtk * 100)}%</b></div><div class="db-track"><div class="db-fill" style="width:${Math.max(Math.round(withSupp / nbtk * 100), 1)}%;background:var(--terracotta-light)"></div></div></div>
        <ol class="db-top">${topArt.map(([n, v]) => `<li><span>${n}</span><b>${fmtEur(v)}</b></li>`).join('') || '<li><span>—</span></li>'}</ol>
      </div>
    </div>`;
}

// ── Date display ─────────────────────────────────────────────────────────────
function updateDateDisplay() {
  document.getElementById('date-display').textContent =
    new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
updateDateDisplay();
setInterval(updateDateDisplay, 60000);

// ══════════════════ CATALOGUE ══════════════════════════════════════════════════

let activeCategory = 'Tous';
let categoryOrder = LS.get('pos_category_order', null); // ordre choisi par l'utilisateur

// Catégories présentes dans les articles, dans l'ordre choisi (puis les nouvelles à la fin).
function orderedCategories() {
  const present = [...new Set(articles.map(a => a.category))];
  if (!categoryOrder) return present;
  const ordered = categoryOrder.filter(c => present.includes(c));
  present.forEach(c => { if (!ordered.includes(c)) ordered.push(c); });
  return ordered;
}

function categories() {
  return ['Tous', ...orderedCategories()];
}

// Renommages de catégories canoniques (ancien nom -> nouveau nom).
const CAT_CANON = {
  'Suppléments': 'Supp',
  'Pizzas grandes': 'Grande',
  'Pizzas petites': 'Petite'
};
function canonCat(c) { return CAT_CANON[c] || c; }

// Libellés + couleur par catégorie (les valeurs réelles servent au filtrage).
const CAT_LABELS = {
  'Tous': 'Tous', 'Desserts': 'Dessert'
};
const CAT_COLORS = {
  'Tous': '#89310B', 'Grande': '#2f7d8a', 'Petite': '#76894F',
  'Boissons': '#4a6fa5', 'Supp': '#c9822b', 'Desserts': '#8e5572'
};
const CAT_PALETTE = ['#89310B', '#2f7d8a', '#76894F', '#c9822b', '#8e5572', '#4a6fa5', '#a5504a'];
// Ordre d'affichage souhaité (les inconnues suivent, dans leur ordre existant).
const CAT_ORDER = ['Grande', 'Petite', 'Boissons', 'Supp', 'Desserts'];

// Migration ponctuelle : applique les renommages CAT_CANON aux articles locaux
// (et supprime un éventuel doublon d'article de même nom déjà présent dans la cible).
function migrateCategories() {
  let changed = false;
  const kept = [];
  const seenByCat = {}; // catégorie cible -> noms déjà présents (pour dédoublonner)
  articles.forEach(a => { if (!CAT_CANON[a.category]) (seenByCat[a.category] = seenByCat[a.category] || new Set()).add(a.name); });
  articles.forEach(a => {
    const target = CAT_CANON[a.category];
    if (target) {
      changed = true;
      const set = seenByCat[target] = seenByCat[target] || new Set();
      if (set.has(a.name)) return;   // doublon exact : on retire l'ancien
      set.add(a.name);
      a.category = target;
    }
    kept.push(a);
  });
  if (changed) {
    articles = kept;
    catalogueUpdatedAt = new Date().toISOString();
    LS.set('pos_articles', articles);
    LS.set('pos_catalogue_updatedAt', catalogueUpdatedAt);
  }
  return changed;
}

function catLabel(cat) { return CAT_LABELS[cat] || cat; }
function catColor(cat, i) { return CAT_COLORS[cat] || CAT_PALETTE[i % CAT_PALETTE.length]; }

function renderCategories() {
  const el = document.getElementById('category-tabs');
  el.innerHTML = '';
  const rank = c => { const i = CAT_ORDER.indexOf(c); return i === -1 ? 99 : i; };
  const rest = orderedCategories().slice().sort((a, b) => rank(a) - rank(b));
  ['Tous', ...rest].forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.className = 'cat-btn' + (cat === activeCategory ? ' active' : '');
    btn.textContent = catLabel(cat);
    btn.style.setProperty('--c', catColor(cat, i));
    btn.addEventListener('click', () => { activeCategory = cat; renderCategories(); renderArticles(); });
    el.appendChild(btn);
  });
}

// ── Gestion des catégories (réorganiser + renommer) ──
let catRows = [];

function openCategoryModal() {
  catRows = orderedCategories().map(name => ({ name, orig: name }));
  renderCatRows();
  document.getElementById('modal-category').classList.add('open');
}

function renderCatRows() {
  const box = document.getElementById('category-list');
  box.innerHTML = '';
  if (!catRows.length) { box.innerHTML = '<p class="empty-msg">Aucune catégorie</p>'; return; }
  catRows.forEach((row, i) => {
    const count = articles.filter(a => a.category === row.orig).length;
    const div = document.createElement('div');
    div.className = 'cat-row';
    div.innerHTML = `
      <div class="cat-move">
        <button class="cat-up" ${i === 0 ? 'disabled' : ''} title="Monter">▲</button>
        <button class="cat-down" ${i === catRows.length - 1 ? 'disabled' : ''} title="Descendre">▼</button>
      </div>
      <input class="cat-name" type="text" value="${row.name.replace(/"/g, '&quot;')}">
      <span class="cat-count">${count} art.</span>
    `;
    div.querySelector('.cat-name').addEventListener('input', e => { catRows[i].name = e.target.value; });
    div.querySelector('.cat-up').addEventListener('click', () => {
      if (i > 0) { [catRows[i - 1], catRows[i]] = [catRows[i], catRows[i - 1]]; renderCatRows(); }
    });
    div.querySelector('.cat-down').addEventListener('click', () => {
      if (i < catRows.length - 1) { [catRows[i + 1], catRows[i]] = [catRows[i], catRows[i + 1]]; renderCatRows(); }
    });
    box.appendChild(div);
  });
}

function saveCategoryModal() {
  for (const r of catRows) {
    r.name = r.name.trim();
    if (!r.name) { showToast('Un nom de catégorie est vide.'); return; }
  }
  // Applique les renommages sur les articles concernés
  catRows.forEach(r => {
    if (r.name !== r.orig) articles.forEach(a => { if (a.category === r.orig) a.category = r.name; });
  });
  categoryOrder = catRows.map(r => r.name);
  saveArticles();
  LS.set('pos_category_order', categoryOrder);
  // Si la catégorie active a été renommée, on suit
  const renamed = {}; catRows.forEach(r => { renamed[r.orig] = r.name; });
  if (activeCategory !== 'Tous' && renamed[activeCategory]) activeCategory = renamed[activeCategory];
  document.getElementById('modal-category').classList.remove('open');
  renderCategories(); renderArticles();
  showToast('Catégories mises à jour.');
}

// (l'ouverture de la gestion des catégories se fait via le menu ☰)
document.getElementById('btn-category-save').addEventListener('click', saveCategoryModal);
document.getElementById('btn-category-cancel').addEventListener('click', () => {
  document.getElementById('modal-category').classList.remove('open');
});
document.getElementById('modal-category').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-category')) document.getElementById('modal-category').classList.remove('open');
});

function renderArticles() {
  const grid = document.getElementById('articles-grid');
  grid.innerHTML = '';
  const editing = editMode || pickEditMode; // en édition, on montre AUSSI les inactifs
  let list = activeCategory === 'Tous' ? articles : articles.filter(a => a.category === activeCategory);
  if (!editing) list = list.filter(a => a.active !== false); // à la vente : masque les inactifs
  if (!list.length) {
    grid.innerHTML = '<p class="empty-msg">Aucun article</p>';
    return;
  }
  list.forEach(art => {
    const inactive = art.active === false;
    const card = document.createElement('div');
    card.className = 'article-card' + (inactive ? ' inactive' : '');
    card.dataset.artId = art.id;
    card.innerHTML = `
      <span class="drag-handle">⠿</span>
      ${inactive ? '<span class="article-inactive-badge">Inactif</span>' : ''}
      <span class="article-emoji">${art.emoji}</span>
      <div class="article-name">${art.name}</div>
      <div class="article-price">${fmtEur(art.price)}</div>
    `;
    card.addEventListener('click', () => {
      if (editMode) return; // en mode déplacement, le clic n'ajoute pas au ticket
      if (pickEditMode) { exitPickEditMode(); openArticleModal(art); return; } // mode « modifier un article »
      addToTicket(art);
    });
    grid.appendChild(card);
  });

}

// ══════════════════ MODE ÉDITION / DRAG & DROP ════════════════════════════════

let editMode = false;

// État partagé du drag — une seule instance, persistante
const drag = {
  el: null, ghost: null, placeholder: null,
  offX: 0,  offY: 0,
};

// Mode « modifier un article » : le prochain article touché ouvre sa fiche.
let pickEditMode = false;

function showBanner(text) {
  document.getElementById('edit-banner-text').textContent = text;
  document.getElementById('edit-banner').classList.add('visible');
}
function hideBanner() {
  document.getElementById('edit-banner').classList.remove('visible');
}

function toggleEditMode() {
  editMode = !editMode;
  document.getElementById('articles-grid').classList.toggle('edit-mode', editMode);
  if (editMode) showBanner('🔀 Faites glisser les articles pour les déplacer, puis touchez « Terminer ».');
  else hideBanner();
  renderArticles();
}

function startPickEditMode() {
  pickEditMode = true;
  showBanner('✏️ Touchez l\'article à modifier.');
}
function exitPickEditMode() {
  pickEditMode = false;
  hideBanner();
}

// « Terminer » de la bannière : sort du mode en cours
document.getElementById('btn-banner-done').addEventListener('click', () => {
  if (editMode) toggleEditMode();
  if (pickEditMode) exitPickEditMode();
});

// ── Menu des fonctions ────────────────────────────────────────────────────────
const menuModal = document.getElementById('modal-menu');
function closeMenu() { menuModal.classList.remove('open'); }

document.getElementById('btn-menu').addEventListener('click', () => { updateTestMenuLabel(); pullCatalogue(); menuModal.classList.add('open'); });
document.getElementById('btn-menu-close').addEventListener('click', closeMenu);
menuModal.addEventListener('click', e => { if (e.target === menuModal) closeMenu(); });

function goToCaisse() {
  const btn = document.querySelector('.tab-btn[data-tab="caisse"]');
  if (!document.getElementById('tab-caisse').classList.contains('active')) btn.click();
}

document.getElementById('menu-add-article').addEventListener('click', () => {
  closeMenu(); goToCaisse(); openArticleModal();
});
document.getElementById('menu-inactive').addEventListener('click', () => {
  closeMenu(); openInactiveModal();
});

// ── Articles inactifs : lister et réactiver ───────────────────────────────────
function openInactiveModal() {
  renderInactiveList();
  document.getElementById('modal-inactive').classList.add('open');
}
function renderInactiveList() {
  const el = document.getElementById('inactive-list');
  const inactifs = articles.filter(a => a.active === false);
  if (!inactifs.length) {
    el.innerHTML = '<p class="empty-msg" style="padding:1rem 0">Aucun article inactif 🎉</p>';
    return;
  }
  el.innerHTML = '';
  inactifs.forEach(art => {
    const row = document.createElement('div');
    row.className = 'inactive-row';
    row.innerHTML = `
      <span class="inactive-emoji">${art.emoji || ''}</span>
      <span class="inactive-info"><strong>${art.name}</strong><small>${art.category} · ${fmtEur(art.price)}</small></span>
      <button class="btn-primary btn-reactivate" data-id="${art.id}">Réactiver</button>
    `;
    el.appendChild(row);
  });
  el.querySelectorAll('.btn-reactivate').forEach(btn => {
    btn.addEventListener('click', () => {
      const art = articles.find(a => a.id === btn.dataset.id);
      if (art) { art.active = true; saveArticles(); }
      renderInactiveList();
      renderCategories();
      renderArticles();
      showToast('Article réactivé.');
    });
  });
}
document.getElementById('btn-inactive-close').addEventListener('click', () => {
  document.getElementById('modal-inactive').classList.remove('open');
});
document.getElementById('modal-inactive').addEventListener('click', e => {
  if (e.target.id === 'modal-inactive') document.getElementById('modal-inactive').classList.remove('open');
});

// ── Relevés de température (HACCP) : frigo & congélateur ───────────────────────
// Plages de température par type d'enceinte.
const TEMP_RANGES = {
  frigo:       [8, 7, 6, 5, 4, 3, 2, 1, 0],
  congelateur: [-14, -15, -16, -17, -18, -19, -20, -21, -22]
};
// Enceintes par défaut (l'utilisateur peut en ajouter/supprimer via le bouton +).
const TEMP_DEFAULT_ENCLOSURES = [
  { id: 'frigo_cuisine', name: 'Frigo cuisine', type: 'frigo' },
  { id: 'frigo_timbre',  name: 'Frigo timbre',  type: 'frigo' },
  { id: 'frigo_camion',  name: 'Frigo camion',  type: 'frigo' },
  { id: 'congelateur',   name: 'Congélateur',   type: 'congelateur' }
];
function getEnclosures() { return LS.get('pos_temp_enclosures', null) || TEMP_DEFAULT_ENCLOSURES; }
function saveEnclosures(list) { LS.set('pos_temp_enclosures', list); }
function encById(id)  { return getEnclosures().find(e => e.id === id); }
function encTemps(id) { const e = encById(id); return TEMP_RANGES[(e && e.type) || 'frigo']; }
function encIcon(type){ return type === 'congelateur' ? '❄️' : '🧊'; }

let tempEnc      = (getEnclosures()[0] || {}).id || 'frigo_cuisine';
let tempMonth    = todayISO().slice(0, 7); // AAAA-MM
let tempEditMode = false;                  // mode « modifier les enceintes » (affiche les ×)

// Migration : les anciens relevés « frigo|… » deviennent « frigo_cuisine|… ».
(function migrateTempKeys() {
  const all = LS.get('pos_temp_records', null);
  if (!all) return;
  let changed = false;
  Object.keys(all).forEach(k => {
    if (k.indexOf('frigo|') === 0) { all['frigo_cuisine|' + k.slice(6)] = all[k]; delete all[k]; changed = true; }
  });
  if (changed) LS.set('pos_temp_records', all);
})();

function tempKey(enc, month) { return enc + '|' + month; }
function getTempRecord(enc, month) {
  const all = LS.get('pos_temp_records', {});
  const rec = all[tempKey(enc, month)] || { temps: {}, initials: '', corrective: '' };
  if (!rec.initialsByDay) rec.initialsByDay = {}; // initiales par jour (une case par jour)
  return rec;
}
function saveTempRecord(enc, month, rec) {
  const all = LS.get('pos_temp_records', {});
  all[tempKey(enc, month)] = rec;
  LS.set('pos_temp_records', all);
}
let tempRec = null; // enregistrement en cours d'édition

function openTempModal(enc) {
  tempEnc = (enc && encById(enc)) ? enc : (getEnclosures()[0] || {}).id;
  tempMonth = todayISO().slice(0, 7);
  loadTempInto();
  document.getElementById('temp-month').value = tempMonth;
  document.getElementById('modal-temp').classList.add('open');
}
function renderTempTabs() {
  const wrap = document.getElementById('temp-enc-tabs');
  wrap.innerHTML = getEnclosures().map(e =>
    `<span class="temp-enc-item${tempEditMode ? ' editing' : ''}">` +
      `<button class="temp-enc-tab${e.id === tempEnc ? ' active' : ''}" data-enc="${e.id}">${encIcon(e.type)} ${escapeHtml(e.name)}</button>` +
      (tempEditMode ? `<button class="temp-enc-del" data-enc="${e.id}" title="Supprimer cette enceinte">×</button>` : '') +
    '</span>'
  ).join('') + '<button class="temp-enc-add" id="temp-enc-add" title="Ajouter une enceinte">＋</button>';
  wrap.querySelectorAll('.temp-enc-tab').forEach(b => b.addEventListener('click', () => { tempEnc = b.dataset.enc; loadTempInto(); }));
  wrap.querySelectorAll('.temp-enc-del').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); deleteEnclosure(b.dataset.enc); }));
  document.getElementById('temp-enc-add').addEventListener('click', openAddEnclosure);
  const editBtn = document.getElementById('btn-temp-edit');
  if (editBtn) editBtn.textContent = tempEditMode ? '✓ Terminer' : '✏️ Modifier';
}
function loadTempInto() {
  tempRec = getTempRecord(tempEnc, tempMonth);
  renderTempTabs();
  const e = encById(tempEnc);
  document.getElementById('temp-title').textContent = '🌡️ ' + (e ? e.name : 'Relevés de température');
  document.getElementById('temp-initials').value   = tempRec.initials || 'CB'; // CB par défaut
  document.getElementById('temp-corrective').value = tempRec.corrective || '';
  renderTempGrid();
}
function persistTemp() { saveTempRecord(tempEnc, tempMonth, tempRec); } // envoi cloud seulement au clic « Enregistrer »

// Envoi des relevés vers Google Sheets : un onglet par enceinte (via la prod).
function tempPayload() {
  const e = encById(tempEnc);
  const dayset = new Set([...Object.keys(tempRec.temps), ...Object.keys(tempRec.initialsByDay)]);
  const days = [...dayset].sort((a, b) => a - b).map(d => ({
    date: tempMonth + '-' + String(d).padStart(2, '0'),
    temp: (d in tempRec.temps) ? tempRec.temps[d] : '',
    initials: tempRec.initialsByDay[d] || ''
  }));
  return { tempSync: { enclosure: e ? e.name : tempEnc, type: e ? e.type : 'frigo', month: tempMonth, days } };
}
function pushTemperatures() {
  const p = tempPayload();
  if (!p.tempSync.days.length) return;
  fetch(PROD_SHEETS_URL, { method: 'POST', body: JSON.stringify(p) }).catch(() => {});
}

// Récupère les relevés depuis Google Sheets au démarrage (comme les ventes) : les
// jours présents dans le cloud écrasent le local ; les jours locaux non encore
// synchronisés sont conservés (le cloud ne les référence pas encore).
let tempPulling = false;
function pullTemperatures() {
  if (tempPulling) return;
  tempPulling = true;
  const cbName = '__tempCb' + Date.now();
  let script;
  const cleanup = () => { try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
    if (script) script.remove(); tempPulling = false; clearTimeout(timer); };
  const timer = setTimeout(cleanup, 20000);
  window[cbName] = data => {
    cleanup();
    if (!data || !data.ok || !Array.isArray(data.enclosures)) return;
    let list = getEnclosures().slice();
    const all = LS.get('pos_temp_records', {});
    data.enclosures.forEach(cloud => {
      // Trouve (ou crée) l'enceinte locale correspondant au nom.
      let enc = list.find(e => (e.name || '').toLowerCase() === (cloud.name || '').toLowerCase());
      if (!enc) { enc = { id: 'enc_' + uid(), name: cloud.name, type: cloud.type || 'frigo' }; list.push(enc); }
      (cloud.entries || []).forEach(en => {
        if (!en.date) return;
        const month = en.date.slice(0, 7), day = +en.date.slice(8, 10);
        const key = enc.id + '|' + month;
        const rec = all[key] || { temps: {}, initials: '', corrective: '', initialsByDay: {} };
        if (!rec.initialsByDay) rec.initialsByDay = {};
        if (en.temp !== '' && en.temp != null) rec.temps[day] = Number(en.temp);
        if (en.initials) rec.initialsByDay[day] = en.initials;
        all[key] = rec;
      });
    });
    saveEnclosures(list);
    LS.set('pos_temp_records', all);
    // rafraîchit la vue si le modal est ouvert
    if (document.getElementById('modal-temp').classList.contains('open')) loadTempInto();
  };
  script = document.createElement('script');
  script.src = PROD_SHEETS_URL + '?action=temperatures&callback=' + cbName + '&t=' + Date.now();
  script.onerror = cleanup;
  document.body.appendChild(script);
}

function renderTempGrid() {
  const table = document.getElementById('temp-grid');
  const temps = encTemps(tempEnc);
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  let html = '<thead><tr><th class="temp-corner">T°C \\ Jour</th>' +
    days.map(d => `<th>${d}</th>`).join('') + '</tr></thead><tbody>';
  temps.forEach(t => {
    html += `<tr><th class="temp-rowlabel">${t}°C</th>` +
      days.map(d => {
        const on = tempRec.temps[d] === t;
        return `<td class="temp-cell${on ? ' on' : ''}" data-day="${d}" data-temp="${t}">${on ? '●' : ''}</td>`;
      }).join('') + '</tr>';
  });
  // Ligne des initiales : une case par jour (renseignée au clic ou via Enregistrer).
  html += `<tr class="temp-init-row"><th class="temp-rowlabel">Initiales</th>` +
    days.map(d => `<td class="temp-init-cell${tempRec.initialsByDay[d] ? ' on' : ''}" data-day="${d}">${tempRec.initialsByDay[d] || ''}</td>`).join('') + '</tr>';
  html += '</tbody>';
  table.innerHTML = html;
  table.querySelectorAll('.temp-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const d = +cell.dataset.day, t = +cell.dataset.temp;
      if (tempRec.temps[d] === t) delete tempRec.temps[d]; // re-toucher = effacer
      else tempRec.temps[d] = t;                            // sinon = déplacer la pastille du jour
      persistTemp();
      renderTempGrid();
    });
  });
  // Clic sur une case d'initiales : y met les initiales du champ, re-clic = efface.
  table.querySelectorAll('.temp-init-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const d = +cell.dataset.day;
      const ini = (document.getElementById('temp-initials').value || 'CB').trim();
      if (tempRec.initialsByDay[d]) delete tempRec.initialsByDay[d];
      else tempRec.initialsByDay[d] = ini;
      persistTemp();
      renderTempGrid();
    });
  });
}

document.getElementById('menu-temp').addEventListener('click', () => { closeMenu(); openTempModal(); });

// ── Synchronisation manuelle (bouton du menu) ─────────────────────────────────
// Pousse tous les relevés de température locaux vers Google Sheets.
function pushAllTemperatures() {
  const all = LS.get('pos_temp_records', {});
  Object.keys(all).forEach(key => {
    const sep = key.lastIndexOf('|');
    if (sep < 0) return;
    const encId = key.slice(0, sep), month = key.slice(sep + 1);
    const enc = encById(encId);
    if (!enc) return;
    const rec = all[key] || {};
    const temps = rec.temps || {}, iniByDay = rec.initialsByDay || {};
    const dayset = new Set([...Object.keys(temps), ...Object.keys(iniByDay)]);
    const days = [...dayset].sort((a, b) => a - b).map(d => ({
      date: month + '-' + String(d).padStart(2, '0'),
      temp: (d in temps) ? temps[d] : '',
      initials: iniByDay[d] || ''
    }));
    if (!days.length) return;
    fetch(PROD_SHEETS_URL, { method: 'POST', body: JSON.stringify({ tempSync: { enclosure: enc.name, type: enc.type, month, days } }) }).catch(() => {});
  });
}

// Échange complet à la demande : envoie ET récupère ventes, catalogue, relevés.
function syncAll() {
  showToast('🔄 Synchronisation en cours…');
  syncToSheets();                         // envoie les ventes en attente
  if (cataloguePushPending) pushCatalogue();
  pullCatalogue();                        // récupère le catalogue partagé
  pushAllTemperatures();                  // envoie tous les relevés locaux
  pullTemperatures();                     // récupère les relevés
  loadFromSheets();                       // rafraîchit l'historique des ventes (reporting)
  setTimeout(() => showToast('✅ Données synchronisées.'), 3000);
}
document.getElementById('menu-sync').addEventListener('click', () => { closeMenu(); goToCaisse(); syncAll(); });
document.getElementById('temp-month').addEventListener('change', e => { tempMonth = e.target.value || tempMonth; loadTempInto(); });
document.getElementById('temp-month-prev').addEventListener('click', () => shiftTempMonth(-1));
document.getElementById('temp-month-next').addEventListener('click', () => shiftTempMonth(1));
function shiftTempMonth(n) {
  const [y, m] = tempMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  tempMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  document.getElementById('temp-month').value = tempMonth;
  loadTempInto();
}
['temp-initials', 'temp-corrective'].forEach(id => {
  document.getElementById(id).addEventListener('input', e => {
    tempRec[id === 'temp-initials' ? 'initials' : 'corrective'] = e.target.value;
    persistTemp();
  });
});

// ── Ajout / suppression d'une enceinte ────────────────────────────────────────
let addEncType = 'frigo';
function openAddEnclosure() {
  addEncType = 'frigo';
  document.getElementById('temp-add-name').value = '';
  document.querySelectorAll('.temp-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === addEncType));
  document.getElementById('modal-temp-add').classList.add('open');
  setTimeout(() => document.getElementById('temp-add-name').focus(), 60);
}
document.querySelectorAll('.temp-type-btn').forEach(b => b.addEventListener('click', () => {
  addEncType = b.dataset.type;
  document.querySelectorAll('.temp-type-btn').forEach(x => x.classList.toggle('active', x === b));
}));
document.getElementById('temp-add-cancel').addEventListener('click', () => document.getElementById('modal-temp-add').classList.remove('open'));
document.getElementById('temp-add-ok').addEventListener('click', () => {
  const name = document.getElementById('temp-add-name').value.trim();
  if (!name) { showToast('Donnez un nom à l\'enceinte.'); return; }
  const list = getEnclosures().slice();
  const id = 'enc_' + uid();
  list.push({ id, name, type: addEncType });
  saveEnclosures(list);
  tempEnc = id;
  document.getElementById('modal-temp-add').classList.remove('open');
  loadTempInto();
  showToast(`Enceinte « ${name} » ajoutée.`);
});
document.getElementById('btn-temp-edit').addEventListener('click', () => {
  tempEditMode = !tempEditMode;
  renderTempTabs();
});
function deleteEnclosure(id) {
  const e = encById(id);
  if (!e) return;
  if (getEnclosures().length <= 1) { showToast('Gardez au moins une enceinte.'); return; }
  if (!confirm(`Supprimer l'enceinte « ${e.name} » et tous ses relevés ?`)) return;
  saveEnclosures(getEnclosures().filter(x => x.id !== id));
  const all = LS.get('pos_temp_records', {});
  Object.keys(all).forEach(k => { if (k.indexOf(id + '|') === 0) delete all[k]; });
  LS.set('pos_temp_records', all);
  if (tempEnc === id) tempEnc = (getEnclosures()[0] || {}).id;
  loadTempInto();
  showToast('Enceinte supprimée.');
}
document.getElementById('btn-temp-save').addEventListener('click', () => {
  // Tamponne les initiales du champ dans la colonne du jour courant.
  const ini = (document.getElementById('temp-initials').value || 'CB').trim();
  tempRec.initials = ini;
  const day = new Date().getDate();  // jour du mois (aujourd'hui)
  tempRec.initialsByDay[day] = ini;
  // Complète « CB » sur chaque jour relevé (température saisie) sans initiales.
  Object.keys(tempRec.temps).forEach(d => { if (!tempRec.initialsByDay[d]) tempRec.initialsByDay[d] = 'CB'; });
  persistTemp();
  pushTemperatures();   // envoi immédiat vers Google Sheets
  renderTempGrid();
  document.getElementById('modal-temp').classList.remove('open'); // ferme le modal
  showToast(`Relevé enregistré — initiales « ${ini} » ajoutées au jour ${day}.`);
});
document.getElementById('btn-temp-close').addEventListener('click', () => document.getElementById('modal-temp').classList.remove('open'));
document.getElementById('btn-temp-print').addEventListener('click', () => {
  const monthLabel = new Date(tempMonth + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const e = encById(tempEnc);
  document.getElementById('modal-temp').dataset.printtitle =
    (e ? e.name : '') + ' — ' + monthLabel;
  document.body.classList.add('printing-temp');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-temp'), 500);
});
document.getElementById('menu-edit-article').addEventListener('click', () => {
  closeMenu(); goToCaisse();
  if (editMode) toggleEditMode();
  startPickEditMode();
});
document.getElementById('menu-reorder').addEventListener('click', () => {
  closeMenu(); goToCaisse();
  exitPickEditMode();
  if (!editMode) toggleEditMode();
});
document.getElementById('menu-categories').addEventListener('click', () => {
  closeMenu(); openCategoryModal();
});
document.getElementById('menu-pin').addEventListener('click', () => {
  closeMenu(); openPinModal();
});
document.getElementById('menu-clients').addEventListener('click', () => {
  closeMenu();
  document.querySelector('.tab-btn[data-tab="clients"]').click();
});
document.getElementById('menu-testmode').addEventListener('click', () => {
  closeMenu();
  setTestMode(!isTestMode());
});

// ── Mode formation : bannière, libellé du menu, bascule ───────────────────────
function renderTestBanner() {
  const b = document.getElementById('test-banner');
  if (b) b.classList.toggle('show', isTestMode());
  document.body.classList.toggle('testmode', isTestMode());
}
function updateTestMenuLabel() {
  const el = document.getElementById('menu-testmode');
  if (!el) return;
  const on = isTestMode();
  el.innerHTML = (on ? '🧪 Quitter le mode formation' : '🧪 Mode formation')
    + '<small>' + (on ? 'Actif — les ventes ne sont pas comptabilisées' : 'Ventes de test isolées, non comptées') + '</small>';
  el.classList.toggle('active', on);
}
function setTestMode(on) {
  LS.set('pos_testmode', !!on);
  ticket = []; renderTicket();              // ne pas transférer un ticket d'un mode à l'autre
  reportTransactions = null; reportLoadedAt = 0;  // forcer le rechargement depuis le bon backend
  renderTestBanner();
  updateTestMenuLabel();
  renderMemo();
  renderReporting();
  renderDashboard();
  setSyncStatus('idle');
  autoLoadSheets();
  syncToSheets();
  showToast(on
    ? '🧪 Mode formation activé — les ventes de test ne comptent pas.'
    : '↩️ Mode formation désactivé — retour à la caisse réelle.');
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function dragGetCardAt(grid, x, y) {
  for (const el of grid.querySelectorAll('.article-card:not(.drag-placeholder)')) {
    if (el === drag.el) continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
  }
  return null;
}

function dragStart(card, clientX, clientY) {
  const r = card.getBoundingClientRect();
  drag.el  = card;
  drag.offX = clientX - r.left;
  drag.offY = clientY - r.top;
  card.style.opacity = '0.25';

  // Fantôme
  drag.ghost = document.createElement('div');
  drag.ghost.className = 'drag-ghost';
  drag.ghost.innerHTML = card.innerHTML;
  drag.ghost.style.cssText =
    `width:${r.width}px;height:${r.height}px;` +
    `left:${clientX - drag.offX}px;top:${clientY - drag.offY}px;`;
  document.body.appendChild(drag.ghost);

  // Placeholder (trou)
  drag.placeholder = document.createElement('div');
  drag.placeholder.className = 'article-card drag-placeholder';
  drag.placeholder.style.cssText = `width:${r.width}px;height:${r.height}px;`;
  card.after(drag.placeholder);
}

function dragMove(grid, clientX, clientY) {
  if (!drag.el) return;
  drag.ghost.style.left = (clientX - drag.offX) + 'px';
  drag.ghost.style.top  = (clientY - drag.offY) + 'px';

  const target = dragGetCardAt(grid, clientX, clientY);
  if (!target) return;
  const r   = target.getBoundingClientRect();
  const mid = r.left + r.width / 2;
  target.parentNode.insertBefore(drag.placeholder, clientX < mid ? target : target.nextSibling);
}

function dragEnd(grid) {
  if (!drag.el) return;
  if (drag.placeholder) drag.placeholder.before(drag.el);
  drag.el.style.opacity = '';
  drag.ghost?.remove();
  drag.placeholder?.remove();
  drag.el = drag.ghost = drag.placeholder = null;
  dragSaveOrder(grid);
}

function dragSaveOrder(grid) {
  const ids    = [...grid.querySelectorAll('.article-card[data-art-id]')].map(c => c.dataset.artId);
  const sorted = ids.map(id => articles.find(a => a.id === id)).filter(Boolean);
  const hidden = articles.filter(a => !ids.includes(a.id));
  articles = [...sorted, ...hidden];
  saveArticles();
}

// ── Initialisation unique des listeners (sur le document) ────────────────────
(function initDrag() {
  const getGrid = () => document.getElementById('articles-grid');

  // TOUCH — les listeners move/end sont attachés directement à la carte au moment
  // du touchstart : seul moyen fiable de court-circuiter le scroll iOS Safari.
  document.addEventListener('touchstart', e => {
    if (!editMode) return;
    const card = e.target.closest('#articles-grid .article-card');
    if (!card || card.classList.contains('drag-placeholder')) return;
    e.preventDefault();
    e.stopPropagation();
    const t = e.touches[0];
    dragStart(card, t.clientX, t.clientY);

    function onMove(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      const touch = ev.touches[0];
      dragMove(getGrid(), touch.clientX, touch.clientY);
    }
    function onEnd() {
      dragEnd(getGrid());
      card.removeEventListener('touchmove',   onMove);
      card.removeEventListener('touchend',    onEnd);
      card.removeEventListener('touchcancel', onEnd);
    }
    card.addEventListener('touchmove',   onMove,  { passive: false });
    card.addEventListener('touchend',    onEnd);
    card.addEventListener('touchcancel', onEnd);
  }, { passive: false });

  // MOUSE
  document.addEventListener('mousedown', e => {
    if (!editMode) return;
    const card = e.target.closest('#articles-grid .article-card');
    if (!card || card.classList.contains('drag-placeholder')) return;
    e.preventDefault();
    dragStart(card, e.clientX, e.clientY);
  });

  document.addEventListener('mousemove', e => {
    if (!drag.el) return;
    dragMove(getGrid(), e.clientX, e.clientY);
  });

  document.addEventListener('mouseup', () => {
    if (!drag.el) return;
    dragEnd(getGrid());
  });
})();

// ══════════════════ TICKET ═════════════════════════════════════════════════════

function addToTicket(art) {
  const line = ticket.find(l => l.article.id === art.id);
  if (line) { line.qty++; }
  else { ticket.push({ article: art, qty: 1 }); }
  renderTicket();
}

function removeFromTicket(artId) {
  ticket = ticket.filter(l => l.article.id !== artId);
  renderTicket();
}

function changeQty(artId, delta) {
  const line = ticket.find(l => l.article.id === artId);
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) return removeFromTicket(artId);
  if (line.freeUnits) line.freeUnits = Math.min(line.freeUnits, line.qty); // clamp
  renderTicket();
}

function ticketTotal() {
  return ticket.reduce((s, l) => s + l.article.price * (l.qty - (l.freeUnits || 0)), 0);
}

// Mode « offert » : quand actif, toucher un article du panier passe TOUTE la ligne à 0 € (et inversement).
let offerMode = false;

function toggleOfferMode() {
  offerMode = !offerMode;
  document.getElementById('btn-free-pizza').classList.toggle('active', offerMode);
  renderTicket();
  if (offerMode) showToast('🎁 Touchez les articles à offrir (0 €).');
}

function toggleLineFree(artId) {
  const line = ticket.find(l => l.article.id === artId);
  if (!line) return;
  line.freeUnits = (line.freeUnits >= line.qty) ? 0 : line.qty; // bascule ligne entière
  renderTicket();
}

// Offre une unité de la pizza la moins chère du panier (prix → 0 €).
function offerCheapestPizza() {
  const eligible = ticket.filter(l =>
    /pizza/i.test(l.article.category || '') && (l.qty - (l.freeUnits || 0)) > 0);
  if (!eligible.length) { showToast('Aucune pizza à offrir dans le panier.'); return; }
  const cheapest = eligible.reduce((a, b) => (b.article.price < a.article.price ? b : a));
  cheapest.freeUnits = (cheapest.freeUnits || 0) + 1;
  renderTicket();
  showToast(`🎁 ${cheapest.article.name} offerte (−${fmtEur(cheapest.article.price)}).`);
}

document.getElementById('btn-free-pizza').addEventListener('click', toggleOfferMode);
document.getElementById('btn-cheapest-pizza').addEventListener('click', offerCheapestPizza);

function renderTicket() {
  const el = document.getElementById('ticket-lines');
  el.className = 'ticket-lines' + (offerMode ? ' offer-mode' : '');
  el.innerHTML = '';
  if (!ticket.length) {
    el.innerHTML = '<p class="empty-msg">Aucun article</p>';
  } else {
    if (offerMode) {
      const hint = document.createElement('p');
      hint.className = 'offer-hint';
      hint.textContent = '🎁 Touchez un article pour l\'offrir (0 €)';
      el.appendChild(hint);
    }
    ticket.forEach(line => {
      const free = line.freeUnits || 0;
      const lineTotal = line.article.price * (line.qty - free);
      const label = free >= line.qty ? 'offert' : `${free} offerte${free > 1 ? 's' : ''}`;
      const freeNote = free ? `<span class="tl-free">🎁 ${label} (−${fmtEur(line.article.price * free)})</span>` : '';
      const div = document.createElement('div');
      div.className = 'ticket-line' + (free ? ' tl-free-line' : '');
      div.dataset.id = line.article.id;
      div.innerHTML = `
        <span class="tl-name">${line.article.emoji} ${line.article.name}${freeNote}</span>
        <div class="tl-qty-controls">
          <button class="tl-qty-btn" data-id="${line.article.id}" data-delta="-1">−</button>
          <span class="tl-qty">${line.qty}</span>
          <button class="tl-qty-btn" data-id="${line.article.id}" data-delta="1">+</button>
        </div>
        <span class="tl-price">${fmtEur(lineTotal)}</span>
        <button class="tl-remove" data-id="${line.article.id}">✕</button>
      `;
      el.appendChild(div);
    });
    // En mode offert : toucher la ligne bascule offert (sauf sur les boutons +/−/✕)
    el.querySelectorAll('.ticket-line').forEach(div => {
      div.addEventListener('click', e => {
        if (!offerMode) return;
        if (e.target.closest('.tl-qty-btn') || e.target.closest('.tl-remove')) return;
        toggleLineFree(div.dataset.id);
      });
    });
    el.querySelectorAll('.tl-qty-btn').forEach(btn => {
      btn.addEventListener('click', () => changeQty(btn.dataset.id, parseInt(btn.dataset.delta)));
    });
    el.querySelectorAll('.tl-remove').forEach(btn => {
      btn.addEventListener('click', () => removeFromTicket(btn.dataset.id));
    });
  }
  document.getElementById('ticket-total').textContent = fmtEur(ticketTotal());
  const vbtn = document.getElementById('btn-validate');
  vbtn.textContent = editingTxId
    ? `✔ Encaisser le complément (${fmtEur(ticketTotal())})`
    : '✔ Valider le paiement';
  updateCashChange();
}

function exitOfferMode() {
  offerMode = false;
  document.getElementById('btn-free-pizza').classList.remove('active');
}

document.getElementById('btn-clear-ticket').addEventListener('click', () => {
  ticket = [];
  exitOfferMode();
  setTicketClient(null);
  renderTicket();
});

// ── Payment method ────────────────────────────────────────────────────────────
document.querySelectorAll('.pay-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pay-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    payMethod = btn.dataset.method;
    document.getElementById('cash-change-row').style.display =
      payMethod === 'especes' ? 'flex' : 'none';
    updateCashChange();
  });
});

document.getElementById('cash-given').addEventListener('input', updateCashChange);

function updateCashChange() {
  const given = parseFloat(document.getElementById('cash-given').value) || 0;
  const total = ticketTotal();
  const changeEl = document.getElementById('cash-change');
  if (payMethod !== 'especes' || !given) { changeEl.textContent = '—'; return; }
  const change = given - total;
  changeEl.textContent = change >= 0 ? fmtEur(change) : '⚠ insuffisant';
  changeEl.style.color = change >= 0 ? 'var(--olive)' : 'var(--danger)';
}

// ── Validate ──────────────────────────────────────────────────────────────────
document.getElementById('btn-validate').addEventListener('click', () => {
  if (!ticket.length) { showToast('Aucun article dans le ticket.'); return; }
  const total = ticketTotal();
  if (payMethod === 'especes') {
    const given = parseFloat(document.getElementById('cash-given').value) || 0;
    if (given > 0 && given < total) { showToast('Montant insuffisant.'); return; }
  }
  // Sépare unités payées / offertes → l'unité offerte est enregistrée à 0 €
  const lines = [];
  ticket.forEach(l => {
    const free = l.freeUnits || 0;
    const paid = l.qty - free;
    if (paid > 0) lines.push({ ...l.article, qty: paid, subtotal: l.article.price * paid });
    if (free > 0) lines.push({ ...l.article, name: l.article.name + ' (offert)', price: 0, qty: free, subtotal: 0 });
  });

  // Cas « complément » : on encaisse seulement les nouveaux articles, liés à la vente d'origine.
  if (editingTxId) {
    const tx = {
      id:          uid(),
      date:        new Date().toISOString(),
      location:    (editingOriginal && editingOriginal.location) || currentLocation || '',
      lines,
      total,
      method:      payMethod,
      cancelled:   false,
      complementOf: editingTxId,
      clientId:    ticketClient ? ticketClient.id : undefined,
      clientName:  ticketClient ? ticketClient.name : undefined,
      employeeId:  currentEmployeeId || undefined,
      employee:    currentEmployeeName() || undefined,
    };
    addTransaction(tx);
    applyLoyaltyAfterSale(lines);
    editingTxId = null;
    editingOriginal = null;
    ticket = [];
    exitOfferMode();
    setTicketClient(null);
    document.getElementById('cash-given').value = '';
    renderEditBanner();
    renderTicket();
    showToast(`✔ Complément de ${fmtEur(total)} encaissé (${payMethod}).`);
    return;
  }

  const tx = {
    id:        uid(),
    date:      new Date().toISOString(),
    location:  currentLocation || '',
    lines,
    total,
    method:    payMethod,
    cancelled: false,
    clientId:   ticketClient ? ticketClient.id : undefined,
    clientName: ticketClient ? ticketClient.name : undefined,
    employeeId: currentEmployeeId || undefined,
    employee:   currentEmployeeName() || undefined,
  };
  addTransaction(tx);
  applyLoyaltyAfterSale(lines);
  ticket = [];
  exitOfferMode();
  setTicketClient(null);
  document.getElementById('cash-given').value = '';
  renderTicket();
  showToast(`✔ Paiement de ${fmtEur(total)} enregistré (${payMethod}).`);
});

// ══════════════════ CLIENTS (CRM) ═════════════════════════════════════════════
// Fiches clients stockées en local (localStorage), comme les ventes.
// Fidélité : toutes les LOYALTY_THRESHOLD pizzas achetées → 1 pizza offerte,
// à appliquer avec le bouton « 🍕 Fidélité » du ticket.

const LOYALTY_THRESHOLD = 10;
let clients = LS.get('pos_clients', []);
function saveClients() { LS.set('pos_clients', clients); }
function clientById(id) { return clients.find(c => c.id === id); }

function pizzasOf(c)         { return c.pizzaCount || 0; }
function rewardsAvailable(c) { return Math.max(Math.floor(pizzasOf(c) / LOYALTY_THRESHOLD) - (c.rewardsUsed || 0), 0); }
function loyaltyProgress(c)  { return pizzasOf(c) % LOYALTY_THRESHOLD; }

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Ventes associées à un client (locales + Sheets fusionnées, les plus récentes d'abord)
function clientTxs(id) {
  return reportSource()
    .filter(t => !t.cancelled && t.clientId === id)
    .sort((a, b) => b.date.localeCompare(a.date));
}

// Stats { visites, total, dernière visite } par client, en un seul passage.
function clientStatsMap() {
  const map = {};
  reportSource().forEach(t => {
    if (t.cancelled || !t.clientId) return;
    const b = map[t.clientId] = map[t.clientId] || { n: 0, total: 0, last: '' };
    b.n++; b.total += t.total;
    if (t.date > b.last) b.last = t.date;
  });
  return map;
}

function clientMatches(c, q) {
  if (!q) return true;
  return (c.name || '').toLowerCase().includes(q)
    || (c.phone || '').replace(/\s/g, '').includes(q.replace(/\s/g, ''));
}

// ── Client associé au ticket en cours ─────────────────────────────────────────
let ticketClient = null; // { id, name }

function setTicketClient(c) {
  ticketClient = c ? { id: c.id, name: c.name } : null;
  renderTicketClient();
}

function renderTicketClient() {
  const btn = document.getElementById('btn-ticket-client');
  if (!ticketClient) {
    btn.className = 'ticket-client-btn';
    btn.innerHTML = '👤 Associer un client';
    return;
  }
  const c = clientById(ticketClient.id);
  const avail = c ? rewardsAvailable(c) : 0;
  btn.className = 'ticket-client-btn selected' + (avail > 0 ? ' reward' : '');
  btn.innerHTML = avail > 0
    ? `👤 <b>${escapeHtml(ticketClient.name)}</b> · 🎁 ${avail} pizza${avail > 1 ? 's' : ''} offerte${avail > 1 ? 's' : ''} dispo`
    : `👤 <b>${escapeHtml(ticketClient.name)}</b>${c ? ` · ${loyaltyProgress(c)}/${LOYALTY_THRESHOLD} 🍕` : ''}`;
}

// Met à jour la fidélité du client après une vente validée.
// Les pizzas offertes consomment d'abord les récompenses disponibles,
// puis les pizzas payées font avancer le compteur.
function applyLoyaltyAfterSale(lines) {
  if (!ticketClient) return;
  const c = clientById(ticketClient.id);
  if (!c) return;
  const isPizza = l => /pizza/i.test(l.category || '');
  const paidPizzas = lines.filter(l => isPizza(l) && l.price > 0).reduce((s, l) => s + l.qty, 0);
  const freePizzas = lines.filter(l => isPizza(l) && l.price === 0).reduce((s, l) => s + l.qty, 0);
  if (freePizzas > 0) {
    const used = Math.min(freePizzas, rewardsAvailable(c));
    if (used > 0) c.rewardsUsed = (c.rewardsUsed || 0) + used;
  }
  const before = rewardsAvailable(c);
  c.pizzaCount = pizzasOf(c) + paidPizzas;
  saveClients();
  if (rewardsAvailable(c) > before) {
    showToast(`🎉 ${c.name} vient de gagner une pizza offerte (fidélité) !`);
  }
}

// ── Sélecteur de client depuis le ticket ──────────────────────────────────────
function openClientPicker() {
  document.getElementById('client-pick-search').value = '';
  document.getElementById('btn-client-pick-remove').style.display = ticketClient ? 'block' : 'none';
  renderClientPickList('');
  document.getElementById('modal-client-pick').classList.add('open');
}
function closeClientPicker() { document.getElementById('modal-client-pick').classList.remove('open'); }

function renderClientPickList(q) {
  const el = document.getElementById('client-pick-list');
  const list = clients
    .filter(c => clientMatches(c, q.toLowerCase().trim()))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
  if (!list.length) {
    el.innerHTML = `<p class="empty-msg">${clients.length
      ? 'Aucun client trouvé.'
      : 'Aucun client — créez le premier avec « ➕ Nouveau ».'}</p>`;
    return;
  }
  el.innerHTML = '';
  list.forEach(c => {
    const avail = rewardsAvailable(c);
    const row = document.createElement('button');
    row.className = 'client-pick-row';
    row.innerHTML = `
      <span class="cp-name"><b>${escapeHtml(c.name)}</b>${c.phone ? `<small>${escapeHtml(c.phone)}</small>` : ''}</span>
      <span class="cp-loy${avail > 0 ? ' reward' : ''}">${avail > 0
        ? `🎁 ${avail} offerte${avail > 1 ? 's' : ''}`
        : `${loyaltyProgress(c)}/${LOYALTY_THRESHOLD} 🍕`}</span>`;
    row.addEventListener('click', () => {
      setTicketClient(c);
      closeClientPicker();
      if (avail > 0) showToast(`🎁 ${c.name} a ${avail} pizza${avail > 1 ? 's' : ''} offerte${avail > 1 ? 's' : ''} — touchez « 🍕 Fidélité » pour l'appliquer.`);
    });
    el.appendChild(row);
  });
}

document.getElementById('btn-ticket-client').addEventListener('click', openClientPicker);
document.getElementById('client-pick-search').addEventListener('input', e => renderClientPickList(e.target.value));
document.getElementById('btn-client-pick-close').addEventListener('click', closeClientPicker);
document.getElementById('btn-client-pick-remove').addEventListener('click', () => { setTicketClient(null); closeClientPicker(); });
document.getElementById('btn-client-pick-new').addEventListener('click', () => { closeClientPicker(); openClientModal(null, { attach: true }); });
document.getElementById('modal-client-pick').addEventListener('click', e => {
  if (e.target.id === 'modal-client-pick') closeClientPicker();
});

// ── Fiche client : création / édition ─────────────────────────────────────────
let editingClientId = null;
let clientModalAttach = false; // après enregistrement, associer au ticket en cours

function openClientModal(client = null, opts = {}) {
  editingClientId = client ? client.id : null;
  clientModalAttach = !!opts.attach;
  document.getElementById('modal-client-title').textContent = client ? 'Modifier le client' : 'Nouveau client';
  document.getElementById('client-name').value  = client?.name  ?? '';
  document.getElementById('client-phone').value = client?.phone ?? '';
  document.getElementById('client-notes').value = client?.notes ?? '';
  document.getElementById('btn-client-delete').style.display = client ? 'inline-flex' : 'none';
  document.getElementById('modal-client').classList.add('open');
}
function closeClientModal() { document.getElementById('modal-client').classList.remove('open'); }

document.getElementById('btn-client-cancel').addEventListener('click', closeClientModal);
document.getElementById('modal-client').addEventListener('click', e => {
  if (e.target.id === 'modal-client') closeClientModal();
});

document.getElementById('btn-client-save').addEventListener('click', () => {
  const name  = document.getElementById('client-name').value.trim();
  const phone = document.getElementById('client-phone').value.trim();
  const notes = document.getElementById('client-notes').value.trim();
  if (!name) { showToast('Le nom du client est obligatoire.'); return; }
  const wasEditing = !!editingClientId;
  let c;
  if (wasEditing) {
    c = clientById(editingClientId);
    if (c) { c.name = name; c.phone = phone; c.notes = notes; }
  } else {
    c = { id: uid(), name, phone, notes, createdAt: new Date().toISOString(), pizzaCount: 0, rewardsUsed: 0 };
    clients.push(c);
  }
  saveClients();
  closeClientModal();
  if (clientModalAttach && c) setTicketClient(c);
  else if (ticketClient && c && ticketClient.id === c.id) setTicketClient(c); // rafraîchit le nom affiché
  clientModalAttach = false;
  renderClients();
  showToast(wasEditing ? 'Client modifié.' : `Client « ${name} » créé.`);
});

document.getElementById('btn-client-delete').addEventListener('click', () => {
  if (!editingClientId) return;
  const c = clientById(editingClientId);
  if (!confirm(`Supprimer la fiche de ${c ? c.name : 'ce client'} ? Les ventes passées sont conservées, mais sa fidélité sera perdue.`)) return;
  clients = clients.filter(x => x.id !== editingClientId);
  if (ticketClient && ticketClient.id === editingClientId) setTicketClient(null);
  saveClients();
  closeClientModal();
  document.getElementById('modal-client-detail').classList.remove('open');
  renderClients();
  showToast('Client supprimé.');
});

// ── Détail client : fidélité + historique ─────────────────────────────────────
let detailClientId = null;

function openClientDetail(id) {
  const c = clientById(id);
  if (!c) return;
  detailClientId = id;
  const txs   = clientTxs(id);
  const total = txs.reduce((s, t) => s + t.total, 0);
  const avail = rewardsAvailable(c);
  const nbPizzas = pizzasOf(c);
  document.getElementById('client-detail-name').textContent = `👤 ${c.name}`;
  document.getElementById('client-detail-body').innerHTML = `
    ${avail > 0 ? `<div class="client-reward-banner">🎁 ${avail} pizza${avail > 1 ? 's' : ''} offerte${avail > 1 ? 's' : ''} disponible${avail > 1 ? 's' : ''} — associez ce client au ticket puis touchez « 🍕 Fidélité ».</div>` : ''}
    <div class="client-detail-info">
      ${c.phone ? `📞 <b>${escapeHtml(c.phone)}</b><br>` : ''}
      ${c.notes ? `📝 ${escapeHtml(c.notes)}<br>` : ''}
      🍕 Fidélité : <b>${loyaltyProgress(c)}/${LOYALTY_THRESHOLD}</b> vers la prochaine offerte (${nbPizzas} pizza${nbPizzas > 1 ? 's' : ''} achetée${nbPizzas > 1 ? 's' : ''} au total)<br>
      🧾 <b>${txs.length}</b> visite${txs.length > 1 ? 's' : ''} · 💰 <b>${fmtEur(total)}</b> · Dernière visite : <b>${txs[0] ? fmtDate(txs[0].date.slice(0, 10)) : '—'}</b>
    </div>
    <div>
      <p class="label" style="margin-bottom:.3rem">Historique des achats</p>
      <div class="client-history">
        ${txs.slice(0, 20).map(t => `
          <div class="client-history-row">
            <div class="chr-top"><span>${fmtDate(t.date.slice(0, 10))} · ${fmtTime(t.date)}</span><span>${fmtEur(t.total)}</span></div>
            <div class="chr-items">${t.lines.map(l => `${l.name} ×${l.qty}`).join(', ')}</div>
          </div>`).join('') || '<p class="empty-msg">Aucun achat enregistré pour le moment</p>'}
      </div>
    </div>`;
  document.getElementById('modal-client-detail').classList.add('open');
}

document.getElementById('btn-client-detail-close').addEventListener('click', () => {
  document.getElementById('modal-client-detail').classList.remove('open');
});
document.getElementById('modal-client-detail').addEventListener('click', e => {
  if (e.target.id === 'modal-client-detail') document.getElementById('modal-client-detail').classList.remove('open');
});
document.getElementById('btn-client-detail-edit').addEventListener('click', () => {
  document.getElementById('modal-client-detail').classList.remove('open');
  const c = clientById(detailClientId);
  if (c) openClientModal(c);
});

// ── Onglet Clients : liste, recherche, KPIs, export ───────────────────────────
function renderClients() {
  const q = (document.getElementById('client-search').value || '').toLowerCase().trim();
  const stats = clientStatsMap();

  const totRewards = clients.reduce((s, c) => s + rewardsAvailable(c), 0);
  const caClients  = Object.values(stats).reduce((s, b) => s + b.total, 0);
  document.getElementById('clients-kpis').innerHTML = `
    <div class="summary-chip"><strong>${clients.length}</strong>client${clients.length > 1 ? 's' : ''}</div>
    <div class="summary-chip"><strong>${totRewards}</strong>🎁 pizza${totRewards > 1 ? 's' : ''} fidélité à offrir</div>
    <div class="summary-chip"><strong>${fmtEur(caClients)}</strong>CA clients identifiés</div>`;

  const el = document.getElementById('clients-list');
  const list = clients
    .filter(c => clientMatches(c, q))
    .sort((a, b) => (stats[b.id]?.last || '').localeCompare(stats[a.id]?.last || '')
      || (a.name || '').localeCompare(b.name || '', 'fr'));
  if (!list.length) {
    el.innerHTML = `<p class="empty-msg">${clients.length
      ? 'Aucun client ne correspond à la recherche.'
      : 'Aucun client pour le moment — touchez « ➕ Nouveau client », ou associez un client à un ticket depuis la caisse.'}</p>`;
    return;
  }
  el.innerHTML = '';
  list.forEach(c => {
    const st    = stats[c.id] || { n: 0, total: 0, last: '' };
    const avail = rewardsAvailable(c);
    const prog  = loyaltyProgress(c);
    const row = document.createElement('div');
    row.className = 'client-row';
    row.innerHTML = `
      <div class="client-id"><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(c.phone || '')}${c.phone && c.notes ? ' · ' : ''}${escapeHtml(c.notes || '')}</small></div>
      <div class="client-loyalty${avail > 0 ? ' reward' : ''}">
        ${avail > 0 ? `🎁 ${avail} pizza${avail > 1 ? 's' : ''} offerte${avail > 1 ? 's' : ''} !` : `🍕 ${prog}/${LOYALTY_THRESHOLD} vers l'offerte`}
        <div class="loy-track"><div class="loy-fill${avail > 0 ? ' full' : ''}" style="width:${avail > 0 ? 100 : prog / LOYALTY_THRESHOLD * 100}%"></div></div>
      </div>
      <div class="client-stats"><b>${st.n}</b> visite${st.n > 1 ? 's' : ''} · <b>${fmtEur(st.total)}</b><br>${st.last ? 'dern. ' + fmtDate(st.last.slice(0, 10)) : 'aucune vente'}</div>
      <button class="client-edit-btn" title="Modifier la fiche">✏️</button>`;
    row.addEventListener('click', e => {
      if (e.target.closest('.client-edit-btn')) { openClientModal(c); return; }
      openClientDetail(c.id);
    });
    el.appendChild(row);
  });
}

document.getElementById('client-search').addEventListener('input', renderClients);
document.getElementById('btn-new-client').addEventListener('click', () => openClientModal());

document.getElementById('btn-export-clients').addEventListener('click', () => {
  if (!clients.length) { showToast('Aucun client à exporter.'); return; }
  const stats = clientStatsMap();
  const rows = [['Nom', 'Téléphone', 'Notes', 'Pizzas achetées', 'Fidélités utilisées', 'Fidélités disponibles', 'Visites', 'Total dépensé (€)', 'Dernière visite']];
  clients.forEach(c => {
    const st = stats[c.id] || { n: 0, total: 0, last: '' };
    rows.push([c.name, c.phone || '', c.notes || '', pizzasOf(c), c.rewardsUsed || 0,
      rewardsAvailable(c), st.n, st.total.toFixed(2), st.last ? st.last.slice(0, 10) : '']);
  });
  downloadCSV(`clients_${todayISO()}.csv`, rows);
});

// ══════════════════ MODAL ARTICLE ═════════════════════════════════════════════

let editingArticleId = null;

const NEW_CAT = '__new__';
function fillCategorySelect(selected) {
  const sel = document.getElementById('art-category');
  sel.innerHTML = '';
  const cats = orderedCategories();                 // catégories réelles existantes
  if (selected && !cats.includes(selected)) cats.push(selected); // sécurité (catégorie orpheline)
  cats.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
  const oNew = document.createElement('option');
  oNew.value = NEW_CAT; oNew.textContent = '➕ Nouvelle catégorie…';
  sel.appendChild(oNew);
  sel.value = selected && cats.includes(selected) ? selected : (cats[0] || NEW_CAT);
  syncNewCatField();
}
function syncNewCatField() {
  const sel = document.getElementById('art-category');
  const inp = document.getElementById('art-category-new');
  const isNew = sel.value === NEW_CAT;
  inp.style.display = isNew ? 'block' : 'none';
  if (!isNew) inp.value = '';
}
document.getElementById('art-category').addEventListener('change', () => {
  syncNewCatField();
  if (document.getElementById('art-category').value === NEW_CAT) document.getElementById('art-category-new').focus();
});

function openArticleModal(art = null) {
  editingArticleId = art ? art.id : null;
  document.getElementById('modal-article-title').textContent = art ? 'Modifier l\'article' : 'Nouvel article';
  document.getElementById('art-name').value  = art?.name  ?? '';
  // Catégorie : liste des existantes + « Nouvelle catégorie ». Par défaut, la catégorie
  // active de l'onglet pour un nouvel article (sauf « Tous »).
  const defaultCat = art ? art.category : (activeCategory !== 'Tous' ? activeCategory : null);
  fillCategorySelect(defaultCat);
  document.getElementById('art-price').value    = art?.price    ?? '';
  document.getElementById('art-emoji').value    = art?.emoji    ?? '🍕';
  document.getElementById('art-active').checked = art ? (art.active !== false) : true;
  document.getElementById('btn-modal-delete').style.display = art ? 'inline-flex' : 'none';
  document.getElementById('modal-article').classList.add('open');
}

// (l'ajout d'article se fait via le menu ☰ → « ➕ Ajouter un article »)
document.getElementById('btn-modal-cancel').addEventListener('click', closeArticleModal);
document.getElementById('modal-article').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-article')) closeArticleModal();
});

function closeArticleModal() {
  document.getElementById('modal-article').classList.remove('open');
}

document.getElementById('btn-modal-delete').addEventListener('click', () => {
  if (!editingArticleId) return;
  if (!confirm('Supprimer cet article du catalogue ?')) return;
  articles = articles.filter(a => a.id !== editingArticleId);
  // Retire aussi du ticket en cours si présent
  ticket = ticket.filter(l => l.article.id !== editingArticleId);
  saveArticles();
  closeArticleModal();
  renderCategories();
  renderArticles();
  renderTicket();
  showToast('Article supprimé.');
});

document.getElementById('btn-modal-save').addEventListener('click', () => {
  const name     = document.getElementById('art-name').value.trim();
  const selCat   = document.getElementById('art-category').value;
  const category = selCat === NEW_CAT ? document.getElementById('art-category-new').value.trim() : selCat;
  const price    = parseFloat(document.getElementById('art-price').value);
  const emoji    = document.getElementById('art-emoji').value.trim() || '🍕';
  const active   = document.getElementById('art-active').checked;
  if (!name || !category || isNaN(price)) { showToast('Remplissez tous les champs.'); return; }

  if (editingArticleId) {
    const art = articles.find(a => a.id === editingArticleId);
    if (art) { art.name = name; art.category = category; art.price = price; art.emoji = emoji; art.active = active; }
  } else {
    articles.push({ id: uid(), name, category, price, emoji, active });
  }
  saveArticles();
  closeArticleModal();
  renderCategories();
  renderArticles();
  showToast(editingArticleId ? 'Article modifié.' : 'Article ajouté.');
});

// ══════════════════ MÉMO ══════════════════════════════════════════════════════

const memoDateInput = document.getElementById('memo-date');
memoDateInput.value = todayISO();

memoDateInput.addEventListener('change', () => { renderMemo(); autoLoadSheets(); });

// Désarme (referme) toutes les lignes en attente d'annulation.
function disarmMemoRows() {
  document.querySelectorAll('#memo-tbody tr.armed').forEach(tr => tr.classList.remove('armed'));
}
// Referme les lignes si on touche ailleurs.
document.addEventListener('click', (e) => {
  if (!e.target.closest('#memo-tbody tr.armed')) disarmMemoRows();
});

// Rend une ligne « glissable vers la gauche » : révèle l'état rouge + poubelle.
function attachSwipeToCancel(tr, id) {
  let x0 = 0, y0 = 0, horizontal = false;
  tr.addEventListener('touchstart', (e) => {
    const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; horizontal = false;
  }, { passive: true });
  tr.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) horizontal = true;
  }, { passive: true });
  tr.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if (!horizontal) return;
    if (dx < -45 && Math.abs(dx) > Math.abs(dy)) {       // glissé vers la gauche → armer
      disarmMemoRows();
      tr.classList.add('armed');
    } else if (dx > 45) {                                // glissé vers la droite → refermer
      tr.classList.remove('armed');
    }
  });
}

function txsForDate(dateStr) {
  return reportSource().filter(t => t.date.slice(0, 10) === dateStr);
}

// Emoji d'affichage : depuis la ligne, sinon retrouvé dans le catalogue par nom, sinon rien.
// (Les ventes venant du Google Sheet ne stockent pas l'emoji.)
function emojiFor(line) {
  if (line.emoji) return line.emoji + ' ';
  const base = String(line.name || '').replace(/\s*\(offert\)$/, '');
  const a = articles.find(x => x.name === base);
  return a && a.emoji ? a.emoji + ' ' : '';
}

function renderMemo() {
  const date = memoDateInput.value || todayISO();
  const txs  = txsForDate(date);

  // Summary chips
  const active = txs.filter(t => !t.cancelled);
  const totalCA = active.reduce((s, t) => s + t.total, 0);
  const byMethod = { especes: 0, carte: 0 };
  active.forEach(t => { byMethod[t.method] = (byMethod[t.method] || 0) + t.total; });
  document.getElementById('memo-summary').innerHTML = `
    <div class="summary-chip"><strong>${active.length}</strong>tickets</div>
    <div class="summary-chip"><strong>${fmtEur(totalCA)}</strong>CA du jour</div>
    <div class="summary-chip"><strong>${fmtEur(byMethod.especes)}</strong>Espèces</div>
    <div class="summary-chip"><strong>${fmtEur(byMethod.carte)}</strong>Carte</div>
  `;

  // Table
  const tbody = document.getElementById('memo-tbody');
  tbody.innerHTML = '';
  if (!txs.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--mid);padding:1.5rem">Aucune transaction ce jour</td></tr>';
    return;
  }
  txs.slice().reverse().forEach((tx, i) => {
    const cls = tx.cancelled ? 'cancelled' : '';
    const linesStr = (tx.clientName ? `👤 <strong>${tx.clientName}</strong> · ` : '')
      + (tx.employee ? `<span class="memo-emp">🧑‍🍳 ${escapeHtml(tx.employee)}</span> · ` : '')
      + (tx.complementOf ? '🔁 <em>complément</em> · ' : '')
      + tx.lines.map(l => `${emojiFor(l)}${l.name} ×${l.qty}`).join(', ');
    const badge = tx.cancelled
      ? '<span class="badge-pay badge-annule">Annulé</span>'
      : `<span class="badge-pay badge-${tx.method}">${{especes:'💶 Espèces', carte:'💳 Carte'}[tx.method] ?? tx.method}</span>`;
    const tr = document.createElement('tr');
    tr.dataset.id = tx.id;
    tr.innerHTML = `
      <td class="${cls}">${txs.length - i}</td>
      <td class="${cls}">${fmtTime(tx.date)}</td>
      <td class="${cls}" style="max-width:260px;word-break:break-word">${linesStr}</td>
      <td>${badge}</td>
      <td class="${cls}" style="font-weight:700">${fmtEur(tx.total)}</td>
      <td class="memo-actions">${tx.cancelled ? '' : `
        <button class="btn-reopen-tx" data-id="${tx.id}" title="Rouvrir : ajouter des articles à cette vente">🔁 <span>Complément</span></button>
        <button class="btn-del-tx" data-id="${tx.id}" title="Confirmer l'annulation">🗑️</button>`}</td>
    `;
    tbody.appendChild(tr);
    if (!tx.cancelled) attachSwipeToCancel(tr, tx.id);
  });

  tbody.querySelectorAll('.btn-del-tx').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      cancelTransaction(id);
      renderMemo();
      showToast('Vente annulée.');
    });
  });
  tbody.querySelectorAll('.btn-reopen-tx').forEach(btn => {
    btn.addEventListener('click', () => reopenTransaction(btn.dataset.id));
  });
}

// Cancel modal
function openCancelModal(txId) {
  currentTx = txId;
  document.getElementById('modal-cancel-tx').classList.add('open');
}
document.getElementById('btn-cancel-no').addEventListener('click', () => {
  document.getElementById('modal-cancel-tx').classList.remove('open');
});
document.getElementById('btn-cancel-yes').addEventListener('click', () => {
  if (currentTx) cancelTransaction(currentTx);
  document.getElementById('modal-cancel-tx').classList.remove('open');
  renderMemo();
  showToast('Transaction annulée.');
});

// Export CSV mémo
document.getElementById('btn-export-memo').addEventListener('click', () => {
  const date = memoDateInput.value || todayISO();
  const txs  = txsForDate(date);
  if (!txs.length) { showToast('Aucune donnée à exporter.'); return; }
  const rows = [['#', 'Date', 'Heure', 'Client', 'Articles', 'Paiement', 'Montant', 'Statut']];
  txs.forEach((tx, i) => {
    rows.push([
      i + 1,
      date,
      fmtTime(tx.date),
      tx.clientName || '',
      tx.lines.map(l => `${l.name} x${l.qty}`).join(' | '),
      tx.method,
      tx.total.toFixed(2),
      tx.cancelled ? 'Annulé' : 'Validé',
    ]);
  });
  downloadCSV(`memo_${date}.csv`, rows);
});

// ══════════════════ EMPLACEMENT ═══════════════════════════════════════════════

// Calendrier fixe La Casetta (0=dim, 1=lun, …, 6=sam)
const WEEKLY_SCHEDULE = {
  1: { city: 'Feings',                  place: 'Parking de l\'école',      hours: '18h–21h30' },
  2: { city: 'Thenay',                  place: 'Place de l\'église',        hours: '18h–21h30' },
  3: { city: 'Cande-sur-Beuvron',       place: 'Place des Cèdres',         hours: '18h–21h30' },
  4: { city: 'Rilly-sur-Loire',         place: 'Parking salle des fêtes',  hours: '18h–21h30' },
  5: { city: 'Saint-Gervais-la-Forêt', place: 'Place du Marché',          hours: '18h–21h30' },
};

function scheduleForDate(dateStr) {
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  return WEEKLY_SCHEDULE[dow] || null;
}

function locationLabelFromSchedule(s) {
  return s ? `${s.city} — ${s.place}` : '';
}

// Auto-détection : si nouvelle journée, on repart sur le programme
function autoDetectLocation() {
  const today     = todayISO();
  const lastDate  = LS.get('pos_location_date', '');
  if (lastDate === today) return LS.get('pos_location', ''); // journée déjà initialisée

  const sched = scheduleForDate(today);
  const auto  = locationLabelFromSchedule(sched);
  if (auto) {
    LS.set('pos_location', auto);
    LS.set('pos_location_date', today);
  }
  return auto || LS.get('pos_location', '');
}

let currentLocation = autoDetectLocation();

function renderLocationBtn() {
  document.getElementById('location-label').textContent = currentLocation || '—';
}
renderLocationBtn();

// Jours de la semaine pour libellé des chips (1=lun … 5=ven)
const DOW_LABELS = { 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Jeu', 5: 'Ven' };

document.getElementById('btn-location').addEventListener('click', () => {
  const today    = todayISO();
  const todayDow = new Date(today + 'T12:00:00').getDay();

  const container = document.getElementById('location-presets');
  container.innerHTML = '';

  // Les 5 emplacements du calendrier (un par jour ouvré), aujourd'hui en premier et marqué 📅
  const days = Object.keys(WEEKLY_SCHEDULE).map(Number)
    .sort((a, b) => (a === todayDow ? -1 : b === todayDow ? 1 : a - b));

  days.forEach(dow => {
    const s     = WEEKLY_SCHEDULE[dow];
    const value = locationLabelFromSchedule(s);
    const isToday = dow === todayDow;
    const chip = document.createElement('button');
    chip.className = 'location-chip' + (value === currentLocation ? ' active' : '');
    chip.innerHTML = `${isToday ? '📅 ' : ''}<strong>${DOW_LABELS[dow]}</strong> · ${s.city}`;
    chip.addEventListener('click', () => {
      document.getElementById('location-input').value = value;
      container.querySelectorAll('.location-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
    container.appendChild(chip);
  });

  // Info horaires du programme du jour
  const sched  = scheduleForDate(today);
  const infoEl = document.getElementById('location-schedule-info');
  if (infoEl) {
    infoEl.textContent = sched ? `🕐 ${sched.hours}` : '';
    infoEl.style.display = sched ? 'block' : 'none';
  }

  document.getElementById('location-input').value = currentLocation;
  document.getElementById('modal-location').classList.add('open');
});

document.getElementById('btn-location-save').addEventListener('click', () => {
  const val = document.getElementById('location-input').value.trim();
  if (!val) { showToast('Veuillez saisir un emplacement.'); return; }
  currentLocation = val;
  LS.set('pos_location', val);
  LS.set('pos_location_date', todayISO());
  const history = [...new Set([val, ...LS.get('pos_location_history', [])])].slice(0, 10);
  LS.set('pos_location_history', history);
  renderLocationBtn();
  document.getElementById('modal-location').classList.remove('open');
  showToast(`📍 Emplacement : ${val}`);
});

document.getElementById('btn-location-cancel').addEventListener('click', () => {
  document.getElementById('modal-location').classList.remove('open');
});

// ══════════════════ EMPLOYÉS ═══════════════════════════════════════════════════
// Un employé « courant » (celui qui encaisse) est affiché dans le header et
// enregistré sur chaque vente. Un employé « par défaut » (⭐) est réactivé à
// chaque nouvelle journée. Liste modifiable dans la modal « Employés ».

function saveEmployees() { LS.set('pos_employees', employees); }
function employeeById(id) { return employees.find(e => e.id === id) || null; }
function currentEmployee() { return employeeById(currentEmployeeId); }
function currentEmployeeName() { const e = currentEmployee(); return e ? e.name : ''; }
function empUid(name) {
  const base = (name || 'emp').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'emp';
  let id = base, n = 2;
  while (employeeById(id)) id = base + '-' + (n++);
  return id;
}

function setCurrentEmployee(id) {
  if (!employeeById(id)) return;
  currentEmployeeId = id;
  LS.set('pos_employee_current', id);
  LS.set('pos_employee_current_date', todayISO());
  renderEmployeeBtn();
}

function setDefaultEmployee(id) {
  if (!employeeById(id)) return;
  defaultEmployeeId = id;
  LS.set('pos_employee_default', id);
}

function renderEmployeeBtn() {
  const el = document.getElementById('employee-label');
  if (el) el.textContent = currentEmployeeName() || '—';
}

const employeeModal = document.getElementById('modal-employee');
function openEmployeeModal() {
  renderEmployeeList();
  document.getElementById('employee-new-name').value = '';
  employeeModal.classList.add('open');
}
function closeEmployeeModal() { employeeModal.classList.remove('open'); }

function renderEmployeeList() {
  const box = document.getElementById('employee-list');
  box.innerHTML = '';
  if (!employees.length) {
    box.innerHTML = '<p style="color:var(--mid);font-size:.85rem">Aucun employé. Ajoutez-en un ci-dessous.</p>';
    return;
  }
  employees.forEach(e => {
    const isCur = e.id === currentEmployeeId;
    const isDef = e.id === defaultEmployeeId;
    const row = document.createElement('div');
    row.className = 'employee-row' + (isCur ? ' active' : '');
    row.innerHTML = `
      <button class="employee-pick" data-id="${e.id}">
        <span class="employee-name">${escapeHtml(e.name)}</span>
        ${isCur ? '<span class="employee-badge">en poste</span>' : ''}
      </button>
      <button class="employee-star${isDef ? ' on' : ''}" data-id="${e.id}" title="Employé par défaut au démarrage">${isDef ? '⭐' : '☆'}</button>
      <button class="employee-edit" data-id="${e.id}" title="Renommer">✏️</button>
      <button class="employee-del" data-id="${e.id}" title="Retirer">🗑</button>`;
    box.appendChild(row);
  });

  box.querySelectorAll('.employee-pick').forEach(b => b.addEventListener('click', () => {
    setCurrentEmployee(b.dataset.id);
    renderEmployeeList();
    showToast(`👤 En poste : ${currentEmployeeName()}`);
  }));
  box.querySelectorAll('.employee-star').forEach(b => b.addEventListener('click', () => {
    setDefaultEmployee(b.dataset.id);
    renderEmployeeList();
    showToast(`⭐ Par défaut : ${employeeById(b.dataset.id).name}`);
  }));
  box.querySelectorAll('.employee-edit').forEach(b => b.addEventListener('click', () => {
    const e = employeeById(b.dataset.id);
    if (!e) return;
    const name = (prompt('Nom de l\'employé :', e.name) || '').trim();
    if (!name) return;
    e.name = name;
    saveEmployees();
    renderEmployeeList();
    renderEmployeeBtn();
    if (horairesReady) renderHoraires();
  }));
  box.querySelectorAll('.employee-del').forEach(b => b.addEventListener('click', () => {
    const e = employeeById(b.dataset.id);
    if (!e) return;
    if (employees.length <= 1) { showToast('Gardez au moins un employé.'); return; }
    if (!confirm(`Retirer ${e.name} de la liste ? Ses créneaux passés restent enregistrés.`)) return;
    employees = employees.filter(x => x.id !== e.id);
    saveEmployees();
    // Réaffecte défaut / courant si nécessaire
    if (defaultEmployeeId === e.id) setDefaultEmployee(employees[0].id);
    if (currentEmployeeId === e.id) setCurrentEmployee(defaultEmployeeId);
    renderEmployeeList();
    renderEmployeeBtn();
    if (horairesReady) renderHoraires();
  }));
}

function addEmployee() {
  const input = document.getElementById('employee-new-name');
  const name  = input.value.trim();
  if (!name) { showToast('Saisissez un nom.'); return; }
  const e = { id: empUid(name), name };
  employees.push(e);
  saveEmployees();
  input.value = '';
  renderEmployeeList();
  showToast(`➕ ${name} ajouté(e).`);
}

document.getElementById('btn-employee').addEventListener('click', openEmployeeModal);
document.getElementById('btn-employee-close').addEventListener('click', closeEmployeeModal);
document.getElementById('btn-employee-add').addEventListener('click', addEmployee);
document.getElementById('employee-new-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') addEmployee();
});
employeeModal.addEventListener('click', e => { if (e.target === employeeModal) closeEmployeeModal(); });

// ══════════════════ HORAIRES (TIMESHEET) ═══════════════════════════════════════
// Planning des créneaux à réaliser : un créneau (début–fin) par employé et par
// jour, stocké par date ISO. Vue « semaine » (grille employés × 7 jours) et vue
// « mois » (calendrier récapitulatif). Stockage local pos_timesheet.

const DEFAULT_SHIFT = { start: '18:00', end: '21:30' }; // horaires habituels du camion
const DOW_FULL = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
let horairesView   = LS.get('pos_horaires_view', 'week');
let horairesAnchor = todayISO();   // une date à l'intérieur de la semaine/mois affichés
let horairesReady  = false;        // évite les rendus avant l'init

function getTimesheet() { return LS.get('pos_timesheet', {}); }
function saveTimesheet(ts) { LS.set('pos_timesheet', ts); }
function shiftsForDate(iso) { return getTimesheet()[iso] || []; }
function shiftFor(iso, empId) { return shiftsForDate(iso).find(s => s.employeeId === empId) || null; }
function setShift(iso, empId, shift) {
  const ts = getTimesheet();
  const arr = (ts[iso] || []).filter(s => s.employeeId !== empId);
  if (shift) arr.push({ employeeId: empId, start: shift.start, end: shift.end });
  if (arr.length) ts[iso] = arr; else delete ts[iso];
  saveTimesheet(ts);
}

// ── Date helpers (locaux, sans dépendance externe) ──
function isoAddDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00');
  const dow = (d.getDay() + 6) % 7; // 0 = lundi
  return isoAddDays(iso, -dow);
}
function weekDates(anchor) {
  const mon = mondayOf(anchor);
  return Array.from({ length: 7 }, (_, i) => isoAddDays(mon, i));
}
function parseHM(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}
function shiftMinutes(s) {
  if (!s) return 0;
  const a = parseHM(s.start), b = parseHM(s.end);
  if (a == null || b == null) return 0;
  return Math.max(0, b - a);
}
function fmtDur(min) {
  if (!min) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h}h${String(m).padStart(2, '0')}`;
  if (h) return `${h}h`;
  return `${m}min`;
}
function empInitials(name) {
  return (name || '').split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).join('').slice(0, 3) || '?';
}

function renderHoraires() {
  horairesReady = true;
  document.querySelectorAll('.horaires-view').forEach(b =>
    b.classList.toggle('active', b.dataset.view === horairesView));
  if (horairesView === 'week') renderHorairesWeek();
  else renderHorairesMonth();
}

function renderHorairesWeek() {
  const dates = weekDates(horairesAnchor);
  const mon = dates[0], sun = dates[6];
  const fmtShort = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  document.getElementById('horaires-period').textContent = `Semaine du ${fmtShort(mon)} au ${fmtShort(sun)}`;
  document.getElementById('horaires-hint').textContent = 'Touchez une case pour définir le créneau à réaliser (début–fin). Vide = repos.';

  const today = todayISO();
  let html = '<div class="horaires-week-wrap"><table class="horaires-week"><thead><tr><th class="hw-corner">Employé</th>';
  dates.forEach(iso => {
    const d = new Date(iso + 'T12:00:00');
    const dow = d.getDay();
    const sched = WEEKLY_SCHEDULE[dow];
    html += `<th class="${iso === today ? 'hw-today' : ''}">
      <span class="hw-dow">${DOW_FULL[dow]}</span>
      <span class="hw-date">${d.getDate()}</span>
      ${sched ? `<span class="hw-city">${escapeHtml(sched.city)}</span>` : ''}
    </th>`;
  });
  html += '<th class="hw-total">Total</th></tr></thead><tbody>';

  const dayTotals = dates.map(() => 0);
  employees.forEach(e => {
    let empTotal = 0;
    html += `<tr><td class="hw-emp">${escapeHtml(e.name)}</td>`;
    dates.forEach((iso, i) => {
      const s = shiftFor(iso, e.id);
      const min = shiftMinutes(s);
      empTotal += min; dayTotals[i] += min;
      html += `<td class="hw-cell ${s ? 'filled' : ''} ${iso === today ? 'hw-today' : ''}" data-date="${iso}" data-emp="${e.id}">`;
      html += s
        ? `<span class="hw-shift">${s.start}–${s.end}</span><span class="hw-shift-dur">${fmtDur(min)}</span>`
        : '<span class="hw-add">＋</span>';
      html += '</td>';
    });
    html += `<td class="hw-total">${fmtDur(empTotal)}</td></tr>`;
  });

  html += '<tr class="hw-foot"><td class="hw-emp">Total / jour</td>';
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);
  dayTotals.forEach(m => { html += `<td>${fmtDur(m)}</td>`; });
  html += `<td class="hw-total">${fmtDur(weekTotal)}</td></tr>`;
  html += '</tbody></table></div>';

  const body = document.getElementById('horaires-body');
  body.innerHTML = html;
  body.querySelectorAll('.hw-cell').forEach(c =>
    c.addEventListener('click', () => openShiftModal(c.dataset.date, c.dataset.emp)));
}

function renderHorairesMonth() {
  const d = new Date(horairesAnchor + 'T12:00:00');
  const year = d.getFullYear(), month = d.getMonth();
  document.getElementById('horaires-period').textContent =
    new Date(year, month, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  document.getElementById('horaires-hint').textContent = 'Vue du mois : total d\'heures planifiées par jour. Touchez un jour pour l\'ouvrir en vue semaine.';

  const first = new Date(year, month, 1);
  const startMon = mondayOf(first.toISOString().slice(0, 10));
  const today = todayISO();

  let html = '<div class="horaires-month"><div class="hm-grid"><div class="hm-head">Lun</div><div class="hm-head">Mar</div><div class="hm-head">Mer</div><div class="hm-head">Jeu</div><div class="hm-head">Ven</div><div class="hm-head">Sam</div><div class="hm-head">Dim</div>';
  for (let i = 0; i < 42; i++) {
    const iso = isoAddDays(startMon, i);
    const cd = new Date(iso + 'T12:00:00');
    const inMonth = cd.getMonth() === month;
    const shifts = shiftsForDate(iso);
    const total = shifts.reduce((s, sh) => s + shiftMinutes(sh), 0);
    let chips = shifts.map(sh => {
      const e = employeeById(sh.employeeId);
      return `<span class="hm-chip" title="${e ? escapeHtml(e.name) : ''} ${sh.start}–${sh.end}">${empInitials(e ? e.name : '?')}</span>`;
    }).join('');
    html += `<div class="hm-day${inMonth ? '' : ' hm-out'}${iso === today ? ' hm-today' : ''}" data-date="${iso}">
      <span class="hm-num">${cd.getDate()}</span>
      <div class="hm-chips">${chips}</div>
      ${total ? `<span class="hm-total">${fmtDur(total)}</span>` : ''}
    </div>`;
    if (i >= 34 && cd.getMonth() !== month && new Date(isoAddDays(startMon, i - 6) + 'T12:00:00').getMonth() !== month) {
      // évite d'afficher une 6e semaine entièrement hors mois
    }
  }
  html += '</div></div>';

  const body = document.getElementById('horaires-body');
  body.innerHTML = html;
  body.querySelectorAll('.hm-day').forEach(c => c.addEventListener('click', () => {
    horairesAnchor = c.dataset.date;
    horairesView = 'week';
    LS.set('pos_horaires_view', 'week');
    renderHoraires();
  }));
}

// ── Navigation horaires ──
function horairesShift(dir) {
  horairesAnchor = horairesView === 'week'
    ? isoAddDays(horairesAnchor, 7 * dir)
    : (() => { const d = new Date(horairesAnchor + 'T12:00:00'); d.setMonth(d.getMonth() + dir); return d.toISOString().slice(0, 10); })();
  renderHoraires();
}
document.getElementById('horaires-prev').addEventListener('click', () => horairesShift(-1));
document.getElementById('horaires-next').addEventListener('click', () => horairesShift(1));
document.getElementById('horaires-today').addEventListener('click', () => { horairesAnchor = todayISO(); renderHoraires(); });
document.querySelectorAll('.horaires-view').forEach(b => b.addEventListener('click', () => {
  horairesView = b.dataset.view;
  LS.set('pos_horaires_view', horairesView);
  renderHoraires();
}));
document.getElementById('horaires-manage').addEventListener('click', openEmployeeModal);
document.getElementById('horaires-print').addEventListener('click', () => window.print());

// ── Modal créneau (shift) ──
let shiftCtx = null; // { date, empId }
function openShiftModal(dateISO, empId) {
  const e = employeeById(empId);
  if (!e) return;
  shiftCtx = { date: dateISO, empId };
  const existing = shiftFor(dateISO, empId);
  const dLabel = new Date(dateISO + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('shift-title').textContent = e.name;
  document.getElementById('shift-sub').textContent = dLabel;
  document.getElementById('shift-start').value = existing ? existing.start : DEFAULT_SHIFT.start;
  document.getElementById('shift-end').value   = existing ? existing.end   : DEFAULT_SHIFT.end;
  document.getElementById('btn-shift-delete').style.display = existing ? '' : 'none';
  updateShiftDur();
  document.getElementById('modal-shift').classList.add('open');
}
function closeShiftModal() { document.getElementById('modal-shift').classList.remove('open'); shiftCtx = null; }
function updateShiftDur() {
  const min = shiftMinutes({ start: document.getElementById('shift-start').value, end: document.getElementById('shift-end').value });
  document.getElementById('shift-dur').textContent = min ? `Durée : ${fmtDur(min)}` : '⚠ Fin avant début';
}
document.getElementById('shift-start').addEventListener('input', updateShiftDur);
document.getElementById('shift-end').addEventListener('input', updateShiftDur);
document.getElementById('btn-shift-cancel').addEventListener('click', closeShiftModal);
document.getElementById('btn-shift-delete').addEventListener('click', () => {
  if (!shiftCtx) return;
  setShift(shiftCtx.date, shiftCtx.empId, null);
  closeShiftModal();
  renderHoraires();
});
document.getElementById('btn-shift-save').addEventListener('click', () => {
  if (!shiftCtx) return;
  const start = document.getElementById('shift-start').value;
  const end   = document.getElementById('shift-end').value;
  if (!start || !end) { showToast('Renseignez début et fin.'); return; }
  if (shiftMinutes({ start, end }) <= 0) { showToast('La fin doit être après le début.'); return; }
  setShift(shiftCtx.date, shiftCtx.empId, { start, end });
  closeShiftModal();
  renderHoraires();
});
document.getElementById('modal-shift').addEventListener('click', e => {
  if (e.target.id === 'modal-shift') closeShiftModal();
});

// Entrées du menu ☰
document.getElementById('menu-employees').addEventListener('click', () => { closeMenu(); openEmployeeModal(); });
document.getElementById('menu-horaires').addEventListener('click', () => {
  closeMenu();
  document.querySelector('.tab-btn[data-tab="horaires"]').click();
});

// ══════════════════ REPORTING ═════════════════════════════════════════════════

const reportStart = document.getElementById('report-start');
const reportEnd   = document.getElementById('report-end');
reportStart.value = todayISO();
reportEnd.value   = todayISO();

document.getElementById('btn-generate-report').addEventListener('click', renderReporting);

// Source des données pour rapports & tableau de bord.
// reportTransactions = snapshot chargé depuis Google Sheets (historique, tous appareils).
// On le FUSIONNE toujours avec les ventes locales (qui contiennent le jour même,
// même pas encore synchronisées) — les locales priment en cas d'ID identique.
let reportTransactions = null;
function reportSource() {
  const local = getTransactions();
  if (!reportTransactions) return local;
  const byId = {};
  reportTransactions.forEach(t => { byId[t.id] = t; });
  local.forEach(t => { byId[t.id] = t; });
  return Object.values(byId);
}

function txsForRange(start, end) {
  return reportSource().filter(t => {
    const d = t.date.slice(0, 10);
    return !t.cancelled && d >= start && d <= end;
  });
}

let reportLoadedAt = 0;
let reportLoading  = false;

// Re-rend l'onglet actif (reporting ou tableau) après un chargement.
function rerenderActive() {
  const active = document.querySelector('.tab-btn.active');
  const t = active ? active.dataset.tab : '';
  if (t === 'reporting') renderReporting();
  else if (t === 'dashboard') renderDashboard();
  else if (t === 'memo') renderMemo();
}

// Charge automatiquement depuis Sheets si pas fait récemment (< 3 min).
function autoLoadSheets() {
  if (reportLoading) return;
  if (reportTransactions && Date.now() - reportLoadedAt < 180000) return;
  loadFromSheets({ auto: true });
}

// Charge TOUTES les ventes depuis Google Sheets (via JSONP, sans souci de CORS).
function loadFromSheets(opts) {
  opts = opts || {};
  const btn = document.getElementById('btn-load-sheets');
  const src = document.getElementById('report-source');
  // Mode formation sans backend de test configuré : on reste sur les ventes locales.
  if (!sheetsUrl()) {
    src.textContent = 'Source : cet appareil (mode formation local)';
    rerenderActive();
    return;
  }
  const firstLoad = !reportTransactions;
  const cbName = '__sheetsCb' + Date.now();
  let script;
  reportLoading = true;
  const cleanup = () => { try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
    if (script) script.remove(); btn.disabled = false; reportLoading = false; clearTimeout(timer); };
  const fail = msg => {
    cleanup();
    src.textContent = reportTransactions ? src.textContent : 'Source : cet appareil (hors-ligne)';
    if (!opts.auto) showToast(msg);   // silencieux en mode auto
  };
  const timer = setTimeout(() => fail('Délai dépassé — Google Sheets injoignable.'), 20000);

  btn.disabled = true;
  src.textContent = 'Chargement depuis Google Sheets…';
  window[cbName] = data => {
    cleanup();
    if (!data || !data.ok || !Array.isArray(data.transactions)) { fail('Réponse invalide de Google Sheets.'); return; }
    reportTransactions = data.transactions;
    reportLoadedAt = Date.now();
    // Ne cadre les dates du rapport sur tout l'historique qu'au tout premier chargement.
    if (firstLoad) {
      const days = data.transactions.map(t => t.date.slice(0, 10)).sort();
      if (days.length) { reportStart.value = days[0]; reportEnd.value = days[days.length - 1]; }
    }
    const n = data.transactions.length, mot = 'vente' + (n > 1 ? 's' : '');
    src.textContent = `Source : Google Sheets · ${n} ${mot}`;
    rerenderActive();
    if (!opts.auto) showToast(`☁️ ${n} ${mot} chargée${n > 1 ? 's' : ''} depuis Google Sheets.`);
  };
  script = document.createElement('script');
  script.src = sheetsUrl() + '?action=transactions&callback=' + cbName + '&t=' + Date.now();
  script.onerror = () => fail('Échec du chargement depuis Google Sheets (réseau ?).');
  document.body.appendChild(script);
}
document.getElementById('btn-load-sheets').addEventListener('click', () => loadFromSheets());

function renderReporting() {
  const start = reportStart.value || todayISO();
  const end   = reportEnd.value   || todayISO();
  const txs   = txsForRange(start, end);

  renderFinancier(txs, start, end);
  renderTopArticles(txs, true);
  renderTopArticles(txs, false);
  renderPaiements(txs);
  renderCaJour(txs);
  renderArticlesParJour(txs);
  renderTopParCategorie(txs);
  renderAttachement(txs);
  renderTicketsReport(txs);
  renderPanierMoyen(txs);
  renderCaCategorie(txs);
  renderPicVente(txs);
  renderCaEmplacement(txs);
  renderRecommandations(txs);
}

function renderCaCategorie(txs) {
  const el = document.getElementById('report-ca-categorie');
  if (!txs.length) { el.innerHTML = '<p class="empty-msg">Aucune donnée</p>'; return; }
  const qty = {}, ca = {};
  txs.forEach(tx => tx.lines.forEach(l => {
    const c = l.category || '—';
    qty[c] = (qty[c] || 0) + l.qty;
    ca[c]  = (ca[c]  || 0) + l.subtotal;
  }));
  const total = Object.values(ca).reduce((a, b) => a + b, 0) || 1;
  const rows  = Object.entries(ca).sort((a, b) => b[1] - a[1]);
  el.innerHTML = `
    <table class="report-table">
      <thead><tr><th>Catégorie</th><th>Qté</th><th>CA</th><th>Part</th><th>Prix moy.</th></tr></thead>
      <tbody>${rows.map(([c, v]) => `
        <tr>
          <td>${c}</td>
          <td>${qty[c]}</td>
          <td style="font-weight:700">${fmtEur(v)}</td>
          <td>${Math.round(v / total * 100)}%</td>
          <td>${fmtEur(v / qty[c])}</td>
        </tr>`).join('')}</tbody>
    </table>
  `;
}

function renderPicVente(txs) {
  const el = document.getElementById('report-pic-vente');
  if (!txs.length) { el.innerHTML = '<p class="empty-msg">Aucune donnée</p>'; return; }
  const byHour = {};
  txs.forEach(tx => {
    const h = String(new Date(tx.date).getHours()).padStart(2, '0');
    if (!byHour[h]) byHour[h] = { tickets: 0, articles: 0, ca: 0 };
    byHour[h].tickets++;
    byHour[h].articles += tx.lines.reduce((s, l) => s + l.qty, 0);
    byHour[h].ca += tx.total;
  });
  const hours = Object.keys(byHour).sort();
  const peakCA = Math.max(...hours.map(h => byHour[h].ca));
  el.innerHTML = `
    <table class="report-table">
      <thead><tr><th>Heure</th><th>Tickets</th><th>Articles</th><th>CA</th><th>Ticket moy.</th></tr></thead>
      <tbody>${hours.map(h => {
        const v = byHour[h];
        const peak = v.ca === peakCA;
        return `
        <tr${peak ? ' class="row-peak"' : ''}>
          <td>${peak ? '🔥 ' : ''}${h}h</td>
          <td>${v.tickets}</td>
          <td>${v.articles}</td>
          <td style="font-weight:700">${fmtEur(v.ca)}</td>
          <td>${fmtEur(v.ca / v.tickets)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  `;
}

const JOURS_SEM = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];

// Génère les mêmes insights que l'email du lundi, sur la période choisie.
// Retourne un tableau de chaînes : '━━━' = section, '👉' = astuce.
function buildInsights(txs) {
  const artCA={}, artQty={}, catCA={}, heureCA={}, jourCA={}, jourNb={};
  let nbEsp=0, nbCarte=0, caEsp=0, caCarte=0;
  const A=(m,k,n)=>{ m[k]=(m[k]||0)+n; };

  txs.forEach(tx => {
    const h = String(new Date(tx.date).getHours()).padStart(2,'0');
    A(heureCA, h, tx.total);
    const j = JOURS_SEM[new Date(tx.date).getDay()];
    A(jourCA, j, tx.total); A(jourNb, j, 1);
    if (tx.method === 'especes') { nbEsp++; caEsp += tx.total; } else { nbCarte++; caCarte += tx.total; }
    tx.lines.forEach(l => { A(artCA,l.name,l.subtotal); A(artQty,l.name,l.qty); A(catCA,l.category||'—',l.subtotal); });
  });

  const totalCA   = Object.values(artCA).reduce((a,b)=>a+b,0);
  const nbTx      = txs.length;
  const ticketMoy = nbTx ? totalCA/nbTx : 0;
  const sortD = o => Object.entries(o).sort((a,b)=>b[1]-a[1]);
  const topArts=sortD(artCA), topHeure=sortD(heureCA), topJour=sortD(jourCA), topCat=sortD(catCA);
  // « À surveiller » : on exclut les articles offerts (0 €)
  const flopArts = topArts.filter(e => !/\(offert/i.test(e[0]));

  const f   = fmtEur;
  const pct = (a,b)=> b ? Math.round(a/b*100)+'%' : '—';
  const g   = (arr,i)=> arr[i] ? arr[i][0] : '—';
  const gv  = (arr,i)=> arr[i] ? arr[i][1] : 0;

  return [
    '━━━ 🏆 Articles : ce qui marche',
    `✅ Top 1 : ${g(topArts,0)} → ${f(gv(topArts,0))} (${pct(gv(topArts,0),totalCA)} du CA)`,
    `✅ Top 2 : ${g(topArts,1)} → ${f(gv(topArts,1))}`,
    `✅ Top 3 : ${g(topArts,2)} → ${f(gv(topArts,2))}`,
    `👉 Mets ces 3 articles en avant dans ta communication (Instagram, ardoise, bouche-à-oreille).`,
    '━━━ 📉 Articles à surveiller',
    `⚠️ Moins vendu : ${g(flopArts,flopArts.length-1)} → ${f(gv(flopArts,flopArts.length-1))} (${artQty[g(flopArts,flopArts.length-1)]||0} vendus)`,
    `⚠️ 2e moins vendu : ${g(flopArts,flopArts.length-2)} → ${f(gv(flopArts,flopArts.length-2))}`,
    `👉 Envisage de les retirer ou de les proposer en "offre du jour".`,
    '━━━ 🍕 Catégories',
    ...topCat.map(([cat,ca],i)=>`${i===0?'🥇':i===1?'🥈':'🥉'} ${cat} → ${f(ca)} (${pct(ca,totalCA)})`),
    `👉 Les suppléments = ${pct((catCA['Supp']||0)+(catCA['Suppléments']||0),totalCA)} du CA — propose-les systématiquement ("Vous voulez un supplément fromage ?").`,
    '━━━ ⏰ Heures de pointe',
    `🔥 Heure la plus chargée : ${g(topHeure,0)}h → ${f(gv(topHeure,0))}`,
    `🔥 2e heure : ${g(topHeure,1)}h → ${f(gv(topHeure,1))}`,
    `😴 Heure creuse : ${g(topHeure,topHeure.length-1)}h → ${f(gv(topHeure,topHeure.length-1))}`,
    `👉 Prépare ta mise en place 30 min avant ${g(topHeure,0)}h.`,
    '━━━ 📆 Jours de la semaine',
    `📈 Meilleur jour : ${g(topJour,0)} → ${f(gv(topJour,0))} (${jourNb[g(topJour,0)]||0} tickets)`,
    `📉 Jour le plus calme : ${g(topJour,topJour.length-1)} → ${f(gv(topJour,topJour.length-1))}`,
    `👉 Concentre tes posts Instagram la veille de ton ${g(topJour,0)}.`,
    '━━━ 💳 Paiements',
    `💶 Espèces : ${nbEsp} tickets (${pct(nbEsp,nbTx)}) → ${f(caEsp)}`,
    `💳 Carte : ${nbCarte} tickets (${pct(nbCarte,nbTx)}) → ${f(caCarte)}`,
    `👉 ${nbTx && nbCarte/nbTx>0.6 ? 'La carte domine — garde ton terminal chargé et fonctionnel.' : 'Beaucoup d\'espèces — prévois assez de monnaie en début de service.'}`,
    '━━━ 💰 Panier moyen',
    `📊 Ticket moyen : ${f(ticketMoy)}`,
    `👉 Pour atteindre ${f(ticketMoy*1.15)} (+15%) : propose un dessert ou un supplément à chaque commande.`,
    `👉 Upselling : convertir 1 client sur 3 vers un dessert (${f(4)}) = +${f(nbTx/3*4)} de CA sur la période.`,
    '━━━ 📱 Communication',
    `👉 Ton article star est "${g(topArts,0)}" — publie une belle photo sur Instagram.`,
    `👉 Ton meilleur jour est ${g(topJour,0)} — programme tes stories la veille.`,
    `👉 Fidélisation : envisage une carte de fidélité (ex. 10e pizza offerte).`,
  ];
}

function renderRecommandations(txs) {
  const el = document.getElementById('report-recommandations');
  if (!txs.length) { el.innerHTML = '<p class="empty-msg">Aucune donnée</p>'; return; }
  el.innerHTML = buildInsights(txs).map(line => {
    if (line.startsWith('━━━')) return `<div class="reco-section">${line.replace(/━/g,'').trim()}</div>`;
    if (line.startsWith('👉'))  return `<div class="reco-tip">${line}</div>`;
    return `<div class="reco-fact">${line}</div>`;
  }).join('');
}

function renderFinancier(txs, start, end) {
  const total = txs.reduce((s, t) => s + t.total, 0);
  const avg   = txs.length ? total / txs.length : 0;
  const max   = txs.length ? Math.max(...txs.map(t => t.total)) : 0;
  const min   = txs.length ? Math.min(...txs.map(t => t.total)) : 0;
  const days  = new Set(txs.map(t => t.date.slice(0, 10))).size || 1;
  document.getElementById('report-financier').innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><strong>${fmtEur(total)}</strong>CA total</div>
      <div class="kpi"><strong>${txs.length}</strong>Tickets</div>
      <div class="kpi"><strong>${fmtEur(avg)}</strong>Panier moyen</div>
      <div class="kpi"><strong>${fmtEur(total / days)}</strong>CA/jour moy.</div>
      <div class="kpi"><strong>${fmtEur(max)}</strong>Ticket max</div>
      <div class="kpi"><strong>${fmtEur(min)}</strong>Ticket min</div>
    </div>
  `;
}

function articleStats(txs) {
  const map = {};
  txs.forEach(tx => {
    tx.lines.forEach(l => {
      if (!map[l.id]) map[l.id] = { name: l.name, emoji: l.emoji, qty: 0, revenue: 0 };
      map[l.id].qty     += l.qty;
      map[l.id].revenue += l.subtotal;
    });
  });
  return Object.values(map).sort((a, b) => b.qty - a.qty);
}

function renderTopArticles(txs, top) {
  const stats = articleStats(txs);
  const list  = top ? stats.slice(0, 8) : stats.slice(-8).reverse();
  const elId  = top ? 'report-top-articles' : 'report-bottom-articles';
  if (!stats.length) { document.getElementById(elId).innerHTML = '<p class="empty-msg">Aucune donnée</p>'; return; }
  document.getElementById(elId).innerHTML = `
    <table class="report-table">
      <thead><tr><th>Article</th><th>Qté</th><th>CA</th></tr></thead>
      <tbody>${list.map(a => `
        <tr>
          <td>${emojiFor(a)}${a.name}</td>
          <td>${a.qty}</td>
          <td>${fmtEur(a.revenue)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  `;
}

function renderPaiements(txs) {
  const byMethod = { especes: 0, carte: 0 };
  txs.forEach(t => { byMethod[t.method] = (byMethod[t.method] || 0) + t.total; });
  const total = Object.values(byMethod).reduce((s, v) => s + v, 0) || 1;
  const pct = m => Math.round((byMethod[m] / total) * 100);
  document.getElementById('report-paiements').innerHTML = `
    <div class="pay-bar">
      ${['especes', 'carte'].map(m => `
        <div class="pay-bar-row">
          <span class="pay-bar-label">${{especes:'💶 Espèces', carte:'💳 Carte'}[m]}</span>
          <div class="pay-bar-track"><div class="pay-bar-fill fill-${m}" style="width:${pct(m)}%"></div></div>
          <span class="pay-bar-pct">${pct(m)}%</span>
        </div>
      `).join('')}
    </div>
    <table class="report-table" style="margin-top:.5rem">
      <thead><tr><th>Mode</th><th>Montant</th><th>Tickets</th></tr></thead>
      <tbody>
        ${['especes', 'carte'].map(m => `
          <tr>
            <td>${{especes:'💶 Espèces', carte:'💳 Carte'}[m]}</td>
            <td>${fmtEur(byMethod[m])}</td>
            <td>${txs.filter(t => t.method === m).length}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderCaJour(txs) {
  const byDay = {};
  txs.forEach(t => {
    const d = t.date.slice(0, 10);
    byDay[d] = (byDay[d] || 0) + t.total;
  });
  const days = Object.keys(byDay).sort();
  document.getElementById('report-ca-jour').innerHTML = days.length ? `
    <table class="report-table">
      <thead><tr><th>Jour</th><th>CA</th><th>Tickets</th></tr></thead>
      <tbody>${days.map(d => `
        <tr>
          <td>${fmtDate(d)}</td>
          <td>${fmtEur(byDay[d])}</td>
          <td>${txs.filter(t => t.date.slice(0,10) === d).length}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  ` : '<p class="empty-msg">Aucune donnée</p>';
}

function renderArticlesParJour(txs) {
  const el = document.getElementById('report-articles-jour');
  if (!el) return;
  if (!txs.length) { el.innerHTML = '<p class="empty-msg">Aucune donnée</p>'; return; }
  const byDay = {};
  txs.forEach(t => {
    const d = t.date.slice(0, 10);
    byDay[d] = (byDay[d] || 0) + t.lines.reduce((s, l) => s + l.qty, 0);
  });
  const days = Object.keys(byDay).sort().reverse();
  const total = days.reduce((s, d) => s + byDay[d], 0);
  el.innerHTML = `
    <table class="report-table">
      <thead><tr><th>Jour</th><th>Nb articles vendus</th></tr></thead>
      <tbody>${days.map(d => `<tr><td>${fmtDate(d)}</td><td style="font-weight:700">${byDay[d]}</td></tr>`).join('')}
        <tr style="background:var(--olive-bg)"><td style="font-weight:700">TOTAL</td><td style="font-weight:700">${total}</td></tr>
      </tbody>
    </table>`;
}

// Article le plus vendu (en quantité) dans chaque catégorie.
function topParCategorie(txs) {
  const byCat = {}; // cat -> { art -> {qty, ca} }
  txs.forEach(t => t.lines.forEach(l => {
    const cat = l.category || '—';
    (byCat[cat] = byCat[cat] || {});
    (byCat[cat][l.name] = byCat[cat][l.name] || { qty: 0, ca: 0 });
    byCat[cat][l.name].qty += l.qty;
    byCat[cat][l.name].ca  += l.subtotal;
  }));
  return Object.entries(byCat).map(([cat, arts]) => {
    const [name, v] = Object.entries(arts).sort((a, b) => b[1].qty - a[1].qty)[0];
    return { cat, name, qty: v.qty, ca: v.ca };
  }).sort((a, b) => b.qty - a.qty);
}

function renderTopParCategorie(txs) {
  const el = document.getElementById('report-top-categorie');
  if (!el) return;
  if (!txs.length) { el.innerHTML = '<p class="empty-msg">Aucune donnée</p>'; return; }
  const rows = topParCategorie(txs);
  el.innerHTML = `
    <table class="report-table">
      <thead><tr><th>Catégorie</th><th>Article star</th><th>Qté</th><th>CA</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr><td>${r.cat}</td><td style="font-weight:600">${emojiFor({name:r.name})}${r.name}</td>
        <td>${r.qty}</td><td>${fmtEur(r.ca)}</td></tr>`).join('')}
      </tbody>
    </table>`;
}

// Taux d'attachement : part des ventes contenant boisson / dessert / supplément.
function attachementStats(txs) {
  const defs = [
    { label: '🥤 Boissons',    re: /boisson/i },
    { label: '🍮 Desserts',    re: /dessert/i },
    { label: '🧀 Suppléments', re: /supp/i },
  ];
  return defs.map(d => {
    const n = txs.filter(t => t.lines.some(l => d.re.test(l.category || ''))).length;
    const pct = txs.length ? Math.round(n / txs.length * 100) : 0;
    const oneIn = n ? (txs.length / n) : null; // « 1 client sur X »
    return { label: d.label, n, pct, oneIn };
  });
}

function renderAttachement(txs) {
  const el = document.getElementById('report-attachement');
  if (!el) return;
  if (!txs.length) { el.innerHTML = '<p class="empty-msg">Aucune donnée</p>'; return; }
  const stats = attachementStats(txs);
  const colors = ['#2b7a9e', '#76894F', '#b04a1a'];
  el.innerHTML = `
    <div class="pay-bar">
      ${stats.map((s, i) => `
        <div class="pay-bar-row">
          <span class="pay-bar-label">${s.label}</span>
          <div class="pay-bar-track"><div class="pay-bar-fill" style="width:${s.pct}%;background:${colors[i]}"></div></div>
          <span class="pay-bar-pct">${s.pct}%</span>
        </div>`).join('')}
    </div>
    <table class="report-table" style="margin-top:.5rem">
      <thead><tr><th>Catégorie</th><th>Ventes avec</th><th>Taux</th><th>En moyenne</th></tr></thead>
      <tbody>${stats.map(s => `
        <tr><td>${s.label}</td><td>${s.n} / ${txs.length}</td>
        <td style="font-weight:700">${s.pct}%</td>
        <td>${s.oneIn ? '1 client sur ' + (Math.round(s.oneIn * 10) / 10).toLocaleString('fr-FR') : '—'}</td></tr>`).join('')}
      </tbody>
    </table>`;
}

function renderTicketsReport(txs) {
  document.getElementById('report-tickets').innerHTML = txs.length ? `
    <table class="report-table">
      <thead><tr><th>Heure</th><th>Articles</th><th>Mode</th><th>Total</th></tr></thead>
      <tbody>${txs.slice().reverse().map(tx => `
        <tr>
          <td>${fmtDate(tx.date.slice(0,10))}<br><small>${fmtTime(tx.date)}</small></td>
          <td style="font-size:.75rem">${tx.lines.map(l=>`${l.name} ×${l.qty}`).join(', ')}</td>
          <td>${tx.method}</td>
          <td style="font-weight:700">${fmtEur(tx.total)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  ` : '<p class="empty-msg">Aucune donnée</p>';
}

function renderPanierMoyen(txs) {
  const el = document.getElementById('report-panier-moyen');
  if (!txs.length) { el.innerHTML = '<p class="empty-msg">Aucune donnée</p>'; return; }

  // Panier moyen global
  const total  = txs.reduce((s, t) => s + t.total, 0);
  const avg    = total / txs.length;

  // Panier moyen par tranche horaire (matin / midi / après-midi / soir)
  const tranches = { 'Matin (8h–12h)': [], 'Midi (12h–14h)': [], 'Après-midi (14h–18h)': [], 'Soir (18h–23h)': [] };
  txs.forEach(tx => {
    const h = new Date(tx.date).getHours();
    if      (h >= 8  && h < 12) tranches['Matin (8h–12h)'].push(tx.total);
    else if (h >= 12 && h < 14) tranches['Midi (12h–14h)'].push(tx.total);
    else if (h >= 14 && h < 18) tranches['Après-midi (14h–18h)'].push(tx.total);
    else if (h >= 18 && h < 23) tranches['Soir (18h–23h)'].push(tx.total);
  });

  // Panier moyen par nb articles
  const bySize = {};
  txs.forEach(tx => {
    const nb = tx.lines.reduce((s, l) => s + l.qty, 0);
    const key = nb === 1 ? '1 article' : nb <= 3 ? '2–3 articles' : '4+ articles';
    if (!bySize[key]) bySize[key] = { sum: 0, n: 0 };
    bySize[key].sum += tx.total; bySize[key].n++;
  });

  el.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:.8rem">
      <div class="kpi"><strong>${fmtEur(avg)}</strong>Panier moyen global</div>
      <div class="kpi"><strong>${txs.length}</strong>Tickets</div>
      <div class="kpi"><strong>${fmtEur(Math.max(...txs.map(t=>t.total)))}</strong>Ticket max</div>
      <div class="kpi"><strong>${fmtEur(Math.min(...txs.map(t=>t.total)))}</strong>Ticket min</div>
    </div>
    <table class="report-table">
      <thead><tr><th>Tranche horaire</th><th>Panier moy.</th><th>Tickets</th></tr></thead>
      <tbody>${Object.entries(tranches).filter(([,v])=>v.length).map(([k,v])=>`
        <tr><td>${k}</td><td>${fmtEur(v.reduce((s,x)=>s+x,0)/v.length)}</td><td>${v.length}</td></tr>
      `).join('')}</tbody>
    </table>
    <table class="report-table" style="margin-top:.5rem">
      <thead><tr><th>Taille commande</th><th>Panier moy.</th><th>Tickets</th></tr></thead>
      <tbody>${Object.entries(bySize).map(([k,v])=>`
        <tr><td>${k}</td><td>${fmtEur(v.sum/v.n)}</td><td>${v.n}</td></tr>
      `).join('')}</tbody>
    </table>
  `;
}

function renderCaEmplacement(txs) {
  const el = document.getElementById('report-ca-emplacement');
  if (!txs.length) { el.innerHTML = '<p class="empty-msg">Aucune donnée</p>'; return; }

  const byLoc = {};
  txs.forEach(tx => {
    const loc = tx.location || '(non défini)';
    if (!byLoc[loc]) byLoc[loc] = { total: 0, n: 0, days: new Set() };
    byLoc[loc].total += tx.total;
    byLoc[loc].n++;
    byLoc[loc].days.add(tx.date.slice(0, 10));
  });

  const rows = Object.entries(byLoc).sort((a, b) => b[1].total - a[1].total);
  const grandTotal = rows.reduce((s, [, v]) => s + v.total, 0);

  el.innerHTML = `
    <table class="report-table">
      <thead><tr><th>Emplacement</th><th>CA</th><th>Part</th><th>Tickets</th><th>Jours</th><th>Moy/j</th></tr></thead>
      <tbody>${rows.map(([loc, v]) => `
        <tr>
          <td>📍 ${loc}</td>
          <td style="font-weight:700">${fmtEur(v.total)}</td>
          <td>${Math.round(v.total / grandTotal * 100)}%</td>
          <td>${v.n}</td>
          <td>${v.days.size}</td>
          <td>${fmtEur(v.total / v.days.size)}</td>
        </tr>
      `).join('')}</tbody>
    </table>
  `;
}

// ── Export CSV generic ────────────────────────────────────────────────────────
document.querySelectorAll('.btn-export').forEach(btn => {
  btn.addEventListener('click', () => exportReport(btn.dataset.report));
});

function exportReport(type) {
  const start = reportStart.value || todayISO();
  const end   = reportEnd.value   || todayISO();
  const txs   = txsForRange(start, end);
  if (!txs.length) { showToast('Aucune donnée à exporter.'); return; }
  let rows;
  switch (type) {
    case 'financier': {
      const total = txs.reduce((s, t) => s + t.total, 0);
      rows = [['Indicateur', 'Valeur'],
        ['CA total', total.toFixed(2)],
        ['Tickets', txs.length],
        ['Panier moyen', (total / (txs.length || 1)).toFixed(2)],
        ['Ticket max', Math.max(...txs.map(t => t.total)).toFixed(2)],
        ['Ticket min', Math.min(...txs.map(t => t.total)).toFixed(2)],
      ]; break;
    }
    case 'top-articles':
    case 'bottom-articles': {
      const stats = articleStats(txs);
      const list  = type === 'top-articles' ? stats.slice(0, 8) : stats.slice(-8).reverse();
      rows = [['Article', 'Quantité', 'CA (€)'], ...list.map(a => [a.name, a.qty, a.revenue.toFixed(2)])];
      break;
    }
    case 'paiements': {
      const byM = { especes: 0, carte: 0 };
      txs.forEach(t => { byM[t.method] = (byM[t.method] || 0) + t.total; });
      rows = [['Mode', 'Montant', 'Tickets'],
        ...Object.entries(byM).map(([m, v]) => [m, v.toFixed(2), txs.filter(t => t.method === m).length])];
      break;
    }
    case 'ca-jour': {
      const byDay = {};
      txs.forEach(t => { const d = t.date.slice(0,10); byDay[d] = (byDay[d]||0) + t.total; });
      rows = [['Jour', 'CA (€)', 'Tickets'],
        ...Object.entries(byDay).sort().map(([d, v]) => [d, v.toFixed(2), txs.filter(t=>t.date.slice(0,10)===d).length])];
      break;
    }
    case 'articles-jour': {
      const byDay = {};
      txs.forEach(t => { const d = t.date.slice(0,10); byDay[d] = (byDay[d]||0) + t.lines.reduce((s,l)=>s+l.qty,0); });
      const entries = Object.entries(byDay).sort();
      rows = [['Jour', 'Nb articles vendus'], ...entries.map(([d, v]) => [d, v]),
        ['TOTAL', entries.reduce((s, [,v]) => s + v, 0)]];
      break;
    }
    case 'top-categorie': {
      rows = [['Catégorie', 'Article star', 'Qté', 'CA (€)'],
        ...topParCategorie(txs).map(r => [r.cat, r.name, r.qty, r.ca.toFixed(2)])];
      break;
    }
    case 'attachement': {
      rows = [['Catégorie', 'Ventes avec', 'Ventes totales', 'Taux (%)', 'En moyenne'],
        ...attachementStats(txs).map(s => [s.label.replace(/^\S+\s/, ''), s.n, txs.length, s.pct,
          s.oneIn ? '1 client sur ' + (Math.round(s.oneIn * 10) / 10) : '—'])];
      break;
    }
    case 'tickets': {
      rows = [['Date', 'Heure', 'Emplacement', 'Articles', 'Paiement', 'Total (€)'],
        ...txs.map(tx => [tx.date.slice(0,10), fmtTime(tx.date), tx.location || '',
          tx.lines.map(l=>`${l.name} x${l.qty}`).join(' | '), tx.method, tx.total.toFixed(2)])];
      break;
    }
    case 'panier-moyen': {
      const total = txs.reduce((s, t) => s + t.total, 0);
      rows = [['Indicateur', 'Valeur'],
        ['Panier moyen global', (total / (txs.length || 1)).toFixed(2)],
        ['Tickets', txs.length],
        ['Ticket max', Math.max(...txs.map(t=>t.total)).toFixed(2)],
        ['Ticket min', Math.min(...txs.map(t=>t.total)).toFixed(2)],
      ]; break;
    }
    case 'ca-emplacement': {
      const byLoc = {};
      txs.forEach(tx => {
        const loc = tx.location || '(non défini)';
        if (!byLoc[loc]) byLoc[loc] = { total: 0, n: 0, days: new Set() };
        byLoc[loc].total += tx.total; byLoc[loc].n++;
        byLoc[loc].days.add(tx.date.slice(0,10));
      });
      rows = [['Emplacement', 'CA (€)', 'Tickets', 'Jours', 'Moy/jour (€)'],
        ...Object.entries(byLoc).sort((a,b)=>b[1].total-a[1].total).map(([loc,v]) =>
          [loc, v.total.toFixed(2), v.n, v.days.size, (v.total/v.days.size).toFixed(2)])];
      break;
    }
    case 'ca-categorie': {
      const qty = {}, ca = {};
      txs.forEach(tx => tx.lines.forEach(l => {
        const c = l.category || '—';
        qty[c] = (qty[c]||0) + l.qty; ca[c] = (ca[c]||0) + l.subtotal;
      }));
      const tot = Object.values(ca).reduce((a,b)=>a+b,0) || 1;
      rows = [['Catégorie', 'Qté', 'CA (€)', 'Part (%)', 'Prix moyen (€)'],
        ...Object.entries(ca).sort((a,b)=>b[1]-a[1]).map(([c,v]) =>
          [c, qty[c], v.toFixed(2), Math.round(v/tot*100), (v/qty[c]).toFixed(2)])];
      break;
    }
    case 'pic-vente': {
      const byHour = {};
      txs.forEach(tx => {
        const h = String(new Date(tx.date).getHours()).padStart(2,'0');
        if (!byHour[h]) byHour[h] = { tickets:0, articles:0, ca:0 };
        byHour[h].tickets++;
        byHour[h].articles += tx.lines.reduce((s,l)=>s+l.qty,0);
        byHour[h].ca += tx.total;
      });
      rows = [['Heure', 'Tickets', 'Articles', 'CA (€)', 'Ticket moyen (€)'],
        ...Object.keys(byHour).sort().map(h => {
          const v = byHour[h];
          return [h+'h', v.tickets, v.articles, v.ca.toFixed(2), (v.ca/v.tickets).toFixed(2)];
        })];
      break;
    }
    case 'recommandations': {
      rows = [['Recommandations & insights'], ...buildInsights(txs).map(l => [l.replace(/━/g,'').trim()])];
      break;
    }
    default: return;
  }
  downloadCSV(`${type}_${start}_${end}.csv`, rows);
}

function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a    = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast('Export téléchargé : ' + filename);
}

// ── Toast ─────────────────────────────────────────────────────────────────────
document.addEventListener('pos:toast', e => showToast(e.detail));

let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ══════════════════════════════════════════
//  GOOGLE SHEETS — SYNCHRONISATION
// ══════════════════════════════════════════
// (URL de synchro : voir sheetsUrl() — bascule prod / test selon le mode formation)

// Indicateur visuel dans le header
const syncIndicator = (() => {
  const el = document.createElement('span');
  el.id = 'sync-indicator';
  el.style.cssText = 'font-size:.75rem;opacity:.75;white-space:nowrap;';
  document.querySelector('.header-info').prepend(el);
  return el;
})();

function setSyncStatus(state) {
  const map = { idle: '', syncing: '🔄 Sync...', ok: '✅ Sync OK', error: '⚠️ Hors ligne' };
  syncIndicator.textContent = map[state] ?? '';
}

// Marque une transaction comme synchronisée
function markSynced(ids) {
  const txs = getTransactions();
  ids.forEach(id => { const t = txs.find(t => t.id === id); if (t) t.synced = true; });
  saveTransactions(txs);
}

// Envoie les transactions non synchronisées à Google Sheets.
// Garde anti-doublon : un seul envoi à la fois (plusieurs déclencheurs peuvent
// se chevaucher — après-vente, retour réseau, relance périodique, avant-plan).
let isSyncing = false;
async function syncToSheets() {
  if (isSyncing) return;
  const pending = getTransactions().filter(t => !t.synced);
  if (!pending.length) { setSyncStatus('idle'); return; }
  // Mode formation sans backend de test : on garde les ventes en local, pas d'envoi.
  if (!sheetsUrl()) { setSyncStatus('idle'); return; }

  isSyncing = true;
  setSyncStatus('syncing');
  try {
    const res = await fetch(sheetsUrl(), {
      method: 'POST',
      body: JSON.stringify(pending),
    });
    const json = await res.json();
    if (json.ok) {
      markSynced(pending.map(t => t.id));
      setSyncStatus('ok');
      setTimeout(() => setSyncStatus('idle'), 3000);
    } else {
      setSyncStatus('error');
    }
  } catch {
    setSyncStatus('error');
  } finally {
    isSyncing = false;
  }
}

// Sync à l'ouverture et à la mise en arrière-plan/fermeture
document.addEventListener('visibilitychange', () => {
  syncToSheets();
});

// Sync dès que le réseau revient (WiFi retrouvé, sans recharger l'app)
window.addEventListener('online', () => {
  setSyncStatus('syncing');
  syncToSheets();
  if (cataloguePushPending) pushCatalogue();
  pullCatalogue();
});

// Filet de sécurité : relance périodique tant qu'il reste des ventes / un
// catalogue en attente. (L'événement « online » est peu fiable sur iOS Safari.)
setInterval(() => {
  if (getTransactions().some(t => !t.synced)) syncToSheets();
  if (cataloguePushPending) pushCatalogue();
}, 15000);

// Sync après chaque transaction validée
const _origAddTransaction = addTransaction;
window.addTransaction = function(tx) {
  _origAddTransaction(tx);
  syncToSheets();
};

// ── Init ──────────────────────────────────────────────────────────────────────
const _suppMerged = migrateCategories();   // renomme Suppléments->Supp, Pizzas grandes->Grande, etc.
renderCategories();
renderArticles();
renderTicketClient();
renderEmployeeBtn();  // affiche l'employé en poste (Clémence Bailly par défaut)
renderTestBanner();   // restaure la bannière si le mode formation était actif
updateTestMenuLabel();
renderMemo();
renderReporting();
syncToSheets();      // sync des ventes au démarrage
pullCatalogue();     // récupère le catalogue partagé au démarrage
pullTemperatures();  // récupère les relevés de température (comme les ventes)
if (_suppMerged) pushCatalogue();  // propage la fusion au cloud
