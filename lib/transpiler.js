'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const B4XPP_GENERATOR_VERSION = '0.4.0';
const B4XPP_LIBRARY_INDEX_CACHE = new Map();

function clearB4XLibraryIndexCache() {
  B4XPP_LIBRARY_INDEX_CACHE.clear();
}


const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const B4X_RESERVED_WORDS = new Set([
  'as','case','class','closure','dim','do','each','else','end','false','for','if','loop','next','not','null','private','public','return','select','step','sub','then','to','true','until','while'
]);
const PROJECT_PLATFORM_ALIASES = new Map([
  ['b4j', 'b4j-nonui'],
  ['b4j-nonui', 'b4j-nonui'],
  ['b4jnonui', 'b4j-nonui'],
  ['b4j-console', 'b4j-nonui'],
  ['b4jconsole', 'b4j-nonui'],
  ['b4j-ui', 'b4j-ui'],
  ['b4jui', 'b4j-ui'],
  ['b4a', 'b4a'],
  ['android', 'b4a'],
  ['b4i', 'b4i'],
  ['ios', 'b4i']
]);

function normalizeNewlines(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function splitLines(text) {
  return normalizeNewlines(text).split('\n');
}

function hasMeaningfulCode(lines) {
  return lines.some((line) => {
    const t = line.trim();
    return t.length > 0 && !t.startsWith("'");
  });
}

function sanitizeModuleName(name) {
  const cleaned = String(name || '').trim();
  return IDENTIFIER_RE.test(cleaned) ? cleaned : null;
}

function sanitizeProjectPlatform(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return PROJECT_PLATFORM_ALIASES.get(key) || null;
}

function splitCsvDirective(value) {
  return String(value || '')
    .split(',')
    .map(s => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const key = String(value).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

function parseClassDirective(rest) {
  const result = { name: null, extendsName: null, implementsNames: [], modifiers: [] };
  const parts = String(rest || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return result;
  result.name = parts[0];

  for (let i = 1; i < parts.length; i++) {
    const token = parts[i].replace(/,$/, '');
    if (/^extends$/i.test(token) && parts[i + 1]) {
      result.extendsName = parts[++i].replace(/,$/, '');
      continue;
    }
    if (/^implements$/i.test(token)) {
      while (parts[i + 1] && !/^(extends|abstract|final)$/i.test(parts[i + 1])) {
        const names = parts[++i].split(',').map(s => s.trim()).filter(Boolean);
        result.implementsNames.push(...names);
      }
      continue;
    }
    if (/^(abstract|final)$/i.test(token)) {
      result.modifiers.push(token.toLowerCase());
    }
  }
  return result;
}

function makeDiagnostic(sourcePath, line, severity, message) {
  return { sourcePath, line, severity, message };
}

function splitCodeAndComment(line) {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inString && line[i + 1] === '"') { i++; continue; }
      inString = !inString;
    }
    if (ch === "'" && !inString) return { code: line.slice(0, i), comment: line.slice(i) };
  }
  return { code: line, comment: '' };
}

function parseIncludeTarget(trimmed) {
  const m = trimmed.match(/^#Include\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))\s*$/i);
  if (!m) return null;
  return (m[1] || m[2] || m[3] || '').trim();
}

function parseProjectDirectives(sourcePath, lines, diagnostics) {
  const project = {
    dependsOn: [], b4aDependsOn: [], b4jDependsOn: [], b4iDependsOn: [],
    b4xLibDependsOn: [], b4xLibB4ADependsOn: [], b4xLibB4JDependsOn: [], b4xLibB4iDependsOn: [], b4xLibSupportedPlatforms: [],
    supportedPlatforms: [], b4xLibName: '', b4xLibVersion: '', b4xLibAuthor: ''
  };
  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    const lineNo = index + 1;

    const projectMatch = trimmed.match(/^#Project\s+(.+)$/i);
    if (projectMatch) {
      const parts = projectMatch[1].trim().split(/\s+/).filter(Boolean);
      const platform = sanitizeProjectPlatform(parts[0]);
      if (!platform) {
        diagnostics.push(makeDiagnostic(sourcePath, lineNo, 'error', `Unknown #Project platform: ${parts[0] || ''}. Use B4J-NonUI, B4J-UI, B4A or B4i.`));
        continue;
      }
      project.platform = platform;
      if (parts[1]) project.name = parts[1];
      project.sourcePath = sourcePath;
      project.line = lineNo;
      continue;
    }

    const packageMatch = trimmed.match(/^#Package\s+([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)\s*$/i);
    if (packageMatch) { project.packageName = packageMatch[1].toLowerCase(); continue; }

    const projectDirMatch = trimmed.match(/^#ProjectDir\s+(.+)$/i);
    if (projectDirMatch) { project.projectDir = projectDirMatch[1].trim().replace(/^['"]|['"]$/g, ''); continue; }

    const projectDependsMatch = trimmed.match(/^#ProjectDependsOn\s+(.+)$/i);
    if (projectDependsMatch) { project.dependsOn.push(...splitCsvDirective(projectDependsMatch[1])); continue; }
    const projectB4aDependsMatch = trimmed.match(/^#ProjectB4ADependsOn\s+(.+)$/i);
    if (projectB4aDependsMatch) { project.b4aDependsOn.push(...splitCsvDirective(projectB4aDependsMatch[1])); continue; }
    const projectB4jDependsMatch = trimmed.match(/^#ProjectB4JDependsOn\s+(.+)$/i);
    if (projectB4jDependsMatch) { project.b4jDependsOn.push(...splitCsvDirective(projectB4jDependsMatch[1])); continue; }
    const projectB4iDependsMatch = trimmed.match(/^#ProjectB4iDependsOn\s+(.+)$/i);
    if (projectB4iDependsMatch) { project.b4iDependsOn.push(...splitCsvDirective(projectB4iDependsMatch[1])); continue; }

    // Legacy project dependency aliases kept for compatibility.
    const dependsMatch = trimmed.match(/^#DependsOn\s+(.+)$/i);
    if (dependsMatch) { project.dependsOn.push(...splitCsvDirective(dependsMatch[1])); continue; }
    const b4aDependsMatch = trimmed.match(/^#B4ADependsOn\s+(.+)$/i);
    if (b4aDependsMatch) { project.b4aDependsOn.push(...splitCsvDirective(b4aDependsMatch[1])); continue; }
    const b4jDependsMatch = trimmed.match(/^#B4JDependsOn\s+(.+)$/i);
    if (b4jDependsMatch) { project.b4jDependsOn.push(...splitCsvDirective(b4jDependsMatch[1])); continue; }
    const b4iDependsMatch = trimmed.match(/^#B4iDependsOn\s+(.+)$/i);
    if (b4iDependsMatch) { project.b4iDependsOn.push(...splitCsvDirective(b4iDependsMatch[1])); continue; }

    const b4xLibMatch = trimmed.match(/^#B4XLib\s+(.+)$/i);
    if (b4xLibMatch) { project.b4xLibName = b4xLibMatch[1].trim().replace(/^["']|["']$/g, ''); project.sourcePath = project.sourcePath || sourcePath; project.line = project.line || lineNo; continue; }
    const b4xLibVersionMatch = trimmed.match(/^#B4XLibVersion\s+(.+)$/i) || trimmed.match(/^#Version\s+(.+)$/i);
    if (b4xLibVersionMatch) { project.b4xLibVersion = b4xLibVersionMatch[1].trim().replace(/^["']|["']$/g, ''); continue; }
    const b4xLibAuthorMatch = trimmed.match(/^#B4XLibAuthor\s+(.+)$/i) || trimmed.match(/^#Author\s+(.+)$/i);
    if (b4xLibAuthorMatch) { project.b4xLibAuthor = b4xLibAuthorMatch[1].trim().replace(/^["']|["']$/g, ''); continue; }
    const b4xLibSupportedPlatformsMatch = trimmed.match(/^#B4XLibSupportedPlatforms\s+(.+)$/i) || trimmed.match(/^#SupportedPlatforms\s+(.+)$/i);
    if (b4xLibSupportedPlatformsMatch) { project.b4xLibSupportedPlatforms.push(...splitCsvDirective(b4xLibSupportedPlatformsMatch[1])); project.supportedPlatforms.push(...splitCsvDirective(b4xLibSupportedPlatformsMatch[1])); project.sourcePath = project.sourcePath || sourcePath; project.line = project.line || lineNo; continue; }
    const b4xLibDependsMatch = trimmed.match(/^#B4XLibDependsOn\s+(.+)$/i);
    if (b4xLibDependsMatch) { project.b4xLibDependsOn.push(...splitCsvDirective(b4xLibDependsMatch[1])); continue; }
    const b4xLibB4aDependsMatch = trimmed.match(/^#B4XLibB4ADependsOn\s+(.+)$/i);
    if (b4xLibB4aDependsMatch) { project.b4xLibB4ADependsOn.push(...splitCsvDirective(b4xLibB4aDependsMatch[1])); continue; }
    const b4xLibB4jDependsMatch = trimmed.match(/^#B4XLibB4JDependsOn\s+(.+)$/i);
    if (b4xLibB4jDependsMatch) { project.b4xLibB4JDependsOn.push(...splitCsvDirective(b4xLibB4jDependsMatch[1])); continue; }
    const b4xLibB4iDependsMatch = trimmed.match(/^#B4XLibB4iDependsOn\s+(.+)$/i);
    if (b4xLibB4iDependsMatch) { project.b4xLibB4iDependsOn.push(...splitCsvDirective(b4xLibB4iDependsMatch[1])); continue; }

    const mobileMatch = trimmed.match(/^#MobileMain\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i);
    if (mobileMatch) { project.mobileMainModuleName = mobileMatch[1]; continue; }
  }
  for (const key of ['dependsOn','b4aDependsOn','b4jDependsOn','b4iDependsOn','b4xLibDependsOn','b4xLibB4ADependsOn','b4xLibB4JDependsOn','b4xLibB4iDependsOn']) project[key] = uniqueStrings(project[key]);
  project.supportedPlatforms = uniqueStrings(project.supportedPlatforms.map(s => String(s || '').toUpperCase().replace('B4I', 'B4i')));
  project.b4xLibSupportedPlatforms = uniqueStrings(project.b4xLibSupportedPlatforms.map(s => String(s || '').toUpperCase().replace('B4I', 'B4i')));
  return (project.platform || project.b4xLibName || project.supportedPlatforms.length || project.b4xLibSupportedPlatforms.length || project.dependsOn.length || project.b4aDependsOn.length || project.b4jDependsOn.length || project.b4iDependsOn.length || project.b4xLibDependsOn.length || project.b4xLibB4ADependsOn.length || project.b4xLibB4JDependsOn.length || project.b4xLibB4iDependsOn.length) ? project : null;
}

function resolveIncludePath(currentFile, target) {
  const base = path.dirname(currentFile);
  const direct = path.resolve(base, target);
  if (fs.existsSync(direct)) return direct;
  if (!/\.bx$/i.test(direct) && fs.existsSync(direct + '.bx')) return direct + '.bx';
  return direct;
}

function expandIncludes(sourcePath, text, options = {}, stack = [], includeCollector = new Set()) {
  const diagnostics = [];
  const lines = splitLines(text);
  const output = [];
  const absSource = path.resolve(sourcePath);

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    const target = parseIncludeTarget(trimmed);
    if (!target) {
      output.push(rawLine);
      continue;
    }

    const includePath = resolveIncludePath(absSource, target);
    if (stack.map(p => path.resolve(p).toLowerCase()).includes(path.resolve(includePath).toLowerCase())) {
      diagnostics.push(makeDiagnostic(absSource, index + 1, 'error', `Circular include detected: ${target}.`));
      continue;
    }
    if (!fs.existsSync(includePath)) {
      diagnostics.push(makeDiagnostic(absSource, index + 1, 'error', `Fichier inclus introuvable : ${target}.`));
      continue;
    }
    includeCollector.add(path.resolve(includePath));
    const includedText = fs.readFileSync(includePath, 'utf8');
    const expanded = expandIncludes(includePath, includedText, options, stack.concat([absSource]), includeCollector);
    diagnostics.push(...expanded.diagnostics);
    output.push(`' B4X++ include begin: ${path.relative(options.workspaceRoot || path.dirname(absSource), includePath).replace(/\\/g, '/')}`);
    output.push(...splitLines(expanded.text));
    output.push(`' B4X++ include end: ${path.relative(options.workspaceRoot || path.dirname(absSource), includePath).replace(/\\/g, '/')}`);
  }

  return { text: output.join('\n'), diagnostics, includedFiles: includeCollector };
}

function discoverIncludedFiles(files, options = {}) {
  const included = new Set();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    expandIncludes(file, text, options, [], included);
  }
  return included;
}

function parseMethodSignatureLine(line) {
  const m = String(line || '').match(/^\s*((?:(?:Public|Private|Protected|Override|Virtual|Abstract|Final)\s+)*)Sub\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\((.*)\))?\s*(?:As\s+(.+?))?\s*$/i);
  if (!m) return null;
  const tokens = (m[1] || '').trim().split(/\s+/).filter(Boolean).map(s => s.toLowerCase());
  let visibility = null;
  const modifiers = [];
  for (const token of tokens) {
    if (['public', 'private', 'protected'].includes(token)) {
      if (!visibility) visibility = token;
    } else if (!modifiers.includes(token)) {
      modifiers.push(token);
    }
  }
  const paramsRaw = m[3] || '';
  const params = splitArguments(paramsRaw).map(p => p.trim()).filter(Boolean).map((p) => {
    const pm = p.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\))?\s*(?:As\s+(.+))?$/i);
    return { raw: p, name: pm ? pm[1] : p, type: pm && pm[2] ? pm[2].trim() : '' };
  });
  return {
    name: m[2],
    modifiers,
    visibility,
    paramsRaw,
    params,
    returnType: (m[4] || '').trim(),
    raw: line
  };
}


function parsePropertyAccessorSignatureLine(line) {
  const m = String(line || '').match(/^\s*((?:(?:Public|Private|Protected)\s+)*)\s*(Get|Set)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\((.*)\))?\s*(?:As\s+(.+?))?\s*$/i);
  if (!m) return null;
  const tokens = (m[1] || '').trim().split(/\s+/).filter(Boolean).map(s => s.toLowerCase());
  let visibility = null;
  for (const token of tokens) {
    if (['public', 'private', 'protected'].includes(token) && !visibility) visibility = token;
  }
  const kind = (m[2] || '').toLowerCase();
  const propertyName = m[3];
  const paramsRaw = m[4] || '';
  const params = splitArguments(paramsRaw).map(p => p.trim()).filter(Boolean).map((p) => {
    const pm = p.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\))?\s*(?:As\s+(.+))?$/i);
    return { raw: p, name: pm ? pm[1] : p, type: pm && pm[2] ? pm[2].trim() : '' };
  });
  return {
    accessorKind: kind,
    propertyName,
    name: (kind === 'get' ? 'get' : 'set') + propertyName,
    modifiers: [],
    visibility,
    paramsRaw,
    params,
    returnType: kind === 'get' ? (m[5] || '').trim() : '',
    raw: line
  };
}

function buildPropertyAccessorMethodLine(indent, accessor) {
  const outVisibility = accessor.visibility === 'protected' ? 'private' : (accessor.visibility || 'public');
  if (accessor.accessorKind === 'get') {
    return buildMethodSignatureLine(indent, outVisibility, `get${accessor.propertyName}`, '', accessor.returnType || 'Object');
  }
  let paramsRaw = accessor.paramsRaw || '';
  if (!paramsRaw.trim()) paramsRaw = `B4XPP_${accessor.propertyName} As Object`;
  return buildMethodSignatureLine(indent, outVisibility, `set${accessor.propertyName}`, paramsRaw, '');
}

function buildMethodSignatureLine(indent, visibility, name, paramsRaw, returnType) {
  const vis = visibility ? visibility[0].toUpperCase() + visibility.slice(1).toLowerCase() : '';
  const params = paramsRaw && paramsRaw.trim() ? `(${paramsRaw})` : '';
  const ret = returnType && returnType.trim() ? ` As ${returnType.trim()}` : '';
  return `${indent}${vis ? vis + ' ' : ''}Sub ${name}${params}${ret}`;
}

function extractMethods(lines) {
  return lines.map((line, i) => {
    const sig = parseMethodSignatureLine(line) || parsePropertyAccessorSignatureLine(line) || parseConstructorSignatureLine(line);
    return sig ? { ...sig, lineIndex: i } : null;
  }).filter(Boolean);
}

function parseConstructorSignatureLine(line) {
  const m = String(line || '').match(/^\s*#Constructor\s*(?:\((.*)\))?\s*$/i);
  if (!m) return null;
  const paramsRaw = m[1] || '';
  const params = splitArguments(paramsRaw).map(p => p.trim()).filter(Boolean).map((p) => {
    const pm = p.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\))?\s*(?:As\s+(.+))?$/i);
    return { raw: p, name: pm ? pm[1] : p, type: pm && pm[2] ? pm[2].trim() : '' };
  });
  return {
    name: 'Initialize',
    sourceName: '#Constructor',
    modifiers: ['constructor'],
    visibility: 'public',
    paramsRaw,
    params,
    returnType: '',
    raw: line,
    isConstructor: true
  };
}

function generatedOverloadName(baseName, index) {
  return index === 0 ? baseName : `${baseName}${index + 1}`;
}

function normalizeOverloadKey(name) {
  return String(name || '').toLowerCase();
}

function countParamsRaw(paramsRaw) {
  const raw = String(paramsRaw || '').trim();
  if (!raw) return 0;
  return splitArguments(raw).map(s => s.trim()).filter(Boolean).length;
}

function collectOverloadPlan(lines, ownerName, diagnostics, sourcePath, startLine) {
  const plan = {
    constructorsByArity: new Map(),
    constructorNamesByLine: new Map(),
    constructorInfosByLine: new Map(),
    methodNamesByLine: new Map(),
    methodInfosByLine: new Map(),
    methodsByNameArity: new Map(),
    ambiguous: []
  };

  const constructors = [];
  const methodGroups = new Map();
  for (let i = 0; i < (lines || []).length; i++) {
    const raw = lines[i];
    const ctor = parseConstructorSignatureLine(raw);
    if (ctor) {
      constructors.push({ ...ctor, lineIndex: i, absoluteLine: (startLine || 0) + i + 1 });
      continue;
    }
    const sig = parseMethodSignatureLine(raw);
    if (!sig) continue;
    const lname = normalizeOverloadKey(sig.name);
    if (['class_globals', 'b4xpp_dispatch'].includes(lname) || lname.startsWith('b4xpp_')) continue;
    if (!methodGroups.has(lname)) methodGroups.set(lname, []);
    methodGroups.get(lname).push({ ...sig, lineIndex: i, absoluteLine: (startLine || 0) + i + 1 });
  }

  if (constructors.length) {
    const seenArities = new Map();
    constructors.forEach((ctor, idx) => {
      const generated = constructors.length === 1 ? 'Initialize' : generatedOverloadName('Initialize', idx);
      const arity = (ctor.params || []).length;
      if (seenArities.has(arity)) {
        diagnostics && diagnostics.push(makeDiagnostic(sourcePath, ctor.absoluteLine, 'error', `Ambiguous constructor overload in ${ownerName}: #Constructor with ${arity} parameter(s) is already declared. Type-based overload resolution is not supported yet.`));
      } else {
        seenArities.set(arity, generated);
        plan.constructorsByArity.set(arity, generated);
      }
      plan.constructorNamesByLine.set(ctor.absoluteLine, generated);
      plan.constructorInfosByLine.set(ctor.absoluteLine, { generated, arity, name: 'Initialize' });
    });
  }

  for (const [lname, group] of methodGroups) {
    if (group.length <= 1) continue;
    const byArity = new Map();
    group.forEach((sig, idx) => {
      const generated = generatedOverloadName(sig.name, idx);
      const arity = (sig.params || []).length;
      if (byArity.has(arity)) {
        diagnostics && diagnostics.push(makeDiagnostic(sourcePath, sig.absoluteLine, 'error', `Ambiguous overload: ${ownerName}.${sig.name} has more than one overload with ${arity} parameter(s). v0.3.2 resolves overloads by parameter count only.`));
        plan.ambiguous.push({ ownerName, name: sig.name, arity });
      } else {
        byArity.set(arity, generated);
      }
      plan.methodNamesByLine.set(sig.absoluteLine, generated);
      plan.methodInfosByLine.set(sig.absoluteLine, { generated, name: sig.name, arity });
    });
    plan.methodsByNameArity.set(lname, byArity);
  }
  return plan;
}

function getClassOverloadPlan(programInfo, className) {
  if (!programInfo || !className || typeof programInfo.getOverloadPlan !== 'function') return null;
  return programInfo.getOverloadPlan(className);
}

function resolveGeneratedOverloadName(programInfo, className, methodName, arity) {
  const plan = getClassOverloadPlan(programInfo, className);
  if (!plan) return null;
  const lname = normalizeOverloadKey(methodName);
  if (lname === 'initialize' && plan.constructorsByArity && plan.constructorsByArity.has(arity)) return plan.constructorsByArity.get(arity);
  const byArity = plan.methodsByNameArity && plan.methodsByNameArity.get(lname);
  if (byArity && byArity.has(arity)) return byArity.get(arity);
  return null;
}


function generatedConstructorNameForContext(context, paramsRaw) {
  const arity = countParamsRaw(paramsRaw);
  const plan = context && context.overloadPlan;
  if (plan && plan.constructorInfosByLine && plan.constructorInfosByLine.has(context.lineNo)) {
    const info = plan.constructorInfosByLine.get(context.lineNo);
    if (info && info.arity === arity) return info.generated;
  }
  if (plan && plan.constructorsByArity && plan.constructorsByArity.has(arity)) return plan.constructorsByArity.get(arity);
  return 'Initialize';
}

function generatedMethodNameForContext(context, methodSig) {
  const plan = context && context.overloadPlan;
  const name = methodSig && methodSig.name;
  const arity = methodSig && methodSig.params ? methodSig.params.length : 0;
  if (plan && plan.methodInfosByLine && plan.methodInfosByLine.has(context.lineNo)) {
    const info = plan.methodInfosByLine.get(context.lineNo);
    if (info && String(info.name || '').toLowerCase() === String(name || '').toLowerCase() && info.arity === arity) return info.generated;
  }
  return resolveGeneratedOverloadName(context && context.programInfo, context && context.className, name, arity) || name;
}

function parseBxFile(sourcePath, text, options = {}) {
  const diagnostics = [];
  const classes = [];
  const staticCodes = [];
  const interfaces = [];
  const topLevelLines = [];
  let mainModuleName = null;
  let current = null;
  let currentStatic = null;
  let currentInterface = null;
  const lines = splitLines(text);
  const project = parseProjectDirectives(sourcePath, lines, diagnostics);

  function closeClass(lineNo, implicit) {
    if (!current) return;
    if (implicit) {
      diagnostics.push(makeDiagnostic(sourcePath, lineNo, 'warning', `Missing #End Class for ${current.name}. The class was closed implicitly at end of file.`));
    }
    current.methods = extractMethods(current.lines);
    classes.push(current);
    current = null;
  }

  function closeStatic(lineNo, implicit) {
    if (!currentStatic) return;
    if (implicit) {
      diagnostics.push(makeDiagnostic(sourcePath, lineNo, 'warning', `Missing #End StaticCode for ${currentStatic.name}. The static code module was closed implicitly at end of file.`));
    }
    currentStatic.methods = extractMethods(currentStatic.lines);
    staticCodes.push(currentStatic);
    currentStatic = null;
  }

  function closeInterface(lineNo, implicit) {
    if (!currentInterface) return;
    if (implicit) {
      diagnostics.push(makeDiagnostic(sourcePath, lineNo, 'warning', `Missing #End Interface for ${currentInterface.name}. The interface was closed implicitly at end of file.`));
    }
    currentInterface.methods = extractMethods(currentInterface.lines);
    interfaces.push(currentInterface);
    currentInterface = null;
  }

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    const lineNo = index + 1;

    if (/^#(?:Project|Package|ProjectDir|ProjectDependsOn|ProjectB4ADependsOn|ProjectB4JDependsOn|ProjectB4iDependsOn|MobileMain|B4XLib|B4XLibDir|B4XLibVersion|B4XLibAuthor|B4XLibSupportedPlatforms|B4XLibDependsOn|B4XLibB4ADependsOn|B4XLibB4JDependsOn|B4XLibB4iDependsOn|LibraryFilesDir|Version|Author|DependsOn|B4ADependsOn|B4JDependsOn|B4iDependsOn|SupportedPlatforms|ShortName)\b/i.test(trimmed)) continue;

    const includeTarget = parseIncludeTarget(trimmed);
    if (includeTarget) continue;

    const mainMatch = trimmed.match(/^#MainModule\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i);
    if (mainMatch) {
      mainModuleName = mainMatch[1];
      continue;
    }

    const interfaceMatch = trimmed.match(/^#Interface\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i);
    if (interfaceMatch) {
      if (current) closeClass(lineNo, true);
      if (currentStatic) closeStatic(lineNo, true);
      if (currentInterface) closeInterface(lineNo, true);
      currentInterface = {
        type: 'interface',
        name: interfaceMatch[1],
        sourcePath,
        startLine: lineNo,
        lines: [],
        methods: []
      };
      continue;
    }

    if (/^#End\s+Interface\s*$/i.test(trimmed)) {
      if (!currentInterface) {
        diagnostics.push(makeDiagnostic(sourcePath, lineNo, 'warning', '#End Interface found without a matching #Interface. The line was ignored.'));
      } else {
        closeInterface(lineNo, false);
      }
      continue;
    }

    if (currentInterface) {
      currentInterface.lines.push(rawLine);
      continue;
    }

    const staticMatch = trimmed.match(/^#StaticCode\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i);
    if (staticMatch) {
      if (current) closeClass(lineNo, true);
      if (currentStatic) closeStatic(lineNo, true);
      const moduleName = sanitizeModuleName(staticMatch[1]);
      if (!moduleName) {
        diagnostics.push(makeDiagnostic(sourcePath, lineNo, 'error', `Invalid static code module name in #StaticCode: "${staticMatch[1] || ''}".`));
        currentStatic = null;
        continue;
      }
      currentStatic = {
        type: 'static',
        name: moduleName,
        sourcePath,
        startLine: lineNo,
        lines: [],
        methods: []
      };
      continue;
    }

    if (/^#End\s+StaticCode\s*$/i.test(trimmed)) {
      if (!currentStatic) {
        diagnostics.push(makeDiagnostic(sourcePath, lineNo, 'warning', '#End StaticCode found without a matching #StaticCode. The line was ignored.'));
      } else {
        closeStatic(lineNo, false);
      }
      continue;
    }

    if (currentStatic) {
      currentStatic.lines.push(rawLine);
      continue;
    }

    const classMatch = trimmed.match(/^#Class\b(.*)$/i);
    if (classMatch) {
      if (current) closeClass(lineNo, true);
      if (currentStatic) closeStatic(lineNo, true);
      const parsed = parseClassDirective(classMatch[1]);
      const className = sanitizeModuleName(parsed.name);
      if (!className) {
        diagnostics.push(makeDiagnostic(sourcePath, lineNo, 'error', `Invalid class name in #Class: "${parsed.name || ''}".`));
        current = null;
        continue;
      }
      const extendsName = sanitizeModuleName(parsed.extendsName);
      if (parsed.extendsName && !extendsName) {
        diagnostics.push(makeDiagnostic(sourcePath, lineNo, 'error', `Invalid parent class name in #Class ${className} Extends ${parsed.extendsName}.`));
      }
      current = {
        type: 'class',
        name: className,
        extendsName,
        implementsNames: (parsed.implementsNames || []).filter(Boolean),
        modifiers: parsed.modifiers || [],
        sourcePath,
        startLine: lineNo,
        lines: [],
        methods: []
      };
      continue;
    }

    if (/^#End\s+Class\s*$/i.test(trimmed)) {
      if (!current) {
        diagnostics.push(makeDiagnostic(sourcePath, lineNo, 'warning', '#End Class found without a matching #Class. The line was ignored.'));
      } else {
        closeClass(lineNo, false);
      }
      continue;
    }

    if (current) {
      const extendsMatch = trimmed.match(/^#Extends\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i);
      if (extendsMatch) {
        current.extendsName = extendsMatch[1];
        continue;
      }

      const implementsMatch = trimmed.match(/^#Implements\s+(.+)$/i);
      if (implementsMatch) {
        current.implementsNames.push(...implementsMatch[1].split(',').map(s => s.trim()).filter(Boolean));
        continue;
      }

      if (/^#Abstract\s*$/i.test(trimmed)) {
        if (!current.modifiers.includes('abstract')) current.modifiers.push('abstract');
        continue;
      }

      if (/^#Final\s*$/i.test(trimmed)) {
        if (!current.modifiers.includes('final')) current.modifiers.push('final');
        continue;
      }

      current.lines.push(rawLine);
    } else {
      topLevelLines.push(rawLine);
    }
  }

  if (current) closeClass(lines.length, true);
  if (currentStatic) closeStatic(lines.length, true);
  if (currentInterface) closeInterface(lines.length, true);

  return {
    sourcePath,
    mainModuleName,
    project,
    classes,
    staticCodes,
    interfaces,
    topLevelLines,
    diagnostics
  };
}

function buildHeader(kind, moduleName, sourcePath, options = {}) {
  if (!options.addGeneratedHeader) return [];
  const rel = options.workspaceRoot ? path.relative(options.workspaceRoot, sourcePath).replace(/\\/g, '/') : sourcePath;
  const header = [
    `' AUTO-GENERATED BY B4X++ v${options.generatorVersion || B4XPP_GENERATOR_VERSION}`,
    "' DO NOT EDIT THIS FILE DIRECTLY",
    `' GeneratorVersion: ${options.generatorVersion || B4XPP_GENERATOR_VERSION}`,
    `' Source: ${rel}`,
    `' ${kind}: ${moduleName}`
  ];
  if (options.includeTimestamp) header.push(`' Generated: ${new Date().toISOString()}`);
  header.push('');
  return header;
}

function trimTrailingBlankLines(lines) {
  const copy = lines.slice();
  while (copy.length && copy[copy.length - 1].trim() === '') copy.pop();
  return copy;
}

function createProgramInfo(parsedFiles, diagnostics) {
  const classes = new Map();
  const staticCodes = new Map();
  const interfaces = new Map();
  const overloadPlans = new Map();
  const projects = [];

  for (const parsed of parsedFiles) {
    if (parsed.project) projects.push(parsed.project);
    for (const intf of parsed.interfaces || []) {
      const key = intf.name.toLowerCase();
      if (interfaces.has(key)) {
        diagnostics.push(makeDiagnostic(parsed.sourcePath, intf.startLine, 'error', `Duplicate interface in project: ${intf.name}.`));
      } else {
        interfaces.set(key, intf);
      }
    }
    for (const mod of parsed.staticCodes || []) {
      const key = mod.name.toLowerCase();
      if (classes.has(key) || staticCodes.has(key)) {
        diagnostics.push(makeDiagnostic(parsed.sourcePath, mod.startLine, 'error', `Duplicate module in project: ${mod.name}.`));
      } else {
        staticCodes.set(key, mod);
      }
    }
    for (const cls of parsed.classes) {
      const key = cls.name.toLowerCase();
      if (classes.has(key) || staticCodes.has(key)) {
        diagnostics.push(makeDiagnostic(parsed.sourcePath, cls.startLine, 'error', `Duplicate class in project: ${cls.name}.`));
      } else {
        classes.set(key, cls);
      }
    }
  }

  for (const cls of classes.values()) {
    overloadPlans.set(cls.name.toLowerCase(), collectOverloadPlan(cls.lines || [], cls.name, diagnostics, cls.sourcePath, cls.startLine));
  }

  function getClass(name) {
    return classes.get(String(name || '').toLowerCase()) || null;
  }

  function getInterface(name) {
    return interfaces.get(String(name || '').toLowerCase()) || null;
  }

  function getOverloadPlan(name) {
    return overloadPlans.get(String(name || '').toLowerCase()) || null;
  }

  function ancestorChain(name) {
    const out = [];
    let current = getClass(name);
    const seen = new Set();
    while (current && current.extendsName) {
      const parentKey = current.extendsName.toLowerCase();
      if (seen.has(parentKey)) break;
      seen.add(parentKey);
      const parent = getClass(current.extendsName);
      if (!parent) break;
      out.push(parent);
      current = parent;
    }
    return out;
  }

  function findOwnMethod(classOrInterface, methodName) {
    if (!classOrInterface) return null;
    return (classOrInterface.methods || []).find(m => m.name.toLowerCase() === String(methodName || '').toLowerCase()) || null;
  }

  function findClassMethod(className, methodName) {
    const cls = getClass(className);
    const own = findOwnMethod(cls, methodName);
    if (own) return { cls, method: own };
    for (const ancestor of ancestorChain(className)) {
      const method = findOwnMethod(ancestor, methodName);
      if (method) return { cls: ancestor, method };
    }
    return null;
  }

  function findAncestorMethod(className, methodName) {
    for (const ancestor of ancestorChain(className)) {
      const method = findOwnMethod(ancestor, methodName);
      if (method) return { cls: ancestor, method };
    }
    return null;
  }

  function virtualMethodsFor(baseName) {
    const intf = getInterface(baseName);
    const methods = new Map();
    if (intf) {
      for (const m of intf.methods) methods.set(m.name.toLowerCase(), m);
      return methods;
    }

    const cls = getClass(baseName);
    if (!cls) return methods;
    for (const m of cls.methods) {
      if (m.modifiers.includes('virtual') || m.modifiers.includes('abstract')) methods.set(m.name.toLowerCase(), m);
    }
    for (const other of classes.values()) {
      const ancestors = ancestorChain(other.name).map(a => a.name.toLowerCase());
      if (!ancestors.includes(cls.name.toLowerCase())) continue;
      for (const m of other.methods) {
        if (m.modifiers.includes('override')) methods.set(m.name.toLowerCase(), m);
      }
    }
    return methods;
  }

  function dispatchableMethodsFor(className) {
    const cls = getClass(className);
    const methods = new Map();
    if (!cls) return methods;

    function addMethod(m, owner, inherited) {
      const lname = m.name.toLowerCase();
      if (['class_globals', 'initialize', 'b4xpp_dispatch'].includes(lname) || lname.startsWith('b4xpp_super_') || lname.startsWith('b4xpp_inherited_')) return;
      if (m.visibility === 'private') return;
      if (!methods.has(lname)) methods.set(lname, { method: m, owner, inherited: inherited === true });
    }

    for (const m of cls.methods) addMethod(m, cls, false);
    for (const ancestor of ancestorChain(className)) {
      for (const m of ancestor.methods) addMethod(m, ancestor, true);
    }
    return methods;
  }

  function classImplementsInterface(className, interfaceName) {
    const target = String(interfaceName || '').toLowerCase();
    const cls = getClass(className);
    if (!cls || !target) return false;
    const chain = [cls].concat(ancestorChain(className));
    return chain.some(c => (c.implementsNames || []).some(n => String(n || '').toLowerCase() === target));
  }

  function isDescendantOf(className, baseName) {
    const target = String(baseName || '').toLowerCase();
    if (!getClass(className) || !getClass(baseName) || !target) return false;
    return ancestorChain(className).some(a => a.name.toLowerCase() === target);
  }

  function isAssignableTo(valueType, targetType) {
    const value = String(valueType || '').trim();
    const target = String(targetType || '').trim();
    if (!value || !target) return false;
    if (value.toLowerCase() === target.toLowerCase()) return true;
    if (getClass(value) && getClass(target)) return isDescendantOf(value, target);
    if (getClass(value) && getInterface(target)) return classImplementsInterface(value, target);
    return false;
  }

  return {
    classes,
    staticCodes,
    interfaces,
    projects,
    getClass,
    getInterface,
    getOverloadPlan,
    ancestorChain,
    findClassMethod,
    findAncestorMethod,
    virtualMethodsFor,
    dispatchableMethodsFor,
    classImplementsInterface,
    isDescendantOf,
    isAssignableTo
  };
}



const B4XPP_BUILTIN_TYPES = new Set([
  // Keep only language / core scalar and collection types here.
  // Platform and library types (XUI, B4XView, B4XCanvas, Form, JFX, etc.)
  // must be resolved from active .xml / .b4xlib dependencies.
  'string','int','long','float','double','boolean','object','list','map','sub','closure','b4xpp_closure'
]);

const B4XPP_BUILTIN_VALUES = new Set([
  'true','false','null','dateTime'.toLowerCase(),'file','regex','array','colors','max','min','abs','round','round2','log','logcolor','sleep','wait','callsub','callsub2','callsub3','numberformat','numberformat2','chr','asc','smartstringformatter'
]);

const B4XPP_BUILTIN_MEMBERS = new Map([
  ['list', [{ name: 'Initialize', params: [] }, { name: 'Add' }, { name: 'Get', returnType: 'Object' }, { name: 'Set' }, { name: 'RemoveAt' }, { name: 'Clear', params: [] }, { name: 'Size', kind: 'property', type: 'Int' }, { name: 'IsInitialized', returnType: 'Boolean' }]],
  ['map', [{ name: 'Initialize', params: [] }, { name: 'Put' }, { name: 'Get', returnType: 'Object' }, { name: 'GetDefault', returnType: 'Object' }, { name: 'ContainsKey', returnType: 'Boolean' }, { name: 'Remove' }, { name: 'Clear', params: [] }, { name: 'Size', kind: 'property', type: 'Int' }, { name: 'IsInitialized', returnType: 'Boolean' }]],
  ['string', [{ name: 'Length', kind: 'property', type: 'Int' }, { name: 'Trim', returnType: 'String' }, { name: 'ToLowerCase', returnType: 'String' }, { name: 'ToUpperCase', returnType: 'String' }, { name: 'SubString', returnType: 'String' }, { name: 'SubString2', returnType: 'String' }, { name: 'Contains', returnType: 'Boolean' }, { name: 'Replace', returnType: 'String' }]]
]);

function normalizeB4XType(typeName) {
  let t = String(typeName || '').trim();
  if (!t) return '';
  t = t.replace(/\(\)$/, '');
  const lower = t.toLowerCase();
  const javaMap = new Map([
    ['java.lang.string', 'String'], ['string', 'String'], ['int', 'Int'], ['integer', 'Int'], ['java.lang.integer', 'Int'],
    ['long', 'Long'], ['java.lang.long', 'Long'], ['double', 'Double'], ['java.lang.double', 'Double'], ['float', 'Float'], ['java.lang.float', 'Float'],
    ['boolean', 'Boolean'], ['java.lang.boolean', 'Boolean'], ['object', 'Object'], ['java.lang.object', 'Object'],
    ['anywheresoftware.b4a.objects.collections.list', 'List'], ['anywheresoftware.b4a.objects.collections.map', 'Map'],
    ['anywheresoftware.b4j.objects.jfx.paintwrapper', 'Paint'], ['anywheresoftware.b4j.objects.nodewrapper.concretenodewrapper', 'Node'],
    ['anywheresoftware.b4j.objects.form', 'Form'], ['anywheresoftware.b4j.objects.paneWrapper.ConcretePaneWrapper'.toLowerCase(), 'Pane']
  ]);
  return javaMap.get(lower) || t.split('.').pop().replace(/Wrapper$/i, '') || t;
}

function readArrayOption(options, ...names) {
  const out = [];
  for (const name of names) {
    const value = options && options[name];
    if (Array.isArray(value)) out.push(...value);
    else if (typeof value === 'string' && value.trim()) out.push(value);
  }
  return out.map(v => String(v || '').trim()).filter(Boolean);
}

function normalizePlatformKey(value) {
  const platform = String(value || '').toLowerCase();
  if (platform.includes('b4a') || platform.includes('android')) return 'b4a';
  if (platform.includes('b4i') || platform.includes('ios')) return 'b4i';
  if (platform.includes('b4j')) return 'b4j';
  return '';
}

function optionPlatformKey(options) {
  const p = normalizePlatformKey(options && options.platform);
  return p || '';
}

function platformKeyFromProject(project, options) {
  const explicit = normalizePlatformKey(project && project.platform);
  if (explicit) return explicit;
  const configured = optionPlatformKey(options);
  if (configured) return configured;
  const keys = projectPlatformKeys(project, options);
  return keys.length === 1 ? keys[0] : 'b4x';
}

function projectPlatformKeys(project, options) {
  const explicit = normalizePlatformKey(project && project.platform);
  if (explicit) return [explicit];

  const configured = optionPlatformKey(options);
  if (configured) return [configured];

  const supported = uniqueStrings((project && (project.b4xLibSupportedPlatforms || project.supportedPlatforms) ? (project.b4xLibSupportedPlatforms && project.b4xLibSupportedPlatforms.length ? project.b4xLibSupportedPlatforms : project.supportedPlatforms) : [])
    .map(normalizePlatformKey)
    .filter(Boolean));
  if (supported.length) return supported;

  if (project && project.b4xLibName) return ['b4a', 'b4j', 'b4i'];
  return ['b4j', 'b4a', 'b4i'];
}

function collectLibraryDirs(options, project) {
  const keys = projectPlatformKeys(project, options);
  const perPlatform = {
    b4j: readArrayOption(options, 'b4jInternalLibraryDirs', 'b4jAdditionalLibraryDirs'),
    b4a: readArrayOption(options, 'b4aInternalLibraryDirs', 'b4aAdditionalLibraryDirs'),
    b4i: readArrayOption(options, 'b4iInternalLibraryDirs', 'b4iAdditionalLibraryDirs')
  };

  let dirs = [];
  for (const key of keys) dirs.push(...(perPlatform[key] || []));

  if (options && options.workspaceRoot) {
    dirs = dirs.map(d => path.isAbsolute(d) ? d : path.join(options.workspaceRoot, d));
  }
  return uniqueStrings(dirs).filter(d => d && fs.existsSync(d));
}

function xmlDecode(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseXmlTextTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = String(block || '').match(re);
  return m ? xmlDecode(m[1].trim()) : '';
}

function parseB4XLibraryXml(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const dependsOn = Array.from(xml.matchAll(/<dependsOn>([\s\S]*?)<\/dependsOn>/gi)).map(m => xmlDecode(m[1].trim())).filter(Boolean);
  const version = parseXmlTextTag(xml, 'version');
  const classes = [];
  const classMatches = Array.from(xml.matchAll(/<class\b([^>]*)>([\s\S]*?)<\/class>/gi));
  for (const cm of classMatches) {
    const attrs = cm[1] || '';
    const body = cm[2] || '';
    const kindMatch = attrs.match(/b4a_type\s*=\s*["']([^"']+)["']/i);
    const kind = kindMatch ? kindMatch[1] : 'Class';
    const fullName = parseXmlTextTag(body, 'name');
    const shortName = parseXmlTextTag(body, 'shortname') || path.basename(xmlPath, '.xml');
    const methods = [];
    const methodMatches = Array.from(body.matchAll(/<method\b[^>]*>([\s\S]*?)<\/method>/gi));
    for (const mm of methodMatches) {
      const mb = mm[1] || '';
      const nameTag = mb.match(/<name\b([^>]*)>([\s\S]*?)<\/name>/i);
      if (!nameTag) continue;
      const attrsText = nameTag[1] || '';
      const designer = (attrsText.match(/DesignerName\s*=\s*["']([^"']+)["']/i) || [])[1];
      const rawName = xmlDecode((nameTag[2] || '').trim()).replace(/^_/, '');
      const name = designer || rawName.replace(/(^|_)([a-z])/g, (_, a, b) => b.toUpperCase());
      const returnType = normalizeB4XType(parseXmlTextTag(mb, 'returntype'));
      const params = [];
      for (const pm of mb.matchAll(/<parameter\b[^>]*>([\s\S]*?)<\/parameter>/gi)) {
        const pb = pm[1] || '';
        params.push({ name: parseXmlTextTag(pb, 'name') || `Arg${params.length + 1}`, type: normalizeB4XType(parseXmlTextTag(pb, 'type') || 'Object') });
      }
      methods.push({ name, returnType, params });
    }
    classes.push({ name: shortName, shortName, fullName, kind, methods });
  }
  return { path: xmlPath, name: path.basename(xmlPath, '.xml'), version, dependsOn, classes };
}


function readZipEntries(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  let eocd = -1;
  const min = Math.max(0, buffer.length - 0x10000 - 22);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP end-of-central-directory record not found');
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  let ptr = centralOffset;
  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(ptr) !== 0x02014b50) throw new Error('Invalid ZIP central directory header');
    const method = buffer.readUInt16LE(ptr + 10);
    const compressedSize = buffer.readUInt32LE(ptr + 20);
    const uncompressedSize = buffer.readUInt32LE(ptr + 24);
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const localOffset = buffer.readUInt32LE(ptr + 42);
    const name = buffer.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Invalid ZIP local header for ${name}`);
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
    if (uncompressedSize && data.length !== uncompressedSize) {
      // Be tolerant: some ZIP producers set sizes differently, but keep the data when it inflates correctly.
    }
    entries.push({ name, data });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function stripUtf8Bom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function parseB4XMetaHeader(lines) {
  const meta = {};
  for (const raw of lines || []) {
    const line = stripUtf8Bom(raw).trim();
    if (/^@EndOfDesignText@/i.test(line)) break;
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m) meta[m[1].toLowerCase()] = m[2].trim();
  }
  return meta;
}

function parseB4XLibBasModule(modulePath, content, libraryName, libraryPath) {
  const text = stripUtf8Bom(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');
  const meta = parseB4XMetaHeader(lines);
  const moduleName = path.basename(modulePath, '.bas');
  const kind = meta.type || 'Class';
  const methods = [];
  const designerScriptMethods = [];
  const properties = [];
  const designerProperties = [];
  const events = [];
  const userTypes = [];

  for (const raw of lines) {
    const line = stripCodeCommentKeepDirective(String(raw || ''));
    const sig = parseMethodSignatureLine(line);
    if (sig) {
      const item = {
        name: sig.name,
        visibility: sig.visibility || 'public',
        params: (sig.params || []).map(p => ({ name: p.name, type: normalizeB4XType(p.type || 'Object') })),
        returnType: normalizeB4XType(sig.returnType || ''),
        source: modulePath,
        libraryName
      };
      if (item.visibility === 'public') methods.push(item);
      else if ((item.params || []).some(p => /^DesignerArgs$/i.test(p.type))) designerScriptMethods.push(item);
      continue;
    }
    const propLine = String(raw || '').match(/^\s*Public\s+([A-Za-z_][A-Za-z0-9_]*)\s+As\s+([A-Za-z_][A-Za-z0-9_\.]*)(?:\s*=.*)?$/i);
    if (propLine) {
      properties.push({ name: propLine[1], type: normalizeB4XType(propLine[2] || 'Object'), visibility: 'public', source: modulePath });
      continue;
    }
    const typeLine = String(raw || '').match(/^\s*Type\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*$/i);
    if (typeLine) {
      const fields = splitArguments(typeLine[2] || '').map(part => {
        const fm = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s+As\s+(.+)$/i);
        return fm ? { name: fm[1], type: normalizeB4XType(fm[2].trim()) } : null;
      }).filter(Boolean);
      userTypes.push({ name: typeLine[1], shortName: typeLine[1], fullName: `${libraryName}.${typeLine[1]}`, kind: 'Type', fields, methods: [], properties: fields, libraryPath });
      continue;
    }
    const designerProp = String(raw || '').match(/^\s*#DesignerProperty\s*:\s*Key:\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*DisplayName:\s*([^,]+)\s*,\s*FieldType:\s*([^,]+)(?:\s*,\s*DefaultValue:\s*(.*))?/i);
    if (designerProp) {
      designerProperties.push({ name: designerProp[1], displayName: designerProp[2].trim(), type: normalizeB4XType(designerProp[3].trim()), defaultValue: (designerProp[4] || '').trim(), source: modulePath });
      continue;
    }
    const eventLine = String(raw || '').match(/^\s*#Event\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*$/i);
    if (eventLine) {
      events.push({ name: eventLine[1], paramsRaw: eventLine[2] || '', source: modulePath });
    }
  }

  for (const p of properties) {
    if (!methods.some(m => m.name.toLowerCase() === ('get' + p.name).toLowerCase())) methods.push({ name: 'get' + p.name, params: [], returnType: p.type, visibility: 'public', synthetic: true, source: modulePath, libraryName });
    if (!methods.some(m => m.name.toLowerCase() === ('set' + p.name).toLowerCase())) methods.push({ name: 'set' + p.name, params: [{ name: 'Value', type: p.type }], returnType: '', visibility: 'public', synthetic: true, source: modulePath, libraryName });
  }

  return {
    name: moduleName,
    shortName: moduleName,
    fullName: `${libraryName}.${moduleName}`,
    kind,
    meta,
    methods,
    properties,
    designerScriptMethods,
    designerProperties,
    events,
    userTypes,
    libraryPath
  };
}

function stripCodeCommentKeepDirective(line) {
  const s = String(line || '');
  if (/^\s*#/.test(s)) return s;
  return splitCodeAndComment(s).code;
}

function parseB4XLibFile(b4xlibPath) {
  const entries = readZipEntries(b4xlibPath);
  const libraryName = path.basename(b4xlibPath, '.b4xlib');
  const manifestEntry = entries.find(e => /(^|\/)manifest\.txt$/i.test(e.name));
  const manifestText = manifestEntry ? stripUtf8Bom(manifestEntry.data.toString('utf8')) : '';
  const versionMatch = manifestText.match(/^\s*Version\s*=\s*(.+)\s*$/mi);
  const version = versionMatch ? versionMatch[1].trim() : '';
  const classes = [];
  const types = [];
  for (const entry of entries) {
    if (!/\.bas$/i.test(entry.name)) continue;
    const cls = parseB4XLibBasModule(entry.name, entry.data.toString('utf8'), libraryName, b4xlibPath);
    classes.push(cls);
    for (const t of cls.userTypes || []) types.push(t);
  }
  return { path: b4xlibPath, name: libraryName, version, dependsOn: [], classes, types, manifest: manifestText, kind: 'b4xlib' };
}

function addParsedLibraryToIndex(lib, libs, types) {
  libs.set(String(lib.name || '').toLowerCase(), lib);
  for (const cls of lib.classes || []) {
    if (!cls || !cls.shortName) continue;
    const withLib = { ...cls, library: lib };
    types.set(String(cls.shortName).toLowerCase(), withLib);
    types.set(String(cls.name || cls.shortName).toLowerCase(), withLib);
    if (cls.fullName) types.set(String(cls.fullName).toLowerCase(), withLib);
  }
  for (const t of lib.types || []) {
    if (!t || !t.shortName) continue;
    const withLib = { ...t, library: lib };
    types.set(String(t.shortName).toLowerCase(), withLib);
    types.set(String(t.name || t.shortName).toLowerCase(), withLib);
    if (t.fullName) types.set(String(t.fullName).toLowerCase(), withLib);
  }
}


function b4xppLibraryDirSignature(dirs) {
  const parts = [];
  for (const dir of dirs || []) {
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    parts.push(`dir:${dir}:${st.mtimeMs}:${st.size}`);
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const file of entries) {
      if (!/\.(xml|b4xlib)$/i.test(file)) continue;
      const full = path.join(dir, file);
      try {
        const fst = fs.statSync(full);
        parts.push(`${full}:${fst.mtimeMs}:${fst.size}`);
      } catch {}
    }
  }
  return parts.sort().join('|');
}

function cloneB4XLibraryIndex(index) {
  // Maps and parsed library metadata are treated as read-only by the validator.
  // Return a shallow object wrapper so callers can attach platform diagnostics without mutating the cache entry itself.
  return { dirs: index.dirs, libs: index.libs, types: index.types, parsedXml: index.parsedXml, cacheKey: index.cacheKey, cacheHit: true };
}

function buildB4XLibraryIndex(options, programInfo, diagnostics) {
  const project = (programInfo.projects && programInfo.projects[0]) || null;
  const dirs = collectLibraryDirs(options || {}, project);
  const platformKeys = projectPlatformKeys(project, options || {});
  const platform = platformKeys.length === 1 ? platformKeys[0] : 'b4x';
  const cacheKey = `${platformKeys.slice().sort().join('+')}::${b4xppLibraryDirSignature(dirs)}`;
  let index = B4XPP_LIBRARY_INDEX_CACHE.get(cacheKey);

  if (!index) {
    const libs = new Map();
    const types = new Map();
    const parsedXml = [];

    for (const dir of dirs) {
      let entries = [];
      try { entries = fs.readdirSync(dir); } catch { continue; }
      for (const file of entries) {
        const full = path.join(dir, file);
        try {
          if (/\.xml$/i.test(file)) {
            const lib = parseB4XLibraryXml(full);
            parsedXml.push(lib);
            addParsedLibraryToIndex(lib, libs, types);
          } else if (/\.b4xlib$/i.test(file)) {
            const lib = parseB4XLibFile(full);
            parsedXml.push(lib);
            addParsedLibraryToIndex(lib, libs, types);
          }
        } catch (err) {
          if (diagnostics && (options && options.validationStrict)) diagnostics.push(makeDiagnostic((project && project.sourcePath) || '', (project && project.line) || 1, 'warning', `Could not parse B4X library file: ${full} (${err.message})`));
        }
      }
    }

    index = { dirs, libs, types, parsedXml, cacheKey, cacheHit: false };
    B4XPP_LIBRARY_INDEX_CACHE.set(cacheKey, index);
  }

  const out = cloneB4XLibraryIndex(index);
  out.cacheHit = index.cacheHit === true;
  index.cacheHit = true;

  // Dependency diagnostics are project-specific, so run them every time even when the heavy library scan came from cache.
  const required = new Set();
  const commonDepends = project ? [...(project.dependsOn || []), ...(project.b4xLibDependsOn || [])] : [];
  const platformDepends = [];
  if (project) {
    if (platformKeys.includes('b4j')) platformDepends.push(...(project.b4jDependsOn || []), ...(project.b4xLibB4JDependsOn || []));
    if (platformKeys.includes('b4a')) platformDepends.push(...(project.b4aDependsOn || []), ...(project.b4xLibB4ADependsOn || []));
    if (platformKeys.includes('b4i')) platformDepends.push(...(project.b4iDependsOn || []), ...(project.b4xLibB4iDependsOn || []));
  }
  for (const dep of [...commonDepends, ...platformDepends]) if (dep) required.add(String(dep).toLowerCase());
  for (const dep of required) {
    if (!out.libs.has(dep) && !out.types.has(dep) && !B4XPP_BUILTIN_TYPES.has(dep) && !programInfo.staticCodes.has(dep) && !programInfo.classes.has(dep)) {
      const severity = options && options.validationStrict ? 'warning' : 'warning';
      diagnostics.push(makeDiagnostic((project && project.sourcePath) || '', (project && project.line) || 1, severity, `B4X library metadata not found for dependency '${dep}'. Add its folder to the active platform library settings (${platformKeys.map(k => `b4xpp.${k}.internalLibraryDirs / b4xpp.${k}.additionalLibraryDirs`).join(', ')}) for stronger validation.`));
    }
  }
  return out;
}

function b4xppIsKnownType(programInfo, typeName) {
  const t = String(typeName || '').replace(/\(\)$/, '').trim().toLowerCase();
  if (!t) return true;
  if (B4XPP_BUILTIN_TYPES.has(t)) return true;
  if (programInfo.classes.has(t) || programInfo.interfaces.has(t) || programInfo.staticCodes.has(t)) return true;
  if (programInfo.libraryIndex && programInfo.libraryIndex.types && programInfo.libraryIndex.types.has(t)) return true;
  return false;
}

function b4xppIsNumericType(typeName) {
  return ['int','long','float','double'].includes(String(typeName || '').toLowerCase());
}

function b4xppTypesCompatible(programInfo, valueType, targetType) {
  const value = normalizeB4XType(valueType).toLowerCase();
  const target = normalizeB4XType(targetType).toLowerCase();
  if (!value || !target || target === 'object' || value === 'object') return true;
  if (value === target) return true;
  if ((['sub','closure','b4xpp_closure'].includes(value)) && (['sub','closure','b4xpp_closure'].includes(target))) return true;
  if (b4xppIsNumericType(value) && b4xppIsNumericType(target)) return true;
  if (programInfo.isAssignableTo && programInfo.isAssignableTo(valueType, targetType)) return true;
  return false;
}

function b4xppLineWithoutStringsAndComments(line) {
  const parts = splitCodeAndComment(String(line || ''));
  return splitB4XStringSegments(parts.code).map(seg => seg.inString ? '""' : seg.text).join('');
}

function b4xppCollectClassSymbols(programInfo, className) {
  const symbols = new Map();
  if (!className) return symbols;
  const chain = [programInfo.getClass(className)].concat(programInfo.ancestorChain(className)).filter(Boolean);
  for (const cls of chain) {
    for (const line of cls.lines || []) {
      const prop = parsePropertyDirective(line);
      if (prop) {
        symbols.set(prop.name.toLowerCase(), { kind: 'property', name: prop.name, type: prop.type, symbol: prop, owner: cls });
        symbols.set(('get' + prop.name).toLowerCase(), { kind: 'method', name: 'get' + prop.name, type: prop.type, method: { name: 'get' + prop.name, params: [], returnType: prop.type }, owner: cls });
        if (String(prop.mode || '').toLowerCase() !== 'readonly') symbols.set(('set' + prop.name).toLowerCase(), { kind: 'method', name: 'set' + prop.name, type: '', method: { name: 'set' + prop.name, params: [{ name: 'Value', type: prop.type }], returnType: '' }, owner: cls });
      }
      const accessor = parsePropertyAccessorSignatureLine(line);
      if (accessor) symbols.set(accessor.propertyName.toLowerCase(), { kind: 'property', name: accessor.propertyName, type: accessor.returnType || (accessor.params[0] && accessor.params[0].type) || 'Object', symbol: accessor, owner: cls });
      const field = String(line || '').match(/^\s*(?:Public|Private|Protected)?\s*([A-Za-z_][A-Za-z0-9_]*)\s+As\s+((?:Poly\s+)?[A-Za-z_][A-Za-z0-9_\.]*)(?:\s*=.*)?$/i);
      if (field && !symbols.has(field[1].toLowerCase())) symbols.set(field[1].toLowerCase(), { kind: 'field', name: field[1], type: field[2].replace(/^Poly\s+/i, 'Object'), owner: cls });
    }
    for (const m of cls.methods || []) {
      if (!symbols.has(m.name.toLowerCase())) symbols.set(m.name.toLowerCase(), { kind: 'method', name: m.name, type: m.returnType || '', method: m, owner: cls });
    }
  }
  return symbols;
}

function b4xppFindMethod(programInfo, ownerType, methodName) {
  const owner = String(ownerType || '').replace(/\(\)$/, '').trim();
  const methodKey = String(methodName || '').toLowerCase();
  if (!owner || !methodKey) return null;
  const clsMethod = programInfo.findClassMethod && programInfo.findClassMethod(owner, methodName);
  if (clsMethod) return { owner: clsMethod.cls, method: clsMethod.method };
  const mod = programInfo.staticCodes.get(owner.toLowerCase());
  if (mod) {
    const method = (mod.methods || []).find(m => m.name.toLowerCase() === methodKey);
    if (method) return { owner: mod, method };
  }
  const intf = programInfo.interfaces.get(owner.toLowerCase());
  if (intf) {
    const method = (intf.methods || []).find(m => m.name.toLowerCase() === methodKey);
    if (method) return { owner: intf, method };
  }
  const builtins = B4XPP_BUILTIN_MEMBERS.get(owner.toLowerCase());
  if (builtins) {
    const method = builtins.find(m => m.name.toLowerCase() === methodKey);
    if (method) return { owner: { name: owner }, method };
  }
  const libType = programInfo.libraryIndex && programInfo.libraryIndex.types && programInfo.libraryIndex.types.get(owner.toLowerCase());
  if (libType) {
    const method = (libType.methods || []).find(m => m.name.toLowerCase() === methodKey);
    if (method) return { owner: { name: libType.shortName || owner }, method };
  }
  const ownerCls = programInfo.getClass && programInfo.getClass(owner);
  if (ownerCls && /^get[A-Z_]/.test(methodName)) {
    const propName = methodName.slice(3);
    const prop = getVisiblePropertyInfo(programInfo, owner, propName);
    if (prop && prop.property && String(prop.property.mode || '').toLowerCase() !== 'writeonly') return { owner: ownerCls, method: { name: methodName, params: [], returnType: prop.property.type || 'Object' } };
  }
  if (ownerCls && /^set[A-Z_]/.test(methodName)) {
    const propName = methodName.slice(3);
    const prop = getVisiblePropertyInfo(programInfo, owner, propName);
    if (prop && prop.property && String(prop.property.mode || '').toLowerCase() !== 'readonly') return { owner: ownerCls, method: { name: methodName, params: [{ name: 'Value', type: prop.property.type || 'Object' }], returnType: '' } };
  }
  return null;
}

function b4xppMethodOverloads(programInfo, ownerType, methodName) {
  const found = b4xppFindMethod(programInfo, ownerType, methodName);
  if (!found) return [];
  const owner = found.owner;
  const key = String(methodName || '').toLowerCase();
  if (owner && owner.methodOverloads && owner.methodOverloads.get(key)) return owner.methodOverloads.get(key);
  if (owner && owner.methods && Array.isArray(owner.methods)) {
    const matching = owner.methods.filter(m => m.name && m.name.toLowerCase() === key);
    return matching.length ? matching : [found.method];
  }
  return [found.method];
}

function b4xppInferExpressionType(expr, env) {
  const e = String(expr || '').trim();
  if (!e) return '';
  if (/^"(?:[^"]|"")*"$/s.test(e)) return 'String';
  if (/^(True|False)$/i.test(e)) return 'Boolean';
  if (/^Null$/i.test(e)) return 'Object';
  if (/^Sub\s*\(/i.test(e)) return 'Sub';
  if (/^-?\d+$/i.test(e)) return 'Int';
  if (/^-?\d+(?:\.\d+)?(?:dip)?$/i.test(e)) return 'Float';
  if (/\&/.test(e)) return 'String';
  const directCall = e.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\((.*)\))?$/);
  if (directCall) {
    const name = directCall[1].toLowerCase();
    const sym = env.lookup(name);
    if (sym) return sym.type || (sym.method && sym.method.returnType) || '';
  }
  const receiverCall = e.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(.*\))?$/);
  if (receiverCall) {
    const rtype = env.resolveReceiverType(receiverCall[1]);
    const found = b4xppFindMethod(env.programInfo, rtype || receiverCall[1], receiverCall[2]);
    if (found) return found.method.returnType || found.method.type || '';
  }
  if (/[+\-*\/]/.test(e)) return 'Float';
  return '';
}

function b4xppParseArgs(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  try { return splitArguments(text); } catch { return text.split(',').map(x => x.trim()).filter(Boolean); }
}

function b4xppValidateTypeName(typeName, sourcePath, lineNo, diagnostics, programInfo, options) {
  const t = String(typeName || '').trim().replace(/^Poly\s+/i, '').replace(/\(\)$/, '');
  if (!t || b4xppIsKnownType(programInfo, t)) return;
  const severity = options && options.validationStrict ? 'error' : 'warning';
  diagnostics.push(makeDiagnostic(sourcePath, lineNo, severity, `Unknown type '${t}'. Add a #ProjectDependsOn/#ProjectB4JDependsOn or #B4XLibDependsOn/#B4XLibB4JDependsOn library metadata path (.xml or .b4xlib) or declare the class/interface in B4X++.`));
}

function b4xppBuildMethodEnv(programInfo, block, methodInfo) {
  const classSymbols = block && block.kind === 'class' ? b4xppCollectClassSymbols(programInfo, block.name) : new Map();
  const localSymbols = new Map();
  for (const p of methodInfo.params || []) if (p && p.name) localSymbols.set(p.name.toLowerCase(), { kind: 'param', name: p.name, type: p.type || 'Object' });
  const env = {
    programInfo,
    block,
    methodInfo,
    locals: localSymbols,
    lookup(lowerName) {
      const k = String(lowerName || '').toLowerCase();
      return localSymbols.get(k) || classSymbols.get(k) || (block && block.globalSymbols && block.globalSymbols.get(k)) || null;
    },
    resolveReceiverType(name) {
      const key = String(name || '').toLowerCase();
      const sym = localSymbols.get(key) || classSymbols.get(key);
      if (sym && sym.type) return sym.type;
      if (programInfo.classes.has(key) || programInfo.staticCodes.has(key) || programInfo.interfaces.has(key)) return name;
      if (programInfo.libraryIndex && programInfo.libraryIndex.types && programInfo.libraryIndex.types.has(key)) return name;
      if (B4XPP_BUILTIN_TYPES.has(key)) return name;
      return '';
    }
  };
  return env;
}

function b4xppIsDeclarationLine(code) {
  return /^\s*(?:Public|Private|Protected|Dim)\s+/i.test(code) || /^\s*(?:#|Sub\b|End\b|Next\b|Else\b|Case\b|Select\b|For\b|Do\b|Loop\b)/i.test(code);
}

function b4xppValidateIdentifiers(code, env, sourcePath, lineNo, diagnostics, options) {
  if (!options || options.validationStrict !== true) return;
  const stripped = b4xppLineWithoutStringsAndComments(code);
  const skip = new Set([...B4X_RESERVED_WORDS, ...B4XPP_BUILTIN_VALUES, 'and','or','mod','not','true','false','null','as','then','else','if','return','dim','for','to','next','public','private','protected','sub','end','super','this','me']);
  const declaredHere = new Set();
  const decl = stripped.match(/\b(?:Dim|Private|Public|Protected)\s+([A-Za-z_][A-Za-z0-9_]*)\s+As\b/i);
  if (decl) declaredHere.add(decl[1].toLowerCase());
  let m;
  const seen = new Set();
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
  while ((m = re.exec(stripped))) {
    const word = m[1]; const lower = word.toLowerCase();
    if (seen.has(`${lower}:${m.index}`)) continue;
    seen.add(`${lower}:${m.index}`);
    if (skip.has(lower) || declaredHere.has(lower)) continue;
    const before = m.index > 0 ? stripped[m.index - 1] : '';
    const after = stripped.slice(m.index + word.length);
    if (before === '.') continue; // member name, receiver validation handles this
    if (/^\s*\(/.test(after) && (B4XPP_BUILTIN_VALUES.has(lower) || env.lookup(lower))) continue;
    if (/^\s+As\b/i.test(after)) continue;
    if (env.lookup(lower)) continue;
    if (env.resolveReceiverType(word)) continue;
    // Method call without parentheses or direct bare method/property.
    if (env.block && env.block.kind === 'class' && programInfoSafeFindClassMethod(env.programInfo, env.block.name, word)) continue;
    const near = b4xppSuggestIdentifier(lower, env);
    diagnostics.push(makeDiagnostic(sourcePath, lineNo, 'error', `Unknown identifier '${word}'.${near ? ` Did you mean '${near}'?` : ''}`));
  }
}

function programInfoSafeFindClassMethod(programInfo, className, methodName) {
  try { return programInfo && programInfo.findClassMethod && programInfo.findClassMethod(className, methodName); } catch { return null; }
}

function b4xppSuggestIdentifier(lower, env) {
  const names = new Set();
  for (const k of env.locals.keys()) names.add(env.locals.get(k).name || k);
  if (env.block && env.block.kind === 'class') {
    const syms = b4xppCollectClassSymbols(env.programInfo, env.block.name);
    for (const k of syms.keys()) names.add(syms.get(k).name || k);
  }
  let best = ''; let bestScore = 99;
  for (const name of names) {
    const score = levenshtein(lower, String(name).toLowerCase());
    if (score < bestScore) { bestScore = score; best = name; }
  }
  return bestScore <= 2 ? best : '';
}

function levenshtein(a, b) {
  a = String(a || ''); b = String(b || '');
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return dp[a.length][b.length];
}

function b4xppSemanticSeverity(options) { return options && options.validationStrict === true ? 'error' : 'warning'; }

function findMatchingParen(text, openIndex) {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < String(text || '').length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inString && text[i + 1] === '"') { i++; continue; }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function b4xppValidateMethodCalls(code, env, sourcePath, lineNo, diagnostics, options) {
  const clean = splitCodeAndComment(String(code || '')).code;
  const callRe = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m;
  while ((m = callRe.exec(clean))) {
    const receiver = m[1];
    const member = m[2];
    if (m.index > 0 && clean[m.index - 1] === '(') continue; // avoid false positives inside wrapper calls such as Log(obj.Method(...)) in this first validation core
    const openIndex = callRe.lastIndex - 1;
    const closeIndex = findMatchingParen(clean, openIndex);
    if (closeIndex < 0) continue;
    const args = b4xppParseArgs(clean.slice(openIndex + 1, closeIndex));
    callRe.lastIndex = openIndex + 1;
    const receiverType = env.resolveReceiverType(receiver) || receiver;
    const overloads = b4xppMethodOverloads(env.programInfo, receiverType, member);
    if (!overloads.length) {
      if (options && options.validationStrict && (env.resolveReceiverType(receiver) || b4xppIsKnownType(env.programInfo, receiver))) diagnostics.push(makeDiagnostic(sourcePath, lineNo, b4xppSemanticSeverity(options), `Unknown member '${member}' on '${receiver}'.`));
      continue;
    }
    if (!overloads.some(method => !method.params || method.params.length === args.length || typeof method.params === 'undefined')) {
      diagnostics.push(makeDiagnostic(sourcePath, lineNo, b4xppSemanticSeverity(options), `Wrong argument count for ${receiver}.${member}: expected ${overloads.map(o => (o.params || []).length).join(' or ')}, found ${args.length}.`));
      continue;
    }
    const match = overloads.find(method => (method.params || []).length === args.length) || overloads[0];
    for (let i = 0; i < Math.min(args.length, (match.params || []).length); i++) {
      const expected = (match.params[i] && match.params[i].type) || '';
      const found = b4xppInferExpressionType(args[i], env);
      if (expected && found && !b4xppTypesCompatible(env.programInfo, found, expected)) diagnostics.push(makeDiagnostic(sourcePath, lineNo, b4xppSemanticSeverity(options), `Argument ${i + 1} of ${receiver}.${member} expects ${expected}, found ${found}.`));
    }
  }
}

function b4xppValidateLineSemantics(rawLine, env, sourcePath, lineNo, diagnostics, programInfo, options) {
  const code = splitCodeAndComment(String(rawLine || '')).code;
  const closureStart = parseClosureLiteralStart(code);
  if (closureStart) {
    env.locals.set(closureStart.varName.toLowerCase(), { kind: 'local', name: closureStart.varName, type: 'Sub' });
    for (const p of closureStart.params || []) b4xppValidateTypeName(p.type || 'Object', sourcePath, lineNo, diagnostics, programInfo, options);
    if (closureStart.returnType) b4xppValidateTypeName(closureStart.returnType, sourcePath, lineNo, diagnostics, programInfo, options);
    return;
  }
  const fieldOrLocal = code.match(/^\s*(?:Dim|Private|Public|Protected)\s+([A-Za-z_][A-Za-z0-9_]*)\s+As\s+((?:Poly\s+)?[A-Za-z_][A-Za-z0-9_\.]*)(?:\s*=\s*(.+))?/i);
  if (fieldOrLocal) {
    const name = fieldOrLocal[1]; const type = fieldOrLocal[2].replace(/^Poly\s+/i, ''); const expr = fieldOrLocal[3] || '';
    b4xppValidateTypeName(type, sourcePath, lineNo, diagnostics, programInfo, options);
    env.locals.set(name.toLowerCase(), { kind: 'local', name, type });
    if (expr) {
      const found = b4xppInferExpressionType(expr, env);
      if (found && !b4xppTypesCompatible(programInfo, found, type)) diagnostics.push(makeDiagnostic(sourcePath, lineNo, b4xppSemanticSeverity(options), `Cannot assign ${found} to ${type} variable '${name}'.`));
    }
  }
  const forVar = code.match(/^\s*For\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/i);
  if (forVar && !env.locals.has(forVar[1].toLowerCase())) env.locals.set(forVar[1].toLowerCase(), { kind: 'local', name: forVar[1], type: 'Int' });

  const assignmentPatterns = [
    /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/,
    /^\s*(?:Else\s+)?If\b.+?\bThen\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/i
  ];
  for (const re of assignmentPatterns) {
    const m = code.match(re);
    if (!m) continue;
    const name = m[1]; const expr = m[2]; const sym = env.lookup(name.toLowerCase());
    if (!sym) {
      if (options && options.validationStrict) diagnostics.push(makeDiagnostic(sourcePath, lineNo, 'error', `Assignment to unknown identifier '${name}'.`));
      continue;
    }
    const found = b4xppInferExpressionType(expr, env);
    if (found && sym.type && !b4xppTypesCompatible(programInfo, found, sym.type)) diagnostics.push(makeDiagnostic(sourcePath, lineNo, b4xppSemanticSeverity(options), `Cannot assign ${found} to ${sym.type} '${name}'.`));
  }

  const ifCond = code.match(/^\s*(?:Else\s+)?If\s+(.+?)\s+Then\b/i);
  if (ifCond) {
    const found = b4xppInferExpressionType(ifCond[1], env);
    if (found && found.toLowerCase() !== 'boolean' && !/\b(?:=|<|>|<=|>=|<>|And|Or|Not)\b/i.test(ifCond[1])) diagnostics.push(makeDiagnostic(sourcePath, lineNo, b4xppSemanticSeverity(options), `If condition should be Boolean. Found ${found}.`));
  }
  b4xppValidateMethodCalls(code, env, sourcePath, lineNo, diagnostics, options);
  b4xppValidateIdentifiers(code, env, sourcePath, lineNo, diagnostics, options);
}

function parseB4XPPMethodStartForValidation(rawLine, lineIndex, block) {
  const code = splitCodeAndComment(String(rawLine || '')).code;
  const ctor = code.match(/^\s*#Constructor\s*(?:\(([^)]*)\))?/i);
  if (ctor) {
    const parsedCtor = parseConstructorSignatureLine(code);
    return { ...(parsedCtor || { name: 'Initialize', params: [], returnType: '' }), lineIndex, ownerName: block && block.name };
  }
  return parseMethodSignatureLine(code, lineIndex) || parsePropertyAccessorSignatureLine(code);
}

function collectTopLevelProcessGlobals(lines) {
  const globals = new Map();
  let inGlobals = false;
  for (const raw of lines || []) {
    if (/^\s*Sub\s+Process_Globals\b/i.test(String(raw || ''))) { inGlobals = true; continue; }
    if (inGlobals && /^\s*End\s+Sub\b/i.test(String(raw || ''))) { inGlobals = false; continue; }
    if (!inGlobals) continue;
    const m = String(raw || '').match(/^\s*(?:Private|Public|Protected)?\s*([A-Za-z_][A-Za-z0-9_]*)\s+As\s+([A-Za-z_][A-Za-z0-9_\.]*)(?:\s*=.*)?$/i);
    if (m) globals.set(m[1].toLowerCase(), { kind: 'global', name: m[1], type: m[2] });
  }
  return globals;
}

function validateStrictSemanticProgram(parsedFiles, programInfo, diagnostics, options = {}) {
  if (!options || options.enableSemanticDiagnostics === false) return;
  const project = (programInfo.projects && programInfo.projects[0]) || null;
  programInfo.libraryIndex = buildB4XLibraryIndex(options, programInfo, diagnostics);
  const blocks = [];
  for (const parsed of parsedFiles || []) {
    for (const cls of parsed.classes || []) blocks.push({ ...cls, kind: 'class' });
    for (const mod of parsed.staticCodes || []) blocks.push({ ...mod, kind: 'static' });
    if (parsed.topLevelLines && parsed.topLevelLines.some(l => String(l || '').trim())) blocks.push({ name: parsed.mainModuleName || 'Main', kind: 'main', lines: parsed.topLevelLines, sourcePath: parsed.sourcePath, startLine: 1, methods: [], globalSymbols: collectTopLevelProcessGlobals(parsed.topLevelLines) });
  }
  for (const block of blocks) {
    let method = null;
    let env = null;
    let closureValidationSkip = false;
    for (let i = 0; i < (block.lines || []).length; i++) {
      const raw = block.lines[i];
      if (closureValidationSkip) {
        if (/^\s*End\s+Sub\s*$/i.test(String(raw || ''))) closureValidationSkip = false;
        continue;
      }
      const sourceLine = (block.startLine || 1) + i;
      const methodStart = parseB4XPPMethodStartForValidation(raw, i, block);
      if (methodStart) {
        method = methodStart;
        for (const p of method.params || []) b4xppValidateTypeName(p.type, block.sourcePath, sourceLine, diagnostics, programInfo, options);
        if (method.returnType) b4xppValidateTypeName(method.returnType, block.sourcePath, sourceLine, diagnostics, programInfo, options);
        env = b4xppBuildMethodEnv(programInfo, block, method);
        continue;
      }
      if (/^\s*(?:#End\s+Constructor|End\s+Sub|End\s+Get|End\s+Set)\b/i.test(String(raw || ''))) { method = null; env = null; continue; }
      if (!method || !env) continue;
      if (parseClosureLiteralStart(raw)) {
        b4xppValidateLineSemantics(raw, env, block.sourcePath, sourceLine, diagnostics, programInfo, options);
        closureValidationSkip = true;
        continue;
      }
      b4xppValidateLineSemantics(raw, env, block.sourcePath, sourceLine, diagnostics, programInfo, options);
    }
  }
}

function validateProgram(parsedFiles, programInfo, diagnostics) {
  for (const cls of programInfo.classes.values()) {
    if (cls.extendsName && !programInfo.getClass(cls.extendsName)) {
      diagnostics.push(makeDiagnostic(cls.sourcePath, cls.startLine, 'error', `Parent class not found: ${cls.extendsName} (used by ${cls.name}).`));
    }

    const seenAncestors = new Set();
    let current = cls;
    while (current && current.extendsName) {
      const parentKey = current.extendsName.toLowerCase();
      if (seenAncestors.has(parentKey)) {
        diagnostics.push(makeDiagnostic(cls.sourcePath, cls.startLine, 'error', `Circular inheritance detected around ${cls.name}.`));
        break;
      }
      seenAncestors.add(parentKey);
      current = programInfo.getClass(current.extendsName);
    }

    for (const ancestor of programInfo.ancestorChain(cls.name)) {
      if ((ancestor.modifiers || []).includes('final')) {
        diagnostics.push(makeDiagnostic(cls.sourcePath, cls.startLine, 'error', `Invalid inheritance: ${cls.name} extends final class ${ancestor.name}.`));
      }
    }

    const implementsNames = Array.from(new Set((cls.implementsNames || []).map(s => String(s || '').trim()).filter(Boolean)));
    for (const intfName of implementsNames) {
      const intf = programInfo.getInterface(intfName);
      if (!intf) {
        diagnostics.push(makeDiagnostic(cls.sourcePath, cls.startLine, 'warning', `Interface not found: ${cls.name} #Implements ${intfName}. It will be kept as B4X++ metadata only.`));
        continue;
      }
      for (const required of intf.methods) {
        if (!programInfo.findClassMethod(cls.name, required.name)) {
          diagnostics.push(makeDiagnostic(cls.sourcePath, cls.startLine, 'error', `Interface contract not implemented: ${cls.name} is missing ${intf.name}.${required.name}.`));
        }
      }
    }

    for (const method of cls.methods) {
      if (method.visibility === 'private' && method.modifiers.some(m => ['override', 'virtual', 'abstract'].includes(m))) {
        diagnostics.push(makeDiagnostic(cls.sourcePath, cls.startLine + method.lineIndex, 'error', `Invalid visibility: ${cls.name}.${method.name} cannot be Private and ${method.modifiers.join('/')} at the same time.`));
      }
      if (!method.modifiers.includes('override')) continue;
      const parent = programInfo.findAncestorMethod(cls.name, method.name);
      if (!parent) {
        diagnostics.push(makeDiagnostic(cls.sourcePath, cls.startLine + method.lineIndex, 'error', `Invalid override: ${cls.name}.${method.name} does not match any parent method.`));
        continue;
      }
      if (parent.method.visibility === 'private') {
        diagnostics.push(makeDiagnostic(cls.sourcePath, cls.startLine + method.lineIndex, 'error', `Invalid override: ${parent.cls.name}.${parent.method.name} is Private.`));
      }
      if (parent.method.modifiers.includes('final')) {
        diagnostics.push(makeDiagnostic(cls.sourcePath, cls.startLine + method.lineIndex, 'error', `Invalid override: ${parent.cls.name}.${parent.method.name} is Final.`));
      }
      if (!(parent.method.modifiers.includes('virtual') || parent.method.modifiers.includes('abstract') || parent.method.modifiers.includes('override'))) {
        diagnostics.push(makeDiagnostic(cls.sourcePath, cls.startLine + method.lineIndex, 'warning', `Override on ${cls.name}.${method.name}: the parent method exists but is not marked Virtual/Abstract/Override.`));
      }
      if (parent.method.params.length !== method.params.length) {
        diagnostics.push(makeDiagnostic(cls.sourcePath, cls.startLine + method.lineIndex, 'warning', `Override signature mismatch: ${cls.name}.${method.name} has ${method.params.length} parameter(s), parent ${parent.cls.name}.${parent.method.name} has ${parent.method.params.length}.`));
      }
      if ((parent.method.returnType || '').toLowerCase() !== (method.returnType || '').toLowerCase()) {
        diagnostics.push(makeDiagnostic(cls.sourcePath, cls.startLine + method.lineIndex, 'warning', `Override return type mismatch for ${cls.name}.${method.name}.`));
      }
    }
  }

  const projectDirectives = programInfo.projects || [];
  if (projectDirectives.length > 1) {
    for (let i = 1; i < projectDirectives.length; i++) {
      diagnostics.push(makeDiagnostic(projectDirectives[i].sourcePath, projectDirectives[i].line || 1, 'warning', 'Multiple #Project directives found. The first one will be used.'));
    }
  }


  validateMemberVisibilityAccess(parsedFiles, programInfo, diagnostics);
  warnUnsafeDesignerColorReads(parsedFiles, diagnostics);
}

function effectiveVisibility(member) {
  return (member && member.visibility ? member.visibility : 'public').toLowerCase();
}

function canAccessMember(programInfo, currentClassName, ownerClassName, visibility) {
  const vis = String(visibility || 'public').toLowerCase();
  if (vis === 'public') return true;
  const current = String(currentClassName || '').trim();
  const owner = String(ownerClassName || '').trim();
  if (!current || !owner) return false;
  if (current.toLowerCase() === owner.toLowerCase()) return true;
  if (vis === 'protected') {
    return !!(programInfo && programInfo.isDescendantOf(current, owner));
  }
  return false;
}

function collectVisibleVariableTypes(lines) {
  const vars = new Map();
  for (const line of lines || []) {
    const poly = parsePolyDeclaration(line);
    if (poly) {
      vars.set(poly.varName.toLowerCase(), { name: poly.varName, typeName: poly.baseType });
      continue;
    }
    const decl = parseRegularDeclaration(line);
    if (decl) vars.set(decl.varName.toLowerCase(), { name: decl.varName, typeName: decl.typeName });
  }
  return vars;
}

function extractMemberAccesses(line) {
  const parts = splitCodeAndComment(line);
  const code = parts.code || '';
  const out = [];
  let inString = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') {
      if (inString && code[i + 1] === '"') { i++; continue; }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (!/[A-Za-z_]/.test(ch)) continue;
    let objStart = i;
    let j = i + 1;
    while (j < code.length && /[A-Za-z0-9_]/.test(code[j])) j++;
    const objectName = code.slice(objStart, j);
    let k = j;
    while (k < code.length && /\s/.test(code[k])) k++;
    if (code[k] !== '.') { i = j - 1; continue; }
    k++;
    while (k < code.length && /\s/.test(code[k])) k++;
    if (!/[A-Za-z_]/.test(code[k] || '')) { i = k; continue; }
    const memberStart = k;
    k++;
    while (k < code.length && /[A-Za-z0-9_]/.test(code[k])) k++;
    const memberName = code.slice(memberStart, k);
    out.push({ objectName, memberName, column: objStart + 1 });
    i = k - 1;
  }
  return out;
}

function validateVisibilityInLines(lines, context, programInfo, diagnostics) {
  const vars = collectVisibleVariableTypes(lines);
  const warned = new Set();
  for (let i = 0; i < (lines || []).length; i++) {
    const line = lines[i] || '';
    const accesses = extractMemberAccesses(line);
    if (!accesses.length) continue;
    for (const access of accesses) {
      const varInfo = vars.get(String(access.objectName || '').toLowerCase());
      if (!varInfo) continue;
      const typeName = varInfo.typeName;
      if (!programInfo.getClass(typeName)) continue;
      const found = programInfo.findClassMethod(typeName, access.memberName);
      if (!found || !found.method || !found.cls) continue;
      const visibility = effectiveVisibility(found.method);
      if (canAccessMember(programInfo, context.className, found.cls.name, visibility)) continue;
      const key = `${context.sourcePath}:${context.startLine + i}:${access.objectName}.${access.memberName}:${found.cls.name}`.toLowerCase();
      if (warned.has(key)) continue;
      warned.add(key);
      diagnostics.push(makeDiagnostic(
        context.sourcePath,
        context.startLine + i,
        'error',
        `Member is not accessible: ${found.cls.name}.${found.method.name} is ${visibility}. ${context.className ? `Current class: ${context.className}.` : 'Current scope: main module / outside class.'}`
      ));
    }
  }
}

function validateMemberVisibilityAccess(parsedFiles, programInfo, diagnostics) {
  for (const parsed of parsedFiles || []) {
    if (hasMeaningfulCode(parsed.topLevelLines || [])) {
      validateVisibilityInLines(parsed.topLevelLines || [], {
        sourcePath: parsed.sourcePath,
        startLine: 1,
        className: null
      }, programInfo, diagnostics);
    }
    for (const cls of parsed.classes || []) {
      const bundle = classLineBundle(cls, []);
      validateVisibilityInLines(bundle.lines || [], {
        sourcePath: cls.sourcePath,
        startLine: cls.startLine,
        className: cls.name
      }, programInfo, diagnostics);
    }
    for (const mod of parsed.staticCodes || []) {
      validateVisibilityInLines(mod.lines || [], {
        sourcePath: mod.sourcePath,
        startLine: mod.startLine,
        className: null
      }, programInfo, diagnostics);
    }
  }
}

function warnUnsafeDesignerColorReads(parsedFiles, diagnostics) {
  for (const parsed of parsedFiles || []) {
    const blocks = [...(parsed.classes || []), ...(parsed.staticCodes || [])];
    for (const block of blocks) {
      const colorKeys = new Set();
      for (const line of block.lines || []) {
        const m = String(line || '').match(/^\s*#DesignerProperty\s*:\s*Key\s*:\s*([^,]+),.*?FieldType\s*:\s*Color/i);
        if (m) colorKeys.add(m[1].trim().toLowerCase());
      }
      if (colorKeys.size === 0) continue;
      const alreadyWarned = new Set();
      for (let i = 0; i < (block.lines || []).length; i++) {
        const line = String(block.lines[i] || '');
        const getMatch = line.match(/Props\.Get(?:Default)?\(\s*["']([^"']+)["']/i);
        if (!getMatch) continue;
        const key = getMatch[1].trim().toLowerCase();
        if (!colorKeys.has(key)) continue;
        if (/PaintOrColorToColor\s*\(/i.test(line)) continue;
        if (alreadyWarned.has(key)) continue;
        alreadyWarned.add(key);
        diagnostics.push(makeDiagnostic(
          block.sourcePath,
          block.startLine + i,
          'warning',
          `Designer color property "${getMatch[1]}" must be read defensively. XUI Views commonly use xui.PaintOrColorToColor(Props.Get...), but B4J .b4xlib custom views can pass strings such as 0xffffffff; use PaintOrColorToColor or a helper that also parses string colors.`
        ));
      }
    }
  }
}

function getVisiblePropertyInfo(programInfo, className, propertyName) {
  if (!programInfo || !className || !propertyName) return null;
  const target = String(propertyName || '').toLowerCase();
  const chain = [programInfo.getClass(className)].concat(programInfo.ancestorChain(className)).filter(Boolean);
  for (const cls of chain) {
    for (const line of cls.lines || []) {
      const prop = parsePropertyDirective(line);
      if (prop && prop.name.toLowerCase() === target) return { owner: cls, property: prop };
    }
    for (const line of cls.lines || []) {
      const accessor = parsePropertyAccessorSignatureLine(line);
      if (accessor && accessor.propertyName.toLowerCase() === target) {
        return { owner: cls, property: { name: accessor.propertyName, type: accessor.returnType || (accessor.params[0] && accessor.params[0].type) || 'Object', mode: accessor.accessorKind === 'get' ? 'readonly' : 'writeonly', visibility: accessor.visibility || 'public' } };
      }
    }
  }
  return null;
}

function resolveWritablePropertyAssignment(propName, expression, context) {
  if (context && context.isPropertyAccessor && context.localNames && context.localNames.has(String(propName || '').toLowerCase())) return null;
  const propertyInfo = getVisiblePropertyInfo(context.programInfo, context.className, propName);
  if (!propertyInfo || !propertyInfo.property) return null;
  if (String(propertyInfo.property.mode || '').toLowerCase() === 'readonly') {
    if (context.diagnostics) {
      context.diagnostics.push(makeDiagnostic(context.sourcePath, context.lineNo, 'error', `Cannot assign to readonly property ${propName}.`));
    }
    return null;
  }
  return `set${propertyInfo.property.name}(${String(expression || '').trim()})`;
}

function transformPropertyAssignmentLine(line, context) {
  if (!context || !context.className || !context.programInfo) return line;
  const parts = splitCodeAndComment(line);
  const code = parts.code;

  // Whole-line sugar: `Property = expression` -> `setProperty(expression)`.
  const match = code.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/);
  if (match) {
    const setterCall = resolveWritablePropertyAssignment(match[2], match[3], context);
    if (setterCall) return `${match[1]}${setterCall}${parts.comment}`;
  }

  // Inline B4X one-line If sugar: `If cond Then Property = expression`.
  // B4X allows a single statement after Then; without this pass B4J sees Property as an undeclared variable.
  const inlineThen = code.match(/^(\s*(?:Else\s+)?If\b.+?\bThen\s+)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/i);
  if (inlineThen) {
    const setterCall = resolveWritablePropertyAssignment(inlineThen[2], inlineThen[3], context);
    if (setterCall) return `${inlineThen[1]}${setterCall}${parts.comment}`;
  }

  return line;
}

function collectClassPropertyNames(programInfo, className) {
  const out = new Set();
  if (!programInfo || !className) return out;
  const chain = [programInfo.getClass(className)].concat(programInfo.ancestorChain(className)).filter(Boolean);
  for (const cls of chain) {
    for (const line of cls.lines || []) {
      const prop = parsePropertyDirective(line);
      if (prop) out.add(prop.name.toLowerCase());
      const accessor = parsePropertyAccessorSignatureLine(line);
      if (accessor) out.add(accessor.propertyName.toLowerCase());
    }
  }
  return out;
}

function collectVisiblePropertyInfoMap(programInfo, className) {
  const out = new Map();
  if (!programInfo || !className) return out;
  const chain = [programInfo.getClass(className)].concat(programInfo.ancestorChain(className)).filter(Boolean);
  for (const cls of chain) {
    for (const line of cls.lines || []) {
      const prop = parsePropertyDirective(line);
      if (prop && !out.has(prop.name.toLowerCase())) out.set(prop.name.toLowerCase(), prop);
    }
    for (const line of cls.lines || []) {
      const accessor = parsePropertyAccessorSignatureLine(line);
      if (accessor && !out.has(accessor.propertyName.toLowerCase())) {
        out.set(accessor.propertyName.toLowerCase(), {
          name: accessor.propertyName,
          type: accessor.returnType || (accessor.params[0] && accessor.params[0].type) || 'Object',
          mode: accessor.accessorKind === 'get' ? 'readonly' : 'writeonly',
          visibility: accessor.visibility || 'public'
        });
      }
    }
  }
  return out;
}

function splitB4XStringSegments(code) {
  const out = [];
  let current = '';
  let inString = false;
  for (let i = 0; i < String(code || '').length; i++) {
    const ch = code[i];
    if (ch === '"') {
      current += ch;
      if (inString && code[i + 1] === '"') {
        current += code[i + 1];
        i++;
        continue;
      }
      out.push({ text: current, inString });
      current = '';
      inString = !inString;
      continue;
    }
    current += ch;
  }
  if (current) out.push({ text: current, inString });
  return out;
}

function isPropertyReadRewriteCandidate(code) {
  const trimmed = String(code || '').trim();
  if (!trimmed) return false;
  if (/^#/i.test(trimmed)) return false;
  if (/^(?:Public|Private|Protected)?\s*(?:Virtual\s+|Override\s+|Abstract\s+|Final\s+)*Sub\b/i.test(trimmed)) return false;
  if (/^End\s+Sub\b/i.test(trimmed)) return false;
  if (/^(?:Sub\s+)?Class_Globals\b/i.test(trimmed)) return false;
  if (/^(?:Public|Private|Protected)\s+[A-Za-z_][A-Za-z0-9_]*\s+As\b/i.test(trimmed)) return false;
  return true;
}

function rewritePropertyReadsInSegment(segment, propMap, context) {
  return String(segment || '').replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (word, offset, whole) => {
    const lower = word.toLowerCase();
    const prop = propMap.get(lower);
    if (!prop) return word;
    if (context && context.localNames && context.localNames.has(lower)) return word;

    const before = offset > 0 ? whole[offset - 1] : '';
    if (before === '.') return word; // Other.Property should stay a normal B4X member access.

    const after = whole.slice(offset + word.length);
    if (/^\s*=/.test(after)) return word; // Assignment LHS is handled by transformPropertyAssignmentLine.
    if (/^\s*\(/.test(after)) return word; // Explicit call / method name.
    if (/^(?:\s+As\b|\s*\))/i.test(after) && /(?:\bDim\s+|\bPrivate\s+|\bPublic\s+|\bProtected\s+)$/i.test(whole.slice(0, offset))) return word;

    const mode = String(prop.mode || '').toLowerCase();
    if (mode === 'writeonly') {
      if (context && context.diagnostics) {
        context.diagnostics.push(makeDiagnostic(context.sourcePath, context.lineNo, 'error', `Cannot read writeonly property ${prop.name}.`));
      }
      return word;
    }
    return `get${prop.name}`;
  });
}

function transformPropertyReadLine(line, context) {
  if (!context || !context.className || !context.programInfo) return line;
  const parts = splitCodeAndComment(line);
  const code = parts.code;
  if (!isPropertyReadRewriteCandidate(code)) return line;

  const propMap = collectVisiblePropertyInfoMap(context.programInfo, context.className);
  if (!propMap.size) return line;

  const segments = splitB4XStringSegments(code).map(seg => seg.inString ? seg.text : rewritePropertyReadsInSegment(seg.text, propMap, context)).join('');
  return segments + parts.comment;
}

function collectProgramTypeNames(programInfo) {
  const out = new Set();
  if (!programInfo) return out;
  for (const key of programInfo.classes.keys()) out.add(key);
  for (const key of programInfo.staticCodes.keys()) out.add(key);
  for (const key of programInfo.interfaces.keys()) out.add(key);
  return out;
}

function transformOopLine(rawLine, context) {
  let line = rawLine;
  const comments = [];

  const constructorStart = line.match(/^(\s*)#Constructor\s*(?:\((.*)\))?\s*$/i);
  if (constructorStart) {
    const params = (constructorStart[2] || '').trim();
    const generatedName = generatedConstructorNameForContext(context, params);
    return [`${constructorStart[1]}' B4X++ constructor: generated as ${generatedName}`, `${constructorStart[1]}Public Sub ${generatedName}${params ? '(' + params + ')' : ''}`];
  }
  const constructorEnd = line.match(/^(\s*)#End\s+Constructor\s*$/i);
  if (constructorEnd) {
    return [`${constructorEnd[1]}End Sub`];
  }

  const accessorEnd = line.match(/^(\s*)End\s+(Get|Set)\s*$/i);
  if (accessorEnd) {
    return [`${accessorEnd[1]}End Sub`];
  }

  const accessorSig = parsePropertyAccessorSignatureLine(line);
  if (accessorSig) {
    const indent = (String(line || '').match(/^\s*/) || [''])[0];
    const meta = `${accessorSig.visibility || 'public'} ${accessorSig.accessorKind} ${accessorSig.propertyName}`;
    const out = [`${indent}' B4X++ custom property accessor: ${meta}`];
    if (accessorSig.accessorKind === 'set' && accessorSig.params.length !== 1) {
      context.diagnostics.push(makeDiagnostic(context.sourcePath, context.lineNo, 'error', `Custom setter ${accessorSig.propertyName} must declare exactly one parameter.`));
    }
    if (accessorSig.accessorKind === 'get' && !accessorSig.returnType) {
      context.diagnostics.push(makeDiagnostic(context.sourcePath, context.lineNo, 'warning', `Custom getter ${accessorSig.propertyName} has no return type. Object will be used in generated B4X.`));
    }
    out.push(buildPropertyAccessorMethodLine(indent, accessorSig));
    return out;
  }

  const polyDecl = parsePolyDeclaration(line);
  if (polyDecl) {
    const baseType = polyDecl.baseType;
    context.polyVars.set(polyDecl.varName.toLowerCase(), { name: polyDecl.varName, baseType, explicit: true });
    if (context.programInfo && !context.programInfo.getClass(baseType) && !context.programInfo.getInterface(baseType)) {
      context.diagnostics.push(makeDiagnostic(context.sourcePath, context.lineNo, 'warning', `Unknown Poly type: ${baseType}. The variable will be generated As Object.`));
    }
    comments.push(`${polyDecl.indent}' B4X++ Poly<${baseType}>: generated As Object with dynamic dispatch.`);
    line = `${polyDecl.indent}${polyDecl.keyword} ${polyDecl.varName} As Object${polyDecl.tail || ''}`;
  } else {
    const implicitDecl = parseRegularDeclaration(line);
    if (implicitDecl && context.polyVars && context.polyVars.has(implicitDecl.varName.toLowerCase())) {
      const polyInfo = context.polyVars.get(implicitDecl.varName.toLowerCase());
      if (polyInfo && polyInfo.implicit) {
        comments.push(`${implicitDecl.indent}' B4X++ implicit polymorphism: ${implicitDecl.varName} As ${polyInfo.baseType} generated As Object with dynamic dispatch.`);
        line = `${implicitDecl.indent}${implicitDecl.keyword} ${implicitDecl.varName} As Object${implicitDecl.tail || ''}`;
      }
    }
  }

  if (/^\s*Protected\s+(?!.*\bSub\b)/i.test(line)) {
    // B4X++ visibility only: B4X itself has no Protected field modifier.
    line = line.replace(/^(\s*)Protected\s+/i, '$1Private ');
  }

  const methodSig = parseMethodSignatureLine(line);
  if (methodSig) {
    const indent = (String(line || '').match(/^\s*/) || [''])[0];
    const hasB4XPPModifier = methodSig.modifiers.length > 0 || methodSig.visibility === 'protected';
    const hasExplicitVisibility = !!methodSig.visibility;

    if (methodSig.visibility === 'private' && methodSig.modifiers.some(m => ['override', 'virtual', 'abstract'].includes(m))) {
      context.diagnostics.push(makeDiagnostic(context.sourcePath, context.lineNo, 'error', `Invalid declaration: ${methodSig.name} cannot be Private and ${methodSig.modifiers.join('/')} at the same time.`));
    }

    if (hasB4XPPModifier) {
      const meta = [];
      if (methodSig.visibility) meta.push(`visibility=${methodSig.visibility}`);
      if (methodSig.modifiers.length) meta.push(`modifiers=${methodSig.modifiers.join(', ')}`);
      comments.push(`${indent}' B4X++ ${meta.join('; ')}`);
    }

    if (methodSig.modifiers.includes('abstract')) {
      const abstractVisibility = methodSig.visibility === 'protected' ? 'Private' : 'Public';
      const generatedName = generatedMethodNameForContext(context, methodSig);
      const abstractLine = buildMethodSignatureLine(indent, abstractVisibility, generatedName, methodSig.paramsRaw, methodSig.returnType);
      return comments.concat(makeAbstractStubFromSignature(abstractLine, context));
    }

    if (hasB4XPPModifier || hasExplicitVisibility) {
      let outVisibility = methodSig.visibility || 'public';
      if (outVisibility === 'protected') outVisibility = 'private';
      const generatedName = generatedMethodNameForContext(context, methodSig);
      line = buildMethodSignatureLine(indent, outVisibility, generatedName, methodSig.paramsRaw, methodSig.returnType);
    } else {
      const generatedName = generatedMethodNameForContext(context, methodSig);
      if (generatedName && generatedName.toLowerCase() !== methodSig.name.toLowerCase()) {
        line = buildMethodSignatureLine(indent, methodSig.visibility || '', generatedName, methodSig.paramsRaw, methodSig.returnType);
      }
    }
  }


  if (/\bSuper\./i.test(line)) {
    if (context.extendsName) {
      if (context.flattenSuper && typeof context.resolveSuperMember === 'function') {
        line = replaceSuperMembers(line, context);
      } else {
        line = line.replace(/\bSuper\./g, 'b4xpp_super.').replace(/\bsuper\./g, 'b4xpp_super.');
      }
    } else {
      context.diagnostics.push(makeDiagnostic(context.sourcePath, context.lineNo, 'warning', 'Super was used in a class without #Extends.'));
    }
  }

  if (/\bThis\./i.test(line)) {
    line = line.replace(/\bThis\./g, '').replace(/\bthis\./g, '');
  }

  line = transformPropertyAssignmentLine(line, context);
  line = transformPropertyReadLine(line, context);
  line = transformPolyCalls(line, context);
  line = transformClosureCalls(line, context);
  line = rewriteOverloadCallSites(line, context);

  return comments.concat([line]);
}


function replaceSuperMembers(line, context) {
  const parts = splitCodeAndComment(line);
  let code = parts.code;
  code = code.replace(/\bSuper\.([A-Za-z_][A-Za-z0-9_]*)/g, (full, member, offset, whole) => {
    let i = offset + full.length;
    while (i < whole.length && /\s/.test(whole[i])) i++;
    const hasCall = whole[i] === '(';
    let arity = null;
    if (hasCall) {
      const parsed = readBalancedParentheses(whole, i);
      if (parsed) arity = splitArguments(parsed.inner).map(s => s.trim()).filter(Boolean).length;
    }
    return context.resolveSuperMember(member, hasCall, arity);
  });
  code = code.replace(/\bsuper\.([A-Za-z_][A-Za-z0-9_]*)/g, (full, member, offset, whole) => {
    let i = offset + full.length;
    while (i < whole.length && /\s/.test(whole[i])) i++;
    const hasCall = whole[i] === '(';
    let arity = null;
    if (hasCall) {
      const parsed = readBalancedParentheses(whole, i);
      if (parsed) arity = splitArguments(parsed.inner).map(s => s.trim()).filter(Boolean).length;
    }
    return context.resolveSuperMember(member, hasCall, arity);
  });
  return code + parts.comment;
}

function rewriteOverloadCallSites(line, context) {
  if (!context || !context.programInfo) return line;
  const parts = splitCodeAndComment(line);
  let code = parts.code;

  function replaceReceiverCalls(input) {
    let out = '';
    let cursor = 0;
    const re = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let m;
    while ((m = re.exec(input)) !== null) {
      const receiver = m[1];
      const method = m[2];
      const openIndex = m.index + m[0].lastIndexOf('(');
      const parsed = readBalancedParentheses(input, openIndex);
      if (!parsed) continue;
      const args = splitArguments(parsed.inner).map(s => s.trim()).filter(Boolean);
      let receiverType = '';
      const lowerReceiver = receiver.toLowerCase();
      if (context.localTypes && context.localTypes.has(lowerReceiver)) receiverType = context.localTypes.get(lowerReceiver).typeName;
      else if (context.programInfo.getClass(receiver) || context.programInfo.staticCodes && context.programInfo.staticCodes.get && context.programInfo.staticCodes.get(lowerReceiver)) receiverType = receiver;
      if (!receiverType) continue;
      const generated = resolveGeneratedOverloadName(context.programInfo, receiverType, method, args.length);
      if (!generated || generated.toLowerCase() === method.toLowerCase()) continue;
      out += input.slice(cursor, m.index) + `${receiver}.${generated}(`;
      cursor = openIndex + 1;
      re.lastIndex = openIndex + 1;
    }
    if (cursor === 0) return input;
    out += input.slice(cursor);
    return out;
  }

  function replaceOwnCalls(input) {
    if (!context.className) return input;
    const plan = getClassOverloadPlan(context.programInfo, context.className);
    if (!plan || !plan.methodsByNameArity || plan.methodsByNameArity.size === 0) return input;
    let out = '';
    let cursor = 0;
    const names = Array.from(plan.methodsByNameArity.keys()).map(escapeRegExp).join('|');
    if (!names) return input;
    const re = new RegExp(`(?<![\\.A-Za-z0-9_])(${names})\\s*\\(`, 'ig');
    let m;
    while ((m = re.exec(input)) !== null) {
      const method = m[1];
      const before = input.slice(Math.max(0, m.index - 8), m.index).toLowerCase();
      if (/\bsub\s*$/.test(before)) continue;
      const openIndex = m.index + m[0].lastIndexOf('(');
      const parsed = readBalancedParentheses(input, openIndex);
      if (!parsed) continue;
      const arity = splitArguments(parsed.inner).map(s => s.trim()).filter(Boolean).length;
      const generated = resolveGeneratedOverloadName(context.programInfo, context.className, method, arity);
      if (!generated || generated.toLowerCase() === method.toLowerCase()) continue;
      out += input.slice(cursor, m.index) + `${generated}(`;
      cursor = openIndex + 1;
      re.lastIndex = openIndex + 1;
    }
    if (cursor === 0) return input;
    out += input.slice(cursor);
    return out;
  }

  code = replaceReceiverCalls(code);
  code = replaceOwnCalls(code);
  return code + parts.comment;
}

function makeAbstractStubFromSignature(signatureLine, context) {
  const sig = parseMethodSignatureLine(signatureLine);
  const indent = (String(signatureLine || '').match(/^\s*/) || [''])[0];
  const name = sig ? sig.name : 'AbstractMethod';
  const lines = [signatureLine];
  lines.push(`${indent}    Log("B4X++ abstract method called: ${context.className || 'Unknown'}.${name}")`);
  if (sig && sig.returnType) lines.push(`${indent}    Return ${defaultReturnValue(sig.returnType)}`);
  lines.push(`${indent}End Sub`);
  return lines;
}


function defaultReturnValue(typeName) {
  const t = String(typeName || '').toLowerCase();
  if (['int', 'long', 'short', 'byte', 'float', 'double'].includes(t)) return '0';
  if (t === 'boolean') return 'False';
  if (t === 'string') return '""';
  return 'Null';
}

function parsePolyDeclaration(line) {
  const m = line.match(/^(\s*)(Dim|Private|Public)\s+([A-Za-z_][A-Za-z0-9_]*)\s+As\s+(?:Poly\s*<\s*([A-Za-z_][A-Za-z0-9_]*)\s*>|Poly\s+([A-Za-z_][A-Za-z0-9_]*))(.*)$/i);
  if (!m) return null;
  return {
    indent: m[1] || '',
    keyword: m[2],
    varName: m[3],
    baseType: m[4] || m[5],
    tail: m[6] || ''
  };
}

function parseRegularDeclaration(line) {
  const parts = splitCodeAndComment(line);
  const m = parts.code.match(/^(\s*)(Dim|Private|Public)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\(\))?\s+As\s+(?!Poly\b)([A-Za-z_][A-Za-z0-9_]*)(.*)$/i);
  if (!m) return null;
  return {
    indent: m[1] || '',
    keyword: m[2],
    varName: m[3],
    typeName: m[4],
    tail: (m[5] || '') + (parts.comment || '')
  };
}

function parseSimpleAssignment(line) {
  const parts = splitCodeAndComment(line);
  const m = parts.code.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\b/i);
  if (!m) return null;
  return { target: m[1], value: m[2] };
}

function analyzeImplicitPolyVars(lines, programInfo) {
  const result = new Map();
  if (!programInfo) return result;

  const declared = new Map();
  for (const line of lines || []) {
    const decl = parseRegularDeclaration(line);
    if (!decl) continue;
    declared.set(decl.varName.toLowerCase(), { name: decl.varName, typeName: decl.typeName });
  }

  for (const line of lines || []) {
    const assign = parseSimpleAssignment(line);
    if (!assign) continue;
    const target = declared.get(assign.target.toLowerCase());
    const value = declared.get(assign.value.toLowerCase());
    if (!target || !value) continue;
    if (!programInfo.getClass(target.typeName) && !programInfo.getInterface(target.typeName)) continue;
    if (target.typeName.toLowerCase() === value.typeName.toLowerCase()) continue;
    if (!programInfo.isAssignableTo(value.typeName, target.typeName)) continue;
    result.set(target.name.toLowerCase(), { name: target.name, baseType: target.typeName, implicit: true });
  }

  return result;
}

function analyzeLocalVarTypes(lines) {
  const result = new Map();
  for (const line of lines || []) {
    const decl = parseRegularDeclaration(line) || parsePolyDeclaration(line);
    if (!decl) continue;
    const typeName = decl.typeName || decl.baseType || '';
    if (!typeName) continue;
    result.set(decl.varName.toLowerCase(), { name: decl.varName, typeName });
  }
  return result;
}


function blockUsesDynamicDispatch(lines, programInfo) {
  const expanded = new Map();
  for (const line of lines || []) {
    if (parsePolyDeclaration(line)) return true;
  }
  if (analyzeImplicitPolyVars(lines || [], programInfo).size > 0) return true;
  return false;
}

function programUsesDynamicDispatch(parsedFiles, programInfo) {
  for (const parsed of parsedFiles || []) {
    if (blockUsesDynamicDispatch(parsed.topLevelLines || [], programInfo)) return true;
    for (const cls of parsed.classes || []) {
      const bundle = classLineBundle(cls, []);
      if (blockUsesDynamicDispatch(bundle.lines || [], programInfo)) return true;
    }
    for (const mod of parsed.staticCodes || []) {
      if (blockUsesDynamicDispatch(mod.lines || [], programInfo)) return true;
    }
  }
  return false;
}

function transformPolyCalls(line, context) {
  if (!context.polyVars || context.polyVars.size === 0) return line;
  const parts = splitCodeAndComment(line);
  let code = parts.code;
  for (const poly of context.polyVars.values()) {
    code = transformPolyCallsForVar(code, poly, context);
  }
  return code + parts.comment;
}

function transformPolyCallsForVar(code, poly, context) {
  const methods = context.programInfo ? context.programInfo.virtualMethodsFor(poly.baseType) : new Map();
  if (!methods.size) return code;

  const varRe = new RegExp(`\\b${escapeRegExp(poly.name)}\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g');
  let out = '';
  let cursor = 0;
  let match;

  while ((match = varRe.exec(code)) !== null) {
    const methodName = match[1];
    const method = methods.get(String(methodName).toLowerCase());
    if (!method) continue;

    let after = match.index + match[0].length;
    while (after < code.length && /\s/.test(code[after])) after++;

    let args = [];
    let end = after;
    if (code[after] === '(') {
      const parsed = readBalancedParentheses(code, after);
      if (!parsed) continue;
      args = splitArguments(parsed.inner).map(s => s.trim()).filter(Boolean);
      end = parsed.end + 1;
    }

    const original = code.slice(match.index, end);
    const argsExpr = makeRuntimeArgsExpression(args, context);
    const replacement = `B4XPP_Runtime.Dispatch(${poly.name}, "${methodName}", ${argsExpr})`;

    out += code.slice(cursor, match.index) + replacement;
    cursor = end;
    varRe.lastIndex = end;
  }

  if (cursor === 0) return code;
  out += code.slice(cursor);
  return out;
}


function makeRuntimeArgsExpression(args, context) {
  const count = args.length;
  if (context.usesRuntime) {
    context.usesRuntime.value = true;
    context.usesRuntime.maxArgs = Math.max(context.usesRuntime.maxArgs || 0, count);
  }
  if (count === 0) return 'B4XPP_Runtime.Args0';
  return `B4XPP_Runtime.Args${count}(${args.join(', ')})`;
}

function readBalancedParentheses(text, openIndex) {
  if (text[openIndex] !== '(') return null;
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inString && text[i + 1] === '"') { i++; continue; }
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) return { inner: text.slice(openIndex + 1, i), end: i };
      }
    }
  }
  return null;
}

function splitArguments(argsRaw) {
  const text = String(argsRaw || '');
  const out = [];
  let current = '';
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inString && text[i + 1] === '"') { current += ch + text[i + 1]; i++; continue; }
      inString = !inString;
      current += ch;
      continue;
    }
    if (!inString) {
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) {
        out.push(current);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim() !== '' || text.trim() === '') out.push(current);
  return out;
}


function parseExecutableSignatureParams(line) {
  const methodSig = parseMethodSignatureLine(line);
  if (methodSig) return methodSig.params || [];
  const ctorSig = parseConstructorSignatureLine(line);
  if (ctorSig) return ctorSig.params || [];
  const accessorSig = parsePropertyAccessorSignatureLine(line);
  if (accessorSig) return accessorSig.params || [];
  return null;
}

function analyzeLineNameScopes(lines) {
  const scopes = new Map();
  let currentStart = -1;
  let currentNames = null;
  const ranges = [];

  for (let i = 0; i < (lines || []).length; i++) {
    const line = lines[i];
    const params = parseExecutableSignatureParams(line);
    if (params) {
      if (currentNames && currentStart >= 0) ranges.push({ start: currentStart, end: Math.max(currentStart, i - 1), names: new Set(currentNames) });
      currentStart = i;
      currentNames = new Set();
      for (const p of params) if (p && p.name) currentNames.add(String(p.name).toLowerCase());
    }

    if (currentNames) {
      const decl = parseRegularDeclaration(line) || parsePolyDeclaration(line);
      if (decl && decl.varName) currentNames.add(String(decl.varName).toLowerCase());
    }

    if (currentNames && /^\s*End\s+(?:Sub|Get|Set)\s*$/i.test(String(line || ''))) {
      ranges.push({ start: currentStart, end: i, names: new Set(currentNames) });
      currentStart = -1;
      currentNames = null;
    }
  }

  if (currentNames && currentStart >= 0) ranges.push({ start: currentStart, end: (lines || []).length - 1, names: new Set(currentNames) });
  for (const r of ranges) {
    for (let i = r.start; i <= r.end; i++) scopes.set(i, r.names);
  }
  return scopes;
}


function analyzeLineAccessorScopes(lines) {
  const scopes = new Map();
  let currentStart = -1;
  const ranges = [];
  for (let i = 0; i < (lines || []).length; i++) {
    const line = String(lines[i] || '');
    if (parsePropertyAccessorSignatureLine(line)) {
      if (currentStart >= 0) ranges.push({ start: currentStart, end: Math.max(currentStart, i - 1) });
      currentStart = i;
    }
    if (currentStart >= 0 && /^\s*End\s+(?:Get|Set)\s*$/i.test(line)) {
      ranges.push({ start: currentStart, end: i });
      currentStart = -1;
    }
  }
  if (currentStart >= 0) ranges.push({ start: currentStart, end: (lines || []).length - 1 });
  for (const r of ranges) for (let i = r.start; i <= r.end; i++) scopes.set(i, true);
  return scopes;
}


function parseClosureLiteralStart(line) {
  const m = String(line || '').match(/^(\s*)(Dim|Private|Public|Protected)\s+([A-Za-z_][A-Za-z0-9_]*)\s+As\s+(Sub|Closure)\s*=\s*Sub\s*(?:\((.*)\))?\s*(?:As\s+(.+?))?\s*$/i);
  if (!m) return null;
  const paramsRaw = (m[5] || '').trim();
  const params = splitArguments(paramsRaw).map(p => p.trim()).filter(Boolean).map((p) => {
    const pm = p.match(/^([A-Za-z_][A-Za-z0-9_]*)(\(\))?\s*(?:As\s+(.+))?$/i);
    return { raw: p, name: pm ? pm[1] : p, isArray: !!(pm && pm[2]), type: pm && pm[3] ? pm[3].trim() : 'Object' };
  });
  return { indent: m[1] || '', keyword: m[2], varName: m[3], declaredType: m[4], paramsRaw, params, returnType: (m[6] || '').trim() };
}

function transformClosureTypeDeclarationLine(line) {
  const parts = splitCodeAndComment(line);
  const code = parts.code;
  const out = code.replace(/\bAs\s+(?:Sub|Closure)\b(?!\s*=\s*Sub\b)/ig, 'As B4XPPClosure');
  return out + parts.comment;
}

function generatedClosureMethodName(block, enclosingMethod, index) {
  const owner = sanitizeModuleName((block && block.name) || 'Module') || 'Module';
  const method = sanitizeModuleName(enclosingMethod || 'Closure') || 'Closure';
  return `B4XPP_Closure_${owner}_${method}_${index}`;
}

function collectLocalVarsBeforeClosure(lines, closureLineIndex, methodStartIndex, methodParams) {
  const vars = new Map();
  for (const p of methodParams || []) {
    if (p && p.name) vars.set(String(p.name).toLowerCase(), { name: p.name, type: p.type || 'Object', source: 'parameter' });
  }
  for (let i = Math.max(0, methodStartIndex || 0); i < closureLineIndex; i++) {
    const decl = parseRegularDeclaration(lines[i]) || parsePolyDeclaration(lines[i]);
    if (decl && decl.varName) vars.set(String(decl.varName).toLowerCase(), { name: decl.varName, type: decl.typeName || decl.baseType || 'Object', source: 'local' });
    const forVar = String(lines[i] || '').match(/^\s*For\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/i);
    if (forVar && !vars.has(forVar[1].toLowerCase())) vars.set(forVar[1].toLowerCase(), { name: forVar[1], type: 'Int', source: 'for' });
  }
  return vars;
}

function collectNamesDeclaredInsideClosure(bodyLines) {
  const names = new Set();
  for (const line of bodyLines || []) {
    const decl = parseRegularDeclaration(line) || parsePolyDeclaration(line);
    if (decl && decl.varName) names.add(String(decl.varName).toLowerCase());
    const forVar = String(line || '').match(/^\s*For\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/i);
    if (forVar) names.add(forVar[1].toLowerCase());
  }
  return names;
}

function b4xppClosureIdentifierBlacklist() {
  return new Set([
    'as','and','or','not','true','false','null','return','if','then','else','end','sub','dim','private','public','protected','for','each','next','to','step','while','do','loop','select','case','try','catch','log','sleep','wait','callsub','callsub2','callsub3','me','this','super'
  ]);
}

function collectClosureCaptures(bodyLines, closureInfo, outerVars) {
  const captures = [];
  if (!outerVars || outerVars.size === 0) return captures;
  const params = new Set((closureInfo.params || []).map(p => String(p.name || '').toLowerCase()));
  const locals = collectNamesDeclaredInsideClosure(bodyLines);
  const blocked = b4xppClosureIdentifierBlacklist();
  const seen = new Set();
  for (let i = 0; i < (bodyLines || []).length; i++) {
    const clean = b4xppLineWithoutStringsAndComments(bodyLines[i]);
    const re = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
    let m;
    while ((m = re.exec(clean))) {
      const lower = m[1].toLowerCase();
      if (blocked.has(lower) || params.has(lower) || locals.has(lower) || seen.has(lower)) continue;
      const outer = outerVars.get(lower);
      if (!outer) continue;
      seen.add(lower);
      captures.push({ name: outer.name || m[1], type: outer.type || 'Object' });
    }
  }
  return captures;
}

function closureEscapes(lines, varName, closureStartIndex, closureEndIndex) {
  const name = String(varName || '');
  if (!name) return false;
  const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'ig');
  for (let i = closureEndIndex + 1; i < (lines || []).length; i++) {
    const raw = String(lines[i] || '');
    if (/^\s*(?:#End\s+Constructor|End\s+Sub|End\s+Get|End\s+Set)\b/i.test(raw)) break;
    const code = b4xppLineWithoutStringsAndComments(raw);
    let m;
    while ((m = re.exec(code))) {
      const after = code.slice(m.index + m[0].length);
      const before = m.index > 0 ? code[m.index - 1] : '';
      if (before === '.') continue;
      if (/^\s*\(/.test(after)) continue; // direct invocation: add(...)
      return true; // passed, assigned, returned, added to a collection, etc.
    }
  }
  return false;
}

function formatParamList(params) {
  return (params || []).map(p => p.raw || `${p.name} As ${p.type || 'Object'}`).join(', ');
}

function makeListCaptureLines(indent, listName, captures) {
  const out = [];
  out.push(`${indent}Dim ${listName} As List`);
  out.push(`${indent}${listName}.Initialize`);
  for (const cap of captures || []) out.push(`${indent}${listName}.Add(${cap.name})`);
  return out;
}

function makeRuntimeClosureMethodBody(generatedName, info, captures, body) {
  const out = [];
  out.push('');
  out.push(`' B4X++ runtime closure body for ${info.varName}.`);
  out.push(`Public Sub ${generatedName}(B4XPP_ctx As List) As Object`);
  out.push('\tDim B4XPP_caps As List = B4XPP_ctx.Get(0)');
  out.push('\tDim B4XPP_args As List = B4XPP_ctx.Get(1)');
  for (let i = 0; i < (captures || []).length; i++) {
    const cap = captures[i];
    out.push(`\tDim ${cap.name} As ${cap.type || 'Object'} = B4XPP_caps.Get(${i})`);
  }
  for (let i = 0; i < (info.params || []).length; i++) {
    const param = info.params[i];
    out.push(`\tDim ${param.name} As ${param.type || 'Object'} = B4XPP_args.Get(${i})`);
  }
  out.push(...body);
  if (!body.some(line => /^\s*Return\b/i.test(String(line || '')))) out.push('\tReturn Null');
  out.push('End Sub');
  return out;
}

function makeLiftedClosureMethodBody(generatedName, info, captures, body) {
  const out = [];
  const params = [];
  for (const cap of captures || []) params.push(`${cap.name} As ${cap.type || 'Object'}`);
  const closureParams = formatParamList(info.params || []);
  if (closureParams) params.push(closureParams);
  const ret = info.returnType ? ` As ${info.returnType}` : '';
  out.push('');
  out.push(`' B4X++ lifted closure body for ${info.varName}.`);
  out.push(`Private Sub ${generatedName}${params.length ? '(' + params.join(', ') + ')' : ''}${ret}`);
  out.push(...body);
  out.push('End Sub');
  return out;
}

function extractClosureLiterals(lines, block, diagnostics, usesRuntime) {
  const out = [];
  const generatedSubs = [];
  let currentMethodName = '';
  let currentMethodStart = -1;
  let currentMethodParams = [];
  let closureCounter = 0;

  for (let i = 0; i < (lines || []).length; i++) {
    const raw = lines[i];
    const sig = parseMethodSignatureLine(raw) || parseConstructorSignatureLine(raw) || parsePropertyAccessorSignatureLine(raw);
    if (sig) {
      currentMethodName = sig.name || 'Closure';
      currentMethodStart = i;
      currentMethodParams = sig.params || [];
      out.push(transformClosureTypeDeclarationLine(raw));
      continue;
    }

    const info = parseClosureLiteralStart(raw);
    if (!info) {
      out.push(transformClosureTypeDeclarationLine(raw));
      if (/^\s*(?:#End\s+Constructor|End\s+Sub|End\s+Get|End\s+Set)\b/i.test(String(raw || ''))) {
        currentMethodName = '';
        currentMethodStart = -1;
        currentMethodParams = [];
      }
      continue;
    }

    if (!currentMethodName) {
      diagnostics && diagnostics.push(makeDiagnostic(block.sourcePath, block.startLine + i + 1, 'error', `Closure literal '${info.varName}' must be declared inside a Sub / #Constructor / property accessor.`));
    }

    const body = [];
    let endIndex = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*End\s+Sub\s*$/i.test(String(lines[j] || ''))) { endIndex = j; break; }
      body.push(lines[j]);
    }
    if (endIndex < 0) {
      diagnostics && diagnostics.push(makeDiagnostic(block.sourcePath, block.startLine + i + 1, 'error', `Closure '${info.varName}' is missing End Sub.`));
      out.push(raw);
      continue;
    }

    closureCounter += 1;
    const generatedName = generatedClosureMethodName(block, currentMethodName, closureCounter);
    const outerVars = collectLocalVarsBeforeClosure(lines, i, currentMethodStart, currentMethodParams);
    const captures = collectClosureCaptures(body, info, outerVars);
    const escapes = closureEscapes(lines, info.varName, i, endIndex) || !/^Dim$/i.test(info.keyword);

    if (escapes) {
      if (usesRuntime) {
        usesRuntime.usesClosure = true;
        usesRuntime.maxClosureArgs = Math.max(usesRuntime.maxClosureArgs || 0, (info.params || []).length);
      }
      const capsVar = `B4XPP_${info.varName}_captures`;
      out.push(`${info.indent}' B4X++ closure value: ${info.varName} -> ${generatedName}; captures: ${captures.map(c => c.name).join(', ') || 'none'}`);
      out.push(...makeListCaptureLines(info.indent, capsVar, captures));
      out.push(`${info.indent}${info.keyword} ${info.varName} As B4XPPClosure`);
      out.push(`${info.indent}${info.varName}.Initialize(Me, "${generatedName}", ${capsVar})`);
      generatedSubs.push(...makeRuntimeClosureMethodBody(generatedName, info, captures, body));
    } else {
      out.push(`${info.indent}' B4XPP_LIFTED_CLOSURE ${info.varName} ${generatedName} ${captures.map(c => c.name).join(',')}`);
      generatedSubs.push(...makeLiftedClosureMethodBody(generatedName, info, captures, body));
    }

    i = endIndex;
  }

  return { lines: out.concat(generatedSubs), generatedCount: closureCounter };
}

function collectClosureVars(lines) {
  const out = new Map();
  for (const line of lines || []) {
    const marker = String(line || '').match(/^\s*'\s*B4XPP_LIFTED_CLOSURE\s+([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/i);
    if (marker) {
      const captures = String(marker[3] || '').split(',').map(s => s.trim()).filter(Boolean);
      out.set(marker[1].toLowerCase(), { name: marker[1], typeName: 'Closure', direct: true, generatedName: marker[2], captures });
      continue;
    }
    const m = String(line || '').match(/^\s*(?:Dim|Private|Public|Protected)\s+([A-Za-z_][A-Za-z0-9_]*)\s+As\s+B4XPPClosure\b/i);
    if (m) out.set(m[1].toLowerCase(), { name: m[1], typeName: 'B4XPPClosure', direct: false });
    const each = String(line || '').match(/^\s*For\s+Each\s+([A-Za-z_][A-Za-z0-9_]*)\s+As\s+B4XPPClosure\b/i);
    if (each) out.set(each[1].toLowerCase(), { name: each[1], typeName: 'B4XPPClosure', direct: false });
    const params = parseExecutableSignatureParams(line);
    for (const p of params || []) {
      if (p && p.name && /^(?:Sub|Closure|B4XPPClosure)$/i.test(String(p.type || '').trim())) {
        out.set(String(p.name).toLowerCase(), { name: p.name, typeName: 'B4XPPClosure', direct: false });
      }
    }
  }
  return out;
}

function closureRunMethodName(arity) {
  return arity === 0 ? 'Run' : `Run${arity}`;
}

function transformClosureCalls(line, context) {
  if (!context || !context.closureVars || context.closureVars.size === 0) return line;
  const parts = splitCodeAndComment(line);
  let code = parts.code;
  if (/^\s*(?:Dim|Private|Public|Protected)\s+/i.test(code)) return line;
  if (/^\s*'\s*B4XPP_LIFTED_CLOSURE\b/i.test(String(line || ''))) return line;
  for (const closure of context.closureVars.values()) {
    const re = new RegExp(`\\b${escapeRegExp(closure.name)}\\s*\\(`, 'g');
    let out = '';
    let cursor = 0;
    let match;
    while ((match = re.exec(code)) !== null) {
      const before = match.index > 0 ? code[match.index - 1] : '';
      if (before === '.') continue;
      const openIndex = match.index + match[0].lastIndexOf('(');
      const parsed = readBalancedParentheses(code, openIndex);
      if (!parsed) continue;
      const args = splitArguments(parsed.inner).map(s => s.trim()).filter(Boolean);
      let replacement;
      if (closure.direct) {
        const liftedArgs = [...(closure.captures || []), ...args].join(', ');
        replacement = `${closure.generatedName}${liftedArgs ? '(' + liftedArgs + ')' : ''}`;
      } else {
        replacement = `${closure.name}.${closureRunMethodName(args.length)}(${parsed.inner})`;
      }
      out += code.slice(cursor, match.index) + replacement;
      cursor = parsed.end + 1;
      re.lastIndex = cursor;
    }
    if (cursor > 0) {
      out += code.slice(cursor);
      code = out;
    }
  }
  return code + parts.comment;
}

function transformBodyLines(lines, block, diagnostics, programInfo, usesRuntime) {
  const extractedClosures = extractClosureLiterals(lines, block, diagnostics, usesRuntime);
  lines = extractedClosures.lines;
  const out = [];
  const polyVars = analyzeImplicitPolyVars(lines, programInfo);
  const localTypes = analyzeLocalVarTypes(lines);
  const closureVars = collectClosureVars(lines);
  const overloadPlan = block && block.name ? getClassOverloadPlan(programInfo, block.name) : null;
  const lineNameScopes = analyzeLineNameScopes(lines);
  const lineAccessorScopes = analyzeLineAccessorScopes(lines);
  for (let i = 0; i < lines.length; i++) {
    const context = {
      sourcePath: block.sourcePath,
      extendsName: block.extendsName,
      className: block.name,
      diagnostics,
      lineNo: block.startLine + i + 1,
      programInfo,
      polyVars,
      localTypes,
      closureVars,
      overloadPlan,
      localNames: lineNameScopes.get(i) || new Set(),
      isPropertyAccessor: !!lineAccessorScopes.get(i),
      usesRuntime
    };
    out.push(...transformOopLine(lines[i], context));
  }
  return out;
}

function findSubRange(lines, subName) {
  const startRe = new RegExp(`^\\s*(?:Public|Private)?\\s*Sub\\s+${subName}\\b`, 'i');
  const anySubRe = /^\s*(?:Public|Private)?\s*Sub\b/i;
  let start = -1;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    if (start === -1) {
      if (startRe.test(lines[i])) {
        start = i;
        depth = 1;
      }
    } else {
      if (anySubRe.test(lines[i])) depth++;
      if (/^\s*End\s+Sub\b/i.test(lines[i])) {
        depth--;
        if (depth === 0) return { start, end: i };
      }
    }
  }
  return start >= 0 ? { start, end: start } : null;
}


function isB4XConditionalDirective(line) {
  return /^\s*#(?:If|Else|End\s+If)\b/i.test(String(line || ''));
}

function isDesignerPropertyDirective(line) {
  return /^\s*#DesignerProperty\b/i.test(String(line || ''));
}

function isEventDirective(line) {
  return /^\s*#Event\b/i.test(String(line || ''));
}

function extractDesignerAndEventDirectives(lines) {
  const remaining = [];
  const designerProperties = [];
  const events = [];
  for (const line of lines) {
    if (isDesignerPropertyDirective(line)) {
      designerProperties.push(line);
    } else if (isEventDirective(line)) {
      events.push(line);
    } else {
      remaining.push(line);
    }
  }
  return { remaining, designerProperties, events };
}

function uniqueDirectiveLines(lines) {
  const seen = new Set();
  const out = [];
  for (const line of lines || []) {
    const key = String(line || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function collectFieldNames(lines) {
  const names = new Set();
  for (const line of lines || []) {
    const m = String(line || '').match(/^\s*(?:Private|Public|Dim)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
    if (m) names.add(m[1].toLowerCase());
  }
  return names;
}

function collectOwnMethodNames(block) {
  return new Set((block && block.methods || []).map(m => m.name.toLowerCase()));
}

function makeSuperMethodName(ownerName, methodName) {
  return `B4XPP_Super_${ownerName}_${methodName}`;
}

function methodSignatureRegex(methodName) {
  return new RegExp(`^(\\s*)(Public\\s+|Private\\s+)?Sub\\s+${escapeRegExp(methodName)}\\b`, 'i');
}

function renameMethodSignature(line, oldName, newName) {
  return String(line || '').replace(methodSignatureRegex(oldName), `$1$2Sub ${newName}`);
}

function getParentGetterName(programInfo, parentName, memberName) {
  if (!programInfo || !parentName) return null;
  const getter = programInfo.findClassMethod(parentName, `get${memberName}`);
  if (getter) return makeSuperMethodName(getter.cls.name, getter.method.name);
  const propertyOwner = findPropertyOwner(programInfo, parentName, memberName);
  if (propertyOwner) return `get${memberName}`;
  return null;
}

function findPropertyOwner(programInfo, className, propertyName) {
  if (!programInfo || !className) return null;
  const target = String(propertyName || '').toLowerCase();
  const chain = [programInfo.getClass(className)].concat(programInfo.ancestorChain(className)).filter(Boolean);
  for (const cls of chain) {
    for (const line of cls.lines || []) {
      const prop = parsePropertyDirective(line);
      if (prop && prop.name.toLowerCase() === target) return cls;
    }
  }
  return null;
}

function getParentMethodOwner(programInfo, parentName, methodName) {
  if (!programInfo || !parentName) return parentName;
  const found = programInfo.findClassMethod(parentName, methodName);
  return found && found.cls ? found.cls.name : parentName;
}


function extractClassGlobalsBlock(lines) {
  const range = findSubRange(lines, 'Class_Globals');
  if (!range) return { lines, fields: [] };
  const fields = lines.slice(range.start + 1, range.end);
  const remaining = lines.slice(0, range.start).concat(lines.slice(range.end + 1));
  return { lines: remaining, fields };
}

function makeClassGlobalsBlock(fields) {
  const clean = (fields || []).filter(line => String(line || '').trim() !== '');
  if (!clean.length) return [];
  return ["' B4X++ generated / flattened field(s).", 'Sub Class_Globals', ...clean, 'End Sub', ''];
}

function classLineBundle(block, diagnostics) {
  const directives = extractDesignerAndEventDirectives(block.lines || []);
  const propertyExpansion = extractPropertyDirectives(directives.remaining, block, diagnostics);
  const globals = extractClassGlobalsBlock(propertyExpansion.lines);
  return {
    lines: globals.lines.concat(propertyExpansion.accessors),
    fields: propertyExpansion.fields.concat(globals.fields),
    properties: propertyExpansion.properties || [],
    designerProperties: directives.designerProperties,
    events: directives.events
  };
}

function transformClassGlobalFieldLine(line) {
  // B4X has no Protected field modifier. In flattened output protected fields are copied
  // into the final class, so Private keeps the generated .bas compiler-friendly.
  return String(line || '').replace(/^(\s*)Protected\s+/i, '$1Private ');
}

function parseClassGlobalFieldLine(line) {
  const code = splitCodeAndComment(line).code;
  const m = code.match(/^\s*(Public|Private|Protected|Dim)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
  if (!m) return null;
  const keyword = m[1].toLowerCase();
  return { visibility: keyword === 'dim' ? 'private' : keyword, keyword, name: m[2] };
}

function renameFieldDeclaration(line, oldName, newName) {
  return String(line || '').replace(new RegExp(`(\\b(?:Public|Private|Protected|Dim)\\s+)${escapeRegExp(oldName)}\\b`, 'i'), `$1${newName}`);
}

function collectPrivateMethodReplacements(owner, isFinalBlock) {
  const replacements = new Map();
  if (isFinalBlock || !owner) return replacements;
  for (const method of owner.methods || []) {
    if (method.visibility !== 'private') continue;
    const lname = method.name.toLowerCase();
    if (['class_globals', 'process_globals'].includes(lname)) continue;
    replacements.set(lname, `B4XPP_Private_${owner.name}_${method.name}`);
  }
  return replacements;
}

function hasMethodInDescendants(owner, chainAfterOwner) {
  const descendants = chainAfterOwner || [];
  return function(methodName) {
    const lname = String(methodName || '').toLowerCase();
    return descendants.some(block => (block.methods || []).some(m => m.name.toLowerCase() === lname));
  };
}

function flattenClassParts(block, options, programInfo, diagnostics, usesRuntime) {
  const ancestors = programInfo ? programInfo.ancestorChain(block.name).slice().reverse() : [];
  const chain = ancestors.concat([block]);
  const parts = [];
  const designerProperties = [];
  const events = [];
  const globalFieldOwners = new Map();
  const exposedMethods = new Map();

  for (let idx = 0; idx < chain.length; idx++) {
    const owner = chain[idx];
    const isFinalBlock = owner.name.toLowerCase() === block.name.toLowerCase();
    const descendants = chain.slice(idx + 1);
    const descendantHasMethod = hasMethodInDescendants(owner, descendants);
    const bundle = classLineBundle(owner, diagnostics);
    designerProperties.push(...bundle.designerProperties.map(line => ({ owner, line })));
    events.push(...bundle.events.map(line => ({ owner, line })));

    const privateMemberReplacements = collectPrivateMethodReplacements(owner, isFinalBlock);
    if (!isFinalBlock) {
      for (const prop of bundle.properties || []) {
        if (prop.visibility !== 'private') continue;
        privateMemberReplacements.set(`get${prop.name}`.toLowerCase(), `B4XPP_Private_${owner.name}_get${prop.name}`);
        if (prop.mode !== 'readonly') privateMemberReplacements.set(`set${prop.name}`.toLowerCase(), `B4XPP_Private_${owner.name}_set${prop.name}`);
      }
    }
    const fields = [];
    const closureExpandedBundle = extractClosureLiterals(bundle.lines, owner, diagnostics, usesRuntime);
    const bodySourceLines = closureExpandedBundle.lines;
    for (const fieldLineRaw of bundle.fields) {
      const fieldInfo = parseClassGlobalFieldLine(fieldLineRaw);
      let fieldLine = fieldLineRaw;
      if (fieldInfo && !isFinalBlock && fieldInfo.visibility === 'private') {
        const newName = `B4XPP_Private_${owner.name}_${fieldInfo.name}`;
        privateMemberReplacements.set(fieldInfo.name.toLowerCase(), newName);
        fieldLine = renameFieldDeclaration(fieldLine, fieldInfo.name, newName);
      }
      fieldLine = transformClassGlobalFieldLine(fieldLine);

      const m = String(fieldLine || '').match(/^\s*(?:Private|Public|Dim)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
      const fname = m ? m[1].toLowerCase() : '';
      if (fname && globalFieldOwners.has(fname) && !isFinalBlock) {
        diagnostics.push(makeDiagnostic(owner.sourcePath, owner.startLine, 'warning', `Flattening field collision: ${owner.name}.${m[1]} conflicts with ${globalFieldOwners.get(fname)}. The inherited field was skipped in ${block.name}.`));
        continue;
      }
      if (fname && globalFieldOwners.has(fname) && isFinalBlock) {
        diagnostics.push(makeDiagnostic(owner.sourcePath, owner.startLine, 'warning', `Flattening field collision: ${owner.name}.${m[1]} overrides inherited field from ${globalFieldOwners.get(fname)} in ${block.name}.`));
        // remove previous inherited field with same name
        for (const part of parts) {
          part.fields = part.fields.filter(line => !(new RegExp(`^\\s*(?:Private|Public|Dim)\\s+${escapeRegExp(m[1])}\\b`, 'i')).test(line));
        }
      }
      if (fname) globalFieldOwners.set(fname, owner.name);
      fields.push(fieldLine);
    }

    const transformContextUsesRuntime = usesRuntime;
    let transformed = [];
    const localPolyVars = analyzeImplicitPolyVars(bodySourceLines, programInfo);
    const localTypes = analyzeLocalVarTypes(bodySourceLines);
    const closureVars = collectClosureVars(bodySourceLines);
    const overloadPlan = getClassOverloadPlan(programInfo, owner.name);
    const lineNameScopes = analyzeLineNameScopes(bodySourceLines);
    const lineAccessorScopes = analyzeLineAccessorScopes(bodySourceLines);
    for (let i = 0; i < bodySourceLines.length; i++) {
      const context = {
        sourcePath: owner.sourcePath,
        extendsName: owner.extendsName,
        className: owner.name,
        diagnostics,
        lineNo: owner.startLine + i + 1,
        programInfo,
        polyVars: localPolyVars,
        localTypes,
        closureVars,
        overloadPlan,
        localNames: lineNameScopes.get(i) || new Set(),
        isPropertyAccessor: !!lineAccessorScopes.get(i),
        usesRuntime: transformContextUsesRuntime,
        flattenSuper: true,
        resolveSuperMember: (memberName, hasCall, arity) => {
          const parentName = owner.extendsName;
          if (!parentName) return memberName;
          if (!hasCall) {
            const getter = getParentGetterName(programInfo, parentName, memberName);
            if (getter) return getter;
          }
          let effectiveMemberName = memberName;
          if (hasCall && Number.isInteger(arity)) {
            const overloaded = resolveGeneratedOverloadName(programInfo, parentName, memberName, arity);
            if (overloaded) effectiveMemberName = overloaded;
          }
          const methodOwner = getParentMethodOwner(programInfo, parentName, effectiveMemberName) || getParentMethodOwner(programInfo, parentName, memberName) || parentName;
          return makeSuperMethodName(methodOwner, effectiveMemberName);
        }
      };
      transformed.push(...transformOopLine(bodySourceLines[i], context));
    }

    if (privateMemberReplacements.size) {
      transformed = transformed.map(line => replaceIdentifiersOutsideStringsAndComment(line, privateMemberReplacements));
    }

    const body = [];
    for (const line of transformed) {
      const sig = parseMethodSignatureLine(line);
      if (!sig) {
        body.push(line);
        continue;
      }
      const lname = sig.name.toLowerCase();
      const isSpecial = ['class_globals', 'b4xpp_dispatch'].includes(lname);
      const overloadBaseName = String(sig.name || '').replace(/\d+$/, '');
      const shouldRenameToSuper = !isFinalBlock && !isSpecial && (/^initialize\d*$/i.test(sig.name) || descendantHasMethod(sig.name) || (overloadBaseName.toLowerCase() !== String(sig.name || '').toLowerCase() && descendantHasMethod(overloadBaseName)));
      const conflictsWithExposed = !isFinalBlock && !shouldRenameToSuper && exposedMethods.has(lname);
      let outLine = line;
      if (shouldRenameToSuper) {
        outLine = renameMethodSignature(line, sig.name, makeSuperMethodName(owner.name, sig.name));
      } else if (conflictsWithExposed) {
        const newName = `B4XPP_Inherited_${owner.name}_${sig.name}`;
        diagnostics.push(makeDiagnostic(owner.sourcePath, owner.startLine + (sig.lineIndex || 0), 'warning', `Flattening method collision: ${owner.name}.${sig.name} was renamed to ${newName} in ${block.name}.`));
        outLine = renameMethodSignature(line, sig.name, newName);
      } else if (!isSpecial) {
        exposedMethods.set(lname, owner.name);
      }
      body.push(outLine);
    }

    parts.push({ owner, fields, body, properties: bundle.properties || [] });
  }

  const finalGlobalNames = collectFinalGlobalNames(parts);
  const programTypeNames = collectProgramTypeNames(programInfo);
  for (const part of parts) {
    const unsafeNames = new Set(programTypeNames);
    for (const propName of collectClassPropertyNames(programInfo, part.owner && part.owner.name)) unsafeNames.add(propName);
    for (const method of part.owner && part.owner.methods || []) unsafeNames.add(String(method.name || '').toLowerCase());
    part.body = sanitizeMethodParameterCollisions(part.body, finalGlobalNames, diagnostics, part.owner && part.owner.sourcePath, part.owner && part.owner.startLine ? part.owner.startLine : 0, unsafeNames);
  }

  return {
    parts,
    designerProperties: uniqueDirectiveLines(designerProperties.map(x => x.line)),
    events: uniqueDirectiveLines(events.map(x => x.line)),
    ancestors
  };
}


function collectFinalGlobalNames(parts) {
  const names = new Set();
  for (const part of parts || []) {
    for (const fieldLine of part.fields || []) {
      const m = String(fieldLine || '').match(/^\s*(?:Private|Public|Dim)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
      if (m) names.add(m[1].toLowerCase());
    }
  }
  return names;
}

function makeSafeParameterName(originalName, globalNames) {
  const safeSourceStyle = `a${String(originalName || '').charAt(0).toUpperCase()}${String(originalName || '').slice(1)}`;
  let candidate = safeSourceStyle;
  let counter = 2;
  while ((globalNames || new Set()).has(candidate.toLowerCase()) || B4X_RESERVED_WORDS.has(candidate.toLowerCase())) {
    candidate = `${safeSourceStyle}${counter++}`;
  }
  return candidate;
}

function replaceIdentifiersOutsideStringsAndComment(line, replacements) {
  if (!replacements || replacements.size === 0) return line;
  const parts = splitCodeAndComment(line);
  const code = parts.code;
  let out = '';
  let inString = false;
  for (let i = 0; i < code.length;) {
    const ch = code[i];
    if (ch === '"') {
      out += ch;
      if (inString && code[i + 1] === '"') {
        out += code[i + 1];
        i += 2;
        continue;
      }
      inString = !inString;
      i++;
      continue;
    }
    if (!inString && /[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < code.length && /[A-Za-z0-9_]/.test(code[j])) j++;
      const word = code.slice(i, j);
      out += replacements.get(word.toLowerCase()) || word;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out + parts.comment;
}

function renameParameterInSignature(line, oldName, newName) {
  const open = String(line || '').indexOf('(');
  const close = String(line || '').lastIndexOf(')');
  if (open < 0 || close < open) return line;
  const before = line.slice(0, open + 1);
  let params = line.slice(open + 1, close);
  const after = line.slice(close);
  const re = new RegExp(`\\b${escapeRegExp(oldName)}\\b(?=\\s*(?:\\(\\))?\\s*(?:As\\b|,|$))`, 'ig');
  params = params.replace(re, newName);
  return before + params + after;
}

function sanitizeMethodParameterCollisions(body, globalNames, diagnostics, sourcePath, baseLine, unsafeNames) {
  globalNames = globalNames || new Set();
  unsafeNames = unsafeNames || new Set();
  const out = body.slice();

  for (let i = 0; i < out.length; i++) {
    const sig = parseMethodSignatureLine(out[i]);
    if (!sig || !sig.params || sig.params.length === 0) continue;

    const replacements = new Map();
    const setterMatch = String(sig.name || '').match(/^set([A-Za-z_][A-Za-z0-9_]*)$/i);
    const setterPropertyName = setterMatch ? setterMatch[1].toLowerCase() : '';
    for (let paramIndex = 0; paramIndex < sig.params.length; paramIndex++) {
      const param = sig.params[paramIndex];
      const lname = String(param.name || '').toLowerCase();
      const hidesGeneratedGlobal = !!lname && globalNames.has(lname);
      const hidesB4XPropertyName = !!setterPropertyName && paramIndex === 0 && lname === setterPropertyName;
      const hidesUnsafeName = !!lname && unsafeNames.has(lname);
      const isReservedWord = !!lname && B4X_RESERVED_WORDS.has(lname);
      if (!lname || (!hidesGeneratedGlobal && !hidesB4XPropertyName && !hidesUnsafeName && !isReservedWord)) continue;
      const combinedUnsafe = new Set([...(globalNames || new Set()), ...(unsafeNames || new Set())]);
      const safeName = makeSafeParameterName(param.name, combinedUnsafe);
      replacements.set(lname, safeName);
      if (diagnostics) {
        let reason = 'an unsafe B4X/B4X++ name';
        if (hidesB4XPropertyName) reason = 'the B4X property name';
        else if (hidesGeneratedGlobal) reason = 'a generated global field';
        else if (isReservedWord) reason = 'a reserved B4X keyword';
        diagnostics.push(makeDiagnostic(sourcePath || '', (baseLine || 0) + i + 1, 'warning', `Parameter ${param.name} in ${sig.name} conflicts with ${reason} and was renamed to ${safeName}. Prefer source names like a${param.name}.`));
      }
    }
    if (replacements.size === 0) continue;

    for (const [oldLower, safeName] of replacements) {
      const oldParam = sig.params.find(p => String(p.name || '').toLowerCase() === oldLower);
      if (oldParam) out[i] = renameParameterInSignature(out[i], oldParam.name, safeName);
    }

    for (let j = i + 1; j < out.length; j++) {
      if (/^\s*End\s+Sub\s*$/i.test(out[j])) break;
      out[j] = replaceIdentifiersOutsideStringsAndComment(out[j], replacements);
    }
  }

  return out;
}


function collectCustomPropertyAccessors(lines) {
  const map = new Map();
  for (const line of lines || []) {
    const acc = parsePropertyAccessorSignatureLine(line);
    if (!acc) continue;
    const key = acc.propertyName.toLowerCase();
    if (!map.has(key)) map.set(key, { get: false, set: false });
    map.get(key)[acc.accessorKind] = true;
  }
  return map;
}

function extractPropertyDirectives(lines, block, diagnostics) {
  const remaining = [];
  const fields = [];
  const accessors = [];
  const properties = [];
  const customAccessors = collectCustomPropertyAccessors(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prop = parsePropertyDirective(line);
    if (!prop) {
      remaining.push(line);
      continue;
    }

    const mode = prop.mode;
    const visibility = prop.visibility || 'public';
    const outVisibility = visibility === 'public' ? 'Public' : 'Private';
    const name = prop.name;
    const type = prop.type;
    const defaultValue = prop.defaultValue;
    const fieldName = `m${name}`;
    const indent = prop.indent;
    properties.push({ name, fieldName, type, mode, visibility });

    // B4X accepts initial values after the type and this form is easier to read.
    // Example: Private mTitle As String = "Untitled".
    if (defaultValue !== null && defaultValue !== undefined && String(defaultValue).trim() !== '') {
      fields.push(`\tPrivate ${fieldName} As ${type} = ${defaultValue}`);
    } else {
      fields.push(`\tPrivate ${fieldName} As ${type}`);
    }

    accessors.push('');
    accessors.push(`${indent}' B4X++ property: ${visibility} ${name} As ${type}${mode ? ' (' + mode + ')' : ''}${defaultValue ? ' default=' + defaultValue : ''}`);
    const custom = customAccessors.get(name.toLowerCase()) || {};
    if (mode === 'readonly' && custom.set) {
      diagnostics.push(makeDiagnostic(block.sourcePath, block.startLine + i, 'warning', `#Property ${name} is ReadOnly but a custom Set accessor exists. The custom setter will still be generated.`));
    }
    if (mode === 'writeonly' && custom.get) {
      diagnostics.push(makeDiagnostic(block.sourcePath, block.startLine + i, 'warning', `#Property ${name} is WriteOnly but a custom Get accessor exists. The custom getter will still be generated.`));
    }
    if (mode !== 'writeonly' && !custom.get) {
      accessors.push(`${indent}${outVisibility} Sub get${name} As ${type}`);
      accessors.push(`${indent}	Return ${fieldName}`);
      accessors.push(`${indent}End Sub`);
      accessors.push('');
    }
    if (mode !== 'readonly' && !custom.set) {
      // Use a generated parameter name. In B4X, a setter parameter named exactly
      // like the property can trigger: "Parameter name cannot hide global variable name".
      const setterParamName = `B4XPP_${name}`;
      accessors.push(`${indent}${outVisibility} Sub set${name}(${setterParamName} As ${type})`);
      accessors.push(`${indent}	${fieldName} = ${setterParamName}`);
      accessors.push(`${indent}End Sub`);
    }
  }

  return { lines: remaining, fields, accessors, properties };
}

function parsePropertyDirective(line) {
  const indent = (String(line || '').match(/^\s*/) || [''])[0];
  const code = splitCodeAndComment(line).code.trim();
  const m = code.match(/^#Property\s+(.+?)\s+As\s+(.+)$/i);
  if (!m) return null;

  const beforeAs = (m[1] || '').trim();
  const tokens = beforeAs.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const name = tokens[tokens.length - 1];
  if (!IDENTIFIER_RE.test(name)) return null;
  let visibility = 'public';
  let mode = '';
  for (const token of tokens.slice(0, -1)) {
    const lower = token.toLowerCase();
    if (['public', 'private', 'protected'].includes(lower)) visibility = lower;
    else if (['readonly', 'writeonly'].includes(lower)) mode = lower;
  }

  let typeAndDefault = (m[2] || '').trim();
  let type = typeAndDefault;
  let defaultValue = null;

  const eqIndex = findTopLevelEquals(typeAndDefault);
  if (eqIndex >= 0) {
    type = typeAndDefault.slice(0, eqIndex).trim();
    defaultValue = typeAndDefault.slice(eqIndex + 1).trim();
  }

  return { indent, visibility, mode, name, type, defaultValue };
}

function findTopLevelEquals(text) {
  let depth = 0;
  let inString = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      if (inString && s[i + 1] === '"') { i++; continue; }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === '=' && depth === 0) return i;
  }
  return -1;
}


function injectClassGlobals(lines, block, extraGlobals = []) {
  const globals = [];
  for (const g of extraGlobals) globals.push(g);
  if (!globals.length) return lines;

  const comments = [];
  if (extraGlobals.length) comments.push(`' B4X++ generated / flattened field(s).`);

  const result = lines.slice();
  const classGlobalsRange = findSubRange(result, 'Class_Globals');

  if (classGlobalsRange) {
    if (globals.length) result.splice(classGlobalsRange.start + 1, 0, ...globals);
    result.splice(classGlobalsRange.start, 0, ...comments);
    return result;
  }

  const blockLines = comments.concat(['Sub Class_Globals'], globals, ['End Sub', '']);
  let insertAt = 0;
  if (result.length && /^'\s*AUTO-GENERATED BY B4X\+\+/i.test(result[0])) {
    insertAt = result.findIndex((line, idx) => idx > 0 && line.trim() === '');
    insertAt = insertAt >= 0 ? insertAt + 1 : 0;
  }
  result.splice(insertAt, 0, ...blockLines);
  return result;
}

function makeInheritedWrappers(block, programInfo) {
  // v0.1 public uses flattened .bas generation. Inherited members are copied into the final class,
  // and parent implementations needed by Super.Method are renamed to B4XPP_Super_<Parent>_<Method>.
  return [];
}

function makeDispatcher(block, programInfo, usesRuntime) {
  if (!usesRuntime || !usesRuntime.value) return [];
  if (!programInfo) return [];
  const methods = programInfo.dispatchableMethodsFor(block.name);
  const entries = Array.from(methods.values());
  if (!entries.length) return [];
  if ((block.methods || []).some(m => m.name.toLowerCase() === 'b4xpp_dispatch')) return [];
  if (usesRuntime) {
    usesRuntime.value = true;
    usesRuntime.maxArgs = Math.max(usesRuntime.maxArgs || 0, ...entries.map(e => (e.method.params || []).length));
  }

  const out = [];
  out.push('');
  out.push("' B4X++ dynamic dispatch entry point used by Poly<T>.");
  out.push("' Result values are returned through B4XPP_Runtime.SetResult to keep generated class modules broadly compatible.");
  out.push('Public Sub B4XPP_Dispatch(MethodName As String, Args As List)');
  out.push('\tSelect MethodName.ToLowerCase');
  for (const entry of entries) {
    const m = entry.method;
    out.push(`\t\tCase "${m.name.toLowerCase()}"`);
    const args = m.params.map((_, idx) => `Args.Get(${idx})`).join(', ');
    if (m.returnType) {
      out.push(`\t\t\tB4XPP_Runtime.SetResult(${m.name}${formatCallArgs(args)})`);
      out.push('\t\t\tReturn');
    } else {
      out.push(`\t\t\t${m.name}${formatCallArgs(args)}`);
      out.push('\t\t\tB4XPP_Runtime.SetResult(Null)');
      out.push('\t\t\tReturn');
    }
  }
  out.push('\tEnd Select');
  out.push('\tLog("B4X++ dynamic method not found: " & MethodName)');
  out.push('\tB4XPP_Runtime.SetResult(Null)');
  out.push('End Sub');
  return out;
}

function formatParams(method) {
  return method.params && method.params.length ? `(${method.params.map(p => p.raw).join(', ')})` : '';
}

function formatReturnType(method) {
  return method.returnType ? ` As ${method.returnType}` : '';
}

function formatCallArgs(args) {
  return args && args.trim() ? `(${args})` : '';
}

function transpileStaticCode(block, options = {}) {
  const lines = [];
  lines.push(...buildHeader('StaticCode', block.name, block.sourcePath, options));
  const bodyLines = block.lines || [];
  const hasProcessGlobals = bodyLines.some(line => /^\s*Sub\s+Process_Globals\b/i.test(String(line || '')));
  if (!hasProcessGlobals) {
    lines.push('Sub Process_Globals');
    lines.push('End Sub');
    lines.push('');
  }
  lines.push(...bodyLines);
  return {
    kind: 'static',
    fileName: `${block.name}.bas`,
    moduleName: block.name,
    sourcePath: block.sourcePath,
    content: trimTrailingBlankLines(lines).join('\n') + '\n',
    diagnostics: []
  };
}

function transpileClass(block, options = {}, programInfo, usesRuntime) {
  const diagnostics = [];
  const flat = flattenClassParts(block, options, programInfo, diagnostics, usesRuntime);
  let lines = [];
  lines.push(...buildHeader('Class', block.name, block.sourcePath, options));

  const metadata = [];
  if (block.extendsName) metadata.push(`' B4X++ Extends: ${block.extendsName}. Output is flattened into this .bas file.`);
  if (flat.ancestors && flat.ancestors.length) metadata.push(`' B4X++ flattened ancestors: ${flat.ancestors.map(a => a.name).join(' -> ')}.`);
  if (block.modifiers && block.modifiers.length) metadata.push(`' B4X++ class modifiers: ${block.modifiers.join(', ')}.`);
  if (block.implementsNames && block.implementsNames.length) metadata.push(`' B4X++ Implements: ${block.implementsNames.join(', ')}.`);
  if (metadata.length) lines.push(...metadata, '');

  if (flat.designerProperties.length || flat.events.length) {
    if (flat.ancestors && flat.ancestors.length) lines.push("' B4X++ inherited DesignerProperty / Event directives propagated to final class.");
    lines.push(...flat.designerProperties);
    lines.push(...flat.events);
    lines.push('');
  }

  const allFields = [];
  for (const part of flat.parts) allFields.push(...part.fields);
  lines.push(...makeClassGlobalsBlock(allFields));

  for (const part of flat.parts) {
    lines.push(...part.body);
    if (part !== flat.parts[flat.parts.length - 1]) lines.push('');
  }

  lines.push(...makeDispatcher(block, programInfo, usesRuntime));

  return {
    kind: 'class',
    fileName: `${block.name}.bas`,
    moduleName: block.name,
    sourcePath: block.sourcePath,
    content: trimTrailingBlankLines(lines).join('\n') + '\n',
    diagnostics
  };
}

function transpileMainModule(mainName, topLevelLines, sourcePath, options = {}, programInfo, usesRuntime) {
  const fakeBlock = {
    type: 'main',
    name: mainName,
    sourcePath,
    startLine: 1,
    extendsName: null,
    lines: topLevelLines
  };
  const diagnostics = [];
  const lines = [];
  lines.push(...buildHeader('MainModule', mainName, sourcePath, options));
  lines.push(...transformBodyLines(topLevelLines, fakeBlock, diagnostics, programInfo, usesRuntime));
  return {
    kind: 'main',
    fileName: `${mainName}.bas`,
    moduleName: mainName,
    sourcePath,
    content: trimTrailingBlankLines(lines).join('\n') + '\n',
    diagnostics
  };
}

function transpileParsedFiles(parsedFiles, options = {}) {
  const outputs = [];
  const diagnostics = [];
  const usesRuntime = { value: false };

  for (const parsed of parsedFiles) diagnostics.push(...parsed.diagnostics);
  const programInfo = createProgramInfo(parsedFiles, diagnostics);
  validateProgram(parsedFiles, programInfo, diagnostics);
  validateStrictSemanticProgram(parsedFiles, programInfo, diagnostics, options);
  usesRuntime.value = programUsesDynamicDispatch(parsedFiles, programInfo);

  const seen = new Set();
  for (const parsed of parsedFiles) {
    for (const mod of parsed.staticCodes || []) {
      if (seen.has(mod.name.toLowerCase())) continue;
      seen.add(mod.name.toLowerCase());
      const out = transpileStaticCode(mod, options);
      diagnostics.push(...out.diagnostics);
      outputs.push(out);
    }

    for (const cls of parsed.classes) {
      if (seen.has(cls.name.toLowerCase())) continue;
      seen.add(cls.name.toLowerCase());
      const out = transpileClass(cls, options, programInfo, usesRuntime);
      diagnostics.push(...out.diagnostics);
      outputs.push(out);
    }

    const configuredMain = sanitizeModuleName(options.mainModuleName || '');
    const mainName = parsed.mainModuleName || configuredMain;
    if (mainName && hasMeaningfulCode(parsed.topLevelLines)) {
      const out = transpileMainModule(mainName, parsed.topLevelLines, parsed.sourcePath, options, programInfo, usesRuntime);
      diagnostics.push(...out.diagnostics);
      outputs.push(out);
    } else if (!mainName && hasMeaningfulCode(parsed.topLevelLines)) {
      diagnostics.push(makeDiagnostic(parsed.sourcePath, 1, 'warning', 'Top-level code was found, but no #MainModule is defined. No main module was generated.'));
    }
  }

  if (usesRuntime.value) outputs.push(makeRuntimeModule(options, usesRuntime.maxArgs));
  if (usesRuntime.usesClosure) outputs.push(makeClosureModule(options, usesRuntime.maxClosureArgs));

  return {
    outputs,
    diagnostics,
    project: programInfo.projects[0] || null,
    usesRuntime: usesRuntime.value,
    programInfo
  };
}


function makeClosureModule(options = {}, maxArgs = 5) {
  const argCount = Math.max(5, Math.min(10, Number(maxArgs || 0)));
  const lines = [];
  if (options.addGeneratedHeader) {
    lines.push(`' AUTO-GENERATED BY B4X++ v${options.generatorVersion || B4XPP_GENERATOR_VERSION}`);
    lines.push("' DO NOT EDIT THIS FILE DIRECTLY");
    lines.push(`' GeneratorVersion: ${options.generatorVersion || B4XPP_GENERATOR_VERSION}`);
    lines.push("' Source: B4X++ closure runtime");
    lines.push("' Class: B4XPPClosure");
    if (options.includeTimestamp) lines.push(`' Generated: ${new Date().toISOString()}`);
    lines.push('');
  }
  lines.push('Sub Class_Globals');
  lines.push('\tPrivate mCallback As Object');
  lines.push('\tPrivate mMethodName As String');
  lines.push('\tPrivate mCaptures As List');
  lines.push('End Sub');
  lines.push('');
  lines.push('Public Sub Initialize(Callback As Object, MethodName As String, Captures As List)');
  lines.push('\tmCallback = Callback');
  lines.push('\tmMethodName = MethodName');
  lines.push('\tmCaptures.Initialize');
  lines.push('\tIf Captures <> Null Then');
  lines.push('\t\tIf Captures.IsInitialized Then mCaptures = Captures');
  lines.push('\tEnd If');
  lines.push('End Sub');
  lines.push('');
  lines.push('Private Sub BuildContext(Args As List) As List');
  lines.push('\tDim ctx As List');
  lines.push('\tctx.Initialize');
  lines.push('\tctx.Add(mCaptures)');
  lines.push('\tctx.Add(Args)');
  lines.push('\tReturn ctx');
  lines.push('End Sub');
  lines.push('');
  lines.push('Private Sub NewArgs As List');
  lines.push('\tDim args As List');
  lines.push('\targs.Initialize');
  lines.push('\tReturn args');
  lines.push('End Sub');
  lines.push('');
  lines.push('Public Sub Run As Object');
  lines.push('\tReturn CallSub2(mCallback, mMethodName, BuildContext(NewArgs))');
  lines.push('End Sub');
  for (let i = 1; i <= argCount; i++) {
    const params = [];
    const adds = [];
    const pass = [];
    for (let j = 1; j <= i; j++) { params.push(`Arg${j} As Object`); adds.push(`\targs.Add(Arg${j})`); pass.push(`Arg${j}`); }
    lines.push('');
    lines.push(`Public Sub Run${i}(${params.join(', ')}) As Object`);
    lines.push('\tDim args As List = NewArgs');
    lines.push(...adds);
    lines.push('\tReturn CallSub2(mCallback, mMethodName, BuildContext(args))');
    lines.push('End Sub');
    lines.push('');
    lines.push(`Public Sub Invoke${i}(${params.join(', ')}) As Object`);
    lines.push(`\tReturn Run${i}(${pass.join(', ')})`);
    lines.push('End Sub');
  }
  lines.push('');
  lines.push("' Alias for users who prefer Invoke naming in generated B4X.");
  lines.push('Public Sub Invoke As Object');
  lines.push('\tReturn Run');
  lines.push('End Sub');
  return {
    kind: 'class',
    fileName: 'B4XPPClosure.bas',
    moduleName: 'B4XPPClosure',
    sourcePath: 'B4X++ closure runtime',
    content: trimTrailingBlankLines(lines).join('\n') + '\n',
    diagnostics: []
  };
}

function makeRuntimeModule(options = {}, maxArgs = 2) {
  const lines = [];
  const argCount = Math.max(2, Math.min(20, Number(maxArgs || 0)));
  if (options.forceDesignHeader) {
    lines.push(...buildHeader('StaticCode', 'B4XPP_Runtime', 'B4X++ runtime', options));
  }
  if (options.addGeneratedHeader) {
    lines.push(`' AUTO-GENERATED BY B4X++ v${options.generatorVersion || B4XPP_GENERATOR_VERSION}`);
    lines.push("' DO NOT EDIT THIS FILE DIRECTLY");
    lines.push(`' GeneratorVersion: ${options.generatorVersion || B4XPP_GENERATOR_VERSION}`);
    lines.push("' Source: B4X++ runtime");
    lines.push("' CodeModule: B4XPP_Runtime");
    if (options.includeTimestamp) lines.push(`' Generated: ${new Date().toISOString()}`);
    lines.push('');
  }
  lines.push('Sub Process_Globals');
  lines.push('\tPrivate LastResult As Object');
  lines.push('End Sub');
  lines.push('');
  lines.push("' Advanced dynamic dispatch. B4X++ generated classes expose B4XPP_Dispatch(MethodName, Args As List).");
  lines.push("' The real method arguments are packed in Args, so B4X++ targets support any number of parameters.");
  lines.push("' The CallSub fallback is only for external / non-B4X++ objects and is limited by B4X itself.");
  lines.push("' Args0 / ArgsN helpers avoid generating Array As Object expressions in user modules.");
  lines.push('Public Sub Dispatch(Target As Object, MethodName As String, Args As List) As Object');
  lines.push('\tLastResult = Null');
  lines.push('\tIf Target = Null Then');
  lines.push('\t\tLog("B4X++ dispatch target is Null: " & MethodName)');
  lines.push('\t\tReturn Null');
  lines.push('\tEnd If');
  lines.push('\tIf Args = Null Then Args = Args0');
  lines.push('\tIf SubExists(Target, "B4XPP_Dispatch") Then');
  lines.push('\t\tCallSub3(Target, "B4XPP_Dispatch", MethodName, Args)');
  lines.push('\t\tReturn LastResult');
  lines.push('\tEnd If');
  lines.push('\tReturn DispatchExternal(Target, MethodName, Args)');
  lines.push('End Sub');
  lines.push('');
  lines.push("' Fallback for objects that were not generated by B4X++.");
  lines.push("' B4X only exposes CallSub / CallSub2 / CallSub3, so this path supports 0..2 user arguments.");
  lines.push("' For unlimited arguments, use B4X++ generated classes or write a small B4X++ adapter wrapper.");
  lines.push('Private Sub DispatchExternal(Target As Object, MethodName As String, Args As List) As Object');
  lines.push('\tSelect Args.Size');
  lines.push('\t\tCase 0');
  lines.push('\t\t\tReturn Call0(Target, MethodName)');
  lines.push('\t\tCase 1');
  lines.push('\t\t\tReturn Call1(Target, MethodName, Args.Get(0))');
  lines.push('\t\tCase 2');
  lines.push('\t\t\tReturn Call2(Target, MethodName, Args.Get(0), Args.Get(1))');
  lines.push('\t\tCase Else');
  lines.push('\t\t\tLog("B4X++ external dispatch needs a B4X++ adapter for more than 2 parameters: " & MethodName)');
  lines.push('\t\t\tReturn Null');
  lines.push('\tEnd Select');
  lines.push('End Sub');
  lines.push('');
  lines.push('Public Sub SetResult(Value As Object)');
  lines.push('\tLastResult = Value');
  lines.push('End Sub');
  lines.push('');
  lines.push('Public Sub Args0 As List');
  lines.push('\tDim L As List');
  lines.push('\tL.Initialize');
  lines.push('\tReturn L');
  lines.push('End Sub');
  for (let i = 1; i <= argCount; i++) {
    lines.push('');
    const params = [];
    for (let n = 1; n <= i; n++) params.push(`Arg${n} As Object`);
    lines.push(`Public Sub Args${i}(${params.join(', ')}) As List`);
    lines.push('\tDim L As List');
    lines.push('\tL.Initialize');
    for (let n = 1; n <= i; n++) lines.push(`\tL.Add(Arg${n})`);
    lines.push('\tReturn L');
    lines.push('End Sub');
  }
  lines.push('');
  lines.push('Public Sub Call0(Target As Object, MethodName As String) As Object');
  lines.push('    Return CallSub(Target, MethodName)');
  lines.push('End Sub');
  lines.push('');
  lines.push('Public Sub Call1(Target As Object, MethodName As String, Arg1 As Object) As Object');
  lines.push('    Return CallSub2(Target, MethodName, Arg1)');
  lines.push('End Sub');
  lines.push('');
  lines.push('Public Sub Call2(Target As Object, MethodName As String, Arg1 As Object, Arg2 As Object) As Object');
  lines.push('    Return CallSub3(Target, MethodName, Arg1, Arg2)');
  lines.push('End Sub');
  return {
    kind: 'runtime',
    fileName: 'B4XPP_Runtime.bas',
    moduleName: 'B4XPP_Runtime',
    sourcePath: 'B4X++ runtime',
    content: trimTrailingBlankLines(lines).join('\n') + '\n',
    diagnostics: []
  };
}

function transpileText(sourcePath, text, options = {}) {
  const expanded = expandIncludes(sourcePath, text, options);
  const parsed = parseBxFile(sourcePath, expanded.text, options);
  parsed.diagnostics.unshift(...expanded.diagnostics);
  return transpileParsedFiles([parsed], options);
}

function transpileFiles(files, options = {}) {
  const diagnosticsByPath = new Map();
  const included = discoverIncludedFiles(files, options);
  const rootFiles = files.filter(f => !included.has(path.resolve(f)));
  const parsedFiles = [];

  for (const file of rootFiles) {
    const text = fs.readFileSync(file, 'utf8');
    const expanded = expandIncludes(file, text, options);
    const parsed = parseBxFile(file, expanded.text, options);
    parsed.diagnostics.unshift(...expanded.diagnostics);
    parsedFiles.push(parsed);
  }

  const result = transpileParsedFiles(parsedFiles, options);
  for (const file of files) diagnosticsByPath.set(path.resolve(file), []);
  for (const d of result.diagnostics) {
    const key = path.resolve(d.sourcePath || rootFiles[0] || '');
    if (!diagnosticsByPath.has(key)) diagnosticsByPath.set(key, []);
    diagnosticsByPath.get(key).push(d);
  }

  return {
    ...result,
    files: rootFiles,
    includedFiles: Array.from(included),
    diagnosticsByPath
  };
}

function parseB4XIdeProjectHeader(text, fileName = '') {
  const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const header = {
    platform: inferB4XIdePlatformFromFileName(fileName),
    appType: '',
    builds: [],
    packageName: '',
    files: [],
    fileGroups: [],
    group: '',
    libraries: [],
    modules: [],
    version: '',
    manifestCode: '',
    raw: {},
    endOfDesignTextLine: -1
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^@EndOfDesignText@\s*$/i.test(raw.trim())) { header.endOfDesignTextLine = i + 1; break; }
    const m = raw.match(/^([^=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const value = m[2];
    header.raw[key] = value;
    let n;
    if (/^AppType$/i.test(key)) header.appType = value.trim();
    else if ((n = key.match(/^Build(\d+)$/i))) {
      const parts = value.split(',');
      header.builds[Number(n[1]) - 1] = { name: (parts[0] || '').trim(), packageName: (parts[1] || '').trim(), value };
      if (!header.packageName && parts[1]) header.packageName = parts[1].trim();
    }
    else if ((n = key.match(/^Library(\d+)$/i))) header.libraries[Number(n[1]) - 1] = value.trim();
    else if ((n = key.match(/^Module(\d+)$/i))) header.modules[Number(n[1]) - 1] = value.trim();
    else if ((n = key.match(/^File(\d+)$/i))) header.files[Number(n[1]) - 1] = value.trim();
    else if ((n = key.match(/^FileGroup(\d+)$/i))) header.fileGroups[Number(n[1]) - 1] = value.trim();
    else if (/^Group$/i.test(key)) header.group = value.trim();
    else if (/^Version$/i.test(key)) header.version = value.trim();
    else if (/^ManifestCode$/i.test(key)) header.manifestCode = value;
  }
  header.builds = header.builds.filter(Boolean);
  header.files = header.files.filter(Boolean);
  header.fileGroups = header.fileGroups.filter(Boolean);
  header.libraries = uniqueStrings(header.libraries.filter(Boolean));
  header.modules = header.modules.filter(Boolean);
  return header;
}

function inferB4XIdePlatformFromFileName(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (/\.b4a$/.test(lower)) return 'b4a';
  if (/\.b4j$/.test(lower)) return 'b4j';
  if (/\.b4i$/.test(lower)) return 'b4i';
  return '';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  B4XPP_GENERATOR_VERSION,
  parseBxFile,
  transpileText,
  transpileFiles,
  transpileParsedFiles,
  sanitizeModuleName,
  sanitizeProjectPlatform,
  expandIncludes,
  splitArguments,
  parseB4XLibraryXml,
  parseB4XLibFile,
  parseB4XIdeProjectHeader,
  readZipEntries,
  buildB4XLibraryIndex,
  clearB4XLibraryIndexCache
};
