'use strict';

process.env.QA_BASE_URL = 'http://localhost:8491/';
process.env.QA_RESULT_PATH = 'qa/furniture_catalog/iteration-02/result.json';
process.env.VIDEO_DIR = 'qa/furniture_catalog/iteration-02/video';
process.argv.splice(2, process.argv.length - 2,
  'tools/qa/furniture-catalog-acceptance.js', '--bootstrap');
require('./run-playwright.cjs');
