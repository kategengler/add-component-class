#!/usr/bin/env node

import { transformFile } from '../index.js';

function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: add-component-class <path-to-file.gjs|.gts>');
    process.exit(1);
  }

  try {
    transformFile(filePath);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();
