const express = require('express');
const { query } = require('../db');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const { rows } = await query('SELECT id, name FROM members ORDER BY LOWER(name)');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
