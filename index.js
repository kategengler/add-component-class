const fs = require('node:fs');
const path = require('node:path');

function toClassName(filePath) {
  const baseName = path.basename(filePath, path.extname(filePath));
  return baseName
    .split(/[^a-zA-Z0-9]/)
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join('');
}

function transformSource(source, filePath) {
  if (/\bexport\s+default\b/.test(source)) {
    throw new Error('File already has a default export');
  }

  const templateRegex = /<template\b[^>]*>[\s\S]*?<\/template>/m;
  const templateMatch = source.match(templateRegex);

  if (!templateMatch) {
    throw new Error('No <template> tag found');
  }

  const componentImportRegex = /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]@glimmer\/component['"];?/;
  const componentImportMatch = source.match(componentImportRegex);
  const componentIdentifier = componentImportMatch ? componentImportMatch[1] : 'Component';

  let nextSource = source;
  if (!componentImportMatch) {
    nextSource = `import Component from '@glimmer/component';\n${nextSource}`;
  }

  const className = toClassName(filePath) || 'ComponentClass';
  const classBlock = `export default class ${className} extends ${componentIdentifier} {\n${templateMatch[0]}\n}`;

  return nextSource.replace(templateRegex, classBlock);
}

function transformFile(filePath) {
  if (!/\.g[jt]s$/.test(filePath)) {
    throw new Error('Path must point to a .gjs or .gts file');
  }

  const source = fs.readFileSync(filePath, 'utf8');
  const transformed = transformSource(source, filePath);
  fs.writeFileSync(filePath, transformed, 'utf8');
}

module.exports = {
  transformFile,
  transformSource,
};
