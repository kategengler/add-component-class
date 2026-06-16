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

function indentBlock(text, spaces) {
  const prefix = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : line))
    .join('\n');
}

function transformSource(source, filePath) {
  const templateRegex = /<template\b[^>]*>[\s\S]*?<\/template>/gm;
  const templateMatches = [...source.matchAll(templateRegex)];

  if (templateMatches.length === 0) {
    throw new Error('No <template> tag found');
  }
  if (templateMatches.length > 1) {
    throw new Error('Expected exactly one <template> tag');
  }
  const templateMatch = templateMatches[0][0];

  const templateOnlyDeclarationRegex =
    /const\s+([A-Za-z_$][\w$]*)\s*(?::[\s\S]*?)?=\s*(<template\b[^>]*>[\s\S]*?<\/template>)\s*(?:satisfies\s+[\s\S]*?)?;?/gm;
  const templateDeclarationMatch = [...source.matchAll(templateOnlyDeclarationRegex)].find(
    (match) => match[2] === templateMatch
  );
  const templateDeclarationName = templateDeclarationMatch ? templateDeclarationMatch[1] : null;

  if (/\bexport\s+default\b/.test(source)) {
    const allowedDefaultExport = templateDeclarationName
      ? new RegExp(`\\bexport\\s+default\\s+${templateDeclarationName}\\b`).test(source)
      : false;
    if (!allowedDefaultExport) {
      throw new Error('File already has a default export');
    }
  }

  const componentImportRegex = /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]@glimmer\/component['"];?/;
  const componentImportMatch = source.match(componentImportRegex);
  const componentIdentifier = componentImportMatch ? componentImportMatch[1] : 'Component';

  let nextSource = source;
  if (!componentImportMatch) {
    nextSource = `import Component from '@glimmer/component';\n${nextSource}`;
  }

  const className = toClassName(filePath) || 'ComponentClass';
  const indentedTemplate = indentBlock(templateMatch, 2);
  const classBlock = templateDeclarationName
    ? `class ${templateDeclarationName} extends ${componentIdentifier} {\n${indentedTemplate}\n}`
    : `export default class ${className} extends ${componentIdentifier} {\n${indentedTemplate}\n}`;

  return templateDeclarationMatch
    ? nextSource.replace(templateDeclarationMatch[0], classBlock)
    : nextSource.replace(templateMatch, classBlock);
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
