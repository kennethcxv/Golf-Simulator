'use strict';

process.env.QA_BASE_URL = 'http://localhost:8491/';
process.env.QA_RESULT_PATH = 'qa/furniture_catalog/iteration-03/result.json';
process.env.VIDEO_DIR = 'qa/furniture_catalog/iteration-03/video';
process.argv.splice(2, process.argv.length - 2,
  'tools/qa/furniture-catalog-progression-visual.js', '--bootstrap');
require('./run-playwright.cjs');
