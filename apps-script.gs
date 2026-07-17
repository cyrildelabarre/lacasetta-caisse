/**
 * La Casetta — Caisse · Google Apps Script (backend Google Sheets)
 * --------------------------------------------------------------
 * Reçoit les transactions du POS (doPost) et construit les feuilles de KPI.
 * Toutes les synthèses sont calculées EN JS (pas de QUERY) → robuste.
 *
 * Déploiement : Déployer ▸ Gérer les déploiements ▸ (crayon) Modifier ▸
 * Nouvelle version ▸ Déployer.  L'URL /exec reste identique.
 */

const SHEET_NAME = 'Transactions';
const TZ         = 'Europe/Paris';

// Classeur Google Sheet FIXE utilisé par le script (peu importe le projet/compte).
const SPREADSHEET_ID = '1z57pfgXEkwCSyEH_CISd8zVoepcBH5GE_fTcDRxErGQ';

// L'ordre des colonnes ci-dessous EST l'ordre des colonnes A..O de la feuille.
const HEADERS = [
  'ID Transaction','Date','Heure','N° ticket du jour',
  'Article','Catégorie','Prix unitaire (€)','Quantité article','Sous-total (€)',
  'Total ticket (€)','Nb articles commande','Paiement','Emplacement','Statut ticket','Synchronisé le'
];
// Index (0-based) pour la lecture
const COL = {
  id:0, date:1, heure:2, ticketNo:3, article:4, cat:5, pu:6, qty:7, sub:8,
  total:9, nbArt:10, pay:11, loc:12, statut:13, sync:14
};

const JOURS = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi']; // getDay(): 0=Dim

// Fusion des catégories renommées (ancien libellé -> nouveau). Les ventes
// historiques de la feuille portent encore les anciens noms (« Pizzas grandes »,
// « Pizzas petites », « Suppléments ») : sans fusion, chaque catégorie apparaît
// en double dans les synthèses. Clés en minuscules (comparaison insensible à la casse).
const CAT_CANON = {
  'suppléments': 'Supp', 'supplements': 'Supp',
  'pizzas grandes': 'Grande',
  'pizzas petites': 'Petite'
};
function normCat(c) {
  const k = String(c || '').trim();
  return CAT_CANON[k.toLowerCase()] || k;
}

// ════════════════════════════════════════════
//  SPREADSHEET / FEUILLE TRANSACTIONS
// ════════════════════════════════════════════

function getOrCreateSpreadsheet() {
  // Ouvre toujours le même classeur (ID fixe). Le compte qui exécute le script
  // doit avoir un accès en modification à ce Google Sheet.
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getOrCreateTransactionsSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_NAME);

  // Détection d'un ancien schéma (en-têtes différents) → on ARCHIVE l'ancienne
  // feuille (renommée) au lieu de la supprimer, pour ne rien perdre, et on
  // repart sur une feuille propre au nouveau format (15 colonnes + Emplacement).
  if (sheet) {
    const cur = sheet.getRange(1,1,1,Math.max(sheet.getLastColumn(),1)).getValues()[0];
    const sameHeader = cur.length === HEADERS.length && HEADERS.every((h,i)=>cur[i]===h);
    if (!sameHeader) {
      const stamp = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmm');
      sheet.setName('Transactions (ancien ' + stamp + ')');
      sheet = null;
    }
  }

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME, 0);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    styleHeader(sheet, HEADERS.length, '#89310B');
    sheet.getRange('B2:B').setNumberFormat('dd/mm/yyyy');
  }
  return sheet;
}

function styleHeader(sheet, cols, color) {
  sheet.getRange(1,1,1,cols).setFontWeight('bold').setBackground(color).setFontColor('#ffffff');
}

function ensureSheet(ss, name, afterName) {
  let s = ss.getSheetByName(name);
  if (!s) { const ref = ss.getSheetByName(afterName); s = ss.insertSheet(name, ref ? ref.getIndex() : ss.getSheets().length); }
  s.clearContents(); s.clearFormats();
  s.setConditionalFormatRules([]); // retire les règles de MFC résiduelles
  return s;
}

// Numérote les tickets par jour (1, 2, 3… réinitialisé chaque jour)
function numberTickets(sheet) {
  const lr = sheet.getLastRow(); if (lr < 2) return;
  const data = sheet.getRange(2,1,lr-1,2).getValues(); // A (id) + B (date)
  const perDay = {}; let prevId = null, cur = 0;
  const out = data.map(r => {
    const id = r[0];
    const d  = r[1] instanceof Date ? Utilities.formatDate(r[1], TZ, 'yyyy-MM-dd') : String(r[1]);
    if (!id) return [''];
    if (id !== prevId) { perDay[d] = (perDay[d]||0)+1; cur = perDay[d]; prevId = id; }
    return [cur];
  });
  sheet.getRange(2,4,out.length,1).setValues(out);
}

// ════════════════════════════════════════════
//  LECTURE + AGRÉGATION (tout en JS)
// ════════════════════════════════════════════

function readValidatedRows(ss) {
  const sheet = ss.getSheetByName(SHEET_NAME);
  const lr = sheet.getLastRow();
  if (lr < 2) return [];
  return sheet.getRange(2, 1, lr-1, HEADERS.length).getValues()
    .filter(r => r[COL.id] && r[COL.statut] === 'Validé');
}

function dayKey(d)   { return d instanceof Date ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : String(d); }
function dayLabel(d) { return d instanceof Date ? Utilities.formatDate(d, TZ, 'dd/MM/yyyy')  : String(d); }
function asDate(d)   { return d instanceof Date ? d : new Date(d); }

// Construit toutes les agrégations nécessaires en un seul passage.
function computeStats(rows) {
  const lines   = [];                          // une entrée par ligne d'article
  const tickets = {};                          // par ticket (compté une seule fois)

  rows.forEach(r => {
    lines.push({
      art: r[COL.article], cat: normCat(r[COL.cat]),
      qty: Number(r[COL.qty])||0, sub: Number(r[COL.sub])||0,
      hour: Utilities.formatDate(asDate(r[COL.date]), TZ, 'HH'),
      dKey: dayKey(r[COL.date]), date: asDate(r[COL.date])
    });
    const id = r[COL.id];
    if (!tickets[id]) {
      tickets[id] = {
        total: Number(r[COL.total])||0,
        pay:   r[COL.pay],
        loc:   r[COL.loc] || '(non défini)',
        date:  asDate(r[COL.date]),
        dKey:  dayKey(r[COL.date]),
        hour:  Utilities.formatDate(asDate(r[COL.date]), TZ, 'HH'),
        time:  Utilities.formatDate(asDate(r[COL.date]), TZ, 'HH:mm'),
        nbArt: 0,
        cats:  {}
      };
    }
    tickets[id].cats[normCat(r[COL.cat])] = true; // catégories présentes dans la vente
    tickets[id].nbArt += Number(r[COL.qty]) || 0;
  });

  return { lines, tickets: Object.values(tickets), ticketMap: tickets };
}

// helpers d'agrégation
function add(map, key, n) { map[key] = (map[key]||0) + n; }
function sortDescByVal(obj, idx) {
  return Object.entries(obj).sort((a,b)=> (idx==null? b[1]-a[1] : b[1][idx]-a[1][idx]));
}

// ════════════════════════════════════════════
//  ÉCRITURE GÉNÉRIQUE D'UN TABLEAU
// ════════════════════════════════════════════

function writeTable(s, title, color, headers, rows, widths) {
  const n = headers.length;
  s.getRange(1,1,1,n).merge().setValue(title)
   .setFontSize(12).setFontWeight('bold').setBackground(color)
   .setFontColor('#ffffff').setHorizontalAlignment('center');
  s.getRange(2,1,1,n).setValues([headers]).setFontWeight('bold').setBackground('#f4f6ee');
  if (rows.length) s.getRange(3,1,rows.length,n).setValues(rows);
  s.setFrozenRows(2);
  if (widths) widths.forEach((w,i)=>s.setColumnWidth(i+1,w));
}

const eur    = n => Math.round((Number(n)||0)*100)/100;
const eurStr = n => (Math.round((Number(n)||0)*100)/100).toFixed(2).replace('.',',') + ' €';

// Génère les lignes de recommandations à partir d'un sous-ensemble de
// tickets/lignes (toutes les données, ou seulement la semaine pour l'email).
// Retourne un tableau de chaînes : '━━━' = titre de section, '👉' = astuce.
function insightLines(tk, ln) {
  const artCA={}, artQty={}, catCA={}, heureCA={}, jourCA={}, jourNb={};
  let nbEsp=0, nbCarte=0, caEsp=0, caCarte=0;
  ln.forEach(l => { add(artCA,l.art,l.sub); add(artQty,l.art,l.qty); add(catCA,l.cat,l.sub); add(heureCA,l.hour,l.sub); });
  tk.forEach(t => { const j=JOURS[t.date.getDay()]; add(jourCA,j,t.total); add(jourNb,j,1);
    if (t.pay==='especes'){nbEsp++;caEsp+=t.total;} else {nbCarte++;caCarte+=t.total;} });

  const totalCA   = Object.values(artCA).reduce((a,b)=>a+b,0);
  const nbTx      = tk.length;
  const ticketMoy = nbTx ? totalCA/nbTx : 0;
  const topArts = sortDescByVal(artCA), topHeure = sortDescByVal(heureCA);
  const topJour = sortDescByVal(jourCA), topCat   = sortDescByVal(catCA);
  // « À surveiller » : on exclut les articles offerts (0 €), sinon ils trustent le
  // bas du classement, ainsi que le top 3, sinon un même article pouvait être cité
  // à la fois en top et en moins vendu.
  const flopArts = topArts.slice(3).filter(e => !/\(offert/i.test(e[0]));

  const f   = eurStr;
  const pct = (a,b) => b ? Math.round(a/b*100)+'%' : '—';
  const g   = (arr,i)=> arr[i] ? arr[i][0] : '—';
  const gv  = (arr,i)=> arr[i] ? arr[i][1] : 0;

  return [
    '━━━  🏆  ARTICLES : CE QUI MARCHE  ━━━',
    `✅  Top 1 : ${g(topArts,0)} → ${f(gv(topArts,0))} de CA (${pct(gv(topArts,0),totalCA)} du CA total)`,
    `✅  Top 2 : ${g(topArts,1)} → ${f(gv(topArts,1))}`,
    `✅  Top 3 : ${g(topArts,2)} → ${f(gv(topArts,2))}`,
    `👉  Astuce : mets ces 3 articles en avant dans ta communication (Instagram, ardoise, bouche-à-oreille).`,
    '━━━  📉  ARTICLES À SURVEILLER  ━━━',
    ...(flopArts.length ? [
      `⚠️  Moins vendu : ${g(flopArts,flopArts.length-1)} → ${f(gv(flopArts,flopArts.length-1))} (${artQty[g(flopArts,flopArts.length-1)]||0} vendus)`,
    ].concat(flopArts.length > 1 ? [`⚠️  2e moins vendu : ${g(flopArts,flopArts.length-2)} → ${f(gv(flopArts,flopArts.length-2))}`] : [])
     .concat([`👉  Astuce : envisage de retirer ces articles ou de les proposer en "offre du jour".`])
    : ['✅  Rien à signaler : trop peu d\'articles distincts vendus sur la période.']),
    '━━━  🍕  CATÉGORIES  ━━━',
    ...topCat.map(([cat,ca],i) => `${i===0?'🥇':i===1?'🥈':'🥉'}  ${cat} → ${f(ca)} (${pct(ca,totalCA)})`),
    `👉  Astuce : les suppléments représentent ${pct((catCA['Supp']||0)+(catCA['Suppléments']||0), totalCA)} du CA — propose-les systématiquement ("Vous voulez un supplément fromage ?").`,
    '━━━  ⏰  HEURES DE POINTE  ━━━',
    `🔥  Heure la plus chargée : ${g(topHeure,0)}h → ${f(gv(topHeure,0))}`,
    `🔥  2e heure : ${g(topHeure,1)}h → ${f(gv(topHeure,1))}`,
    `😴  Heure creuse : ${g(topHeure,topHeure.length-1)}h → ${f(gv(topHeure,topHeure.length-1))}`,
    `👉  Astuce : prépare ta mise en place 30 min avant ${g(topHeure,0)}h.`,
    '━━━  📆  JOURS DE LA SEMAINE  ━━━',
    `📈  Meilleur jour : ${g(topJour,0)} → ${f(gv(topJour,0))} (${jourNb[g(topJour,0)]||0} tickets)`,
    `📉  Jour le plus calme : ${g(topJour,topJour.length-1)} → ${f(gv(topJour,topJour.length-1))}`,
    `👉  Astuce : concentre tes posts Instagram la veille de ton ${g(topJour,0)} pour maximiser la fréquentation.`,
    '━━━  💳  PAIEMENTS  ━━━',
    `💶  Espèces : ${nbEsp} tickets (${pct(nbEsp,nbTx)}) → ${f(caEsp)}`,
    `💳  Carte : ${nbCarte} tickets (${pct(nbCarte,nbTx)}) → ${f(caCarte)}`,
    `👉  Astuce : ${nbTx && nbCarte/nbTx > 0.6 ? 'La carte domine — garde ton terminal chargé et fonctionnel.' : 'Beaucoup d\'espèces — prévois assez de monnaie en début de service.'}`,
    '━━━  💰  PANIER MOYEN  ━━━',
    `📊  Ticket moyen : ${f(ticketMoy)}`,
    `👉  Pour atteindre ${f(ticketMoy * 1.15)} (+15%) : propose un dessert ou un supplément à chaque commande.`,
    `👉  Upselling : convertir 1 client sur 3 vers un dessert (${f(4)}) = +${f(nbTx/3*4)} de CA sur la période.`,
    '━━━  📱  COMMUNICATION  ━━━',
    `👉  Ton article star est "${g(topArts,0)}" — publie une belle photo sur Instagram.`,
    `👉  Ton meilleur jour est ${g(topJour,0)} — programme tes stories la veille.`,
    `👉  Fidélisation : envisage une carte de fidélité (ex. 10e pizza offerte).`,
  ];
}

// ════════════════════════════════════════════
//  FEUILLES DE SYNTHÈSE
// ════════════════════════════════════════════

function createAllSheets(ss) {
  const stats = computeStats(readValidatedRows(ss));
  sheetCAParJour(ss, stats);
  sheetArticlesParJour(ss, stats);
  sheetPizzasParJour(ss, stats);
  sheetCAParCategorie(ss, stats);
  sheetCAParArticle(ss, stats);
  sheetParHeure(ss, stats);
  sheetParJourSemaine(ss, stats);
  sheetCAParEmplacement(ss, stats);
  sheetTableauDeBord(ss, stats);
  sheetRecommandations(ss, stats);
}

function sheetCAParJour(ss, stats) {
  const s = ensureSheet(ss, '📅 CA par Jour', SHEET_NAME);
  const byDay = {}; // dKey -> {label, tickets, nbArt, ca, esp, carte}
  const get = k => byDay[k] || (byDay[k] = {label:'', tickets:0, nbArt:0, ca:0, esp:0, carte:0});

  stats.tickets.forEach(t => {
    const gObj = get(t.dKey);
    gObj.label = dayLabel(t.date);
    gObj.tickets++; gObj.ca += t.total;
    if (t.pay === 'especes') gObj.esp += t.total; else gObj.carte += t.total;
  });
  stats.lines.forEach(l => { get(l.dKey).nbArt += l.qty; });

  const rows = Object.keys(byDay).sort().reverse().map(k => {
    const gObj = byDay[k];
    return [gObj.label, gObj.tickets, gObj.nbArt, eur(gObj.ca), eur(gObj.esp), eur(gObj.carte),
            eur(gObj.ca/gObj.tickets)];
  });
  writeTable(s, "CHIFFRE D'AFFAIRES PAR JOUR", '#76894F',
    ['Date','Nb tickets','Nb articles','CA total (€)','CA Espèces (€)','CA Carte (€)','Ticket moyen (€)'],
    rows, [120,90,100,120,120,120,120]);
}

// Nombre total d'articles vendus par jour (toutes catégories).
function sheetArticlesParJour(ss, stats) {
  const s = ensureSheet(ss, '📦 Articles par Jour', '📅 CA par Jour');
  const byDay = {}; // dKey -> {label, qty}
  stats.lines.forEach(l => {
    const g = byDay[l.dKey] || (byDay[l.dKey] = { label: dayLabel(l.date), qty: 0 });
    g.qty += l.qty;
  });
  const keys = Object.keys(byDay).sort().reverse();
  const rows = keys.map(k => [byDay[k].label, byDay[k].qty]);
  if (rows.length) {
    const tot = keys.reduce((a, k) => a + byDay[k].qty, 0);
    rows.push(['TOTAL', tot]);
  }
  writeTable(s, 'ARTICLES VENDUS PAR JOUR', '#76894F',
    ['Date', 'Nb articles vendus'], rows, [140, 160]);
  if (rows.length) s.getRange(2 + rows.length, 1, 1, 2).setFontWeight('bold').setBackground('#f4f6ee');
}

// Nombre de pizzas vendues par jour, en distinguant petites et grandes.
// Détection : catégorie contenant « petite »/« grande », sinon suffixe (P)/(G) du nom.
function sheetPizzasParJour(ss, stats) {
  const s = ensureSheet(ss, '🍕 Pizzas par Jour', '📅 CA par Jour');
  const byDay = {}; // dKey -> {label, petites, grandes}
  stats.lines.forEach(l => {
    const cat = String(l.cat || ''), name = String(l.art || '');
    let size = /petite/i.test(cat) ? 'p' : /grande/i.test(cat) ? 'g' : null;
    if (!size) { if (/\(p\)\s*$/i.test(name)) size = 'p'; else if (/\(g\)\s*$/i.test(name)) size = 'g'; }
    if (!size) return; // pas une pizza
    const g = byDay[l.dKey] || (byDay[l.dKey] = { label: dayLabel(l.date), petites: 0, grandes: 0 });
    if (size === 'p') g.petites += l.qty; else g.grandes += l.qty;
  });

  const keys = Object.keys(byDay).sort().reverse();
  const rows = keys.map(k => {
    const g = byDay[k];
    return [g.label, g.petites, g.grandes, g.petites + g.grandes];
  });
  // Ligne total en bas
  if (rows.length) {
    const tp = keys.reduce((a, k) => a + byDay[k].petites, 0);
    const tg = keys.reduce((a, k) => a + byDay[k].grandes, 0);
    rows.push(['TOTAL', tp, tg, tp + tg]);
  }
  writeTable(s, 'PIZZAS VENDUES PAR JOUR', '#89310B',
    ['Date', 'Pizzas petites', 'Pizzas grandes', 'Total pizzas'],
    rows, [130, 130, 130, 130]);
  if (rows.length) { // met la ligne TOTAL en gras
    s.getRange(2 + rows.length, 1, 1, 4).setFontWeight('bold').setBackground('#f4f6ee');
  }
}

function sheetCAParCategorie(ss, stats) {
  const s = ensureSheet(ss, '🍕 CA par Catégorie', '📅 CA par Jour');
  const qty = {}, ca = {};
  stats.lines.forEach(l => { add(qty, l.cat, l.qty); add(ca, l.cat, l.sub); });
  const total = Object.values(ca).reduce((a,b)=>a+b,0) || 1;
  const rows = sortDescByVal(ca).map(([cat,c]) =>
    [cat, qty[cat], eur(c), c/total, eur(c/qty[cat])]);
  writeTable(s, 'CA PAR CATÉGORIE', '#76894F',
    ['Catégorie','Qté vendue','CA total (€)','% du CA','Prix moyen (€)'],
    rows, [180,100,120,90,120]);
  if (rows.length) s.getRange(3,4,rows.length,1).setNumberFormat('0.0%');
}

function sheetCAParArticle(ss, stats) {
  const s = ensureSheet(ss, '🏆 CA par Article', '🍕 CA par Catégorie');
  const qty = {}, ca = {}, cat = {};
  stats.lines.forEach(l => { add(qty, l.art, l.qty); add(ca, l.art, l.sub); cat[l.art] = l.cat; });
  const total = Object.values(ca).reduce((a,b)=>a+b,0) || 1;
  const rows = sortDescByVal(ca).map(([art,c]) =>
    [art, cat[art], qty[art], eur(c), eur(c/qty[art]), c/total]);
  writeTable(s, 'CA PAR ARTICLE', '#76894F',
    ['Article','Catégorie','Qté vendue','CA total (€)','Prix moy. (€)','% du CA'],
    rows, [180,140,100,120,110,90]);
  if (rows.length) s.getRange(3,6,rows.length,1).setNumberFormat('0.0%');
}

function sheetParHeure(ss, stats) {
  const s = ensureSheet(ss, '⏰ Analyse par Heure', '🏆 CA par Article');
  const tk = {}, ca = {}, art = {};
  stats.tickets.forEach(t => { add(tk, t.hour, 1); add(ca, t.hour, t.total); });
  stats.lines.forEach(l => add(art, l.hour, l.qty));
  const rows = Object.keys(ca).sort().map(h =>
    [h+'h', tk[h]||0, art[h]||0, eur(ca[h]), eur(ca[h]/(tk[h]||1))]);
  writeTable(s, 'PERFORMANCE PAR HEURE DE SERVICE', '#89310B',
    ['Heure','Nb tickets','Nb articles','CA total (€)','Ticket moyen (€)'],
    rows, [70,110,110,110,110]);
  if (rows.length) {
    s.getRange(3,1,rows.length,1).setHorizontalAlignment('center');
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpoint('#ffffff').setGradientMaxpoint('#89310B')
      .setRanges([s.getRange(3,4,rows.length,1)]).build();
    s.setConditionalFormatRules([rule]);
  }
}

function sheetParJourSemaine(ss, stats) {
  const s = ensureSheet(ss, '📆 Jour de semaine', '⏰ Analyse par Heure');
  const ca = {}, tickets = {}, services = {};
  stats.tickets.forEach(t => {
    const j = JOURS[t.date.getDay()];
    add(ca, j, t.total); add(tickets, j, 1);
    (services[j] = services[j] || new Set()).add(t.dKey);
  });
  const order = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
  const rows = order.filter(j => ca[j] != null).map(j => {
    const nbServ = services[j].size;
    return [j, nbServ, tickets[j], eur(ca[j]), eur(ca[j]/nbServ), eur(ca[j]/tickets[j])];
  });
  writeTable(s, 'PERFORMANCE PAR JOUR DE LA SEMAINE', '#89310B',
    ['Jour','Nb services','Nb tickets total','CA total (€)','CA moyen/service (€)','Ticket moyen (€)'],
    rows, [110,100,130,120,150,120]);
}

function sheetCAParEmplacement(ss, stats) {
  const s = ensureSheet(ss, '📍 CA par Emplacement', '📆 Jour de semaine');
  const ca = {}, tickets = {}, days = {};
  stats.tickets.forEach(t => {
    add(ca, t.loc, t.total); add(tickets, t.loc, 1);
    (days[t.loc] = days[t.loc] || new Set()).add(t.dKey);
  });
  const total = Object.values(ca).reduce((a,b)=>a+b,0) || 1;
  const rows = sortDescByVal(ca).map(([loc,c]) => {
    const nbDays = days[loc].size;
    return [loc, tickets[loc], eur(c), c/total, eur(c/tickets[loc]), nbDays, eur(c/nbDays)];
  });
  writeTable(s, 'CA PAR EMPLACEMENT', '#76894F',
    ['Emplacement','Nb tickets','CA total (€)','% du CA','Ticket moyen (€)','Nb jours','CA moyen/jour (€)'],
    rows, [200,100,120,90,130,90,140]);
  if (rows.length) s.getRange(3,4,rows.length,1).setNumberFormat('0.0%');
}

function sheetTableauDeBord(ss, stats) {
  const s = ensureSheet(ss, '📊 Tableau de bord', '📍 CA par Emplacement');
  const now = new Date();
  const within30date = d => (now - d) / 86400000 <= 30;

  const tk30  = stats.tickets.filter(t => within30date(t.date));
  const caTot = tk30.reduce((a,t)=>a+t.total,0);
  const nbTk  = tk30.length;
  const ticketMoy = nbTk ? caTot/nbTk : 0;

  const caEsp   = tk30.filter(t=>t.pay==='especes').reduce((a,t)=>a+t.total,0);
  const caCarte = caTot - caEsp;

  // Articles 30j (depuis les lignes, qui portent désormais leur date)
  let nbArt30 = 0;
  const artCA = {}, artQty = {};
  stats.lines.forEach(l => {
    if (!within30date(l.date)) return;
    nbArt30 += l.qty;
    add(artCA,  l.art, l.sub);
    add(artQty, l.art, l.qty);
  });
  const top5 = sortDescByVal(artCA).slice(0,5);

  s.getRange('A1:D1').merge().setValue('TABLEAU DE BORD — LA CASETTA (30 derniers jours)')
   .setFontSize(14).setFontWeight('bold').setBackground('#89310B').setFontColor('#ffffff')
   .setHorizontalAlignment('center');

  const rows = [
    ['',''],
    ['CA total',          eur(caTot)],
    ['Nb tickets',        nbTk],
    ['Ticket moyen',      eur(ticketMoy)],
    ['Nb articles vendus',nbArt30],
    ['',''],
    ['💳 PAIEMENTS','Montant (€)'],
    ['Espèces', eur(caEsp)],
    ['Carte',   eur(caCarte)],
    ['',''],
  ];
  s.getRange(2,1,rows.length,2).setValues(rows);
  // Top 5
  let r = 2 + rows.length;
  s.getRange(r,1,1,3).setValues([['🏆 TOP 5 ARTICLES','Qté','CA (€)']])
   .setFontWeight('bold').setBackground('#f4f6ee');
  r++;
  if (top5.length) {
    s.getRange(r,1,top5.length,3).setValues(
      top5.map(([art,c]) => [art, artQty[art], eur(c)]));
  }
  // styles
  ['A3','A4','A5','A6'].forEach(a=>s.getRange(a).setFontWeight('bold'));
  s.getRange('A8').setFontWeight('bold').setBackground('#f4f6ee');
  s.getRange('B8').setFontWeight('bold').setBackground('#f4f6ee');
  [180,140,140,140].forEach((w,i)=>s.setColumnWidth(i+1,w));
  s.setFrozenRows(1);
}

// ════════════════════════════════════════════
//  RECOMMANDATIONS (texte généré)
// ════════════════════════════════════════════

function sheetRecommandations(ss, stats) {
  const s = ensureSheet(ss, '💡 Recommandations', '📊 Tableau de bord');
  if (!stats.tickets.length) {
    s.getRange('A1').setValue('💡 Pas encore assez de données pour générer des recommandations.');
    return;
  }

  const now     = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
  const totalCA = stats.lines.reduce((a,l)=>a+l.sub,0);

  const lines = [
    ['💡 RECOMMANDATIONS & INSIGHTS — La Casetta'],
    [`Générées le ${now} · ${stats.tickets.length} tickets analysés · CA total ${eurStr(totalCA)}`],
    [''],
    ...insightLines(stats.tickets, stats.lines).map(x => [x]),
  ];

  s.getRange(1,1,lines.length,1).setValues(lines);
  s.setColumnWidth(1, 640);
  s.getRange('A1').setFontSize(14).setFontWeight('bold').setBackground('#89310B').setFontColor('#ffffff');
  s.getRange('A2').setFontStyle('italic').setFontColor('#555555');
  lines.forEach((l,i) => {
    if (l[0].startsWith('━━━')) s.getRange(i+1,1).setFontWeight('bold').setBackground('#f4f6ee').setFontColor('#89310B');
    else if (l[0].startsWith('👉')) s.getRange(i+1,1).setFontStyle('italic').setFontColor('#76894F');
  });
  s.setRowHeights(1, lines.length, 22);
}

// ════════════════════════════════════════════
//  EMAIL HEBDOMADAIRE
// ════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
//  DESTINATAIRES & SECTIONS DES E-MAILS RÉCAP (quotidien + hebdo)
//
//  Chaque destinataire reçoit SON e-mail, composé uniquement des sections
//  mises à true. Mets false pour masquer une section chez ce destinataire.
//  (Une clé absente = section affichée.)
//
//  Sections disponibles (dans l'ordre d'affichage) :
//   kpis             tuiles CA / ventes / ticket moyen / articles
//   paiements        espèces vs carte
//   caParJour        CA + ventes par jour
//   articlesParJour  nb d'articles vendus par jour
//   pizzasParJour    pizzas petites / grandes par jour
//   parHeure         CA et ventes par heure (pic surligné)
//   categories       CA par catégorie
//   emplacement      CA par emplacement
//   starParCategorie article le plus vendu de chaque catégorie
//   topArticles      top 5 articles (CA)
//   flopArticles     articles les moins vendus (hors offerts)
//   attachement      taux d'attachement boisson / dessert / supplément
//   panierMoyen      panier moyen par tranche horaire et taille de commande
//   ventesDetail     liste des ventes (heure, articles, paiement, montant)
//   recommandations  insights et astuces
// ─────────────────────────────────────────────────────────────────────────────
const RECIPIENTS = [
  { email: 'cyril.delabarre@hotmail.com', sections: {
      kpis: true, paiements: true, caParJour: true, articlesParJour: true,
      pizzasParJour: true, parHeure: true, categories: true, emplacement: true,
      starParCategorie: true, topArticles: true, flopArticles: true,
      attachement: true, panierMoyen: true, ventesDetail: true, recommandations: true } },
  { email: 'clemence.bailly89@gmail.com', sections: {
      kpis: true, paiements: true, caParJour: true, articlesParJour: true,
      pizzasParJour: true, parHeure: true, categories: true, emplacement: true,
      starParCategorie: true, topArticles: true, flopArticles: true,
      attachement: true, panierMoyen: true, ventesDetail: true, recommandations: true } },
  { email: 'bastian.iragne@gmail.com', sections: {
      kpis: true, paiements: true, caParJour: true, articlesParJour: true,
      pizzasParJour: true, parHeure: true, categories: true, emplacement: true,
      starParCategorie: true, topArticles: true, flopArticles: true,
      attachement: true, panierMoyen: true, ventesDetail: true, recommandations: true } },
];

// Récap hebdo (7 derniers jours).
function sendWeeklyReport() {
  const stats = computeStats(readValidatedRows(getOrCreateSpreadsheet()));
  const now = new Date();
  const within7 = d => (now - d) / 86400000 <= 7;
  buildAndSendReport(
    stats.tickets.filter(t => within7(t.date)),
    stats.lines.filter(l => within7(l.date)),
    { titleLabel:'Récap de la semaine', recoTitle:'Recommandations de la semaine',
      subjectKind:'Récap semaine', whenText:'Email automatique envoyé chaque vendredi soir.',
      periode:`${Utilities.formatDate(new Date(now-7*86400000), TZ, 'dd/MM')} – ${Utilities.formatDate(now, TZ, 'dd/MM/yyyy')}`,
      emptyKind:'aucune vente cette semaine' });
}

// Récap du jour (ventes du jour même).
function sendDailyReport() {
  // Nettoie les déclencheurs ponctuels « sendDailyReport » (celui qui vient de se déclencher
  // + un éventuel ancien déclencheur horaire 22h15).
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendDailyReport') ScriptApp.deleteTrigger(t);
  });

  const stats  = computeStats(readValidatedRows(getOrCreateSpreadsheet()));
  const todayK = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const tk = stats.tickets.filter(t => dayKey(t.date) === todayK);
  const ln = stats.lines.filter(l => dayKey(l.date) === todayK);

  if (!tk.length) { Logger.log('Aucune vente aujourd\'hui — pas d\'e-mail.'); return; }

  buildAndSendReport(tk, ln,
    { titleLabel:'Récap du jour', recoTitle:'Recommandations du jour',
      subjectKind:'Récap jour', whenText:'Email automatique envoyé après la dernière vente du jour.',
      periode: Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy'),
      emptyKind:'aucune vente aujourd\'hui' });
}

// Programme (ou re-programme) l'envoi du récap du jour ~2 min après la dernière vente.
// Appelé à chaque ajout de ventes → « rebond » : le compteur repart si une vente arrive.
function scheduleDailyReport() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendDailyReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyReport').timeBased().after(2 * 60 * 1000).create();
}

// Générateur commun d'e-mail récap.
function buildAndSendReport(tk, ln, opts) {
  const fmt = n => (Math.round((Number(n)||0)*100)/100).toFixed(2).replace('.',',') + ' €';
  const pct = (a,b) => b ? Math.round(a/b*100)+'%' : '—';
  const periode = opts.periode;

  if (!tk.length) {
    RECIPIENTS.forEach(r => MailApp.sendEmail({ to: r.email,
      subject: `🍕 La Casetta — ${opts.emptyKind} (${periode})`,
      htmlBody: `<p>Bonjour,</p><p>Aucune vente enregistrée sur la période <b>${periode}</b>.</p>` }));
    return;
  }

  const caTot = tk.reduce((a,t)=>a+t.total,0);
  const nbTk  = tk.length;
  const nbArt = ln.reduce((a,l)=>a+l.qty,0);
  const ticketMoy = caTot/nbTk;
  const caEsp = tk.filter(t=>t.pay==='especes').reduce((a,t)=>a+t.total,0);
  const caCarte = caTot - caEsp;

  // Agrégations
  const artCA={}, artQty={}, byDay={}, byLoc={};
  ln.forEach(l => { add(artCA,l.art,l.sub); add(artQty,l.art,l.qty); });
  tk.forEach(t => {
    const d=byDay[t.dKey]||(byDay[t.dKey]={label:dayLabel(t.date),ca:0,n:0}); d.ca+=t.total; d.n++;
    add(byLoc, t.loc, t.total);
  });
  const topAll  = sortDescByVal(artCA);
  const topArts = topAll.slice(0,5);
  // Le flop exclut le top 5 (sinon un même article pouvait figurer dans les deux tableaux).
  const flopArts = topAll.slice(5).filter(e => !/\(offert/i.test(e[0])).slice(-5).reverse();
  const locRows = sortDescByVal(byLoc);
  const dayRows = Object.keys(byDay).sort().map(k=>byDay[k]);

  // Articles vendus par jour + pizzas petites/grandes par jour
  const artDay = {}, pizzaDay = {};
  ln.forEach(l => {
    const g = artDay[l.dKey] || (artDay[l.dKey] = { label: dayLabel(l.date), qty: 0 });
    g.qty += l.qty;
    const cat = String(l.cat||''), name = String(l.art||'');
    let size = /petite/i.test(cat) ? 'p' : /grande/i.test(cat) ? 'g' : null;
    if (!size) { if (/\(p\)\s*$/i.test(name)) size='p'; else if (/\(g\)\s*$/i.test(name)) size='g'; }
    if (size) {
      const pz = pizzaDay[l.dKey] || (pizzaDay[l.dKey] = { label: dayLabel(l.date), p: 0, g: 0 });
      pz[size] += l.qty;
    }
  });
  const artDayRows   = Object.keys(artDay).sort().map(k=>artDay[k]);
  const pizzaDayRows = Object.keys(pizzaDay).sort().map(k=>pizzaDay[k]);

  // CA / ventes par heure (pic surligné)
  const byHour = {};
  tk.forEach(t => { const h=byHour[t.hour]||(byHour[t.hour]={n:0,ca:0}); h.n++; h.ca+=t.total; });
  const hourKeys = Object.keys(byHour).sort();
  const peakHourCA = Math.max.apply(null, hourKeys.map(h=>byHour[h].ca));

  // CA par catégorie
  const catQty = {}, catCA2 = {};
  ln.forEach(l => { add(catQty, l.cat, l.qty); add(catCA2, l.cat, l.sub); });
  const catRows = sortDescByVal(catCA2);

  // Panier moyen : par tranche horaire et par taille de commande
  const tranches = [
    { label:'Matin (8h–12h)',      lo:8,  hi:12, sum:0, n:0 },
    { label:'Midi (12h–14h)',      lo:12, hi:14, sum:0, n:0 },
    { label:'Après-midi (14h–18h)',lo:14, hi:18, sum:0, n:0 },
    { label:'Soir (18h–23h)',      lo:18, hi:23, sum:0, n:0 },
  ];
  const tailles = { '1 article':{sum:0,n:0}, '2–3 articles':{sum:0,n:0}, '4+ articles':{sum:0,n:0} };
  tk.forEach(t => {
    const h = Number(t.hour);
    tranches.forEach(tr => { if (h >= tr.lo && h < tr.hi) { tr.sum += t.total; tr.n++; } });
    const key = t.nbArt === 1 ? '1 article' : t.nbArt <= 3 ? '2–3 articles' : '4+ articles';
    tailles[key].sum += t.total; tailles[key].n++;
  });

  // Liste des ventes (plafonnée à 30 lignes)
  const ventes = tk.slice().sort((a,b)=>b.date-a.date);
  const ventesShown = ventes.slice(0,30);

  // Article star (le plus vendu en quantité) par catégorie
  const byCatArt = {}; // cat -> { art -> {qty, ca} }
  ln.forEach(l => {
    (byCatArt[l.cat] = byCatArt[l.cat] || {});
    (byCatArt[l.cat][l.art] = byCatArt[l.cat][l.art] || { qty: 0, ca: 0 });
    byCatArt[l.cat][l.art].qty += l.qty;
    byCatArt[l.cat][l.art].ca  += l.sub;
  });
  const catStars = Object.keys(byCatArt).map(cat => {
    const best = Object.entries(byCatArt[cat]).sort((a,b)=>b[1].qty-a[1].qty)[0];
    return { cat: cat, art: best[0], qty: best[1].qty, ca: best[1].ca };
  }).sort((a,b)=>b.qty-a.qty);

  // Taux d'attachement : part des ventes contenant boisson / dessert / supplément
  const attach = [
    { label:'🥤 Boissons',    re:/boisson/i },
    { label:'🍮 Desserts',    re:/dessert/i },
    { label:'🧀 Suppléments', re:/supp/i },
  ].map(d => {
    const n = tk.filter(t => Object.keys(t.cats||{}).some(c => d.re.test(c))).length;
    const p = nbTk ? Math.round(n/nbTk*100) : 0;
    const oneIn = n ? Math.round(nbTk/n*10)/10 : null;
    return { label:d.label, n:n, pct:p, oneIn:oneIn };
  });

  // ── HTML : chaque section est générée séparément puis assemblée
  //          selon la configuration de chaque destinataire (RECIPIENTS) ──
  const C = { brand:'#89310B', green:'#76894F', bg:'#faf7f4', line:'#e7ddd6' };
  const kpi = (label,val) =>
    `<td style="padding:14px;background:#fff;border:1px solid ${C.line};border-radius:10px;text-align:center;width:25%">
       <div style="font-size:22px;font-weight:800;color:${C.brand}">${val}</div>
       <div style="font-size:12px;color:#888;margin-top:4px">${label}</div></td>`;
  const th = t => `<th align="left" style="padding:8px 10px;background:${C.green};color:#fff;font-size:13px">${t}</th>`;
  const td = (v,b)=>`<td style="padding:8px 10px;border-bottom:1px solid ${C.line};font-size:13px${b?';font-weight:700':''}">${v}</td>`;
  const tbl = inner => `<table width="100%" cellspacing="0" style="background:#fff;border:1px solid ${C.line};border-radius:8px;overflow:hidden">${inner}</table>`;
  const sec = (title, inner) => `<h3 style="color:${C.brand};margin:22px 0 8px;font-size:15px">${title}</h3>` + inner;

  // Recommandations (mêmes insights que la feuille, sur la semaine écoulée)
  const recoHtml = insightLines(tk, ln).map(line => {
    if (line.startsWith('━━━'))
      return `<div style="font-weight:700;color:${C.brand};font-size:14px;margin:16px 0 6px">${line.replace(/━/g,'').trim()}</div>`;
    if (line.startsWith('👉'))
      return `<div style="font-style:italic;color:${C.green};font-size:13px;margin:3px 0;padding-left:4px">${line}</div>`;
    return `<div style="font-size:13px;margin:3px 0;color:#333">${line}</div>`;
  }).join('');

  const S = {};
  S.kpis = `<table width="100%" cellspacing="8" cellpadding="0"><tr>
        ${kpi('CA total', fmt(caTot))}${kpi('Ventes', nbTk)}${kpi('Ticket moyen', fmt(ticketMoy))}${kpi('Articles vendus', nbArt)}
      </tr></table>`;

  S.paiements = sec('💳 Paiements', tbl(
    `<tr>${th('Mode')}${th('Montant')}${th('Part')}</tr>
     <tr>${td('💶 Espèces')}${td(fmt(caEsp))}${td(pct(caEsp,caTot))}</tr>
     <tr>${td('💳 Carte')}${td(fmt(caCarte))}${td(pct(caCarte,caTot))}</tr>`));

  S.caParJour = sec('📅 CA par jour', tbl(
    `<tr>${th('Jour')}${th('Ventes')}${th('CA')}</tr>` +
    dayRows.map(d=>`<tr>${td(d.label)}${td(d.n)}${td(fmt(d.ca),true)}</tr>`).join('')));

  S.articlesParJour = sec('📦 Articles vendus par jour', tbl(
    `<tr>${th('Jour')}${th('Nb articles')}</tr>` +
    artDayRows.map(d=>`<tr>${td(d.label)}${td(d.qty,true)}</tr>`).join('') +
    `<tr style="background:#f4f6ee">${td('TOTAL',true)}${td(nbArt,true)}</tr>`));

  S.pizzasParJour = pizzaDayRows.length ? sec('🍕 Pizzas par jour', tbl(
    `<tr>${th('Jour')}${th('Petites')}${th('Grandes')}${th('Total')}</tr>` +
    pizzaDayRows.map(d=>`<tr>${td(d.label)}${td(d.p)}${td(d.g)}${td(d.p+d.g,true)}</tr>`).join(''))) : '';

  S.parHeure = sec('⏰ Par heure', tbl(
    `<tr>${th('Heure')}${th('Ventes')}${th('CA')}</tr>` +
    hourKeys.map(h => {
      const v = byHour[h], peak = v.ca === peakHourCA;
      return `<tr${peak?' style="background:#fff4ec"':''}>${td((peak?'🔥 ':'')+h+'h',peak)}${td(v.n)}${td(fmt(v.ca),peak)}</tr>`;
    }).join('')));

  S.categories = sec('🗂 CA par catégorie', tbl(
    `<tr>${th('Catégorie')}${th('Qté')}${th('CA')}${th('Part')}</tr>` +
    catRows.map(([cat,ca])=>`<tr>${td(cat)}${td(catQty[cat])}${td(fmt(ca),true)}${td(pct(ca,caTot))}</tr>`).join('')));

  S.emplacement = sec('📍 CA par emplacement', tbl(
    `<tr>${th('Emplacement')}${th('CA')}${th('Part')}</tr>` +
    locRows.map(([l,c])=>`<tr>${td('📍 '+l)}${td(fmt(c),true)}${td(pct(c,caTot))}</tr>`).join('')));

  S.starParCategorie = sec('🏅 Article star par catégorie', tbl(
    `<tr>${th('Catégorie')}${th('Article')}${th('Qté')}${th('CA')}</tr>` +
    catStars.map(s=>`<tr>${td(s.cat)}${td(s.art,true)}${td(s.qty)}${td(fmt(s.ca))}</tr>`).join('')));

  S.topArticles = sec('🏆 Top articles', tbl(
    `<tr>${th('Article')}${th('Qté')}${th('CA')}</tr>` +
    topArts.map(([a,c])=>`<tr>${td(a)}${td(artQty[a])}${td(fmt(c),true)}</tr>`).join('')));

  S.flopArticles = flopArts.length ? sec('📉 Articles les moins vendus', tbl(
    `<tr>${th('Article')}${th('Qté')}${th('CA')}</tr>` +
    flopArts.map(([a,c])=>`<tr>${td(a)}${td(artQty[a])}${td(fmt(c))}</tr>`).join(''))) : '';

  S.attachement = sec('🧲 Taux d\'attachement', tbl(
    `<tr>${th('Catégorie')}${th('Ventes avec')}${th('Taux')}${th('En moyenne')}</tr>` +
    attach.map(a=>`<tr>${td(a.label)}${td(a.n+' / '+nbTk)}${td(a.pct+'%',true)}${td(a.oneIn?('1 client sur '+String(a.oneIn).replace('.',',')):'—')}</tr>`).join('')));

  const trRows = tranches.filter(t=>t.n).map(t=>`<tr>${td(t.label)}${td(fmt(t.sum/t.n),true)}${td(t.n)}</tr>`).join('');
  const taRows = Object.keys(tailles).filter(k=>tailles[k].n).map(k=>`<tr>${td(k)}${td(fmt(tailles[k].sum/tailles[k].n),true)}${td(tailles[k].n)}</tr>`).join('');
  S.panierMoyen = sec('🛒 Panier moyen', tbl(
    `<tr>${th('Tranche horaire')}${th('Panier moy.')}${th('Ventes')}</tr>` + trRows) +
    '<div style="height:8px"></div>' + tbl(
    `<tr>${th('Taille commande')}${th('Panier moy.')}${th('Ventes')}</tr>` + taRows));

  S.ventesDetail = sec(`🧾 Ventes (${nbTk})`, tbl(
    `<tr>${th('Heure')}${th('Articles')}${th('Paiement')}${th('Emplacement')}${th('Total')}</tr>` +
    ventesShown.map(t=>`<tr>${td(dayLabel(t.date)+' '+t.time)}${td(t.nbArt)}${td(t.pay)}${td(t.loc)}${td(fmt(t.total),true)}</tr>`).join('')) +
    (ventes.length > 30 ? `<p style="font-size:12px;color:#999">… et ${ventes.length-30} autres ventes (voir le Google Sheet).</p>` : ''));

  S.recommandations = `<h3 style="color:${C.brand};margin:26px 0 4px;font-size:16px">💡 ${opts.recoTitle}</h3>
      <div style="background:#fff;border:1px solid ${C.line};border-radius:8px;padding:12px 16px">${recoHtml}</div>`;

  const ORDER = ['kpis','paiements','caParJour','articlesParJour','pizzasParJour','parHeure',
                 'categories','emplacement','starParCategorie','topArticles','flopArticles',
                 'attachement','panierMoyen','ventesDetail','recommandations'];

  const wrap = inner => `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:auto;background:${C.bg};padding:0 0 24px;border-radius:12px;overflow:hidden">
    <div style="background:${C.brand};color:#fff;padding:22px 24px">
      <div style="font-size:20px;font-weight:800">🍕 La Casetta — ${opts.titleLabel}</div>
      <div style="opacity:.85;font-size:13px;margin-top:4px">${periode}</div>
    </div>
    <div style="padding:20px 24px">
      ${inner}
      <p style="font-size:12px;color:#999;margin-top:24px">
        Détails complets dans ton Google Sheet «&nbsp;La Casetta — Caisse&nbsp;».<br>
        ${opts.whenText}
      </p>
    </div>
  </div>`;

  const subject = `🍕 La Casetta — ${opts.subjectKind} : ${fmt(caTot)} · ${nbTk} vente${nbTk > 1 ? 's' : ''} (${periode})`;

  // Un e-mail par destinataire, composé uniquement de SES sections activées
  RECIPIENTS.forEach(rcpt => {
    const cfg = rcpt.sections || {};
    const inner = ORDER.filter(k => cfg[k] !== false && S[k]).map(k => S[k]).join('');
    MailApp.sendEmail({ to: rcpt.email, subject: subject, htmlBody: wrap(inner) });
  });
}

// À EXÉCUTER UNE FOIS depuis l'éditeur : programme l'envoi chaque vendredi à 22h.
function createWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendWeeklyReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendWeeklyReport')
    .timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(22).nearMinute(0).create();
}

// Le récap du jour est désormais envoyé AUTOMATIQUEMENT ~2 min après la dernière vente
// (via scheduleDailyReport, appelé par doPost). Plus besoin de déclencheur horaire.
// Exécute cette fonction UNE FOIS si tu avais programmé l'ancien envoi à 22h15, pour le retirer.
function removeLegacyDailyTrigger() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendDailyReport') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log(n + ' ancien(s) déclencheur(s) quotidien(s) supprimé(s). Le récap part désormais après la dernière vente.');
}

// ════════════════════════════════════════════
//  PUBLICATION FACEBOOK AUTOMATIQUE (emplacement du jour)
// ════════════════════════════════════════════

const FB_API = 'https://graph.facebook.com/v21.0';

// Calendrier hebdo La Casetta + lien Maps (0=dim … 6=sam). Aligné sur le site.
const FB_SCHEDULE = {
  1: { city: 'Feings',                 place: 'Parking de l\'école',     hours: '18h–21h30', map: 'https://maps.google.com/maps?q=47.437806,1.353444' },
  2: { city: 'Thenay',                 place: 'Place de l\'église',      hours: '18h–21h30', map: 'https://maps.google.com/maps?q=47.387500,1.288194' },
  3: { city: 'Cande-sur-Beuvron',      place: 'Place des Cèdres',        hours: '18h–21h30', map: 'https://maps.google.com/maps?q=47.497778,1.263583' },
  4: { city: 'Rilly-sur-Loire',        place: 'Parking salle des fêtes', hours: '18h–21h30', map: 'https://maps.google.com/maps?q=47.467056,1.133167' },
  5: { city: 'Saint-Gervais-la-Forêt', place: 'Place du Marché',         hours: '18h–21h30', map: 'https://maps.google.com/maps?q=47.5671834,1.3587285' },
};

// ⚠️ NE PAS mettre le jeton dans ce fichier (repo public !).
// Renseigne tes 2 valeurs ci-dessous, exécute setupFacebook() UNE FOIS,
// puis efface-les (elles sont enregistrées dans les Script Properties privées).
function setupFacebook() {
  const PAGE_ID    = 'COLLE_ICI_TON_ID_DE_PAGE';
  const PAGE_TOKEN = 'COLLE_ICI_TON_JETON_DE_PAGE';
  const p = PropertiesService.getScriptProperties();
  p.setProperty('FB_PAGE_ID', PAGE_ID);
  p.setProperty('FB_PAGE_TOKEN', PAGE_TOKEN);
  Logger.log('Identifiants Facebook enregistrés. Tu peux maintenant effacer les valeurs ci-dessus.');
}

// Construit le texte du post pour l'emplacement du jour.
function fbMessageForToday() {
  const s = FB_SCHEDULE[new Date().getDay()];
  if (!s) return null; // week-end : pas de service
  return `📍 Aujourd'hui, La Casetta est à ${s.city} — ${s.place} !\n`
       + `🕕 Service de ${s.hours}\n\n`
       + `Venez déguster nos pizzas artisanales, pâte maturée et produits frais 🍕🔥\n\n`
       + `🗺️ Itinéraire : ${s.map}`;
}

// Publie l'emplacement du jour sur la Page Facebook. (Déclenché chaque jour.)
function postTodayLocation() {
  const message = fbMessageForToday();
  if (!message) { Logger.log('Week-end — aucune publication.'); return; }

  const p     = PropertiesService.getScriptProperties();
  const pageId = p.getProperty('FB_PAGE_ID');
  const token  = p.getProperty('FB_PAGE_TOKEN');
  if (!pageId || !token) throw new Error('Identifiants Facebook manquants — exécute setupFacebook() d\'abord.');

  const res = UrlFetchApp.fetch(`${FB_API}/${pageId}/feed`, {
    method: 'post',
    muteHttpExceptions: true,
    payload: { message: message, access_token: token }
  });
  const json = JSON.parse(res.getContentText());
  if (json.error) throw new Error('Erreur Facebook : ' + json.error.message);
  Logger.log('Publié ✓ id=' + json.id);
  return json;
}

// Test sans dépendre du jour : publie l'emplacement du LUNDI (Feings).
function testPostFacebook() {
  const s = FB_SCHEDULE[1];
  const p = PropertiesService.getScriptProperties();
  const msg = `📍 [TEST] La Casetta serait à ${s.city} — ${s.place} ! 🕕 ${s.hours}\n🗺️ ${s.map}`;
  const res = UrlFetchApp.fetch(`${FB_API}/${p.getProperty('FB_PAGE_ID')}/feed`, {
    method:'post', muteHttpExceptions:true,
    payload:{ message: msg, access_token: p.getProperty('FB_PAGE_TOKEN') }
  });
  Logger.log(res.getContentText());
}

// À EXÉCUTER UNE FOIS : programme la publication chaque jour à 10h.
function createDailyFacebookTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'postTodayLocation') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('postTodayLocation')
    .timeBased().everyDays(1).atHour(10).nearMinute(0).create();
}

// ════════════════════════════════════════════
//  doPost / doGet
// ════════════════════════════════════════════

function doPost(e) {
  try {
    const ss    = getOrCreateSpreadsheet();
    const data  = JSON.parse(e.postData.contents);

    // Synchronisation du catalogue d'articles (partagé entre tous les iPads).
    if (data && !Array.isArray(data) && data.catalogue) {
      const n = saveCatalogue(ss, data.catalogue, data.updatedAt);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, catalogue: n }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Relevés de température : un onglet par enceinte (frigo / congélateur).
    if (data && !Array.isArray(data) && data.tempSync) {
      const n = recordTemperatures(ss, data.tempSync);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, temps: n }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = getOrCreateTransactionsSheet(ss);
    const txs   = Array.isArray(data) ? data : [data];

    const lr  = sheet.getLastRow();
    const ids = lr > 1 ? sheet.getRange(2,1,lr-1,1).getValues().flat() : [];

    let added = 0;
    txs.forEach(tx => {
      if (ids.includes(tx.id)) return;
      const d    = new Date(tx.date);                 // Date réelle, stockée telle quelle
      const time = Utilities.formatDate(d, TZ, 'HH:mm');
      const sync = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
      const stat = tx.cancelled ? 'Annulé' : 'Validé';
      const nb   = tx.lines.reduce((s,l)=>s+l.qty,0);
      const loc  = tx.location || '';
      tx.lines.forEach(l => {
        sheet.appendRow([tx.id, d, time, '', l.name, l.category||'', l.price, l.qty, l.subtotal,
                         tx.total, nb, tx.method, loc, stat, sync]);
        added++;
      });
    });

    if (added > 0) {
      sheet.getRange('B2:B').setNumberFormat('dd/mm/yyyy');
      numberTickets(sheet);
      createAllSheets(ss);
      scheduleDailyReport();   // récap du jour ~2 min après la dernière vente
    }

    return ContentService.createTextOutput(JSON.stringify({ok:true, lines:added}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false, error:err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ════════════════════════════════════════════
//  CATALOGUE D'ARTICLES (partagé entre tous les iPads)
// ════════════════════════════════════════════
const CAT_HEADERS = ['id', 'name', 'category', 'price', 'emoji', 'order', 'updatedAt', 'active'];

function getCatalogueSheet(ss) {
  let sh = ss.getSheetByName('Catalogue');
  if (!sh) {
    sh = ss.insertSheet('Catalogue');
    sh.appendRow(CAT_HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getCatalogue(ss) {
  const sh   = getCatalogueSheet(ss);
  const vals = sh.getDataRange().getValues();
  let updatedAt = '';
  const articles = vals.slice(1)
    .filter(r => r[0] !== '' && r[0] != null)
    .map(r => {
      if (r[6] && String(r[6]) > updatedAt) updatedAt = String(r[6]);
      // active = dernière colonne ; vide (anciennes lignes) => actif par défaut.
      const active = (r[7] === '' || r[7] == null) ? true
                   : (r[7] === true || String(r[7]).toLowerCase() === 'true');
      return { id: String(r[0]), name: String(r[1]), category: String(r[2]),
               price: Number(r[3]), emoji: String(r[4] || ''), order: Number(r[5] || 0),
               active: active };
    })
    .sort((a, b) => a.order - b.order);
  return { articles: articles, updatedAt: updatedAt };
}

function saveCatalogue(ss, articles, updatedAt) {
  const sh  = getCatalogueSheet(ss);
  const now = updatedAt || new Date().toISOString();
  sh.clearContents();
  sh.getRange(1, 1, 1, CAT_HEADERS.length).setValues([CAT_HEADERS]);
  const rows = (articles || []).map((a, i) =>
    [a.id, a.name, a.category, a.price, a.emoji || '', (a.order != null ? a.order : i), now,
     a.active !== false]);
  if (rows.length) sh.getRange(2, 1, rows.length, CAT_HEADERS.length).setValues(rows);
  sh.setFrozenRows(1);
  return rows.length;
}

// ════════════════════════════════════════════
//  RELEVÉS DE TEMPÉRATURE — un onglet par enceinte (frigo / congélateur)
// ════════════════════════════════════════════
const TEMP_HEADERS = ['Date', 'Température (°C)', 'Initiales', 'Type', 'Mis à jour le'];

// Nom d'onglet sûr (les caractères interdits par Sheets sont retirés).
function tempSheetName(name) {
  const clean = String(name || 'Enceinte').replace(/[:\\\/?*\[\]]/g, ' ').trim().slice(0, 90);
  return '🌡️ ' + (clean || 'Enceinte');
}

// Enregistre les températures quotidiennes d'une enceinte dans son propre onglet.
// payload : { enclosure, type, month, days:[{date:'AAAA-MM-JJ', temp, initials}] }
function recordTemperatures(ss, payload) {
  if (!payload || !Array.isArray(payload.days)) return 0;
  const sh = getOrCreateTempSheet(ss, tempSheetName(payload.enclosure));
  const now = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');

  // Index des lignes existantes par date (AAAA-MM-JJ) pour faire un upsert.
  const lr = sh.getLastRow();
  const index = {};
  if (lr > 1) {
    const dates = sh.getRange(2, 1, lr - 1, 1).getValues();
    dates.forEach((r, i) => { index[dateKey(r[0])] = i + 2; });
  }
  let count = 0;
  payload.days.forEach(d => {
    if (!d || !d.date) return;
    const row = [asDate(d.date), d.temp, d.initials || '', payload.type || '', now];
    const at = index[d.date];
    if (at) sh.getRange(at, 1, 1, TEMP_HEADERS.length).setValues([row]);
    else { sh.appendRow(row); index[d.date] = sh.getLastRow(); }
    count++;
  });
  sh.getRange('A2:A').setNumberFormat('dd/mm/yyyy');
  return count;
}

function getOrCreateTempSheet(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(TEMP_HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}
function dateKey(v) {
  if (v === '' || v == null) return '';
  const d = asDate(v);
  return isNaN(d.getTime()) ? String(v) : Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

// Renvoie tous les relevés de température (un objet par enceinte) pour que le POS
// les recharge à l'ouverture, comme les ventes.
function getAllTemperatures(ss) {
  const sheets = ss.getSheets().filter(s => s.getName().indexOf('🌡️ ') === 0);
  return sheets.map(sh => {
    const vals = sh.getDataRange().getValues();
    let type = 'frigo';
    const entries = [];
    vals.slice(1).forEach(r => {
      const date = dateKey(r[0]);
      if (!date) return;
      if (String(r[3]).toLowerCase() === 'congelateur') type = 'congelateur';
      entries.push({ date: date, temp: r[1], initials: r[2] });
    });
    return { name: sh.getName().replace('🌡️ ', ''), type: type, entries: entries };
  });
}

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : '';
  const cb     = e && e.parameter ? e.parameter.callback : '';

  let payload;
  if (action === 'deletelast') {
    payload = { ok: true, deleted: deleteLastSale() };
  } else if (action === 'transactions') {
    payload = { ok: true, transactions: getAllTransactions() };
  } else if (action === 'rebuild') {
    rebuildAll();
    payload = { ok: true, rebuilt: true };
  } else if (action === 'cancel') {
    payload = { ok: true, cancelled: cancelTicket(e.parameter.id) };
  } else if (action === 'catalogue') {
    const c = getCatalogue(getOrCreateSpreadsheet());
    payload = { ok: true, articles: c.articles, updatedAt: c.updatedAt };
  } else if (action === 'temperatures') {
    payload = { ok: true, enclosures: getAllTemperatures(getOrCreateSpreadsheet()) };
  } else {
    payload = { ok: true };
  }

  const json = JSON.stringify(payload);
  // JSONP si un callback est fourni (permet la lecture depuis le navigateur sans CORS)
  if (cb) {
    return ContentService.createTextOutput(cb + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// Reconstruit toutes les transactions (1 objet/ticket) à partir des lignes de la feuille.
function getAllTransactions() {
  const ss    = getOrCreateSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return [];
  const lr = sheet.getLastRow();
  if (lr < 2) return [];
  const data = sheet.getRange(2, 1, lr - 1, HEADERS.length).getValues();
  const map = {};
  data.forEach(r => {
    const id = r[COL.id];
    if (!id) return;
    if (!map[id]) {
      const d = r[COL.date] instanceof Date ? r[COL.date] : new Date(r[COL.date]);
      map[id] = {
        id: id,
        date: d.toISOString(),
        location: r[COL.loc] || '',
        method: r[COL.pay],
        total: Number(r[COL.total]) || 0,
        cancelled: r[COL.statut] === 'Annulé',
        lines: []
      };
    }
    map[id].lines.push({
      name: r[COL.article], category: normCat(r[COL.cat]),
      price: Number(r[COL.pu]) || 0, qty: Number(r[COL.qty]) || 0, subtotal: Number(r[COL.sub]) || 0
    });
  });
  return Object.values(map);
}

// ════════════════════════════════════════════
//  OUTILS
// ════════════════════════════════════════════

// Reconstruit toutes les feuilles de synthèse à partir de l'onglet Transactions.
function rebuildAll() {
  const ss = getOrCreateSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;
  fixOldCategories(sheet);
  numberTickets(sheet);
  createAllSheets(ss);
}

// Réécrit la colonne Catégorie des lignes historiques (Pizzas grandes → Grande,
// Pizzas petites → Petite, Suppléments → Supp) pour que la feuille Transactions
// n'ait plus qu'un seul libellé par catégorie. Idempotent : ne réécrit que si besoin.
function fixOldCategories(sheet) {
  const lr = sheet.getLastRow();
  if (lr < 2) return;
  const rng  = sheet.getRange(2, COL.cat + 1, lr - 1, 1);
  const vals = rng.getValues();
  let changed = false;
  vals.forEach(v => {
    const n = normCat(v[0]);
    if (v[0] !== '' && n !== v[0]) { v[0] = n; changed = true; }
  });
  if (changed) rng.setValues(vals);
}

// À EXÉCUTER UNE FOIS : recalcule tous les onglets à CHAQUE OUVERTURE du Google Sheet.
function createOpenTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'rebuildAll') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('rebuildAll')
    .forSpreadsheet(SpreadsheetApp.openById(SPREADSHEET_ID))
    .onOpen().create();
}

// Passe un ticket au statut « Annulé » (toutes ses lignes) puis recalcule les onglets.
function cancelTicket(id) {
  if (!id) return 0;
  const ss    = getOrCreateSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return 0;
  const lr = sheet.getLastRow();
  if (lr < 2) return 0;
  const ids = sheet.getRange(2, 1, lr - 1, 1).getValues().flat();
  let count = 0;
  ids.forEach((rid, i) => {
    if (rid === id) { sheet.getRange(i + 2, COL.statut + 1).setValue('Annulé'); count++; }
  });
  if (count > 0) createAllSheets(ss);
  Logger.log('Ticket ' + id + ' : ' + count + ' ligne(s) passée(s) en Annulé.');
  return count;
}

// Supprime la DERNIÈRE vente (dernier ticket) de la feuille Transactions,
// puis renumérote et recalcule tous les onglets.
function deleteLastSale() {
  const ss    = getOrCreateSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    Logger.log('⚠️ Onglet "Transactions" introuvable dans ce classeur.');
    Logger.log('Classeur ouvert : ' + ss.getUrl());
    Logger.log('Onglets présents : ' + ss.getSheets().map(s => s.getName()).join(', '));
    Logger.log('→ Tu édites probablement le mauvais projet de script (celui-ci a créé un classeur vide). Édite le projet lié à ton déploiement /exec.');
    return null;
  }
  const lr = sheet.getLastRow();
  if (lr < 2) { Logger.log('Aucune vente à supprimer.'); return null; }

  const ids    = sheet.getRange(2, 1, lr - 1, 1).getValues().flat();
  const lastId = ids[ids.length - 1];

  // Le dernier ticket = lignes contiguës du bas partageant le même ID
  let count = 0;
  for (let i = ids.length - 1; i >= 0 && ids[i] === lastId; i--) count++;

  sheet.deleteRows(lr - count + 1, count);
  numberTickets(sheet);
  createAllSheets(ss);

  Logger.log(`Supprimé ${count} ligne(s) du ticket ${lastId}. Tous les onglets ont été mis à jour.`);
  return { id: lastId, rows: count };
}
