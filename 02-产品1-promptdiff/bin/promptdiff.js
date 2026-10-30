#!/usr/bin/env node
'use strict';

/**
 * promptdiff CLI entry point.
 * Thin shebang wrapper — all logic lives in lib/cli.js so it stays testable.
 */

const { main } = require('../lib/cli');

process.exit(main(process.argv.slice(2)));
