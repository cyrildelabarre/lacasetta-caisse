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
//  PILOTAGE / VÉRIFICATION À DISTANCE (facultatif : nécessite un déploiement Web)
// ══════════════════════════════════════════════════════════════════════════════
function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : '';
  const cb     = e && e.parameter ? e.parameter.callback : '';
  let payload;
  if (action === 'backup')       payload = { ok: true, url: backupNow() };
  else if (action === 'archive') payload = { ok: true, files: dailyArchive() };
  else if (action === 'exportmonth') payload = { ok: true, url: exportMonth(e.parameter.ym) };
  else if (action === 'install') { installTriggers(); payload = { ok: true, installed: true }; }
  else if (action === 'status')  payload = { ok: true, status: statusInfo() };
  else payload = { ok: true };
  const json = JSON.stringify(payload);
  if (cb) return ContentService.createTextOutput(cb + '(' + json + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function statusInfo() {
  const bf = getOrCreateFolder(BACKUP_FOLDER), af = getOrCreateFolder(ARCHIVE_FOLDER);
  const count = f => { let n = 0; const it = f.getFiles(); while (it.hasNext()) { it.next(); n++; } return n; };
  return {
    email: BACKUP_EMAIL || '(non renseigné)',
    sauvegardes: count(bf),
    archivesMensuelles: count(af),
    dossierSauvegardes: bf.getUrl(),
    dossierArchives: af.getUrl()
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
  [BACKUP_FOLDER, ARCHIVE_FOLDER].forEach(n => {
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
