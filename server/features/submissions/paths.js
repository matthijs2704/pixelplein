'use strict';

const path = require('path');

const SUBMISSION_ASSETS_DIR = path.join(__dirname, '..', '..', '..', 'submission-assets');
const SUBMISSION_ORIGINAL_DIR = path.join(SUBMISSION_ASSETS_DIR, 'original');
const SUBMISSION_THUMB_DIR = path.join(SUBMISSION_ASSETS_DIR, 'thumb');

module.exports = {
  SUBMISSION_ASSETS_DIR,
  SUBMISSION_ORIGINAL_DIR,
  SUBMISSION_THUMB_DIR,
};
