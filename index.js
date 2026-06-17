const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { Preprocessor } = require('content-tag');

const templatePreprocessor = new Preprocessor();
const templatePlaceholder = '__GLIMMER_TEMPLATE__';

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

function getScriptKind(filePath) {
  return filePath.endsWith('.gts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function getModuleSpecifier(node) {
  return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
}

function createSourceFile(source, filePath) {
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, getScriptKind(filePath));
}

function replaceTemplateWithPlaceholder(source, templateInfo) {
  return `${source.slice(0, templateInfo.range.startUtf16Codepoint)}${templatePlaceholder}${source.slice(templateInfo.range.endUtf16Codepoint)}`;
}

function unwrapTemplateExpression(expression) {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    return unwrapTemplateExpression(expression.expression);
  }

  return expression;
}

function isTemplatePlaceholderExpression(expression) {
  const unwrapped = unwrapTemplateExpression(expression);
  return ts.isIdentifier(unwrapped) && unwrapped.text === templatePlaceholder;
}

function findTemplateDeclaration(sourceFile) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer || !isTemplatePlaceholderExpression(declaration.initializer)) {
        continue;
      }

      if (!ts.isIdentifier(declaration.name)) {
        continue;
      }

      return {
        name: declaration.name.text,
        start: statement.getStart(sourceFile),
        end: statement.end,
      };
    }
  }

  return null;
}

function hasAllowedDefaultExport(statement, templateDeclarationName) {
  return (
    ts.isExportAssignment(statement) &&
    !statement.isExportEquals &&
    templateDeclarationName &&
    ts.isIdentifier(statement.expression) &&
    statement.expression.text === templateDeclarationName
  );
}

function hasDefaultExport(sourceFile, templateDeclarationName) {
  for (const statement of sourceFile.statements) {
    if (hasAllowedDefaultExport(statement, templateDeclarationName)) {
      continue;
    }

    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      return true;
    }

    if (hasModifier(statement, ts.SyntaxKind.ExportKeyword) && hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      return true;
    }

    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      if (statement.exportClause.elements.some((specifier) => specifier.name.text === 'default')) {
        return true;
      }
    }
  }

  return false;
}

function findComponentImport(sourceFile) {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || getModuleSpecifier(statement) !== '@glimmer/component') {
      continue;
    }

    const identifier = statement.importClause?.name?.text;
    return {
      present: true,
      identifier: identifier || 'Component',
    };
  }

  return {
    present: false,
    identifier: 'Component',
  };
}

function isIgnoredImportIdentifier(node, importDeclaration) {
  let current = node;
  while (current && current !== importDeclaration) {
    if (
      ts.isImportClause(current) ||
      ts.isImportSpecifier(current) ||
      ts.isNamedImports(current) ||
      ts.isNamespaceImport(current)
    ) {
      return true;
    }
    current = current.parent;
  }

  return false;
}

function isIdentifierUsed(sourceFile, importDeclaration, localName) {
  let used = false;

  function visit(node) {
    if (used) {
      return;
    }

    if (ts.isIdentifier(node) && node.text === localName && !isIgnoredImportIdentifier(node, importDeclaration)) {
      used = true;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return used;
}

function formatImportSpecifier(specifier) {
  const importedName = specifier.propertyName?.text || specifier.name.text;
  const localName = specifier.name.text;

  if (importedName === localName) {
    return localName;
  }

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

function removeUnusedTemplateOnlyTypeImport(source, filePath, moduleName, importedType, templateBlock) {
  let sourceForAst = source;
  const templateStart = templateBlock ? source.indexOf(templateBlock) : -1;

  if (templateStart !== -1) {
    sourceForAst = `${source.slice(0, templateStart)}${templatePlaceholder}${source.slice(templateStart + templateBlock.length)}`;
  }

  const sourceFile = createSourceFile(sourceForAst, filePath);

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || getModuleSpecifier(statement) !== moduleName) {
      continue;
    }

    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      continue;
    }

    const remainingSpecifiers = [];
    let removedSpecifier = false;

    for (const specifier of namedBindings.elements) {
      const importedName = specifier.propertyName?.text || specifier.name.text;
      const localName = specifier.name.text;

      if (importedName === importedType && !isIdentifierUsed(sourceFile, statement, localName)) {
        removedSpecifier = true;
        continue;
      }

      remainingSpecifiers.push(specifier);
    }

    if (!removedSpecifier) {
      return source;
    }

    if (remainingSpecifiers.length === 0) {
      return removeRangeWithTrailingNewline(source, statement.getStart(sourceFile), statement.end);
    }

    const updatedImport = `import type { ${remainingSpecifiers.map(formatImportSpecifier).join(', ')} } from '${moduleName}';`;
    return `${source.slice(0, statement.getStart(sourceFile))}${updatedImport}${source.slice(statement.end)}`;
  }

  return source;
}

function transformSource(source, filePath) {
  const templateMatches = templatePreprocessor.parse(source, { filename: filePath });

  if (templateMatches.length === 0) {
    throw new Error('No <template> tag found');
  }
  if (templateMatches.length > 1) {
    throw new Error('Expected exactly one <template> tag');
  }

  const templateMatchInfo = templateMatches[0];
  const templateMatch = source.slice(
    templateMatchInfo.range.startUtf16Codepoint,
    templateMatchInfo.range.endUtf16Codepoint
  );
  const placeholderSource = replaceTemplateWithPlaceholder(source, templateMatchInfo);
  const sourceFile = createSourceFile(placeholderSource, filePath);
  const templateDeclaration = findTemplateDeclaration(sourceFile);
  const normalizedTemplateDeclaration = templateDeclaration
    ? {
        ...templateDeclaration,
        end:
          templateDeclaration.end +
          (templateMatch.length - templatePlaceholder.length),
      }
    : null;
  const templateDeclarationName = normalizedTemplateDeclaration ? normalizedTemplateDeclaration.name : null;

  if (hasDefaultExport(sourceFile, templateDeclarationName)) {
    throw new Error('File already has a default export');
  }

  const componentImport = findComponentImport(sourceFile);
  const className = toClassName(filePath) || 'ComponentClass';
  const indentedTemplate = indentBlock(templateMatch, 2);
  const classBlock = templateDeclarationName
    ? `class ${templateDeclarationName} extends ${componentImport.identifier} {\n${indentedTemplate}\n}`
    : `export default class ${className} extends ${componentImport.identifier} {\n${indentedTemplate}\n}`;

  let transformedSource;
  if (normalizedTemplateDeclaration) {
    transformedSource = `${source.slice(0, normalizedTemplateDeclaration.start)}${classBlock}${source.slice(normalizedTemplateDeclaration.end)}`;
  } else {
    transformedSource = `${source.slice(0, templateMatchInfo.range.startUtf16Codepoint)}${classBlock}${source.slice(templateMatchInfo.range.endUtf16Codepoint)}`;
  }

  if (!componentImport.present) {
    transformedSource = `import Component from '@glimmer/component';\n${transformedSource}`;
  }

  if (templateDeclaration) {
    transformedSource = removeUnusedTemplateOnlyTypeImport(
      transformedSource,
      filePath,
      '@ember/component/template-only',
      'TOC',
      templateMatch
    );
    transformedSource = removeUnusedTemplateOnlyTypeImport(
      transformedSource,
      filePath,
      '@glint/template',
      'ComponentLike',
      templateMatch
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

module.exports = {
  transformFile,
  transformSource,
};
