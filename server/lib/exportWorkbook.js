const ExcelJS = require('exceljs');
const { query } = require('../db');
const { getRemark } = require('./remarks');

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatSheetDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${String(day).padStart(2, '0')}-${MONTH_ABBR[month - 1]}-${year}`;
}

const PRESENT_MARK = '✔'; // ✔

// Builds the whole workbook fresh from the database on every download —
// nothing is stored on disk, so it can never go stale or be lost to an
// ephemeral-disk host. Date columns run NEWEST FIRST so the current week sits
// right next to the name column instead of a year deep in horizontal scroll.
async function buildExportWorkbook() {
  const { rows: dateRows } = await query('SELECT DISTINCT date FROM attendance ORDER BY date DESC');
  const dates = dateRows.map((r) => r.date);

  const { rows: members } = await query(
    'SELECT id, sheet_no, name, mobile, gender FROM members ORDER BY gender DESC, sheet_row ASC'
  );

  const { rows: attRows } = await query('SELECT member_id, date FROM attendance');
  const presentSet = new Set(attRows.map((r) => `${r.member_id}|${r.date}`));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Yuva Sabha Attendance', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }],
  });

  const FIRST_DATE_COL = 4;
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };

  // Row 1: title spanning the fixed columns.
  sheet.getCell(1, 1).value = 'Yuva Sabha Harinagar — Attendance';
  sheet.getCell(1, 1).font = { bold: true, size: 14 };
  sheet.mergeCells(1, 1, 1, 3);

  // Row 2: column headers. Dates newest-first.
  const header = sheet.getRow(2);
  header.getCell(1).value = 'No.';
  header.getCell(2).value = 'Mobile number';
  header.getCell(3).value = 'Name';
  dates.forEach((d, i) => {
    const cell = header.getCell(FIRST_DATE_COL + i);
    cell.value = formatSheetDate(d);
    cell.alignment = { textRotation: 0, horizontal: 'center' };
  });
  header.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = headerFill;
  });

  // Remarks (rescheduled-week notes) as cell comments on the date headers.
  for (let i = 0; i < dates.length; i++) {
    const remark = await getRemark(dates[i]);
    if (remark) {
      header.getCell(FIRST_DATE_COL + i).note = remark;
    }
  }

  // Member rows: men first then women (gender DESC puts M before F), each
  // block in original sheet order.
  let rowIdx = 3;
  const genderRowRanges = { M: [null, null], F: [null, null] };
  for (const member of members) {
    const row = sheet.getRow(rowIdx);
    row.getCell(1).value = member.sheet_no;
    row.getCell(2).value = member.mobile || null;
    row.getCell(3).value = member.name;
    dates.forEach((d, i) => {
      if (presentSet.has(`${member.id}|${d}`)) {
        const cell = row.getCell(FIRST_DATE_COL + i);
        cell.value = PRESENT_MARK;
        cell.alignment = { horizontal: 'center' };
      }
    });
    const range = genderRowRanges[member.gender];
    if (range[0] === null) range[0] = rowIdx;
    range[1] = rowIdx;
    rowIdx += 1;
  }

  // Summary rows: computed counts (not formulas — the file is regenerated
  // fresh each download, so live formulas have nothing extra to offer).
  const summaryDefs = [
    ['Men Present', (d) => countPresent(members, presentSet, d, 'M')],
    ['Women Present', (d) => countPresent(members, presentSet, d, 'F')],
    ['Total Present', (d) => countPresent(members, presentSet, d, null)],
  ];
  rowIdx += 1;
  for (const [label, countFn] of summaryDefs) {
    const row = sheet.getRow(rowIdx);
    row.getCell(3).value = label;
    row.getCell(3).font = { bold: true };
    dates.forEach((d, i) => {
      const cell = row.getCell(FIRST_DATE_COL + i);
      cell.value = countFn(d);
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center' };
    });
    rowIdx += 1;
  }

  sheet.getColumn(1).width = 6;
  sheet.getColumn(2).width = 16;
  sheet.getColumn(3).width = 28;
  for (let i = 0; i < dates.length; i++) {
    sheet.getColumn(FIRST_DATE_COL + i).width = 13;
  }

  return workbook;
}

function countPresent(members, presentSet, date, gender) {
  let n = 0;
  for (const m of members) {
    if (gender && m.gender !== gender) continue;
    if (presentSet.has(`${m.id}|${date}`)) n += 1;
  }
  return n;
}

module.exports = { buildExportWorkbook };
