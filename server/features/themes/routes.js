'use strict';

const express = require('express');
const path    = require('path');
const { listThemes, THEMES_DIR } = require('./store');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/themes  — list all available themes
// ---------------------------------------------------------------------------
router.get('/', (_req, res) => {
  res.json(listThemes());
});

module.exports = router;
module.exports.THEMES_DIR = THEMES_DIR;
