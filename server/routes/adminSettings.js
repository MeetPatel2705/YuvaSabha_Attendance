const express = require('express');
const { requireAdmin } = require('../lib/adminAuth');
const {
  getCheckinWeekday,
  setCheckinWeekday,
  getOverrideAttendanceDate,
  setOverrideAttendanceDate,
  VALID_WEEKDAYS,
} = require('../lib/settings');
const { getRemark, setRemark } = require('../lib/remarks');

const router = express.Router();
router.use(requireAdmin);

router.get('/settings', (_req, res) => {
  res.json({
    checkinWeekday: getCheckinWeekday(),
    validWeekdays: VALID_WEEKDAYS,
  });
});

router.post('/settings', (req, res) => {
  const { checkinWeekday } = req.body || {};
  try {
    setCheckinWeekday(checkinWeekday);
    res.json({ ok: true, checkinWeekday });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/reschedule', (_req, res) => {
  const overrideDate = getOverrideAttendanceDate();
  res.json({ overrideDate, remark: overrideDate ? getRemark(overrideDate) : null });
});

router.post('/reschedule', (req, res) => {
  const { overrideDate, remark } = req.body || {};
  if (!overrideDate) {
    return res.status(400).json({ error: 'overrideDate is required.' });
  }
  try {
    setOverrideAttendanceDate(overrideDate);
    setRemark(overrideDate, remark || '');
    res.json({ ok: true, overrideDate, remark: getRemark(overrideDate) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/reschedule/clear', (_req, res) => {
  setOverrideAttendanceDate(null);
  res.json({ ok: true });
});

module.exports = router;
