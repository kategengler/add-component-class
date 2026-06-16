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

function findTemplateOnlyDeclaration(source, templateMatchInfo) {
  const templateMatch = templateMatchInfo[0];
  const templateStart = templateMatchInfo.index;
  const templateEnd = templateStart + templateMatch.length;

  const constOnNewLineStart = source.lastIndexOf('\nconst ', templateStart);
  let constStart = constOnNewLineStart === -1 ? -1 : constOnNewLineStart + 1;
  if (constStart === -1 && source.startsWith('const ')) {
    constStart = 0;
  }
  if (constStart === -1) {
    return null;
  }

  const beforeTemplate = source.slice(constStart, templateStart);
  if (!beforeTemplate.includes('=')) {
    return null;
  }

  const equalsIndex = beforeTemplate.lastIndexOf('=');
  if (!/^\s*$/.test(beforeTemplate.slice(equalsIndex + 1))) {
    return null;
  }

  const headerBeforeTemplate = beforeTemplate.slice(0, equalsIndex + 1);
  const nameMatch = /^const\s+([A-Za-z_$][\w$]*)\b/.exec(headerBeforeTemplate);
  if (!nameMatch) {
    return null;
  }

  let declarationEnd = templateEnd;
  while (/\s/.test(source[declarationEnd] || '')) {
    declarationEnd += 1;
  }

  if (source.startsWith('satisfies', declarationEnd)) {
    declarationEnd += 'satisfies'.length;

    while (declarationEnd < source.length) {
      if (source[declarationEnd] === ';') {
        declarationEnd += 1;
        break;
      }

      if (source[declarationEnd] === '\n') {
        let lookahead = declarationEnd + 1;
        while (source[lookahead] === ' ' || source[lookahead] === '\t') {
          lookahead += 1;
        }
        if (/^(export|const|let|var|class|function|type|interface|enum)\b/.test(source.slice(lookahead))) {
          break;
        }
      }

      declarationEnd += 1;
    }
  } else if (source[declarationEnd] === ';') {
    declarationEnd += 1;
  }

  return {
    name: nameMatch[1],
    start: constStart,
    end: declarationEnd,
    text: source.slice(constStart, declarationEnd),
  };
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
  const templateMatchInfo = templateMatches[0];
  const templateMatch = templateMatchInfo[0];
  const templateDeclaration = findTemplateOnlyDeclaration(source, templateMatchInfo);
  const templateDeclarationName = templateDeclaration ? templateDeclaration.name : null;

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

  const className = toClassName(filePath) || 'ComponentClass';
  const indentedTemplate = indentBlock(templateMatch, 2);
  const classBlock = templateDeclarationName
    ? `class ${templateDeclarationName} extends ${componentIdentifier} {\n${indentedTemplate}\n}`
    : `export default class ${className} extends ${componentIdentifier} {\n${indentedTemplate}\n}`;

  let transformedSource;
  if (templateDeclaration) {
    transformedSource = `${source.slice(0, templateDeclaration.start)}${classBlock}${source.slice(templateDeclaration.end)}`;
  } else {
    transformedSource = source.replace(templateMatch, classBlock);
  }

  if (!componentImportMatch) {
    transformedSource = `import Component from '@glimmer/component';\n${transformedSource}`;
  }

  return transformedSource;
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
