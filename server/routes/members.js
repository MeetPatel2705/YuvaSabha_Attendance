const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (_req, res) => {
  const members = db
    .prepare('SELECT id, name FROM members ORDER BY name COLLATE NOCASE')
    .all();
  res.json(members);
});

module.exports = router;
