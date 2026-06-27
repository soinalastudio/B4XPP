'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { transpileText, transpileFiles, B4XPP_GENERATOR_VERSION } = require('./lib/transpiler');

let diagnosticCollection;

function activate(context) {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('b4xpp');
  context.subscriptions.push(diagnosticCollection);

  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.generateBas', generateBasCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.createExample', createExampleCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.showGeneratedFolder', showGeneratedFolderCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.createIdeProject', createIdeProjectCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.syncDirectiveProject', syncDirectiveProjectCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.buildB4XLib', buildB4XLibCommand));

  const navigationProvider = new B4XPPSymbolNavigationProvider();
  context.subscriptions.push(vscode.languages.registerDefinitionProvider({ language: 'b4xpp' }, navigationProvider));
  context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ language: 'b4xpp' }, navigationProvider));

  const completionProvider = new B4XPPCompletionProvider();
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'b4xpp' }, completionProvider, '.', ' '));

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
  return {
    generatorVersion: B4XPP_GENERATOR_VERSION,
    generatedAt: new Date().toISOString(),
    generatedRoot,
    outputs: (result.outputs || []).map(out => ({
      generated: generatedRoot ? `${generatedRoot}/${out.fileName}` : out.fileName,
      module: out.moduleName,
      kind: out.kind,
      source: rel(out.sourcePath),
      lineOffset: 1,
      note: 'B4X++ v0.2 keeps a coarse module-level map. Fine-grained line maps are planned for later builds.'
    })),
    diagnostics: (result.diagnostics || []).map(d => ({ severity: d.severity, message: d.message, source: rel(d.sourcePath), line: d.line || 1 }))
  };
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
        publishDiagnostics(result.allDiagnostics);
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
  publishDiagnostics(new Map([[document.uri.toString(), result.diagnostics || []]]));
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

module.exports = { activate, deactivate };
