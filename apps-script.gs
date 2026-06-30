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
const PROP_KEY   = 'SPREADSHEET_ID';
const TZ         = 'Europe/Paris';

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

// ════════════════════════════════════════════
//  SPREADSHEET / FEUILLE TRANSACTIONS
// ════════════════════════════════════════════

function getOrCreateSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty(PROP_KEY), ss;
  if (ssId) { try { ss = SpreadsheetApp.openById(ssId); } catch(e) { ssId = null; } }
  if (!ssId) { ss = SpreadsheetApp.create('La Casetta — Caisse'); props.setProperty(PROP_KEY, ss.getId()); }
  return ss;
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
      art: r[COL.article], cat: r[COL.cat],
      qty: Number(r[COL.qty])||0, sub: Number(r[COL.sub])||0,
      hour: String(r[COL.heure]).slice(0,2),
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
        hour:  String(r[COL.heure]).slice(0,2)
      };
    }
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
    `⚠️  Moins vendu : ${g(topArts,topArts.length-1)} → ${f(gv(topArts,topArts.length-1))} (${artQty[g(topArts,topArts.length-1)]||0} vendus)`,
    `⚠️  2e moins vendu : ${g(topArts,topArts.length-2)} → ${f(gv(topArts,topArts.length-2))}`,
    `👉  Astuce : envisage de retirer ces articles ou de les proposer en "offre du jour".`,
    '━━━  🍕  CATÉGORIES  ━━━',
    ...topCat.map(([cat,ca],i) => `${i===0?'🥇':i===1?'🥈':'🥉'}  ${cat} → ${f(ca)} (${pct(ca,totalCA)})`),
    `👉  Astuce : les suppléments représentent ${pct(catCA['Suppléments']||0, totalCA)} du CA — propose-les systématiquement ("Vous voulez un supplément fromage ?").`,
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

// Destinataires du récap (séparés par des virgules).
const REPORT_EMAIL = 'cyril.delabarre@hotmail.com, clemence.bailly89@gmail.com';

// Construit et envoie le récap de la semaine écoulée (7 derniers jours).
function sendWeeklyReport() {
  const ss    = getOrCreateSpreadsheet();
  const stats = computeStats(readValidatedRows(ss));
  const now   = new Date();
  const within7 = d => (now - d) / 86400000 <= 7;

  const tk = stats.tickets.filter(t => within7(t.date));
  const ln = stats.lines.filter(l => within7(l.date));

  const fmt = n => (Math.round((Number(n)||0)*100)/100).toFixed(2).replace('.',',') + ' €';
  const pct = (a,b) => b ? Math.round(a/b*100)+'%' : '—';
  const periode = `${Utilities.formatDate(new Date(now-7*86400000), TZ, 'dd/MM')} – ${Utilities.formatDate(now, TZ, 'dd/MM/yyyy')}`;

  if (!tk.length) {
    MailApp.sendEmail({ to: REPORT_EMAIL, subject: `🍕 La Casetta — aucune vente cette semaine (${periode})`,
      htmlBody: `<p>Bonjour,</p><p>Aucune vente enregistrée sur la période <b>${periode}</b>.</p>` });
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
  const topArts = sortDescByVal(artCA).slice(0,5);
  const locRows = sortDescByVal(byLoc);
  const dayRows = Object.keys(byDay).sort().map(k=>byDay[k]);

  // ── HTML ──
  const C = { brand:'#89310B', green:'#76894F', bg:'#faf7f4', line:'#e7ddd6' };
  const kpi = (label,val) =>
    `<td style="padding:14px;background:#fff;border:1px solid ${C.line};border-radius:10px;text-align:center;width:25%">
       <div style="font-size:22px;font-weight:800;color:${C.brand}">${val}</div>
       <div style="font-size:12px;color:#888;margin-top:4px">${label}</div></td>`;
  const th = t => `<th align="left" style="padding:8px 10px;background:${C.green};color:#fff;font-size:13px">${t}</th>`;
  const td = (v,b)=>`<td style="padding:8px 10px;border-bottom:1px solid ${C.line};font-size:13px${b?';font-weight:700':''}">${v}</td>`;

  // Recommandations (mêmes insights que la feuille, sur la semaine écoulée)
  const recoHtml = insightLines(tk, ln).map(line => {
    if (line.startsWith('━━━'))
      return `<div style="font-weight:700;color:${C.brand};font-size:14px;margin:16px 0 6px">${line.replace(/━/g,'').trim()}</div>`;
    if (line.startsWith('👉'))
      return `<div style="font-style:italic;color:${C.green};font-size:13px;margin:3px 0;padding-left:4px">${line}</div>`;
    return `<div style="font-size:13px;margin:3px 0;color:#333">${line}</div>`;
  }).join('');

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:auto;background:${C.bg};padding:0 0 24px;border-radius:12px;overflow:hidden">
    <div style="background:${C.brand};color:#fff;padding:22px 24px">
      <div style="font-size:20px;font-weight:800">🍕 La Casetta — Récap de la semaine</div>
      <div style="opacity:.85;font-size:13px;margin-top:4px">${periode}</div>
    </div>
    <div style="padding:20px 24px">
      <table width="100%" cellspacing="8" cellpadding="0"><tr>
        ${kpi('CA total', fmt(caTot))}${kpi('Tickets', nbTk)}${kpi('Ticket moyen', fmt(ticketMoy))}${kpi('Articles vendus', nbArt)}
      </tr></table>

      <h3 style="color:${C.brand};margin:22px 0 8px;font-size:15px">💳 Paiements</h3>
      <table width="100%" cellspacing="0" style="background:#fff;border:1px solid ${C.line};border-radius:8px;overflow:hidden">
        <tr>${th('Mode')}${th('Montant')}${th('Part')}</tr>
        <tr>${td('💶 Espèces')}${td(fmt(caEsp))}${td(pct(caEsp,caTot))}</tr>
        <tr>${td('💳 Carte')}${td(fmt(caCarte))}${td(pct(caCarte,caTot))}</tr>
      </table>

      <h3 style="color:${C.brand};margin:22px 0 8px;font-size:15px">🏆 Top articles</h3>
      <table width="100%" cellspacing="0" style="background:#fff;border:1px solid ${C.line};border-radius:8px;overflow:hidden">
        <tr>${th('Article')}${th('Qté')}${th('CA')}</tr>
        ${topArts.map(([a,c])=>`<tr>${td(a)}${td(artQty[a])}${td(fmt(c),true)}</tr>`).join('')}
      </table>

      <h3 style="color:${C.brand};margin:22px 0 8px;font-size:15px">📍 CA par emplacement</h3>
      <table width="100%" cellspacing="0" style="background:#fff;border:1px solid ${C.line};border-radius:8px;overflow:hidden">
        <tr>${th('Emplacement')}${th('CA')}${th('Part')}</tr>
        ${locRows.map(([l,c])=>`<tr>${td('📍 '+l)}${td(fmt(c),true)}${td(pct(c,caTot))}</tr>`).join('')}
      </table>

      <h3 style="color:${C.brand};margin:22px 0 8px;font-size:15px">📅 Détail par jour</h3>
      <table width="100%" cellspacing="0" style="background:#fff;border:1px solid ${C.line};border-radius:8px;overflow:hidden">
        <tr>${th('Jour')}${th('Tickets')}${th('CA')}</tr>
        ${dayRows.map(d=>`<tr>${td(d.label)}${td(d.n)}${td(fmt(d.ca),true)}</tr>`).join('')}
      </table>

      <h3 style="color:${C.brand};margin:26px 0 4px;font-size:16px">💡 Recommandations de la semaine</h3>
      <div style="background:#fff;border:1px solid ${C.line};border-radius:8px;padding:12px 16px">
        ${recoHtml}
      </div>

      <p style="font-size:12px;color:#999;margin-top:24px">
        Détails complets et recommandations dans ton Google Sheet «&nbsp;La Casetta — Caisse&nbsp;».<br>
        Email automatique envoyé chaque lundi.
      </p>
    </div>
  </div>`;

  MailApp.sendEmail({
    to: REPORT_EMAIL,
    subject: `🍕 La Casetta — Récap semaine : ${fmt(caTot)} · ${nbTk} tickets (${periode})`,
    htmlBody: html
  });
}

// À EXÉCUTER UNE FOIS depuis l'éditeur : programme l'envoi chaque lundi à 8h.
function createWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendWeeklyReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendWeeklyReport')
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).nearMinute(0).create();
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
    const sheet = getOrCreateTransactionsSheet(ss);
    const data  = JSON.parse(e.postData.contents);
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
    }

    return ContentService.createTextOutput(JSON.stringify({ok:true, lines:added}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false, error:err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ok:true}))
    .setMimeType(ContentService.MimeType.JSON);
}

// ════════════════════════════════════════════
//  OUTIL : reconstruire toutes les feuilles à la demande
//  (Exécuter cette fonction une fois depuis l'éditeur après mise à jour)
// ════════════════════════════════════════════
function rebuildAll() {
  const ss = getOrCreateSpreadsheet();
  numberTickets(ss.getSheetByName(SHEET_NAME));
  createAllSheets(ss);
}
