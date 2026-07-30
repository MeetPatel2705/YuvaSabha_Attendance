const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const db = require('../db');
const { setLastSync } = require('./settings');

const TEMPLATE_PATH = path.join(__dirname, '..', 'data', 'Yuva Sabha Harinagar.xlsx');
const LIVE_PATH = process.env.EXCEL_FILE_PATH || path.join(__dirname, '..', 'data', 'attendance-live.xlsx');

const SHEET_NAME = 'Yuva Sabha Attendance';
const DATE_ROW = 2;
const FIRST_MEMBER_ROW = 3;
const LAST_MEMBER_ROW = 227;
const PRESENT_MARK = '✔';

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatSheetDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const dd = String(day).padStart(2, '0');
  return `${dd}-${MONTH_ABBR[month - 1]}-${year}`;
}

function ensureLiveWorkbook() {
  fs.mkdirSync(path.dirname(LIVE_PATH), { recursive: true });
  if (!fs.existsSync(LIVE_PATH)) {
    fs.copyFileSync(TEMPLATE_PATH, LIVE_PATH);
  }
  return LIVE_PATH;
}

async function syncDateToExcel(isoDate) {
  const livePath = ensureLiveWorkbook();
  const targetDateLabel = formatSheetDate(isoDate);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(livePath);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet "${SHEET_NAME}" not found in ${livePath}`);
  }

  const dateRow = sheet.getRow(DATE_ROW);
  let targetCol = null;
  dateRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    if (String(cell.value).trim() === targetDateLabel) {
      targetCol = colNumber;
    }
  });

  if (!targetCol) {
    throw new Error(
      `No column found for date ${targetDateLabel} in "${SHEET_NAME}" row ${DATE_ROW}. ` +
        'The template only has pre-built columns through the end of its year.'
    );
  }

  const presentMemberIds = new Set(
    db
      .prepare("SELECT member_id FROM attendance WHERE date = ?")
      .all(isoDate)
      .map((r) => r.member_id)
  );

  const members = db
    .prepare('SELECT id, sheet_row FROM members WHERE sheet_row BETWEEN ? AND ?')
    .all(FIRST_MEMBER_ROW, LAST_MEMBER_ROW);

  for (const member of members) {
    const cell = sheet.getRow(member.sheet_row).getCell(targetCol);
    cell.value = presentMemberIds.has(member.id) ? PRESENT_MARK : null;
  }

  workbook.calcProperties.fullCalcOnLoad = true;
  await workbook.xlsx.writeFile(livePath);

  const presentCount = presentMemberIds.size;
  setLastSync({ at: new Date().toISOString(), date: isoDate, presentCount });

  return { path: livePath, date: isoDate, presentCount };
}

async function writeMemberRowToExcel({ sheetRow, sheetNo, name, mobile }) {
  const livePath = ensureLiveWorkbook();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(livePath);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet "${SHEET_NAME}" not found in ${livePath}`);
  }

  const row = sheet.getRow(sheetRow);
  row.getCell('A').value = sheetNo;
  row.getCell('B').value = mobile || null;
  row.getCell('C').value = name;

  await workbook.xlsx.writeFile(livePath);
}

// Wipes a member's entire row — identity columns and every historical
// present mark — so the row is genuinely free for reuse, not just missing
// from the members table. Without this, a deleted member's old checkmarks
// would linger untouched in already-synced date columns forever, since
// syncDateToExcel only ever touches rows that still exist in the members
// table.
async function clearMemberRowInExcel(sheetRow) {
  const livePath = ensureLiveWorkbook();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(livePath);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet "${SHEET_NAME}" not found in ${livePath}`);
  }

  const row = sheet.getRow(sheetRow);
  for (let c = 1; c <= sheet.columnCount; c++) {
    row.getCell(c).value = null;
  }

  await workbook.xlsx.writeFile(livePath);
}

// Fire-and-forget sync triggered by real traffic (a check-in landing, an
// admin edit) rather than only by the scheduled auto-sync — see
// jobs/autoSync.js. On a host that sleeps when idle, the process might not
// be alive at a fixed clock time; syncing inline on every check-in instead
// rides on the same request traffic that's already keeping the process
// awake, so the workbook stays current without depending on the process
// surviving until a fixed time.
//
// Chained onto a single shared promise so overlapping calls (two check-ins a
// moment apart) run one at a time instead of two concurrent readFile/
// writeFile cycles racing on the same file, where whichever finishes last
// would silently overwrite the other's update. Each call still queries the
// DB fresh when its turn comes, so a call queued behind an earlier one picks
// up every check-in committed by then — nothing is lost, just applied in
// order. Errors are logged and swallowed here (never surfaced to the
// check-in response) so a transient Excel-write failure can't fail someone's
// attendance, and doesn't leave the queue stuck rejected for the next call.
let syncQueue = Promise.resolve();
function queueSyncDateToExcel(isoDate) {
  syncQueue = syncQueue.then(() => syncDateToExcel(isoDate)).catch((err) => {
    console.error(`[excelSync] Background sync failed for ${isoDate}:`, err);
  });
  return syncQueue;
}

module.exports = {
  syncDateToExcel,
  queueSyncDateToExcel,
  writeMemberRowToExcel,
  clearMemberRowInExcel,
  ensureLiveWorkbook,
  formatSheetDate,
  LIVE_PATH,
};
