import fs from 'node:fs';
import path from 'node:path';
import { toTree } from 'ember-estree';

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

// Recursively unwrap TypeScript expression wrappers to find a GlimmerTemplate node.
function unwrapGlimmerTemplate(node) {
  if (!node) return null;
  if (node.type === 'GlimmerTemplate') return node;
  if (
    node.type === 'TSAsExpression' ||
    node.type === 'TSSatisfiesExpression' ||
    node.type === 'TSNonNullExpression' ||
    node.type === 'TSTypeAssertion' ||
    node.type === 'ParenthesizedExpression'
  ) {
    return unwrapGlimmerTemplate(node.expression);
  }
  return null;
}

// Find GlimmerTemplate entries in the top-level body.
// Returns an array of { templateNode, declarationNode, name } objects.
function findTemplatesInBody(body) {
  const results = [];
  for (const node of body) {
    if (node.type === 'GlimmerTemplate') {
      results.push({ templateNode: node, declarationNode: null, name: null });
    } else if (node.type === 'VariableDeclaration' && node.kind === 'const') {
      for (const decl of node.declarations) {
        if (decl.id.type !== 'Identifier') continue;
        const tmpl = unwrapGlimmerTemplate(decl.init);
        if (tmpl) {
          results.push({ templateNode: tmpl, declarationNode: node, name: decl.id.name });
        }
      }
    }
  }
  return results;
}

function hasDefaultExport(body, templateDeclarationName) {
  for (const node of body) {
    if (node.type === 'ExportDefaultDeclaration') {
      if (
        templateDeclarationName &&
        node.declaration.type === 'Identifier' &&
        node.declaration.name === templateDeclarationName
      ) {
        continue;
      }
      return true;
    }
    if (node.type === 'ExportNamedDeclaration' && node.specifiers) {
      for (const spec of node.specifiers) {
        if (spec.exported.name === 'default') {
          return true;
        }
      }
    }
  }
  return false;
}

function findComponentImport(body) {
  for (const node of body) {
    if (node.type !== 'ImportDeclaration') continue;
    if (node.source.value !== '@glimmer/component') continue;
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportDefaultSpecifier') {
        return { present: true, identifier: spec.local.name };
      }
    }
    return { present: true, identifier: 'Component' };
  }
  return { present: false, identifier: 'Component' };
}

// Check if an identifier with the given name appears anywhere in body,
// excluding the provided nodes.
function isIdentifierUsedInBody(body, excludeNodes, localName) {
  const excluded = new Set(excludeNodes);

  function walkNode(node) {
    if (!node || typeof node !== 'object') return false;
    if (excluded.has(node)) return false;
    if (node.type === 'Identifier' && node.name === localName) return true;
    for (const value of Object.values(node)) {
      if (typeof value !== 'object' || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && item.type && walkNode(item)) return true;
        }
      } else if (value.type && walkNode(value)) {
        return true;
      }
    }
    return false;
  }

  for (const node of body) {
    if (excluded.has(node)) continue;
    if (walkNode(node)) return true;
  }
  return false;
}

function formatImportSpecifier(specifier) {
  const importedName = specifier.imported.name;
  const localName = specifier.local.name;
  if (importedName === localName) return localName;
  return `${importedName} as ${localName}`;
}

function removeRangeWithTrailingNewline(source, start, end) {
  if (source.startsWith('\r\n', end)) {
    return `${source.slice(0, start)}${source.slice(end + 2)}`;
  }

  if (source[end] === '\n') {
    return `${source.slice(0, start)}${source.slice(end + 1)}`;
  }

  return `${source.slice(0, start)}${source.slice(end)}`;
}

function removeUnusedTypeImport(source, filePath, moduleName, importedType) {
  const ast = toTree(source, { filePath });
  const body = ast.program.body;

  for (const node of body) {
    if (node.type !== 'ImportDeclaration') continue;
    if (node.source.value !== moduleName) continue;

    const namedSpecifiers = node.specifiers.filter((s) => s.type === 'ImportSpecifier');
    if (namedSpecifiers.length === 0) continue;

    const remainingSpecifiers = [];
    let removedSpecifier = false;

    for (const spec of namedSpecifiers) {
      const importedName = spec.imported.name;
      const localName = spec.local.name;

      if (importedName === importedType && !isIdentifierUsedInBody(body, [node], localName)) {
        removedSpecifier = true;
        continue;
      }

      remainingSpecifiers.push(spec);
    }

    if (!removedSpecifier) return source;

    if (remainingSpecifiers.length === 0) {
      return removeRangeWithTrailingNewline(source, node.start, node.end);
    }

    const updatedImport = `import type { ${remainingSpecifiers.map(formatImportSpecifier).join(', ')} } from '${moduleName}';`;
    return `${source.slice(0, node.start)}${updatedImport}${source.slice(node.end)}`;
  }

  return source;
}

function transformSource(source, filePath) {
  let templateCount = 0;
  const ast = toTree(source, {
    filePath,
    visitors: {
      GlimmerTemplate: () => templateCount++,
    },
  });
  const body = ast.program.body;

  if (templateCount === 0) {
    throw new Error('No <template> tag found');
  }
  if (templateCount > 1) {
    throw new Error('Expected exactly one <template> tag');
  }

  const templates = findTemplatesInBody(body);

  const { templateNode, declarationNode, name: declarationName } = templates[0];

  if (hasDefaultExport(body, declarationName)) {
    throw new Error('File already has a default export');
  }

  const componentImport = findComponentImport(body);
  const className = toClassName(filePath) || 'ComponentClass';
  const templateText = source.slice(templateNode.start, templateNode.end);
  const indentedTemplate = indentBlock(templateText, 2);
  const classBlock = declarationName
    ? `class ${declarationName} extends ${componentImport.identifier} {\n${indentedTemplate}\n}`
    : `export default class ${className} extends ${componentImport.identifier} {\n${indentedTemplate}\n}`;

  let transformedSource;
  if (declarationNode) {
    transformedSource = `${source.slice(0, declarationNode.start)}${classBlock}${source.slice(declarationNode.end)}`;
  } else {
    transformedSource = `${source.slice(0, templateNode.start)}${classBlock}${source.slice(templateNode.end)}`;
  }

  if (!componentImport.present) {
    transformedSource = `import Component from '@glimmer/component';\n${transformedSource}`;
  }

  if (declarationNode) {
    transformedSource = removeUnusedTypeImport(
      transformedSource,
      filePath,
      '@ember/component/template-only',
      'TOC'
    );
    transformedSource = removeUnusedTypeImport(
      transformedSource,
      filePath,
      '@glint/template',
      'ComponentLike'
    );
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

export { transformFile, transformSource };
