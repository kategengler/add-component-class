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
  const input = `<template>
  <ul>
    <li>hi</li>
  </ul>
</template>
`;
  const filePath = writeTempFile(t, 'layer-list.gjs', input);

  execFileSync(process.execPath, [cliPath, filePath], { stdio: 'pipe' });

  const output = fs.readFileSync(filePath, 'utf8');
  const expected = `import Component from '@glimmer/component';
export default class LayerList extends Component {
  <template>
    <ul>
      <li>hi</li>
    </ul>
  </template>
}
`;
  assert.strictEqual(output, expected);
});

test('transforms complex file and preserves surrounding code exactly', (t) => {
  const input = `import { tracked } from '@glimmer/tracking';
import GlimmerComponent from '@glimmer/component';

const greeting = 'hi';
function helper(name) {
  return name.toUpperCase();
}

<template>
  <section data-state={{if this.isOpen "open" "closed"}}>
    {{helper greeting}}
  </section>
</template>

const trailingValue = 42;
`;
  const filePath = writeTempFile(t, 'fancy-card.gts', input);

  execFileSync(process.execPath, [cliPath, filePath], { stdio: 'pipe' });

  const output = fs.readFileSync(filePath, 'utf8');
  const expected = `import { tracked } from '@glimmer/tracking';
import GlimmerComponent from '@glimmer/component';

const greeting = 'hi';
function helper(name) {
  return name.toUpperCase();
}

export default class FancyCard extends GlimmerComponent {
  <template>
    <section data-state={{if this.isOpen "open" "closed"}}>
      {{helper greeting}}
    </section>
  </template>
}

const trailingValue = 42;
`;
  assert.strictEqual(output, expected);
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

test('errors when multiple template tags exist', (t) => {
  const filePath = writeTempFile(
    t,
    'multi-template.gjs',
    `<template>one</template>\n<template>two</template>\n`
  );

  assert.throws(
    () => execFileSync(process.execPath, [cliPath, filePath], { stdio: 'pipe' }),
    /Expected exactly one <template> tag/
  );
});

test('transforms gts template-only component typed as TOC with default export', (t) => {
  const input = `import type { TOC } from '@ember/component/template-only';

const X: TOC<{ Args: { value: string } }> = <template>
  <div>{{@value}}</div>
</template>;

export default X;
`;
  const filePath = writeTempFile(t, 'typed-default.gts', input);

  execFileSync(process.execPath, [cliPath, filePath], { stdio: 'pipe' });

  const output = fs.readFileSync(filePath, 'utf8');
  const expected = `import Component from '@glimmer/component';

class X extends Component {
  <template>
    <div>{{@value}}</div>
  </template>
}

export default X;
`;
  assert.strictEqual(output, expected);
});

test('transforms gts template-only component with satisfies and named export', (t) => {
  const input = `import type { ComponentLike } from '@glint/template';

const X = <template>
  <div>{{@value}}</div>
</template> satisfies ComponentLike<{ Args: { value: string } }>;

export { X };
`;
  const filePath = writeTempFile(t, 'satisfies-named.gts', input);

  execFileSync(process.execPath, [cliPath, filePath], { stdio: 'pipe' });

  const output = fs.readFileSync(filePath, 'utf8');
  const expected = `import Component from '@glimmer/component';

class X extends Component {
  <template>
    <div>{{@value}}</div>
  </template>
}

export { X };
`;
  assert.strictEqual(output, expected);
});

test('transforms gts template-only component typed as ComponentLike with default export', (t) => {
  const input = `import type { ComponentLike } from '@glint/template';

const X: ComponentLike<{ Args: { value: string } }> = <template>
  <div>{{@value}}</div>
</template>;

export default X;
`;
  const filePath = writeTempFile(t, 'typed-component-like-default.gts', input);

  execFileSync(process.execPath, [cliPath, filePath], { stdio: 'pipe' });

  const output = fs.readFileSync(filePath, 'utf8');
  const expected = `import Component from '@glimmer/component';

class X extends Component {
  <template>
    <div>{{@value}}</div>
  </template>
}

export default X;
`;
  assert.strictEqual(output, expected);
});

test('transforms gts template-only component with satisfies TOC and named export', (t) => {
  const input = `import type { TOC } from '@ember/component/template-only';

const X = <template>
  <div>{{@value}}</div>
</template> satisfies TOC<{ Args: { value: string } }>;

export { X };
`;
  const filePath = writeTempFile(t, 'satisfies-toc-named.gts', input);

  execFileSync(process.execPath, [cliPath, filePath], { stdio: 'pipe' });

  const output = fs.readFileSync(filePath, 'utf8');
  const expected = `import Component from '@glimmer/component';

class X extends Component {
  <template>
    <div>{{@value}}</div>
  </template>
}

export { X };
`;
  assert.strictEqual(output, expected);
});
