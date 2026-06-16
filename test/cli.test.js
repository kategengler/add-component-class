const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const cliPath = path.resolve(__dirname, '../bin/add-component-class.js');

function writeTempFile(t, name, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'add-component-class-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

test('wraps template in a component class and adds import', (t) => {
  const filePath = writeTempFile(
    t,
    'layer-list.gjs',
    `<template>
  <ul>
    <li>hi</li>
  </ul>
</template>
`
  );

  execFileSync(process.execPath, [cliPath, filePath], { stdio: 'pipe' });

  const output = fs.readFileSync(filePath, 'utf8');
  assert.match(output, /import Component from '@glimmer\/component';/);
  assert.match(output, /export default class LayerList extends Component {/);
  assert.match(output, /<template>[\s\S]*<\/template>/);
});

test('errors when a default export already exists', (t) => {
  const filePath = writeTempFile(
    t,
    'has-default.gjs',
    `export default class Existing {}
<template>
  hi
</template>
`
  );

  assert.throws(
    () => execFileSync(process.execPath, [cliPath, filePath], { stdio: 'pipe' }),
    /File already has a default export/
  );
});

test('errors when no template tag exists', (t) => {
  const filePath = writeTempFile(t, 'no-template.gts', `const value = 1;\n`);

  assert.throws(
    () => execFileSync(process.execPath, [cliPath, filePath], { stdio: 'pipe' }),
    /No <template> tag found/
  );
});
