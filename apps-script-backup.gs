/**
 * La Casetta — SAUVEGARDE & ARCHIVES  (projet Apps Script SÉPARÉ)
 * --------------------------------------------------------------
 * Tourne sous ton compte Google et n'écrit JAMAIS dans le classeur de prod.
 * - Sauvegarde quotidienne : copie horodatée du classeur, partagée avec un 2e
 *   compte Google, avec rotation (on garde les KEEP_BACKUPS dernières).
 * - Archives mensuelles : un fichier « Transactions AAAA-MM » par mois,
 *   régénéré chaque jour depuis le classeur maître (source de vérité).
 *
 * INSTALLATION (une fois) :
 *   1. script.google.com ▸ Nouveau projet ▸ colle ce fichier.
 *   2. Renseigne BACKUP_EMAIL ci-dessous.
 *   3. Exécute la fonction  installEtLancer  (autorise les accès Drive quand demandé).
 *      → crée le déclencheur quotidien + fait une 1re sauvegarde + les fichiers du mois.
 *   (Facultatif : déployer en Application Web pour piloter/vérifier à distance.)
 */

// ── Configuration ─────────────────────────────────────────────────────────────
const SPREADSHEET_ID = '1z57pfgXEkwCSyEH_CISd8zVoepcBH5GE_fTcDRxErGQ'; // classeur maître (prod)
const BACKUP_EMAIL   = 'cyrildelabarre86@gmail.com'; // 2e compte Google (autre Drive)
const SHEET_NAME     = 'Transactions';
const TZ             = 'Europe/Paris';
const KEEP_BACKUPS   = 30;            // nombre de copies de sauvegarde conservées
const BACKUP_FOLDER  = 'La Casetta — Sauvegardes';
const ARCHIVE_FOLDER = 'La Casetta — Archives mensuelles';
const COL_DATE       = 1;             // colonne B (0-based) = Date, pour filtrer par mois
const TEMP_EXPORT_FOLDER = 'La Casetta — Relevés température'; // exports PDF/XLSX mensuels
const TEMP_RANGES = {                 // plages par type d'enceinte (comme le POS)
  frigo:       [8, 7, 6, 5, 4, 3, 2, 1, 0],
  congelateur: [-14, -15, -16, -17, -18, -19, -20, -21, -22]
};

// ══════════════════════════════════════════════════════════════════════════════
//  À EXÉCUTER UNE FOIS
// ══════════════════════════════════════════════════════════════════════════════
function installEtLancer() {
  installTriggers();
  const b = backupNow();
  const m = dailyArchive();
  Logger.log('Installé. Sauvegarde : ' + b + '\nArchives : ' + JSON.stringify(m));
}

// Crée (ou recrée) le déclencheur quotidien vers 01h00.
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'dailyJob') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyJob').timeBased().atHour(1).nearMinute(0).everyDays(1).create();
}

// ══════════════════════════════════════════════════════════════════════════════
//  TÂCHE QUOTIDIENNE
// ══════════════════════════════════════════════════════════════════════════════
function dailyJob() {
  backupNow();
  dailyArchive();
  dailyTempExport();
}

// Régénère l'export des relevés de température du mois en cours et précédent.
function dailyTempExport() {
  return {
    courant:   exportTempMonth(ym(new Date())),
    precedent: exportTempMonth(ym(addMonths(new Date(), -1)))
  };
}

// Régénère le fichier du mois en cours ET du mois précédent (pour rattraper une
// vente d'hier synchronisée après minuit). Crée automatiquement le nouveau mois.
function dailyArchive() {
  return {
    courant:   exportMonth(ym(new Date())),
    precedent: exportMonth(ym(addMonths(new Date(), -1)))
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  SAUVEGARDE (copie horodatée + rotation + partage)
// ══════════════════════════════════════════════════════════════════════════════
function backupNow() {
  const folder = getOrCreateFolder(BACKUP_FOLDER);
  const stamp  = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd_HH'h'mm");
  const name   = 'La Casetta — Sauvegarde ' + stamp;
  const copy   = DriveApp.getFileById(SPREADSHEET_ID).makeCopy(name, folder);
  shareFolders();
  rotateBackups(folder);
  return copy.getUrl();
}

// Ne garde que les KEEP_BACKUPS copies les plus récentes.
function rotateBackups(folder) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort((a, b) => b.getDateCreated().getTime() - a.getDateCreated().getTime());
  files.slice(KEEP_BACKUPS).forEach(f => f.setTrashed(true));
}

// ══════════════════════════════════════════════════════════════════════════════
//  ARCHIVES MENSUELLES (un fichier par mois)
// ══════════════════════════════════════════════════════════════════════════════
function exportMonth(mois) {
  mois = mois || ym(new Date());
  const src    = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const values = src.getDataRange().getValues();
  if (values.length < 1) return '';
  const header = values[0];
  const rows   = values.slice(1).filter(r => cellYm(r[COL_DATE]) === mois);

  const folder = getOrCreateFolder(ARCHIVE_FOLDER);
  const title  = 'La Casetta — Transactions ' + mois;
  let ss = findByName(folder, title);
  if (!ss) {
    ss = SpreadsheetApp.create(title);
    moveToFolder(DriveApp.getFileById(ss.getId()), folder);
  }
  const sheet = ss.getSheets()[0];
  sheet.setName(mois);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (rows.length) sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
  sheet.setFrozenRows(1);
  shareFolders();
  return ss.getUrl();
}

// ══════════════════════════════════════════════════════════════════════════════
//  RELEVÉS DE TEMPÉRATURE — export mensuel PDF + XLSX (vue grille du POS)
// ══════════════════════════════════════════════════════════════════════════════
function exportTempMonth(mois) {
  mois = mois || ym(new Date());
  const master = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tempSheets = master.getSheets().filter(s => s.getName().indexOf('🌡️ ') === 0);
  if (!tempSheets.length) return '';

  const folder = getOrCreateFolder(TEMP_EXPORT_FOLDER);
  const title  = 'La Casetta — Relevés température ' + mois;
  let out = findByName(folder, title);
  if (!out) { out = SpreadsheetApp.create(title); moveToFolder(DriveApp.getFileById(out.getId()), folder); }

  // Repart d'un onglet temporaire propre.
  const tmp = out.getSheets()[0];
  tmp.setName('_tmp'); tmp.clear();
  out.getSheets().forEach(s => { if (s.getSheetId() !== tmp.getSheetId()) out.deleteSheet(s); });

  let any = false;
  tempSheets.forEach(src => {
    const grid = buildTempGrid(src, mois);
    if (!grid) return;
    any = true;
    const encName = src.getName().replace('🌡️ ', '').slice(0, 90);
    const sh = out.insertSheet(encName);
    sh.getRange(1, 1, grid.length, grid[0].length).setValues(grid);
    sh.setFrozenRows(1); sh.setFrozenColumns(1);
    sh.getRange(1, 1, 1, grid[0].length).setFontWeight('bold');
    sh.getRange(1, 1, grid.length, 1).setFontWeight('bold');
    sh.setColumnWidths(2, grid[0].length - 1, 26);
  });
  if (!any) return '';
  if (out.getSheetByName('_tmp')) out.deleteSheet(out.getSheetByName('_tmp'));
  SpreadsheetApp.flush();
  exportSpreadsheetFile(out.getId(), folder, title);
  shareFolders();
  return out.getUrl();
}

// Construit la grille d'une enceinte pour un mois : T°C (lignes) × jours 1→31,
// pastille ● à la température relevée, + ligne des initiales.
function buildTempGrid(src, mois) {
  const vals = src.getDataRange().getValues(); // Date, Température, Initiales, Type, MàJ
  if (vals.length < 2) return null;
  const byDay = {}; let type = 'frigo'; let has = false;
  vals.slice(1).forEach(r => {
    const k = dateKeyBK(r[0]);
    if (!k || k.slice(0, 7) !== mois) return;
    has = true;
    byDay[parseInt(k.slice(8, 10), 10)] = { temp: r[1], initials: r[2] };
    if (String(r[3]).toLowerCase() === 'congelateur') type = 'congelateur';
  });
  if (!has) return null;
  const temps = TEMP_RANGES[type];
  const days = []; for (let d = 1; d <= 31; d++) days.push(d);
  const grid = [['T°C \\ Jour'].concat(days)];
  temps.forEach(t => {
    grid.push([t + '°C'].concat(days.map(d => (byDay[d] && Number(byDay[d].temp) === t) ? '●' : '')));
  });
  grid.push(['Initiales'].concat(days.map(d => (byDay[d] && byDay[d].initials) ? byDay[d].initials : '')));
  return grid;
}

// Exporte le classeur en PDF (paysage) et XLSX dans le dossier (remplace les anciens).
function exportSpreadsheetFile(ssId, folder, baseName) {
  const opt  = { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  const base = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?';
  const pdfUrl  = base + 'format=pdf&size=A4&portrait=false&fitw=true&gridlines=true&sheetnames=true';
  const xlsxUrl = base + 'format=xlsx';
  ['.pdf', '.xlsx'].forEach(ext => {
    const it = folder.getFilesByName(baseName + ext);
    while (it.hasNext()) it.next().setTrashed(true);
  });
  folder.createFile(UrlFetchApp.fetch(pdfUrl,  opt).getBlob().setName(baseName + '.pdf'));
  folder.createFile(UrlFetchApp.fetch(xlsxUrl, opt).getBlob().setName(baseName + '.xlsx'));
}

function dateKeyBK(v) {
  if (v === '' || v == null) return '';
  const d = (v instanceof Date) ? v : new Date(v);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

// ══════════════════════════════════════════════════════════════════════════════
//  PILOTAGE / VÉRIFICATION À DISTANCE (facultatif : nécessite un déploiement Web)
// ══════════════════════════════════════════════════════════════════════════════
function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : '';
  const cb     = e && e.parameter ? e.parameter.callback : '';
  let payload;
  if (action === 'backup')       payload = { ok: true, url: backupNow() };
  else if (action === 'archive') payload = { ok: true, files: dailyArchive() };
  else if (action === 'exportmonth') payload = { ok: true, url: exportMonth(e.parameter.ym) };
  else if (action === 'exporttemp')  payload = { ok: true, url: exportTempMonth(e.parameter.ym) };
  else if (action === 'install') { installTriggers(); payload = { ok: true, installed: true }; }
  else if (action === 'status')  payload = { ok: true, status: statusInfo() };
  else payload = { ok: true };
  const json = JSON.stringify(payload);
  if (cb) return ContentService.createTextOutput(cb + '(' + json + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function statusInfo() {
  const bf = getOrCreateFolder(BACKUP_FOLDER), af = getOrCreateFolder(ARCHIVE_FOLDER), tf = getOrCreateFolder(TEMP_EXPORT_FOLDER);
  const count = f => { let n = 0; const it = f.getFiles(); while (it.hasNext()) { it.next(); n++; } return n; };
  return {
    email: BACKUP_EMAIL || '(non renseigné)',
    sauvegardes: count(bf),
    archivesMensuelles: count(af),
    relevesTemperature: count(tf),
    dossierSauvegardes: bf.getUrl(),
    dossierArchives: af.getUrl(),
    dossierTemperature: tf.getUrl()
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function getOrCreateFolder(name) {
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}
function findByName(folder, name) {
  const it = folder.getFilesByName(name);
  return it.hasNext() ? SpreadsheetApp.openById(it.next().getId()) : null;
}
function moveToFolder(file, folder) {
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file); // retire de « Mon Drive » racine
}
function shareFolders() {
  if (!BACKUP_EMAIL) return;
  [BACKUP_FOLDER, ARCHIVE_FOLDER, TEMP_EXPORT_FOLDER].forEach(n => {
    try { getOrCreateFolder(n).addViewer(BACKUP_EMAIL); } catch (err) { /* déjà partagé */ }
  });
}
function ym(date)      { return Utilities.formatDate(date, TZ, 'yyyy-MM'); }
function cellYm(v) {
  if (v === '' || v == null) return '';
  const d = (v instanceof Date) ? v : new Date(v);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, TZ, 'yyyy-MM');
}
function addMonths(date, n) {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + n);
  return d;
}
