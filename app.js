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

// ── State ────────────────────────────────────────────────────────────────────
const CATALOGUE_VERSION = 2;
let articles = (LS.get('pos_catalogue_version', 0) < CATALOGUE_VERSION)
  ? (() => { const a = defaultArticles(); LS.set('pos_articles', a); LS.set('pos_catalogue_version', CATALOGUE_VERSION); return a; })()
  : LS.get('pos_articles', defaultArticles());
let ticket    = [];
let payMethod = 'especes';
let currentTx = null;

// ── Default catalogue (v2 — menu La Casetta) ─────────────────────────────────

function defaultArticles() {
  return [
    // Pizzas petites
    { id: uid(), name: 'Margherita (P)',        category: 'Pizzas petites', price: 7,    emoji: '🍕' },
    { id: uid(), name: 'Regina (P)',             category: 'Pizzas petites', price: 9,    emoji: '🍕' },
    { id: uid(), name: '4 Formaggi (P)',         category: 'Pizzas petites', price: 11,   emoji: '🧀' },
    { id: uid(), name: 'Piccante (P)',           category: 'Pizzas petites', price: 9,    emoji: '🌶️' },
    { id: uid(), name: 'Caprino (P)',            category: 'Pizzas petites', price: 11,   emoji: '🐐' },
    { id: uid(), name: 'Montarana (P)',          category: 'Pizzas petites', price: 11,   emoji: '🏔️' },
    { id: uid(), name: 'Italiana (P)',           category: 'Pizzas petites', price: 9,    emoji: '🍅' },
    { id: uid(), name: 'Cesare (P)',             category: 'Pizzas petites', price: 11,   emoji: '🍗' },
    { id: uid(), name: 'Sottobosco (P)',         category: 'Pizzas petites', price: 9,    emoji: '🍄' },
    { id: uid(), name: 'Sole in vista (P)',      category: 'Pizzas petites', price: 9,    emoji: '☀️' },
    { id: uid(), name: 'Carbonara (P)',          category: 'Pizzas petites', price: 9,    emoji: '🥓' },
    { id: uid(), name: 'Pollo e Gorgonzola (P)', category: 'Pizzas petites', price: 11,   emoji: '🍗' },
    // Pizzas grandes
    { id: uid(), name: 'Margherita (G)',        category: 'Pizzas grandes', price: 10,   emoji: '🍕' },
    { id: uid(), name: 'Regina (G)',             category: 'Pizzas grandes', price: 12,   emoji: '🍕' },
    { id: uid(), name: '4 Formaggi (G)',         category: 'Pizzas grandes', price: 14,   emoji: '🧀' },
    { id: uid(), name: 'Piccante (G)',           category: 'Pizzas grandes', price: 12,   emoji: '🌶️' },
    { id: uid(), name: 'Caprino (G)',            category: 'Pizzas grandes', price: 14,   emoji: '🐐' },
    { id: uid(), name: 'Montarana (G)',          category: 'Pizzas grandes', price: 14,   emoji: '🏔️' },
    { id: uid(), name: 'Italiana (G)',           category: 'Pizzas grandes', price: 12,   emoji: '🍅' },
    { id: uid(), name: 'Cesare (G)',             category: 'Pizzas grandes', price: 14,   emoji: '🍗' },
    { id: uid(), name: 'Sottobosco (G)',         category: 'Pizzas grandes', price: 12,   emoji: '🍄' },
    { id: uid(), name: 'Sole in vista (G)',      category: 'Pizzas grandes', price: 12,   emoji: '☀️' },
    { id: uid(), name: 'Carbonara (G)',          category: 'Pizzas grandes', price: 12,   emoji: '🥓' },
    { id: uid(), name: 'Pollo e Gorgonzola (G)', category: 'Pizzas grandes', price: 14,   emoji: '🍗' },
    // Suppléments
    { id: uid(), name: 'Jambon / Salsiccia / Guanciale / Poulet', category: 'Suppléments', price: 3,    emoji: '➕' },
    { id: uid(), name: 'Fromages',              category: 'Suppléments',    price: 2.5,  emoji: '🧀' },
    { id: uid(), name: 'Tomates confites / Poivrons rôtis',       category: 'Suppléments', price: 2,    emoji: '🍅' },
    { id: uid(), name: 'Champignons / Roquette / Pomme de terre / Olives', category: 'Suppléments', price: 1.5, emoji: '🥗' },
    { id: uid(), name: 'Sauces',                category: 'Suppléments',    price: 1,    emoji: '🥫' },
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
function getTransactions() { return LS.get('pos_transactions', []); }
function saveTransactions(txs) { LS.set('pos_transactions', txs); }

function addTransaction(tx) {
  const txs = getTransactions();
  txs.push(tx);
  saveTransactions(txs);
}

function cancelTransaction(id) {
  const txs = getTransactions();
  const t = txs.find(t => t.id === id);
  if (t) { t.cancelled = true; saveTransactions(txs); }
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'memo') renderMemo();
    if (btn.dataset.tab === 'reporting') renderReporting();
  });
});

// ── Date display ─────────────────────────────────────────────────────────────
function updateDateDisplay() {
  document.getElementById('date-display').textContent =
    new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
updateDateDisplay();
setInterval(updateDateDisplay, 60000);

// ══════════════════ CATALOGUE ══════════════════════════════════════════════════

let activeCategory = 'Tous';

function categories() {
  return ['Tous', ...new Set(articles.map(a => a.category))];
}

function renderCategories() {
  const el = document.getElementById('category-tabs');
  el.innerHTML = '';
  categories().forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-btn' + (cat === activeCategory ? ' active' : '');
    btn.textContent = cat;
    btn.addEventListener('click', () => { activeCategory = cat; renderCategories(); renderArticles(); });
    el.appendChild(btn);
  });
}

function renderArticles() {
  const grid = document.getElementById('articles-grid');
  grid.innerHTML = '';
  const list = activeCategory === 'Tous' ? articles : articles.filter(a => a.category === activeCategory);
  if (!list.length) {
    grid.innerHTML = '<p class="empty-msg">Aucun article</p>';
    return;
  }
  list.forEach(art => {
    const card = document.createElement('div');
    card.className = 'article-card';
    card.dataset.artId = art.id;
    card.innerHTML = `
      <span class="drag-handle">⠿</span>
      <button class="article-edit-btn" data-id="${art.id}" title="Modifier">✏️</button>
      <span class="article-emoji">${art.emoji}</span>
      <div class="article-name">${art.name}</div>
      <div class="article-price">${fmtEur(art.price)}</div>
    `;
    card.addEventListener('click', (e) => {
      if (editMode) return; // en mode édition, le clic n'ajoute pas au ticket
      if (e.target.closest('.article-edit-btn')) return;
      addToTicket(art);
    });
    card.querySelector('.article-edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (editMode) return;
      openArticleModal(art);
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

function toggleEditMode() {
  editMode = !editMode;
  const btn    = document.getElementById('btn-edit-mode');
  const grid   = document.getElementById('articles-grid');
  const banner = document.getElementById('edit-banner');
  btn.textContent = editMode ? '✅ Terminer' : '✏️ Éditer';
  btn.classList.toggle('active', editMode);
  grid.classList.toggle('edit-mode', editMode);
  banner.classList.toggle('visible', editMode);
  renderArticles();
}
document.getElementById('btn-edit-mode').addEventListener('click', toggleEditMode);

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
  LS.set('pos_articles', articles);
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
  if (line.qty <= 0) removeFromTicket(artId);
  else renderTicket();
}

function ticketTotal() {
  return ticket.reduce((s, l) => s + l.article.price * l.qty, 0);
}

function renderTicket() {
  const el = document.getElementById('ticket-lines');
  el.innerHTML = '';
  if (!ticket.length) {
    el.innerHTML = '<p class="empty-msg">Aucun article</p>';
  } else {
    ticket.forEach(line => {
      const div = document.createElement('div');
      div.className = 'ticket-line';
      div.innerHTML = `
        <span class="tl-name">${line.article.emoji} ${line.article.name}</span>
        <div class="tl-qty-controls">
          <button class="tl-qty-btn" data-id="${line.article.id}" data-delta="-1">−</button>
          <span class="tl-qty">${line.qty}</span>
          <button class="tl-qty-btn" data-id="${line.article.id}" data-delta="1">+</button>
        </div>
        <span class="tl-price">${fmtEur(line.article.price * line.qty)}</span>
        <button class="tl-remove" data-id="${line.article.id}">✕</button>
      `;
      el.appendChild(div);
    });
    el.querySelectorAll('.tl-qty-btn').forEach(btn => {
      btn.addEventListener('click', () => changeQty(btn.dataset.id, parseInt(btn.dataset.delta)));
    });
    el.querySelectorAll('.tl-remove').forEach(btn => {
      btn.addEventListener('click', () => removeFromTicket(btn.dataset.id));
    });
  }
  document.getElementById('ticket-total').textContent = fmtEur(ticketTotal());
  updateCashChange();
}

document.getElementById('btn-clear-ticket').addEventListener('click', () => {
  ticket = [];
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
  const tx = {
    id:        uid(),
    date:      new Date().toISOString(),
    location:  currentLocation || '',
    lines:     ticket.map(l => ({ ...l.article, qty: l.qty, subtotal: l.article.price * l.qty })),
    total,
    method:    payMethod,
    cancelled: false,
  };
  addTransaction(tx);
  ticket = [];
  document.getElementById('cash-given').value = '';
  renderTicket();
  showToast(`✔ Paiement de ${fmtEur(total)} enregistré (${payMethod}).`);
});

// ══════════════════ MODAL ARTICLE ═════════════════════════════════════════════

let editingArticleId = null;

function openArticleModal(art = null) {
  editingArticleId = art ? art.id : null;
  document.getElementById('modal-article-title').textContent = art ? 'Modifier l\'article' : 'Nouvel article';
  document.getElementById('art-name').value     = art?.name     ?? '';
  document.getElementById('art-category').value = art?.category ?? '';
  document.getElementById('art-price').value    = art?.price    ?? '';
  document.getElementById('art-emoji').value    = art?.emoji    ?? '🍕';
  document.getElementById('btn-modal-delete').style.display = art ? 'inline-flex' : 'none';
  document.getElementById('modal-article').classList.add('open');
}

document.getElementById('btn-add-article').addEventListener('click', () => openArticleModal());
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
  LS.set('pos_articles', articles);
  closeArticleModal();
  renderCategories();
  renderArticles();
  renderTicket();
  showToast('Article supprimé.');
});

document.getElementById('btn-modal-save').addEventListener('click', () => {
  const name     = document.getElementById('art-name').value.trim();
  const category = document.getElementById('art-category').value.trim();
  const price    = parseFloat(document.getElementById('art-price').value);
  const emoji    = document.getElementById('art-emoji').value.trim() || '🍕';
  if (!name || !category || isNaN(price)) { showToast('Remplissez tous les champs.'); return; }

  if (editingArticleId) {
    const art = articles.find(a => a.id === editingArticleId);
    if (art) { art.name = name; art.category = category; art.price = price; art.emoji = emoji; }
  } else {
    articles.push({ id: uid(), name, category, price, emoji });
  }
  LS.set('pos_articles', articles);
  closeArticleModal();
  renderCategories();
  renderArticles();
  showToast(editingArticleId ? 'Article modifié.' : 'Article ajouté.');
});

// ══════════════════ MÉMO ══════════════════════════════════════════════════════

const memoDateInput = document.getElementById('memo-date');
memoDateInput.value = todayISO();
memoDateInput.addEventListener('change', renderMemo);

function txsForDate(dateStr) {
  return getTransactions().filter(t => t.date.slice(0, 10) === dateStr);
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
    const linesStr = tx.lines.map(l => `${l.emoji} ${l.name} ×${l.qty}`).join(', ');
    const badge = tx.cancelled
      ? '<span class="badge-pay badge-annule">Annulé</span>'
      : `<span class="badge-pay badge-${tx.method}">${{especes:'💶 Espèces', carte:'💳 Carte'}[tx.method] ?? tx.method}</span>`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="${cls}">${txs.length - i}</td>
      <td class="${cls}">${fmtTime(tx.date)}</td>
      <td class="${cls}" style="max-width:260px;word-break:break-word">${linesStr}</td>
      <td>${badge}</td>
      <td class="${cls}" style="font-weight:700">${fmtEur(tx.total)}</td>
      <td>${tx.cancelled ? '' : `<button class="btn-cancel-tx" data-id="${tx.id}" title="Annuler">✕</button>`}</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-cancel-tx').forEach(btn => {
    btn.addEventListener('click', () => openCancelModal(btn.dataset.id));
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
  const rows = [['#', 'Date', 'Heure', 'Articles', 'Paiement', 'Montant', 'Statut']];
  txs.forEach((tx, i) => {
    rows.push([
      i + 1,
      date,
      fmtTime(tx.date),
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

// ══════════════════ REPORTING ═════════════════════════════════════════════════

const reportStart = document.getElementById('report-start');
const reportEnd   = document.getElementById('report-end');
reportStart.value = todayISO();
reportEnd.value   = todayISO();

document.getElementById('btn-generate-report').addEventListener('click', renderReporting);

function txsForRange(start, end) {
  return getTransactions().filter(t => {
    const d = t.date.slice(0, 10);
    return !t.cancelled && d >= start && d <= end;
  });
}

function renderReporting() {
  const start = reportStart.value || todayISO();
  const end   = reportEnd.value   || todayISO();
  const txs   = txsForRange(start, end);

  renderFinancier(txs, start, end);
  renderTopArticles(txs, true);
  renderTopArticles(txs, false);
  renderPaiements(txs);
  renderCaJour(txs);
  renderTicketsReport(txs);
  renderPanierMoyen(txs);
  renderCaEmplacement(txs);
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
          <td>${a.emoji} ${a.name}</td>
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
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxQ6zCiJDxxENG4taZldKFB1CI63ZNVvF6wA5r2gtpscwYvRXXWsqH7ZSuYgTuVlMawrw/exec';

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

// Envoie les transactions non synchronisées à Google Sheets
async function syncToSheets() {
  const pending = getTransactions().filter(t => !t.synced);
  if (!pending.length) { setSyncStatus('idle'); return; }

  setSyncStatus('syncing');
  try {
    const res = await fetch(SHEETS_URL, {
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
  }
}

// Sync à l'ouverture et à la mise en arrière-plan/fermeture
document.addEventListener('visibilitychange', () => {
  syncToSheets();
});

// Sync après chaque transaction validée
const _origAddTransaction = addTransaction;
window.addTransaction = function(tx) {
  _origAddTransaction(tx);
  syncToSheets();
};

// ── Init ──────────────────────────────────────────────────────────────────────
renderCategories();
renderArticles();
renderMemo();
renderReporting();
syncToSheets(); // sync au démarrage
