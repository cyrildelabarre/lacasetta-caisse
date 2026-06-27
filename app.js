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

  // Initialise le drag & drop sur la grille reconstruite
  initDragAndDrop(grid);
}

// ══════════════════ MODE ÉDITION / DRAG & DROP ════════════════════════════════

let editMode = false;

document.getElementById('btn-edit-mode').addEventListener('click', toggleEditMode);

function toggleEditMode() {
  editMode = !editMode;
  const btn    = document.getElementById('btn-edit-mode');
  const grid   = document.getElementById('articles-grid');
  const banner = document.getElementById('edit-banner');
  btn.textContent = editMode ? '✅ Terminer' : '✏️ Éditer';
  btn.classList.toggle('active', editMode);
  grid.classList.toggle('edit-mode', editMode);
  banner.classList.toggle('visible', editMode);
  renderArticles(); // re-render pour ajouter/enlever les poignées
}

function initDragAndDrop(grid) {
  let draggingEl   = null;
  let ghostEl      = null;
  let placeholder  = null;
  let startX = 0, startY = 0;
  let offsetX = 0, offsetY = 0;

  function getCardAt(x, y) {
    const els = grid.querySelectorAll('.article-card:not(.drag-placeholder)');
    for (const el of els) {
      if (el === draggingEl) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
    }
    return null;
  }

  function createGhost(card, x, y) {
    const r = card.getBoundingClientRect();
    ghostEl = document.createElement('div');
    ghostEl.className = 'drag-ghost';
    ghostEl.innerHTML = card.innerHTML;
    ghostEl.style.width  = r.width  + 'px';
    ghostEl.style.height = r.height + 'px';
    ghostEl.style.left   = r.left + 'px';
    ghostEl.style.top    = r.top  + 'px';
    document.body.appendChild(ghostEl);
    offsetX = x - r.left;
    offsetY = y - r.top;
  }

  function moveGhost(x, y) {
    if (!ghostEl) return;
    ghostEl.style.left = (x - offsetX) + 'px';
    ghostEl.style.top  = (y - offsetY) + 'px';
  }

  function createPlaceholder(ref) {
    if (placeholder) return;
    placeholder = document.createElement('div');
    placeholder.className = 'article-card drag-placeholder';
    placeholder.style.width  = ref.offsetWidth  + 'px';
    placeholder.style.height = ref.offsetHeight + 'px';
    ref.parentNode.insertBefore(placeholder, ref);
  }

  function cleanup() {
    if (ghostEl)      { ghostEl.remove(); ghostEl = null; }
    if (placeholder)  { placeholder.remove(); placeholder = null; }
    if (draggingEl)   { draggingEl.style.opacity = ''; draggingEl = null; }
  }

  function saveOrder() {
    const cards = [...grid.querySelectorAll('.article-card:not(.drag-placeholder)')];
    const ids   = cards.map(c => c.dataset.artId);
    const sorted = ids.map(id => articles.find(a => a.id === id)).filter(Boolean);
    // Conserve les articles qui ne sont pas affichés (autre catégorie)
    const hidden = articles.filter(a => !ids.includes(a.id));
    articles = [...sorted, ...hidden];
    LS.set('pos_articles', articles);
  }

  // ── Touch events (iPad) ──────────────────────────────────────────
  grid.addEventListener('touchstart', e => {
    if (!editMode) return;
    const card = e.target.closest('.article-card');
    if (!card || card.classList.contains('drag-placeholder')) return;
    e.preventDefault();
    const touch = e.touches[0];
    draggingEl = card;
    draggingEl.style.opacity = '0.3';
    createGhost(touch.clientX, touch.clientY);
    // placeholder après la card
    placeholder = document.createElement('div');
    placeholder.className = 'article-card drag-placeholder';
    placeholder.style.width  = card.offsetWidth  + 'px';
    placeholder.style.height = card.offsetHeight + 'px';
    card.parentNode.insertBefore(placeholder, card.nextSibling);
  }, { passive: false });

  grid.addEventListener('touchmove', e => {
    if (!draggingEl || !ghostEl) return;
    e.preventDefault();
    const touch = e.touches[0];
    moveGhost(touch.clientX, touch.clientY);
    const target = getCardAt(touch.clientX, touch.clientY);
    if (target && placeholder) {
      const r    = target.getBoundingClientRect();
      const mid  = r.left + r.width / 2;
      target.parentNode.insertBefore(
        placeholder,
        touch.clientX < mid ? target : target.nextSibling
      );
    }
  }, { passive: false });

  grid.addEventListener('touchend', e => {
    if (!draggingEl) return;
    if (placeholder) placeholder.parentNode.insertBefore(draggingEl, placeholder);
    cleanup();
    saveOrder();
  });

  // ── Mouse events (desktop) ───────────────────────────────────────
  grid.addEventListener('mousedown', e => {
    if (!editMode) return;
    const card = e.target.closest('.article-card');
    if (!card || card.classList.contains('drag-placeholder')) return;
    e.preventDefault();
    draggingEl = card;
    draggingEl.style.opacity = '0.3';
    createGhost(e.clientX, e.clientY);
    placeholder = document.createElement('div');
    placeholder.className = 'article-card drag-placeholder';
    placeholder.style.width  = card.offsetWidth  + 'px';
    placeholder.style.height = card.offsetHeight + 'px';
    card.parentNode.insertBefore(placeholder, card.nextSibling);
  });

  document.addEventListener('mousemove', e => {
    if (!draggingEl || !ghostEl) return;
    moveGhost(e.clientX, e.clientY);
    const target = getCardAt(e.clientX, e.clientY);
    if (target && placeholder) {
      const r   = target.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      target.parentNode.insertBefore(
        placeholder,
        e.clientX < mid ? target : target.nextSibling
      );
    }
  });

  document.addEventListener('mouseup', e => {
    if (!draggingEl) return;
    if (placeholder) placeholder.parentNode.insertBefore(draggingEl, placeholder);
    cleanup();
    saveOrder();
  });
}

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
      rows = [['Date', 'Heure', 'Articles', 'Paiement', 'Total (€)'],
        ...txs.map(tx => [tx.date.slice(0,10), fmtTime(tx.date),
          tx.lines.map(l=>`${l.name} x${l.qty}`).join(' | '), tx.method, tx.total.toFixed(2)])];
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
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbycdAqgK9bRAd79hYmG2xwDqTo7KSWY3JB_rHAuvaajtL9DvtWs5NY0yKpAW53eU9X2IA/exec';

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
