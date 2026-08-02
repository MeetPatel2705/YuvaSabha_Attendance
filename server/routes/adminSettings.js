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

router.get('/settings', async (_req, res) => {
  try {
    res.json({
      checkinWeekday: await getCheckinWeekday(),
      validWeekdays: VALID_WEEKDAYS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings', async (req, res) => {
  const { checkinWeekday } = req.body || {};
  try {
    await setCheckinWeekday(checkinWeekday);
    res.json({ ok: true, checkinWeekday });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/reschedule', async (_req, res) => {
  try {
    const overrideDate = await getOverrideAttendanceDate();
    res.json({ overrideDate, remark: overrideDate ? await getRemark(overrideDate) : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reschedule', async (req, res) => {
  const { overrideDate, remark } = req.body || {};
  if (!overrideDate) {
    return res.status(400).json({ error: 'overrideDate is required.' });
  }
  try {
    await setOverrideAttendanceDate(overrideDate);
    await setRemark(overrideDate, remark || '');
    res.json({ ok: true, overrideDate, remark: await getRemark(overrideDate) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/reschedule/clear', async (_req, res) => {
  try {
    await setOverrideAttendanceDate(null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
