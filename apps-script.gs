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
  if (!sheet || sheet.getLastRow() < 2) return [];
  const lr = sheet.getLastRow();
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
      dKey: dayKey(r[COL.date]), date: asDate(r[COL.date]),
      tid: r[COL.id]   // rattache la ligne à son ticket (co-achats, paniers types)
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
    // Nombre de pizzas du ticket : repère les commandes familles / groupes.
    if (/petite|grande/i.test(normCat(r[COL.cat])))
      tickets[id].pizzas = (tickets[id].pizzas || 0) + (Number(r[COL.qty]) || 0);
  });

  return { lines, tickets: Object.values(tickets), ticketMap: tickets };
}

// helpers d'agrégation
function add(map, key, n) { map[key] = (map[key]||0) + n; }
function sortDescByVal(obj, idx) {
  return Object.entries(obj).sort((a,b)=> (idx==null? b[1]-a[1] : b[1][idx]-a[1][idx]));
}

// Médiane : plus honnête que la moyenne sur des paniers très dispersés.
function median(arr) {
  const s = arr.slice().sort((a,b) => a-b), n = s.length;
  return n ? (n % 2 ? s[(n-1)/2] : (s[n/2-1] + s[n/2]) / 2) : 0;
}
function isOffert(a)   { return /\(offert/i.test(String(a)); }
function isPizzaCat(c) { return /petite|grande/i.test(String(c)); }
// « Regina (G) » → « Regina » : rapproche les deux tailles d'une même recette.
function baseName(a)   { return String(a).replace(/\s*\((P|G)\)\s*$/i, ''); }
// Prix unitaire moyen RÉELLEMENT constaté d'une catégorie (jamais codé en dur :
// il suit automatiquement les changements de carte).
function prixMoyenCat(lx, re) {
  const s = lx.filter(l => re.test(l.cat) && !isOffert(l.art));
  const q = s.reduce((a,l) => a + l.qty, 0);
  return q ? s.reduce((a,l) => a + l.sub, 0) / q : 0;
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
// Format français lisible : séparateur de milliers insécable (« 9 688,00 € »).
const eurStr = n => {
  const v = Math.round((Number(n)||0)*100)/100;
  const p = Math.abs(v).toFixed(2).split(".");
  // Espaces INSÉCABLES : un montant ne doit jamais être coupé en fin de ligne.
  return (v < 0 ? "-" : "") + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "," + p[1] + " €";
};

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

// Récap hebdo — DÉSACTIVÉ (le corps d'origine est dans l'historique git).
// N'envoie PLUS aucun e-mail. Surtout : si un ancien déclencheur (ex. lundi 8h,
// resté dans les Déclencheurs Google) la rappelle encore, elle se SUPPRIME
// elle-même, ainsi que tout autre déclencheur « sendWeeklyReport ». Le récap
// hebdomadaire s'arrête donc de lui-même dès sa prochaine occurrence, sans
// intervention — c'est le filet quand on oublie de purger les déclencheurs.
function sendWeeklyReport() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendWeeklyReport') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('Récap hebdo désactivé : aucun e-mail envoyé, ' + n + ' déclencheur(s) supprimé(s).');
}

// Récap du jour (ventes du jour même).
// Déclenché par l'IPAD, jamais à heure fixe : quand l'iPad a retrouvé le WiFi et
// que TOUTES ses ventes locales sont remontées sur le Sheet (file vidée), il
// demande l'envoi (action=armdailyreport). Chaque nouvelle vente remontée réarme
// le compte à rebours → l'e-mail part 2 min après la DERNIÈRE vente remontée.
// Le serveur ne décide plus seul : lui ne sait pas s'il reste des ventes bloquées
// sur un iPad ; l'iPad, si.
function sendDailyReport() {
  // Nettoie les déclencheurs ponctuels « sendDailyReport » (celui qui vient de se
  // déclencher + un éventuel ancien déclencheur horaire 22h15 encore installé).
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
      subjectKind:'Récap jour',
      whenText:'Email envoyé 2 min après la dernière vente remontée depuis l\'iPad.',
      periode: Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy'),
      emptyKind:'aucune vente aujourd\'hui' });
}

// (Ré)arme l'envoi du récap 2 min plus tard. Appelé UNIQUEMENT sur demande de
// l'iPad (action=armdailyreport), c.-à-d. quand sa file de ventes est vide.
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

// À EXÉCUTER UNE FOIS depuis l'éditeur pour ARRÊTER TOUT DE SUITE le récap hebdo :
// supprime TOUS les déclencheurs « sendWeeklyReport », quel que soit leur horaire
// (le résidu qui envoie le lundi 8h y compris). À défaut de l'exécuter, le récap
// s'arrête quand même de lui-même à sa prochaine occurrence (sendWeeklyReport
// est devenu auto-destructeur), mais ceci évite de recevoir un dernier e-mail.
function removeWeeklyReport() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendWeeklyReport') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log(n + ' déclencheur(s) hebdo supprimé(s). Plus aucun récap de la semaine ne sera envoyé.');
}

// Diagnostic : liste TOUS les déclencheurs installés (fonction + type). Utile
// pour repérer un envoi fantôme dont on ne connaît pas la fonction — le détail
// horaire, lui, se lit dans le panneau « Déclencheurs » (icône ⏰) de l'éditeur.
function listAllTriggers() {
  const lignes = ScriptApp.getProjectTriggers().map(t => '• ' + t.getHandlerFunction() + '  (' + t.getEventType() + ')');
  Logger.log(lignes.length ? lignes.join('\n') : 'Aucun déclencheur installé.');
}

// ════════════════════════════════════════════
//  EMAIL MENSUEL — le 1er du mois à 8h, sur le mois écoulé
// ════════════════════════════════════════════
// Le bilan que seul le recul d'un mois permet : comparaison au mois précédent,
// records, semaine par semaine, soirée type par commune (chaque jour ouvré = une
// commune de la tournée), suivi HACCP, gestes commerciaux — plus les
// recommandations habituelles et des idées à tester le mois suivant, déduites
// des chiffres du mois.
// Installation (UNE FOIS) : exécuter setupMonthlyTrigger() dans l'éditeur.
// Aperçu immédiat avec les données réelles : exécuter previewMonthlyReportNow().

const MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function monthLabelFr(k)   { return MOIS_FR[+k.slice(5, 7) - 1] + ' ' + k.slice(0, 4); }
// Nom du mois seul, et élisions françaises : « ce qu'août », « objectif d'octobre ».
function moisNom(k) { return MOIS_FR[+k.slice(5, 7) - 1].toLowerCase(); }
function moisDe(k)  { const m = moisNom(k); return (/^[aeiouâéèêîôû]/.test(m) ? 'd\'' : 'de ') + m; }
function moisQue(k) { const m = moisNom(k); return (/^[aeiouâéèêîôû]/.test(m) ? 'qu\'' : 'que ') + m; }
function prevMonthKeyOf(k) { const y = +k.slice(0, 4), m = +k.slice(5, 7); return m === 1  ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0'); }
function nextMonthKeyOf(k) { const y = +k.slice(0, 4), m = +k.slice(5, 7); return m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0'); }
function daysInMonthOf(k)  { return new Date(+k.slice(0, 4), +k.slice(5, 7), 0).getDate(); }

// Repli si le mois ne contient aucun rendez-vous tombant un soir de tournée.
const IDEE_SAISON = {
  '01': '🗓️ Mois calme : carte resserrée, et une offre « pizza + boisson chaude » pour les fidèles qui bravent le froid.',
  '02': '🗓️ Le mois le plus court de l\'année : c\'est celui où une animation simple se remarque le plus.',
  '03': '🗓️ Printemps : une recette aux légumes primeurs en édition limitée, le temps d\'un mois seulement.',
  '04': '🗓️ Les soirées s\'allongent : les gens ressortent, c\'est le moment de reprendre le rythme des posts.',
  '05': '🗓️ Ponts et jours fériés : publie tes dates d\'ouverture à l\'avance, personne n\'aime se déplacer pour rien.',
  '06': '🗓️ Fêtes d\'écoles et kermesses : propose les précommandes groupées aux associations du coin.',
  '07': '🗓️ Été : boissons fraîches bien visibles au camion, et un dessert frais mis en avant.',
  '08': '🗓️ Vacanciers de passage : un QR code du menu et des horaires affiché sur le camion capte ceux qui ne te connaissent pas.',
  '09': '🗓️ Rentrée : c\'est le mois où les habitudes se prennent — carte de fidélité en main propre à chaque nouveau client.',
  '10': '🗓️ Soirées fraîches : mets en avant les pizzas généreuses, ce sont celles qu\'on choisit quand il fait froid.',
  '11': '🗓️ La nuit tombe tôt : soigne l\'éclairage du camion, on doit te voir de loin.',
  '12': '🗓️ Fêtes : bons cadeaux (carte 10 pizzas) et une pizza festive en édition limitée.',
};

// Rendez-vous du calendrier qui tombent un soir de tournée : la date est croisée
// avec le planning des communes pour que l'idée soit immédiatement actionnable.
function eventsOfMonth(kKey) {
  const y = +kKey.slice(0, 4), m = +kKey.slice(5, 7), ev = [];
  const push = (d, txt) => {
    if (d < 1 || d > daysInMonthOf(kKey)) return;
    const g = new Date(y, m - 1, d).getDay();
    if (!FB_SCHEDULE[g]) return;                     // week-end : pas de tournée
    ev.push({ d: d, g: g, city: FB_SCHEDULE[g].city, txt: txt });
  };
  if (m === 2)  { push(2, 'Chandeleur : mets un dessert en avant.'); push(14, 'Saint-Valentin : une pizza à partager, annoncée une semaine avant.'); }
  if (m === 4)  push(1, 'Poisson d\'avril : un post décalé, c\'est le jour où les gens partagent le plus.');
  if (m === 5)  { push(1, 'Jour férié : dis clairement si tu ouvres.'); push(8, 'Jour férié : dis clairement si tu ouvres.'); }
  if (m === 6)  push(21, 'Fête de la musique : les gens sortent et dînent tard.');
  if (m === 7)  push(14, 'Fête nationale : soirée feux d\'artifice, sers plus tôt et annonce-le.');
  if (m === 9)  push(1, 'Rentrée : le mois où les habitudes se prennent, carte de fidélité en main propre.');
  if (m === 10) push(31, 'Halloween : un petit geste pour les enfants marque les familles.');
  if (m === 11) {
    push(11, 'Jour férié : dis clairement si tu ouvres.');
    const prem = new Date(y, 10, 1).getDay();        // 3e jeudi = Beaujolais nouveau
    push(((4 - prem + 7) % 7) + 1 + 14, 'Beaujolais nouveau : ambiance conviviale au camion.');
  }
  if (m === 12) { push(24, 'Réveillon : beaucoup cherchent une solution simple pour dîner.'); push(31, 'Saint-Sylvestre : précommandes à annoncer dès le 20.'); }
  return ev.sort((a, b) => a.d - b.d);
}

// Ventes annulées du mois (absentes de readValidatedRows) : nombre + montant.
function readCancelledStats(ss, mKey) {
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return { n: 0, ca: 0 };
  const ids = {};
  sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues()
    .filter(r => r[COL.id] && r[COL.statut] === 'Annulé' && dayKey(r[COL.date]).slice(0, 7) === mKey)
    .forEach(r => { ids[r[COL.id]] = Number(r[COL.total]) || 0; });
  const list = Object.values(ids);
  return { n: list.length, ca: list.reduce((a, b) => a + b, 0) };
}

// Suivi HACCP du mois : jours réellement relevés par enceinte (onglets « 🌡️ … »).
function tempMonthStats(ss, mKey) {
  return ss.getSheets().filter(s => s.getName().indexOf('🌡️ ') === 0).map(sh => {
    const days = {};
    sh.getDataRange().getValues().slice(1).forEach(r => {
      const k = dateKey(r[0]);
      if (k.slice(0, 7) === mKey && r[1] !== '' && r[1] != null) days[k] = 1;
    });
    return { name: sh.getName().replace('🌡️ ', ''), done: Object.keys(days).length };
  });
}

// Point d'entrée du déclencheur (1er du mois) : bilan du mois qui vient de se terminer.
function sendMonthlyReport() {
  const lastOfPrev = new Date();
  lastOfPrev.setDate(0);   // dernier jour du mois précédent
  deliverMonthlyReport(Utilities.formatDate(lastOfPrev, TZ, 'yyyy-MM'), null);
}

// Aperçu immédiat : le mois EN COURS (du 1er à aujourd'hui), envoyé tout de suite
// aux mêmes destinataires, avec un bandeau « Aperçu » pour éviter toute confusion.
function previewMonthlyReportNow() {
  const now = new Date();
  deliverMonthlyReport(Utilities.formatDate(now, TZ, 'yyyy-MM'), +Utilities.formatDate(now, TZ, 'dd'));
}

// À EXÉCUTER UNE FOIS depuis l'éditeur : programme l'envoi chaque 1er du mois en soirée.
// Volontairement le SOIR du 1er (et non le matin) : la dernière soirée du mois est
// souvent hors réseau et ne remonte sur le Sheet que le lendemain quand l'iPad
// retrouve le wifi ; attendre le soir du 1er laisse le temps à ces ventes d'arriver.
function setupMonthlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendMonthlyReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendMonthlyReport').timeBased().onMonthDay(1).atHour(20).create();
  Logger.log('Récap mensuel installé : chaque 1er du mois vers 20h, sur le mois écoulé.');
}

// Construit et envoie le récap du mois `mKey` (aaaa-mm).
// `upToDay` : nul pour un mois complet ; sinon jour limite (mode aperçu).
function deliverMonthlyReport(mKey, upToDay) {
  const ss    = getOrCreateSpreadsheet();
  const stats = computeStats(readValidatedRows(ss));
  const pKey  = prevMonthKeyOf(mKey);
  const nKey  = nextMonthKeyOf(mKey);

  const tk  = stats.tickets.filter(t => t.dKey.slice(0, 7) === mKey);
  const ln  = stats.lines.filter(l => l.dKey.slice(0, 7) === mKey);
  const tkP = stats.tickets.filter(t => t.dKey.slice(0, 7) === pKey);
  const lnP = stats.lines.filter(l => l.dKey.slice(0, 7) === pKey);

  if (!tk.length) { Logger.log('Aucune vente en ' + monthLabelFr(mKey) + ' — pas de récap mensuel.'); return; }

  const fmt = eurStr;
  const plur = (n, mot) => n + ' ' + mot + (n > 1 ? 's' : '');   // « 1 vente » / « 2 ventes »
  const caTot  = tk.reduce((a, t) => a + t.total, 0),  caTotP  = tkP.reduce((a, t) => a + t.total, 0);
  const nbTk   = tk.length,                            nbTkP   = tkP.length;
  const nbArt  = ln.reduce((a, l) => a + l.qty, 0),    nbArtP  = lnP.reduce((a, l) => a + l.qty, 0);
  const panier = caTot / nbTk,                         panierP = nbTkP ? caTotP / nbTkP : 0;

  // Badge d'évolution vs mois précédent (masqué si aucun historique).
  const delta = (cur, prev) => {
    if (!tkP.length) return '';
    if (!prev) return '<div style="font-size:11px;color:#888">nouveau</div>';
    const p  = Math.round((cur - prev) / prev * 100);
    const up = p >= 0;
    return `<div style="font-size:11px;font-weight:700;color:${up ? '#2c6b2f' : '#9b2c1e'}">${up ? '▲ +' + p : '▼ ' + Math.abs(p)}%</div>`;
  };

  // ── Agrégations ─────────────────────────────────────────────────────────────
  const byDay = {};
  tk.forEach(t => { const o = byDay[t.dKey] || (byDay[t.dKey] = { ca: 0, n: 0, date: t.date }); o.ca += t.total; o.n++; });
  const dayKeys    = Object.keys(byDay).sort();
  const joursActifs  = dayKeys.length;
  const joursActifsP = Object.keys(tkP.reduce((m, t) => (m[t.dKey] = 1, m), {})).length;

  // Durée réelle de service (premier → dernier encaissement) : sert au CA horaire.
  dayKeys.forEach(k => {
    const ts = tk.filter(t => t.dKey === k).map(t => +t.date);
    byDay[k].duree = (Math.max.apply(null, ts) - Math.min.apply(null, ts)) / 3600000;
  });

  // Lignes regroupées par ticket : co-achats, commandes familles, duos.
  const byTid = {};
  ln.forEach(l => (byTid[l.tid] = byTid[l.tid] || []).push(l));

  // Records du mois
  const bestDayK   = dayKeys.reduce((a, b) => byDay[a].ca >= byDay[b].ca ? a : b);
  const bestTicket = tk.reduce((a, t) => t.total > a.total ? t : a);
  const hourCA = {};
  tk.forEach(t => add(hourCA, t.hour, t.total));
  const bestHour = sortDescByVal(hourCA)[0];
  const artQty = {}, artCA = {}, artCAP = {};
  ln.forEach(l => { add(artQty, l.art, l.qty); add(artCA, l.art, l.sub); });
  lnP.forEach(l => add(artCAP, l.art, l.sub));
  const topQty = sortDescByVal(artQty).filter(e => !/\(offert/i.test(e[0]))[0];

  // Semaine par semaine (découpage par jours du mois : 1–7, 8–14, …)
  const weeks = {};
  tk.forEach(t => {
    const w = Math.min(4, Math.floor((+t.dKey.slice(8, 10) - 1) / 7));
    const o = weeks[w] || (weeks[w] = { ca: 0, n: 0 });
    o.ca += t.total; o.n++;
  });
  const maxWeekCA = Math.max.apply(null, Object.values(weeks).map(w => w.ca));
  const dernierJour = upToDay || daysInMonthOf(mKey);

  // Soirée type par jour de semaine — chaque jour ouvré étant une commune de la
  // tournée (FB_SCHEDULE), c'est de fait un comparatif des communes.
  const wd = {};
  tk.forEach(t => {
    const g = t.date.getDay();
    const o = wd[g] || (wd[g] = { ca: 0, n: 0, days: {} });
    o.ca += t.total; o.n++; o.days[t.dKey] = 1;
  });
  // Jours de tournée uniquement (lun–ven) : un ticket encaissé après minuit
  // tomberait sinon sur un samedi sans commune et fausserait la comparaison.
  const wdRows = [1, 2, 3, 4, 5].filter(g => wd[g]).map(g => {
    const o = wd[g], nd = Object.keys(o.days).length;
    return { g: g, jour: JOURS[g], city: FB_SCHEDULE[g] ? FB_SCHEDULE[g].city : '',
             soirees: nd, caMoy: o.ca / nd, tkMoy: o.n / nd, ca: o.ca };
  });

  // Paiements
  const caEsp  = tk.filter(t => t.pay === 'especes').reduce((a, t) => a + t.total, 0);
  const caEspP = tkP.filter(t => t.pay === 'especes').reduce((a, t) => a + t.total, 0);

  // Top / flop articles avec évolution
  const topArts  = sortDescByVal(artCA).slice(0, 10);
  const topNames = topArts.map(e => e[0]);
  const flopArts = sortDescByVal(artCA).slice(10).filter(e => !/\(offert/i.test(e[0])).slice(-5).reverse();

  // CA par catégorie (avec évolution)
  const catCA = {}, catCAP = {}, catQty = {};
  ln.forEach(l => { add(catCA, l.cat, l.sub); add(catQty, l.cat, l.qty); });
  lnP.forEach(l => add(catCAP, l.cat, l.sub));

  // Article star par catégorie
  const byCatArt = {};
  ln.forEach(l => {
    if (/\(offert/i.test(l.art)) return;
    const m = byCatArt[l.cat] || (byCatArt[l.cat] = {});
    const o = m[l.art] || (m[l.art] = { qty: 0, ca: 0 });
    o.qty += l.qty; o.ca += l.sub;
  });
  const catStars = Object.keys(byCatArt).map(cat => {
    const best = Object.entries(byCatArt[cat]).sort((a, b) => b[1].qty - a[1].qty)[0];
    return { cat: cat, art: best[0], qty: best[1].qty, ca: best[1].ca };
  }).sort((a, b) => b.ca - a.ca);

  // Taux d'attachement (avec rappel du mois précédent)
  const attachOf = (tkX) => [
    { label: '🥤 Boissons',    re: /boisson/i },
    { label: '🍮 Desserts',    re: /dessert/i },
    { label: '🧀 Suppléments', re: /supp/i },
  ].map(d => {
    const n = tkX.filter(t => Object.keys(t.cats || {}).some(c => d.re.test(c))).length;
    return { label: d.label, n: n, pct: tkX.length ? Math.round(n / tkX.length * 100) : 0 };
  });
  const attach = attachOf(tk), attachP = attachOf(tkP);

  // Gestes commerciaux & annulations
  const offertsQty = ln.filter(l => /\(offert/i.test(l.art)).reduce((a, l) => a + l.qty, 0);
  const cancelled  = readCancelledStats(ss, mKey);

  // Suivi HACCP
  const temps = tempMonthStats(ss, mKey);

  // ══════════════════════════════════════════════════════════════════════════
  //  COUCHE BUSINESS INTELLIGENCE
  // ══════════════════════════════════════════════════════════════════════════

  // ── Les 3 manettes du CA : soirées × ventes/soirée × panier ────────────────
  const tkParSoiree = nbTk / joursActifs;
  const sensSoiree  = caTot / joursActifs;    // ce que rapporte 1 soirée de plus
  const sensTicket  = joursActifs * panier;   // ce que rapporte 1 vente/soirée de plus
  const sensPanier  = nbTk;                   // ce que rapporte 1 € de panier de plus

  // ── Distribution des paniers : la médiane dit la vérité, pas la moyenne ────
  const medianePanier = median(tk.map(t => t.total));
  const TRANCHES = [['moins de 12 €', 0, 12], ['12 – 20 €', 12, 20], ['20 – 30 €', 20, 30], ['30 € et plus', 30, 1e9]];
  const distPanier = TRANCHES.map(function (t) {
    const s = tk.filter(x => x.total >= t[1] && x.total < t[2]);
    return { lab: t[0], n: s.length, ca: s.reduce((a, x) => a + x.total, 0) };
  });
  const maxDistN = Math.max.apply(null, distPanier.map(d => d.n));

  // ── Taille des tickets : le mono-article est le gisement le plus visible ───
  const TAILLES = ['1 article', '2 articles', '3 – 4 articles', '5 et plus'];
  const buckets = { '1 article': 0, '2 articles': 0, '3 – 4 articles': 0, '5 et plus': 0 };
  tk.forEach(t => {
    const k = t.nbArt <= 1 ? '1 article' : t.nbArt === 2 ? '2 articles' : t.nbArt <= 4 ? '3 – 4 articles' : '5 et plus';
    buckets[k]++;
  });
  const nbMono = buckets['1 article'];

  // ── Courbe de charge par demi-heure : où est le rush, où est le creux ──────
  const bySlot = {};
  tk.forEach(t => {
    const k = t.time.slice(0, 2) + (t.time.slice(3, 5) < '30' ? 'h00' : 'h30');
    const o = bySlot[k] || (bySlot[k] = { ca: 0, n: 0 });
    o.ca += t.total; o.n++;
  });
  const slotKeys = Object.keys(bySlot).sort();
  const maxSlotCA = Math.max.apply(null, slotKeys.map(k => bySlot[k].ca));
  const bestSlot  = sortDescByVal(bySlot, 'ca')[0];
  const caAvant19 = slotKeys.filter(k => k < '19h00').reduce((a, k) => a + bySlot[k].ca, 0);
  const caApres21 = slotKeys.filter(k => k >= '21h00').reduce((a, k) => a + bySlot[k].ca, 0);

  // ── Commandes familles / groupes (4 pizzas et plus) ────────────────────────
  const gros    = tk.filter(t => (t.pizzas || 0) >= 4);
  const caGros  = gros.reduce((a, t) => a + t.total, 0);
  const grosJour = {};
  gros.forEach(t => add(grosJour, t.date.getDay(), 1));
  const grosBestG = sortDescByVal(grosJour)[0];

  // ── Menu engineering : popularité × prix (le prix remplace la marge) ───────
  const pz = {};
  ln.forEach(l => {
    if (!isPizzaCat(l.cat) || isOffert(l.art)) return;
    const o = pz[l.art] || (pz[l.art] = { qty: 0, ca: 0 });
    o.qty += l.qty; o.ca += l.sub;
  });
  const pzNames = Object.keys(pz);
  const pzTotQty = pzNames.reduce((a, n) => a + pz[n].qty, 0);
  const puOf     = n => pz[n].qty ? pz[n].ca / pz[n].qty : 0;
  const seuilPop = pzNames.length ? 0.7 * pzTotQty / pzNames.length : 0;
  const pmp      = pzTotQty ? pzNames.reduce((a, n) => a + pz[n].ca, 0) / pzTotQty : 0;  // prix moyen pondéré
  const pmpPrev  = prixMoyenCat(lnP, /petite|grande/i);
  const QUADRANTS = [
    { k: 'star',   t: '⭐ Tes stars',           aide: 'populaires ET bien valorisées : ne touche à rien, montre-les en photo.' },
    { k: 'cheval', t: '🐴 Tes chevaux de labour', aide: 'ça se vend, mais ça rapporte peu : pousse la version grande ou un supplément.' },
    { k: 'enigme', t: '❓ Tes énigmes',          aide: 'bien valorisées mais méconnues : cite-les quand on te demande conseil.' },
    { k: 'mort',   t: '⚓ Tes poids morts',      aide: 'ni populaires ni valorisées : candidates à la rotation de carte.' },
  ];
  const quadrantOf = n => (pz[n].qty >= seuilPop)
    ? (puOf(n) >= pmp ? 'star' : 'cheval')
    : (puOf(n) >= pmp ? 'enigme' : 'mort');
  const menuMatrix = {};
  QUADRANTS.forEach(q => { menuMatrix[q.k] = []; });
  pzNames.forEach(n => menuMatrix[quadrantOf(n)].push(n));
  QUADRANTS.forEach(q => menuMatrix[q.k].sort((a, b) => pz[b].qty - pz[a].qty));

  // ── Pareto de la carte pizza + recettes qui ne pèsent plus rien ────────────
  const pizzaCA = {};
  ln.forEach(l => { if (isPizzaCat(l.cat) && !isOffert(l.art)) add(pizzaCA, l.art, l.sub); });
  const triPizza = sortDescByVal(pizzaCA);
  const totPizzaCA = triPizza.reduce((a, e) => a + e[1], 0);
  let cumPareto = 0, n80 = 0;
  triPizza.forEach(e => { if (cumPareto < totPizzaCA * 0.8) { cumPareto += e[1]; n80++; } });
  const mortes = triPizza.filter(e => e[1] < caTot * 0.005);
  const caMedianPizza = median(triPizza.map(e => e[1]));

  // ── Petite ou Grande ? Le trading-up recette par recette ───────────────────
  const mix = {};
  ln.forEach(l => {
    if (!isPizzaCat(l.cat) || isOffert(l.art)) return;
    const o = mix[baseName(l.art)] || (mix[baseName(l.art)] = { p: 0, g: 0 });
    if (/petite/i.test(l.cat)) o.p += l.qty; else o.g += l.qty;
  });
  const mixRows = Object.keys(mix).filter(n => mix[n].p + mix[n].g >= 8).map(n => ({
    n: n, p: mix[n].p, g: mix[n].g, pctG: Math.round(mix[n].g / (mix[n].p + mix[n].g) * 100)
  })).sort((a, b) => a.pctG - b.pctG);
  const pctGMed = mixRows.length ? median(mixRows.map(r => r.pctG)) : 0;
  // Écart de prix petite → grande : médiane des écarts RECETTE PAR RECETTE.
  // (Comparer les deux prix moyens globaux mélangerait les recettes et gonflerait
  // l'écart : ce sont rarement les mêmes recettes qui se vendent dans les 2 tailles.)
  const pgPrix = {};
  ln.forEach(l => {
    if (!isPizzaCat(l.cat) || isOffert(l.art) || !l.qty) return;
    const o = pgPrix[baseName(l.art)] || (pgPrix[baseName(l.art)] = { pCa: 0, pQ: 0, gCa: 0, gQ: 0 });
    if (/petite/i.test(l.cat)) { o.pCa += l.sub; o.pQ += l.qty; } else { o.gCa += l.sub; o.gQ += l.qty; }
  });
  const ecartsPG = Object.keys(pgPrix).filter(b => pgPrix[b].pQ && pgPrix[b].gQ)
    .map(b => pgPrix[b].gCa / pgPrix[b].gQ - pgPrix[b].pCa / pgPrix[b].pQ);
  const ecartPG = ecartsPG.length ? median(ecartsPG)
    : Math.max(0, prixMoyenCat(ln, /grande/i) - prixMoyenCat(ln, /petite/i));
  // Vrai sur la carte actuelle (+3 € partout) — mais on le vérifie au lieu de l'affirmer.
  const ecartUniforme = ecartsPG.length >= 2 &&
    (Math.max.apply(null, ecartsPG) - Math.min.apply(null, ecartsPG)) < 0.01;
  const qtyPetites = ln.filter(l => /petite/i.test(l.cat) && !isOffert(l.art)).reduce((a, l) => a + l.qty, 0);
  const qtyGrandes = ln.filter(l => /grande/i.test(l.cat) && !isOffert(l.art)).reduce((a, l) => a + l.qty, 0);
  const partG = (qtyPetites + qtyGrandes) ? qtyGrandes / (qtyPetites + qtyGrandes) : 0;

  // Étages de prix des grandes (détectés sur les prix constatés, jamais en dur).
  let gBas = 0, gMed = 0, gHaut = 0;
  ln.forEach(l => {
    if (!/grande/i.test(l.cat) || isOffert(l.art) || !l.qty) return;
    const p = l.sub / l.qty;
    if (p >= 13) gHaut += l.qty; else if (p >= 11) gMed += l.qty; else gBas += l.qty;
  });
  const pctHaut = (gBas + gMed + gHaut) ? Math.round(gHaut / (gBas + gMed + gHaut) * 100) : 0;

  // ── Ce que les clients achètent ENSEMBLE ───────────────────────────────────
  const pairs = {};
  Object.keys(byTid).forEach(id => {
    const arts = Object.keys(byTid[id].filter(l => !isOffert(l.art)).reduce((m, l) => (m[l.art] = 1, m), {})).sort();
    for (let i = 0; i < arts.length; i++)
      for (let j = i + 1; j < arts.length; j++) add(pairs, arts[i] + ' + ' + arts[j], 1);
  });
  const topPairs = sortDescByVal(pairs).filter(e => e[1] >= 5).slice(0, 5);

  // ── Recettes en perte de vitesse (vs mois précédent) ──────────────────────
  const qNow = {}, qPrev = {};
  ln.forEach(l  => { if (isPizzaCat(l.cat) && !isOffert(l.art)) add(qNow,  l.art, l.qty); });
  lnP.forEach(l => { if (isPizzaCat(l.cat) && !isOffert(l.art)) add(qPrev, l.art, l.qty); });
  const fatigues = Object.keys(qPrev)
    .filter(a => qPrev[a] >= 10 && (qNow[a] || 0) <= qPrev[a] * 0.7)
    .sort((a, b) => (qPrev[b] - (qNow[b] || 0)) - (qPrev[a] - (qNow[a] || 0)))
    .slice(0, 2);

  // ── Recettes qui marchent ailleurs mais invisibles dans certaines communes ─
  const COMMUNES = [1, 2, 3, 4, 5].map(g => FB_SCHEDULE[g].city);
  const seenIn = {};
  ln.forEach(l => {
    if (!isPizzaCat(l.cat) || isOffert(l.art)) return;
    const g = l.date.getDay(); if (!FB_SCHEDULE[g]) return;
    (seenIn[l.art] = seenIn[l.art] || {})[FB_SCHEDULE[g].city] = (seenIn[l.art][FB_SCHEDULE[g].city] || 0) + l.qty;
  });
  const dormantes = Object.keys(seenIn)
    .filter(a => (qNow[a] || 0) >= 8)
    .map(a => ({ art: a, zeros: COMMUNES.filter(c => !seenIn[a][c]) }))
    .filter(x => x.zeros.length >= 2 && x.zeros.length < COMMUNES.length)
    .slice(0, 2);

  // ── Attachement commune par commune : même camion, résultats différents ────
  const attachByDay = [];
  [1, 2, 3, 4, 5].forEach(g => {
    const T = tk.filter(t => t.date.getDay() === g);
    if (T.length < 20) return;                                  // effectif trop faible
    const p = re => Math.round(T.filter(t => Object.keys(t.cats || {}).some(c => re.test(c))).length / T.length * 100);
    attachByDay.push({ g: g, city: FB_SCHEDULE[g].city, n: T.length,
      boissons: p(/boisson/i), desserts: p(/dessert/i), supp: p(/supp/i) });
  });

  // Part du CA encaissée après 21h, par jour de tournée.
  wdRows.forEach(r => {
    const T = tk.filter(t => t.date.getDay() === r.g);
    const tard = T.filter(t => t.time >= '21:00').reduce((a, t) => a + t.total, 0);
    r.pctTard = r.ca ? Math.round(tard / r.ca * 100) : 0;
    const ds = dayKeys.filter(k => byDay[k].date.getDay() === r.g);
    r.duree = ds.length ? ds.reduce((a, k) => a + byDay[k].duree, 0) / ds.length : 0;
    r.caH   = r.duree > 0.5 ? r.caMoy / r.duree : 0;
  });
  const medianeCommune = wdRows.length ? median(wdRows.map(r => r.caMoy)) : 0;

  // ── Tendance intra-mois : le mois accélère-t-il ou s'essouffle-t-il ? ──────
  const q1 = dayKeys.filter(k => +k.slice(8, 10) <= 15), q2 = dayKeys.filter(k => +k.slice(8, 10) > 15);
  const moyOf = ks => ks.length ? ks.reduce((a, k) => a + byDay[k].ca, 0) / ks.length : 0;
  const caQ1 = moyOf(q1), caQ2 = moyOf(q2);
  const penteOk = q1.length >= 4 && q2.length >= 4 && caQ1 > 0;
  const pente   = penteOk ? (caQ2 - caQ1) / caQ1 : 0;

  // ── Projection & objectif ─────────────────────────────────────────────────
  // Chaque soirée à venir est valorisée au CA moyen constaté ce jour-là.
  const projeter = (kKey, from, to) => {
    const y = +kKey.slice(0, 4), m = +kKey.slice(5, 7);
    let ca = 0; const detail = {};
    for (let d = from; d <= to; d++) {
      const g = new Date(y, m - 1, d).getDay();
      const r = wdRows.filter(w => w.g === g)[0];
      if (r) { ca += r.caMoy; detail[g] = (detail[g] || 0) + 1; }
    }
    return { ca: ca, detail: detail, soirees: Object.keys(detail).reduce((a, g) => a + detail[g], 0) };
  };
  const projNext  = projeter(nKey, 1, daysInMonthOf(nKey));
  const projReste = upToDay ? projeter(mKey, upToDay + 1, daysInMonthOf(mKey)) : null;

  const caByMonth = {};
  stats.tickets.forEach(t => add(caByMonth, t.dKey.slice(0, 7), t.total));
  const moisComplets = Object.keys(caByMonth).filter(k => k < mKey).map(k => caByMonth[k]);
  const meilleurMois = moisComplets.length ? Math.max.apply(null, moisComplets) : 0;
  // L'objectif se mesure APRÈS la projection : le mois prochain n'a pas forcément
  // le même nombre de soirées, et dépasser son mois précédent grâce au seul
  // calendrier ne serait pas une performance. On vise donc la projection + 5 %.
  const objectif = (upToDay || !projNext.soirees) ? 0
    : Math.round(Math.max(projNext.ca * 1.05, meilleurMois) / 10) * 10;
  const ecartObj      = objectif ? Math.max(0, objectif - projNext.ca) : 0;
  const objParSoiree  = (objectif && projNext.soirees) ? ecartObj / projNext.soirees : 0;
  const objVentes     = (objParSoiree > 0 && panier) ? Math.ceil(objParSoiree / panier) : 0;
  // Même effort exprimé en boissons : « une boisson de plus toutes les N ventes ».
  const prixBoissonRef = prixMoyenCat(ln, /boisson/i) || 2.5;
  const boissonsParSoiree = objParSoiree > 0 ? objParSoiree / prixBoissonRef : 0;
  const boissonsPourObjectif = boissonsParSoiree > 0 ? Math.max(1, Math.round(tkParSoiree / boissonsParSoiree)) : 0;

  // ── Comparaison même mois l'an dernier (n'apparaît que si l'historique existe)
  const yKey = (+mKey.slice(0, 4) - 1) + mKey.slice(4);
  const tkY  = stats.tickets.filter(t => t.dKey.slice(0, 7) === yKey);
  const caY  = tkY.reduce((a, t) => a + t.total, 0);

  // ══════════════════════════════════════════════════════════════════════════
  //  MOTEUR DE LEVIERS — chaque règle chiffre son gain, le tri fait le reste
  // ══════════════════════════════════════════════════════════════════════════
  const actions = [];
  const act = o => { if (o) actions.push(o); };

  const aB = attach.filter(a => /Boisson/i.test(a.label))[0] || { pct: 0, n: 0 };
  const aD = attach.filter(a => /Dessert/i.test(a.label))[0] || { pct: 0, n: 0 };
  const aS = attach.filter(a => /Suppl/i.test(a.label))[0]   || { pct: 0, n: 0 };
  const prixMoyB = prixMoyenCat(ln, /boisson/i) || 2.5;
  const prixMoyD = prixMoyenCat(ln, /dessert/i) || 4;
  const prixMoyS = prixMoyenCat(ln, /supp/i)    || 2;

  // Tickets pizza partis sans boisson : le gisement le plus concret du mois.
  const sansBoisson = tk.filter(t => Object.keys(t.cats || {}).some(c => isPizzaCat(c))
                                  && !Object.keys(t.cats || {}).some(c => /boisson/i.test(c))).length;
  // Cible = ton propre record communal, pas un chiffre de manuel.
  const recordB = attachByDay.length ? Math.max.apply(null, attachByDay.map(x => x.boissons)) : 0;
  const cibleB  = Math.max(aB.pct + 10, recordB);
  if (aB.pct < 50) act({
    cat: 'Boissons', emoji: '🥤',
    constat: `les boissons ne suivent que ${aB.pct}% de tes ventes`,
    phrase: 'poser LA question à chaque encaissement : « Et comme boisson ? »',
    gainEur: nbTk * (cibleB - aB.pct) / 100 * prixMoyB
  });
  if (aD.pct < 25) act({
    cat: 'Desserts', emoji: '🍮',
    constat: `les desserts ne suivent que ${aD.pct}% de tes ventes`,
    phrase: 'proposer le dessert PENDANT la cuisson, en le nommant',
    gainEur: nbTk * (25 - aD.pct) / 100 * prixMoyD
  });
  if (aS.pct < 15 || pctHaut < 40) act({
    cat: 'Suppléments', emoji: '🧀',
    constat: `les suppléments ne suivent que ${aS.pct}% de tes ventes`,
    phrase: 'nommer le supplément selon la pizza, jamais « un supplément ? »',
    gainEur: nbTk * 0.05 * Math.max(prixMoyS, 2.5)
  });
  if (partG < 0.60 && ecartPG > 0) act({
    cat: 'Grandes', emoji: '🍕',
    constat: `${Math.round((1 - partG) * 100)}% de tes pizzas partent encore en petite`,
    phrase: `demander « pour ${fmt(ecartPG)} de plus, je te la fais en grande ? »`,
    gainEur: qtyPetites * 0.10 * ecartPG
  });
  if (pctHaut < 40 && gMed > 0) act({
    cat: 'Grandes', emoji: '⭐',
    constat: `seulement ${pctHaut}% de tes grandes sont des recettes du haut de carte`,
    phrase: 'citer une recette du haut de carte quand on te demande conseil',
    gainEur: gMed * 0.10 * 2
  });
  // La petite comme pizza des enfants (article EN PLUS, pas concurrente de la grande).
  let famille = 0, familleSansPetite = 0;
  Object.keys(byTid).forEach(id => {
    const pzs = byTid[id].filter(l => isPizzaCat(l.cat) && !isOffert(l.art));
    const nG  = pzs.filter(l => /grande/i.test(l.cat)).reduce((a, l) => a + l.qty, 0);
    if (nG >= 2) { famille++; if (!pzs.some(l => /petite/i.test(l.cat))) familleSansPetite++; }
  });
  const prixPetiteMin = (function () {
    const ps = ln.filter(l => /petite/i.test(l.cat) && !isOffert(l.art) && l.qty).map(l => l.sub / l.qty);
    return ps.length ? Math.min.apply(null, ps) : 7;
  })();
  if (famille >= 30 && familleSansPetite / famille > 0.5) act({
    cat: 'Petites', emoji: '👨‍👩‍👧',
    constat: `${familleSansPetite} commandes famille sur ${famille} repartent sans petite pizza`,
    phrase: 'proposer « et pour les enfants, une petite à leur taille ? »',
    gainEur: famille * 0.10 * prixPetiteMin
  });
  // Commune la plus faible : la cible est la médiane, pas la meilleure commune.
  const worstCom = wdRows.length ? wdRows.reduce((a, b) => b.caMoy < a.caMoy ? b : a) : null;
  const bestCom  = wdRows.length ? wdRows.reduce((a, b) => b.caMoy > a.caMoy ? b : a) : null;
  if (worstCom && bestCom && wdRows.length >= 2 && worstCom.caMoy < bestCom.caMoy * 0.7) act({
    cat: 'transverse', emoji: '📣',
    constat: `${worstCom.city} fait ${Math.round((1 - worstCom.caMoy / bestCom.caMoy) * 100)}% de CA de moins par soirée que ${bestCom.city}`,
    phrase: `poster deux fois sur Facebook le ${worstCom.jour.toLowerCase()} (11h30 et 17h30)`,
    // Hypothèse prudente : combler un QUART de l'écart avec la médiane de la
    // tournée. Viser tout l'écart d'un coup ne serait pas honnête.
    gainEur: Math.max(0, medianeCommune - worstCom.caMoy) * worstCom.soirees * 0.25
  });
  if (caTot && caAvant19 / caTot < 0.20) act({
    cat: 'transverse', emoji: '⏰',
    constat: `avant 19h tu ne fais que ${Math.round(caAvant19 / caTot * 100)}% de ton CA`,
    phrase: 'annoncer « commande avant 19h, récupère sans attendre »',
    gainEur: 0.5 * joursActifs * panier
  });
  if (gros.length >= 8) act({
    cat: 'transverse', emoji: '👥',
    constat: `${gros.length} commandes de 4 pizzas et plus ont pesé ${fmt(caGros)}`,
    phrase: 'proposer la précommande groupée au comité des fêtes et aux associations',
    gainEur: 10 * (prixMoyenCat(ln, /grande/i) || 12)
  });
  if (nbTk && offertsQty / nbTk < 0.01) act({
    cat: 'transverse', emoji: '💳',
    constat: `${offertsQty} article${offertsQty > 1 ? 's' : ''} offert${offertsQty > 1 ? 's' : ''} sur ${nbTk} ventes : ta carte de fidélité dort`,
    phrase: 'donner la carte en main propre, premier tampon déjà coché',
    gainEur: Math.max(0, 5 * panier - (prixMoyenCat(ln, /grande/i) || 12))
  });
  if (mortes.length >= 2) act({
    cat: 'transverse', emoji: '🔄',
    constat: `${mortes.length} recettes pèsent moins de 0,5% de ton CA chacune`,
    phrase: `sortir « ${mortes[mortes.length - 1][0]} » et mettre une pizza du mois à sa place`,
    gainEur: Math.max(0, caMedianPizza - mortes[mortes.length - 1][1])
  });
  if (tkP.length && pmpPrev && Math.abs(pmp - pmpPrev) >= 0.30 && pmp < pmpPrev) act({
    cat: 'transverse', emoji: '📉',
    constat: `ta pizza moyenne s'est vendue ${fmt(pmp)} contre ${fmt(pmpPrev)} le mois dernier`,
    phrase: 'mettre une recette du haut de carte en photo dans le post du jour',
    gainEur: (pmpPrev - pmp) * pzTotQty
  });
  if (penteOk && pente <= -0.10) act({
    cat: 'transverse', emoji: '📆',
    constat: `ton mois s'est essoufflé : ${fmt(caQ2)} par soirée en 2e quinzaine contre ${fmt(caQ1)} en 1re`,
    phrase: 'relancer la communication dès la première semaine du mois',
    gainEur: 4 * Math.max(0, caQ1 - caQ2)
  });
  actions.sort((a, b) => b.gainEur - a.gainEur);
  const actionsFortes = actions.filter(a => a.gainEur >= 1);
  const totalGain = actionsFortes.slice(0, 5).reduce((a, x) => a + x.gainEur, 0);
  const actOf = cat => actions.filter(a => a.cat === cat);

  // ── HTML ────────────────────────────────────────────────────────────────────
  const C = { brand: '#89310B', green: '#76894F', bg: '#faf7f4', line: '#e7ddd6' };
  const kpi = (label, val, deltaHtml) =>
    `<td style="padding:14px 10px;background:#fff;border:1px solid ${C.line};border-radius:10px;text-align:center">
       <div style="font-size:21px;font-weight:800;color:${C.brand}">${val}</div>
       <div style="font-size:12px;color:#888;margin-top:3px">${label}</div>${deltaHtml || ''}</td>`;
  const th  = t => `<th align="left" style="padding:8px 10px;background:${C.green};color:#fff;font-size:13px">${t}</th>`;
  const td  = (v, b) => `<td style="padding:7px 10px;border-bottom:1px solid ${C.line};font-size:13px${b ? ';font-weight:700' : ''}">${v}</td>`;
  const tbl = inner => `<table width="100%" cellspacing="0" style="background:#fff;border:1px solid ${C.line};border-radius:8px;overflow:hidden">${inner}</table>`;
  const sec = (title, inner) => `<h3 style="color:${C.brand};margin:24px 0 8px;font-size:15px">${title}</h3>` + inner;
  const bar = (v, max, color) => `<div style="background:${C.line};border-radius:4px;height:10px"><div style="width:${max ? Math.max(2, Math.round(v / max * 100)) : 0}%;background:${color || C.green};height:10px;border-radius:4px"></div></div>`;
  // Encadré de mise en avant (constat + action).
  const box = (inner, bg, brd) => `<div style="background:${bg || '#fff6e6'};border-left:4px solid ${brd || C.brand};border-radius:8px;padding:12px 16px;margin:10px 0;font-size:13px;line-height:1.6;color:#333">${inner}</div>`;
  const note = t => `<p style="font-size:11px;color:#999;margin:6px 0 0;line-height:1.5">${t}</p>`;
  const gain = n => `<b style="color:${C.green}">+${fmt(n)}/mois</b>`;
  // Titre de grande partie : structure le rapport en chapitres lisibles.
  const part = (t, sub) => `<div style="margin:34px 0 6px;padding:10px 14px;background:${C.brand};color:#fff;border-radius:8px">
       <div style="font-size:15px;font-weight:800">${t}</div>${sub ? `<div style="font-size:11.5px;opacity:.85;margin-top:2px">${sub}</div>` : ''}</div>`;
  const pctStr = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';

  let html = '';

  // ① L'ESSENTIEL — la seule partie lue si le mois est chargé.
  const top1 = actionsFortes[0];
  html += box(
    `<div style="font-size:15px;font-weight:800;color:${C.brand};margin-bottom:8px">⚡ L'essentiel en 30 secondes</div>` +
    `<div style="margin:5px 0">💶 <b>Ton CA : ${fmt(caTot)}</b>${tkP.length && caTotP ? ` (${caTot >= caTotP ? '▲ +' : '▼ '}${Math.abs(Math.round((caTot - caTotP) / caTotP * 100))}% vs ${moisNom(pKey)})` : ''} · ${plur(nbTk, 'vente')} · panier ${fmt(panier)}</div>` +
    (top1 ? `<div style="margin:5px 0">${top1.emoji} <b>Ton levier n°1 :</b> ${top1.constat} — ${top1.phrase} ≈ ${gain(top1.gainEur)}</div>` : '') +
    `<div style="margin:5px 0">🥇 <b>Ta meilleure soirée :</b> ${dayLabel(byDay[bestDayK].date)}${FB_SCHEDULE[byDay[bestDayK].date.getDay()] ? ' à ' + FB_SCHEDULE[byDay[bestDayK].date.getDay()].city : ''} — ${fmt(byDay[bestDayK].ca)}</div>` +
    (objectif ? `<div style="margin:5px 0">🎯 <b>Ton objectif ${moisDe(nKey)} : ${fmt(objectif)}</b>${objVentes > 0 ? ` — soit ${plur(objVentes, 'vente')} de plus par soirée` : ''}</div>` : '') +
    (projReste ? `<div style="margin:5px 0">🔮 <b>Au rythme actuel, le mois finira vers ${fmt(caTot + projReste.ca)}</b> (${plur(projReste.soirees, 'soirée')} restantes)</div>` : '') +
    (actionsFortes.length > 1 ? `<div style="margin:8px 0 0;font-size:12px;color:#777">Le plan complet, catégorie par catégorie, est plus bas : ${fmt(totalGain)} par mois si tu tiens les 5 premières actions.</div>` : '')
  );

  html += part('📊 1. Ta performance du mois', 'les chiffres qui pilotent, comparés au mois précédent');

  // KPIs
  html += `<table width="100%" cellspacing="6" cellpadding="0"><tr>
    ${kpi('CA du mois', fmt(caTot), delta(caTot, caTotP))}
    ${kpi('Ventes', nbTk, delta(nbTk, nbTkP))}
    ${kpi('Panier moyen', fmt(panier), delta(panier, panierP))}
  </tr><tr>
    ${kpi('Articles vendus', nbArt, delta(nbArt, nbArtP))}
    ${kpi('Soirées d\'activité', joursActifs, delta(joursActifs, joursActifsP))}
    ${kpi('CA / soirée', fmt(caTot / joursActifs), delta(caTot / joursActifs, joursActifsP ? caTotP / joursActifsP : 0))}
  </tr></table>`;

  // Comparaison N-1 : n'apparaît que le jour où l'historique existe vraiment.
  if (tkY.length) {
    const caYP = caY ? Math.round((caTot - caY) / caY * 100) : 0;
    html += box(`📆 <b>Vs ${monthLabelFr(yKey).toLowerCase()}</b> : ${fmt(caY)} → ${fmt(caTot)} (${caYP >= 0 ? '▲ +' : '▼ '}${Math.abs(caYP)}%), ${tkY.length} → ${nbTk} ventes. C'est la seule comparaison qui neutralise les saisons.`, '#f2f6ec', C.green);
  }

  // L'équation du CA : trois manettes, et une seule est gratuite.
  html += sec('🧮 Ton CA en une équation', box(
    `<div style="font-size:14px;margin-bottom:8px"><b>${plur(joursActifs, 'soirée')} × ${(Math.round(tkParSoiree * 10) / 10).toString().replace('.', ',')} ventes × ${fmt(panier)} = ${fmt(caTot)}</b></div>` +
    `Tu n'as que trois manettes pour faire grandir ce chiffre :<br>` +
    `➕ 1 vente de plus par soirée = ${gain(sensTicket)}<br>` +
    `➕ 1 € de panier moyen = ${gain(sensPanier)}<br>` +
    `➕ 1 soirée de plus = ${gain(sensSoiree)}<br>` +
    `<span style="color:#777">La seule qui ne demande ni plus d'heures ni plus de kilomètres, c'est le panier : c'est tout l'objet du plan d'action plus bas.</span>`
  ));

  // Tendance intra-mois : le mois accélère ou s'essouffle.
  if (penteOk && Math.abs(pente) >= 0.05) {
    const monte = pente > 0;
    html += sec('📈 Ton mois, quinzaine par quinzaine', tbl(
      `<tr>${th('Quinzaine')}${th('CA moyen / soirée')}${th('')}</tr>` +
      `<tr>${td('1<sup>re</sup> quinzaine (' + plur(q1.length, 'soirée') + ')')}${td(fmt(caQ1), 1)}<td style="padding:7px 10px;border-bottom:1px solid ${C.line};width:40%">${bar(caQ1, Math.max(caQ1, caQ2))}</td></tr>` +
      `<tr>${td('2<sup>e</sup> quinzaine (' + plur(q2.length, 'soirée') + ')')}${td(fmt(caQ2), 1)}<td style="padding:7px 10px;border-bottom:1px solid ${C.line};width:40%">${bar(caQ2, Math.max(caQ1, caQ2), monte ? C.green : '#c0703f')}</td></tr>`) +
      box(monte
        ? `📈 <b>Ton mois a fini plus fort qu'il n'a commencé</b> (${Math.round(pente * 100)}%). Ce qui a marché en deuxième quinzaine, remets-le en place dès la première semaine du mois prochain.`
        : `📉 <b>Ton mois s'est essoufflé</b> (${Math.round(pente * 100)}%). Les fins de mois sont souvent plus serrées côté budget des clients : c'est là qu'une offre simple et un post Facebook bien placé font la différence.`,
        monte ? '#f2f6ec' : '#fff6e6', monte ? C.green : '#c0703f'));
  }

  // Projection : ce que le mois prochain donnera si rien ne change.
  if (projNext.soirees) {
    const detailProj = [1, 2, 3, 4, 5].filter(g => projNext.detail[g]).map(g => {
      const r = wdRows.filter(w => w.g === g)[0];
      return `<tr>${td(JOURS[g] + ' · ' + FB_SCHEDULE[g].city)}${td(projNext.detail[g] + ' × ' + fmt(r.caMoy))}${td(fmt(projNext.detail[g] * r.caMoy), 1)}</tr>`;
    }).join('');
    html += sec(`🔮 Ce ${moisQue(nKey)} devrait donner`, tbl(
      `<tr>${th('Soirée')}${th('Au rythme de ce mois')}${th('Total')}</tr>` + detailProj +
      `<tr>${td('<b>Projection</b>', 1)}${td(plur(projNext.soirees, 'soirée'))}${td('<b>' + fmt(projNext.ca) + '</b>', 1)}</tr>`) +
      (objectif ? box(
        `🎯 <b>Ton objectif : ${fmt(objectif)}</b> — la projection ci-dessus, dépassée de 5%${meilleurMois && objectif >= meilleurMois ? `, et au-dessus de ton meilleur mois (${fmt(meilleurMois)})` : ''}. ` +
        (objParSoiree > 0
          ? `L'effort réel, c'est <b>${fmt(objParSoiree)} de plus par soirée</b> — concrètement ${plur(objVentes, 'vente')} de plus${boissonsPourObjectif >= 3 ? `, ou une boisson vendue sur ${plur(boissonsPourObjectif, 'vente')}` : ''}. Le récap du mois prochain te dira si tu l'as tenu.`
          : `Tu es déjà au-dessus : l'enjeu du mois prochain, c'est de tenir ce niveau.`)) : '') +
      note('Projection brute : jours fériés, congés et météo ne sont pas connus de la caisse. Si tu poses une semaine, retire environ ' + fmt(5 * (caTot / joursActifs)) + '.'));
  }

  // Records
  html += sec('🏆 Records du mois', tbl(
    `<tr>${td('🥇 Meilleure soirée', 1)}${td(dayLabel(byDay[bestDayK].date) + ' (' + JOURS[byDay[bestDayK].date.getDay()] + ')')}${td(fmt(byDay[bestDayK].ca) + ' · ' + plur(byDay[bestDayK].n, 'vente'), 1)}</tr>` +
    `<tr>${td('💰 Plus gros ticket', 1)}${td(dayLabel(bestTicket.date) + ' à ' + bestTicket.time)}${td(fmt(bestTicket.total), 1)}</tr>` +
    (bestHour ? `<tr>${td('⏰ Heure la plus rentable', 1)}${td(bestHour[0] + 'h – ' + (+bestHour[0] + 1) + 'h')}${td(fmt(bestHour[1]) + ' sur le mois', 1)}</tr>` : '') +
    (topQty ? `<tr>${td('🍕 Article du mois', 1)}${td(topQty[0])}${td(plur(topQty[1], 'vendu'), 1)}</tr>` : '')));

  // Semaine par semaine
  html += sec('📈 Semaine par semaine', tbl(
    `<tr>${th('Semaine')}${th('Ventes')}${th('CA')}${th('')}</tr>` +
    Object.keys(weeks).sort().map(w => {
      const o = weeks[w], a = w * 7 + 1, b = Math.min(w * 7 + 7, dernierJour);
      return `<tr>${td('du ' + a + ' au ' + b)}${td(o.n)}${td(fmt(o.ca), 1)}<td style="padding:7px 10px;border-bottom:1px solid ${C.line};width:30%">${bar(o.ca, maxWeekCA)}</td></tr>`;
    }).join('')));

  // CA par jour (toutes les soirées du mois)
  html += sec('📅 Toutes les soirées du mois', tbl(
    `<tr>${th('Date')}${th('Jour · Commune')}${th('Ventes')}${th('CA')}</tr>` +
    dayKeys.map(k => {
      const o = byDay[k], g = o.date.getDay();
      const lieu = JOURS[g].slice(0, 3) + (FB_SCHEDULE[g] ? ' · ' + FB_SCHEDULE[g].city : '');
      return `<tr>${td(Utilities.formatDate(o.date, TZ, 'dd/MM'))}${td(lieu)}${td(o.n)}${td(fmt(o.ca), 1)}</tr>`;
    }).join('')));

  // ══════════════════════════════════════════════════════════════════════════
  html += part('🔬 2. Ce que disent tes tickets', 'la lecture fine du mois : qui achète quoi, quand, et combien');

  // Distribution des paniers — la moyenne ment, la médiane non.
  html += sec('🧺 La distribution de tes paniers', tbl(
    `<tr>${th('Tranche')}${th('Ventes')}${th('Part')}${th('CA')}${th('')}</tr>` +
    distPanier.map(d => `<tr>${td(d.lab)}${td(d.n)}${td(pctStr(d.n, nbTk))}${td(fmt(d.ca), 1)}<td style="padding:7px 10px;border-bottom:1px solid ${C.line};width:22%">${bar(d.n, maxDistN)}</td></tr>`).join('')) +
    box(`🎯 <b>La moitié de tes ventes font moins de ${fmt(medianePanier)}</b> — ta moyenne de ${fmt(panier)} est tirée vers le haut par les grosses commandes, c'est la médiane qu'il faut regarder. ` +
        (distPanier[0].n ? `${distPanier[0].n} ventes sont sous 12 € : ce sont les « pizza seule », et c'est exactement à ces clients-là que s'adressent tes questions à l'encaissement — en convertir un sur cinq à une boisson vaut ${gain(distPanier[0].n * 0.20 * (prixMoyenCat(ln, /boisson/i) || 2.5))}.` : '')));

  // Taille des tickets : le mono-article est la réserve la plus visible.
  html += sec('🔢 Combien d\'articles par vente ?', tbl(
    `<tr>${th('Taille du ticket')}${th('Ventes')}${th('Part')}${th('')}</tr>` +
    TAILLES.map(k => `<tr>${td(k)}${td(buckets[k])}${td(pctStr(buckets[k], nbTk))}<td style="padding:7px 10px;border-bottom:1px solid ${C.line};width:35%">${bar(buckets[k], Math.max.apply(null, TAILLES.map(x => buckets[x])))}</td></tr>`).join('')) +
    (nbMono ? box(`🎯 <b>${pctStr(nbMono, nbTk)} de tes ventes ne comptent qu'un seul article</b> (${nbMono} tickets). Un client sur ${Math.max(2, Math.round(nbTk / nbMono))} repart sans boisson, sans dessert, sans supplément — c'est ta plus grosse réserve de croissance, et elle est déjà devant ton camion.`) : ''));

  // Courbe de charge par demi-heure.
  if (slotKeys.length >= 3) html += sec('⏰ Ta soirée, demi-heure par demi-heure', tbl(
    `<tr>${th('Créneau')}${th('Ventes')}${th('CA moyen / soirée')}${th('')}</tr>` +
    slotKeys.map(k => `<tr>${td(k)}${td(bySlot[k].n)}${td(fmt(bySlot[k].ca / joursActifs), 1)}<td style="padding:7px 10px;border-bottom:1px solid ${C.line};width:35%">${bar(bySlot[k].ca, maxSlotCA)}</td></tr>`).join('')) +
    box(`🔥 <b>Ton rush : ${bestSlot[0]}</b> (${pctStr(bestSlot[1].ca, caTot)} du CA du mois). ` +
        (caTot && caAvant19 / caTot < 0.20
          ? `Avant 19h tu ne fais que ${pctStr(caAvant19, caTot)} du CA, alors que le four est déjà chaud. Teste dans le post du jour : « commande avant 19h, récupère sans attendre » — tu remplis le creux <b>et</b> tu allèges ton coup de feu.`
          : `Ta charge est bien répartie : prépare ta mise en place 30 minutes avant ${bestSlot[0]}.`)));

  // Commandes familles et groupes.
  if (gros.length >= 5) html += sec('👨‍👩‍👧‍👦 Les commandes familles et groupes', box(
    `<b>${gros.length} commandes de 4 pizzas ou plus</b> (${pctStr(gros.length, nbTk)} de tes ventes) ont pesé <b>${fmt(caGros)}</b>, soit ${pctStr(caGros, caTot)} de ton CA. Panier moyen de ces tickets : <b>${fmt(caGros / gros.length)}</b> — près de ${Math.round(caGros / gros.length / panier)} fois ton panier habituel.` +
    (grosBestG && FB_SCHEDULE[grosBestG[0]] ? `<br>C'est ${JOURS[grosBestG[0]].toLowerCase()} à ${FB_SCHEDULE[grosBestG[0]].city} qu'elles se concentrent : c'est ta commune « familles ».` : '') +
    `<br><span style="color:#777">Ces clients-là ne viennent pas par hasard : un mot au comité des fêtes ou aux associations du coin, et la précommande groupée annoncée sur Facebook, suffisent souvent à en ramener une par semaine.</span>`,
    '#f2f6ec', C.green));

  // ══════════════════════════════════════════════════════════════════════════
  html += part('🧭 3. Ta carte au microscope', 'quelle recette travaille pour toi, laquelle occupe une place pour rien');

  // Matrice de menu engineering.
  if (pzNames.length >= 4) {
    html += sec('🔭 Tes 4 familles de recettes', QUADRANTS.map(q => {
      const list = menuMatrix[q.k];
      if (!list.length) return '';
      return `<div style="background:#fff;border:1px solid ${C.line};border-radius:8px;padding:10px 14px;margin:8px 0">
        <div style="font-weight:700;color:${C.brand};font-size:13.5px">${q.t}</div>
        <div style="font-size:12.5px;color:#333;margin:4px 0">${list.slice(0, 4).map(n => `${n} <span style="color:#888">(${pz[n].qty} vendues à ${fmt(puOf(n))})</span>`).join(' · ')}</div>
        <div style="font-size:12px;color:${C.green};font-style:italic">👉 ${q.aide}</div></div>`;
    }).join('') + note(`Faute de coûts d'ingrédients dans la caisse, c'est le prix de vente moyen (${fmt(pmp)}) qui sert de repère de valeur, et ${Math.round(seuilPop)} ventes de seuil de popularité. À pâte égale, une pizza à 14 € laisse plus qu'une à 9 €.`));
  }

  // Pareto : la carte utile et la carte qui dort.
  if (triPizza.length >= 5) html += sec('📇 Ta carte en une phrase', box(
    `<b>${n80} recettes font 80% de ton CA pizza</b> sur les ${triPizza.length} que tu proposes.` +
    (mortes.length ? ` À l'autre bout, ${plur(mortes.length, 'recette')} pèse${mortes.length > 1 ? 'nt' : ''} moins de 0,5% du CA chacune — dont « ${mortes[mortes.length - 1][0]} » (${fmt(mortes[mortes.length - 1][1])} sur le mois).` : '') +
    `<br><span style="color:#777">Une carte plus courte, c'est moins de stock qui dort, un service plus rapide au coup de feu, et un client qui choisit plus vite. Remplacer la dernière par une « pizza du mois » en édition limitée garde le même nombre de références tout en créant de la nouveauté.</span>`));

  // Petite ou Grande : le trading-up recette par recette.
  if (mixRows.length >= 3 && ecartPG > 0) {
    const sousMed = mixRows.filter(r => r.pctG < pctGMed);
    const gainMix = sousMed.reduce((a, r) => a + (pctGMed - r.pctG) / 100 * (r.p + r.g) * ecartPG, 0);
    html += sec('📏 Petite ou grande ? Recette par recette', tbl(
      `<tr>${th('Recette')}${th('Petites')}${th('Grandes')}${th('% en grande')}</tr>` +
      mixRows.map(r => `<tr style="${r.pctG < pctGMed ? 'background:#fff6e6' : ''}">${td(r.n)}${td(r.p)}${td(r.g)}${td(r.pctG + '%', 1)}</tr>`).join('')) +
      box(`📐 <b>Ta médiane est à ${pctGMed}% en grande</b>, et passer d'une petite à une grande coûte <b>${fmt(ecartPG)}</b>${ecartUniforme ? ' — le même écart sur toute ta carte, facile à retenir, facile à dire' : ' en moyenne'}.` +
          (sousMed.length ? ` Les ${sousMed.length} recettes surlignées passent en dessous : sur celles-là, un simple « je te la fais en grande pour ${fmt(ecartPG)} de plus ? » à la commande vaut ${gain(gainMix)}.` : '') +
          `<br><span style="color:#777">Astuce d'ardoise : affiche les deux prix côte à côte (par exemple 9 € / 12 €). Le client fait le calcul tout seul, et choisit la grande bien plus souvent.</span>`));
  }

  // Prix moyen pondéré : la dérive silencieuse du mix.
  if (pmp) html += sec('🎯 Le prix moyen de la pizza que tu vends', box(
    `Ta pizza moyenne s'est vendue <b>${fmt(pmp)}</b>` +
    (pmpPrev ? ` contre ${fmt(pmpPrev)} le mois dernier (${pmp >= pmpPrev ? '▲ +' : '▼ '}${fmt(Math.abs(pmp - pmpPrev))}).` : '.') +
    (pmpPrev && pmp < pmpPrev - 0.15
      ? ` <b>Ton mix glisse vers le bas de la carte.</b> Sur ${pzTotQty} pizzas, chaque centime compte : revenir au niveau du mois dernier vaut ${gain((pmpPrev - pmp) * pzTotQty)}, sans toucher à un seul prix — il suffit de remettre les recettes du haut de carte en photo dans le post du jour.`
      : pmpPrev && pmp > pmpPrev + 0.15
        ? ` <b>Ton mix monte en gamme</b> : c'est exactement ce qu'il faut. Continue de citer les recettes du haut de carte quand on te demande conseil.`
        : ` C'est le chiffre à surveiller : il bouge sans que tu changes tes prix, uniquement selon ce que les clients choisissent.`)));

  // Top 10 articles
  html += sec('🏆 Top 10 articles', tbl(
    `<tr>${th('Article')}${th('Qté')}${th('CA')}${th('vs mois préc.')}</tr>` +
    topArts.map(e => {
      const prev = artCAP[e[0]] || 0;
      const ev = !tkP.length ? '—' : !prev ? 'nouveau'
        : (e[1] >= prev ? '<span style="color:#2c6b2f;font-weight:700">▲ +' : '<span style="color:#9b2c1e;font-weight:700">▼ ') + Math.round((e[1] - prev) / prev * 100) + '%</span>';
      return `<tr>${td(e[0])}${td(artQty[e[0]] || 0)}${td(fmt(e[1]), 1)}${td(ev)}</tr>`;
    }).join('')));

  // Flop
  if (flopArts.length) html += sec('📉 Les moins vendus (hors offerts)', tbl(
    `<tr>${th('Article')}${th('Qté')}${th('CA')}</tr>` +
    flopArts.map(e => `<tr>${td(e[0])}${td(artQty[e[0]] || 0)}${td(fmt(e[1]))}</tr>`).join('')));

  // Recettes en perte de vitesse — on rattrape à −30%, plus à −60%.
  if (fatigues.length) html += sec('🩺 Recettes en perte de vitesse', fatigues.map(a => {
    const perdu = qPrev[a] - (qNow[a] || 0);
    const pu = pz[a] ? puOf(a) : 0;
    return box(`📉 <b>${a}</b> passe de ${qPrev[a]} à ${qNow[a] || 0} ventes (▼ ${Math.round(perdu / qPrev[a] * 100)}%)${pu ? `, soit ${fmt(perdu * pu)} de CA envolés` : ''}. ` +
      `Trois questions avant qu'elle décroche pour de bon : un ingrédient a-t-il changé ? A-t-elle disparu de tes photos Facebook ? Une autre recette lui prend-elle sa place ? ` +
      `<span style="color:#777">À −30% on rattrape, à −60% c'est trop tard.</span>`, '#fff6e6', '#c0703f');
  }).join(''));

  // Recettes invisibles dans certaines communes.
  if (dormantes.length) html += sec('🗺️ Des recettes que certaines communes ne connaissent pas', dormantes.map(d => {
    const meilleure = sortDescByVal(seenIn[d.art])[0];
    const pu = pz[d.art] ? puOf(d.art) : 0;
    return box(`🍕 <b>${d.art}</b> marche à ${meilleure[0]} (${meilleure[1]} vendues) mais fait <b>zéro vente</b> à ${d.zeros.join(' et ')}. ` +
      `Une recette que personne n'a vue ne se commande pas : les soirs où tu es là-bas, c'est <b>elle</b> que le post du jour doit montrer.` +
      (pu ? ` Si un client sur trois suit, ça vaut ${gain(meilleure[1] * d.zeros.length * pu * 0.3)}.` : ''), '#f2f6ec', C.green);
  }).join(''));

  // Ce que les clients prennent ensemble.
  if (topPairs.length) html += sec('🤝 Ce que tes clients commandent ensemble', tbl(
    `<tr>${th('Duo')}${th('Fois ensemble')}</tr>` +
    topPairs.map(e => `<tr>${td(e[0].replace(' + ', ' <span style="color:#999">+</span> '))}${td(e[1], 1)}</tr>`).join('')) +
    box(`🤝 Ce sont tes <b>menus naturels</b> : ils existent déjà, tes clients les ont inventés tout seuls. Affiche ces duos côte à côte sur l'ardoise — pas besoin d'inventer un prix de menu, le simple fait de les montrer ensemble suffit à les faire commander plus souvent.`));

  // Star par catégorie
  html += sec('🏅 L\'article star de chaque catégorie', tbl(
    `<tr>${th('Catégorie')}${th('Star')}${th('Qté')}${th('CA')}</tr>` +
    catStars.map(s => `<tr>${td(s.cat)}${td(s.art, 1)}${td(s.qty)}${td(fmt(s.ca))}</tr>`).join('')));

  // CA par catégorie
  html += sec('🍕 CA par catégorie', tbl(
    `<tr>${th('Catégorie')}${th('Qté')}${th('CA')}${th('vs mois préc.')}</tr>` +
    sortDescByVal(catCA).map(e => {
      const prev = catCAP[e[0]] || 0;
      const ev = !tkP.length ? '—' : !prev ? 'nouveau'
        : (e[1] >= prev ? '<span style="color:#2c6b2f;font-weight:700">▲ +' : '<span style="color:#9b2c1e;font-weight:700">▼ ') + Math.round((e[1] - prev) / prev * 100) + '%</span>';
      return `<tr>${td(e[0])}${td(catQty[e[0]] || 0)}${td(fmt(e[1]), 1)}${td(ev)}</tr>`;
    }).join('')));

  // ══════════════════════════════════════════════════════════════════════════
  html += part('📍 4. Tes communes', 'même camion, mêmes prix, mêmes recettes — et pourtant des résultats très différents');

  // Soirée type par commune, enrichie du temps de service.
  html += sec('📍 La soirée type, commune par commune', tbl(
    `<tr>${th('Jour · Commune')}${th('Soirées')}${th('CA / soirée')}${th('Ventes')}${th('€ / heure')}</tr>` +
    wdRows.slice().sort((a, b) => b.caMoy - a.caMoy).map(r =>
      `<tr>${td(r.jour.slice(0, 3) + ' · ' + (r.city || '—'))}${td(r.soirees)}${td(fmt(r.caMoy), 1)}${td(Math.round(r.tkMoy))}${td(r.caH ? fmt(r.caH) : '—')}</tr>`).join('')) +
    note('« € / heure » rapporte le CA au temps réellement passé à encaisser (du premier au dernier ticket) : une petite commune rapide peut être plus rentable qu\'une grosse commune étalée.'));

  // Attachement commune par commune : la matrice qui dit OÙ faire l'effort.
  if (attachByDay.length >= 2) {
    const moyB = attach.filter(a => /Boisson/i.test(a.label))[0].pct;
    const moyD = attach.filter(a => /Dessert/i.test(a.label))[0].pct;
    const moyS = attach.filter(a => /Suppl/i.test(a.label))[0].pct;
    const cell = (v, moy) => `<td style="padding:7px 10px;border-bottom:1px solid ${C.line};font-size:13px;font-weight:700;background:${v >= moy + 5 ? '#e7f0e0' : v <= moy - 5 ? '#fff0d9' : '#fff'}">${v}%</td>`;
    html += sec('🧲 L\'attachement, commune par commune', tbl(
      `<tr>${th('Commune')}${th('Ventes')}${th('🥤 Boissons')}${th('🍮 Desserts')}${th('🧀 Supp.')}</tr>` +
      attachByDay.slice().sort((a, b) => b.boissons - a.boissons).map(x =>
        `<tr>${td(x.city)}${td(x.n)}${cell(x.boissons, moyB)}${cell(x.desserts, moyD)}${cell(x.supp, moyS)}</tr>`).join('')) +
      box(`🧲 Même camion, même frigo, mêmes prix : <b>la seule variable, c'est ce que tu proposes à la commande</b>. Les cases orange te disent exactement où l'effort rapportera le plus — commence par la colonne boissons, c'est la plus facile à redresser.`) +
      note('Ces écarts servent à cibler l\'effort ; les gains chiffrés du plan d\'action, eux, sont calculés une seule fois sur l\'ensemble du mois pour ne jamais compter deux fois le même euro.'));
  }

  // Post Facebook prêt à copier pour la commune la plus faible.
  if (worstCom && FB_SCHEDULE[worstCom.g]) {
    const qLoc = {};
    ln.forEach(l => { if (isPizzaCat(l.cat) && !isOffert(l.art) && l.date.getDay() === worstCom.g) add(qLoc, l.art, l.qty); });
    const starLoc = sortDescByVal(qLoc)[0];
    const s = FB_SCHEDULE[worstCom.g];
    if (starLoc) html += sec(`📣 Ton post prêt à copier pour le ${worstCom.jour.toLowerCase()}`,
      `<div style="background:#fff;border:1px dashed ${C.brand};border-radius:8px;padding:14px 16px;font-family:Consolas,Monaco,monospace;font-size:12.5px;line-height:1.7;color:#333">
         📍 ${worstCom.jour} soir, La Casetta est à ${s.city} (${s.place}, ${s.hours}) !<br>
         🍕 Ce mois-ci, votre chouchoute ici, c'était la ${baseName(starLoc[0])} — ${starLoc[1]} parties au four.<br>
         👉 Ce ${worstCom.jour.toLowerCase()}, dites-nous « vu sur Facebook » au camion 😉<br>
         🗺️ ${s.map}
       </div>` +
      note(`${worstCom.city} est ta soirée la plus calme (${fmt(worstCom.caMoy)} en moyenne contre ${fmt(medianeCommune)} pour la médiane de ta tournée). Ce texte est écrit à partir de tes vraies ventes du mois : 20 secondes pour le publier.`));
  }

  // ══════════════════════════════════════════════════════════════════════════
  html += part('🎯 5. Ton plan d\'action, catégorie par catégorie', 'des gestes concrets, la phrase exacte à dire, et ce que ça rapporte');

  // Bloc de catégorie : 3 chiffres clés + les actions déclenchées par les règles.
  const caCatOf  = re => Object.keys(catCA).filter(c => re.test(c)).reduce((a, c) => a + catCA[c], 0);
  const qtyCatOf = re => Object.keys(catQty).filter(c => re.test(c)).reduce((a, c) => a + catQty[c], 0);
  const starCatOf = re => {
    const k = Object.keys(byCatArt).filter(c => re.test(c))[0];
    if (!k) return null;
    return Object.entries(byCatArt[k]).sort((a, b) => b[1].qty - a[1].qty)[0];
  };
  const blocCat = (emoji, titre, chiffres, corps, cat) => {
    const acts = actOf(cat).filter(a => a.gainEur >= 1);
    return `<div style="background:#fff;border:1px solid ${C.line};border-radius:10px;padding:14px 16px;margin:12px 0">
      <div style="font-size:14.5px;font-weight:800;color:${C.brand}">${emoji} ${titre}</div>
      <div style="font-size:12px;color:#888;margin:4px 0 8px">${chiffres}</div>
      <div style="font-size:13px;color:#333;line-height:1.65">${corps}</div>
      ${acts.map(a => `<div style="font-size:12.5px;color:${C.green};margin-top:8px;padding-top:8px;border-top:1px dashed ${C.line}">🎯 <b>${a.phrase}</b> → ${gain(a.gainEur)}</div>`).join('')}
    </div>`;
  };

  const starB = starCatOf(/boisson/i), starD = starCatOf(/dessert/i), starS = starCatOf(/supp/i);
  html += blocCat('🥤', 'Boissons',
    `${pctStr(caCatOf(/boisson/i), caTot)} de ton CA · ${aB.pct}% des ventes · ${qtyCatOf(/boisson/i)} vendues`,
    (sansBoisson ? `<b>${sansBoisson} tickets pizza sont partis sans boisson</b> — soit ${fmt(sansBoisson * prixMoyB)} qui dorment. ` : '') +
    `Trois gestes qui ne coûtent rien :<br>` +
    `① le frigo <b>tourné vers la file</b>, porte visible AVANT que le client commande ;<br>` +
    `② la question ouverte à chaque encaissement — « <b>et comme boisson ?</b> », jamais « une boisson ? » qui appelle un non ;<br>` +
    `③ nomme ta star : ${starB ? `« ${starB[0]} » (${starB[1].qty} vendues)` : 'ta boisson la plus demandée'}.` +
    (recordB > aB.pct ? `<br><span style="color:#777">Ta cible n'est pas un chiffre de manuel : c'est ton propre record, <b>${recordB}%</b> déjà atteint à ${attachByDay.filter(x => x.boissons === recordB)[0].city}.</span>` : ''),
    'Boissons');

  html += blocCat('🍮', 'Desserts',
    `${pctStr(caCatOf(/dessert/i), caTot)} de ton CA · ${aD.pct}% des ventes · ${qtyCatOf(/dessert/i)} vendus`,
    `Le bon moment, ce n'est pas l'encaissement, c'est <b>la commande</b> : pendant que la pizza cuit, le client attend devant toi, disponible.<br>` +
    `👉 « Je te mets ${starD ? `un ${starD[0].toLowerCase()}` : 'un dessert'} au frais pour la fin ? » — nommer le dessert vend deux fois mieux que le mot « dessert ».` +
    (starD ? `<br>C'est ta star : ${starD[1].qty} vendus ce mois-ci.` : '') +
    `<br><span style="color:#777">Range-les à hauteur d'yeux près du passe, pas dans un frigo que personne ne voit. Ils sont déjà en stock : chaque dessert vendu est du CA quasi pur.</span>`,
    'Desserts');

  html += blocCat('🍕', 'Petites pizzas',
    `${pctStr(caCatOf(/petite/i), caTot)} de ton CA · ${qtyPetites} vendues (hors offertes) · ${pctStr(qtyPetites, qtyPetites + qtyGrandes)} de tes pizzas`,
    `La petite n'est pas une grande au rabais : c'est <b>la pizza des enfants</b>, et c'est un article <b>en plus</b> sur un ticket famille, pas à la place d'une grande.<br>` +
    (famille ? `Ce mois-ci, <b>${familleSansPetite} commandes famille sur ${famille}</b> (2 grandes ou plus) sont parties sans aucune petite.<br>` : '') +
    `👉 « Et pour les enfants, une petite à leur taille ? » — les parents partagent moins leur pizza, l'enfant a la sienne.<br>` +
    `<span style="color:#777">Un enfant qui a « sa » pizza, c'est une famille qui revient : c'est le meilleur programme de fidélité, et il ne coûte rien.</span>`,
    'Petites');

  html += blocCat('🧀', 'Grandes pizzas',
    `${pctStr(caCatOf(/grande/i), caTot)} de ton CA · ${qtyGrandes} vendues (hors offertes) · ${pctHaut}% en haut de carte`,
    `C'est ton cœur de chiffre d'affaires. Deux phrases suffisent à le faire grandir :<br>` +
    `① à chaque petite commandée : « <b>pour ${ecartPG > 0 ? fmt(ecartPG) : '3,00 €'} de plus, je te la fais en grande ?</b> »${ecartUniforme ? ' — c\'est le même écart sur toute ta carte' : ''} ;<br>` +
    `② quand on te demande « tu me conseilles quoi ? » : <b>cite une recette du haut de carte</b>. Jamais de remise dessus, juste de la lumière — c'est celle-là qu'il faut prendre en photo pour le post du jour.` +
    `<br><span style="color:#777">Aucune de ces deux actions ne demande de changer un prix : tout se joue à la voix, au moment de la commande.</span>`,
    'Grandes');

  html += blocCat('➕', 'Suppléments',
    `${pctStr(caCatOf(/supp/i), caTot)} de ton CA · ${aS.pct}% des ventes · supplément moyen ${fmt(prixMoyS)}`,
    `Ne demande <b>jamais</b> « un supplément ? » : la réponse est non. <b>Nomme-le selon la pizza</b> :<br>` +
    `👉 Margherita → « je te rajoute le supplément fromages${prixMoyS ? ` (${fmt(prixMoyS)})` : ''} ? »<br>` +
    `👉 Piccante → « un peu de salsiccia en plus ? »<br>` +
    `Inutile sur une 4 Formaggi : vise les recettes simples, ce sont elles qui appellent un ajout.` +
    (starS ? `<br>Ton supplément le plus pris : ${starS[0]} (${starS[1].qty} fois).` : '') +
    `<br><span style="color:#777">100% de valeur ajoutée sur des pizzas déjà vendues — et un client qui « compose sa pizza » en parle autour de lui.</span>`,
    'Suppléments');

  // Les leviers transverses (communes, horaires, groupes, fidélité, carte).
  const transverses = actOf('transverse').filter(a => a.gainEur >= 1);
  if (transverses.length) html += sec('🔁 Et les leviers qui ne tiennent pas dans une seule catégorie',
    transverses.map(a => `<div style="background:#fff;border:1px solid ${C.line};border-radius:8px;padding:11px 14px;margin:7px 0;font-size:13px;line-height:1.6">
      ${a.emoji} <b>${a.constat.charAt(0).toUpperCase() + a.constat.slice(1)}</b><br>
      <span style="color:${C.green}">🎯 ${a.phrase} → ${gain(a.gainEur)}</span></div>`).join(''));

  // Le tableau de bord du plan : les 5 actions les plus rentables, dans l'ordre.
  if (actionsFortes.length) html += sec('🏁 Si tu ne retiens que 5 choses',
    tbl(`<tr>${th('#')}${th('L\'action')}${th('Ça rapporte')}</tr>` +
      actionsFortes.slice(0, 5).map((a, i) => `<tr>${td('<b>' + (i + 1) + '</b>')}${td(a.emoji + ' ' + a.phrase)}${td(fmt(a.gainEur), 1)}</tr>`).join('') +
      `<tr style="background:#f2f6ec">${td('')}${td('<b>Total si tu tiens les cinq</b>', 1)}${td('<b>' + fmt(totalGain) + ' / mois</b>', 1)}</tr>`) +
    note('Estimations prudentes, calculées sur tes propres chiffres du mois et sur des taux de conversion volontairement bas. Les gains ne se cumulent qu\'une fois : les analyses par commune et par tranche de panier servent à cibler l\'effort, pas à additionner les euros. Le récap du mois prochain mesurera ce qui a bougé.'));

  // ══════════════════════════════════════════════════════════════════════════
  html += part('🔧 6. L\'opérationnel', 'encaissement, gestes commerciaux et obligations d\'hygiène');

  // Paiements
  const pctE = Math.round(caEsp / caTot * 100);
  const tkCarte = tk.filter(t => t.pay !== 'especes'), tkEsp = tk.filter(t => t.pay === 'especes');
  html += sec('💳 Paiements', tbl(
    `<tr>${th('Mode')}${th('Montant')}${th('Part')}${th('Panier moyen')}${th('Mois préc.')}</tr>` +
    `<tr>${td('💶 Espèces')}${td(fmt(caEsp), 1)}${td(pctE + '%')}${td(tkEsp.length ? fmt(caEsp / tkEsp.length) : '—')}${td(caTotP ? Math.round(caEspP / caTotP * 100) + '%' : '—')}</tr>` +
    `<tr>${td('💳 Carte')}${td(fmt(caTot - caEsp), 1)}${td(100 - pctE + '%')}${td(tkCarte.length ? fmt((caTot - caEsp) / tkCarte.length) : '—')}${td(caTotP ? 100 - Math.round(caEspP / caTotP * 100) + '%' : '—')}</tr>`) +
    note('Le panier carte est mécaniquement plus élevé : les grosses commandes se règlent naturellement par carte. Rien à en conclure, sinon qu\'un « CB acceptée, sans minimum » bien visible ne coûte rien.'));

  // Attachement global
  html += sec('🧲 Taux d\'attachement', tbl(
    `<tr>${th('Catégorie')}${th('Ventes avec')}${th('Taux')}${th('Mois précédent')}</tr>` +
    attach.map((a, i) => `<tr>${td(a.label)}${td(a.n + ' / ' + nbTk)}${td(a.pct + '%', 1)}${td(tkP.length ? attachP[i].pct + '%' : '—')}</tr>`).join('')));

  // Gestes commerciaux & annulations
  html += sec('🎁 Gestes commerciaux & annulations', tbl(
    `<tr>${td('🎁 Articles offerts', 1)}${td(plur(offertsQty, 'article'))}${td(pctStr(offertsQty, nbTk) + ' des ventes')}</tr>` +
    `<tr>${td('🚫 Ventes annulées', 1)}${td(plur(cancelled.n, 'vente'))}${td(fmt(cancelled.ca))}</tr>`) +
    (nbTk && offertsQty / nbTk < 0.01
      ? box(`💳 <b>Ta carte de fidélité dort dans le tiroir</b> (${pctStr(offertsQty, nbTk)} de gestes seulement). Le geste qui change tout : donne-la <b>en main propre, premier tampon déjà coché</b>, à chaque ticket un peu généreux. Ça ne coûte rien ce soir, et un client encarté revient.`)
      : note('Le taux de gestes commerciaux est le seul indicateur de fidélité mesurable sans fichier client : au-dessus de 1%, le programme vit.')));

  // HACCP
  if (temps.length) html += sec('🌡️ Relevés de température (HACCP)', tbl(
    `<tr>${th('Enceinte')}${th('Jours relevés')}${th('')}</tr>` +
    temps.map(t => `<tr>${td(t.name)}${td(t.done + ' / ' + dernierJour + ' jours', 1)}<td style="padding:7px 10px;border-bottom:1px solid ${C.line};width:30%">${bar(t.done, dernierJour, t.done >= dernierJour * 0.8 ? C.green : '#e0a93a')}</td></tr>`).join('')) +
    note('Jours sans activité compris — l\'important est la régularité les soirs travaillés.'));

  // ══════════════════════════════════════════════════════════════════════════
  html += part(`🚀 7. À tester en ${moisNom(nKey)}`, 'les idées du mois prochain, tirées de tes chiffres et du calendrier');

  const idees = [];
  // Les leviers qui n'ont pas tenu dans le top 5 : rien ne se perd.
  actionsFortes.slice(5).forEach(a => idees.push(`${a.emoji} <b>${a.constat.charAt(0).toUpperCase() + a.constat.slice(1)}</b> → ${a.phrase} (${fmt(a.gainEur)} par mois).`));
  // Rendez-vous du calendrier croisés avec la tournée : date ET commune.
  eventsOfMonth(nKey).forEach(e => idees.push(
    `🗓️ <b>${JOURS[e.g].toLowerCase()} ${e.d} ${moisNom(nKey)}</b> — ${e.txt} C'est ton soir à <b>${e.city}</b> : prévois le post trois jours avant.`));
  if (idees.length < 5) idees.push(IDEE_SAISON[nKey.slice(5, 7)]);
  html += `<div style="background:#fff;border:1px solid ${C.line};border-radius:8px;padding:12px 16px">` +
    idees.slice(0, 6).map(i => `<div style="font-size:13px;margin:9px 0;color:#333;line-height:1.6">${i}</div>`).join('') + '</div>';

  // ── Enveloppe & envoi ───────────────────────────────────────────────────────
  const previewBanner = upToDay
    ? `<div style="background:#fff6e6;color:#7a4e00;border-bottom:2px solid #e0a93a;padding:10px 24px;font-size:13px;font-weight:700">
         🔎 Aperçu du mois en cours — du 1er au ${upToDay} ${monthLabelFr(mKey).toLowerCase()}. Les comparaisons portent sur un mois encore incomplet face à un mois entier. L'e-mail automatique partira le 1er du mois suivant, sur le mois complet.</div>`
    : '';
  const periode = upToDay ? `1–${upToDay} ${monthLabelFr(mKey).toLowerCase()}` : monthLabelFr(mKey);
  const full = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:auto;background:${C.bg};padding:0 0 24px;border-radius:12px;overflow:hidden">
    <div style="background:${C.brand};color:#fff;padding:22px 24px">
      <div style="font-size:20px;font-weight:800">🍕 La Casetta — Récap du mois</div>
      <div style="opacity:.85;font-size:13px;margin-top:4px">${periode} · ${joursActifs} soirées</div>
    </div>
    ${previewBanner}
    <div style="padding:20px 24px">
      ${html}
      <p style="font-size:12px;color:#999;margin-top:24px">
        Détails complets dans ton Google Sheet «&nbsp;La Casetta — Caisse&nbsp;».<br>
        Seules les ventes remontées dans Google Sheets sont comptées — une vente restée sur un iPad hors ligne n'apparaît pas.
      </p>
    </div>
  </div>`;

  const subject = (upToDay ? '[Aperçu] ' : '') + `🍕 La Casetta — Récap du mois : ${monthLabelFr(mKey)} · ${fmt(caTot)} · ${plur(nbTk, 'vente')}`;
  // Le bilan mensuel part en intégralité à tous les destinataires (les sections
  // configurables de RECIPIENTS ne concernent que les récaps quotidiens).
  RECIPIENTS.forEach(r => MailApp.sendEmail({ to: r.email, subject: subject, htmlBody: full }));
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
//  SAUVEGARDE CLIENTS (fidélité) & CLÔTURES DE CAISSE
// ════════════════════════════════════════════
// L'iPad pousse ses fiches clients et ses clôtures pour qu'un appareil perdu ou
// réinitialisé ne perde ni la fidélité ni l'historique de caisse. Fusion par
// upsert (jamais de suppression côté Sheet) : c'est une sauvegarde.

const CLIENT_HEADERS  = ['ID', 'Nom', 'Téléphone', 'Notes', 'Pizzas fidélité', 'Récompenses utilisées', 'Créé le', 'Mis à jour le'];
const CLOSURE_HEADERS = ['Date', 'Employé', 'Emplacement', 'Tickets', 'CA total (€)', 'Espèces (€)', 'Carte (€)', 'Remises (€)',
                         'Fond de caisse (€)', 'Espèces comptées (€)', 'Écart (€)', 'Notes', 'Enregistré le'];

function getBackupSheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    styleHeader(sh, headers.length, '#76894F');
  }
  return sh;
}

function saveClientsBackup(ss, list) {
  if (!Array.isArray(list)) return 0;
  const sh  = getBackupSheet(ss, '👤 Clients', CLIENT_HEADERS);
  const now = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
  const lr  = sh.getLastRow();
  const index = {};
  if (lr > 1) sh.getRange(2, 1, lr - 1, 1).getValues().forEach((r, i) => { if (r[0]) index[String(r[0])] = i + 2; });
  let n = 0;
  list.forEach(c => {
    if (!c || !c.id) return;
    const row = [String(c.id), c.name || '', c.phone || '', c.notes || '',
                 Number(c.pizzaCount) || 0, Number(c.rewardsUsed) || 0, c.createdAt || '', now];
    const at = index[String(c.id)];
    if (at) sh.getRange(at, 1, 1, CLIENT_HEADERS.length).setValues([row]);
    else { sh.appendRow(row); index[String(c.id)] = sh.getLastRow(); }
    n++;
  });
  return n;
}

function getClientsBackup(ss) {
  const sh = ss.getSheetByName('👤 Clients');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, CLIENT_HEADERS.length).getValues()
    .filter(r => r[0] !== '' && r[0] != null)
    .map(r => ({ id: String(r[0]), name: String(r[1] || ''), phone: String(r[2] || ''), notes: String(r[3] || ''),
                 pizzaCount: Number(r[4]) || 0, rewardsUsed: Number(r[5]) || 0, createdAt: String(r[6] || '') }));
}

function saveClosuresBackup(ss, list) {
  if (!Array.isArray(list)) return 0;
  const sh = getBackupSheet(ss, '🧾 Clôtures', CLOSURE_HEADERS);
  const lr = sh.getLastRow();
  const index = {};
  if (lr > 1) sh.getRange(2, 1, lr - 1, 1).getValues().forEach((r, i) => { const k = dateKey(r[0]); if (k) index[k] = i + 2; });
  let n = 0;
  list.forEach(c => {
    if (!c || !c.date) return;
    const row = [c.date, c.employee || '', c.location || '', Number(c.tickets) || 0,
                 eur(c.total), eur(c.especes), eur(c.carte), eur(c.remises),
                 eur(c.float), eur(c.counted), eur(c.gap), c.notes || '', c.savedAt || ''];
    const at = index[c.date];
    if (at) sh.getRange(at, 1, 1, CLOSURE_HEADERS.length).setValues([row]);
    else { sh.appendRow(row); index[c.date] = sh.getLastRow(); }
    n++;
  });
  return n;
}

function getClosuresBackup(ss) {
  const sh = ss.getSheetByName('🧾 Clôtures');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, CLOSURE_HEADERS.length).getValues()
    .filter(r => r[0] !== '' && r[0] != null)
    .map(r => ({ date: dateKey(r[0]), employee: String(r[1] || ''), location: String(r[2] || ''),
                 tickets: Number(r[3]) || 0, total: Number(r[4]) || 0, especes: Number(r[5]) || 0,
                 carte: Number(r[6]) || 0, remises: Number(r[7]) || 0, float: Number(r[8]) || 0,
                 counted: Number(r[9]) || 0, gap: Number(r[10]) || 0, notes: String(r[11] || ''),
                 savedAt: String(r[12] || '') }));
}

// ── Annotations de vente : raison de modification / annulation + note libre ──
// Onglet DÉDIÉ, indexé par ID de vente (upsert, jamais de suppression). La
// feuille « Transactions » n'est jamais touchée : ajouter une colonne l'archive-
// rait et repartirait de zéro. Une raison/note peut arriver bien après la vente.
const ANNOTATION_HEADERS = ['ID Transaction', 'Raison', 'Note', 'Mis à jour le'];

function saveAnnotationsBackup(ss, list) {
  if (!Array.isArray(list)) return 0;
  const sh  = getBackupSheet(ss, '🗒️ Annotations', ANNOTATION_HEADERS);
  const now = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
  const lr  = sh.getLastRow();
  const index = {};
  if (lr > 1) sh.getRange(2, 1, lr - 1, 1).getValues().forEach((r, i) => { if (r[0]) index[String(r[0])] = i + 2; });
  let n = 0;
  list.forEach(a => {
    if (!a || !a.id) return;
    const row = [String(a.id), a.reason || '', a.note || '', now];
    const at = index[String(a.id)];
    if (at) sh.getRange(at, 1, 1, ANNOTATION_HEADERS.length).setValues([row]);
    else { sh.appendRow(row); index[String(a.id)] = sh.getLastRow(); }
    n++;
  });
  return n;
}

function getAnnotationsBackup(ss) {
  const sh = ss.getSheetByName('🗒️ Annotations');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, ANNOTATION_HEADERS.length).getValues()
    .filter(r => r[0] !== '' && r[0] != null)
    .map(r => ({ id: String(r[0]), reason: String(r[1] || ''), note: String(r[2] || ''), updatedAt: String(r[3] || '') }));
}

// ════════════════════════════════════════════
//  JETON D'ACCÈS (protection des endpoints /exec)
// ════════════════════════════════════════════
// L'URL /exec est publique (dépôt GitHub public) : sans jeton, n'importe qui
// peut lire tout l'historique de ventes ou injecter des données.
// 1) Choisis un jeton (longue phrase aléatoire), colle-le ci-dessous,
//    exécute setupToken() UNE FOIS, puis EFFACE la valeur (elle est conservée
//    dans les Script Properties privées).
// 2) Renseigne le MÊME jeton sur chaque iPad : ☰ ▸ 🛡️ Jeton Google Sheets.
// Tant que la propriété POS_TOKEN n'existe pas, l'accès reste ouvert
// (compatibilité : rien ne casse avant que tu aies fait les deux étapes).
function setupToken() {
  const TOKEN = 'COLLE_ICI_TON_JETON';
  PropertiesService.getScriptProperties().setProperty('POS_TOKEN', TOKEN);
  Logger.log('Jeton enregistré dans les Script Properties. Efface la valeur ci-dessus, redéploie, puis saisis le même jeton sur chaque iPad (☰ ▸ 🛡️ Jeton Google Sheets).');
}

function tokenOk(e) {
  const t = PropertiesService.getScriptProperties().getProperty('POS_TOKEN');
  if (!t) return true;   // pas de jeton configuré → accès ouvert
  return !!(e && e.parameter && e.parameter.token === t);
}

// ════════════════════════════════════════════
//  doPost / doGet
// ════════════════════════════════════════════

function doPost(e) {
  try {
    if (!tokenOk(e)) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
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

    // Sauvegarde des fiches clients (fidélité) — onglet « 👤 Clients ».
    if (data && !Array.isArray(data) && data.clientsSync) {
      const n = saveClientsBackup(ss, data.clientsSync);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, clients: n }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Demande d'envoi du récap du jour, émise par l'iPad quand sa file de ventes
    // est vide (WiFi retrouvé + tout est remonté). C'est le SEUL déclencheur de
    // l'e-mail : 2 min plus tard, réarmé à chaque nouvelle demande.
    if (data && !Array.isArray(data) && data.dailyReportArm) {
      scheduleDailyReport();
      return ContentService.createTextOutput(JSON.stringify({ ok: true, armed: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Sauvegarde des clôtures de caisse — onglet « 🧾 Clôtures ».
    if (data && !Array.isArray(data) && data.closuresSync) {
      const n = saveClosuresBackup(ss, data.closuresSync);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, closures: n }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Raisons + notes de vente — onglet « 🗒️ Annotations » (upsert par ID).
    if (data && !Array.isArray(data) && data.annotationsSync) {
      const n = saveAnnotationsBackup(ss, data.annotationsSync);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, annotations: n }))
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
      const pay  = payLabel(tx);
      tx.lines.forEach(l => {
        sheet.appendRow([tx.id, d, time, '', l.name, l.category||'', l.price, l.qty, l.subtotal,
                         tx.total, nb, pay, loc, stat, sync]);
        added++;
      });
    });

    if (added > 0) {
      sheet.getRange('B2:B').setNumberFormat('dd/mm/yyyy');
      numberTickets(sheet);
      createAllSheets(ss);
      // Pas d'armement du récap ici : l'arrivée de ventes ne déclenche plus rien.
      // C'est l'iPad qui arme (action=armdailyreport) une fois sa file vidée.
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

  if (!tokenOk(e)) {
    const err = JSON.stringify({ ok: false, error: 'unauthorized' });
    return cb
      ? ContentService.createTextOutput(cb + '(' + err + ')').setMimeType(ContentService.MimeType.JAVASCRIPT)
      : ContentService.createTextOutput(err).setMimeType(ContentService.MimeType.JSON);
  }

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
  } else if (action === 'clients') {
    payload = { ok: true, clients: getClientsBackup(getOrCreateSpreadsheet()) };
  } else if (action === 'closures') {
    payload = { ok: true, closures: getClosuresBackup(getOrCreateSpreadsheet()) };
  } else if (action === 'annotations') {
    payload = { ok: true, annotations: getAnnotationsBackup(getOrCreateSpreadsheet()) };
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

// Colonne « Paiement » : pour un paiement mixte, le détail espèces/carte est
// encodé dans le libellé (ex. « mixte (espèces 12,50 € + carte 8,00 €) ») afin
// de survivre au rechargement des ventes par le POS — la clôture de caisse en a
// besoin pour calculer les « espèces attendues ». Pas de colonne supplémentaire :
// changer HEADERS archiverait la feuille Transactions et repartirait de zéro.
function payLabel(tx) {
  if (tx.method === 'mixte' && tx.split) {
    const f = n => (Math.round((Number(n)||0)*100)/100).toFixed(2).replace('.', ',');
    return 'mixte (espèces ' + f(tx.split.especes) + ' € + carte ' + f(tx.split.carte) + ' €)';
  }
  return tx.method;
}

// Opération inverse : relit méthode + répartition depuis la colonne Paiement.
// Les anciennes lignes « mixte » sans détail redonnent { method: 'mixte' } seul.
function parsePay(raw) {
  const s = String(raw || '');
  if (!/^mixte/i.test(s)) return { method: s };
  const mE = s.match(/esp[eè]ces?\s*([\d]+(?:[.,]\d+)?)/i);
  const mC = s.match(/carte\s*([\d]+(?:[.,]\d+)?)/i);
  if (!mE || !mC) return { method: 'mixte' };
  const num = m => Number(m[1].replace(',', '.'));
  return { method: 'mixte', split: { especes: num(mE), carte: num(mC) } };
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
      const pp = parsePay(r[COL.pay]);
      map[id] = {
        id: id,
        date: d.toISOString(),
        location: r[COL.loc] || '',
        method: pp.method,
        split: pp.split,
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
