'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const crypto = require('crypto');
const { transpileText, transpileFiles, B4XPP_GENERATOR_VERSION } = require('./lib/transpiler');

let diagnosticCollection;
let b4xppOutputChannel;

function activate(context) {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('b4xpp');
  b4xppOutputChannel = vscode.window.createOutputChannel('B4X++');
  context.subscriptions.push(diagnosticCollection);
  context.subscriptions.push(b4xppOutputChannel);

  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.generateBas', generateBasCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.createExample', createExampleCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.showGeneratedFolder', showGeneratedFolderCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.createIdeProject', createIdeProjectCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.syncDirectiveProject', syncDirectiveProjectCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.buildB4XLib', buildB4XLibCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.remapB4XErrors', remapB4XErrorsCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.generateDebugBundle', generateDebugBundleCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.buildB4JWithRemap', buildB4JWithRemapCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.refreshIntelliSense', refreshIntelliSenseCommand));

  const navigationProvider = new B4XPPSymbolNavigationProvider();
  context.subscriptions.push(vscode.languages.registerDefinitionProvider({ language: 'b4xpp' }, navigationProvider));
  context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ language: 'b4xpp' }, navigationProvider));

  const completionProvider = new B4XPPCompletionProvider();
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'b4xpp' }, completionProvider, '.', ' '));

  const intelliSenseProvider = new B4XPPV3IntelliSenseProvider();
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'b4xpp' }, intelliSenseProvider, '.', ' ', '#'));
  context.subscriptions.push(vscode.languages.registerHoverProvider({ language: 'b4xpp' }, intelliSenseProvider));
  context.subscriptions.push(vscode.languages.registerSignatureHelpProvider({ language: 'b4xpp' }, intelliSenseProvider, '(', ','));
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ language: 'b4xpp' }, intelliSenseProvider));
  context.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(new B4XPPV3WorkspaceSymbolProvider()));
  context.subscriptions.push(vscode.languages.registerDefinitionProvider({ language: 'b4xpp' }, new B4XPPV32NavigationProvider()));
  context.subscriptions.push(vscode.languages.registerReferenceProvider({ language: 'b4xpp' }, new B4XPPV32ReferenceProvider()));
  context.subscriptions.push(vscode.languages.registerRenameProvider({ language: 'b4xpp' }, new B4XPPV32RenameProvider()));
  context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ language: 'b4xpp' }, new B4XPPV32CodeActionProvider(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite] }));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.validateB4XLibCustomViews', validateB4XLibCustomViewsCommand));

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.languageId === 'b4xpp') validateDocument(doc);
  }));

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && editor.document.languageId === 'b4xpp') validateDocument(editor.document);
  }));

  if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId === 'b4xpp') {
    validateDocument(vscode.window.activeTextEditor.document);
  }
}

function deactivate() {}

function getWorkspaceFolder() {
  const active = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri;
  if (active) {
    const folder = vscode.workspace.getWorkspaceFolder(active);
    if (folder) return folder;
  }
  const folders = vscode.workspace.workspaceFolders || [];
  return folders[0] || null;
}

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('b4xpp');
  return {
    sourceDir: cfg.get('sourceDir') || 'src-b4xpp',
    outputDir: cfg.get('outputDir') || 'generated-b4x',
    mainModuleName: cfg.get('mainModuleName') || '',
    addGeneratedHeader: cfg.get('addGeneratedHeader') !== false,
    overwriteGeneratedFiles: cfg.get('overwriteGeneratedFiles') !== false,
    includeTimestamp: cfg.get('includeTimestamp') === true,
    projectDir: cfg.get('projectDir') || 'b4x-ide-projects',
    packageName: cfg.get('packageName') || 'b4xpp.example',
    mobileMainModuleName: cfg.get('mobileMainModuleName') || 'B4XPPMain',
    b4xlibDir: cfg.get('b4xlibDir') || 'b4x-libs',
    b4jBuildCommand: cfg.get('b4jBuildCommand') || '',
    writeLineSourceMap: cfg.get('writeLineSourceMap') !== false,
    enableSemanticDiagnostics: cfg.get('enableSemanticDiagnostics') !== false,
    generatorVersion: B4XPP_GENERATOR_VERSION
  };
}

async function ensureSourceFolderOrOfferExample(root, config) {
  const sourceRoot = path.join(root, config.sourceDir);
  if (fs.existsSync(sourceRoot)) return true;
  const choice = await vscode.window.showWarningMessage(
    `B4X++: the source folder "${config.sourceDir}" does not exist.`,
    'Create example',
    'Cancel'
  );
  if (choice === 'Create example') {
    await createExampleCommand();
    return fs.existsSync(sourceRoot);
  }
  return false;
}

function transpileWorkspace(root, config) {
  const sourceRoot = path.join(root, config.sourceDir);
  const files = collectBxFiles(sourceRoot);
  const result = transpileFiles(files, {
    ...config,
    workspaceRoot: root
  });

  const allDiagnostics = new Map();
  for (const file of files) {
    const key = path.resolve(file);
    allDiagnostics.set(vscode.Uri.file(file).toString(), result.diagnosticsByPath.get(key) || []);
  }

  const generatedNames = new Map();
  let warningCount = (result.diagnostics || []).filter(d => d.severity === 'warning').length;
  const errorCount = (result.diagnostics || []).filter(d => d.severity === 'error').length;
  const outputs = [];

  for (const out of result.outputs) {
    const key = out.fileName.toLowerCase();
    if (generatedNames.has(key)) {
      warningCount++;
      vscode.window.showWarningMessage(`B4X++: ${out.fileName} is generated more than once. The last module was kept.`);
    }
    generatedNames.set(key, out.sourcePath || '');
    outputs.push(out);
  }

  return {
    files: result.files || files,
    includedFiles: result.includedFiles || [],
    outputs,
    allDiagnostics,
    warningCount,
    errorCount,
    project: result.project || null,
    usesRuntime: result.usesRuntime === true,
    diagnostics: result.diagnostics || [],
    programInfo: result.programInfo || null
  };
}

async function generateBasCommand() {
  const folder = getWorkspaceFolder();
  if (!folder) {
    vscode.window.showErrorMessage('B4X++: open a VS Code project folder first.');
    return;
  }

  const config = getConfig();
  const root = folder.uri.fsPath;
  if (!(await ensureSourceFolderOrOfferExample(root, config))) return;

  const sourceRoot = path.join(root, config.sourceDir);
  const outputRoot = path.join(root, config.outputDir);
  const files = collectBxFiles(sourceRoot);
  if (files.length === 0) {
    vscode.window.showInformationMessage(`B4X++: no .bx file found in ${config.sourceDir}.`);
    return;
  }

  fs.mkdirSync(outputRoot, { recursive: true });
  const result = transpileWorkspace(root, config);
  publishDiagnostics(result.allDiagnostics);

  const plannedTargets = result.outputs.map(out => path.join(outputRoot, out.fileName));
  if (!(await confirmGeneratedVersionOverwrite(root, plannedTargets))) return;

  const written = [];
  for (const out of result.outputs) {
    const target = path.join(outputRoot, out.fileName);
    if (fs.existsSync(target) && !config.overwriteGeneratedFiles) continue;
    fs.writeFileSync(target, out.content, 'utf8');
    written.push(target);
  }

  writeB4XPPMetadata(root, result, outputRoot);

  const relOut = path.relative(root, outputRoot).replace(/\\/g, '/');
  const message = `B4X++: ${written.length} .bas file(s) generated in ${relOut}. ${result.errorCount} error(s), ${result.warningCount} warning(s).`;
  if (result.errorCount > 0) vscode.window.showErrorMessage(message);
  else if (result.warningCount > 0) vscode.window.showWarningMessage(message);
  else vscode.window.showInformationMessage(message);
}

async function createIdeProjectCommand() {
  const folder = getWorkspaceFolder();
  if (!folder) {
    vscode.window.showErrorMessage('B4X++: open a VS Code project folder first.');
    return;
  }

  const config = getConfig();
  const root = folder.uri.fsPath;
  if (!(await ensureSourceFolderOrOfferExample(root, config))) return;

  const sourceRoot = path.join(root, config.sourceDir);
  const files = collectBxFiles(sourceRoot);
  if (files.length === 0) {
    vscode.window.showInformationMessage(`B4X++: no .bx file found in ${config.sourceDir}.`);
    return;
  }

  const platform = await vscode.window.showQuickPick([
    { label: 'B4J Non-UI / Console', description: '.b4j - recommended for testing B4X++ OOP', value: 'b4j-nonui' },
    { label: 'B4J UI / JavaFX', description: '.b4j - empty JavaFX window if your code does not load a layout', value: 'b4j-ui' },
    { label: 'B4A Android', description: '.b4a - creates the Main Activity + .bas modules', value: 'b4a' },
    { label: 'B4i iOS', description: '.b4i - creates the main Application_Start module + .bas modules', value: 'b4i' }
  ], {
    placeHolder: 'Choose the B4X IDE project type to create'
  });
  if (!platform) return;

  const workspaceName = sanitizeProjectName(path.basename(root)) || 'B4XPPDemo';
  const projectNameInput = await vscode.window.showInputBox({
    title: 'B4X++: project name',
    prompt: 'Name of the B4X project to create',
    value: workspaceName,
    validateInput: (value) => sanitizeProjectName(value) ? undefined : 'Use a simple name: letters, digits and underscore, starting with a letter.'
  });
  if (!projectNameInput) return;
  const projectName = sanitizeProjectName(projectNameInput);

  const packageNameInput = await vscode.window.showInputBox({
    title: 'B4X++: package / application id',
    prompt: 'Used in Build1=Default,<package>. Example: b4xpp.demo',
    value: sanitizePackageName(config.packageName) || `b4xpp.${projectName.toLowerCase()}`,
    validateInput: (value) => sanitizePackageName(value) ? undefined : 'Invalid package. Valid example: b4xpp.demo'
  });
  if (!packageNameInput) return;
  const packageName = sanitizePackageName(packageNameInput);

  const result = transpileWorkspace(root, config);
  publishDiagnostics(result.allDiagnostics);
  if (result.errorCount > 0) {
    const choice = await vscode.window.showWarningMessage(
      `B4X++: ${result.errorCount} transpilation error(s) detected. Create the project anyway?`,
      'Create anyway',
      'Cancel'
    );
    if (choice !== 'Create anyway') return;
  }

  const suffix = platform.value.replace('b4j-', 'b4j-');
  const projectRoot = path.join(root, config.projectDir, `${projectName}-${suffix}`);
  if (fs.existsSync(projectRoot) && fs.readdirSync(projectRoot).length > 0) {
    const choice = await vscode.window.showWarningMessage(
      `B4X++: folder ${path.relative(root, projectRoot)} already exists.`,
      'Overwrite',
      'Cancel'
    );
    if (choice !== 'Overwrite') return;
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(projectRoot, { recursive: true });

  const project = writeIdeProject(projectRoot, platform.value, projectName, packageName, result.outputs, config);
  writeB4XPPMetadata(root, result, projectRoot);
  const relProject = path.relative(root, project.filePath).replace(/\\/g, '/');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(project.filePath));
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage(`B4X++: ${project.label} project created: ${relProject}. Open this file in the B4X IDE to compile.`);
}


async function syncDirectiveProjectCommand() {
  const folder = getWorkspaceFolder();
  if (!folder) {
    vscode.window.showErrorMessage('B4X++: open a VS Code project folder first.');
    return;
  }

  const config = getConfig();
  const root = folder.uri.fsPath;
  if (!(await ensureSourceFolderOrOfferExample(root, config))) return;

  const sourceRoot = path.join(root, config.sourceDir);
  const files = collectBxFiles(sourceRoot);
  if (files.length === 0) {
    vscode.window.showInformationMessage(`B4X++: no .bx file found in ${config.sourceDir}.`);
    return;
  }

  const result = transpileWorkspace(root, config);
  publishDiagnostics(result.allDiagnostics);

  if (!result.project) {
    vscode.window.showWarningMessage('B4X++: no #Project directive found. Add for example: #Project B4J-NonUI Demo.');
    return;
  }

  if (result.errorCount > 0) {
    const choice = await vscode.window.showWarningMessage(
      `B4X++: ${result.errorCount} transpilation error(s) detected. Generate the #Project anyway?`,
      'Generate anyway',
      'Cancel'
    );
    if (choice !== 'Generate anyway') return;
  }

  const projectName = sanitizeProjectName(result.project.name) || sanitizeProjectName(path.basename(root)) || 'B4XPPDemo';
  const packageName = sanitizePackageName(result.project.packageName || config.packageName) || `b4xpp.${projectName.toLowerCase()}`;
  const platform = result.project.platform;
  const projectDir = result.project.projectDir || path.join(config.projectDir, `${projectName}-${platform}`);
  const projectRoot = path.isAbsolute(projectDir) ? projectDir : path.join(root, projectDir);

  if (fs.existsSync(projectRoot) && fs.readdirSync(projectRoot).length > 0) {
    const choice = await vscode.window.showWarningMessage(
      `B4X++: project folder ${path.relative(root, projectRoot).replace(/\\/g, '/')} already exists.`,
      'Sync / overwrite generated files',
      'Cancel'
    );
    if (choice !== 'Sync / overwrite generated files') return;
  }
  fs.mkdirSync(projectRoot, { recursive: true });

  if (!(await confirmGeneratedVersionOverwrite(root, findGeneratedFilesInFolder(projectRoot)))) return;

  const projectConfig = {
    ...config,
    mobileMainModuleName: result.project.mobileMainModuleName || config.mobileMainModuleName
  };
  const project = writeIdeProject(projectRoot, platform, projectName, packageName, result.outputs, projectConfig);
  writeB4XPPMetadata(root, result, projectRoot);
  const relProject = path.relative(root, project.filePath).replace(/\\/g, '/');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(project.filePath));
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage(`B4X++: #Project synchronized: ${relProject}. The .bas files used by the B4X IDE are directly in this folder.`);
}



function writeB4XPPMetadata(root, result, targetRoot) {
  try {
    const metaRoot = path.join(root, '.b4xpp');
    fs.mkdirSync(metaRoot, { recursive: true });
    fs.writeFileSync(path.join(metaRoot, 'symbols.json'), JSON.stringify(buildSymbolsMetadata(root, result), null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(metaRoot, 'sourceMap.json'), JSON.stringify(buildSourceMapMetadata(root, result, targetRoot), null, 2) + '\n', 'utf8');
  } catch (err) {
    vscode.window.showWarningMessage(`B4X++: metadata generation failed: ${err.message}`);
  }
}

function buildSymbolsMetadata(root, result) {
  const symbols = [];
  const programInfo = result && result.programInfo;
  const rel = (file) => file && !String(file).startsWith('B4X++') ? path.relative(root, file).replace(/\\/g, '/') : file;

  if (programInfo && programInfo.classes) {
    for (const cls of programInfo.classes.values()) {
      symbols.push({ kind: 'class', name: cls.name, visibility: 'public', source: rel(cls.sourcePath), line: cls.startLine || 1, extends: cls.extendsName || null, implements: cls.implementsNames || [], modifiers: cls.modifiers || [] });
      for (const method of cls.methods || []) {
        symbols.push({ kind: 'method', name: method.name, owner: cls.name, visibility: method.visibility || 'public', modifiers: method.modifiers || [], returnType: method.returnType || '', parameters: (method.params || []).map(p => ({ name: p.name, type: p.type || '' })), source: rel(cls.sourcePath), line: (cls.startLine || 1) + (method.lineIndex || 0) });
      }
      for (const prop of collectPropertySymbolsFromLines(cls.lines || [])) {
        symbols.push({ kind: 'property', owner: cls.name, source: rel(cls.sourcePath), line: (cls.startLine || 1) + prop.lineOffset, ...prop.symbol });
      }
    }
  }

  if (programInfo && programInfo.interfaces) {
    for (const intf of programInfo.interfaces.values()) {
      symbols.push({ kind: 'interface', name: intf.name, visibility: 'public', source: rel(intf.sourcePath), line: intf.startLine || 1 });
      for (const method of intf.methods || []) {
        symbols.push({ kind: 'interfaceMethod', name: method.name, owner: intf.name, visibility: 'public', returnType: method.returnType || '', parameters: (method.params || []).map(p => ({ name: p.name, type: p.type || '' })), source: rel(intf.sourcePath), line: (intf.startLine || 1) + (method.lineIndex || 0) });
      }
    }
  }

  if (programInfo && programInfo.staticCodes) {
    for (const mod of programInfo.staticCodes.values()) {
      symbols.push({ kind: 'staticCode', name: mod.name, visibility: 'public', source: rel(mod.sourcePath), line: mod.startLine || 1 });
    }
  }

  return { generatorVersion: B4XPP_GENERATOR_VERSION, generatedAt: new Date().toISOString(), symbols };
}

function collectPropertySymbolsFromLines(lines) {
  const out = [];
  for (let i = 0; i < (lines || []).length; i++) {
    const raw = splitCodeAndCommentForNavigation(lines[i]).code.trim();
    const m = raw.match(/^#Property\s+(.+?)\s+As\s+(.+)$/i);
    if (!m) continue;
    const tokens = (m[1] || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens[tokens.length - 1];
    let visibility = 'public';
    let mode = '';
    for (const token of tokens.slice(0, -1)) {
      const lower = token.toLowerCase();
      if (['public', 'private', 'protected'].includes(lower)) visibility = lower;
      if (['readonly', 'writeonly'].includes(lower)) mode = lower;
    }
    let type = (m[2] || '').trim();
    let defaultValue = null;
    const eq = type.indexOf('=');
    if (eq >= 0) {
      defaultValue = type.slice(eq + 1).trim();
      type = type.slice(0, eq).trim();
    }
    out.push({ lineOffset: i, symbol: { name, visibility, mode: mode || 'readwrite', type, defaultValue } });
  }
  return out;
}

function buildSourceMapMetadata(root, result, targetRoot) {
  const rel = (file) => file && !String(file).startsWith('B4X++') ? path.relative(root, file).replace(/\\/g, '/') : file;
  const generatedRoot = targetRoot ? path.relative(root, targetRoot).replace(/\\/g, '/') : '';
  const sourceIndex = buildSourceLineIndex(root, result);
  const programInfo = result && result.programInfo;
  const outputs = (result.outputs || []).map(out => {
    const generated = generatedRoot ? `${generatedRoot}/${out.fileName}` : out.fileName;
    const ownerSources = getLikelySourceFilesForOutput(out, programInfo).map(rel).filter(Boolean);
    const mappings = buildBestEffortLineMappings(root, out, ownerSources, sourceIndex);
    return {
      generated,
      module: out.moduleName,
      kind: out.kind,
      source: rel(out.sourcePath),
      sources: ownerSources,
      lineOffset: 1,
      mappings,
      note: 'Best-effort line mappings generated from transformed .bas output and original .bx source. Exact transformed lines map directly; generated helper lines fall back to nearest module/source context.'
    };
  });

  return {
    schemaVersion: 2,
    generatorVersion: B4XPP_GENERATOR_VERSION,
    generatedAt: new Date().toISOString(),
    generatedRoot,
    outputs,
    diagnostics: (result.diagnostics || []).map(d => ({ severity: d.severity, message: d.message, source: rel(d.sourcePath), line: d.line || 1 }))
  };
}

function buildSourceLineIndex(root, result) {
  const files = new Set();
  for (const f of (result.files || [])) files.add(path.resolve(f));
  for (const f of (result.includedFiles || [])) files.add(path.resolve(f));
  const programInfo = result && result.programInfo;
  if (programInfo) {
    for (const cls of programInfo.classes.values()) if (cls.sourcePath && !String(cls.sourcePath).startsWith('B4X++')) files.add(path.resolve(cls.sourcePath));
    for (const intf of programInfo.interfaces.values()) if (intf.sourcePath && !String(intf.sourcePath).startsWith('B4X++')) files.add(path.resolve(intf.sourcePath));
    for (const mod of programInfo.staticCodes.values()) if (mod.sourcePath && !String(mod.sourcePath).startsWith('B4X++')) files.add(path.resolve(mod.sourcePath));
  }
  const byNormalizedLine = new Map();
  const byFile = new Map();
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const relFile = path.relative(root, file).replace(/\\/g, '/');
    const lines = normalizeNewlines(fs.readFileSync(file, 'utf8')).split('\n');
    byFile.set(relFile, lines);
    for (let i = 0; i < lines.length; i++) {
      for (const key of sourceLineKeys(lines[i])) {
        if (!byNormalizedLine.has(key)) byNormalizedLine.set(key, []);
        byNormalizedLine.get(key).push({ source: relFile, sourceLine: i + 1, sourceText: lines[i] });
      }
    }
  }
  return { byNormalizedLine, byFile };
}

function getLikelySourceFilesForOutput(out, programInfo) {
  const sources = [];
  const add = (f) => { if (f && !String(f).startsWith('B4X++') && !sources.map(x => path.resolve(x).toLowerCase()).includes(path.resolve(f).toLowerCase())) sources.push(f); };
  add(out.sourcePath);
  if (!programInfo || !out.moduleName) return sources;
  const cls = programInfo.getClass && programInfo.getClass(out.moduleName);
  if (cls) {
    for (const ancestor of (programInfo.ancestorChain(out.moduleName) || []).slice().reverse()) add(ancestor.sourcePath);
    add(cls.sourcePath);
  }
  const stat = programInfo.staticCodes && programInfo.staticCodes.get(String(out.moduleName).toLowerCase());
  if (stat) add(stat.sourcePath);
  return sources;
}

function sourceLineKeys(line) {
  const raw = String(line || '');
  const code = splitCodeAndCommentForNavigation(raw).code.trim();
  if (!code) return [];
  const keys = new Set();
  keys.add(normalizeLineForSourceMap(code));
  // B4X++ visibility lowering: Protected fields/subs become Private in generated B4X.
  keys.add(normalizeLineForSourceMap(code.replace(/^Protected\s+/i, 'Private ')));
  // B4X++ modifiers disappear in generated .bas.
  keys.add(normalizeLineForSourceMap(code.replace(/^(?:Public|Private|Protected)?\s*(?:Override|Virtual|Final)\s+Sub\s+/i, (m) => {
    const vis = (/^\s*(Public|Private|Protected)/i.exec(m) || [,'Public'])[1];
    return `${vis === 'Protected' ? 'Private' : vis} Sub `;
  })));
  return Array.from(keys).filter(Boolean);
}

function normalizeLineForSourceMap(line) {
  return String(line || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),=:+\-*/&<>])\s*/g, '$1')
    .trim()
    .toLowerCase();
}

function buildBestEffortLineMappings(root, out, ownerSources, sourceIndex) {
  const generatedLines = normalizeNewlines(out.content || '').split('\n');
  const mappings = [];
  let lastBySource = new Map();
  const preferredSources = new Set((ownerSources || []).map(s => String(s).toLowerCase()));

  for (let i = 0; i < generatedLines.length; i++) {
    const generatedLine = i + 1;
    const raw = generatedLines[i] || '';
    const code = splitCodeAndCommentForNavigation(raw).code.trim();
    if (!code || /^'/.test(code) || /^#/.test(code)) continue;
    const key = normalizeLineForSourceMap(code);
    if (!key) continue;
    let candidates = (sourceIndex.byNormalizedLine.get(key) || []).slice();
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => scoreMappingCandidate(a, preferredSources, lastBySource) - scoreMappingCandidate(b, preferredSources, lastBySource));
    const chosen = candidates[0];
    lastBySource.set(chosen.source, chosen.sourceLine);
    mappings.push({
      generatedLine,
      source: chosen.source,
      sourceLine: chosen.sourceLine,
      confidence: preferredSources.has(String(chosen.source).toLowerCase()) ? 'exact-preferred' : 'exact',
      generatedText: raw.trim(),
      sourceText: String(chosen.sourceText || '').trim()
    });
  }
  return mappings;
}

function scoreMappingCandidate(candidate, preferredSources, lastBySource) {
  let score = 0;
  const sourceKey = String(candidate.source || '').toLowerCase();
  if (!preferredSources.has(sourceKey)) score += 100000;
  const last = lastBySource.get(candidate.source);
  if (last) {
    if (candidate.sourceLine < last) score += 1000 + (last - candidate.sourceLine);
    else score += Math.abs(candidate.sourceLine - last);
  } else {
    score += candidate.sourceLine / 1000;
  }
  return score;
}

function parseGeneratedVersion(content) {
  const text = normalizeNewlines(content || '');
  let m = text.match(/^'\s*AUTO-GENERATED BY B4X\+\+\s+v\.?([^\s]+)/im);
  if (m) return m[1].trim();
  m = text.match(/^'\s*GeneratorVersion:\s*([^\s]+)/im);
  if (m) return m[1].trim();
  if (/^'\s*AUTO-GENERATED BY B4X\+\+/im.test(text)) return 'pre-0.1';
  return null;
}

function isGeneratedByB4XPP(content) {
  return /^'\s*AUTO-GENERATED BY B4X\+\+/im.test(normalizeNewlines(content || ''));
}

function findGeneratedFilesInFolder(folder) {
  if (!fs.existsSync(folder)) return [];
  return collectAllFiles(folder).filter(file => /\.(bas|b4a|b4j|b4i)$/i.test(file));
}

async function confirmGeneratedVersionOverwrite(root, targets) {
  const mismatches = [];
  for (const file of targets || []) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (!isGeneratedByB4XPP(content)) continue;
    const version = parseGeneratedVersion(content) || 'unknown';
    if (version !== B4XPP_GENERATOR_VERSION) {
      mismatches.push({ file, version });
    }
  }
  if (!mismatches.length) return true;
  const sample = mismatches.slice(0, 5).map(m => `${path.relative(root, m.file).replace(/\\/g, '/')} (v${m.version})`).join(', ');
  const more = mismatches.length > 5 ? `, +${mismatches.length - 5} more` : '';
  const choice = await vscode.window.showWarningMessage(
    `B4X++: ${mismatches.length} generated file(s) were created by another generator version. Current generator is v${B4XPP_GENERATOR_VERSION}. ${sample}${more}`,
    'Overwrite',
    'Cancel'
  );
  return choice === 'Overwrite';
}

function collectBxFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectBxFiles(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.bx')) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

async function createExampleCommand() {
  const folder = getWorkspaceFolder();
  if (!folder) {
    vscode.window.showErrorMessage('B4X++: open a VS Code project folder first.');
    return;
  }

  const config = getConfig();
  const root = folder.uri.fsPath;
  const choice = await vscode.window.showQuickPick([
    {
      label: 'Basic OOP sample: Animal / Dog / Cat / Bird',
      description: `Copy into ${config.sourceDir}/ and open Demo.bx`,
      value: 'basic-to-src'
    },
    {
      label: 'Language showcase: most B4X++ keywords',
      description: `Copy into ${config.sourceDir}/ and open Demo.bx`,
      value: 'showcase-to-src'
    },
    {
      label: 'Create both GitHub examples',
      description: 'Copy both samples into examples/basic-animal and examples/language-showcase',
      value: 'both-to-examples'
    }
  ], {
    placeHolder: 'Choose the B4X++ example to create'
  });
  if (!choice) return;

  if (choice.value === 'both-to-examples') {
    const examplesRoot = path.join(root, 'examples');
    await writeExampleTemplateWithPrompt(path.join(examplesRoot, 'basic-animal', config.sourceDir), getBasicAnimalTemplate(), root);
    await writeExampleTemplateWithPrompt(path.join(examplesRoot, 'language-showcase', config.sourceDir), getLanguageShowcaseTemplate(), root);
    const readmePath = path.join(examplesRoot, 'README.md');
    if (!fs.existsSync(readmePath)) fs.writeFileSync(readmePath, getExamplesReadme(), 'utf8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(readmePath));
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage('B4X++: both examples were created under examples/. Open each example folder separately to test Sync #Project or Build .b4xlib.');
    return;
  }

  const template = choice.value === 'showcase-to-src' ? getLanguageShowcaseTemplate() : getBasicAnimalTemplate();
  const sourceRoot = path.join(root, config.sourceDir);
  await writeExampleTemplateWithPrompt(sourceRoot, template, root);
  const demoPath = path.join(sourceRoot, 'Demo.bx');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(demoPath));
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage(`B4X++: ${template.name} created in ${config.sourceDir}. Run "B4X++: Sync #Project" or "B4X++: Build .b4xlib".`);
}

async function writeExampleTemplateWithPrompt(targetSourceRoot, template, workspaceRoot) {
  const existing = Object.keys(template.files).filter(rel => fs.existsSync(path.join(targetSourceRoot, rel)));
  if (existing.length > 0) {
    const choice = await vscode.window.showWarningMessage(
      `B4X++: ${existing.length} example file(s) already exist in ${path.relative(workspaceRoot, targetSourceRoot).replace(/\\/g, '/')}.`,
      'Overwrite example files',
      'Keep existing files'
    );
    if (choice !== 'Overwrite example files') return;
  }
  for (const [rel, content] of Object.entries(template.files)) {
    const target = path.join(targetSourceRoot, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, normalizeNewlines(content).trimEnd() + '\n', 'utf8');
  }
}

async function showGeneratedFolderCommand() {
  const folder = getWorkspaceFolder();
  if (!folder) {
    vscode.window.showErrorMessage('B4X++: open a VS Code project folder first.');
    return;
  }
  const config = getConfig();
  const outputRoot = path.join(folder.uri.fsPath, config.outputDir);
  fs.mkdirSync(outputRoot, { recursive: true });
  await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputRoot));
}

async function buildB4XLibCommand() {
  const folder = getWorkspaceFolder();
  if (!folder) {
    vscode.window.showErrorMessage('B4X++: open a VS Code project folder first.');
    return;
  }

  const config = getConfig();
  const root = folder.uri.fsPath;
  if (!(await ensureSourceFolderOrOfferExample(root, config))) return;

  const sourceRoot = path.join(root, config.sourceDir);
  const files = collectBxFiles(sourceRoot);
  if (files.length === 0) {
    vscode.window.showInformationMessage(`B4X++: no .bx file found in ${config.sourceDir}.`);
    return;
  }

  const libConfig = parseB4XLibDirectives(root, config, files);
  if (!libConfig.name) {
    const input = await vscode.window.showInputBox({
      title: 'B4X++: B4X library name',
      prompt: 'Name of the .b4xlib to create. You can also add #B4XLib MyLibrary to a .bx file.',
      value: sanitizeProjectName(path.basename(root)) || 'B4XPPComponents',
      validateInput: (value) => sanitizeProjectName(value) ? undefined : 'Use a simple name: letters, digits and underscore, starting with a letter.'
    });
    if (!input) return;
    libConfig.name = sanitizeProjectName(input);
  }

  const result = transpileWorkspace(root, config);
  publishDiagnostics(result.allDiagnostics);
  if (result.errorCount > 0) {
    const choice = await vscode.window.showWarningMessage(
      `B4X++: ${result.errorCount} transpilation error(s) detected. Build the .b4xlib anyway?`,
      'Build anyway',
      'Cancel'
    );
    if (choice !== 'Build anyway') return;
  }

  const outDir = path.isAbsolute(libConfig.dir) ? libConfig.dir : path.join(root, libConfig.dir || config.b4xlibDir);
  fs.mkdirSync(outDir, { recursive: true });
  const libPath = path.join(outDir, `${libConfig.name}.b4xlib`);
  if (fs.existsSync(libPath)) {
    const choice = await vscode.window.showWarningMessage(
      `B4X++: ${path.relative(root, libPath).replace(/\\/g, '/')} already exists and will be replaced by generator v${B4XPP_GENERATOR_VERSION}.`,
      'Overwrite',
      'Cancel'
    );
    if (choice !== 'Overwrite') return;
  }

  const entries = [];
  const seen = new Set();
  for (const out of result.outputs) {
    // A .b4xlib is meant to be reused by other projects, so test/demo main modules are not packaged.
    if (out.kind === 'main') continue;
    const moduleName = sanitizeProjectName(out.moduleName || path.basename(out.fileName, '.bas'));
    if (!moduleName) continue;
    const entryName = `${moduleName}.bas`;
    if (seen.has(entryName.toLowerCase())) continue;
    seen.add(entryName.toLowerCase());
    entries.push({ name: entryName, data: Buffer.from(addB4XModuleDesignHeader(out.content, 'b4j', out.kind, { forceB4JHeader: true }), 'utf8') });
  }

  const manifest = makeB4XLibManifest(libConfig);
  entries.push({ name: 'manifest.txt', data: Buffer.from(manifest, 'utf8') });

  const filesRoot = resolveLibraryFilesDir(root, config, libConfig);
  if (filesRoot && fs.existsSync(filesRoot)) {
    for (const file of collectAllFiles(filesRoot)) {
      const rel = path.relative(filesRoot, file).replace(/\\/g, '/');
      entries.push({ name: `Files/${rel}`, data: fs.readFileSync(file) });
    }
  }

  writeZipStore(entries, libPath);
  writeB4XPPMetadata(root, result, outDir);
  const rel = path.relative(root, libPath).replace(/\\/g, '/');
  const moduleCount = entries.filter(e => e.name.toLowerCase().endsWith('.bas')).length;
  vscode.window.showInformationMessage(`B4X++: ${libConfig.name}.b4xlib built with ${moduleCount} module(s): ${rel}`);
}

function parseB4XLibDirectives(root, config, files) {
  const lib = {
    name: '',
    version: '1.00',
    author: '',
    dir: config.b4xlibDir,
    filesDir: '',
    dependsOn: [],
    b4aDependsOn: [],
    b4jDependsOn: [],
    b4iDependsOn: [],
    supportedPlatforms: []
  };

  for (const file of files) {
    const text = getWorkspaceText(file);
    const lines = normalizeNewlines(text).split('\n');
    for (const raw of lines) {
      const line = splitCodeAndCommentForNavigation(raw).code.trim();
      let m;
      if ((m = line.match(/^#B4XLib\s+(.+)$/i))) lib.name = sanitizeProjectName(m[1].trim().replace(/^['"]|['"]$/g, '')) || lib.name;
      else if ((m = line.match(/^#Version\s+(.+)$/i))) lib.version = m[1].trim().replace(/^['"]|['"]$/g, '') || lib.version;
      else if ((m = line.match(/^#Author\s+(.+)$/i))) lib.author = m[1].trim().replace(/^['"]|['"]$/g, '');
      else if ((m = line.match(/^#B4XLibDir\s+(.+)$/i))) lib.dir = m[1].trim().replace(/^['"]|['"]$/g, '') || lib.dir;
      else if ((m = line.match(/^#LibraryFilesDir\s+(.+)$/i))) lib.filesDir = m[1].trim().replace(/^['"]|['"]$/g, '');
      else if ((m = line.match(/^#DependsOn\s+(.+)$/i))) lib.dependsOn.push(...splitCsvDirective(m[1]));
      else if ((m = line.match(/^#B4ADependsOn\s+(.+)$/i))) lib.b4aDependsOn.push(...splitCsvDirective(m[1]));
      else if ((m = line.match(/^#B4JDependsOn\s+(.+)$/i))) lib.b4jDependsOn.push(...splitCsvDirective(m[1]));
      else if ((m = line.match(/^#B4iDependsOn\s+(.+)$/i))) lib.b4iDependsOn.push(...splitCsvDirective(m[1]));
      else if ((m = line.match(/^#SupportedPlatforms\s+(.+)$/i))) lib.supportedPlatforms.push(...splitCsvDirective(m[1]));
    }
  }

  lib.dependsOn = uniqueStrings(lib.dependsOn);
  lib.b4aDependsOn = uniqueStrings(lib.b4aDependsOn);
  lib.b4jDependsOn = uniqueStrings(lib.b4jDependsOn);
  lib.b4iDependsOn = uniqueStrings(lib.b4iDependsOn);
  lib.supportedPlatforms = uniqueStrings(lib.supportedPlatforms.map(s => s.toUpperCase().replace('B4I', 'B4i')));
  return lib;
}

function splitCsvDirective(value) {
  return String(value || '')
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
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

function normalizeB4XNumericVersion(version) {
  const raw = String(version || '1.00').trim();
  const m = raw.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!m) return raw || '1.00';
  if (!m[3]) return raw;
  // B4X library manager expects a numeric version like 0.10 or 1.20, not semver 0.1.0.
  return `${m[1]}.${m[2]}${m[3]}`;
}

function makeB4XLibManifest(lib) {
  const lines = [];
  if (lib.version) lines.push(`Version=${normalizeB4XNumericVersion(lib.version)}`);
  if (lib.author) lines.push(`Author=${lib.author}`);
  if (lib.dependsOn.length) lines.push(`DependsOn=${lib.dependsOn.join(', ')}`);
  if (lib.b4aDependsOn.length) lines.push(`B4A.DependsOn=${lib.b4aDependsOn.join(', ')}`);
  if (lib.b4jDependsOn.length) lines.push(`B4J.DependsOn=${lib.b4jDependsOn.join(', ')}`);
  if (lib.b4iDependsOn.length) lines.push(`B4i.DependsOn=${lib.b4iDependsOn.join(', ')}`);
  // Avoid the legacy / fragile Supported Platforms line. Platform support is inferred from B4A/B4J/B4i dependencies.
  return lines.join('\n') + '\n';
}

function resolveLibraryFilesDir(root, config, libConfig) {
  const candidates = [];
  if (libConfig.filesDir) candidates.push(path.isAbsolute(libConfig.filesDir) ? libConfig.filesDir : path.join(root, libConfig.filesDir));
  candidates.push(path.join(root, config.sourceDir, 'Files'));
  candidates.push(path.join(root, 'Files'));
  return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) || null;
}

function collectAllFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectAllFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function writeZipStore(entries, targetPath) {
  const fileRecords = [];
  const localParts = [];
  let offset = 0;
  const now = new Date();
  const dos = toDosDateTime(now);

  for (const entry of entries) {
    const name = String(entry.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name) continue;
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || ''), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    let p = 0;
    local.writeUInt32LE(0x04034b50, p); p += 4;
    local.writeUInt16LE(20, p); p += 2;
    local.writeUInt16LE(0x0800, p); p += 2; // UTF-8 names
    local.writeUInt16LE(0, p); p += 2; // store, no compression
    local.writeUInt16LE(dos.time, p); p += 2;
    local.writeUInt16LE(dos.date, p); p += 2;
    local.writeUInt32LE(crc, p); p += 4;
    local.writeUInt32LE(data.length, p); p += 4;
    local.writeUInt32LE(data.length, p); p += 4;
    local.writeUInt16LE(nameBuf.length, p); p += 2;
    local.writeUInt16LE(0, p); p += 2;
    nameBuf.copy(local, p);
    localParts.push(local, data);
    fileRecords.push({ nameBuf, crc, size: data.length, offset, dos });
    offset += local.length + data.length;
  }

  const centralParts = [];
  let centralSize = 0;
  for (const rec of fileRecords) {
    const c = Buffer.alloc(46 + rec.nameBuf.length);
    let p = 0;
    c.writeUInt32LE(0x02014b50, p); p += 4;
    c.writeUInt16LE(20, p); p += 2;
    c.writeUInt16LE(20, p); p += 2;
    c.writeUInt16LE(0x0800, p); p += 2;
    c.writeUInt16LE(0, p); p += 2;
    c.writeUInt16LE(rec.dos.time, p); p += 2;
    c.writeUInt16LE(rec.dos.date, p); p += 2;
    c.writeUInt32LE(rec.crc, p); p += 4;
    c.writeUInt32LE(rec.size, p); p += 4;
    c.writeUInt32LE(rec.size, p); p += 4;
    c.writeUInt16LE(rec.nameBuf.length, p); p += 2;
    c.writeUInt16LE(0, p); p += 2;
    c.writeUInt16LE(0, p); p += 2;
    c.writeUInt16LE(0, p); p += 2;
    c.writeUInt16LE(0, p); p += 2;
    c.writeUInt32LE(0, p); p += 4;
    c.writeUInt32LE(rec.offset, p); p += 4;
    rec.nameBuf.copy(c, p);
    centralParts.push(c);
    centralSize += c.length;
  }

  const end = Buffer.alloc(22);
  let p = 0;
  end.writeUInt32LE(0x06054b50, p); p += 4;
  end.writeUInt16LE(0, p); p += 2;
  end.writeUInt16LE(0, p); p += 2;
  end.writeUInt16LE(fileRecords.length, p); p += 2;
  end.writeUInt16LE(fileRecords.length, p); p += 2;
  end.writeUInt32LE(centralSize, p); p += 4;
  end.writeUInt32LE(offset, p); p += 4;
  end.writeUInt16LE(0, p);

  fs.writeFileSync(targetPath, Buffer.concat([...localParts, ...centralParts, end]));
}

function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { date: dosDate, time: dosTime };
}

let CRC_TABLE = null;
function crc32(buffer) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buffer) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function getBasicAnimalTemplate() {
  return {
    name: 'Basic Animal OOP sample',
    files: {
      'Demo.bx': `#Project B4J-NonUI AnimalDemo
#Package b4xpp.examples.animals
#ProjectDir b4x-ide-projects/AnimalDemo-b4j-nonui
#MainModule Main

#B4XLib AnimalComponents
#Version 1.00
#Author B4X++ Team
#B4XLibDir b4x-libs
#SupportedPlatforms B4A, B4J, B4i

#Include "contracts/IAnimal.bx"
#Include "models/Animal.bx"
#Include "models/Dog.bx"
#Include "models/Cat.bx"
#Include "models/Bird.bx"

Sub Process_Globals
End Sub

Sub AppStart (Args() As String)
    Dim dogInstance As Dog
    dogInstance.Initialize("Rex")

    Dim catInstance As Cat
    catInstance.Initialize("Misty")

    Dim birdInstance As Bird
    birdInstance.Initialize("Tweety")

    Log(dogInstance.Speak)
    Log(catInstance.Speak)
    Log(birdInstance.Speak)

    ' Natural polymorphism: Dog / Cat / Bird extend Animal.
    ' B4X++ detects the child assignments and generates Object + dynamic dispatch.
    Dim animalInstance As Animal

    animalInstance = dogInstance
    Log(animalInstance.Speak)
    Log(animalInstance.Move(3))

    animalInstance = catInstance
    Log(animalInstance.Speak)

    animalInstance = birdInstance
    Log(animalInstance.Move(10))
End Sub
`,
      'contracts/IAnimal.bx': `#Interface IAnimal
Sub Speak As String
Sub Move(Distance As Int) As String
#End Interface
`,
      'models/Animal.bx': `#Class Animal Abstract Implements IAnimal

#Property ReadOnly Name As String = "Unknown"

#Constructor(Name As String)
    mName = Name
#End Constructor

Virtual Sub Speak As String
    Return "I am " & mName
End Sub

Virtual Sub Move(Distance As Int) As String
    Return mName & " moves " & FormatDistance(Distance)
End Sub

Protected Sub FormatDistance(Distance As Int) As String
    Return Distance & " m"
End Sub

#End Class
`,
      'models/Dog.bx': `#Class Dog Extends Animal Final

#Constructor(Name As String)
    Super.Initialize(Name)
#End Constructor

Override Sub Speak As String
    Return Super.Name & " says woof"
End Sub

Override Sub Move(Distance As Int) As String
    Return Super.Name & " runs " & Distance & " m"
End Sub

#End Class
`,
      'models/Cat.bx': `#Class Cat Extends Animal Final

#Constructor(Name As String)
    Super.Initialize(Name)
#End Constructor

Override Sub Speak As String
    Return Super.Name & " says meow"
End Sub

Override Sub Move(Distance As Int) As String
    Return Super.Name & " silently walks " & Distance & " m"
End Sub

#End Class
`,
      'models/Bird.bx': `#Class Bird Extends Animal Final

#Constructor(Name As String)
    Super.Initialize(Name)
#End Constructor

Override Sub Speak As String
    Return Super.Name & " says tweet"
End Sub

Override Sub Move(Distance As Int) As String
    Return Super.Name & " flies " & Distance & " m"
End Sub

#End Class
`
    }
  };
}

function getLanguageShowcaseTemplate() {
  return {
    name: 'B4X++ Language Showcase',
    files: {
      'Demo.bx': `#Project B4J-NonUI B4XPPShowcase
#Package b4xpp.examples.showcase
#ProjectDir b4x-ide-projects/B4XPPShowcase-b4j-nonui
#MainModule Main

#B4XLib B4XPPShowcaseComponents
#Version 1.00
#Author B4X++ Team
#B4XLibDir b4x-libs
#SupportedPlatforms B4A, B4J, B4i
#DependsOn XUI
#B4JDependsOn jXUI
#B4ADependsOn XUI
#B4iDependsOn iXUI
#LibraryFilesDir src-b4xpp/Files

#Include "contracts/IRenderable.bx"
#Include "contracts/IIdentifiable.bx"
#Include "core/BaseComponent.bx"
#Include "components/ButtonComponent.bx"
#Include "components/LabelComponent.bx"
#Include "services/ComponentRegistry.bx"

Sub Process_Globals
End Sub

Sub AppStart (Args() As String)
    Dim button As ButtonComponent
    button.Initialize("save", "Save")
    button.Enabled = True

    Dim label As LabelComponent
    label.Initialize("title", "Welcome")
    label.Text = "B4X++ language showcase"

    Dim renderable As Poly IRenderable
    renderable = button
    Log(renderable.Render("dark", 2, True))

    renderable = label
    Log(renderable.Render("light", 1, False))

    Dim registry As ComponentRegistry
    registry.Initialize
    Log(registry.Store(button))
End Sub
`,
      'contracts/IRenderable.bx': `#Interface IRenderable
Sub Render(Theme As String, Scale As Int, Debug As Boolean) As String
#End Interface
`,
      'contracts/IIdentifiable.bx': `#Interface IIdentifiable
Sub Identity As String
#End Interface
`,
      'core/BaseComponent.bx': `#Class BaseComponent Abstract Implements IRenderable, IIdentifiable

#DesignerProperty: Key: Title, DisplayName: Title, FieldType: String, DefaultValue: Untitled, Description: Component title
#Event: Click

#Property ReadOnly Id As String
#Property Title As String = "Untitled"
#Property ReadOnly CreatedAt As Long = 0

#Constructor(Id As String, Title As String)
    mId = Id
    mTitle = Title
    mCreatedAt = DateTime.Now
#End Constructor

Virtual Sub Identity As String
    Return mId
End Sub

Abstract Sub ComponentType As String

Virtual Sub Render(Theme As String, Scale As Int, Debug As Boolean) As String
    Return BuildRenderLine("base", Theme, Scale, Debug)
End Sub

Protected Sub BuildRenderLine(Kind As String, Theme As String, Scale As Int, Debug As Boolean) As String
    Return Kind & ":" & mId & " title=" & mTitle & " theme=" & Theme & " scale=" & Scale & " debug=" & Debug
End Sub

Final Sub Signature As String
    Return mId & "-" & mCreatedAt
End Sub

#End Class
`,
      'components/ButtonComponent.bx': `#Class ButtonComponent Extends BaseComponent Final

#Property Enabled As Boolean = True

#Constructor(Id As String, Title As String)
    Super.Initialize(Id, Title)
    mEnabled = True
#End Constructor

Override Sub ComponentType As String
    Return "button"
End Sub

Override Sub Render(Theme As String, Scale As Int, Debug As Boolean) As String
    Return BuildRenderLine(This.ComponentType, Theme, Scale, Debug) & " enabled=" & mEnabled
End Sub

#End Class
`,
      'components/LabelComponent.bx': `#Class LabelComponent Extends BaseComponent
#Final

#Property Text As String = ""

#Constructor(Id As String, Title As String)
    Super.Initialize(Id, Title)
    mText = Title
#End Constructor

Override Sub ComponentType As String
    Return "label"
End Sub

Override Sub Render(Theme As String, Scale As Int, Debug As Boolean) As String
    Return BuildRenderLine(This.ComponentType, Theme, Scale, Debug) & " text=" & mText
End Sub

#End Class
`,
      'services/ComponentRegistry.bx': `#Class ComponentRegistry

#Property WriteOnly LastRendered As String = ""

#Constructor
#End Constructor

Virtual Sub Store(Component As Object) As String
    Dim renderable As Poly IRenderable
    renderable = Component
    mLastRendered = renderable.Render("registry", 1, False)
    Return mLastRendered
End Sub

#End Class
`,
      'Files/readme.txt': `This folder is copied into the Files/ folder inside the generated .b4xlib.
Use #LibraryFilesDir to select another resource folder.
`
    }
  };
}

function getExamplesReadme() {
  return `# B4X++ Examples

This folder contains two ready-to-copy B4X++ examples:

- \`basic-animal\`: a simple and familiar OOP example with \`Animal\`, \`Dog\`, \`Cat\` and \`Bird\`.
- \`language-showcase\`: a broader sample that demonstrates most B4X++ directives and keywords.

Open one example folder in VS Code, then run:

1. \`B4X++: Sync #Project\` to generate a B4J/B4A/B4i test project.
2. \`B4X++: Build .b4xlib\` to package reusable B4X components.
`;
}

function writeIdeProject(projectRoot, platform, projectName, packageName, outputs, config) {
  const mobileMainName = sanitizeProjectName(config.mobileMainModuleName) || 'B4XPPMain';
  const mainOutput = findMainOutput(outputs, config);
  const moduleOutputs = outputs.filter(o => o !== mainOutput);

  let projectFileName;
  let projectContent;
  let writtenModules;
  let label;

  if (platform === 'b4j-nonui') {
    projectFileName = `${projectName}.b4j`;
    label = 'B4J Non-UI';
    writtenModules = writeModuleOutputs(projectRoot, moduleOutputs, platform);
    const mainBody = mainOutput ? stripGeneratedHeader(mainOutput.content) : getDefaultB4JNonUiMain();
    projectContent = makeB4JProject({
      appType: 'StandardJava',
      packageName,
      libraries: ['jcore'],
      modules: writtenModules.map(m => m.moduleName),
      mainBody: ensureB4JNonUiMain(mainBody),
      ui: false
    });
  } else if (platform === 'b4j-ui') {
    projectFileName = `${projectName}.b4j`;
    label = 'B4J UI';
    writtenModules = writeModuleOutputs(projectRoot, moduleOutputs, platform);
    const mainBody = mainOutput ? stripGeneratedHeader(mainOutput.content) : getDefaultB4JUiMain();
    projectContent = makeB4JProject({
      appType: 'JavaFX',
      packageName,
      libraries: ['jcore', 'jfx'],
      modules: writtenModules.map(m => m.moduleName),
      mainBody: ensureB4JUiMain(mainBody),
      ui: true
    });
  } else if (platform === 'b4a') {
    projectFileName = `${projectName}.b4a`;
    label = 'B4A';
    const mobileOutputs = makeMobileOutputs(moduleOutputs, mainOutput, mobileMainName);
    writtenModules = writeModuleOutputs(projectRoot, mobileOutputs, platform);
    projectContent = makeB4AProject({
      projectName,
      packageName,
      modules: writtenModules.map(m => m.moduleName),
      mobileMainName: mainOutput ? mobileMainName : null
    });
  } else if (platform === 'b4i') {
    projectFileName = `${projectName}.b4i`;
    label = 'B4i';
    const mobileOutputs = makeMobileOutputs(moduleOutputs, mainOutput, mobileMainName);
    writtenModules = writeModuleOutputs(projectRoot, mobileOutputs, platform);
    projectContent = makeB4IProject({
      projectName,
      packageName,
      modules: writtenModules.map(m => m.moduleName),
      mobileMainName: mainOutput ? mobileMainName : null
    });
  } else {
    throw new Error(`Plateforme inconnue: ${platform}`);
  }

  const filePath = path.join(projectRoot, projectFileName);
  fs.writeFileSync(filePath, projectContent, 'utf8');
  fs.mkdirSync(path.join(projectRoot, 'Files'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'Objects'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'README-B4XPP.txt'), getGeneratedProjectReadme(label, projectFileName), 'utf8');
  return { filePath, label };
}

function findMainOutput(outputs, config) {
  const configured = sanitizeProjectName(config.mainModuleName || '');
  const candidates = outputs.filter(o => o.kind === 'main');
  if (configured) {
    const exact = candidates.find(o => o.moduleName.toLowerCase() === configured.toLowerCase());
    if (exact) return exact;
  }
  const main = candidates.find(o => o.moduleName.toLowerCase() === 'main');
  return main || candidates[0] || null;
}

function writeModuleOutputs(projectRoot, outputs, platform) {
  const written = [];
  const seen = new Set();
  for (const out of outputs) {
    const moduleName = sanitizeProjectName(out.moduleName || path.basename(out.fileName, '.bas'));
    if (!moduleName || seen.has(moduleName.toLowerCase())) continue;
    seen.add(moduleName.toLowerCase());
    const fileName = `${moduleName}.bas`;
    const moduleContent = addB4XModuleDesignHeader(out.content, platform, out.kind);
    fs.writeFileSync(path.join(projectRoot, fileName), moduleContent, 'utf8');
    written.push({ moduleName, fileName });
  }
  return written;
}

function reorderDesignDirectivesForB4X(content) {
  const normalized = normalizeNewlines(content).replace(/^\uFEFF/, '');
  const lines = normalized.split('\n');
  const directives = [];
  const generatedComments = [];
  const body = [];
  let seenBody = false;

  for (const line of lines) {
    if (/^\s*#(?:DesignerProperty|Event)\b/i.test(line)) {
      directives.push(line);
      continue;
    }
    if (!seenBody && /^'\s*(?:AUTO-GENERATED BY B4X\+\+|DO NOT EDIT THIS FILE DIRECTLY|GeneratorVersion:|Source:|(?:Class|StaticCode|MainModule):)/i.test(line)) {
      generatedComments.push(line);
      continue;
    }
    if (!seenBody && line.trim() === '') continue;
    seenBody = true;
    body.push(line);
  }

  const out = [];
  out.push(...directives);
  if (directives.length && generatedComments.length) out.push('');
  out.push(...generatedComments);
  if (generatedComments.length && body.length) out.push('');
  out.push(...body);
  return out.join('\n').trimStart();
}

function addB4XModuleDesignHeader(content, platform, kind, options = {}) {
  let normalized = normalizeNewlines(content).replace(/^\uFEFF/, '');
  normalized = reorderDesignDirectivesForB4X(normalized);
  if (/^\s*(?:B4J|B4A|B4i)=true\b/i.test(normalized)) return normalized;

  // .b4xlib modules are usually generated from B4J modules even when the library targets B4A and B4J.
  // This follows the structure used by XUI Views and keeps the Designer scanner happy.
  const platformFlag = options && options.forceB4JHeader ? 'B4J' : (platform === 'b4a' ? 'B4A' : platform === 'b4i' ? 'B4i' : 'B4J');
  const type = kind === 'class' ? 'Class' : 'StaticCode';
  const version = platformFlag === 'B4A' ? '12.0' : platformFlag === 'B4i' ? '8.0' : '10.0';
  const header = [
    `${platformFlag}=true`,
    'Group=Default Group',
    'ModulesStructureVersion=1',
    `Type=${type}`,
    `Version=${version}`,
    '@EndOfDesignText@',
    ''
  ];
  return header.join('\n') + normalized.trimStart();
}

function makeMobileOutputs(moduleOutputs, mainOutput, mobileMainName) {
  const outputs = moduleOutputs.slice();
  if (mainOutput) {
    outputs.push({
      ...mainOutput,
      moduleName: mobileMainName,
      fileName: `${mobileMainName}.bas`,
      content: renameGeneratedHeaderKind(mainOutput.content, mobileMainName)
    });
  }
  return outputs;
}

function renameGeneratedHeaderKind(content, mobileMainName) {
  const lines = normalizeNewlines(content).split('\n');
  return lines.map(line => {
    if (/^'\s*MainModule\s*:/i.test(line)) return `' CodeModule: ${mobileMainName} (renamed from #MainModule for mobile project)`;
    return line;
  }).join('\n');
}

function stripGeneratedHeader(content) {
  const lines = normalizeNewlines(content).split('\n');
  if (!lines.length || !/^'\s*AUTO-GENERATED BY B4X\+\+/i.test(lines[0])) return normalizeNewlines(content).trim() + '\n';
  let i = 0;
  while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith("'"))) {
    if (lines[i].trim() === '') {
      i++;
      break;
    }
    i++;
  }
  return lines.slice(i).join('\n').trim() + '\n';
}

function makeB4JProject({ appType, packageName, libraries, modules, mainBody }) {
  const design = makeDesignText({
    appType,
    packageName,
    libraries,
    modules,
    version: '10.0'
  });
  return design + mainBody.trim() + '\n';
}

function makeB4AProject({ projectName, packageName, modules, mobileMainName }) {
  const design = makeDesignText({
    packageName,
    libraries: ['core'],
    modules,
    files: [],
    version: '12.0',
    manifestCode: makeB4AManifestCode()
  });
  return design + `#Region Project Attributes
    #ApplicationLabel: ${projectName}
    #VersionCode: 1
    #VersionName: 1.0
    'SupportedOrientations possible values: unspecified, landscape or portrait.
    #SupportedOrientations: unspecified
    #CanInstallToExternalStorage: False
#End Region

#Region Activity Attributes
    #FullScreen: False
    #IncludeTitle: True
#End Region

Sub Process_Globals
End Sub

Sub Globals
End Sub

Sub Activity_Create(FirstTime As Boolean)
${mobileMainName ? `    If FirstTime Then
        Dim Args(0) As String
        ${mobileMainName}.AppStart(Args)
    End If` : `    Log("B4A project generated by B4X++")`}
End Sub

Sub Activity_Resume
End Sub

Sub Activity_Pause (UserClosed As Boolean)
End Sub
`;
}

function makeB4IProject({ projectName, packageName, modules, mobileMainName }) {
  const design = makeDesignText({
    packageName,
    libraries: ['icore'],
    modules,
    files: [],
    version: '4'
  });
  return design + `'Code module
#Region Project Attributes
    #ApplicationLabel: ${projectName}
    #Version: 1.0.0
    'Orientation possible values: Portrait, LandscapeLeft, LandscapeRight and PortraitUpsideDown
    #iPhoneOrientations: Portrait, LandscapeLeft, LandscapeRight
    #iPadOrientations: Portrait, LandscapeLeft, LandscapeRight, PortraitUpsideDown
    #Target: iPhone, iPad
    #ATSEnabled: True
    #MinVersion: 7
#End Region

Sub Process_Globals
    Public App As Application
    Public NavControl As NavigationController
    Private Page1 As Page
End Sub

Private Sub Application_Start (Nav As NavigationController)
    NavControl = Nav
    Page1.Initialize("Page1")
    Page1.Title = "${projectName}"
    Page1.RootPanel.Color = Colors.White
    NavControl.ShowPage(Page1)
${mobileMainName ? `    Dim Args(0) As String
    ${mobileMainName}.AppStart(Args)` : `    Log("B4i project generated by B4X++")`}
End Sub

Private Sub Application_Background
End Sub
`;
}

function makeDesignText({ appType, packageName, libraries, modules, files = [], version, manifestCode }) {
  const lines = [];
  if (appType) lines.push(`AppType=${appType}`);
  lines.push(`Build1=Default,${packageName}`);
  for (let i = 0; i < files.length; i++) lines.push(`File${i + 1}=${files[i]}`);
  for (let i = 0; i < files.length; i++) lines.push(`FileGroup${i + 1}=Default Group`);
  lines.push('Group=Default Group');
  for (let i = 0; i < libraries.length; i++) lines.push(`Library${i + 1}=${libraries[i]}`);
  if (manifestCode) lines.push(`ManifestCode=${manifestCode}`);
  for (let i = 0; i < modules.length; i++) lines.push(`Module${i + 1}=${modules[i]}`);
  lines.push(`NumberOfFiles=${files.length}`);
  lines.push(`NumberOfLibraries=${libraries.length}`);
  lines.push(`NumberOfModules=${modules.length}`);
  lines.push(`Version=${version}`);
  lines.push('@EndOfDesignText@');
  lines.push('');
  return lines.join('\n');
}

function makeB4AManifestCode() {
  const parts = [
    "'This code will be applied to the manifest file during compilation.",
    "'You do not need to modify it in most cases.",
    'AddManifestText(',
    '<uses-sdk android:minSdkVersion="21" android:targetSdkVersion="35"/>',
    '<supports-screens android:largeScreens="true"',
    '    android:normalScreens="true"',
    '    android:smallScreens="true"',
    '    android:anyDensity="true"/>)',
    'SetApplicationAttribute(android:icon, "@drawable/icon")',
    'SetApplicationAttribute(android:label, "$LABEL$")',
    'CreateResourceFromFile(Macro, Themes.LightTheme)',
    "'End of default text."
  ];
  return parts.join('~\\n~') + '~';
}

function ensureB4JNonUiMain(body) {
  let text = body.trim() || getDefaultB4JNonUiMain();
  if (!/Sub\s+AppStart\s*\(\s*Args\s*\(\)\s+As\s+String\s*\)/i.test(text)) {
    if (/Sub\s+AppStart\s*\(\s*Form1\s+As\s+Form\s*,\s*Args\s*\(\)\s+As\s+String\s*\)/i.test(text)) {
      text = text.replace(/Sub\s+AppStart\s*\(\s*Form1\s+As\s+Form\s*,\s*Args\s*\(\)\s+As\s+String\s*\)/i, 'Sub AppStart (Args() As String)');
      text = text.replace(/^\s*MainForm\s*=\s*Form1\s*$/gmi, "' MainForm = Form1 'removed by B4X++ Non-UI generator");
      text = text.replace(/^\s*MainForm\.Show\s*$/gmi, "' MainForm.Show 'removed by B4X++ Non-UI generator");
    }
  }
  if (!/Application_Error\s*\(/i.test(text)) {
    text += `\n\n'Return true to allow the default exceptions handler to handle the uncaught exception.\nSub Application_Error (Error As Exception, StackTrace As String) As Boolean\n    Return True\nEnd Sub`;
  }
  return `'Non-UI application (console / server application)\n#Region Project Attributes\n    #CommandLineArgs:\n    #MergeLibraries: True\n#End Region\n\n${text.trim()}\n`;
}

function ensureB4JUiMain(body) {
  let text = body.trim() || getDefaultB4JUiMain();
  text = text.replace(/Sub\s+AppStart\s*\(\s*Args\s*\(\)\s+As\s+String\s*\)/i, 'Sub AppStart (Form1 As Form, Args() As String)');
  text = ensureProcessGlobalsLine(text, 'Private fx As JFX');
  text = ensureProcessGlobalsLine(text, 'Private MainForm As Form');
  text = injectAfterAppStart(text, ['    MainForm = Form1', '    MainForm.Show']);
  if (!/Application_Error\s*\(/i.test(text)) {
    text += `\n\n'Return true to allow the default exceptions handler to handle the uncaught exception.\nSub Application_Error (Error As Exception, StackTrace As String) As Boolean\n    Return True\nEnd Sub`;
  }
  return `#Region Project Attributes\n    #MainFormWidth: 600\n    #MainFormHeight: 600\n#End Region\n\n${text.trim()}\n`;
}

function ensureProcessGlobalsLine(text, lineToAdd) {
  if (new RegExp(escapeRegExp(lineToAdd.replace(/\s+As\s+.+$/i, '').trim()), 'i').test(text)) return text;
  const re = /(Sub\s+Process_Globals\s*\n)/i;
  if (re.test(text)) return text.replace(re, `$1    ${lineToAdd}\n`);
  return `Sub Process_Globals\n    ${lineToAdd}\nEnd Sub\n\n${text}`;
}

function injectAfterAppStart(text, linesToInject) {
  const match = text.match(/Sub\s+AppStart\s*\(\s*Form1\s+As\s+Form\s*,\s*Args\s*\(\)\s+As\s+String\s*\)\s*\n/i);
  if (!match) return text;
  const insert = linesToInject.filter(line => !new RegExp('^\\s*' + escapeRegExp(line.trim()) + '\\s*$', 'mi').test(text)).join('\n');
  if (!insert) return text;
  return text.replace(match[0], match[0] + insert + '\n');
}

function getDefaultB4JNonUiMain() {
  return `Sub Process_Globals
End Sub

Sub AppStart (Args() As String)
    Log("B4J Non-UI project generated by B4X++")
End Sub
`;
}

function getDefaultB4JUiMain() {
  return `Sub Process_Globals
End Sub

Sub AppStart (Form1 As Form, Args() As String)
End Sub
`;
}

function getGeneratedProjectReadme(label, projectFileName) {
  return `${label} project generated by B4X++.

1. Open ${projectFileName} in the matching B4X IDE.
2. Do not edit generated .bas modules directly if you want to keep the B4X++ workflow.
3. Edit the .bx sources in src-b4xpp, then preferably run "B4X++: Sync #Project" when your .bx file contains a #Project directive.
4. "B4X++: Generate .bas Files" is still available for generated-b4x inspection, but that folder is not the one used by the B4X IDE project.

Note: this project generator is a starter. Designer files, layouts, icons and advanced platform settings should still be adjusted in the B4X IDE.
`;
}

function normalizeNewlines(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function sanitizeProjectName(name) {
  const cleaned = String(name || '').trim().replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '');
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(cleaned)) return null;
  return cleaned;
}

function sanitizePackageName(name) {
  const cleaned = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_.]/g, '').replace(/\.+/g, '.').replace(/^\.|\.$/g, '');
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(cleaned)) return null;
  return cleaned;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateDocument(document) {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri) || getWorkspaceFolder();
  if (folder) {
    const config = getConfig();
    const root = folder.uri.fsPath;
    const sourceRoot = path.join(root, config.sourceDir);
    if (fs.existsSync(sourceRoot) && isPathInside(document.uri.fsPath, sourceRoot)) {
      try {
        const result = transpileWorkspace(root, config);
        publishDiagnostics(mergeV3SemanticDiagnostics(result.allDiagnostics, document, root, config));
        return;
      } catch (err) {
        // Fall back to single-document validation. This keeps diagnostics alive while the workspace is being created.
      }
    }
  }

  const result = transpileText(document.uri.fsPath, document.getText(), {
    addGeneratedHeader: false,
    workspaceRoot: folder ? folder.uri.fsPath : undefined
  });
  publishDiagnostics(mergeV3SemanticDiagnostics(new Map([[document.uri.toString(), result.diagnostics || []]]), document, folder ? folder.uri.fsPath : path.dirname(document.uri.fsPath), getConfig()));
}

function publishDiagnostics(diagnosticsByUri) {
  for (const [uriString, diagnostics] of diagnosticsByUri.entries()) {
    const uri = vscode.Uri.parse(uriString);
    const vscodeDiagnostics = diagnostics.map((d) => {
      const line = Math.max(0, (d.line || 1) - 1);
      const severity = d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(line, 0, line, 200),
        d.message,
        severity
      );
      diagnostic.source = 'B4X++';
      return diagnostic;
    });
    diagnosticCollection.set(uri, vscodeDiagnostics);
  }
}



class B4XPPCompletionProvider {
  provideCompletionItems(document, position) {
    const index = buildB4XPPSymbolIndex(document);
    const fileInfo = getFileInfo(index, document.uri.fsPath);
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const currentClass = findClassAtPosition(index, fileInfo, position.line);

    if (/\bSuper\.([A-Za-z_][A-Za-z0-9_]*)?$/i.test(linePrefix) && currentClass && currentClass.extendsName) {
      return completionForClassMembers(index, currentClass.extendsName, { includePrivate: false, includeProtected: true });
    }

    if (/\b(?:This|Me)\.([A-Za-z_][A-Za-z0-9_]*)?$/i.test(linePrefix) && currentClass) {
      return completionForClassMembers(index, currentClass.name, { includePrivate: true, includeProtected: true });
    }

    const receiverMatch = linePrefix.match(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)?$/);
    if (receiverMatch && fileInfo) {
      const variables = collectVariablesForScope(index, fileInfo, position.line);
      const variable = variables.get(receiverMatch[1].toLowerCase());
      const targetType = variable && (variable.assignedType || variable.type || variable.polyType);
      if (targetType) return completionForClassOrInterfaceMembers(index, targetType, { includePrivate: false, includeProtected: false });
    }

    if (/^\s*(?:Public|Private|Protected)?\s*Override\s*$/i.test(linePrefix) && currentClass) {
      return completionForOverride(index, currentClass);
    }

    return completionForB4XPPKeywords();
  }
}

function completionForB4XPPKeywords() {
  const keywords = [
    ['Public', 'Public member visible to generated B4X users.'],
    ['Protected', 'B4X++ member visible in this class and subclasses; lowered to Private in generated .bas.'],
    ['Private', 'Private member visible only in the declaring B4X++ class.'],
    ['Override', 'Override a parent Virtual / Abstract method.'],
    ['Virtual', 'Mark a method as overridable.'],
    ['Abstract', 'Declare an abstract method or class.'],
    ['Final', 'Prevent overriding or inheritance.'],
    ['Super.', 'Call the parent implementation.'],
    ['This.', 'Reference current B4X++ instance.'],
    ['#Class', 'Start a B4X++ class.'],
    ['#Extends', 'Extend another B4X++ class.'],
    ['#Property', 'Generate field + getter/setter.'],
    ['Get', 'Declare a custom B4X++ property getter.'],
    ['Set', 'Declare a custom B4X++ property setter.'],
    ['#Interface', 'Start a B4X++ interface.'],
    ['#Include', 'Include another .bx file.']
  ];
  return keywords.map(([label, detail]) => {
    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
    item.detail = detail;
    return item;
  });
}

function completionForOverride(index, currentClass) {
  const items = [];
  const seen = new Set();
  for (const parent of ancestorChain(index, currentClass.name)) {
    for (const method of parent.methods.values()) {
      const lname = method.name.toLowerCase();
      if (seen.has(lname)) continue;
      seen.add(lname);
      if (method.visibility === 'private') continue;
      if ((method.modifiers || []).includes('final')) continue;
      if (!(method.modifiers || []).some(m => ['virtual', 'abstract', 'override'].includes(m))) continue;
      const item = new vscode.CompletionItem(method.name, vscode.CompletionItemKind.Method);
      item.detail = `${parent.name}.${method.name}`;
      item.insertText = new vscode.SnippetString(`Sub ${method.name}${method.paramsRaw ? '(' + method.paramsRaw + ')' : ''}${method.returnType ? ' As ' + method.returnType : ''}\n\t$0\nEnd Sub`);
      items.push(item);
    }
  }
  return items;
}

function completionForClassOrInterfaceMembers(index, typeName, options) {
  const cls = findClass(index, typeName);
  if (cls) return completionForClassMembers(index, cls.name, options || {});
  const intf = findInterface(index, typeName);
  if (!intf) return [];
  return Array.from(intf.methods.values()).map(m => methodCompletionItem(m, intf.name));
}

function completionForClassMembers(index, className, options = {}) {
  const out = [];
  const seen = new Set();
  const cls = findClass(index, className);
  const chain = cls ? [cls].concat(ancestorChain(index, cls.name)) : [];
  for (const owner of chain) {
    for (const method of owner.methods.values()) {
      const lname = method.name.toLowerCase();
      if (seen.has(lname)) continue;
      seen.add(lname);
      if (method.visibility === 'private' && !options.includePrivate) continue;
      if (method.visibility === 'protected' && !options.includeProtected) continue;
      if (['class_globals', 'process_globals'].includes(lname)) continue;
      out.push(methodCompletionItem(method, owner.name));
    }
  }
  return out;
}

function methodCompletionItem(method, ownerName) {
  const item = new vscode.CompletionItem(method.name, vscode.CompletionItemKind.Method);
  const params = method.paramsRaw ? `(${method.paramsRaw})` : '';
  item.detail = `${ownerName}.${method.name}${params}${method.returnType ? ' As ' + method.returnType : ''}`;
  item.insertText = new vscode.SnippetString(`${method.name}${method.paramsRaw ? '(' + method.paramsRaw.split(',').map((_, i) => '${' + (i + 1) + '}').join(', ') + ')' : ''}`);
  return item;
}


class B4XPPSymbolNavigationProvider {
  provideDefinition(document, position) {
    const includeTarget = getIncludeTargetAt(document, position);
    if (includeTarget) {
      const resolved = resolveIncludeTargetForDocument(document, includeTarget.value);
      if (resolved && fs.existsSync(resolved)) return new vscode.Location(vscode.Uri.file(resolved), new vscode.Position(0, 0));
    }
    return provideB4XPPSymbolDefinition(document, position);
  }

  provideDocumentLinks(document) {
    const links = [];
    for (let i = 0; i < document.lineCount; i++) {
      const text = document.lineAt(i).text;
      const match = text.match(/^\s*#Include\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
      if (!match) continue;
      const value = match[1] || match[2] || match[3] || '';
      const startChar = match.index + match[0].indexOf(value);
      const range = new vscode.Range(i, startChar, i, startChar + value.length);
      const resolved = resolveIncludeTargetForDocument(document, value);
      if (resolved && fs.existsSync(resolved)) {
        const link = new vscode.DocumentLink(range, vscode.Uri.file(resolved));
        link.tooltip = `Open ${value}`;
        links.push(link);
      }
    }
    return links;
  }
}

function provideB4XPPSymbolDefinition(document, position) {
  const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
  if (!wordRange) return null;

  const word = document.getText(wordRange);
  const index = buildB4XPPSymbolIndex(document);
  const fileInfo = getFileInfo(index, document.uri.fsPath);
  if (!fileInfo) return null;

  const line = document.lineAt(position.line).text;
  const dotted = getDottedMemberAt(line, wordRange);
  if (dotted && dotted.member.toLowerCase() === word.toLowerCase()) {
    const memberLocation = resolveMemberDefinition(index, fileInfo, position, dotted.receiver, dotted.member);
    if (memberLocation) return memberLocation;
  }

  const declarationMethod = findMethodDeclarationAt(fileInfo, wordRange);
  if (declarationMethod && (declarationMethod.modifiers || []).includes('override')) {
    const owner = getOwnerClassOrInterface(index, declarationMethod.ownerKind, declarationMethod.ownerName);
    if (owner && owner.kind === 'class') {
      const ancestorMethod = findAncestorMethod(index, owner.name, declarationMethod.name);
      if (ancestorMethod) return toLocation(ancestorMethod.method);
    }
  }

  if (/^Super$/i.test(word)) {
    const cls = findClassAtPosition(index, fileInfo, position.line);
    if (cls && cls.extendsName) {
      const parent = findClass(index, cls.extendsName);
      if (parent) return toLocation(parent);
    }
  }

  if (/^This$/i.test(word)) {
    const cls = findClassAtPosition(index, fileInfo, position.line);
    if (cls) return toLocation(cls);
  }

  const variables = collectVariablesForScope(index, fileInfo, position.line);
  const variable = variables.get(word.toLowerCase());
  if (variable && !rangeEquals(variable.range, wordRange)) {
    return new vscode.Location(vscode.Uri.file(variable.file), variable.range);
  }

  const typeSymbol = findClass(index, word) || findInterface(index, word);
  if (typeSymbol && looksLikeTypeReference(line, wordRange, word)) return toLocation(typeSymbol);

  const currentOwner = findOwnerAtPosition(index, fileInfo, position.line);
  if (currentOwner) {
    const method = currentOwner.kind === 'class'
      ? findClassMethod(index, currentOwner.name, word)
      : findInterfaceMethod(index, currentOwner.name, word);
    if (method) return toLocation(method.method || method);
  }

  if (typeSymbol) return toLocation(typeSymbol);
  return null;
}

function buildB4XPPSymbolIndex(document) {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri) || getWorkspaceFolder();
  const config = getConfig();
  const root = folder ? folder.uri.fsPath : path.dirname(document.uri.fsPath);
  const sourceRoot = path.join(root, config.sourceDir);
  let files = [];
  if (fs.existsSync(sourceRoot)) files = collectBxFiles(sourceRoot);
  if (!files.some(f => samePath(f, document.uri.fsPath))) files.push(document.uri.fsPath);

  const index = {
    root,
    sourceRoot,
    files,
    classes: new Map(),
    interfaces: new Map(),
    fileInfos: new Map()
  };

  for (const file of files) {
    try {
      const text = getWorkspaceText(file);
      const info = parseB4XPPSymbolFile(file, text);
      index.fileInfos.set(normalizePathKey(file), info);
      for (const cls of info.classes) index.classes.set(cls.name.toLowerCase(), cls);
      for (const intf of info.interfaces) index.interfaces.set(intf.name.toLowerCase(), intf);
    } catch (err) {
      // Ignore temporary file read errors. Definition providers should never break editing.
    }
  }
  return index;
}

function parseB4XPPSymbolFile(file, text) {
  const lines = normalizeNewlines(text).split('\n');
  const info = { file, lines, classes: [], interfaces: [], methods: [] };
  let currentOwner = null;
  let currentMethod = null;

  function closeOwner(endLine) {
    if (currentOwner) currentOwner.endLine = endLine;
    currentOwner = null;
  }

  function closeMethod(endLine) {
    if (currentMethod) currentMethod.endLine = endLine;
    currentMethod = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const code = splitCodeAndCommentForNavigation(raw).code;
    const trimmed = code.trim();

    if (/^#End\s+Class\b/i.test(trimmed)) {
      closeMethod(i);
      closeOwner(i);
      continue;
    }
    if (/^#End\s+Interface\b/i.test(trimmed)) {
      closeMethod(i);
      closeOwner(i);
      continue;
    }
    if (/^End\s+Sub\b/i.test(trimmed)) {
      closeMethod(i);
      continue;
    }

    const interfaceMatch = raw.match(/^\s*#Interface\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    if (interfaceMatch) {
      closeMethod(i - 1);
      closeOwner(i - 1);
      const name = interfaceMatch[1];
      const range = makeWordRange(raw, i, name, interfaceMatch.index);
      currentOwner = {
        kind: 'interface',
        name,
        file,
        line: i,
        startLine: i,
        endLine: lines.length - 1,
        range,
        methods: new Map()
      };
      info.interfaces.push(currentOwner);
      continue;
    }

    const classMatch = raw.match(/^\s*#Class\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/i);
    if (classMatch) {
      closeMethod(i - 1);
      closeOwner(i - 1);
      const name = classMatch[1];
      const rest = classMatch[2] || '';
      const extendsMatch = rest.match(/\bExtends\s+([A-Za-z_][A-Za-z0-9_]*)/i);
      const implementsMatch = rest.match(/\bImplements\s+(.+?)(?:\b(?:Extends|Abstract|Final)\b|$)/i);
      const modifiers = [];
      if (/\bFinal\b/i.test(rest)) modifiers.push('final');
      if (/\bAbstract\b/i.test(rest)) modifiers.push('abstract');
      const range = makeWordRange(raw, i, name, classMatch.index);
      currentOwner = {
        kind: 'class',
        name,
        file,
        line: i,
        startLine: i,
        endLine: lines.length - 1,
        range,
        extendsName: extendsMatch ? extendsMatch[1] : null,
        extendsRange: extendsMatch ? makeWordRange(raw, i, extendsMatch[1], raw.indexOf(extendsMatch[0])) : null,
        implementsNames: parseImplementsNames(implementsMatch ? implementsMatch[1] : ''),
        modifiers,
        methods: new Map()
      };
      info.classes.push(currentOwner);
      continue;
    }

    const extendsLine = raw.match(/^\s*#Extends\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    if (extendsLine && currentOwner && currentOwner.kind === 'class') {
      currentOwner.extendsName = extendsLine[1];
      currentOwner.extendsRange = makeWordRange(raw, i, extendsLine[1], extendsLine.index);
      continue;
    }

    const implementsLine = raw.match(/^\s*#Implements\s+(.+)$/i);
    if (implementsLine && currentOwner && currentOwner.kind === 'class') {
      currentOwner.implementsNames.push(...parseImplementsNames(implementsLine[1]));
      continue;
    }

    const methodSig = parseMethodSignatureForNavigation(raw, i, file, currentOwner);
    if (methodSig) {
      closeMethod(i - 1);
      currentMethod = methodSig;
      info.methods.push(methodSig);
      if (currentOwner) currentOwner.methods.set(methodSig.name.toLowerCase(), methodSig);
      continue;
    }
  }
  closeMethod(lines.length - 1);
  closeOwner(lines.length - 1);
  return info;
}

function parseMethodSignatureForNavigation(raw, lineIndex, file, owner) {
  const m = raw.match(/^\s*((?:(?:Public|Private|Protected|Override|Virtual|Abstract|Final)\s+)*)Sub\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(?:As\s+([A-Za-z_][A-Za-z0-9_\.]*))?/i);
  if (!m) return null;
  const name = m[2];
  const range = makeWordRange(raw, lineIndex, name, m.index);
  const paramsRaw = m[3] || '';
  const tokens = (m[1] || '').trim().split(/\s+/).filter(Boolean).map(s => s.toLowerCase());
  let visibility = '';
  const modifiers = [];
  for (const token of tokens) {
    if (['public', 'private', 'protected'].includes(token)) {
      if (!visibility) visibility = token;
    } else if (!modifiers.includes(token)) {
      modifiers.push(token);
    }
  }
  return {
    kind: 'method',
    name,
    file,
    line: lineIndex,
    startLine: lineIndex,
    endLine: lineIndex,
    range,
    ownerKind: owner ? owner.kind : 'module',
    ownerName: owner ? owner.name : path.basename(file, '.bx'),
    modifiers,
    visibility,
    paramsRaw,
    returnType: (m[4] || '').trim()
  };
}

function parseImplementsNames(value) {
  return String(value || '')
    .split(',')
    .map(s => s.trim().split(/\s+/)[0])
    .filter(s => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s));
}

function getFileInfo(index, file) {
  return index.fileInfos.get(normalizePathKey(file)) || null;
}

function findClass(index, name) {
  return index.classes.get(String(name || '').toLowerCase()) || null;
}

function findInterface(index, name) {
  return index.interfaces.get(String(name || '').toLowerCase()) || null;
}

function getOwnerClassOrInterface(index, kind, name) {
  if (kind === 'class') return findClass(index, name);
  if (kind === 'interface') return findInterface(index, name);
  return null;
}

function findOwnerAtPosition(index, fileInfo, line) {
  return findClassAtPosition(index, fileInfo, line) || findInterfaceAtPosition(index, fileInfo, line);
}

function findClassAtPosition(index, fileInfo, line) {
  if (!fileInfo) return null;
  return fileInfo.classes.find(cls => line >= cls.startLine && line <= cls.endLine) || null;
}

function findInterfaceAtPosition(index, fileInfo, line) {
  if (!fileInfo) return null;
  return fileInfo.interfaces.find(intf => line >= intf.startLine && line <= intf.endLine) || null;
}

function findMethodAtPosition(fileInfo, line) {
  if (!fileInfo) return null;
  return fileInfo.methods.find(m => line >= m.startLine && line <= m.endLine) || null;
}

function findMethodDeclarationAt(fileInfo, wordRange) {
  if (!fileInfo) return null;
  return fileInfo.methods.find(m => rangeEquals(m.range, wordRange)) || null;
}

function ancestorChain(index, className) {
  const out = [];
  const seen = new Set();
  let current = findClass(index, className);
  while (current && current.extendsName) {
    const key = current.extendsName.toLowerCase();
    if (seen.has(key)) break;
    seen.add(key);
    const parent = findClass(index, current.extendsName);
    if (!parent) break;
    out.push(parent);
    current = parent;
  }
  return out;
}

function findClassMethod(index, className, methodName) {
  const cls = findClass(index, className);
  if (!cls) return null;
  const own = cls.methods.get(String(methodName || '').toLowerCase());
  if (own) return { owner: cls, method: own };
  for (const parent of ancestorChain(index, className)) {
    const method = parent.methods.get(String(methodName || '').toLowerCase());
    if (method) return { owner: parent, method };
  }
  return null;
}

function findAncestorMethod(index, className, methodName) {
  for (const parent of ancestorChain(index, className)) {
    const method = parent.methods.get(String(methodName || '').toLowerCase());
    if (method) return { owner: parent, method };
  }
  return null;
}

function findInterfaceMethod(index, interfaceName, methodName) {
  const intf = findInterface(index, interfaceName);
  if (!intf) return null;
  const method = intf.methods.get(String(methodName || '').toLowerCase());
  return method ? { owner: intf, method } : null;
}

function resolveMemberDefinition(index, fileInfo, position, receiver, member) {
  const currentClass = findClassAtPosition(index, fileInfo, position.line);

  if (/^Super$/i.test(receiver)) {
    if (!currentClass) return null;
    const method = findAncestorMethod(index, currentClass.name, member);
    if (method) return toLocation(method.method);
    const parent = currentClass.extendsName ? findClass(index, currentClass.extendsName) : null;
    return parent ? toLocation(parent) : null;
  }

  if (/^This$/i.test(receiver)) {
    if (!currentClass) return null;
    const method = findClassMethod(index, currentClass.name, member);
    return method ? toLocation(method.method) : toLocation(currentClass);
  }

  const variables = collectVariablesForScope(index, fileInfo, position.line);
  const variable = variables.get(String(receiver || '').toLowerCase());
  if (!variable) return null;

  let targetType = variable.assignedType || variable.type;
  if (!targetType && variable.polyType) targetType = variable.polyType;
  if (!targetType) return null;

  const cls = findClass(index, targetType);
  if (cls) {
    const method = findClassMethod(index, cls.name, member);
    if (method) return toLocation(method.method);
    return toLocation(cls);
  }

  const intf = findInterface(index, targetType);
  if (intf) {
    const method = findInterfaceMethod(index, intf.name, member);
    if (method) return toLocation(method.method);
    return toLocation(intf);
  }

  return null;
}

function collectVariablesForScope(index, fileInfo, line) {
  const variables = new Map();
  if (!fileInfo) return variables;
  const cls = findClassAtPosition(index, fileInfo, line);

  if (cls) {
    // Class_Globals and field-like declarations are visible inside the class.
    for (let i = cls.startLine; i <= Math.min(line, cls.endLine); i++) {
      const field = parseVariableDeclarationLine(fileInfo.lines[i], i, fileInfo.file, false);
      if (field && /^(Public|Private)\b/i.test(splitCodeAndCommentForNavigation(fileInfo.lines[i]).code.trim())) {
        variables.set(field.name.toLowerCase(), field);
      }
    }
  }

  const method = findMethodAtPosition(fileInfo, line);
  const start = method ? method.startLine : 0;
  const end = Math.min(line, fileInfo.lines.length - 1);
  for (let i = start; i <= end; i++) {
    const decl = parseVariableDeclarationLine(fileInfo.lines[i], i, fileInfo.file, true);
    if (decl) {
      variables.set(decl.name.toLowerCase(), decl);
      continue;
    }

    const assignment = splitCodeAndCommentForNavigation(fileInfo.lines[i]).code.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/i);
    if (assignment) {
      const target = variables.get(assignment[1].toLowerCase());
      const source = variables.get(assignment[2].toLowerCase());
      if (target && source) target.assignedType = source.assignedType || source.type || source.polyType || null;
    }
  }
  return variables;
}

function parseVariableDeclarationLine(raw, lineIndex, file, allowDim) {
  const code = splitCodeAndCommentForNavigation(raw).code;
  const prefix = allowDim ? '(?:Dim|Private|Public|Protected)' : '(?:Private|Public|Protected)';
  const re = new RegExp('^\\s*' + prefix + '\\s+([A-Za-z_][A-Za-z0-9_]*)\\s+As\\s+(?:(Poly)\\s+)?([A-Za-z_][A-Za-z0-9_\\.]*)', 'i');
  const m = code.match(re);
  if (!m) return null;
  const name = m[1];
  return {
    name,
    file,
    line: lineIndex,
    range: makeWordRange(raw, lineIndex, name, m.index),
    type: m[2] ? null : m[3],
    polyType: m[2] ? m[3] : null,
    assignedType: null
  };
}

function getDottedMemberAt(line, wordRange) {
  const before = line.slice(0, wordRange.start.character);
  const receiverMatch = before.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*$/);
  if (!receiverMatch) return null;
  return { receiver: receiverMatch[1], member: line.slice(wordRange.start.character, wordRange.end.character) };
}

function looksLikeTypeReference(line, range, word) {
  const before = line.slice(0, range.start.character);
  const after = line.slice(range.end.character);
  if (/\b(?:As|Extends|Implements|Poly)\s+$/i.test(before)) return true;
  if (/^\s*(?:,|$)/.test(after) && /\bImplements\s+[^']*$/i.test(before)) return true;
  if (/^\s*#(?:Class|Interface)\s+/i.test(before + word)) return true;
  return false;
}

function toLocation(symbol) {
  return new vscode.Location(vscode.Uri.file(symbol.file), symbol.range || new vscode.Position(symbol.line || 0, 0));
}

function makeWordRange(line, lineIndex, word, searchStart = 0) {
  const from = Math.max(0, searchStart || 0);
  let pos = line.indexOf(word, from);
  if (pos < 0) pos = line.search(new RegExp('\\b' + escapeRegExp(word) + '\\b'));
  if (pos < 0) pos = 0;
  return new vscode.Range(lineIndex, pos, lineIndex, pos + word.length);
}

function rangeEquals(a, b) {
  return !!a && !!b && a.start.line === b.start.line && a.start.character === b.start.character && a.end.line === b.end.line && a.end.character === b.end.character;
}

function splitCodeAndCommentForNavigation(line) {
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

function getWorkspaceText(file) {
  const opened = vscode.workspace.textDocuments.find(doc => doc.uri.scheme === 'file' && samePath(doc.uri.fsPath, file));
  if (opened) return opened.getText();
  return fs.readFileSync(file, 'utf8');
}

function normalizePathKey(file) {
  return path.resolve(file).toLowerCase();
}

function samePath(a, b) {
  return normalizePathKey(a) === normalizePathKey(b);
}

function isPathInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function getIncludeTargetAt(document, position) {
  const line = document.lineAt(position.line).text;
  const match = line.match(/^\s*#Include\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
  if (!match) return null;
  const value = match[1] || match[2] || match[3] || '';
  if (!value) return null;
  const startChar = match.index + match[0].indexOf(value);
  const endChar = startChar + value.length;
  // Ctrl+click anywhere on the include line is useful, but keep the link precise on the path itself.
  if (position.character < 0 || position.character > line.length) return null;
  return { value, range: new vscode.Range(position.line, startChar, position.line, endChar) };
}

function resolveIncludeTargetForDocument(document, includeValue) {
  const direct = path.resolve(path.dirname(document.uri.fsPath), includeValue);
  if (fs.existsSync(direct)) return direct;
  if (!/\.bx$/i.test(direct) && fs.existsSync(direct + '.bx')) return direct + '.bx';
  return direct;
}


async function remapB4XErrorsCommand() {
  const folder = getWorkspaceFolder();
  if (!folder) {
    vscode.window.showErrorMessage('B4X++: open a VS Code project folder first.');
    return;
  }
  const root = folder.uri.fsPath;
  const map = loadB4XPPSourceMap(root);
  if (!map) {
    vscode.window.showWarningMessage('B4X++: no .b4xpp/sourceMap.json found. Run Generate .bas, Sync #Project or Build .b4xlib first.');
    return;
  }
  const activeText = await tryReadClipboardText();
  const log = await vscode.window.showInputBox({
    title: 'B4X++: paste B4X compiler / runtime errors',
    prompt: 'Paste B4J/B4A/B4i compiler output or runtime stack trace. Use clipboard text if already copied.',
    value: activeText && activeText.length < 12000 ? activeText : '',
    ignoreFocusOut: true
  });
  if (!log) return;
  const remapped = remapB4XLog(root, map, log);
  showRemapResults(root, remapped, 'B4X++ remapped errors');
}

async function generateDebugBundleCommand() {
  const folder = getWorkspaceFolder();
  if (!folder) {
    vscode.window.showErrorMessage('B4X++: open a VS Code project folder first.');
    return;
  }
  const root = folder.uri.fsPath;
  const config = getConfig();
  if (!(await ensureSourceFolderOrOfferExample(root, config))) return;
  const result = transpileWorkspace(root, config);
  publishDiagnostics(result.allDiagnostics);
  writeB4XPPMetadata(root, result, path.join(root, config.outputDir));
  const metaRoot = path.join(root, '.b4xpp');
  fs.mkdirSync(metaRoot, { recursive: true });
  const bundle = {
    schemaVersion: 1,
    generatorVersion: B4XPP_GENERATOR_VERSION,
    createdAt: new Date().toISOString(),
    workspaceName: path.basename(root),
    sourceDir: config.sourceDir,
    outputDir: config.outputDir,
    project: result.project || null,
    diagnostics: result.diagnostics || [],
    outputs: (result.outputs || []).map(out => ({
      module: out.moduleName,
      kind: out.kind,
      fileName: out.fileName,
      sourcePath: out.sourcePath && !String(out.sourcePath).startsWith('B4X++') ? path.relative(root, out.sourcePath).replace(/\\/g, '/') : out.sourcePath,
      sha256: sha256(out.content || ''),
      lineCount: normalizeNewlines(out.content || '').split('\n').length
    })),
    symbolsFile: '.b4xpp/symbols.json',
    sourceMapFile: '.b4xpp/sourceMap.json',
    notes: [
      'Attach this file with .b4xpp/sourceMap.json and the B4X compiler log when reporting B4X++ generation/debug issues.',
      'No user secrets are intentionally included. Review before publishing publicly.'
    ]
  };
  const filePath = path.join(metaRoot, 'debug-bundle.json');
  fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage('B4X++: debug bundle generated at .b4xpp/debug-bundle.json.');
}

async function buildB4JWithRemapCommand() {
  const folder = getWorkspaceFolder();
  if (!folder) {
    vscode.window.showErrorMessage('B4X++: open a VS Code project folder first.');
    return;
  }
  const root = folder.uri.fsPath;
  const config = getConfig();
  if (!config.b4jBuildCommand || !config.b4jBuildCommand.trim()) {
    const choice = await vscode.window.showWarningMessage(
      'B4X++: b4xpp.b4jBuildCommand is empty. Configure a command that builds a .b4j project. Placeholders: {project}, {workspace}, {projectDir}.',
      'Open Settings',
      'Cancel'
    );
    if (choice === 'Open Settings') vscode.commands.executeCommand('workbench.action.openSettings', 'b4xpp.b4jBuildCommand');
    return;
  }

  const projectFiles = findFilesRecursive(root, /\.b4j$/i, ['Objects', '.git', 'node_modules']).slice(0, 50);
  if (projectFiles.length === 0) {
    vscode.window.showWarningMessage('B4X++: no .b4j file found under the workspace. Run Sync #Project or Create B4A/B4J/B4i Project first.');
    return;
  }
  const picked = projectFiles.length === 1 ? projectFiles[0] : await pickFile(root, projectFiles, 'B4X++: choose the .b4j project to build');
  if (!picked) return;

  const command = config.b4jBuildCommand
    .replace(/\{project\}/g, quoteShellPath(picked))
    .replace(/\{workspace\}/g, quoteShellPath(root))
    .replace(/\{projectDir\}/g, quoteShellPath(path.dirname(picked)));

  b4xppOutputChannel.clear();
  b4xppOutputChannel.appendLine('B4X++: running B4J build command');
  b4xppOutputChannel.appendLine(command);
  b4xppOutputChannel.show(true);

  childProcess.exec(command, { cwd: path.dirname(picked), maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
    const output = [stdout || '', stderr || '', error ? String(error.message || error) : ''].filter(Boolean).join('\n');
    b4xppOutputChannel.appendLine(output || '(no output)');
    const map = loadB4XPPSourceMap(root);
    if (map) {
      const remapped = remapB4XLog(root, map, output);
      showRemapResults(root, remapped, 'B4X++ remapped B4J build output');
    } else {
      vscode.window.showWarningMessage('B4X++: build finished, but no .b4xpp/sourceMap.json was found for remapping.');
    }
  });
}

function loadB4XPPSourceMap(root) {
  const filePath = path.join(root, '.b4xpp', 'sourceMap.json');
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (err) {
    vscode.window.showWarningMessage(`B4X++: failed to read sourceMap.json: ${err.message}`);
    return null;
  }
}

function remapB4XLog(root, sourceMap, logText) {
  const lines = normalizeNewlines(logText || '').split('\n');
  const results = [];
  for (const line of lines) {
    const parsed = parseB4XErrorLine(line);
    if (!parsed) continue;
    const mapped = mapGeneratedLocation(sourceMap, parsed.module, parsed.line);
    results.push({ ...parsed, original: line, mapped });
  }
  return results;
}

function parseB4XErrorLine(line) {
  const text = String(line || '').trim();
  if (!text) return null;
  let m = text.match(/^error:\s*\(module:\s*([A-Za-z_][A-Za-z0-9_]*),\s*line:\s*(\d+)\)\s*(.*)$/i);
  if (m) return { severity: 'error', module: m[1], line: Number(m[2]), message: m[3] || '' };
  m = text.match(/^warning:\s*\(module:\s*([A-Za-z_][A-Za-z0-9_]*),\s*line:\s*(\d+)\)\s*(.*)$/i);
  if (m) return { severity: 'warning', module: m[1], line: Number(m[2]), message: m[3] || '' };
  m = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*-\s*(\d+)\s*:\s*(.*)$/i);
  if (m) return { severity: /warning/i.test(text) ? 'warning' : 'error', module: m[1], line: Number(m[2]), message: m[3] || '' };
  m = text.match(/^Error occurred on line:\s*(\d+)\s*\(([A-Za-z_][A-Za-z0-9_]*)\)/i);
  if (m) return { severity: 'error', module: m[2], line: Number(m[1]), message: text };
  m = text.match(/^at\s+[\w.]+\.([A-Za-z_][A-Za-z0-9_]*)\._[A-Za-z0-9_]+\([^:()]+\.java:(\d+)\)/i);
  if (m) return { severity: 'error', module: m[1], line: Number(m[2]), message: text };
  return null;
}

function mapGeneratedLocation(sourceMap, moduleName, generatedLine) {
  if (!sourceMap || !Array.isArray(sourceMap.outputs)) return null;
  const moduleLower = String(moduleName || '').toLowerCase();
  const out = sourceMap.outputs.find(o => String(o.module || '').toLowerCase() === moduleLower || String(o.generated || '').toLowerCase().endsWith(`/${moduleLower}.bas`));
  if (!out) return null;
  const mappings = Array.isArray(out.mappings) ? out.mappings.slice().sort((a, b) => a.generatedLine - b.generatedLine) : [];
  let exact = mappings.find(m => Number(m.generatedLine) === Number(generatedLine));
  if (exact) return { ...exact, module: out.module, generated: out.generated, exact: true };
  let before = null;
  for (const m of mappings) {
    if (Number(m.generatedLine) <= Number(generatedLine)) before = m;
    else break;
  }
  if (before) return { ...before, module: out.module, generated: out.generated, exact: false, generatedDelta: Number(generatedLine) - Number(before.generatedLine) };
  const fallbackSource = (out.sources && out.sources[0]) || out.source;
  return fallbackSource ? { source: fallbackSource, sourceLine: 1, module: out.module, generated: out.generated, exact: false, confidence: 'module' } : null;
}

function showRemapResults(root, remapped, title) {
  b4xppOutputChannel.appendLine('');
  b4xppOutputChannel.appendLine(`=== ${title} ===`);
  if (!remapped || remapped.length === 0) {
    b4xppOutputChannel.appendLine('No B4X compiler/runtime locations were recognized.');
    b4xppOutputChannel.show(true);
    vscode.window.showInformationMessage('B4X++: no recognizable B4X error locations found.');
    return;
  }

  const diagnosticsByUri = new Map();
  for (const item of remapped) {
    if (item.mapped && item.mapped.source) {
      const sourcePath = path.isAbsolute(item.mapped.source) ? item.mapped.source : path.join(root, item.mapped.source);
      const rel = path.relative(root, sourcePath).replace(/\\/g, '/');
      const line = Math.max(1, Number(item.mapped.sourceLine || 1));
      const suffix = item.mapped.exact ? 'exact' : `nearest${item.mapped.generatedDelta ? ', +' + item.mapped.generatedDelta + ' generated line(s)' : ''}`;
      b4xppOutputChannel.appendLine(`${item.module} - ${item.line} -> ${rel}:${line} [${suffix}] ${item.message}`);
      if (fs.existsSync(sourcePath)) {
        const uri = vscode.Uri.file(sourcePath).toString();
        if (!diagnosticsByUri.has(uri)) diagnosticsByUri.set(uri, []);
        diagnosticsByUri.get(uri).push({
          severity: item.severity || 'error',
          message: `[B4X ${item.module}:${item.line}] ${item.message}`,
          line
        });
      }
    } else {
      b4xppOutputChannel.appendLine(`${item.module} - ${item.line} -> no B4X++ mapping found. ${item.message}`);
    }
  }
  publishDiagnostics(diagnosticsByUri);
  b4xppOutputChannel.show(true);
  vscode.window.showInformationMessage(`B4X++: remapped ${remapped.length} compiler/runtime location(s). See the B4X++ output panel.`);
}

async function tryReadClipboardText() {
  try { return await vscode.env.clipboard.readText(); }
  catch { return ''; }
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function findFilesRecursive(root, regex, ignoredNames = []) {
  const out = [];
  const ignored = new Set(ignoredNames.map(s => String(s).toLowerCase()));
  function walk(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (ignored.has(entry.name.toLowerCase())) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (regex.test(entry.name)) out.push(full);
    }
  }
  walk(root);
  return out;
}

async function pickFile(root, files, placeHolder) {
  const picked = await vscode.window.showQuickPick(files.map(f => ({ label: path.relative(root, f).replace(/\\/g, '/'), file: f })), { placeHolder });
  return picked && picked.file;
}

function quoteShellPath(file) {
  const s = String(file || '');
  if (/^".*"$/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}


//────────────────────────────────────────────────────────────
// B4X++ v0.3.0 language intelligence layer
//────────────────────────────────────────────────────────────
let b4xppV3IndexCache = null;
let b4xppV3IndexCacheKey = '';

async function refreshIntelliSenseCommand() {
  const editor = vscode.window.activeTextEditor;
  const folder = getWorkspaceFolder();
  if (!folder) {
    vscode.window.showErrorMessage('B4X++: open a VS Code project folder first.');
    return;
  }
  b4xppV3IndexCache = null;
  b4xppV3IndexCacheKey = '';
  const config = getConfig();
  const index = buildV3IndexForRoot(folder.uri.fsPath, config, editor && editor.document);
  const classCount = index.classes.size;
  const interfaceCount = index.interfaces.size;
  const staticCount = index.staticCodes.size;
  vscode.window.showInformationMessage(`B4X++: IntelliSense index refreshed (${classCount} classes, ${interfaceCount} interfaces, ${staticCount} static modules).`);
  if (editor && editor.document.languageId === 'b4xpp') validateDocument(editor.document);
}

function mergeV3SemanticDiagnostics(baseDiagnosticsByUri, document, root, config) {
  if (!config || config.enableSemanticDiagnostics === false) return baseDiagnosticsByUri;
  const merged = new Map(baseDiagnosticsByUri || []);
  try {
    const index = buildV3IndexForRoot(root, config, document);
    const extras = collectV3SemanticDiagnostics(index);
    for (const [uri, diagnostics] of extras.entries()) {
      if (!merged.has(uri)) merged.set(uri, []);
      merged.get(uri).push(...diagnostics);
    }
    const assistantExtras = collectV32CustomViewAndB4XLibDiagnostics(index);
    for (const [uri, diagnostics] of assistantExtras.entries()) {
      if (!merged.has(uri)) merged.set(uri, []);
      merged.get(uri).push(...diagnostics);
    }
  } catch (err) {
    // Never break normal transpiler diagnostics because of editor-only IntelliSense diagnostics.
  }
  return merged;
}

class B4XPPV3IntelliSenseProvider {
  provideCompletionItems(document, position) {
    const index = buildV3Index(document);
    const fileInfo = v3GetFileInfo(index, document.uri.fsPath);
    const line = document.lineAt(position.line).text;
    const prefix = line.slice(0, position.character);
    const currentClass = v3FindClassAt(index, fileInfo, position.line);

    const overrideMatch = prefix.match(/^\s*((?:Public|Private|Protected)\s+)?Override\s*$/i);
    if (overrideMatch && currentClass) return v3OverrideCompletions(index, currentClass);

    if (/\bSuper\.([A-Za-z_][A-Za-z0-9_]*)?$/i.test(prefix) && currentClass && currentClass.extendsName) {
      return v3MemberCompletions(index, currentClass.extendsName, { currentClass: currentClass.name, includeProtected: true, includePrivate: false, receiver: 'Super' });
    }

    if (/\b(?:This|Me)\.([A-Za-z_][A-Za-z0-9_]*)?$/i.test(prefix) && currentClass) {
      return v3MemberCompletions(index, currentClass.name, { currentClass: currentClass.name, includeProtected: true, includePrivate: true, receiver: 'This' });
    }

    const receiverMatch = prefix.match(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)?$/);
    if (receiverMatch) {
      const receiver = receiverMatch[1];
      const resolved = v3ResolveReceiverType(index, fileInfo, position.line, receiver);
      if (resolved) return v3MemberCompletions(index, resolved.type, { currentClass: currentClass && currentClass.name, includeProtected: false, includePrivate: false, staticOnly: resolved.staticOnly });
      const builtIn = v3BuiltinMembers(receiver, null);
      if (builtIn.length) return builtIn;
    }

    const afterAs = /\bAs\s+(?:Poly\s+)?[A-Za-z_][A-Za-z0-9_]*$/i.test(prefix);
    const afterNew = /\b(?:Dim|Private|Public|Protected)\s+[A-Za-z_][A-Za-z0-9_]*\s+As\s*$/i.test(prefix);
    if (afterAs || afterNew || /\b(?:Extends|Implements|Poly)\s*$/i.test(prefix)) {
      return v3TypeCompletions(index);
    }

    return [
      ...completionForB4XPPKeywords(),
      ...v3TopLevelCompletions(index),
      ...v3B4XKeywordCompletions()
    ];
  }

  provideHover(document, position) {
    const index = buildV3Index(document);
    const resolved = v3ResolveSymbolAt(index, document, position);
    if (!resolved) return null;
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = false;
    md.appendMarkdown(v3SymbolMarkdown(resolved));
    return new vscode.Hover(md, resolved.range);
  }

  provideSignatureHelp(document, position) {
    const index = buildV3Index(document);
    const fileInfo = v3GetFileInfo(index, document.uri.fsPath);
    const parsed = v3ParseCallAt(document, position);
    if (!parsed) return null;
    const currentClass = v3FindClassAt(index, fileInfo, position.line);
    let methods = [];
    if (parsed.receiver) {
      if (/^Super$/i.test(parsed.receiver) && currentClass && currentClass.extendsName) {
        methods.push(...v3FindMethodsInClass(index, currentClass.extendsName, parsed.name, { includeAncestors: true, skipPrivate: true }));
      } else if (/^(This|Me)$/i.test(parsed.receiver) && currentClass) {
        methods.push(...v3FindMethodsInClass(index, currentClass.name, parsed.name, { includeAncestors: true }));
      } else {
        const resolved = v3ResolveReceiverType(index, fileInfo, position.line, parsed.receiver);
        if (resolved) {
          methods.push(...v3FindMethodsInType(index, resolved.type, parsed.name));
        }
      }
    } else if (currentClass) {
      methods.push(...v3FindMethodsInClass(index, currentClass.name, parsed.name, { includeAncestors: true }));
    }
    const builtin = v3BuiltinMethodSignature(parsed.receiver, parsed.name);
    if (builtin) methods.push(builtin);
    if (!methods.length) return null;

    const help = new vscode.SignatureHelp();
    for (const found of methods) {
      const method = found.method || found;
      const ownerName = found.owner ? found.owner.name : (method.ownerName || 'B4X');
      const params = method.params || v3ParseParams(method.paramsRaw || '');
      const label = `${method.name}(${params.map(p => `${p.name}${p.type ? ' As ' + p.type : ''}`).join(', ')})${method.returnType ? ' As ' + method.returnType : ''}`;
      const sig = new vscode.SignatureInformation(label, `${ownerName}.${method.name}`);
      sig.parameters = params.map(p => new vscode.ParameterInformation(`${p.name}${p.type ? ' As ' + p.type : ''}`));
      help.signatures.push(sig);
    }
    const bestIndex = methods.findIndex(found => {
      const m = found.method || found;
      const params = m.params || v3ParseParams(m.paramsRaw || '');
      return params.length >= parsed.argumentIndex + 1;
    });
    help.activeSignature = bestIndex >= 0 ? bestIndex : 0;
    help.activeParameter = Math.min(parsed.argumentIndex, Math.max(0, (help.signatures[help.activeSignature].parameters || []).length - 1));
    return help;
  }

  provideDocumentSymbols(document) {
    const index = buildV3Index(document);
    const info = v3GetFileInfo(index, document.uri.fsPath);
    if (!info) return [];
    const out = [];
    for (const owner of [...info.classes, ...info.interfaces, ...info.staticCodes]) {
      const ownerKind = owner.kind === 'interface' ? vscode.SymbolKind.Interface : owner.kind === 'staticCode' ? vscode.SymbolKind.Module : vscode.SymbolKind.Class;
      const sym = new vscode.DocumentSymbol(owner.name, owner.kind, ownerKind, owner.fullRange || owner.range, owner.range);
      for (const prop of owner.properties.values()) sym.children.push(new vscode.DocumentSymbol(prop.name, prop.type || 'property', vscode.SymbolKind.Property, prop.fullRange || prop.range, prop.range));
      for (const field of owner.fields.values()) sym.children.push(new vscode.DocumentSymbol(field.name, field.type || 'field', vscode.SymbolKind.Field, field.fullRange || field.range, field.range));
      for (const method of owner.methods.values()) sym.children.push(new vscode.DocumentSymbol(method.name, v3MethodDetail(method), vscode.SymbolKind.Method, method.fullRange || method.range, method.range));
      out.push(sym);
    }
    for (const method of info.methods.filter(m => m.ownerKind === 'module')) {
      out.push(new vscode.DocumentSymbol(method.name, v3MethodDetail(method), vscode.SymbolKind.Function, method.fullRange || method.range, method.range));
    }
    return out;
  }
}

class B4XPPV3WorkspaceSymbolProvider {
  provideWorkspaceSymbols(query) {
    const folder = getWorkspaceFolder();
    if (!folder) return [];
    const index = buildV3IndexForRoot(folder.uri.fsPath, getConfig(), vscode.window.activeTextEditor && vscode.window.activeTextEditor.document);
    const q = String(query || '').toLowerCase();
    const symbols = [];
    const add = (symbol, kind, container) => {
      if (q && !symbol.name.toLowerCase().includes(q)) return;
      symbols.push(new vscode.SymbolInformation(symbol.name, kind, container || '', toLocation(symbol)));
    };
    for (const cls of index.classes.values()) add(cls, vscode.SymbolKind.Class, 'B4X++');
    for (const intf of index.interfaces.values()) add(intf, vscode.SymbolKind.Interface, 'B4X++');
    for (const mod of index.staticCodes.values()) add(mod, vscode.SymbolKind.Module, 'B4X++');
    for (const owner of [...index.classes.values(), ...index.interfaces.values(), ...index.staticCodes.values()]) {
      for (const prop of owner.properties.values()) add(prop, vscode.SymbolKind.Property, owner.name);
      for (const method of owner.methods.values()) add(method, vscode.SymbolKind.Method, owner.name);
    }
    return symbols.slice(0, 500);
  }
}

function buildV3Index(document) {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri) || getWorkspaceFolder();
  const root = folder ? folder.uri.fsPath : path.dirname(document.uri.fsPath);
  return buildV3IndexForRoot(root, getConfig(), document);
}

function buildV3IndexForRoot(root, config, activeDocument) {
  const sourceRoot = path.join(root, (config && config.sourceDir) || 'src-b4xpp');
  const files = fs.existsSync(sourceRoot) ? collectBxFiles(sourceRoot) : [];
  if (activeDocument && activeDocument.languageId === 'b4xpp' && !files.some(f => samePath(f, activeDocument.uri.fsPath))) files.push(activeDocument.uri.fsPath);
  const key = [root, files.map(f => `${f}:${safeMTime(f)}`).join('|'), activeDocument ? activeDocument.uri.fsPath + ':' + activeDocument.version : ''].join('::');
  if (b4xppV3IndexCache && b4xppV3IndexCacheKey === key) return b4xppV3IndexCache;

  const index = {
    root,
    sourceRoot,
    files,
    classes: new Map(),
    interfaces: new Map(),
    staticCodes: new Map(),
    fileInfos: new Map(),
    duplicates: []
  };
  for (const file of files) {
    try {
      const text = activeDocument && samePath(activeDocument.uri.fsPath, file) ? activeDocument.getText() : getWorkspaceText(file);
      const info = v3ParseFile(file, text);
      index.fileInfos.set(normalizePathKey(file), info);
      for (const cls of info.classes) v3AddNamed(index.classes, cls, index.duplicates);
      for (const intf of info.interfaces) v3AddNamed(index.interfaces, intf, index.duplicates);
      for (const mod of info.staticCodes) v3AddNamed(index.staticCodes, mod, index.duplicates);
    } catch (err) {}
  }
  b4xppV3IndexCache = index;
  b4xppV3IndexCacheKey = key;
  return index;
}

function v3AddNamed(map, symbol, duplicates) {
  const key = symbol.name.toLowerCase();
  if (map.has(key)) duplicates.push({ first: map.get(key), second: symbol });
  else map.set(key, symbol);
}

function safeMTime(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

function v3ParseFile(file, text) {
  const lines = normalizeNewlines(text).split('\n');
  const info = { file, lines, includes: [], classes: [], interfaces: [], staticCodes: [], methods: [] };
  let owner = null;
  let method = null;
  let inGlobals = false;

  const closeMethod = (endLine) => { if (method) method.endLine = Math.max(method.startLine, endLine); method = null; inGlobals = false; };
  const closeOwner = (endLine) => { if (owner) { owner.endLine = Math.max(owner.startLine, endLine); owner.fullRange = new vscode.Range(owner.startLine, 0, owner.endLine, 200); } owner = null; };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const code = splitCodeAndCommentForNavigation(raw).code;
    const trimmed = code.trim();
    const inc = trimmed.match(/^#Include\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
    if (inc) info.includes.push({ value: inc[1] || inc[2] || inc[3], file, line: i, range: makeWordRange(raw, i, inc[1] || inc[2] || inc[3], 0) });

    if (/^#End\s+(Class|Interface|StaticCode)\b/i.test(trimmed)) { closeMethod(i); closeOwner(i); continue; }
    if (/^End\s+Sub\b/i.test(trimmed) || /^End\s+(Get|Set)\b/i.test(trimmed)) { closeMethod(i); continue; }

    const staticMatch = trimmed.match(/^#StaticCode\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    if (staticMatch) { closeMethod(i - 1); closeOwner(i - 1); owner = v3MakeOwner('staticCode', staticMatch[1], raw, i, file); info.staticCodes.push(owner); continue; }

    const intfMatch = trimmed.match(/^#Interface\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    if (intfMatch) { closeMethod(i - 1); closeOwner(i - 1); owner = v3MakeOwner('interface', intfMatch[1], raw, i, file); info.interfaces.push(owner); continue; }

    const clsMatch = trimmed.match(/^#Class\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/i);
    if (clsMatch) {
      closeMethod(i - 1); closeOwner(i - 1);
      owner = v3MakeOwner('class', clsMatch[1], raw, i, file);
      const rest = clsMatch[2] || '';
      const ext = rest.match(/\bExtends\s+([A-Za-z_][A-Za-z0-9_]*)/i);
      const impl = rest.match(/\bImplements\s+(.+?)(?:\b(?:Extends|Abstract|Final|Composition|Strategy)\b|$)/i);
      owner.extendsName = ext ? ext[1] : null;
      owner.extendsRange = ext ? makeWordRange(raw, i, ext[1], raw.indexOf(ext[0])) : null;
      owner.implementsNames = parseImplementsNames(impl ? impl[1] : '');
      if (/\bFinal\b/i.test(rest)) owner.modifiers.push('final');
      if (/\bAbstract\b/i.test(rest)) owner.modifiers.push('abstract');
      info.classes.push(owner);
      continue;
    }

    const extLine = trimmed.match(/^#Extends\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    if (extLine && owner && owner.kind === 'class') { owner.extendsName = extLine[1]; owner.extendsRange = makeWordRange(raw, i, extLine[1], 0); continue; }
    const implLine = trimmed.match(/^#Implements\s+(.+)$/i);
    if (implLine && owner && owner.kind === 'class') { owner.implementsNames.push(...parseImplementsNames(implLine[1])); continue; }

    const prop = v3ParsePropertyLine(raw, i, file, owner);
    if (prop && owner) { owner.properties.set(prop.name.toLowerCase(), prop); continue; }

    const getterSetter = v3ParseGetterSetter(raw, i, file, owner);
    if (getterSetter && owner) {
      closeMethod(i - 1);
      method = getterSetter.method;
      v3OwnerAddMethod(owner, method);
      info.methods.push(method);
      const propName = getterSetter.property.name.toLowerCase();
      const old = owner.properties.get(propName) || getterSetter.property;
      if (getterSetter.kind === 'get') old.hasCustomGet = true;
      if (getterSetter.kind === 'set') old.hasCustomSet = true;
      owner.properties.set(propName, old);
      continue;
    }

    const methodSig = v3ParseMethod(raw, i, file, owner);
    if (methodSig) {
      closeMethod(i - 1);
      method = methodSig;
      info.methods.push(method);
      if (owner) v3OwnerAddMethod(owner, method);
      inGlobals = /^(Class_Globals|Process_Globals)$/i.test(method.name);
      continue;
    }

    if (owner && (method == null || inGlobals)) {
      const field = v3ParseFieldLine(raw, i, file, owner);
      if (field) owner.fields.set(field.name.toLowerCase(), field);
    }
  }
  closeMethod(lines.length - 1);
  closeOwner(lines.length - 1);
  return info;
}

function v3MakeOwner(kind, name, raw, line, file) {
  return { kind, name, file, line, startLine: line, endLine: line, range: makeWordRange(raw, line, name, 0), fullRange: new vscode.Range(line, 0, line, raw.length), methods: new Map(), methodOverloads: new Map(), properties: new Map(), fields: new Map(), implementsNames: [], modifiers: [] };
}

function v3OwnerAddMethod(owner, method) {
  if (!owner || !method) return;
  const key = String(method.name || '').toLowerCase();
  if (!owner.methods.has(key)) owner.methods.set(key, method);
  if (!owner.methodOverloads) owner.methodOverloads = new Map();
  if (!owner.methodOverloads.has(key)) owner.methodOverloads.set(key, []);
  owner.methodOverloads.get(key).push(method);
}

function v3ParsePropertyLine(raw, line, file, owner) {
  const code = splitCodeAndCommentForNavigation(raw).code.trim();
  const m = code.match(/^#Property\s+(.+?)\s+As\s+(.+)$/i);
  if (!m) return null;
  const tokens = m[1].trim().split(/\s+/).filter(Boolean);
  const name = tokens.pop();
  if (!name) return null;
  let visibility = 'public'; let mode = 'readwrite';
  for (const t of tokens) {
    const l = t.toLowerCase();
    if (['public', 'protected', 'private'].includes(l)) visibility = l;
    else if (l === 'readonly') mode = 'readonly';
    else if (l === 'writeonly') mode = 'writeonly';
  }
  let type = m[2].trim(); let defaultValue = '';
  const eq = type.indexOf('=');
  if (eq >= 0) { defaultValue = type.slice(eq + 1).trim(); type = type.slice(0, eq).trim(); }
  return { kind: 'property', name, file, line, startLine: line, endLine: line, ownerName: owner && owner.name, visibility, mode, type, defaultValue, range: makeWordRange(raw, line, name, 0), fullRange: new vscode.Range(line, 0, line, raw.length) };
}

function v3ParseGetterSetter(raw, line, file, owner) {
  const code = splitCodeAndCommentForNavigation(raw).code.trim();
  const m = code.match(/^((?:(?:Public|Private|Protected)\s+)*)?(Get|Set)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(?:As\s+([A-Za-z_][A-Za-z0-9_\.]*))?/i);
  if (!m) return null;
  const kind = m[2].toLowerCase();
  const name = m[3];
  const visibility = v3VisibilityFromPrefix(m[1] || '') || 'public';
  const params = kind === 'set' ? v3ParseParams(m[4] || 'B4XPP_Value As Object') : [];
  const returnType = kind === 'get' ? (m[5] || '') : '';
  const methodName = (kind === 'get' ? 'get' : 'set') + name;
  const method = { kind: 'method', name: methodName, file, line, startLine: line, endLine: line, range: makeWordRange(raw, line, name, 0), fullRange: new vscode.Range(line, 0, line, raw.length), ownerKind: owner ? owner.kind : 'module', ownerName: owner ? owner.name : path.basename(file, '.bx'), visibility, modifiers: [], params, paramsRaw: m[4] || '', returnType };
  const property = { kind: 'property', name, file, line, startLine: line, endLine: line, ownerName: owner && owner.name, visibility, mode: kind === 'get' ? 'readonly' : 'writeonly', type: returnType || (params[0] && params[0].type) || '', range: makeWordRange(raw, line, name, 0), fullRange: new vscode.Range(line, 0, line, raw.length) };
  return { kind, method, property };
}

function v3ParseFieldLine(raw, line, file, owner) {
  const code = splitCodeAndCommentForNavigation(raw).code.trim();
  const m = code.match(/^((?:Public|Private|Protected)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+As\s+((?:Poly\s+)?[A-Za-z_][A-Za-z0-9_\.]*)(?:\s*=.*)?$/i);
  if (!m) return null;
  const visibility = v3VisibilityFromPrefix(m[1] || '') || 'private';
  let type = m[3].trim(); let polyType = '';
  const poly = type.match(/^Poly\s+(.+)$/i);
  if (poly) { polyType = poly[1].trim(); type = 'Object'; }
  const name = m[2];
  return { kind: 'field', name, file, line, startLine: line, endLine: line, ownerName: owner && owner.name, visibility, type, polyType, range: makeWordRange(raw, line, name, 0), fullRange: new vscode.Range(line, 0, line, raw.length) };
}

function v3ParseMethod(raw, line, file, owner) {
  const ctor = raw.match(/^\s*#Constructor\s*(?:\(([^)]*)\))?/i);
  if (ctor) {
    return { kind: 'method', name: 'Initialize', file, line, startLine: line, endLine: line, range: makeWordRange(raw, line, '#Constructor', 0), fullRange: new vscode.Range(line, 0, line, raw.length), ownerKind: owner ? owner.kind : 'module', ownerName: owner ? owner.name : path.basename(file, '.bx'), visibility: 'public', modifiers: ['constructor'], params: v3ParseParams(ctor[1] || ''), paramsRaw: ctor[1] || '', returnType: '' };
  }
  const m = raw.match(/^\s*((?:(?:Public|Private|Protected|Override|Virtual|Abstract|Final)\s+)*)Sub\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(?:As\s+([A-Za-z_][A-Za-z0-9_\.]*))?/i);
  if (!m) return null;
  const tokens = (m[1] || '').trim().split(/\s+/).filter(Boolean).map(s => s.toLowerCase());
  let visibility = ''; const modifiers = [];
  for (const t of tokens) {
    if (['public', 'private', 'protected'].includes(t)) { if (!visibility) visibility = t; }
    else if (!modifiers.includes(t)) modifiers.push(t);
  }
  if (!visibility) visibility = owner && owner.kind === 'interface' ? 'public' : 'public';
  return { kind: 'method', name: m[2], file, line, startLine: line, endLine: line, range: makeWordRange(raw, line, m[2], 0), fullRange: new vscode.Range(line, 0, line, raw.length), ownerKind: owner ? owner.kind : 'module', ownerName: owner ? owner.name : path.basename(file, '.bx'), visibility, modifiers, params: v3ParseParams(m[3] || ''), paramsRaw: m[3] || '', returnType: (m[4] || '').trim() };
}

function v3VisibilityFromPrefix(prefix) {
  const m = String(prefix || '').match(/\b(Public|Private|Protected)\b/i);
  return m ? m[1].toLowerCase() : '';
}

function v3ParseParams(raw) {
  if (!raw || !raw.trim()) return [];
  return raw.split(',').map(part => {
    const t = part.trim();
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(\))?\s*(?:As\s+([A-Za-z_][A-Za-z0-9_\.]*))?/i);
    return m ? { name: m[1], type: m[2] || '' } : { name: t, type: '' };
  }).filter(p => p.name);
}

function collectV3SemanticDiagnostics(index) {
  const out = new Map();
  const add = (file, line, severity, message) => {
    const uri = vscode.Uri.file(file).toString();
    if (!out.has(uri)) out.set(uri, []);
    out.get(uri).push({ severity, line: line + 1, message });
  };
  for (const dup of index.duplicates) add(dup.second.file, dup.second.line, 'error', `Duplicate B4X++ symbol '${dup.second.name}'. First declaration is in ${path.basename(dup.first.file)}.`);
  for (const info of index.fileInfos.values()) {
    for (const inc of info.includes) {
      const resolved = resolveIncludeTargetForDocument({ uri: vscode.Uri.file(info.file) }, inc.value);
      if (!resolved || !fs.existsSync(resolved)) add(info.file, inc.line, 'error', `#Include file not found: ${inc.value}`);
    }
    for (const cls of info.classes) {
      if (cls.extendsName && !index.classes.has(cls.extendsName.toLowerCase())) add(cls.file, cls.line, 'error', `Parent class not found: ${cls.extendsName}.`);
      v3CollectOverloadDiagnosticsForOwner(cls, add);
      for (const name of cls.implementsNames || []) if (!index.interfaces.has(name.toLowerCase())) add(cls.file, cls.line, 'error', `Interface not found: ${name}.`);
      const seen = new Set();
      let cur = cls;
      while (cur && cur.extendsName) {
        const key = cur.extendsName.toLowerCase();
        if (seen.has(key)) { add(cls.file, cls.line, 'error', `Inheritance cycle detected at ${cur.extendsName}.`); break; }
        seen.add(key); cur = index.classes.get(key);
      }
      for (const method of cls.methods.values()) {
        if (method.modifiers.includes('override')) {
          const parentMethod = v3FindAncestorMethod(index, cls.name, method.name);
          if (!parentMethod) add(method.file, method.line, 'error', `Override target not found: ${method.name}.`);
          else if (parentMethod.method.visibility === 'private') add(method.file, method.line, 'error', `Cannot override private method: ${parentMethod.owner.name}.${method.name}.`);
          else if (!v3SameSignature(parentMethod.method, method)) add(method.file, method.line, 'error', `Override signature mismatch for ${method.name}.`);
        }
      }
    }
    for (const mod of info.staticCodes) v3CollectOverloadDiagnosticsForOwner(mod, add);
    for (let i = 0; i < info.lines.length; i++) {
      const raw = info.lines[i];
      const code = splitCodeAndCommentForNavigation(raw).code;
      const owner = v3FindClassAt(index, info, i);
      const typeDecl = code.match(/\b(?:Dim|Private|Public|Protected)\s+[A-Za-z_][A-Za-z0-9_]*\s+As\s+(?:Poly\s+)?([A-Za-z_][A-Za-z0-9_\.]*)/i);
      if (typeDecl && !v3IsKnownType(index, typeDecl[1])) add(info.file, i, 'warning', `Unknown type '${typeDecl[1]}'. If this is an external B4X library type, this warning can be ignored until external library indexing is enabled.`);
      const colorBad = code.match(/Props\.Get(?:Default)?\s*\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/i);
      if (colorBad && /color/i.test(colorBad[1]) && !/PaintOrColorToColor|DesignerColor/i.test(code)) add(info.file, i, 'warning', `Designer color '${colorBad[1]}' should be read with xui.PaintOrColorToColor(...) or a DesignerColor helper.`);
      const accessRe = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g;
      let m;
      while ((m = accessRe.exec(code))) {
        const receiver = m[1]; const member = m[2];
        if (/^(xui|DateTime|File|Regex|Log|Array|Colors)$/i.test(receiver)) continue;
        const resolved = v3ResolveReceiverType(index, info, i, receiver);
        if (!resolved) continue;
        const found = v3FindMemberInType(index, resolved.type, member);
        if (!found) continue;
        const visibility = found.symbol.visibility || 'public';
        const ownerName = found.owner && found.owner.name;
        if (!v3CanAccess(index, owner && owner.name, ownerName, visibility)) add(info.file, i, 'error', `Member is not accessible: ${ownerName}.${member} is ${visibility}.`);
      }
    }
  }
  return out;
}

function v3IsKnownType(index, typeName) {
  const t = String(typeName || '').replace(/\(\)$/, '');
  if (!t || B4X_V3_TYPES.has(t.toLowerCase())) return true;
  return index.classes.has(t.toLowerCase()) || index.interfaces.has(t.toLowerCase()) || index.staticCodes.has(t.toLowerCase());
}

function v3SameSignature(a, b) {
  const ap = a.params || v3ParseParams(a.paramsRaw || '');
  const bp = b.params || v3ParseParams(b.paramsRaw || '');
  if (ap.length !== bp.length) return false;
  if ((a.returnType || '').toLowerCase() !== (b.returnType || '').toLowerCase()) return false;
  for (let i = 0; i < ap.length; i++) if ((ap[i].type || '').toLowerCase() !== (bp[i].type || '').toLowerCase()) return false;
  return true;
}

function v3CollectOverloadDiagnosticsForOwner(owner, add) {
  if (!owner || !owner.methodOverloads) return;
  for (const methods of owner.methodOverloads.values()) {
    if (!methods || methods.length <= 1) continue;
    const byArity = new Map();
    for (const method of methods) {
      const arity = (method.params || []).length;
      if (byArity.has(arity)) add(method.file, method.line, 'error', `Ambiguous overload: ${owner.name}.${method.name} has more than one overload with ${arity} parameter(s). v0.3.2 resolves overloads by parameter count only.`);
      else byArity.set(arity, method);
    }
  }
}

function v3CanAccess(index, currentClassName, ownerClassName, visibility) {
  visibility = (visibility || 'public').toLowerCase();
  if (visibility === 'public') return true;
  if (!currentClassName || !ownerClassName) return false;
  if (currentClassName.toLowerCase() === ownerClassName.toLowerCase()) return true;
  if (visibility === 'protected') return v3IsDescendantOf(index, currentClassName, ownerClassName);
  return false;
}

function v3IsDescendantOf(index, child, parent) {
  let cls = index.classes.get(String(child || '').toLowerCase());
  const target = String(parent || '').toLowerCase();
  const seen = new Set();
  while (cls && cls.extendsName) {
    const key = cls.extendsName.toLowerCase();
    if (key === target) return true;
    if (seen.has(key)) return false;
    seen.add(key); cls = index.classes.get(key);
  }
  return false;
}

function v3GetFileInfo(index, file) { return index.fileInfos.get(normalizePathKey(file)); }
function v3FindClassAt(index, info, line) { return info ? info.classes.find(c => line >= c.startLine && line <= c.endLine) || null : null; }
function v3FindMethodAt(info, line) { return info ? info.methods.find(m => line >= m.startLine && line <= m.endLine) || null : null; }

function v3ResolveReceiverType(index, info, line, receiver) {
  if (!receiver) return null;
  const lname = receiver.toLowerCase();
  if (index.staticCodes.has(lname)) return { type: receiver, staticOnly: true };
  if (index.classes.has(lname)) return { type: receiver, staticOnly: true };
  const vars = v3CollectVariables(index, info, line);
  const variable = vars.get(lname);
  if (variable) return { type: variable.assignedType || variable.polyType || variable.type, staticOnly: false };
  return null;
}

function v3CollectVariables(index, info, line) {
  const vars = new Map();
  if (!info) return vars;
  const cls = v3FindClassAt(index, info, line);
  if (cls) {
    for (const field of cls.fields.values()) vars.set(field.name.toLowerCase(), { ...field, assignedType: null });
    for (const prop of cls.properties.values()) vars.set(prop.name.toLowerCase(), { ...prop, assignedType: null });
  }
  const method = v3FindMethodAt(info, line);
  const start = method ? method.startLine : 0;
  if (method) for (const p of method.params || []) vars.set(p.name.toLowerCase(), { name: p.name, type: p.type, assignedType: null });
  for (let i = start; i <= line && i < info.lines.length; i++) {
    const decl = parseVariableDeclarationLine(info.lines[i], i, info.file, true);
    if (decl) { vars.set(decl.name.toLowerCase(), decl); continue; }
    const code = splitCodeAndCommentForNavigation(info.lines[i]).code;
    const assign = code.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    if (assign) {
      const target = vars.get(assign[1].toLowerCase());
      const src = vars.get(assign[2].toLowerCase());
      if (target && src) target.assignedType = src.assignedType || src.polyType || src.type || null;
    }
  }
  return vars;
}

function v3MemberCompletions(index, typeName, options = {}) {
  const items = [];
  const seen = new Set();
  const addMethod = (method, owner) => {
    const key = 'm:' + method.name.toLowerCase(); if (seen.has(key)) return; seen.add(key);
    if (!v3CanAccess(index, options.currentClass, owner.name, method.visibility || 'public') && !(options.includePrivate && method.visibility === 'private') && !(options.includeProtected && method.visibility === 'protected')) return;
    if (/^(Class_Globals|Process_Globals)$/i.test(method.name)) return;
    items.push(methodCompletionItem(method, owner.name));
  };
  const addProp = (prop, owner) => {
    const key = 'p:' + prop.name.toLowerCase(); if (seen.has(key)) return; seen.add(key);
    if (!v3CanAccess(index, options.currentClass, owner.name, prop.visibility || 'public') && !(options.includePrivate && prop.visibility === 'private') && !(options.includeProtected && prop.visibility === 'protected')) return;
    const item = new vscode.CompletionItem(prop.name, vscode.CompletionItemKind.Property);
    item.detail = `${owner.name}.${prop.name} As ${prop.type || 'Object'} (${prop.visibility || 'public'})`;
    items.push(item);
  };
  const addField = (field, owner) => {
    const key = 'f:' + field.name.toLowerCase(); if (seen.has(key)) return; seen.add(key);
    if (!v3CanAccess(index, options.currentClass, owner.name, field.visibility || 'private') && !(options.includePrivate && field.visibility === 'private') && !(options.includeProtected && field.visibility === 'protected')) return;
    const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Field);
    item.detail = `${owner.name}.${field.name} As ${field.type || 'Object'} (${field.visibility || 'private'})`;
    items.push(item);
  };
  const owners = [];
  const cls = index.classes.get(String(typeName || '').toLowerCase());
  if (cls) { owners.push(cls); owners.push(...v3Ancestors(index, cls.name)); }
  const intf = index.interfaces.get(String(typeName || '').toLowerCase());
  if (intf) owners.push(intf);
  const stat = index.staticCodes.get(String(typeName || '').toLowerCase());
  if (stat) owners.push(stat);
  for (const owner of owners) {
    for (const prop of owner.properties.values()) addProp(prop, owner);
    if (!options.staticOnly) for (const field of owner.fields.values()) addField(field, owner);
    for (const method of v3AllOwnerMethods(owner)) addMethod(method, owner);
  }
  if (!items.length) items.push(...v3BuiltinMembers('', typeName));
  return items;
}

function v3TopLevelCompletions(index) {
  const out = [];
  for (const cls of index.classes.values()) out.push(v3Completion(cls.name, vscode.CompletionItemKind.Class, `B4X++ class${cls.extendsName ? ' extends ' + cls.extendsName : ''}`));
  for (const intf of index.interfaces.values()) out.push(v3Completion(intf.name, vscode.CompletionItemKind.Interface, 'B4X++ interface'));
  for (const mod of index.staticCodes.values()) out.push(v3Completion(mod.name, vscode.CompletionItemKind.Module, 'B4X++ static module'));
  for (const t of Array.from(B4X_V3_TYPES.values()).slice(0, 80)) out.push(v3Completion(t, vscode.CompletionItemKind.Class, 'B4X / XUI type'));
  return out;
}

function v3TypeCompletions(index) { return v3TopLevelCompletions(index); }
function v3Completion(label, kind, detail) { const item = new vscode.CompletionItem(label, kind); item.detail = detail; return item; }
function v3B4XKeywordCompletions() { return ['Dim','Sub','End Sub','If','Then','Else','For','Each','Next','Return','Wait For','Sleep','Try','Catch','Select','Case'].map(k => v3Completion(k, vscode.CompletionItemKind.Keyword, 'B4X keyword')); }

function v3OverrideCompletions(index, cls) {
  const out = [];
  const seen = new Set();
  for (const parent of v3Ancestors(index, cls.name)) {
    for (const m of v3AllOwnerMethods(parent)) {
      const key = `${m.name.toLowerCase()}#${(m.params || []).length}`; if (seen.has(key)) continue; seen.add(key);
      if (m.visibility === 'private') continue;
      if (m.modifiers.includes('final')) continue;
      if (!m.modifiers.some(x => ['virtual', 'abstract', 'override'].includes(x))) continue;
      const item = new vscode.CompletionItem(m.name, vscode.CompletionItemKind.Method);
      item.detail = `Override ${parent.name}.${v3MethodDetail(m)}`;
      item.insertText = new vscode.SnippetString(`Sub ${m.name}${m.paramsRaw ? '(' + m.paramsRaw + ')' : ''}${m.returnType ? ' As ' + m.returnType : ''}\n\t$0\nEnd Sub`);
      out.push(item);
    }
  }
  return out;
}

function v3AllOwnerMethods(owner) {
  if (!owner) return [];
  if (owner.methodOverloads && owner.methodOverloads.size) {
    const out = [];
    for (const list of owner.methodOverloads.values()) out.push(...list);
    return out;
  }
  return Array.from((owner.methods || new Map()).values());
}

function v3FindMethodInType(index, typeName, methodName) {
  const cls = index.classes.get(String(typeName || '').toLowerCase());
  if (cls) return v3FindMethodInClass(index, cls.name, methodName, { includeAncestors: true });
  const intf = index.interfaces.get(String(typeName || '').toLowerCase());
  if (intf && intf.methods.has(String(methodName || '').toLowerCase())) return { owner: intf, method: intf.methods.get(String(methodName || '').toLowerCase()) };
  const stat = index.staticCodes.get(String(typeName || '').toLowerCase());
  if (stat && stat.methods.has(String(methodName || '').toLowerCase())) return { owner: stat, method: stat.methods.get(String(methodName || '').toLowerCase()) };
  return null;
}

function v3FindMethodsInType(index, typeName, methodName) {
  const cls = index.classes.get(String(typeName || '').toLowerCase());
  if (cls) return v3FindMethodsInClass(index, cls.name, methodName, { includeAncestors: true });
  const key = String(methodName || '').toLowerCase();
  const intf = index.interfaces.get(String(typeName || '').toLowerCase());
  if (intf) return v3OwnerMethodsByName(intf, key).map(method => ({ owner: intf, method }));
  const stat = index.staticCodes.get(String(typeName || '').toLowerCase());
  if (stat) return v3OwnerMethodsByName(stat, key).map(method => ({ owner: stat, method }));
  return [];
}

function v3FindMemberInType(index, typeName, memberName) {
  const cls = index.classes.get(String(typeName || '').toLowerCase());
  const owners = cls ? [cls, ...v3Ancestors(index, cls.name)] : [];
  const intf = index.interfaces.get(String(typeName || '').toLowerCase()); if (intf) owners.push(intf);
  const stat = index.staticCodes.get(String(typeName || '').toLowerCase()); if (stat) owners.push(stat);
  const key = String(memberName || '').toLowerCase();
  for (const owner of owners) {
    if (owner.properties.has(key)) return { owner, symbol: owner.properties.get(key) };
    if (owner.fields.has(key)) return { owner, symbol: owner.fields.get(key) };
    if (owner.methods.has(key)) return { owner, symbol: owner.methods.get(key) };
    if (owner.properties.has(('get' + memberName).toLowerCase())) return { owner, symbol: owner.properties.get(('get' + memberName).toLowerCase()) };
  }
  return null;
}

function v3FindMethodInClass(index, className, methodName, opts = {}) {
  const cls = index.classes.get(String(className || '').toLowerCase());
  if (!cls) return null;
  const owners = [cls]; if (opts.includeAncestors) owners.push(...v3Ancestors(index, cls.name));
  const key = String(methodName || '').toLowerCase();
  for (const owner of owners) if (owner.methods.has(key)) return { owner, method: owner.methods.get(key) };
  return null;
}

function v3OwnerMethodsByName(owner, key) {
  if (!owner) return [];
  const k = String(key || '').toLowerCase();
  if (owner.methodOverloads && owner.methodOverloads.has(k)) return owner.methodOverloads.get(k);
  if (owner.methods && owner.methods.has(k)) return [owner.methods.get(k)];
  return [];
}

function v3FindMethodsInClass(index, className, methodName, opts = {}) {
  const cls = index.classes.get(String(className || '').toLowerCase());
  if (!cls) return [];
  const owners = [cls]; if (opts.includeAncestors) owners.push(...v3Ancestors(index, cls.name));
  const key = String(methodName || '').toLowerCase();
  const out = [];
  for (const owner of owners) {
    for (const method of v3OwnerMethodsByName(owner, key)) {
      if (opts.skipPrivate && method.visibility === 'private') continue;
      out.push({ owner, method });
    }
    if (out.length) break;
  }
  return out;
}

function v3FindAncestorMethod(index, className, methodName) {
  for (const parent of v3Ancestors(index, className)) if (parent.methods.has(String(methodName || '').toLowerCase())) return { owner: parent, method: parent.methods.get(String(methodName || '').toLowerCase()) };
  return null;
}

function v3Ancestors(index, className) {
  const out = []; const seen = new Set();
  let cur = index.classes.get(String(className || '').toLowerCase());
  while (cur && cur.extendsName) {
    const key = cur.extendsName.toLowerCase(); if (seen.has(key)) break; seen.add(key);
    cur = index.classes.get(key); if (cur) out.push(cur);
  }
  return out;
}

function v3ResolveSymbolAt(index, document, position) {
  const info = v3GetFileInfo(index, document.uri.fsPath); if (!info) return null;
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/); if (!range) return null;
  const word = document.getText(range); const line = document.lineAt(position.line).text;
  const dotted = getDottedMemberAt(line, range);
  if (dotted && dotted.member.toLowerCase() === word.toLowerCase()) {
    const receiver = dotted.receiver;
    let found = null;
    const currentClass = v3FindClassAt(index, info, position.line);
    if (/^Super$/i.test(receiver) && currentClass && currentClass.extendsName) found = v3FindMethodInClass(index, currentClass.extendsName, word, { includeAncestors: true });
    else if (/^(This|Me)$/i.test(receiver) && currentClass) found = v3FindMemberInType(index, currentClass.name, word);
    else { const resolved = v3ResolveReceiverType(index, info, position.line, receiver); if (resolved) found = v3FindMemberInType(index, resolved.type, word) || v3FindMethodInType(index, resolved.type, word); }
    const symbol = found && (found.symbol || found.method);
    if (symbol) return { ...symbol, ownerName: found.owner && found.owner.name, range };
  }
  const owner = v3FindClassAt(index, info, position.line) || info.staticCodes.find(s => position.line >= s.startLine && position.line <= s.endLine) || info.interfaces.find(s => position.line >= s.startLine && position.line <= s.endLine);
  if (owner) {
    const key = word.toLowerCase();
    if (owner.properties.has(key)) return { ...owner.properties.get(key), ownerName: owner.name, range };
    if (owner.fields.has(key)) return { ...owner.fields.get(key), ownerName: owner.name, range };
    if (owner.methods.has(key)) return { ...owner.methods.get(key), ownerName: owner.name, range };
  }
  const type = index.classes.get(word.toLowerCase()) || index.interfaces.get(word.toLowerCase()) || index.staticCodes.get(word.toLowerCase());
  if (type) return { ...type, range };
  return null;
}

function v3SymbolMarkdown(symbol) {
  const visibility = symbol.visibility ? `**Visibility:** ${symbol.visibility}\n\n` : '';
  if (symbol.kind === 'class') return `**class ${symbol.name}**${symbol.extendsName ? ` extends ${symbol.extendsName}` : ''}\n\n${symbol.file}`;
  if (symbol.kind === 'interface') return `**interface ${symbol.name}**\n\n${symbol.file}`;
  if (symbol.kind === 'staticCode') return `**static module ${symbol.name}**\n\n${symbol.file}`;
  if (symbol.kind === 'property') return `**Property ${symbol.name} As ${symbol.type || 'Object'}**\n\n${visibility}${symbol.ownerName ? `Declared in: ${symbol.ownerName}` : ''}`;
  if (symbol.kind === 'field') return `**Field ${symbol.name} As ${symbol.type || 'Object'}**\n\n${visibility}${symbol.ownerName ? `Declared in: ${symbol.ownerName}` : ''}`;
  if (symbol.kind === 'method') return `**Sub ${v3MethodDetail(symbol)}**\n\n${visibility}${symbol.ownerName ? `Declared in: ${symbol.ownerName}` : ''}`;
  return `**${symbol.name}**`;
}

function v3MethodDetail(m) { return `${m.name}${m.paramsRaw ? '(' + m.paramsRaw + ')' : ''}${m.returnType ? ' As ' + m.returnType : ''}`; }

function v3ParseCallAt(document, position) {
  const text = document.lineAt(position.line).text.slice(0, position.character);
  const idx = text.lastIndexOf('('); if (idx < 0) return null;
  const before = text.slice(0, idx);
  const m = before.match(/(?:(\b[A-Za-z_][A-Za-z0-9_]*)\s*\.)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/);
  if (!m) return null;
  const argsText = text.slice(idx + 1);
  let inString = false; let depth = 0; let comma = 0;
  for (let i = 0; i < argsText.length; i++) {
    const ch = argsText[i];
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '(') depth++; else if (ch === ')' && depth > 0) depth--; else if (ch === ',' && depth === 0) comma++;
  }
  return { receiver: m[1] || '', name: m[2], argumentIndex: comma };
}

function v3BuiltinMembers(receiver, typeName) {
  const key = String(typeName || receiver || '').toLowerCase();
  const entries = B4X_V3_TYPE_MEMBERS.get(key) || [];
  return entries.map(m => {
    const item = new vscode.CompletionItem(m.name, m.kind === 'property' ? vscode.CompletionItemKind.Property : vscode.CompletionItemKind.Method);
    item.detail = m.detail || 'B4X / XUI member';
    return item;
  });
}

function v3BuiltinMethodSignature(receiver, methodName) {
  const lname = String(methodName || '').toLowerCase();
  for (const list of B4X_V3_TYPE_MEMBERS.values()) {
    const entry = list.find(x => x.name.toLowerCase() === lname && x.params);
    if (entry) return { owner: { name: 'B4X' }, method: { kind: 'method', name: entry.name, params: entry.params, returnType: entry.returnType || '' } };
  }
  return null;
}


//────────────────────────────────────────────────────────────
// B4X++ v0.3.2 navigation + B4XLib / CustomView assistant
//────────────────────────────────────────────────────────────
async function validateB4XLibCustomViewsCommand() {
  const folder = getWorkspaceFolder();
  if (!folder) {
    vscode.window.showErrorMessage('B4X++: open a VS Code project folder first.');
    return;
  }
  const editor = vscode.window.activeTextEditor;
  const config = getConfig();
  const index = buildV3IndexForRoot(folder.uri.fsPath, config, editor && editor.document);
  const diagnostics = collectV32CustomViewAndB4XLibDiagnostics(index);
  publishDiagnostics(diagnostics);
  let errorCount = 0;
  let warningCount = 0;
  for (const list of diagnostics.values()) {
    for (const d of list) {
      if (d.severity === 'error') errorCount++; else warningCount++;
    }
  }
  const message = `B4X++: CustomView / B4XLib validation finished (${errorCount} errors, ${warningCount} warnings).`;
  if (errorCount) vscode.window.showErrorMessage(message);
  else vscode.window.showInformationMessage(message);
}

class B4XPPV32NavigationProvider {
  provideDefinition(document, position) {
    const includeTarget = getIncludeTargetAt(document, position);
    if (includeTarget) {
      const resolved = resolveIncludeTargetForDocument(document, includeTarget.value);
      if (resolved && fs.existsSync(resolved)) return new vscode.Location(vscode.Uri.file(resolved), new vscode.Position(0, 0));
    }
    const index = buildV3Index(document);
    const symbol = v32ResolveSymbolTarget(index, document, position);
    if (symbol && symbol.file) return toLocation(symbol);
    return null;
  }
}

class B4XPPV32ReferenceProvider {
  provideReferences(document, position, context) {
    const index = buildV3Index(document);
    const target = v32ResolveSymbolTarget(index, document, position);
    if (!target || !target.name) return [];
    const files = v32ReferenceSearchFiles(index, target, document.uri.fsPath);
    const refs = [];
    for (const file of files) {
      let text = '';
      try { text = samePath(file, document.uri.fsPath) ? document.getText() : getWorkspaceText(file); } catch { continue; }
      const lines = normalizeNewlines(text).split('\n');
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const code = splitCodeAndCommentForNavigation(lines[lineIndex]).code;
        for (const range of v32WordRangesInLine(code, lineIndex, target.name)) {
          if (!context || context.includeDeclaration !== false || !v32SameRange(file, range, target.file, target.range)) {
            refs.push(new vscode.Location(vscode.Uri.file(file), range));
          }
        }
      }
    }
    return refs;
  }
}

class B4XPPV32RenameProvider {
  prepareRename(document, position) {
    const index = buildV3Index(document);
    const target = v32ResolveSymbolTarget(index, document, position);
    if (!target) throw new Error('B4X++: no renameable symbol here.');
    if (['class', 'interface', 'staticCode'].includes(target.kind)) {
      throw new Error('B4X++: workspace type rename is intentionally not enabled yet. Rename local fields, variables, methods and properties first.');
    }
    if (!target.range) throw new Error('B4X++: no safe rename range found.');
    return target.range;
  }

  provideRenameEdits(document, position, newName) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName || '')) throw new Error('B4X++: invalid B4X identifier.');
    const index = buildV3Index(document);
    const target = v32ResolveSymbolTarget(index, document, position);
    if (!target || ['class', 'interface', 'staticCode'].includes(target.kind)) return null;
    const edit = new vscode.WorkspaceEdit();
    const refs = v32ReferencesForRename(index, document, target);
    for (const ref of refs) edit.replace(ref.uri, ref.range, newName);
    return edit;
  }
}

class B4XPPV32CodeActionProvider {
  provideCodeActions(document, range) {
    const index = buildV3Index(document);
    const actions = [];
    const auto = v32AutoIncludeAction(index, document, range.start);
    if (auto) actions.push(auto);
    const colorFix = v32DesignerColorFixAction(document, range.start);
    if (colorFix) actions.push(colorFix);
    return actions;
  }
}

function v32ResolveSymbolTarget(index, document, position) {
  const info = v3GetFileInfo(index, document.uri.fsPath);
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
  if (!range || !info) return null;
  const word = document.getText(range);
  const local = v32ResolveLocalVariable(index, info, position.line, word, range);
  if (local) return local;
  const resolved = v3ResolveSymbolAt(index, document, position);
  if (resolved) return resolved;
  const type = index.classes.get(word.toLowerCase()) || index.interfaces.get(word.toLowerCase()) || index.staticCodes.get(word.toLowerCase());
  if (type) return type;
  return null;
}

function v32ResolveLocalVariable(index, info, line, word, clickedRange) {
  const method = v3FindMethodAt(info, line);
  if (!method) return null;
  const key = word.toLowerCase();
  for (const p of method.params || []) {
    if (p.name.toLowerCase() === key) {
      const declLine = info.lines[method.startLine] || '';
      return { kind: 'local', name: p.name, type: p.type || '', file: info.file, line: method.startLine, startLine: method.startLine, endLine: method.endLine, range: makeWordRange(declLine, method.startLine, p.name, 0), scopeStart: method.startLine, scopeEnd: method.endLine };
    }
  }
  for (let i = method.startLine; i <= Math.min(line, method.endLine); i++) {
    const decl = parseVariableDeclarationLine(info.lines[i], i, info.file, true);
    if (decl && decl.name.toLowerCase() === key) {
      return { ...decl, kind: 'local', scopeStart: i, scopeEnd: method.endLine };
    }
  }
  return null;
}

function v32ReferenceSearchFiles(index, target, currentFile) {
  if (target.kind === 'local') return [target.file || currentFile];
  if (target.visibility === 'private' && target.file) return [target.file];
  if (target.ownerName && target.file && ['field', 'property', 'method'].includes(target.kind)) return Array.from(new Set([target.file, ...index.files]));
  return index.files || [currentFile];
}

function v32ReferencesForRename(index, document, target) {
  if (target.kind === 'local') {
    const info = v3GetFileInfo(index, document.uri.fsPath);
    const start = target.scopeStart || target.line || 0;
    const end = target.scopeEnd || (v3FindMethodAt(info, target.line || start) || {}).endLine || start;
    return v32FindWordLocationsInFile(document.uri.fsPath, document.getText(), target.name, start, end);
  }
  if (['field', 'property', 'method'].includes(target.kind)) {
    const info = v3GetFileInfo(index, target.file || document.uri.fsPath);
    const owner = info && (info.classes.find(c => c.name === target.ownerName) || info.staticCodes.find(s => s.name === target.ownerName) || info.interfaces.find(s => s.name === target.ownerName));
    const start = owner ? owner.startLine : 0;
    const end = owner ? owner.endLine : info ? info.lines.length - 1 : 999999;
    const text = samePath(target.file || document.uri.fsPath, document.uri.fsPath) ? document.getText() : getWorkspaceText(target.file || document.uri.fsPath);
    return v32FindWordLocationsInFile(target.file || document.uri.fsPath, text, target.name, start, end);
  }
  return [];
}

function v32FindWordLocationsInFile(file, text, word, startLine = 0, endLine = 999999) {
  const out = [];
  const lines = normalizeNewlines(text).split('\n');
  for (let i = Math.max(0, startLine); i <= Math.min(endLine, lines.length - 1); i++) {
    const code = splitCodeAndCommentForNavigation(lines[i]).code;
    for (const range of v32WordRangesInLine(code, i, word)) out.push(new vscode.Location(vscode.Uri.file(file), range));
  }
  return out;
}

function v32WordRangesInLine(line, lineIndex, word) {
  const out = [];
  if (!word) return out;
  const re = new RegExp(`\\b${v32EscapeRegExp(word)}\\b`, 'gi');
  let m;
  while ((m = re.exec(line))) out.push(new vscode.Range(lineIndex, m.index, lineIndex, m.index + m[0].length));
  return out;
}

function v32SameRange(fileA, rangeA, fileB, rangeB) {
  return fileA && fileB && samePath(fileA, fileB) && rangeA && rangeB && rangeA.start.line === rangeB.start.line && rangeA.start.character === rangeB.start.character && rangeA.end.character === rangeB.end.character;
}

function v32EscapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function v32AutoIncludeAction(index, document, position) {
  const line = document.lineAt(position.line).text;
  const typeName = v32TypeNameAtPosition(line, position.character);
  if (!typeName) return null;
  const symbol = index.classes.get(typeName.toLowerCase()) || index.interfaces.get(typeName.toLowerCase()) || index.staticCodes.get(typeName.toLowerCase());
  if (!symbol || samePath(symbol.file, document.uri.fsPath)) return null;
  if (v32DocumentHasIncludeFor(document, symbol.file)) return null;
  const root = index.sourceRoot && fs.existsSync(index.sourceRoot) ? index.sourceRoot : path.dirname(document.uri.fsPath);
  let rel = path.relative(path.dirname(document.uri.fsPath), symbol.file).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  const action = new vscode.CodeAction(`Add #Include "${rel}"`, vscode.CodeActionKind.QuickFix);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, new vscode.Position(v32IncludeInsertLine(document), 0), `#Include "${rel}"\n`);
  action.edit = edit;
  action.isPreferred = true;
  return action;
}

function v32TypeNameAtPosition(line, character) {
  const before = line.slice(0, character);
  const after = line.slice(character);
  const text = before + after;
  const candidates = [];
  const patterns = [
    /\bAs\s+(?:Poly\s+)?([A-Za-z_][A-Za-z0-9_]*)/ig,
    /\bExtends\s+([A-Za-z_][A-Za-z0-9_]*)/ig,
    /\bImplements\s+([A-Za-z_][A-Za-z0-9_]*)/ig,
    /\bPoly\s+([A-Za-z_][A-Za-z0-9_]*)/ig
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) candidates.push({ name: m[1], start: m.index + m[0].lastIndexOf(m[1]), end: m.index + m[0].lastIndexOf(m[1]) + m[1].length });
  }
  const hit = candidates.find(c => character >= c.start && character <= c.end);
  return hit && hit.name;
}

function v32DocumentHasIncludeFor(document, targetFile) {
  const dir = path.dirname(document.uri.fsPath);
  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;
    const m = text.match(/^\s*#Include\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
    if (!m) continue;
    const raw = m[1] || m[2] || m[3];
    const resolved = path.resolve(dir, raw);
    if (samePath(resolved, targetFile)) return true;
  }
  return false;
}

function v32IncludeInsertLine(document) {
  let lastDirective = 0;
  for (let i = 0; i < Math.min(document.lineCount, 80); i++) {
    const t = document.lineAt(i).text.trim();
    if (/^#(?:Project|Package|ProjectDir|MainModule|B4XLib|Version|Author|SupportedPlatforms|DependsOn|B4A|B4J|B4i|Include)\b/i.test(t)) lastDirective = i + 1;
    else if (t && !t.startsWith("'")) break;
  }
  return lastDirective;
}

function v32DesignerColorFixAction(document, position) {
  const line = document.lineAt(position.line).text;
  if (!/Props\.Get(?:Default)?\s*\(\s*"[A-Za-z_][A-Za-z0-9_]*Color[A-Za-z0-9_]*"/i.test(line)) return null;
  if (/PaintOrColorToColor|DesignerColor/i.test(line)) return null;
  const action = new vscode.CodeAction('Wrap Designer color read with xui.PaintOrColorToColor(...)', vscode.CodeActionKind.QuickFix);
  const fixed = line.replace(/Props\.(Get(?:Default)?)\s*\((.+)\)/i, 'xui.PaintOrColorToColor(Props.$1($2))');
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(position.line, 0, position.line, line.length), fixed);
  action.edit = edit;
  return action;
}

function collectV32CustomViewAndB4XLibDiagnostics(index) {
  const out = new Map();
  const add = (file, line, severity, message) => {
    const uri = vscode.Uri.file(file).toString();
    if (!out.has(uri)) out.set(uri, []);
    out.get(uri).push({ severity, line: Math.max(1, line + 1), message });
  };
  for (const info of index.fileInfos.values()) {
    v32ValidateManifestDirectives(info, add);
    v32ValidateDesignerDirectives(info, add);
    for (const cls of info.classes) v32ValidateCustomViewClass(index, info, cls, add);
  }
  return out;
}

function v32ValidateManifestDirectives(info, add) {
  const directives = new Map();
  for (let i = 0; i < info.lines.length; i++) {
    const code = splitCodeAndCommentForNavigation(info.lines[i]).code.trim();
    const m = code.match(/^#(B4XLib|Version|Author|SupportedPlatforms|DependsOn|B4JDependsOn|B4ADependsOn|B4iDependsOn)\b\s*(.*)$/i);
    if (m && !directives.has(m[1].toLowerCase())) directives.set(m[1].toLowerCase(), { value: (m[2] || '').trim(), line: i });
  }
  const lib = directives.get('b4xlib');
  if (!lib) return;
  if (!lib.value) add(info.file, lib.line, 'error', '#B4XLib must specify a library name.');
  const version = directives.get('version');
  if (!version) add(info.file, lib.line, 'warning', 'B4XLib manifest should include #Version, for example #Version 0.30.');
  else if (!/^\d+(?:\.\d+){0,2}$/.test(version.value)) add(info.file, version.line, 'warning', `#Version should use a B4X-friendly numeric format, for example 0.30. Current value: ${version.value}`);
  if (!directives.get('author')) add(info.file, lib.line, 'warning', 'B4XLib manifest should include #Author.');
  const platforms = directives.get('supportedplatforms');
  if (platforms && !/\bB4A\b|\bB4J\b|\bB4i\b/i.test(platforms.value)) add(info.file, platforms.line, 'warning', '#SupportedPlatforms should list at least one of B4A, B4J, B4i.');
}

function v32ValidateDesignerDirectives(info, add) {
  const designerKeys = new Map();
  for (let i = 0; i < info.lines.length; i++) {
    const line = splitCodeAndCommentForNavigation(info.lines[i]).code.trim();
    if (/^#DesignerProperty\b/i.test(line)) {
      const fields = v32ParseDirectiveFields(line);
      const key = fields.get('key');
      const ft = fields.get('fieldtype');
      if (!key) add(info.file, i, 'error', '#DesignerProperty is missing Key.');
      else if (designerKeys.has(key.toLowerCase())) add(info.file, i, 'warning', `Duplicate #DesignerProperty Key: ${key}.`);
      else designerKeys.set(key.toLowerCase(), i);
      if (!ft) add(info.file, i, 'error', `#DesignerProperty ${key || ''} is missing FieldType.`);
      else if (!v32KnownDesignerFieldType(ft)) add(info.file, i, 'warning', `Unknown DesignerProperty FieldType '${ft}'.`);
      if (/^Color$/i.test(ft || '') && !fields.has('defaultvalue')) add(info.file, i, 'warning', `Color DesignerProperty ${key || ''} should include DefaultValue.`);
    }
    if (/^#Event\b/i.test(line)) {
      const m = line.match(/^#Event\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\((.*)\))?\s*$/i);
      if (!m) add(info.file, i, 'error', '#Event syntax should be: #Event: EventName (Arg As Type, ...).');
      else if (m[2]) {
        for (const param of m[2].split(',')) {
          if (param.trim() && !/^[A-Za-z_][A-Za-z0-9_]*\s+As\s+[A-Za-z_][A-Za-z0-9_\.]*$/i.test(param.trim())) add(info.file, i, 'warning', `#Event parameter should use 'Name As Type': ${param.trim()}`);
        }
      }
    }
  }
}

function v32ValidateCustomViewClass(index, info, cls, add) {
  const hasDesigner = v32ClassHasLine(info, cls, /^#DesignerProperty\b/i) || v32ClassHasLine(info, cls, /^#Event\b/i);
  const hasDesignerCreateView = v32OwnerHasMethod(cls, 'DesignerCreateView');
  const hasBaseResize = v32OwnerHasMethod(cls, 'Base_Resize');
  const hasMBase = cls.fields.has('mbase') || v32ClassMentions(info, cls, /\bmBase\b/i);
  if (!hasDesigner && !hasDesignerCreateView && !hasMBase) return;
  if (!v32OwnerHasMethod(cls, 'Initialize')) add(cls.file, cls.line, 'error', `CustomView class ${cls.name} should expose Public Sub Initialize(Callback As Object, EventName As String).`);
  if (!hasDesignerCreateView) add(cls.file, cls.line, 'error', `CustomView class ${cls.name} should expose DesignerCreateView(Base As Object, Lbl As Label, Props As Map).`);
  if (!hasBaseResize) add(cls.file, cls.line, 'warning', `CustomView class ${cls.name} should usually expose Base_Resize(Width As Double, Height As Double).`);
  const mBase = cls.fields.get('mbase');
  if (mBase && (mBase.visibility || '').toLowerCase() !== 'public') add(mBase.file, mBase.line, 'warning', 'CustomView mBase is usually Public mBase As B4XView for Designer compatibility.');
  const tag = cls.fields.get('tag');
  if (tag && (tag.visibility || '').toLowerCase() !== 'public') add(tag.file, tag.line, 'warning', 'CustomView Tag is usually Public Tag As Object for Designer compatibility.');
  const dcv = v32OwnerFirstMethod(cls, 'DesignerCreateView');
  if (dcv) {
    const params = dcv.params || [];
    if (params.length < 3) add(dcv.file, dcv.line, 'warning', 'DesignerCreateView should normally have Base As Object, Lbl As Label, Props As Map.');
  }
}

function v32ParseDirectiveFields(line) {
  const out = new Map();
  const after = String(line).replace(/^#DesignerProperty\s*:\s*/i, '');
  for (const part of after.split(',')) {
    const m = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (m) out.set(m[1].toLowerCase(), m[2].trim());
  }
  return out;
}

function v32KnownDesignerFieldType(ft) {
  return /^(String|Int|Float|Double|Boolean|Color|List|Text|MultilineText|Bitmap|File|Font|Separator)$/i.test(String(ft || '').trim());
}

function v32ClassHasLine(info, cls, regex) {
  for (let i = cls.startLine; i <= cls.endLine && i < info.lines.length; i++) if (regex.test(splitCodeAndCommentForNavigation(info.lines[i]).code.trim())) return true;
  return false;
}
function v32ClassMentions(info, cls, regex) {
  for (let i = cls.startLine; i <= cls.endLine && i < info.lines.length; i++) if (regex.test(splitCodeAndCommentForNavigation(info.lines[i]).code)) return true;
  return false;
}
function v32OwnerHasMethod(owner, name) { return !!v32OwnerFirstMethod(owner, name); }
function v32OwnerFirstMethod(owner, name) {
  const methods = v3OwnerMethodsByName(owner, String(name || '').toLowerCase());
  return methods && methods[0];
}


const B4X_V3_TYPES = new Map([
  'string','int','long','float','double','boolean','object','list','map','b4xview','b4xcanvas','xui','bitmap','b4xbitmap','rect','b4xrect','b4xfont','resumablesub','label','button','pane','form','timer','jfx','javaobject','inputstream','outputstream','stringbuilder','color','paint','image','scrollview'
].map(x => [x, x.replace(/(^|_)([a-z])/g, (_, a, b) => a + b.toUpperCase())]));

const B4X_V3_TYPE_MEMBERS = new Map([
  ['xui', [
    { name: 'CreatePanel', params: [{ name: 'EventName', type: 'String' }], returnType: 'B4XView', detail: 'CreatePanel(EventName As String) As B4XView' },
    { name: 'CreateDefaultFont', params: [{ name: 'Size', type: 'Float' }], returnType: 'B4XFont', detail: 'CreateDefaultFont(Size As Float) As B4XFont' },
    { name: 'CreateDefaultBoldFont', params: [{ name: 'Size', type: 'Float' }], returnType: 'B4XFont', detail: 'CreateDefaultBoldFont(Size As Float) As B4XFont' },
    { name: 'PaintOrColorToColor', params: [{ name: 'PaintOrColor', type: 'Object' }], returnType: 'Int', detail: 'PaintOrColorToColor(PaintOrColor As Object) As Int' },
    { name: 'Color_RGB', params: [{ name: 'R', type: 'Int' }, { name: 'G', type: 'Int' }, { name: 'B', type: 'Int' }], returnType: 'Int' },
    { name: 'Color_ARGB', params: [{ name: 'A', type: 'Int' }, { name: 'R', type: 'Int' }, { name: 'G', type: 'Int' }, { name: 'B', type: 'Int' }], returnType: 'Int' },
    { name: 'Color_White', kind: 'property' }, { name: 'Color_Black', kind: 'property' }, { name: 'Color_Transparent', kind: 'property' }
  ]],
  ['b4xview', [
    { name: 'AddView', params: [{ name: 'View', type: 'B4XView' }, { name: 'Left', type: 'Double' }, { name: 'Top', type: 'Double' }, { name: 'Width', type: 'Double' }, { name: 'Height', type: 'Double' }] },
    { name: 'RemoveAllViews' }, { name: 'SetLayoutAnimated' }, { name: 'LoadLayout' }, { name: 'Width', kind: 'property' }, { name: 'Height', kind: 'property' }, { name: 'Color', kind: 'property' }, { name: 'Visible', kind: 'property' }, { name: 'Text', kind: 'property' }, { name: 'Tag', kind: 'property' }
  ]],
  ['b4xcanvas', [
    { name: 'Initialize', params: [{ name: 'Target', type: 'B4XView' }] }, { name: 'Resize' }, { name: 'Invalidate' }, { name: 'ClearRect' }, { name: 'DrawCircle' }, { name: 'DrawLine' }, { name: 'DrawText' }, { name: 'Release' }
  ]],
  ['list', [{ name: 'Initialize' }, { name: 'Add' }, { name: 'Get' }, { name: 'Set' }, { name: 'RemoveAt' }, { name: 'Clear' }, { name: 'Size', kind: 'property' }, { name: 'IsInitialized' }]],
  ['map', [{ name: 'Initialize' }, { name: 'Put' }, { name: 'Get' }, { name: 'GetDefault' }, { name: 'ContainsKey' }, { name: 'Remove' }, { name: 'Clear' }, { name: 'Size', kind: 'property' }, { name: 'IsInitialized' }]],
  ['timer', [{ name: 'Initialize' }, { name: 'Enabled', kind: 'property' }, { name: 'Interval', kind: 'property' }]],
  ['string', [{ name: 'Length', kind: 'property' }, { name: 'Trim' }, { name: 'ToLowerCase' }, { name: 'ToUpperCase' }, { name: 'SubString' }, { name: 'SubString2' }, { name: 'Contains' }, { name: 'Replace' }]]
]);

module.exports = { activate, deactivate };
