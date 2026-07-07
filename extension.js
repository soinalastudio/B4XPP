'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const crypto = require('crypto');
const { transpileText, transpileFiles, B4XPP_GENERATOR_VERSION, clearB4XLibraryIndexCache, parseB4XLibraryXml, parseB4XLibFile, parseB4XPPLibFile, parseB4XIdeProjectHeader, buildB4XLibraryIndex } = require('./lib/transpiler');

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
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.buildB4XPPLib', buildB4XPPLibCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.remapB4XErrors', remapB4XErrorsCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.generateDebugBundle', generateDebugBundleCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.buildB4JWithRemap', () => buildNativeB4XWithRemapCommand('b4j')));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.buildB4AWithRemap', () => buildNativeB4XWithRemapCommand('b4a')));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.buildB4iWithRemap', () => buildNativeB4XWithRemapCommand('b4i')));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.buildCurrentPlatformWithRemap', () => buildNativeB4XWithRemapCommand('auto')));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.refreshIntelliSense', refreshIntelliSenseCommand));
  context.subscriptions.push(vscode.commands.registerCommand('b4xpp.configureProjectSettings', () => configureProjectSettingsCommand(context)));

  const navigationProvider = new B4XPPSymbolNavigationProvider();
  context.subscriptions.push(vscode.languages.registerDefinitionProvider({ language: 'b4xpp' }, navigationProvider));
  context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ language: 'b4xpp' }, navigationProvider));

  const intelliSenseProvider = new B4XPPV3IntelliSenseProvider();
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'b4xpp' }, intelliSenseProvider, '.', ' ', '#', '=', '(', ',', '+', '-', '*', '/', '<', '>'));
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

function getBundledB4XPPLibDirs() {
  const dirs = [];
  try {
    const bundled = path.join(__dirname, 'b4xpp-libs');
    if (fs.existsSync(bundled)) dirs.push(bundled);
  } catch {}
  return dirs;
}

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
  const folder = getWorkspaceFolder();
  const cfg = vscode.workspace.getConfiguration('b4xpp', folder ? folder.uri : undefined);
  const rawSettings = folder ? readWorkspaceB4XPPSettings(folder) : {};
  const read = (key, fallback) => {
    const fullKey = `b4xpp.${key}`;
    if (rawSettings && Object.prototype.hasOwnProperty.call(rawSettings, fullKey)) {
      const value = rawSettings[fullKey];
      if (Array.isArray(value)) return value.slice();
      return value;
    }
    const value = cfg.get(key);
    if (value === undefined || value === null) return fallback;
    if (Array.isArray(value)) return value.slice();
    return value;
  };
  return {
    sourceDir: read('sourceDir', 'src-b4xpp') || 'src-b4xpp',
    outputDir: read('outputDir', 'generated-b4x') || 'generated-b4x',
    mainModuleName: read('mainModuleName', '') || '',
    addGeneratedHeader: read('addGeneratedHeader', true) !== false,
    overwriteGeneratedFiles: read('overwriteGeneratedFiles', true) !== false,
    includeTimestamp: read('includeTimestamp', false) === true,
    projectDir: read('projectDir', 'b4x-ide-projects') || 'b4x-ide-projects',
    packageName: read('packageName', 'b4xpp.example') || 'b4xpp.example',
    mobileMainModuleName: read('mobileMainModuleName', 'B4XPPMain') || 'B4XPPMain',
    b4xlibDir: read('b4xlibDir', 'b4x-libs') || 'b4x-libs',
    b4xpplibDir: read('b4xpplibDir', 'b4xpp-libs') || 'b4xpp-libs',
    b4jBuildCommand: read('b4jBuildCommand', '') || '',
    b4aBuildCommand: read('b4aBuildCommand', '') || '',
    b4iBuildCommand: read('b4iBuildCommand', '') || '',
    b4jBuilderPath: read('b4j.builderPath', '') || '',
    b4aBuilderPath: read('b4a.builderPath', '') || '',
    b4iBuilderPath: read('b4i.builderPath', '') || '',
    buildConfiguration: read('buildConfiguration', 'Default') || 'Default',
    buildTask: read('buildTask', 'Build') || 'Build',
    buildShowWarnings: read('buildShowWarnings', true) !== false,
    buildUseBaseFolder: read('buildUseBaseFolder', true) !== false,
    writeLineSourceMap: read('writeLineSourceMap', true) !== false,
    enableSemanticDiagnostics: read('enableSemanticDiagnostics', true) !== false,
    validationStrict: read('validation.strict', false) === true,
    platform: read('platform', 'auto') || 'auto',
    b4jInternalLibraryDirs: read('b4j.internalLibraryDirs', []) || [],
    b4jAdditionalLibraryDirs: read('b4j.additionalLibraryDirs', []) || [],
    b4aInternalLibraryDirs: read('b4a.internalLibraryDirs', []) || [],
    b4aAdditionalLibraryDirs: read('b4a.additionalLibraryDirs', []) || [],
    b4iInternalLibraryDirs: read('b4i.internalLibraryDirs', []) || [],
    b4iAdditionalLibraryDirs: read('b4i.additionalLibraryDirs', []) || [],
    generatorVersion: B4XPP_GENERATOR_VERSION,
    b4xppBundledLibraryDirs: getBundledB4XPPLibDirs()
  };
}


async function configureProjectSettingsCommand(context) {
  const folder = getWorkspaceFolder();
  if (!folder) {
    vscode.window.showErrorMessage('B4X++: open a VS Code project folder first.');
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'b4xppSettings',
    'B4X++ Project Settings',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    }
  );

  const state = getProjectSettingsState(folder);
  panel.webview.html = renderProjectSettingsWebview(panel.webview, context.extensionUri, state);

  panel.webview.onDidReceiveMessage(async (message) => {
    if (!message || typeof message !== 'object') return;
    try {
      if (message.type === 'ready') {
        b4xppOutputChannel && b4xppOutputChannel.appendLine('B4X++ Project Settings WebView ready.');
      } else if (message.type === 'browseDir') {
        const folders = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: true,
          openLabel: 'Add folder'
        });
        if (!folders || folders.length === 0) return;
        panel.webview.postMessage({
          type: 'dirPicked',
          key: message.key,
          values: folders.map(f => f.fsPath)
        });
      } else if (message.type === 'save') {
        const settingsInfo = await saveProjectSettings(folder, message.values || {});
        const directiveInfo = await saveMainBxProjectDirectives(folder, message.values || {});
        if (typeof clearB4XLibraryIndexCache === 'function') clearB4XLibraryIndexCache();
        b4xppV3IndexCache = null;
        b4xppV3IndexCacheKey = '';
        b4xppV315ExternalTypeCache = null;
        b4xppV315ExternalTypeCacheKey = '';
        const nextState = getProjectSettingsState(folder);
        vscode.window.showInformationMessage(`B4X++: settings saved to ${settingsInfo.settingsFile}`);
        panel.webview.postMessage({ type: 'saveResult', ok: true, settings: settingsInfo, directives: directiveInfo });
        panel.webview.postMessage({ type: 'state', state: nextState });
        if (message.refreshIndex !== false) await vscode.commands.executeCommand('b4xpp.refreshIntelliSense');
      } else if (message.type === 'reload') {
        panel.webview.postMessage({ type: 'state', state: getProjectSettingsState(folder) });
      } else if (message.type === 'loadLibraries') {
        const tempState = getProjectSettingsState(folder, message.values || {});
        tempState.directives = normalizeDirectiveValues(message.values && message.values.directives ? message.values.directives : tempState.directives);
        tempState.availableLibraries = listAvailableLibrariesForProject(folder, tempState, tempState.directives);
        panel.webview.postMessage({ type: 'libraries', libraries: tempState.availableLibraries });
      } else if (message.type === 'importIdeProjectHeader') {
        const picks = await vscode.window.showOpenDialog({
          canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
          filters: { 'B4X IDE project': ['b4j', 'b4a', 'b4i'] },
          openLabel: 'Import B4X project header'
        });
        if (!picks || !picks.length) return;
        const tempState = getProjectSettingsState(folder, message.values || {});
        tempState.directives = normalizeDirectiveValues(message.values && message.values.directives ? message.values.directives : tempState.directives);
        const text = fs.readFileSync(picks[0].fsPath, 'utf8');
        const header = parseB4XIdeProjectHeader(text, picks[0].fsPath);
        applyB4XIdeHeaderToDirectiveState(tempState.directives, header, picks[0].fsPath, tempState);
        tempState.availableLibraries = listAvailableLibrariesForProject(folder, tempState, tempState.directives);
        panel.webview.postMessage({ type: 'state', state: tempState });
      } else if (message.type === 'openSettingsJson') {
        await openWorkspaceSettingsJson(folder);
      }
    } catch (err) {
      const messageText = err && err.message ? err.message : String(err);
      try { panel.webview.postMessage({ type: 'saveResult', ok: false, error: messageText }); } catch {}
      vscode.window.showErrorMessage(`B4X++ settings: ${messageText}`);
    }
  });
}


function getProjectSettingsState(folder, overrideValues) {
  const cfg = vscode.workspace.getConfiguration('b4xpp', folder.uri);
  const rawSettings = readWorkspaceB4XPPSettings(folder);
  const keys = [
    'sourceDir', 'outputDir', 'projectDir', 'b4xlibDir', 'b4xpplibDir', 'packageName', 'platform',
    'b4j.builderPath', 'b4a.builderPath', 'b4i.builderPath', 'b4jBuildCommand', 'b4aBuildCommand', 'b4iBuildCommand', 'buildConfiguration', 'buildTask',
    'validation.strict', 'enableSemanticDiagnostics', 'addGeneratedHeader', 'overwriteGeneratedFiles', 'buildShowWarnings', 'buildUseBaseFolder',
    'b4j.internalLibraryDirs', 'b4j.additionalLibraryDirs',
    'b4a.internalLibraryDirs', 'b4a.additionalLibraryDirs',
    'b4i.internalLibraryDirs', 'b4i.additionalLibraryDirs'
  ];
  const values = {};
  for (const key of keys) values[key] = getB4XPPWorkspaceValue(cfg, rawSettings, key);
  if (overrideValues && typeof overrideValues === 'object') {
    const normalized = normalizeProjectSettingsValues(overrideValues);
    for (const [key, value] of Object.entries(normalized)) values[key] = value;
  }
  values.workspaceName = folder.name;
  values.workspacePath = folder.uri.fsPath;
  values.settingsJsonPath = path.join(folder.uri.fsPath, '.vscode', 'settings.json');
  values.directives = readMainBxProjectDirectives(folder, values);
  values.availableLibraries = listAvailableLibrariesForProject(folder, values, values.directives);
  return values;
}

function getB4XPPWorkspaceValue(cfg, rawSettings, key) {
  const fullKey = `b4xpp.${key}`;
  if (rawSettings && Object.prototype.hasOwnProperty.call(rawSettings, fullKey)) return rawSettings[fullKey];
  const value = cfg.get(key);
  if (Array.isArray(value)) return value.slice();
  return value;
}

function readWorkspaceB4XPPSettings(folder) {
  const settingsFile = path.join(folder.uri.fsPath, '.vscode', 'settings.json');
  if (!fs.existsSync(settingsFile)) return {};
  try {
    const raw = fs.readFileSync(settingsFile, 'utf8');
    const parsed = parseJsoncObject(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    b4xppOutputChannel && b4xppOutputChannel.appendLine(`B4X++ settings: could not parse ${settingsFile}: ${err.message}`);
    return {};
  }
}

function parseJsoncObject(text) {
  let out = '';
  let inString = false;
  let stringQuote = '';
  let escaped = false;
  for (let i = 0; i < String(text || '').length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === stringQuote) { inString = false; stringQuote = ''; }
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; stringQuote = ch; out += ch; continue; }
    if (ch === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (ch === '/' && next === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += ch;
  }
  out = out.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(out || '{}');
}

function findMainBxFileForSettings(folder, values) {
  const sourceDir = String((values && values.sourceDir) || 'src-b4xpp');
  const base = path.isAbsolute(sourceDir) ? sourceDir : path.join(folder.uri.fsPath, sourceDir);
  const files = [];
  collectBxFilesForSettings(base, files);
  if (files.length === 0) return null;
  let best = files.find(f => /demo\.bx$/i.test(f));
  if (best) return best;
  best = files.find(f => {
    try { return /^\s*#Project\b/im.test(fs.readFileSync(f, 'utf8')); } catch { return false; }
  });
  if (best) return best;
  best = files.find(f => {
    try { return /^\s*#MainModule\b/im.test(fs.readFileSync(f, 'utf8')); } catch { return false; }
  });
  return best || files[0];
}

function collectBxFilesForSettings(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectBxFilesForSettings(full, out);
    else if (/\.bx$/i.test(entry.name)) out.push(full);
  }
}

function readMainBxProjectDirectives(folder, values) {
  const file = findMainBxFileForSettings(folder, values);
  const directives = defaultProjectDirectiveState();
  if (!file) return directives;
  directives.mainBxPath = path.relative(folder.uri.fsPath, file).replace(/\\/g, '/');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return directives; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^#Project\s+(\S+)(?:\s+(.+))?$/i))) { directives.projectPlatform = m[1].trim(); directives.projectName = (m[2] || '').trim(); }
    else if ((m = line.match(/^#Package\s+(.+)$/i))) directives.packageName = m[1].trim();
    else if ((m = line.match(/^#ProjectDir\s+(.+)$/i))) directives.projectDir = unquoteDirectiveValue(m[1]);
    else if ((m = line.match(/^#MainModule\s+(.+)$/i))) directives.mainModule = m[1].trim();

    // Native IDE project libraries. These are emitted as Library1/Library2/... in .b4j/.b4a/.b4i.
    else if ((m = line.match(/^#ProjectDependsOn\s+(.+)$/i))) directives.projectDependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#ProjectB4JDependsOn\s+(.+)$/i))) directives.projectB4JDependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#ProjectB4ADependsOn\s+(.+)$/i))) directives.projectB4ADependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#ProjectB4iDependsOn\s+(.+)$/i))) directives.projectB4iDependsOn.push(...splitDirectiveList(m[1]));

    // B4XLib manifest metadata / dependencies. These are written to manifest.txt inside the .b4xlib.
    else if ((m = line.match(/^#B4XLib\s+(.+)$/i))) directives.b4xLib = unquoteDirectiveValue(m[1]);
    else if ((m = line.match(/^#B4XLibVersion\s+(.+)$/i))) directives.b4xLibVersion = m[1].trim();
    else if ((m = line.match(/^#B4XLibAuthor\s+(.+)$/i))) directives.b4xLibAuthor = unquoteDirectiveValue(m[1]);
    else if ((m = line.match(/^#B4XLibDir\s+(.+)$/i))) directives.b4xLibDir = unquoteDirectiveValue(m[1]);
    else if ((m = line.match(/^#B4XLibSupportedPlatforms\s+(.+)$/i))) directives.b4xLibSupportedPlatforms = splitDirectiveList(m[1]);
    else if ((m = line.match(/^#B4XLibDependsOn\s+(.+)$/i))) directives.b4xLibDependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#B4XLibB4JDependsOn\s+(.+)$/i))) directives.b4xLibB4JDependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#B4XLibB4ADependsOn\s+(.+)$/i))) directives.b4xLibB4ADependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#B4XLibB4iDependsOn\s+(.+)$/i))) directives.b4xLibB4iDependsOn.push(...splitDirectiveList(m[1]));

    // B4XPPLib source package metadata / dependencies. These source packages contain .bx files.
    else if ((m = line.match(/^#B4XPPLib\s+(.+)$/i))) directives.b4xppLib = unquoteDirectiveValue(m[1]);
    else if ((m = line.match(/^#B4XPPLibVersion\s+(.+)$/i))) directives.b4xppLibVersion = m[1].trim();
    else if ((m = line.match(/^#B4XPPLibAuthor\s+(.+)$/i))) directives.b4xppLibAuthor = unquoteDirectiveValue(m[1]);
    else if ((m = line.match(/^#B4XPPLibDir\s+(.+)$/i))) directives.b4xppLibDir = unquoteDirectiveValue(m[1]);
    else if ((m = line.match(/^#B4XPPLibSupportedPlatforms\s+(.+)$/i))) directives.b4xppLibSupportedPlatforms = splitDirectiveList(m[1]);
    else if ((m = line.match(/^#B4XPPLibDependsOn\s+(.+)$/i))) directives.b4xppLibDependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#B4XPPLibB4JDependsOn\s+(.+)$/i))) directives.b4xppLibB4JDependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#B4XPPLibB4ADependsOn\s+(.+)$/i))) directives.b4xppLibB4ADependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#B4XPPLibB4iDependsOn\s+(.+)$/i))) directives.b4xppLibB4iDependsOn.push(...splitDirectiveList(m[1]));

    // Legacy aliases. They are kept readable, but the UI rewrites them with explicit prefixes.
    else if ((m = line.match(/^#Version\s+(.+)$/i))) { directives.version = m[1].trim(); if (!directives.b4xLibVersion) directives.b4xLibVersion = directives.version; }
    else if ((m = line.match(/^#Author\s+(.+)$/i))) { directives.author = unquoteDirectiveValue(m[1]); if (!directives.b4xLibAuthor) directives.b4xLibAuthor = directives.author; }
    else if ((m = line.match(/^#SupportedPlatforms\s+(.+)$/i))) { directives.supportedPlatforms = splitDirectiveList(m[1]); if (!directives.b4xLibSupportedPlatforms.length) directives.b4xLibSupportedPlatforms = directives.supportedPlatforms.slice(); }
    else if ((m = line.match(/^#DependsOn\s+(.+)$/i))) { directives.dependsOn.push(...splitDirectiveList(m[1])); directives.projectDependsOn.push(...splitDirectiveList(m[1])); }
    else if ((m = line.match(/^#B4JDependsOn\s+(.+)$/i))) { directives.b4jDependsOn.push(...splitDirectiveList(m[1])); directives.projectB4JDependsOn.push(...splitDirectiveList(m[1])); }
    else if ((m = line.match(/^#B4ADependsOn\s+(.+)$/i))) { directives.b4aDependsOn.push(...splitDirectiveList(m[1])); directives.projectB4ADependsOn.push(...splitDirectiveList(m[1])); }
    else if ((m = line.match(/^#B4iDependsOn\s+(.+)$/i))) { directives.b4iDependsOn.push(...splitDirectiveList(m[1])); directives.projectB4iDependsOn.push(...splitDirectiveList(m[1])); }
  }
  for (const key of ['projectDependsOn','projectB4JDependsOn','projectB4ADependsOn','projectB4iDependsOn','b4xLibDependsOn','b4xLibB4JDependsOn','b4xLibB4ADependsOn','b4xLibB4iDependsOn','b4xppLibDependsOn','b4xppLibB4JDependsOn','b4xppLibB4ADependsOn','b4xppLibB4iDependsOn','dependsOn','b4jDependsOn','b4aDependsOn','b4iDependsOn']) directives[key] = uniqueStrings(directives[key]);
  directives.b4xLibSupportedPlatforms = uniqueStrings((directives.b4xLibSupportedPlatforms || []).map(normalizePlatformLabel).filter(Boolean));
  directives.b4xppLibSupportedPlatforms = uniqueStrings((directives.b4xppLibSupportedPlatforms || []).map(normalizePlatformLabel).filter(Boolean));
  directives.supportedPlatforms = uniqueStrings((directives.supportedPlatforms || []).map(normalizePlatformLabel).filter(Boolean));
  return directives;
}

function defaultProjectDirectiveState() {
  return {
    mainBxPath: '', projectPlatform: '', projectName: '', packageName: '', projectDir: '', mainModule: '',
    projectDependsOn: [], projectB4JDependsOn: [], projectB4ADependsOn: [], projectB4iDependsOn: [],
    b4xLib: '', b4xLibVersion: '', b4xLibAuthor: '', b4xLibDir: '', b4xLibSupportedPlatforms: [],
    b4xLibDependsOn: [], b4xLibB4JDependsOn: [], b4xLibB4ADependsOn: [], b4xLibB4iDependsOn: [],
    b4xppLib: '', b4xppLibVersion: '', b4xppLibAuthor: '', b4xppLibDir: '', b4xppLibSupportedPlatforms: [],
    b4xppLibDependsOn: [], b4xppLibB4JDependsOn: [], b4xppLibB4ADependsOn: [], b4xppLibB4iDependsOn: [],

    // Legacy aliases read from older .bx files. The settings UI writes the new prefixed names.
    version: '', author: '', supportedPlatforms: [],
    dependsOn: [], b4jDependsOn: [], b4aDependsOn: [], b4iDependsOn: []
  };
}

function unquoteDirectiveValue(value) {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

function splitDirectiveList(value) {
  return String(value || '').split(/[;,]/g).map(v => unquoteDirectiveValue(v).trim()).filter(Boolean);
}

function normalizePlatformLabel(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'b4j' || v === 'b4j-ui' || v === 'b4j-nonui') return 'B4J';
  if (v === 'b4a') return 'B4A';
  if (v === 'b4i') return 'B4i';
  return '';
}

function activePlatformsFromDirectiveState(values, directives) {
  const d = directives || {};
  const b4xlibSupported = (d.b4xLibSupportedPlatforms || d.supportedPlatforms || []).map(normalizePlatformLabel).filter(Boolean);
  const b4xpplibSupported = (d.b4xppLibSupportedPlatforms || []).map(normalizePlatformLabel).filter(Boolean);
  if (b4xlibSupported.length || b4xpplibSupported.length) return uniqueStrings([...b4xlibSupported, ...b4xpplibSupported]).map(v => v.toLowerCase());

  // Infer supported platforms from platform-specific IDE-project, B4XLib or B4XPPLib dependencies.
  const inferred = [];
  if ((d.projectB4JDependsOn || d.b4xLibB4JDependsOn || d.b4xppLibB4JDependsOn || d.b4jDependsOn || []).length) inferred.push('b4j');
  if ((d.projectB4ADependsOn || d.b4xLibB4ADependsOn || d.b4xppLibB4ADependsOn || d.b4aDependsOn || []).length) inferred.push('b4a');
  if ((d.projectB4iDependsOn || d.b4xLibB4iDependsOn || d.b4xppLibB4iDependsOn || d.b4iDependsOn || []).length) inferred.push('b4i');
  if (inferred.length) return uniqueStrings(inferred);

  const p = String(d.projectPlatform || (values && values.platform) || 'auto').toLowerCase();
  if (p.includes('b4j')) return ['b4j'];
  if (p.includes('b4a')) return ['b4a'];
  if (p.includes('b4i')) return ['b4i'];
  return ['b4j'];
}

function applyB4XIdeHeaderToDirectiveState(directives, header, filePath, state) {
  if (!directives || !header) return directives;
  const platform = String(header.platform || '').toLowerCase();
  if (platform === 'b4j') directives.projectPlatform = /^standardjava$/i.test(header.appType || '') ? 'B4J-NonUI' : 'B4J-UI';
  else if (platform === 'b4a') directives.projectPlatform = 'B4A';
  else if (platform === 'b4i') directives.projectPlatform = 'B4i';
  const baseName = sanitizeProjectName(path.basename(String(filePath || ''), path.extname(String(filePath || ''))));
  if (baseName && !directives.projectName) directives.projectName = baseName;
  if (header.packageName) directives.packageName = header.packageName;
  const libs = uniqueStrings(header.libraries || []);
  const b4xppNames = getB4XPPLibNameSetForPlatform(platform, state || getConfig());
  const nativeLibs = [];
  const sourcePackages = [];
  for (const lib of libs) {
    if (b4xppNames.has(String(lib || '').toLowerCase())) sourcePackages.push(lib);
    else nativeLibs.push(lib);
  }
  if (platform === 'b4j') {
    directives.projectB4JDependsOn = uniqueStrings([...(directives.projectB4JDependsOn || []), ...nativeLibs]);
    directives.b4xppLibB4JDependsOn = uniqueStrings([...(directives.b4xppLibB4JDependsOn || []), ...sourcePackages]);
  } else if (platform === 'b4a') {
    directives.projectB4ADependsOn = uniqueStrings([...(directives.projectB4ADependsOn || []), ...nativeLibs]);
    directives.b4xppLibB4ADependsOn = uniqueStrings([...(directives.b4xppLibB4ADependsOn || []), ...sourcePackages]);
  } else if (platform === 'b4i') {
    directives.projectB4iDependsOn = uniqueStrings([...(directives.projectB4iDependsOn || []), ...nativeLibs]);
    directives.b4xppLibB4iDependsOn = uniqueStrings([...(directives.b4xppLibB4iDependsOn || []), ...sourcePackages]);
  } else {
    directives.projectDependsOn = uniqueStrings([...(directives.projectDependsOn || []), ...nativeLibs]);
    directives.b4xppLibDependsOn = uniqueStrings([...(directives.b4xppLibDependsOn || []), ...sourcePackages]);
  }
  return directives;
}


function listAvailableLibrariesForProject(folder, values, directives) {
  const normalized = normalizeProjectSettingsValues(values || {});
  const bundledB4XPPLibDirs = getBundledB4XPPLibDirs();
  const dirsByPlatform = {
    b4j: [...(normalized['b4j.internalLibraryDirs'] || []), ...(normalized['b4j.additionalLibraryDirs'] || []), ...bundledB4XPPLibDirs],
    b4a: [...(normalized['b4a.internalLibraryDirs'] || []), ...(normalized['b4a.additionalLibraryDirs'] || []), ...bundledB4XPPLibDirs],
    b4i: [...(normalized['b4i.internalLibraryDirs'] || []), ...(normalized['b4i.additionalLibraryDirs'] || []), ...bundledB4XPPLibDirs]
  };
  const result = { b4j: [], b4a: [], b4i: [], active: [] };
  for (const platform of Object.keys(dirsByPlatform)) result[platform] = scanLibraryNamesInDirs(dirsByPlatform[platform]);
  const active = activePlatformsFromDirectiveState(values, directives);
  const activeMap = new Map();
  for (const platform of active) for (const item of result[platform] || []) activeMap.set(item.name.toLowerCase(), item);
  result.active = Array.from(activeMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

function scanLibraryNamesInDirs(dirs) {
  const found = new Map();
  for (const dir of normalizeDirectoryList(dirs)) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const file of entries) {
      const full = path.join(dir, file);
      if (!fs.existsSync(full)) continue;
      try {
        let name = '';
        let kind = '';
        if (/\.xml$/i.test(file)) {
          const lib = parseB4XLibraryXml(full);
          name = (lib && (lib.shortName || lib.name)) || path.basename(file, '.xml');
          kind = 'xml';
        } else if (/\.b4xlib$/i.test(file)) {
          const lib = parseB4XLibFile(full);
          name = (lib && lib.name) || path.basename(file, '.b4xlib');
          kind = 'b4xlib';
        } else if (/\.b4xpplib$/i.test(file)) {
          const lib = parseB4XPPLibFile(full);
          name = (lib && lib.name) || path.basename(file, '.b4xpplib');
          kind = 'b4xpplib';
        } else continue;
        if (!name) continue;
        found.set(name.toLowerCase(), { name, kind, path: full });
      } catch {}
    }
  }
  return Array.from(found.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function saveProjectSettings(folder, values) {
  const normalized = normalizeProjectSettingsValues(values || {});
  const settingsDir = path.join(folder.uri.fsPath, '.vscode');
  const settingsFile = path.join(settingsDir, 'settings.json');
  fs.mkdirSync(settingsDir, { recursive: true });

  let settings = {};
  if (fs.existsSync(settingsFile)) {
    try {
      settings = parseJsoncObject(fs.readFileSync(settingsFile, 'utf8'));
    } catch (err) {
      throw new Error(`Could not parse ${settingsFile}: ${err.message}`);
    }
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};

  for (const [key, value] of Object.entries(normalized)) {
    settings[`b4xpp.${key}`] = value;
  }

  const serialized = JSON.stringify(settings, null, 4) + '\n';

  // Direct disk write is the source of truth for workspace settings.
  fs.writeFileSync(settingsFile, serialized, 'utf8');

  // VS Code can run on file-backed workspaces where workspace.fs is more aware
  // of the current extension host.  Write through it as well, so the WebView save
  // works reliably in local, WSL and remote-like environments.
  try {
    const settingsUri = vscode.Uri.file(settingsFile);
    await vscode.workspace.fs.writeFile(settingsUri, Buffer.from(serialized, 'utf8'));
  } catch (err) {
    // The fs.writeFileSync above already succeeded for normal desktop workspaces.
    // Keep this as non-fatal but visible in the output channel.
    b4xppOutputChannel && b4xppOutputChannel.appendLine(`B4X++ settings workspace.fs write warning: ${err && err.message ? err.message : err}`);
  }

  // Verify immediately.  This catches path/scope mistakes instead of silently
  // refreshing the UI with defaults.
  let verifyText = '';
  try { verifyText = fs.readFileSync(settingsFile, 'utf8'); } catch (err) { throw new Error(`Could not verify ${settingsFile}: ${err.message}`); }
  const verified = parseJsoncObject(verifyText);
  for (const key of Object.keys(normalized)) {
    const fullKey = `b4xpp.${key}`;
    if (!Object.prototype.hasOwnProperty.call(verified, fullKey)) {
      throw new Error(`Save verification failed: ${fullKey} was not written to ${settingsFile}`);
    }
  }

  const keyCount = Object.keys(normalized).length;
  b4xppOutputChannel && b4xppOutputChannel.appendLine(`B4X++ settings saved to ${settingsFile} (${keyCount} key(s)).`);
  return { settingsFile, keyCount, bytes: Buffer.byteLength(serialized, 'utf8') };
}

async function saveMainBxProjectDirectives(folder, values) {
  if (!values || !values.directives || typeof values.directives !== 'object') return { file: '', saved: false };
  const directives = normalizeDirectiveValues(values.directives);
  let relPath = String(directives.mainBxPath || '').trim();
  let file = relPath ? path.join(folder.uri.fsPath, relPath) : findMainBxFileForSettings(folder, values);
  if (!file || !fs.existsSync(file)) return { file: file || '', saved: false };
  let text = fs.readFileSync(file, 'utf8');
  text = updateProjectDirectiveText(text, directives);
  fs.writeFileSync(file, text, 'utf8');
  b4xppOutputChannel && b4xppOutputChannel.appendLine(`B4X++ directives saved to ${file}.`);
  return { file, saved: true };
}

function normalizeDirectiveValues(input) {
  const d = defaultProjectDirectiveState();
  const src = input || {};
  for (const key of ['mainBxPath','projectPlatform','projectName','packageName','projectDir','mainModule','b4xLib','b4xLibVersion','b4xLibAuthor','b4xLibDir','b4xppLib','b4xppLibVersion','b4xppLibAuthor','b4xppLibDir']) {
    d[key] = String(src[key] == null ? '' : src[key]).trim();
  }
  // Backward-compatible UI fields.
  d.version = String(src.version == null ? '' : src.version).trim();
  d.author = String(src.author == null ? '' : src.author).trim();
  if (!d.b4xLibVersion && d.version) d.b4xLibVersion = d.version;
  if (!d.b4xLibAuthor && d.author) d.b4xLibAuthor = d.author;

  d.projectDependsOn = uniqueStrings(arrayOrDirectiveList(src.projectDependsOn || src.dependsOn));
  d.projectB4JDependsOn = uniqueStrings(arrayOrDirectiveList(src.projectB4JDependsOn || src.b4jDependsOn));
  d.projectB4ADependsOn = uniqueStrings(arrayOrDirectiveList(src.projectB4ADependsOn || src.b4aDependsOn));
  d.projectB4iDependsOn = uniqueStrings(arrayOrDirectiveList(src.projectB4iDependsOn || src.b4iDependsOn));

  d.b4xLibSupportedPlatforms = uniqueStrings(arrayOrDirectiveList(src.b4xLibSupportedPlatforms || src.supportedPlatforms).map(normalizePlatformLabel).filter(Boolean));
  d.b4xLibDependsOn = uniqueStrings(arrayOrDirectiveList(src.b4xLibDependsOn));
  d.b4xLibB4JDependsOn = uniqueStrings(arrayOrDirectiveList(src.b4xLibB4JDependsOn));
  d.b4xLibB4ADependsOn = uniqueStrings(arrayOrDirectiveList(src.b4xLibB4ADependsOn));
  d.b4xLibB4iDependsOn = uniqueStrings(arrayOrDirectiveList(src.b4xLibB4iDependsOn));

  d.b4xppLibSupportedPlatforms = uniqueStrings(arrayOrDirectiveList(src.b4xppLibSupportedPlatforms).map(normalizePlatformLabel).filter(Boolean));
  d.b4xppLibDependsOn = uniqueStrings(arrayOrDirectiveList(src.b4xppLibDependsOn));
  d.b4xppLibB4JDependsOn = uniqueStrings(arrayOrDirectiveList(src.b4xppLibB4JDependsOn));
  d.b4xppLibB4ADependsOn = uniqueStrings(arrayOrDirectiveList(src.b4xppLibB4ADependsOn));
  d.b4xppLibB4iDependsOn = uniqueStrings(arrayOrDirectiveList(src.b4xppLibB4iDependsOn));

  // Legacy aliases kept in the state for old files, but not written back by the current explicit directive model.
  d.supportedPlatforms = uniqueStrings(arrayOrDirectiveList(src.supportedPlatforms).map(normalizePlatformLabel).filter(Boolean));
  d.dependsOn = uniqueStrings(arrayOrDirectiveList(src.dependsOn));
  d.b4jDependsOn = uniqueStrings(arrayOrDirectiveList(src.b4jDependsOn));
  d.b4aDependsOn = uniqueStrings(arrayOrDirectiveList(src.b4aDependsOn));
  d.b4iDependsOn = uniqueStrings(arrayOrDirectiveList(src.b4iDependsOn));
  return d;
}

function arrayOrDirectiveList(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  return splitDirectiveList(value);
}

function updateProjectDirectiveText(text, directives) {
  const managed = [
    'Project','Package','ProjectDir','MainModule',
    'ProjectDependsOn','ProjectB4JDependsOn','ProjectB4ADependsOn','ProjectB4iDependsOn',
    'B4XLib','B4XLibVersion','B4XLibAuthor','B4XLibDir','B4XLibSupportedPlatforms',
    'B4XLibDependsOn','B4XLibB4JDependsOn','B4XLibB4ADependsOn','B4XLibB4iDependsOn',
    'B4XPPLib','B4XPPLibVersion','B4XPPLibAuthor','B4XPPLibDir','B4XPPLibSupportedPlatforms',
    'B4XPPLibDependsOn','B4XPPLibB4JDependsOn','B4XPPLibB4ADependsOn','B4XPPLibB4iDependsOn',
    // legacy names removed/replaced when saving
    'Version','Author','SupportedPlatforms','DependsOn','B4JDependsOn','B4ADependsOn','B4iDependsOn'
  ];
  const managedRegex = new RegExp('^\\s*#(?:' + managed.join('|') + ')\\b', 'i');
  const originalLines = String(text || '').split(/\r?\n/);
  const hadTrailingNewline = /\r?\n$/.test(String(text || ''));
  const bodyLines = originalLines.filter(line => !managedRegex.test(line));
  while (bodyLines.length && bodyLines[0].trim() === '') bodyLines.shift();
  const header = buildProjectDirectiveLines(directives);
  const next = [...header, '', ...bodyLines].join('\n');
  return hadTrailingNewline ? next.replace(/\n*$/, '\n') : next;
}

function buildProjectDirectiveLines(d) {
  const lines = [];
  const projectPlatform = d.projectPlatform || '';
  const projectName = d.projectName || '';
  if (projectPlatform || projectName) lines.push(`#Project ${[projectPlatform || 'B4J-UI', projectName].filter(Boolean).join(' ')}`);
  if (d.packageName) lines.push(`#Package ${d.packageName}`);
  if (d.projectDir) lines.push(`#ProjectDir ${d.projectDir}`);
  if (d.mainModule) lines.push(`#MainModule ${d.mainModule}`);
  if (d.projectDependsOn && d.projectDependsOn.length) lines.push(`#ProjectDependsOn ${d.projectDependsOn.join(', ')}`);
  if (d.projectB4JDependsOn && d.projectB4JDependsOn.length) lines.push(`#ProjectB4JDependsOn ${d.projectB4JDependsOn.join(', ')}`);
  if (d.projectB4ADependsOn && d.projectB4ADependsOn.length) lines.push(`#ProjectB4ADependsOn ${d.projectB4ADependsOn.join(', ')}`);
  if (d.projectB4iDependsOn && d.projectB4iDependsOn.length) lines.push(`#ProjectB4iDependsOn ${d.projectB4iDependsOn.join(', ')}`);
  if (d.b4xLib || d.b4xLibVersion || d.b4xLibAuthor || d.b4xLibDir || (d.b4xLibSupportedPlatforms || []).length) {
    lines.push('');
  }
  if (d.b4xLib) lines.push(`#B4XLib ${d.b4xLib}`);
  if (d.b4xLibVersion) lines.push(`#B4XLibVersion ${d.b4xLibVersion}`);
  if (d.b4xLibAuthor) lines.push(`#B4XLibAuthor ${d.b4xLibAuthor}`);
  if (d.b4xLibDir) lines.push(`#B4XLibDir ${d.b4xLibDir}`);
  if (d.b4xLibSupportedPlatforms && d.b4xLibSupportedPlatforms.length) lines.push(`#B4XLibSupportedPlatforms ${d.b4xLibSupportedPlatforms.join(', ')}`);
  if (d.b4xLibDependsOn && d.b4xLibDependsOn.length) lines.push(`#B4XLibDependsOn ${d.b4xLibDependsOn.join(', ')}`);
  if (d.b4xLibB4JDependsOn && d.b4xLibB4JDependsOn.length) lines.push(`#B4XLibB4JDependsOn ${d.b4xLibB4JDependsOn.join(', ')}`);
  if (d.b4xLibB4ADependsOn && d.b4xLibB4ADependsOn.length) lines.push(`#B4XLibB4ADependsOn ${d.b4xLibB4ADependsOn.join(', ')}`);
  if (d.b4xLibB4iDependsOn && d.b4xLibB4iDependsOn.length) lines.push(`#B4XLibB4iDependsOn ${d.b4xLibB4iDependsOn.join(', ')}`);
  if (d.b4xppLib || d.b4xppLibVersion || d.b4xppLibAuthor || d.b4xppLibDir || (d.b4xppLibSupportedPlatforms || []).length || (d.b4xppLibDependsOn || []).length || (d.b4xppLibB4JDependsOn || []).length || (d.b4xppLibB4ADependsOn || []).length || (d.b4xppLibB4iDependsOn || []).length) lines.push('');
  if (d.b4xppLib) lines.push(`#B4XPPLib ${d.b4xppLib}`);
  if (d.b4xppLibVersion) lines.push(`#B4XPPLibVersion ${d.b4xppLibVersion}`);
  if (d.b4xppLibAuthor) lines.push(`#B4XPPLibAuthor ${d.b4xppLibAuthor}`);
  if (d.b4xppLibDir) lines.push(`#B4XPPLibDir ${d.b4xppLibDir}`);
  if (d.b4xppLibSupportedPlatforms && d.b4xppLibSupportedPlatforms.length) lines.push(`#B4XPPLibSupportedPlatforms ${d.b4xppLibSupportedPlatforms.join(', ')}`);
  if (d.b4xppLibDependsOn && d.b4xppLibDependsOn.length) lines.push(`#B4XPPLibDependsOn ${d.b4xppLibDependsOn.join(', ')}`);
  if (d.b4xppLibB4JDependsOn && d.b4xppLibB4JDependsOn.length) lines.push(`#B4XPPLibB4JDependsOn ${d.b4xppLibB4JDependsOn.join(', ')}`);
  if (d.b4xppLibB4ADependsOn && d.b4xppLibB4ADependsOn.length) lines.push(`#B4XPPLibB4ADependsOn ${d.b4xppLibB4ADependsOn.join(', ')}`);
  if (d.b4xppLibB4iDependsOn && d.b4xppLibB4iDependsOn.length) lines.push(`#B4XPPLibB4iDependsOn ${d.b4xppLibB4iDependsOn.join(', ')}`);
  return lines;
}

function normalizeProjectSettingsValues(values) {
  const out = {};
  const stringKeys = ['sourceDir', 'outputDir', 'projectDir', 'b4xlibDir', 'b4xpplibDir', 'packageName', 'platform', 'b4j.builderPath', 'b4a.builderPath', 'b4i.builderPath', 'b4jBuildCommand', 'b4aBuildCommand', 'b4iBuildCommand', 'buildConfiguration', 'buildTask'];
  const boolKeys = ['validation.strict', 'enableSemanticDiagnostics', 'addGeneratedHeader', 'overwriteGeneratedFiles', 'buildShowWarnings', 'buildUseBaseFolder'];
  const arrayKeys = [
    'b4j.internalLibraryDirs', 'b4j.additionalLibraryDirs',
    'b4a.internalLibraryDirs', 'b4a.additionalLibraryDirs',
    'b4i.internalLibraryDirs', 'b4i.additionalLibraryDirs'
  ];
  for (const key of stringKeys) if (Object.prototype.hasOwnProperty.call(values, key)) out[key] = String(values[key] == null ? '' : values[key]).trim();
  if (!['auto', 'b4j', 'b4a', 'b4i'].includes(out.platform)) out.platform = 'auto';
  for (const key of boolKeys) if (Object.prototype.hasOwnProperty.call(values, key)) out[key] = values[key] === true || values[key] === 'true';
  for (const key of arrayKeys) if (Object.prototype.hasOwnProperty.call(values, key)) out[key] = normalizeDirectoryList(values[key]);
  return out;
}

function normalizeDirectoryList(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(/\r?\n|;/g);
  const seen = new Set();
  const out = [];
  for (let item of items) {
    item = String(item || '').trim().replace(/^['"]|['"]$/g, '');
    if (!item) continue;
    const key = process.platform === 'win32' ? item.toLowerCase() : item;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function openWorkspaceSettingsJson(folder) {
  const settingsDir = path.join(folder.uri.fsPath, '.vscode');
  const settingsFile = path.join(settingsDir, 'settings.json');
  fs.mkdirSync(settingsDir, { recursive: true });
  if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, '{\n}\n', 'utf8');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(settingsFile));
  await vscode.window.showTextDocument(doc);
}

function renderProjectSettingsWebview(webview, extensionUri, state) {
  const nonce = makeNonce();
  const safeState = state || {};
  const safeDirectives = safeState.directives || {};
  const json = JSON.stringify(safeState).replace(/</g, '\\u003c');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'project-settings.js'));
  const valueAttr = (key) => escapeHtml(safeState[key] == null ? '' : safeState[key]);
  const dirValueAttr = (key) => escapeHtml(safeDirectives[key] == null ? '' : safeDirectives[key]);
  const checkedAttr = (key) => safeState[key] === true ? ' checked' : '';
  const selectAttr = (key, value) => String(safeState[key] == null ? '' : safeState[key]).toLowerCase() === String(value).toLowerCase() ? ' selected' : '';
  const dirSelectAttr = (key, value) => String(safeDirectives[key] == null ? '' : safeDirectives[key]).toLowerCase() === String(value).toLowerCase() ? ' selected' : '';
  const arrayTextarea = (key) => escapeHtml((Array.isArray(safeState[key]) ? safeState[key] : []).join('\n'));
  const dirArrayTextarea = (key) => escapeHtml((Array.isArray(safeDirectives[key]) ? safeDirectives[key] : []).join('\n'));
  const platformChecked = (platform) => (safeDirectives.b4xLibSupportedPlatforms || safeDirectives.supportedPlatforms || []).map(v => String(v).toLowerCase()).includes(String(platform).toLowerCase()) ? ' checked' : '';
  return String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource};">
<title>B4X++ Project Settings</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; }
  header { padding: 18px 22px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
  h1 { margin: 0 0 6px; font-size: 20px; }
  .hint { color: var(--vscode-descriptionForeground); line-height: 1.45; }
  main { padding: 18px 22px 28px; max-width: 1050px; }
  section { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 14px; margin-bottom: 14px; background: var(--vscode-editorWidget-background); }
  h2 { margin: 0 0 12px; font-size: 15px; }
  label { display: block; font-weight: 600; margin: 11px 0 5px; }
  input[type="text"], select, textarea { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 7px 8px; font-family: var(--vscode-font-family); }
  textarea { min-height: 76px; resize: vertical; font-family: var(--vscode-editor-font-family); }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .checks { display: grid; gap: 8px; margin-top: 8px; }
  .check { display: flex; gap: 8px; align-items: center; font-weight: 400; }
  .libs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .libbox { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px; }
  .libbox h3 { margin: 0 0 8px; font-size: 13px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row > * { flex: 1; }
  button { border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .actions { position: sticky; bottom: 0; display: flex; gap: 8px; justify-content: flex-end; padding: 12px 22px; border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
  code { font-family: var(--vscode-editor-font-family); color: var(--vscode-textPreformat-foreground); }
  .small { font-size: 12px; color: var(--vscode-descriptionForeground); }
  .pillgrid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
  .pill { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--vscode-panel-border); border-radius: 999px; padding: 5px 9px; font-weight: 400; }
  .liblist { max-height: 230px; overflow: auto; border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px; background: var(--vscode-editor-background); }
  .librow { display: flex; gap: 7px; align-items: center; padding: 3px 0; font-weight: 400; }
  .librow code { font-size: 11px; opacity: .75; }
  @media (max-width: 850px) { .grid, .libs { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>B4X++ Project Settings <span class="small">0.4.3 native build</span></h1>
  <div class="hint">Workspace: <code id="workspacePath"></code><br>These values are saved to <code>.vscode/settings.json</code> for the current project only.<br>Settings file: <code id="settingsJsonPath"></code></div>
</header>
<main>
  <section>
    <h2>Project</h2>
    <div class="grid">
      <div><label>Source folder</label><input id="sourceDir" data-key="sourceDir" type="text" value="${valueAttr('sourceDir')}"></div>
      <div><label>Generated .bas folder</label><input id="outputDir" data-key="outputDir" type="text" value="${valueAttr('outputDir')}"></div>
      <div><label>B4X IDE projects folder</label><input id="projectDir" data-key="projectDir" type="text" value="${valueAttr('projectDir')}"></div>
      <div><label>B4XLib output folder</label><input id="b4xlibDir" data-key="b4xlibDir" type="text" value="${valueAttr('b4xlibDir')}"></div>
      <div><label>B4XPPLib output folder</label><input id="b4xpplibDir" data-key="b4xpplibDir" type="text" value="${valueAttr('b4xpplibDir')}"></div>
      <div><label>Default package name</label><input id="packageName" data-key="packageName" type="text" value="${valueAttr('packageName')}"></div>
      <div><label>Fallback platform</label><select id="platform" data-key="platform"><option value="auto"${selectAttr('platform', 'auto')}>auto</option><option value="b4j"${selectAttr('platform', 'b4j')}>B4J</option><option value="b4a"${selectAttr('platform', 'b4a')}>B4A</option><option value="b4i"${selectAttr('platform', 'b4i')}>B4i</option></select><div class="small">Used only when no #Project or platform-specific #...DependsOn directive can resolve the platform.</div></div>
    </div>
    <div class="checks">
      <label class="check"><input id="validationStrict" data-key="validation.strict" type="checkbox"${checkedAttr('validation.strict')}> Strict validation before generation/build</label>
      <label class="check"><input id="semanticDiagnostics" data-key="enableSemanticDiagnostics" type="checkbox"${checkedAttr('enableSemanticDiagnostics')}> Enable semantic diagnostics in VS Code</label>
      <label class="check"><input id="addGeneratedHeader" data-key="addGeneratedHeader" type="checkbox"${checkedAttr('addGeneratedHeader')}> Add generated header</label>
      <label class="check"><input id="overwriteGeneratedFiles" data-key="overwriteGeneratedFiles" type="checkbox"${checkedAttr('overwriteGeneratedFiles')}> Overwrite generated files</label>
    </div>
  </section>
  <section>
    <h2>Native B4X build</h2>
    <p class="hint">B4X++ can sync the generated project, run B4JBuilder / B4ABuilder or a custom command, then remap compiler errors back to the original <code>.bx</code> lines.</p>
    <div class="grid">
      <div><label>B4JBuilder.exe path</label><input id="b4j_builderPath" data-key="b4j.builderPath" type="text" value="${valueAttr('b4j.builderPath')}" placeholder="C:\Program Files\Anywhere Software\B4J\B4JBuilder.exe"></div>
      <div><label>B4ABuilder.exe path</label><input id="b4a_builderPath" data-key="b4a.builderPath" type="text" value="${valueAttr('b4a.builderPath')}" placeholder="C:\Program Files\Anywhere Software\B4A\B4ABuilder.exe"></div>
      <div><label>B4i builder path / custom tool</label><input id="b4i_builderPath" data-key="b4i.builderPath" type="text" value="${valueAttr('b4i.builderPath')}" placeholder="optional; usually use custom command below"></div>
      <div><label>Build configuration</label><input id="buildConfiguration" data-key="buildConfiguration" type="text" value="${valueAttr('buildConfiguration')}" placeholder="Default"></div>
      <div><label>Build task</label><input id="buildTask" data-key="buildTask" type="text" value="${valueAttr('buildTask')}" placeholder="Build"></div>
    </div>
    <div class="checks">
      <label class="check"><input id="buildShowWarnings" data-key="buildShowWarnings" type="checkbox"${checkedAttr('buildShowWarnings')}> Pass <code>-ShowWarnings=True</code></label>
      <label class="check"><input id="buildUseBaseFolder" data-key="buildUseBaseFolder" type="checkbox"${checkedAttr('buildUseBaseFolder')}> Pass <code>-BaseFolder=&lt;project folder&gt;</code></label>
    </div>
    <div class="grid">
      <div><label>Custom B4J command</label><input id="b4jBuildCommand" data-key="b4jBuildCommand" type="text" value="${valueAttr('b4jBuildCommand')}" placeholder="optional; leave empty to use B4JBuilder.exe"></div>
      <div><label>Custom B4A command</label><input id="b4aBuildCommand" data-key="b4aBuildCommand" type="text" value="${valueAttr('b4aBuildCommand')}" placeholder="optional; leave empty to use B4ABuilder.exe"></div>
      <div><label>Custom B4i command</label><input id="b4iBuildCommand" data-key="b4iBuildCommand" type="text" value="${valueAttr('b4iBuildCommand')}" placeholder="custom B4i/Mac builder workflow command"></div>
    </div>
    <p class="small">Custom command placeholders: <code>{project}</code>, <code>{workspace}</code>, <code>{projectDir}</code>, <code>{configuration}</code>, <code>{task}</code>.</p>
  </section>
  <section>
    <h2>Main .bx directives</h2>
    <p class="hint">Project directives generate the native <code>.b4j</code>, <code>.b4a</code> or <code>.b4i</code> header (<code>Library1=...</code>, <code>Module1=...</code>, <code>Version=...</code>). B4XLib directives are separate and are written to the <code>manifest.txt</code> inside the generated <code>.b4xlib</code>.</p>
    <div class="grid">
      <div><label>Main .bx file</label><input id="dir_mainBxPath" data-dir-key="mainBxPath" type="text" readonly value="${dirValueAttr('mainBxPath')}"><div class="small">Detected from the source folder. Open another .bx file before opening this UI if needed.</div></div>
      <div><label>#Project platform</label><select id="dir_projectPlatform" data-dir-key="projectPlatform"><option value=""${dirSelectAttr('projectPlatform', '')}>keep / none</option><option value="B4J-UI"${dirSelectAttr('projectPlatform', 'B4J-UI')}>B4J-UI</option><option value="B4J-NonUI"${dirSelectAttr('projectPlatform', 'B4J-NonUI')}>B4J-NonUI</option><option value="B4A"${dirSelectAttr('projectPlatform', 'B4A')}>B4A</option><option value="B4i"${dirSelectAttr('projectPlatform', 'B4i')}>B4i</option></select></div>
      <div><label>#Project name</label><input id="dir_projectName" data-dir-key="projectName" type="text" value="${dirValueAttr('projectName')}"></div>
      <div><label>#Package</label><input id="dir_packageName" data-dir-key="packageName" type="text" value="${dirValueAttr('packageName')}"></div>
      <div><label>#ProjectDir</label><input id="dir_projectDir" data-dir-key="projectDir" type="text" value="${dirValueAttr('projectDir')}"></div>
      <div><label>#MainModule</label><input id="dir_mainModule" data-dir-key="mainModule" type="text" value="${dirValueAttr('mainModule')}"></div>
    </div>
    <h2 style="margin-top:18px">Native B4X IDE project libraries</h2>
    <p class="small">These libraries are written to generated project headers as <code>Library1=...</code>, <code>Library2=...</code>. They are not B4XLib manifest metadata.</p>
    <div class="row" style="margin:8px 0 4px"><button type="button" class="secondary" id="importIdeHeader">Import libraries from existing .b4j/.b4a/.b4i...</button></div>
    <div class="grid">
      <div><label>#ProjectDependsOn</label><textarea id="dir_projectDependsOn" data-dir-array="projectDependsOn" spellcheck="false">${dirArrayTextarea('projectDependsOn')}</textarea></div>
      <div><label>#ProjectB4JDependsOn</label><textarea id="dir_projectB4JDependsOn" data-dir-array="projectB4JDependsOn" spellcheck="false">${dirArrayTextarea('projectB4JDependsOn')}</textarea></div>
      <div><label>#ProjectB4ADependsOn</label><textarea id="dir_projectB4ADependsOn" data-dir-array="projectB4ADependsOn" spellcheck="false">${dirArrayTextarea('projectB4ADependsOn')}</textarea></div>
      <div><label>#ProjectB4iDependsOn</label><textarea id="dir_projectB4iDependsOn" data-dir-array="projectB4iDependsOn" spellcheck="false">${dirArrayTextarea('projectB4iDependsOn')}</textarea></div>
    </div>
    <h2 style="margin-top:18px">B4XLib manifest metadata</h2>
    <div class="grid">
      <div><label>#B4XLib</label><input id="dir_b4xLib" data-dir-key="b4xLib" type="text" value="${dirValueAttr('b4xLib')}"></div>
      <div><label>#B4XLibDir</label><input id="dir_b4xLibDir" data-dir-key="b4xLibDir" type="text" value="${dirValueAttr('b4xLibDir')}"></div>
      <div><label>#B4XLibVersion</label><input id="dir_b4xLibVersion" data-dir-key="b4xLibVersion" type="text" value="${dirValueAttr('b4xLibVersion')}"></div>
      <div><label>#B4XLibAuthor</label><input id="dir_b4xLibAuthor" data-dir-key="b4xLibAuthor" type="text" value="${dirValueAttr('b4xLibAuthor')}"></div>
    </div>
    <label>#B4XLibSupportedPlatforms <span class="small">optional B4X++ metadata; when omitted, platforms are inferred from <code>#B4XLibB4JDependsOn</code> / <code>#B4XLibB4ADependsOn</code> / <code>#B4XLibB4iDependsOn</code>.</span></label>
    <div class="pillgrid">
      <label class="pill"><input type="checkbox" data-platform-choice="B4J"${platformChecked('B4J')}> B4J</label>
      <label class="pill"><input type="checkbox" data-platform-choice="B4A"${platformChecked('B4A')}> B4A</label>
      <label class="pill"><input type="checkbox" data-platform-choice="B4i"${platformChecked('B4i')}> B4i</label>
    </div>
    <div class="grid">
      <div><label>#B4XLibDependsOn</label><textarea id="dir_b4xLibDependsOn" data-dir-array="b4xLibDependsOn" spellcheck="false">${dirArrayTextarea('b4xLibDependsOn')}</textarea></div>
      <div><label>#B4XLibB4JDependsOn</label><textarea id="dir_b4xLibB4JDependsOn" data-dir-array="b4xLibB4JDependsOn" spellcheck="false">${dirArrayTextarea('b4xLibB4JDependsOn')}</textarea></div>
      <div><label>#B4XLibB4ADependsOn</label><textarea id="dir_b4xLibB4ADependsOn" data-dir-array="b4xLibB4ADependsOn" spellcheck="false">${dirArrayTextarea('b4xLibB4ADependsOn')}</textarea></div>
      <div><label>#B4XLibB4iDependsOn</label><textarea id="dir_b4xLibB4iDependsOn" data-dir-array="b4xLibB4iDependsOn" spellcheck="false">${dirArrayTextarea('b4xLibB4iDependsOn')}</textarea></div>
    </div>
    <h2 style="margin-top:18px">B4XPPLib source packages</h2>
    <p class="small">B4XPPLib dependencies are zipped <code>.bx</code> sources. They are compiled into the generated <code>.bas</code> output of the consuming project.</p>
    <div class="grid">
      <div><label>#B4XPPLib</label><input id="dir_b4xppLib" data-dir-key="b4xppLib" type="text" value="${dirValueAttr('b4xppLib')}"></div>
      <div><label>#B4XPPLibDir</label><input id="dir_b4xppLibDir" data-dir-key="b4xppLibDir" type="text" value="${dirValueAttr('b4xppLibDir')}"></div>
      <div><label>#B4XPPLibVersion</label><input id="dir_b4xppLibVersion" data-dir-key="b4xppLibVersion" type="text" value="${dirValueAttr('b4xppLibVersion')}"></div>
      <div><label>#B4XPPLibAuthor</label><input id="dir_b4xppLibAuthor" data-dir-key="b4xppLibAuthor" type="text" value="${dirValueAttr('b4xppLibAuthor')}"></div>
      <div><label>#B4XPPLibSupportedPlatforms</label><textarea id="dir_b4xppLibSupportedPlatforms" data-dir-array="b4xppLibSupportedPlatforms" spellcheck="false">${dirArrayTextarea('b4xppLibSupportedPlatforms')}</textarea></div>
      <div><label>#B4XPPLibDependsOn</label><textarea id="dir_b4xppLibDependsOn" data-dir-array="b4xppLibDependsOn" spellcheck="false">${dirArrayTextarea('b4xppLibDependsOn')}</textarea></div>
      <div><label>#B4XPPLibB4JDependsOn</label><textarea id="dir_b4xppLibB4JDependsOn" data-dir-array="b4xppLibB4JDependsOn" spellcheck="false">${dirArrayTextarea('b4xppLibB4JDependsOn')}</textarea></div>
      <div><label>#B4XPPLibB4ADependsOn</label><textarea id="dir_b4xppLibB4ADependsOn" data-dir-array="b4xppLibB4ADependsOn" spellcheck="false">${dirArrayTextarea('b4xppLibB4ADependsOn')}</textarea></div>
      <div><label>#B4XPPLibB4iDependsOn</label><textarea id="dir_b4xppLibB4iDependsOn" data-dir-array="b4xppLibB4iDependsOn" spellcheck="false">${dirArrayTextarea('b4xppLibB4iDependsOn')}</textarea></div>
    </div>
    <div class="row" style="margin-top:10px"><button type="button" class="secondary" id="reloadLibraries">Reload libraries from configured folders</button></div>
    <label>Available libraries for the active platform(s)</label>
    <div id="availableLibraries" class="liblist"><span class="small">No library index loaded yet.</span></div>
    <div class="small">Checking a .xml/.b4xlib library adds it to the native IDE project library directive (<code>#ProjectB4JDependsOn</code>, <code>#ProjectB4ADependsOn</code>, or <code>#ProjectB4iDependsOn</code>). B4XLib and B4XPPLib dependencies stay in their dedicated text boxes.</div>
  </section>
  <section>
    <h2>Library directories</h2>
    <p class="hint">Use the real B4X model: each platform has internal and additional library folders. <code>.jar + .xml</code>, <code>.b4xlib</code> and <code>.b4xpplib</code> are read from these same folders. For B4XLib projects, B4X++ loads the platforms declared by <code>#B4XLibSupportedPlatforms</code> or inferred from platform-specific B4XLib dependency directives.</p>
    <div class="libs">
      ${renderPlatformLibraryBox('b4j', 'B4J', safeState)}
      ${renderPlatformLibraryBox('b4a', 'B4A', safeState)}
      ${renderPlatformLibraryBox('b4i', 'B4i', safeState)}
    </div>
  </section>
</main>
<div id="saveStatus" class="hint" style="padding:0 22px 8px;text-align:right"></div>
<div class="actions">
  <button type="button" class="secondary" id="reload">Reload</button>
  <button type="button" class="secondary" id="openJson">Open settings.json</button>
  <button type="button" id="save">Save and refresh index</button>
</div>
<textarea id="b4xpp-state-json" hidden>${escapeHtml(json)}</textarea>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function renderPlatformLibraryBox(platform, label, state) {
  const internalKey = `${platform}.internalLibraryDirs`;
  const additionalKey = `${platform}.additionalLibraryDirs`;
  const internalId = internalKey.replace(/\./g, '_');
  const additionalId = additionalKey.replace(/\./g, '_');
  return `<div class="libbox">
    <h3>${escapeHtml(label)}</h3>
    <label>Internal library folders</label>
    <textarea id="${internalId}" data-key="${internalKey}" spellcheck="false">${escapeHtml((Array.isArray(state && state[internalKey]) ? state[internalKey] : []).join('\n'))}</textarea>
    <div class="row"><button type="button" class="secondary" data-browse="${internalKey}">Add internal folder…</button></div>
    <label>Additional library folders</label>
    <textarea id="${additionalId}" data-key="${additionalKey}" spellcheck="false">${escapeHtml((Array.isArray(state && state[additionalKey]) ? state[additionalKey] : []).join('\n'))}</textarea>
    <div class="row"><button type="button" class="secondary" data-browse="${additionalKey}">Add additional folder…</button></div>
  </div>`;
}

function makeNonce() {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    workspaceRoot: root,
    fileTextOverrides: collectOpenB4XPPTextOverrides(sourceRoot)
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

function collectOpenB4XPPTextOverrides(sourceRoot) {
  const overrides = new Map();
  const docs = (vscode.workspace && Array.isArray(vscode.workspace.textDocuments)) ? vscode.workspace.textDocuments : [];
  for (const doc of docs) {
    try {
      if (!doc || doc.languageId !== 'b4xpp' || !doc.uri || !doc.uri.fsPath) continue;
      if (!isPathInside(doc.uri.fsPath, sourceRoot)) continue;
      overrides.set(path.resolve(doc.uri.fsPath), doc.getText());
    } catch {}
  }
  const active = vscode.window && vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
  try {
    if (active && active.languageId === 'b4xpp' && active.uri && active.uri.fsPath && isPathInside(active.uri.fsPath, sourceRoot)) {
      overrides.set(path.resolve(active.uri.fsPath), active.getText());
    }
  } catch {}
  return overrides;
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


function resolveConfiguredIdeProjectDir(root, config, directiveProjectDir, projectName, platform) {
  const baseRaw = (config && config.projectDir) ? String(config.projectDir).trim() : 'b4x-ide-projects';
  const fallbackName = `${sanitizeProjectName(projectName) || 'B4XPPDemo'}-${platform || 'b4j'}`;
  const raw = directiveProjectDir ? String(directiveProjectDir).trim() : '';
  const baseDir = path.isAbsolute(baseRaw) ? baseRaw : path.resolve(root, baseRaw || 'b4x-ide-projects');

  if (!raw) return path.join(baseDir, fallbackName);
  if (path.isAbsolute(raw)) return raw;

  const normRaw = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const normBaseRaw = String(baseRaw || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const baseName = normBaseRaw.split('/').filter(Boolean).pop() || 'b4x-ide-projects';

  // If #ProjectDir already includes the configured container folder, do not nest it twice.
  // Example: config projectDir = b4x-ide-projects and #ProjectDir b4x-ide-projects/AnimalDemo
  // => <workspace>/b4x-ide-projects/AnimalDemo.
  if (normBaseRaw && (normRaw.toLowerCase() === normBaseRaw.toLowerCase() || normRaw.toLowerCase().startsWith(normBaseRaw.toLowerCase() + '/'))) {
    return path.resolve(root, raw);
  }
  if (baseName && (normRaw.toLowerCase() === baseName.toLowerCase() || normRaw.toLowerCase().startsWith(baseName.toLowerCase() + '/'))) {
    return path.resolve(root, raw);
  }

  // Explicit relative escape stays relative to the workspace; simple names stay under b4xpp.projectDir.
  if (normRaw.startsWith('../') || normRaw === '..') return path.resolve(root, raw);
  return path.join(baseDir, raw);
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
  const projectRoot = resolveConfiguredIdeProjectDir(root, config, result.project.projectDir, projectName, platform);

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

  const projectConfig = makeProjectConfigWithPackageNativeDeps(config, result.project, result);
  const project = writeIdeProject(projectRoot, platform, projectName, packageName, result.outputs, projectConfig);
  writeB4XPPMetadata(root, result, projectRoot);
  const relProject = path.relative(root, project.filePath).replace(/\\/g, '/');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(project.filePath));
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage(`B4X++: #Project synchronized: ${relProject}. The .bas files used by the B4X IDE are directly in this folder.`);
}




function collectB4XPPLibNativeDependencies(result) {
  const libs = (result && result.b4xpplibDependencies) || [];
  return {
    common: uniqueStrings(libs.flatMap(lib => lib.nativeDependsOn || [])),
    b4a: uniqueStrings(libs.flatMap(lib => lib.nativeB4ADependsOn || [])),
    b4j: uniqueStrings(libs.flatMap(lib => lib.nativeB4JDependsOn || [])),
    b4i: uniqueStrings(libs.flatMap(lib => lib.nativeB4iDependsOn || []))
  };
}

function makeProjectConfigWithPackageNativeDeps(config, project, result) {
  const nativeDeps = collectB4XPPLibNativeDependencies(result);
  return {
    ...config,
    mobileMainModuleName: project.mobileMainModuleName || config.mobileMainModuleName,
    projectDependsOn: uniqueStrings([...(project.dependsOn || []), ...nativeDeps.common]),
    projectB4ADependsOn: uniqueStrings([...(project.b4aDependsOn || []), ...nativeDeps.b4a]),
    projectB4JDependsOn: uniqueStrings([...(project.b4jDependsOn || []), ...nativeDeps.b4j]),
    projectB4iDependsOn: uniqueStrings([...(project.b4iDependsOn || []), ...nativeDeps.b4i])
  };
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
    const m = raw.match(/^Property\s+(.+?)\s+As\s+(.+)$/i);
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
      label: 'Closure console sample: anonymous Sub / captured variables',
      description: `Copy into ${config.sourceDir}/ and open Demo.bx`,
      value: 'closure-to-src'
    },
    {
      label: 'OOP game sample: Dungeon Arena',
      description: `Copy into ${config.sourceDir}/ and open Demo.bx`,
      value: 'game-to-src'
    },
    {
      label: 'XUI game sample: Breakout',
      description: `Copy into ${config.sourceDir}/ and open Demo.bx`,
      value: 'breakout-to-src'
    },
    {
      label: 'Create all GitHub examples',
      description: 'Copy basic-animal, language-showcase, closure-console, oop-dungeon-arena and xui-breakout under examples/',
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
    await writeExampleTemplateWithPrompt(path.join(examplesRoot, 'closure-console', config.sourceDir), getClosureConsoleTemplate(), root);
    await writeExampleTemplateWithPrompt(path.join(examplesRoot, 'oop-dungeon-arena', config.sourceDir), getDungeonArenaTemplate(), root);
    await writeExampleTemplateWithPrompt(path.join(examplesRoot, 'xui-breakout', config.sourceDir), getBreakoutTemplate(), root);
    const readmePath = path.join(examplesRoot, 'README.md');
    if (!fs.existsSync(readmePath)) fs.writeFileSync(readmePath, getExamplesReadme(), 'utf8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(readmePath));
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage('B4X++: all examples were created under examples/. Open each example folder separately to test Sync #Project or Build .b4xlib.');
    return;
  }

  const template = choice.value === 'showcase-to-src'
    ? getLanguageShowcaseTemplate()
    : choice.value === 'closure-to-src'
      ? getClosureConsoleTemplate()
      : choice.value === 'game-to-src'
        ? getDungeonArenaTemplate()
        : choice.value === 'breakout-to-src'
          ? getBreakoutTemplate()
          : getBasicAnimalTemplate();
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

async function buildB4XPPLibCommand() {
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

  const libConfig = parseB4XPPLibDirectives(root, config, files);
  if (!libConfig.name) {
    const input = await vscode.window.showInputBox({
      title: 'B4X++: B4XPPLib source package name',
      prompt: 'Name of the .b4xpplib to create. You can also add #B4XPPLib MyLibrary to a .bx file.',
      value: sanitizeProjectName(path.basename(root)) || 'B4XPPSourcePackage',
      validateInput: (value) => sanitizeProjectName(value) ? undefined : 'Use a simple name: letters, digits and underscore, starting with a letter.'
    });
    if (!input) return;
    libConfig.name = sanitizeProjectName(input);
  }

  const outDir = path.isAbsolute(libConfig.dir) ? libConfig.dir : path.join(root, libConfig.dir || config.b4xpplibDir || 'b4xpp-libs');
  fs.mkdirSync(outDir, { recursive: true });
  const libPath = path.join(outDir, `${libConfig.name}.b4xpplib`);
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
  for (const file of files) {
    const rel = path.relative(sourceRoot, file).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    if (seen.has(rel.toLowerCase())) continue;
    seen.add(rel.toLowerCase());
    entries.push({ name: rel, data: fs.readFileSync(file) });
  }

  entries.push({ name: 'manifest.txt', data: Buffer.from(makeB4XPPLibManifest(libConfig), 'utf8') });

  const filesRoot = resolveLibraryFilesDir(root, config, libConfig);
  if (filesRoot && fs.existsSync(filesRoot)) {
    for (const file of collectAllFiles(filesRoot)) {
      const rel = path.relative(filesRoot, file).replace(/\\/g, '/');
      entries.push({ name: `Files/${rel}`, data: fs.readFileSync(file) });
    }
  }

  writeZipStore(entries, libPath);
  const rel = path.relative(root, libPath).replace(/\\/g, '/');
  vscode.window.showInformationMessage(`B4X++: ${libConfig.name}.b4xpplib built with ${files.length} .bx source file(s): ${rel}`);
}

function parseB4XPPLibDirectives(root, config, files) {
  const lib = {
    name: '',
    version: '1.00',
    author: '',
    dir: config.b4xpplibDir || 'b4xpp-libs',
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
      if ((m = line.match(/^#B4XPPLib\s+(.+)$/i))) lib.name = sanitizeProjectName(m[1].trim().replace(/^['"]|['"]$/g, '')) || lib.name;
      else if ((m = line.match(/^#B4XPPLibVersion\s+(.+)$/i))) lib.version = m[1].trim().replace(/^['"]|['"]$/g, '') || lib.version;
      else if ((m = line.match(/^#B4XPPLibAuthor\s+(.+)$/i))) lib.author = m[1].trim().replace(/^['"]|['"]$/g, '');
      else if ((m = line.match(/^#B4XPPLibDir\s+(.+)$/i))) lib.dir = m[1].trim().replace(/^['"]|['"]$/g, '') || lib.dir;
      else if ((m = line.match(/^#LibraryFilesDir\s+(.+)$/i))) lib.filesDir = m[1].trim().replace(/^['"]|['"]$/g, '');
      else if ((m = line.match(/^#B4XPPLibDependsOn\s+(.+)$/i))) lib.dependsOn.push(...splitCsvDirective(m[1]));
      else if ((m = line.match(/^#B4XPPLibB4ADependsOn\s+(.+)$/i))) lib.b4aDependsOn.push(...splitCsvDirective(m[1]));
      else if ((m = line.match(/^#B4XPPLibB4JDependsOn\s+(.+)$/i))) lib.b4jDependsOn.push(...splitCsvDirective(m[1]));
      else if ((m = line.match(/^#B4XPPLibB4iDependsOn\s+(.+)$/i))) lib.b4iDependsOn.push(...splitCsvDirective(m[1]));
      else if ((m = line.match(/^#B4XPPLibSupportedPlatforms\s+(.+)$/i))) lib.supportedPlatforms.push(...splitCsvDirective(m[1]));

      // Friendly fallback: a source package can also reuse the B4XLib metadata while it is still source-only.
      else if ((m = line.match(/^#B4XLib\s+(.+)$/i)) && !lib.name) lib.name = sanitizeProjectName(m[1].trim().replace(/^['"]|['"]$/g, '')) || lib.name;
      else if ((m = line.match(/^#B4XLibVersion\s+(.+)$/i)) && (!lib.version || lib.version === '1.00')) lib.version = m[1].trim().replace(/^['"]|['"]$/g, '') || lib.version;
      else if ((m = line.match(/^#B4XLibAuthor\s+(.+)$/i)) && !lib.author) lib.author = m[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  lib.dependsOn = uniqueStrings(lib.dependsOn);
  lib.b4aDependsOn = uniqueStrings(lib.b4aDependsOn);
  lib.b4jDependsOn = uniqueStrings(lib.b4jDependsOn);
  lib.b4iDependsOn = uniqueStrings(lib.b4iDependsOn);
  lib.supportedPlatforms = uniqueStrings(lib.supportedPlatforms.map(s => s.toUpperCase().replace('B4I', 'B4i')));
  return lib;
}

function makeB4XPPLibManifest(lib) {
  const lines = [];
  if (lib.name) lines.push(`Name=${lib.name}`);
  if (lib.version) lines.push(`Version=${normalizeB4XNumericVersion(lib.version)}`);
  if (lib.author) lines.push(`Author=${lib.author}`);
  lines.push(`Generator=B4X++ ${B4XPP_GENERATOR_VERSION}`);
  if (lib.supportedPlatforms && lib.supportedPlatforms.length) lines.push(`SupportedPlatforms=${lib.supportedPlatforms.join(', ')}`);
  if (lib.dependsOn.length) lines.push(`B4XPPLibDependsOn=${lib.dependsOn.join(', ')}`);
  if (lib.b4aDependsOn.length) lines.push(`B4A.B4XPPLibDependsOn=${lib.b4aDependsOn.join(', ')}`);
  if (lib.b4jDependsOn.length) lines.push(`B4J.B4XPPLibDependsOn=${lib.b4jDependsOn.join(', ')}`);
  if (lib.b4iDependsOn.length) lines.push(`B4i.B4XPPLibDependsOn=${lib.b4iDependsOn.join(', ')}`);
  return lines.join('\n') + '\n';
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
      else if ((m = line.match(/^#B4XLibVersion\s+(.+)$/i))) lib.version = m[1].trim().replace(/^['"]|['"]$/g, '') || lib.version;
      else if ((m = line.match(/^#B4XLibAuthor\s+(.+)$/i))) lib.author = m[1].trim().replace(/^['"]|['"]$/g, '');
      else if ((m = line.match(/^#B4XLibDir\s+(.+)$/i))) lib.dir = m[1].trim().replace(/^['"]|['"]$/g, '') || lib.dir;
      else if ((m = line.match(/^#LibraryFilesDir\s+(.+)$/i))) lib.filesDir = m[1].trim().replace(/^['"]|['"]$/g, '');
      else if ((m = line.match(/^#B4XLibDependsOn\s+(.+)$/i))) lib.dependsOn.push(...splitCsvDirective(m[1]));
      else if ((m = line.match(/^#B4XLibB4ADependsOn\s+(.+)$/i))) lib.b4aDependsOn.push(...splitCsvDirective(m[1]));
      else if ((m = line.match(/^#B4XLibB4JDependsOn\s+(.+)$/i))) lib.b4jDependsOn.push(...splitCsvDirective(m[1]));
      else if ((m = line.match(/^#B4XLibB4iDependsOn\s+(.+)$/i))) lib.b4iDependsOn.push(...splitCsvDirective(m[1]));
      else if ((m = line.match(/^#B4XLibSupportedPlatforms\s+(.+)$/i))) lib.supportedPlatforms.push(...splitCsvDirective(m[1]));

      // Legacy aliases. Kept as a fallback only.
      else if ((m = line.match(/^#Version\s+(.+)$/i)) && (!lib.version || lib.version === '1.00')) lib.version = m[1].trim().replace(/^['"]|['"]$/g, '') || lib.version;
      else if ((m = line.match(/^#Author\s+(.+)$/i)) && !lib.author) lib.author = m[1].trim().replace(/^['"]|['"]$/g, '');
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

function getClosureConsoleTemplate() {
  return {
    name: 'Closure Console sample',
    files: {
      'Demo.bx': `#Project B4J-NonUI B4XPPClosureConsole
#Package b4xpp.examples.closures
#ProjectDir b4x-ide-projects/B4XPPClosureConsole-b4j-nonui
#MainModule Main

#B4XLib B4XPPClosureConsole
#B4XLibVersion 1.00
#B4XLibAuthor B4X++ Team
#B4XLibDir b4x-libs
#B4XLibSupportedPlatforms B4J

#Include "services/TaskRunner.bx"

Sub Process_Globals
End Sub

Sub AppStart (Args() As String)
    Log("=== B4X++ Closure Console Demo ===")
    BasicGreeting
    CapturedAdder
    PassedClosure
End Sub

Private Sub BasicGreeting
    Dim say As Closure = Sub(msg As String)
        Log("Message: " & msg)
    End Sub
    say("anonymous Sub without capture")
End Sub

Private Sub CapturedAdder
    Dim a As Int
    a = 2
    Dim add As Closure = Sub(i As Int) As Int
        Return a + i
    End Sub
    Log("2 + 5 = " & add(5))
    a = 10
    Log("10 + 5 = " & add(5))
End Sub

Private Sub PassedClosure
    Dim runner As TaskRunner
    runner.Initialize
    Dim factor As Int = 3
    Dim multiply As Closure = Sub(value As Int) As Int
        Return value * factor
    End Sub
    runner.Add("triple", multiply)
    runner.RunAll(7)
End Sub
`,
      'services/TaskRunner.bx': `Class TaskRunner

Sub Class_Globals
    Private mNames As List
    Private mActions As List
End Sub

Constructor
    mNames.Initialize
    mActions.Initialize
End Constructor

Public Sub Add(Name As String, Action As Closure)
    mNames.Add(Name)
    mActions.Add(Action)
End Sub

Public Sub RunAll(Value As Int)
    For i = 0 To mActions.Size - 1
        Dim action As Closure = mActions.Get(i)
        Log(mNames.Get(i) & "(" & Value & ") = " & action(Value))
    Next
End Sub

End Class
`
    }
  };
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
#B4XLibVersion 1.00
#B4XLibAuthor B4X++ Team
#B4XLibDir b4x-libs
#B4XLibSupportedPlatforms B4A, B4J, B4i

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
      'contracts/IAnimal.bx': `Interface IAnimal
Sub Speak As String
Sub Move(Distance As Int) As String
End Interface
`,
      'models/Animal.bx': `Class Animal Abstract Implements IAnimal

Property ReadOnly Name As String = "Unknown"

Constructor(Name As String)
    mName = Name
End Constructor

Virtual Sub Speak As String
    Return "I am " & mName
End Sub

Virtual Sub Move(Distance As Int) As String
    Return mName & " moves " & FormatDistance(Distance)
End Sub

Protected Sub FormatDistance(Distance As Int) As String
    Return Distance & " m"
End Sub

End Class
`,
      'models/Dog.bx': `Class Dog Extends Animal Final

Constructor(Name As String)
    Super.Initialize(Name)
End Constructor

Override Sub Speak As String
    Return Super.Name & " says woof"
End Sub

Override Sub Move(Distance As Int) As String
    Return Super.Name & " runs " & Distance & " m"
End Sub

End Class
`,
      'models/Cat.bx': `Class Cat Extends Animal Final

Constructor(Name As String)
    Super.Initialize(Name)
End Constructor

Override Sub Speak As String
    Return Super.Name & " says meow"
End Sub

Override Sub Move(Distance As Int) As String
    Return Super.Name & " silently walks " & Distance & " m"
End Sub

End Class
`,
      'models/Bird.bx': `Class Bird Extends Animal Final

Constructor(Name As String)
    Super.Initialize(Name)
End Constructor

Override Sub Speak As String
    Return Super.Name & " says tweet"
End Sub

Override Sub Move(Distance As Int) As String
    Return Super.Name & " flies " & Distance & " m"
End Sub

End Class
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
#B4XLibVersion 1.00
#B4XLibAuthor B4X++ Team
#B4XLibDir b4x-libs
#B4XLibSupportedPlatforms B4A, B4J, B4i
#ProjectB4JDependsOn jXUI
#B4XLibDependsOn XUI
#B4XLibB4JDependsOn jXUI
#B4XLibB4ADependsOn XUI
#B4XLibB4iDependsOn iXUI
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
      'contracts/IRenderable.bx': `Interface IRenderable
Sub Render(Theme As String, Scale As Int, Debug As Boolean) As String
End Interface
`,
      'contracts/IIdentifiable.bx': `Interface IIdentifiable
Sub Identity As String
End Interface
`,
      'core/BaseComponent.bx': `Class BaseComponent Abstract Implements IRenderable, IIdentifiable

#DesignerProperty: Key: Title, DisplayName: Title, FieldType: String, DefaultValue: Untitled, Description: Component title
#Event: Click

Property ReadOnly Id As String
Property Title As String = "Untitled"
Property ReadOnly CreatedAt As Long = 0

Constructor(Id As String, Title As String)
    mId = Id
    mTitle = Title
    mCreatedAt = DateTime.Now
End Constructor

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

End Class
`,
      'components/ButtonComponent.bx': `Class ButtonComponent Extends BaseComponent Final

Property Enabled As Boolean = True

Constructor(Id As String, Title As String)
    Super.Initialize(Id, Title)
    mEnabled = True
End Constructor

Override Sub ComponentType As String
    Return "button"
End Sub

Override Sub Render(Theme As String, Scale As Int, Debug As Boolean) As String
    Return BuildRenderLine(This.ComponentType, Theme, Scale, Debug) & " enabled=" & mEnabled
End Sub

End Class
`,
      'components/LabelComponent.bx': `Class LabelComponent Extends BaseComponent
Final

Property Text As String = ""

Constructor(Id As String, Title As String)
    Super.Initialize(Id, Title)
    mText = Title
End Constructor

Override Sub ComponentType As String
    Return "label"
End Sub

Override Sub Render(Theme As String, Scale As Int, Debug As Boolean) As String
    Return BuildRenderLine(This.ComponentType, Theme, Scale, Debug) & " text=" & mText
End Sub

End Class
`,
      'services/ComponentRegistry.bx': `Class ComponentRegistry

Property WriteOnly LastRendered As String = ""

Constructor
End Constructor

Virtual Sub Store(Component As Object) As String
    Dim renderable As Poly IRenderable
    renderable = Component
    mLastRendered = renderable.Render("registry", 1, False)
    Return mLastRendered
End Sub

End Class
`,
      'Files/readme.txt': `This folder is copied into the Files/ folder inside the generated .b4xlib.
Use #LibraryFilesDir to select another resource folder.
`
    }
  };
}

function getDungeonArenaTemplate() {
  return {
    name: 'OOP Dungeon Arena game sample',
    files: {
      "Demo.bx": "#Project B4J-NonUI B4XPPDungeonArena\n#Package b4xpp.examples.dungeonarena\n#ProjectDir b4x-ide-projects/B4XPPDungeonArena-b4j-nonui\n#MainModule Main\n\n#B4XLib B4XPPDungeonArena\n#B4XLibVersion 1.00\n#B4XLibAuthor B4X++ Team\n#B4XLibDir b4x-libs\n#B4XLibSupportedPlatforms B4A, B4J, B4i\n\n#Include \"contracts/IRenderable.bx\"\n#Include \"contracts/IActor.bx\"\n#Include \"contracts/ICollectible.bx\"\n#Include \"core/ArenaMath.bx\"\n#Include \"core/GameObject.bx\"\n#Include \"actors/Actor.bx\"\n#Include \"actors/Hero.bx\"\n#Include \"actors/Enemy.bx\"\n#Include \"actors/Slime.bx\"\n#Include \"actors/Goblin.bx\"\n#Include \"actors/Boss.bx\"\n#Include \"items/Item.bx\"\n#Include \"items/HealthPotion.bx\"\n#Include \"items/DamageBoost.bx\"\n#Include \"services/GameWorld.bx\"\n\nSub Process_Globals\nEnd Sub\n\nSub AppStart (Args() As String)\n    Log(\"=== B4X++ OOP Dungeon Arena ===\")\n\n    Dim world As GameWorld\n    world.Initialize(8, 6)\n    world.StartDemo\nEnd Sub\n",
      "actors/Actor.bx": "Class Actor Abstract Extends GameObject Implements IActor\n\nProperty Health As Int = 10\nProperty MaxHealth As Int = 10\nProperty AttackPower As Int = 1\nProperty Speed As Int = 1\n\nConstructor(Id As String, Name As String, X As Int, Y As Int, MaxHealth As Int, AttackPower As Int)\n    Super.Initialize(Id, Name, X, Y)\n    setMaxHealth(MaxHealth)\n    setHealth(MaxHealth)\n    setAttackPower(AttackPower)\n    setSpeed(1)\nEnd Constructor\n\nPublic Sub IsAlive As Boolean\n    Return getHealth > 0\nEnd Sub\n\nPublic Sub GetPosX As Int\n    Return getX\nEnd Sub\n\nPublic Sub SetPosX(Value As Int)\n    setX(Value)\nEnd Sub\n\nPublic Sub GetPosY As Int\n    Return getY\nEnd Sub\n\nPublic Sub SetPosY(Value As Int)\n    setY(Value)\nEnd Sub\n\nVirtual Sub Team As String\n    Return \"neutral\"\nEnd Sub\n\nVirtual Sub TakeTurn(World As Object)\nEnd Sub\n\nVirtual Sub ReceiveDamage(Amount As Int, Source As Object) As String\n    Dim beforeHealth As Int = getHealth\n    setHealth(getHealth - Amount)\n    Return getName & \" takes \" & (beforeHealth - getHealth) & \" damage. HP=\" & getHealth & \"/\" & getMaxHealth\nEnd Sub\n\nVirtual Sub Attack(Target As Object) As String\n    Dim targetActor As Poly IActor\n    targetActor = Target\n    Dim targetAlive As Boolean = targetActor.IsAlive\n    If targetAlive = False Then Return getName & \" has no living target.\"\n    Return getName & \" attacks. \" & targetActor.ReceiveDamage(getAttackPower, Me)\nEnd Sub\n\nProtected Sub MoveToward(Target As Object, World As GameWorld) As String\n    Dim targetActor As Poly IActor\n    targetActor = Target\n    Dim targetX As Int = targetActor.GetPosX\n    Dim targetY As Int = targetActor.GetPosY\n    Dim dx As Int = ArenaMath.Sign(targetX - getX)\n    Dim dy As Int = ArenaMath.Sign(targetY - getY)\n    If ArenaMath.AbsI(targetX - getX) >= ArenaMath.AbsI(targetY - getY) Then\n        dy = 0\n    Else\n        dx = 0\n    End If\n    World.MoveActor(Me, dx, dy)\n    Return getName & \" moves \" & ArenaMath.DirectionLabel(dx, dy) & \" to \" & FormatPosition\nEnd Sub\n\nOverride Sub Render As String\n    Return Super.Render & \" hp=\" & getHealth & \"/\" & getMaxHealth & \" atk=\" & getAttackPower\nEnd Sub\n\nEnd Class\n",
      "actors/Boss.bx": "Class Boss Extends Enemy Final\n\nProperty Rage As Int = 0\n\nConstructor(Id As String, Name As String, X As Int, Y As Int)\n    Super.Initialize(Id, Name, X, Y, 25, 7, 8)\n    setRage(0)\nEnd Constructor\n\nOverride Sub ReceiveDamage(Amount As Int, Source As Object) As String\n    Dim line As String = Super.ReceiveDamage(Amount, Source)\n    setRage(getRage + 1)\n    setAttackPower(7 + getRage)\n    Return line & \" Rage=\" & getRage & \", ATK=\" & getAttackPower\nEnd Sub\n\nOverride Sub Attack(Target As Object) As String\n    Return \"[Boss] \" & Super.Attack(Target)\nEnd Sub\n\nOverride Sub WarCry As String\n    Return getName & \" roars. The arena trembles.\"\nEnd Sub\n\nEnd Class\n",
      "actors/Enemy.bx": "Class Enemy Abstract Extends Actor\n\nProperty AggroRange As Int = 3\n\nConstructor(Id As String, Name As String, X As Int, Y As Int, MaxHealth As Int, AttackPower As Int, AggroRange As Int)\n    Super.Initialize(Id, Name, X, Y, MaxHealth, AttackPower)\n    setAggroRange(AggroRange)\nEnd Constructor\n\nOverride Sub Team As String\n    Return \"enemy\"\nEnd Sub\n\nOverride Sub TakeTurn(World As Object)\n    Dim arenaWorld As GameWorld = World\n    Dim heroTarget As Object = arenaWorld.Hero\n    Dim heroActor As Poly IActor\n    heroActor = heroTarget\n    Dim heroIsAlive As Boolean = heroActor.IsAlive\n    If IsAlive = False Or heroIsAlive = False Then Return\n\n    Dim heroX As Int = heroActor.GetPosX\n    Dim heroY As Int = heroActor.GetPosY\n    Dim distanceToHero As Int = ArenaMath.Distance(getX, getY, heroX, heroY)\n    If distanceToHero <= 1 Then\n        Log(Attack(heroTarget))\n    Else If distanceToHero <= getAggroRange Then\n        Log(MoveToward(heroTarget, arenaWorld))\n    Else\n        Log(WarCry)\n    End If\nEnd Sub\n\nProtected Virtual Sub WarCry As String\n    Return getName & \" waits in the dark.\"\nEnd Sub\n\nOverride Sub Render As String\n    Return Super.Render & \" aggro=\" & getAggroRange\nEnd Sub\n\nEnd Class\n",
      "actors/Goblin.bx": "Class Goblin Extends Enemy Final\n\nConstructor(Id As String, X As Int, Y As Int)\n    Super.Initialize(Id, \"Goblin\", X, Y, 12, 4, 5)\nEnd Constructor\n\nOverride Sub Attack(Target As Object) As String\n    Return \"[Goblin] \" & Super.Attack(Target)\nEnd Sub\n\nOverride Sub WarCry As String\n    Return getName & \" sharpens a tiny blade.\"\nEnd Sub\n\nEnd Class\n",
      "actors/Hero.bx": "Class Hero Extends Actor Final\n\nProperty Score As Int = 0\n\nConstructor(Id As String, Name As String, X As Int, Y As Int)\n    Super.Initialize(Id, Name, X, Y, 30, 6)\n    setScore(0)\nEnd Constructor\n\nOverride Sub Team As String\n    Return \"hero\"\nEnd Sub\n\nOverride Sub TakeTurn(World As Object)\n    Dim arenaWorld As GameWorld = World\n    If IsAlive = False Then Return\n\n    Dim nearestEnemy As Object = arenaWorld.FindNearestEnemy(getX, getY)\n    If nearestEnemy = Null Then Return\n\n    Dim enemyActor As Poly IActor\n    enemyActor = nearestEnemy\n    Dim enemyX As Int = enemyActor.GetPosX\n    Dim enemyY As Int = enemyActor.GetPosY\n    Dim distanceToEnemy As Int = ArenaMath.Distance(getX, getY, enemyX, enemyY)\n    If distanceToEnemy <= 1 Then\n        Log(Attack(nearestEnemy))\n        Dim enemyAliveAfterAttack As Boolean = enemyActor.IsAlive\n        If enemyAliveAfterAttack = False Then\n            setScore(getScore + 10)\n            Log(getName & \" gains 10 score. Score=\" & getScore)\n        End If\n    Else\n        Log(MoveToward(nearestEnemy, arenaWorld))\n    End If\nEnd Sub\n\nOverride Sub Attack(Target As Object) As String\n    Return \"[Hero] \" & Super.Attack(Target)\nEnd Sub\n\nPublic Sub Heal(Amount As Int) As String\n    Dim beforeHealth As Int = getHealth\n    setHealth(getHealth + Amount)\n    Return getName & \" heals \" & (getHealth - beforeHealth) & \" HP. HP=\" & getHealth & \"/\" & getMaxHealth\nEnd Sub\n\nPublic Sub BoostAttack(Amount As Int) As String\n    setAttackPower(getAttackPower + Amount)\n    Return getName & \" gains +\" & Amount & \" attack. ATK=\" & getAttackPower\nEnd Sub\n\nOverride Sub Render As String\n    Return Super.Render & \" score=\" & getScore\nEnd Sub\n\nEnd Class\n",
      "actors/Slime.bx": "Class Slime Extends Enemy Final\n\nConstructor(Id As String, X As Int, Y As Int)\n    Super.Initialize(Id, \"Slime\", X, Y, 8, 2, 4)\nEnd Constructor\n\nOverride Sub Attack(Target As Object) As String\n    Return \"[Slime] \" & Super.Attack(Target)\nEnd Sub\n\nOverride Sub WarCry As String\n    Return getName & \" jiggles suspiciously.\"\nEnd Sub\n\nEnd Class\n",
      "contracts/IActor.bx": "Interface IActor\nSub TakeTurn(World As Object)\nSub IsAlive As Boolean\nSub Team As String\nSub ReceiveDamage(Amount As Int, Source As Object) As String\nSub Attack(Target As Object) As String\nSub GetPosX As Int\nSub SetPosX(Value As Int)\nSub GetPosY As Int\nSub SetPosY(Value As Int)\nSub Render As String\nEnd Interface\n",
      "contracts/ICollectible.bx": "Interface ICollectible\nSub ApplyTo(Target As Object) As String\nSub IsPicked As Boolean\nSub SameTile(TileX As Int, TileY As Int) As Boolean\nSub Render As String\nEnd Interface\n",
      "contracts/IRenderable.bx": "Interface IRenderable\nSub Render(Cvs As B4XCanvas)\nEnd Interface\n",
      "core/ArenaMath.bx": "StaticCode ArenaMath\n\nSub Process_Globals\nEnd Sub\n\nPublic Sub Clamp(Value As Int, MinValue As Int, MaxValue As Int) As Int\n    If Value < MinValue Then Return MinValue\n    If Value > MaxValue Then Return MaxValue\n    Return Value\nEnd Sub\n\nPublic Sub AbsI(Value As Int) As Int\n    If Value < 0 Then Return -Value\n    Return Value\nEnd Sub\n\nPublic Sub Distance(X1 As Int, Y1 As Int, X2 As Int, Y2 As Int) As Int\n    Return AbsI(X1 - X2) + AbsI(Y1 - Y2)\nEnd Sub\n\nPublic Sub Sign(Value As Int) As Int\n    If Value < 0 Then Return -1\n    If Value > 0 Then Return 1\n    Return 0\nEnd Sub\n\nPublic Sub DirectionLabel(DX As Int, DY As Int) As String\n    If DX = 0 And DY = 0 Then Return \"wait\"\n    If AbsI(DX) > AbsI(DY) Then\n        If DX > 0 Then Return \"east\"\n        Return \"west\"\n    End If\n    If DY > 0 Then Return \"south\"\n    Return \"north\"\nEnd Sub\n\nEnd StaticCode\n",
      "core/GameObject.bx": "Class GameObject Abstract Implements IRenderable\n\nProperty ReadOnly Id As String = \"\"\nProperty Name As String = \"Object\"\nProperty X As Int = 0\nProperty Y As Int = 0\n\nConstructor(Id As String, Name As String)\n    mId = Id\n    mName = Name\n    mX = 0\n    mY = 0\nEnd Constructor\n\nConstructor(Id As String, Name As String, X As Int, Y As Int)\n    mId = Id\n    mName = Name\n    mX = X\n    mY = Y\nEnd Constructor\n\nVirtual Sub Render As String\n    Return mName & \"@\" & FormatPosition\nEnd Sub\n\nPublic Sub SameTile(TileX As Int, TileY As Int) As Boolean\n    Return mX = TileX And mY = TileY\nEnd Sub\n\nProtected Sub FormatPosition As String\n    Return \"(\" & mX & \",\" & mY & \")\"\nEnd Sub\n\nEnd Class\n",
      "items/DamageBoost.bx": "Class DamageBoost Extends Item Final\n\nProperty Amount As Int = 2\n\nConstructor(Id As String, X As Int, Y As Int, Amount As Int)\n    Super.Initialize(Id, \"Damage Boost\", X, Y)\n    setAmount(Amount)\nEnd Constructor\n\nOverride Sub ApplyTo(Target As Object) As String\n    If getPicked Then Return \"\"\n    Dim heroTarget As Hero = Target\n    setPicked(True)\n    Return heroTarget.BoostAttack(getAmount)\nEnd Sub\n\nEnd Class\n",
      "items/HealthPotion.bx": "Class HealthPotion Extends Item Final\n\nProperty Amount As Int = 10\n\nConstructor(Id As String, X As Int, Y As Int, Amount As Int)\n    Super.Initialize(Id, \"Health Potion\", X, Y)\n    setAmount(Amount)\nEnd Constructor\n\nOverride Sub ApplyTo(Target As Object) As String\n    If getPicked Then Return \"\"\n    Dim heroTarget As Hero = Target\n    setPicked(True)\n    Return heroTarget.Heal(getAmount)\nEnd Sub\n\nEnd Class\n",
      "items/Item.bx": "Class Item Abstract Extends GameObject Implements ICollectible\n\nProperty Picked As Boolean = False\n\nConstructor(Id As String, Name As String, X As Int, Y As Int)\n    Super.Initialize(Id, Name, X, Y)\n    setPicked(False)\nEnd Constructor\n\nPublic Sub IsPicked As Boolean\n    Return getPicked\nEnd Sub\n\nVirtual Sub ApplyTo(Target As Object) As String\n    setPicked(True)\n    Return getName & \" disappears.\"\nEnd Sub\n\nOverride Sub Render As String\n    Return \"item:\" & Super.Render & \" picked=\" & getPicked\nEnd Sub\n\nEnd Class\n",
      "services/GameWorld.bx": "Class GameWorld Final\n\nProperty ReadOnly Width As Int = 0\nProperty ReadOnly Height As Int = 0\nProperty ReadOnly Turn As Int = 0\nProperty ReadOnly Hero As Hero\n\nSub Class_Globals\n    Private mActors As List\n    Private mCollectibles As List\nEnd Sub\n\nConstructor(Width As Int, Height As Int)\n    mWidth = Width\n    mHeight = Height\n    mTurn = 0\n    mActors.Initialize\n    mCollectibles.Initialize\nEnd Constructor\n\nPublic Sub StartDemo\n    Dim heroPlayer As Hero\n    heroPlayer.Initialize(\"hero-1\", \"Ada\", 1, 1)\n    mHero = heroPlayer\n    AddActor(heroPlayer)\n\n    Dim slimeOne As Slime\n    slimeOne.Initialize(\"slime-1\", 4, 1)\n    AddActor(slimeOne)\n\n    Dim goblinOne As Goblin\n    goblinOne.Initialize(\"goblin-1\", 6, 4)\n    goblinOne.Name = \"Sneaky Goblin\"\n    AddActor(goblinOne)\n\n    Dim bossOne As Boss\n    bossOne.Initialize(\"boss-1\", \"Captain Bug\", 7, 5)\n    AddActor(bossOne)\n\n    Dim potionOne As HealthPotion\n    potionOne.Initialize(\"potion-1\", 2, 1, 8)\n    AddCollectible(potionOne)\n\n    Dim boostOne As DamageBoost\n    boostOne.Initialize(\"boost-1\", 3, 1, 2)\n    AddCollectible(boostOne)\n\n    Log(Render)\n\n    For i = 1 To 12\n        RunTurn\n        Log(Render)\n        If mHero.IsAlive = False Then\n            Log(\"Game over: the hero was defeated.\")\n            Exit\n        End If\n        If CountLivingEnemies = 0 Then\n            Log(\"Victory: all enemies defeated.\")\n            Exit\n        End If\n    Next\nEnd Sub\n\nPublic Sub AddActor(ActorObject As Object)\n    mActors.Add(ActorObject)\nEnd Sub\n\nPublic Sub AddCollectible(ItemObject As Object)\n    mCollectibles.Add(ItemObject)\nEnd Sub\n\nPublic Sub MoveActor(ActorObject As Object, DX As Int, DY As Int)\n    Dim actorAgent As Poly IActor\n    actorAgent = ActorObject\n    Dim currentX As Int = actorAgent.GetPosX\n    Dim currentY As Int = actorAgent.GetPosY\n    actorAgent.SetPosX(ArenaMath.Clamp(currentX + DX, 0, mWidth - 1))\n    actorAgent.SetPosY(ArenaMath.Clamp(currentY + DY, 0, mHeight - 1))\n    CollectItemsForHero\nEnd Sub\n\nPublic Sub RunTurn\n    mTurn = mTurn + 1\n    Log(\"-- turn \" & mTurn & \" --\")\n    CollectItemsForHero\n\n    For i = 0 To mActors.Size - 1\n        Dim actorAgent As Poly IActor\n        actorAgent = mActors.Get(i)\n        Dim actorIsAlive As Boolean = actorAgent.IsAlive\n        If actorIsAlive Then actorAgent.TakeTurn(Me)\n    Next\nEnd Sub\n\nPublic Sub FindNearestEnemy(StartX As Int, StartY As Int) As Object\n    Dim bestEnemy As Object = Null\n    Dim bestDistance As Int = 999999\n\n    For i = 0 To mActors.Size - 1\n        Dim actorAgent As Poly IActor\n        actorAgent = mActors.Get(i)\n        Dim actorIsAlive As Boolean = actorAgent.IsAlive\n        Dim actorTeam As String = actorAgent.Team\n        Dim actorIsEnemy As Boolean\n        If actorTeam = \"enemy\" Then\n            actorIsEnemy = True\n        Else\n            actorIsEnemy = False\n        End If\n        If actorIsAlive And actorIsEnemy Then\n            Dim actorX As Int = actorAgent.GetPosX\n            Dim actorY As Int = actorAgent.GetPosY\n            Dim distanceToCandidate As Int = ArenaMath.Distance(StartX, StartY, actorX, actorY)\n            If distanceToCandidate < bestDistance Then\n                bestEnemy = mActors.Get(i)\n                bestDistance = distanceToCandidate\n            End If\n        End If\n    Next\n\n    Return bestEnemy\nEnd Sub\n\nPublic Sub CountLivingEnemies As Int\n    Dim count As Int = 0\n    For i = 0 To mActors.Size - 1\n        Dim actorAgent As Poly IActor\n        actorAgent = mActors.Get(i)\n        Dim actorIsAlive As Boolean = actorAgent.IsAlive\n        Dim actorTeam As String = actorAgent.Team\n        Dim actorIsEnemy As Boolean\n        If actorTeam = \"enemy\" Then\n            actorIsEnemy = True\n        Else\n            actorIsEnemy = False\n        End If\n        If actorIsAlive And actorIsEnemy Then count = count + 1\n    Next\n    Return count\nEnd Sub\n\nPrivate Sub CollectItemsForHero\n    If mHero = Null Then Return\n    For i = 0 To mCollectibles.Size - 1\n        Dim itemAgent As Poly ICollectible\n        itemAgent = mCollectibles.Get(i)\n        Dim itemWasPicked As Boolean = itemAgent.IsPicked\n        If itemWasPicked = False Then\n            Dim heroX As Int = mHero.getX\n            Dim heroY As Int = mHero.getY\n            Dim sameTile As Boolean = itemAgent.SameTile(heroX, heroY)\n            If sameTile Then\n                Dim line As String = itemAgent.ApplyTo(mHero)\n                If line.Length > 0 Then Log(line)\n            End If\n        End If\n    Next\nEnd Sub\n\nPublic Sub Render As String\n    Dim sb As StringBuilder\n    sb.Initialize\n    sb.Append(CRLF).Append(\"Arena \").Append(mWidth).Append(\"x\").Append(mHeight).Append(\" turn=\").Append(mTurn).Append(CRLF)\n    sb.Append(\"Actors:\").Append(CRLF)\n\n    For i = 0 To mActors.Size - 1\n        Dim renderableActor As Poly IRenderable\n        renderableActor = mActors.Get(i)\n        sb.Append(\"  - \").Append(renderableActor.Render).Append(CRLF)\n    Next\n\n    sb.Append(\"Items:\").Append(CRLF)\n    For i = 0 To mCollectibles.Size - 1\n        Dim renderableItem As Poly IRenderable\n        renderableItem = mCollectibles.Get(i)\n        sb.Append(\"  - \").Append(renderableItem.Render).Append(CRLF)\n    Next\n\n    Return sb.ToString\nEnd Sub\n\nEnd Class\n"
    }
  };
}


function getBreakoutTemplate() {
  return {
    name: 'XUI Breakout game sample',
    files: {
      "Demo.bx": "#Project B4J-UI B4XPPBreakout\n#Package b4xpp.examples.breakout\n#ProjectDir b4x-ide-projects/B4XPPBreakout-b4j-ui\n#MainModule Main\n\n#B4XLib B4XPPBreakout\n#B4XLibVersion 1.00\n#B4XLibAuthor B4X++ Team\n#B4XLibDir b4x-libs\n#B4XLibSupportedPlatforms B4J\n#ProjectB4JDependsOn jXUI\n#B4XLibB4JDependsOn jXUI\n\n#Include \"contracts/IRenderable.bx\"\n#Include \"core/BreakoutMath.bx\"\n#Include \"entities/GameEntity.bx\"\n#Include \"entities/Paddle.bx\"\n#Include \"entities/Ball.bx\"\n#Include \"entities/Brick.bx\"\n#Include \"services/BrickGrid.bx\"\n#Include \"services/ScoreBoard.bx\"\n#Include \"services/BreakoutGame.bx\"\n\nSub Process_Globals\n    Private fx As JFX\n    Private MainForm As Form\n    Private breakoutApp As BreakoutGame\n    Private gameClock As Timer\nEnd Sub\n\nSub AppStart (Form1 As Form, Args() As String)\n    MainForm = Form1\n    MainForm.Title = \"B4X++ XUI Breakout\"\n    MainForm.Resizable = False\n    MainForm.WindowWidth = 660dip\n    MainForm.WindowHeight = 540dip\n\n    Dim rootView As B4XView = MainForm.RootPane\n\n    breakoutApp.Initialize(rootView)\n    breakoutApp.StartPlay\n\n    gameClock.Initialize(\"GameClock\", 16)\n    gameClock.Enabled = True\n\n    MainForm.Show\nEnd Sub\n\nSub GameClock_Tick\n    breakoutApp.UpdateFrame\nEnd Sub\n",
      "contracts/IRenderable.bx": "Interface IRenderable\nSub Render(Cvs As B4XCanvas)\nEnd Interface\n",
      "core/BreakoutMath.bx": "StaticCode BreakoutMath\n\nSub Process_Globals\nEnd Sub\n\nPublic Sub ClampF(Value As Float, MinValue As Float, MaxValue As Float) As Float\n    If Value < MinValue Then Return MinValue\n    If Value > MaxValue Then Return MaxValue\n    Return Value\nEnd Sub\n\nPublic Sub AbsF(Value As Float) As Float\n    If Value < 0 Then Return -Value\n    Return Value\nEnd Sub\n\nPublic Sub Overlaps(LeftA As Float, TopA As Float, RightA As Float, BottomA As Float, LeftB As Float, TopB As Float, RightB As Float, BottomB As Float) As Boolean\n    If RightA < LeftB Then Return False\n    If LeftA > RightB Then Return False\n    If BottomA < TopB Then Return False\n    If TopA > BottomB Then Return False\n    Return True\nEnd Sub\n\nPublic Sub CenterOf(LeftValue As Float, SizeValue As Float) As Float\n    Return LeftValue + SizeValue / 2\nEnd Sub\n\nEnd StaticCode\n",
      "entities/Ball.bx": "Class Ball Extends GameEntity Final\n\nProperty VelocityX As Float = 190\nProperty VelocityY As Float = -230\nProperty Radius As Float = 7\n\nConstructor(aX As Float, aY As Float, aRadius As Float, aColor As Int)\n    ' The ball is stored as a rectangle but rendered as a circle.\n    Super.Initialize(aX - aRadius, aY - aRadius, aRadius * 2, aRadius * 2, aColor)\n    Radius = aRadius\n    VelocityX = 190\n    VelocityY = -230\nEnd Constructor\n\nPublic Sub ResetAt(aBallCenterX As Float, aBallCenterY As Float)\n    ' Places the ball above the paddle before launch / relaunch.\n    SetPosition(aBallCenterX - getRadius, aBallCenterY - getRadius)\n    VelocityX = 190\n    VelocityY = -230\nEnd Sub\n\nPublic Sub Advance(aDeltaSeconds As Float, aBoundsWidth As Float)\n    ' Moves the ball and bounces against the left, right and top walls.\n    SetPosition(getX + getVelocityX * aDeltaSeconds, getY + getVelocityY * aDeltaSeconds)\n\n    If Left <= 0 Then\n        SetPosition(0, getY)\n        BounceX\n    Else If Right >= aBoundsWidth Then\n        SetPosition(aBoundsWidth - getWidth, getY)\n        BounceX\n    End If\n\n    If Top <= 0 Then\n        SetPosition(getX, 0)\n        BounceY\n    End If\nEnd Sub\n\nPublic Sub BounceX\n    ' Reverses horizontal movement.\n    VelocityX = -getVelocityX\nEnd Sub\n\nPublic Sub BounceY\n    ' Reverses vertical movement.\n    VelocityY = -getVelocityY\nEnd Sub\n\nPublic Sub AimFromPaddle(aPlayerPaddle As Paddle)\n    ' Changes the exit angle depending on where the ball touched the paddle.\n    Dim offset As Float = (CenterX - aPlayerPaddle.CenterX) / Max(1, aPlayerPaddle.getWidth / 2)\n    offset = BreakoutMath.ClampF(offset, -1, 1)\n    VelocityX = 260 * offset\n    VelocityY = -BreakoutMath.AbsF(getVelocityY)\nEnd Sub\n\nOverride Sub Render(aCvs As B4XCanvas)\n    ' Draws the ball as a filled circle.\n    If getVisible = False Then Return\n    aCvs.DrawCircle(CenterX, CenterY, getRadius, getColor, True, 0)\nEnd Sub\n\nEnd Class\n",
      "entities/Brick.bx": "Class Brick Extends GameEntity Final\n\nProperty Points As Int = 10\nProperty Broken As Boolean = False\n\nConstructor(aX As Float, aY As Float, aWidth As Float, aHeight As Float, aColor As Int, aPoints As Int)\n    ' Brick is an entity with a score value and a broken state.\n    Super.Initialize(aX, aY, aWidth, aHeight, aColor)\n    Points = aPoints\n    Broken = False\nEnd Constructor\n\nPublic Sub Hit As Int\n    ' Breaks the brick once and returns the gained score.\n    If Broken Then Return 0\n    Broken = True\n    Visible = False\n    Return Points\nEnd Sub\n\nOverride Sub Render(aCvs As B4XCanvas)\n    ' Draws a brick with a thin white border.\n    If Broken Then Return\n    aCvs.DrawRect(EntityRect, getColor, True, 0)\n    aCvs.DrawRect(EntityRect, 0xFFFFFFFF, False, 1dip)\nEnd Sub\n\nEnd Class\n",
      "entities/GameEntity.bx": "Class GameEntity Abstract Implements IRenderable\n\nProperty X As Float = 0\nProperty Y As Float = 0\nProperty Width As Float = 10\nProperty Height As Float = 10\nProperty Color As Int = 0\nProperty Visible As Boolean = True\n\nConstructor(aX As Float, aY As Float, aWidth As Float, aHeight As Float, aColor As Int)\n    ' Shared entity setup: B4X++ property assignment calls the generated setters.\n    X = aX\n    Y = aY\n    Width = aWidth\n    Height = aHeight\n    Color = aColor\n    Visible = True\nEnd Constructor\n\nPublic Sub Left As Float\n    ' Left edge of the entity rectangle.\n    Return getX\nEnd Sub\n\nPublic Sub Top As Float\n    ' Top edge of the entity rectangle.\n    Return getY\nEnd Sub\n\nPublic Sub Right As Float\n    ' Right edge of the entity rectangle.\n    Return getX + getWidth\nEnd Sub\n\nPublic Sub Bottom As Float\n    ' Bottom edge of the entity rectangle.\n    Return getY + getHeight\nEnd Sub\n\nPublic Sub CenterX As Float\n    ' Horizontal center used by the ball and paddle logic.\n    Return BreakoutMath.CenterOf(getX, getWidth)\nEnd Sub\n\nPublic Sub CenterY As Float\n    ' Vertical center used by the ball rendering.\n    Return BreakoutMath.CenterOf(getY, getHeight)\nEnd Sub\n\nPublic Sub SetPosition(aNewX As Float, aNewY As Float)\n    ' Moves the entity without changing its size.\n    X = aNewX\n    Y = aNewY\nEnd Sub\n\nPublic Sub CollidesWithBox(aOtherLeft As Float, aOtherTop As Float, aOtherRight As Float, aOtherBottom As Float) As Boolean\n    ' Rectangle collision helper. Safer than Intersects(GameEntity) after B4X++ flattening.\n    Return BreakoutMath.Overlaps(Left, Top, Right, Bottom, aOtherLeft, aOtherTop, aOtherRight, aOtherBottom)\nEnd Sub\n\nProtected Sub EntityRect As B4XRect\n    ' Reusable rectangle for B4XCanvas drawing.\n    Dim entityArea As B4XRect\n    entityArea.Initialize(Left, Top, Right, Bottom)\n    Return entityArea\nEnd Sub\n\nVirtual Sub Render(aCvs As B4XCanvas)\n    ' Default renderer for rectangular entities.\n    If getVisible = False Then Return\n    aCvs.DrawRect(EntityRect, getColor, True, 0)\nEnd Sub\n\nEnd Class\n",
      "entities/Paddle.bx": "Class Paddle Extends GameEntity Final\n\nProperty Speed As Float = 720\n\nConstructor(aX As Float, aY As Float, aWidth As Float, aHeight As Float, aColor As Int)\n    ' Paddle is a specialized rectangle controlled by the mouse.\n    Super.Initialize(aX, aY, aWidth, aHeight, aColor)\n    Speed = 720\nEnd Constructor\n\nPublic Sub MoveCenter(aTargetCenterX As Float, aBoundsWidth As Float)\n    ' Keeps the paddle centered under the mouse while staying inside the arena.\n    Dim newLeft As Float = aTargetCenterX - getWidth / 2\n    newLeft = BreakoutMath.ClampF(newLeft, 0, aBoundsWidth - getWidth)\n    SetPosition(newLeft, getY)\nEnd Sub\n\nPublic Sub Nudge(aDirection As Int, aDeltaSeconds As Float, aBoundsWidth As Float)\n    ' Optional keyboard-style movement helper.\n    MoveCenter(CenterX + aDirection * getSpeed * aDeltaSeconds, aBoundsWidth)\nEnd Sub\n\nOverride Sub Render(aCvs As B4XCanvas)\n    ' Draws the paddle.\n    If getVisible = False Then Return\n    aCvs.DrawRect(EntityRect, getColor, True, 0)\nEnd Sub\n\nEnd Class\n",
      "services/BreakoutGame.bx": "Class BreakoutGame Final\n\nProperty GameWidth As Float = 640\nProperty GameHeight As Float = 480\n\nSub Class_Globals\n    Private xui As XUI\n    Private mRoot As B4XView\n    Private mSurface As B4XView\n    Private mCanvas As B4XCanvas\n    Private mPaddle As Paddle\n    Private mBall As Ball\n    Private mGrid As BrickGrid\n    Private mHud As ScoreBoard\n    Private mLastTicks As Long\n    Private mReady As Boolean\nEnd Sub\n\nPublic Sub Initialize(aRoot As B4XView)\n    ' Creates the drawing surface and all game objects.\n    mRoot = aRoot\n    GameWidth = 640\n    GameHeight = 480\n\n    mSurface = xui.CreatePanel(\"GameSurface\")\n    mRoot.AddView(mSurface, 0, 0, getGameWidth, getGameHeight)\n    mCanvas.Initialize(mSurface)\n\n    mPaddle.Initialize(270dip, 420dip, 100dip, 14dip, xui.Color_RGB(250, 250, 250))\n    mBall.Initialize(320dip, 400dip, 7dip, xui.Color_RGB(255, 230, 120))\n    mGrid.Initialize(getGameWidth)\n    mHud.Initialize\n\n    mLastTicks = DateTime.Now\n    mReady = True\n    DrawFrame\nEnd Sub\n\nPublic Sub StartPlay\n    ' Starts or restarts the game after a click.\n    If mReady = False Then Return\n    If mHud.getLives <= 0 Or mGrid.getRemaining <= 0 Then ResetGame\n    mHud.setRunning(True)\n    mHud.setMessage(\"\")\n    mLastTicks = DateTime.Now\nEnd Sub\n\nPublic Sub ResetGame\n    ' Rebuilds bricks and resets the paddle / ball positions.\n    mHud.Initialize\n    mGrid.BuildLevel(getGameWidth)\n    mPaddle.MoveCenter(getGameWidth / 2, getGameWidth)\n    mBall.ResetAt(mPaddle.CenterX, mPaddle.Top - 10dip)\n    DrawFrame\nEnd Sub\n\nPublic Sub UpdateFrame\n    ' Main frame update called by the B4J Timer.\n    If mReady = False Then Return\n    Dim nowTicks As Long = DateTime.Now\n    Dim deltaSeconds As Float = (nowTicks - mLastTicks) / 1000\n    mLastTicks = nowTicks\n    If deltaSeconds > 0.05 Then deltaSeconds = 0.05\n\n    If mHud.getRunning Then\n        mBall.Advance(deltaSeconds, getGameWidth)\n        CheckPaddleCollision\n        Dim points As Int = mGrid.CheckBallCollision(mBall)\n        If points > 0 Then mHud.AddScore(points)\n        If mGrid.getRemaining <= 0 Then mHud.WinGame\n        If mBall.Top > getGameHeight Then\n            Dim finished As Boolean = mHud.LoseLife\n            If finished = False Then mBall.ResetAt(mPaddle.CenterX, mPaddle.Top - 10dip)\n        End If\n    Else\n        mBall.ResetAt(mPaddle.CenterX, mPaddle.Top - 10dip)\n    End If\n\n    DrawFrame\nEnd Sub\n\nPrivate Sub CheckPaddleCollision\n    ' Handles ball / paddle collision without typed parent casts.\n    If mBall.getVelocityY > 0 And mBall.CollidesWithBox(mPaddle.Left, mPaddle.Top, mPaddle.Right, mPaddle.Bottom) Then\n        mBall.SetPosition(mBall.getX, mPaddle.Top - mBall.getHeight - 1dip)\n        mBall.AimFromPaddle(mPaddle)\n    End If\nEnd Sub\n\nPublic Sub MovePaddle(aTargetX As Float)\n    ' Mouse movement entry point.\n    If mReady = False Then Return\n    mPaddle.MoveCenter(aTargetX, getGameWidth)\n    If mHud.getRunning = False Then mBall.ResetAt(mPaddle.CenterX, mPaddle.Top - 10dip)\n    DrawFrame\nEnd Sub\n\nPublic Sub DrawFrame\n    ' Clears the canvas and redraws the whole scene.\n    If mReady = False Then Return\n    mCanvas.ClearRect(mCanvas.TargetRect)\n    mCanvas.DrawRect(mCanvas.TargetRect, xui.Color_RGB(22, 28, 38), True, 0)\n    mGrid.RenderAll(mCanvas)\n    mPaddle.Render(mCanvas)\n    mBall.Render(mCanvas)\n    mHud.Render(mCanvas, getGameWidth)\n    mCanvas.Invalidate\nEnd Sub\n\nPrivate Sub GameSurface_MouseMoved(aEventData As MouseEvent)\n    ' B4J event: move the paddle with the mouse.\n    MovePaddle(aEventData.X)\nEnd Sub\n\nPrivate Sub GameSurface_MousePressed(aEventData As MouseEvent)\n    ' B4J event: click to launch or restart.\n    StartPlay\nEnd Sub\n\nEnd Class\n",
      "services/BrickGrid.bx": "Class BrickGrid Final\n\nProperty Remaining As Int = 0\n\nSub Class_Globals\n    Private xui As XUI\n    Private mBricks As List\nEnd Sub\n\nPublic Sub Initialize(aGameWidth As Float)\n    ' Prepares the brick list and builds the first level.\n    mBricks.Initialize\n    BuildLevel(aGameWidth)\nEnd Sub\n\nPublic Sub BuildLevel(aGameWidth As Float)\n    ' Creates a simple colored grid of bricks.\n    mBricks.Clear\n    Dim columns As Int = 8\n    Dim rows As Int = 5\n    Dim gap As Float = 5dip\n    Dim brickWidth As Float = (aGameWidth - gap * (columns + 1)) / columns\n    Dim brickHeight As Float = 22dip\n\n    For rowIndex = 0 To rows - 1\n        For columnIndex = 0 To columns - 1\n            Dim brickX As Float = gap + columnIndex * (brickWidth + gap)\n            Dim brickY As Float = 54dip + rowIndex * (brickHeight + gap)\n            Dim brickColor As Int\n            If rowIndex Mod 3 = 0 Then\n                brickColor = xui.Color_RGB(244, 112, 94)\n            Else If rowIndex Mod 3 = 1 Then\n                brickColor = xui.Color_RGB(255, 198, 85)\n            Else\n                brickColor = xui.Color_RGB(91, 192, 235)\n            End If\n            Dim brickItem As Brick\n            brickItem.Initialize(brickX, brickY, brickWidth, brickHeight, brickColor, 10 + rowIndex * 5)\n            mBricks.Add(brickItem)\n        Next\n    Next\n    Remaining = mBricks.Size\nEnd Sub\n\nPublic Sub RenderAll(aCvs As B4XCanvas)\n    ' Draws every brick. Broken bricks skip their own rendering.\n    For brickIndex = 0 To mBricks.Size - 1\n        Dim brickItem As Brick\n        brickItem = mBricks.Get(brickIndex)\n        brickItem.Render(aCvs)\n    Next\nEnd Sub\n\nPublic Sub CheckBallCollision(aGameBall As Ball) As Int\n    ' Returns score gained when the ball hits a brick.\n    For brickIndex = 0 To mBricks.Size - 1\n        Dim brickItem As Brick\n        brickItem = mBricks.Get(brickIndex)\n        If brickItem.getBroken = False And aGameBall.CollidesWithBox(brickItem.Left, brickItem.Top, brickItem.Right, brickItem.Bottom) Then\n            aGameBall.BounceY\n            Dim gainedPoints As Int = brickItem.Hit\n            If gainedPoints > 0 Then Remaining = getRemaining - 1\n            Return gainedPoints\n        End If\n    Next\n    Return 0\nEnd Sub\n\nEnd Class\n",
      "services/ScoreBoard.bx": "Class ScoreBoard Final\n\nProperty Score As Int = 0\nProperty Lives As Int = 3\nProperty Running As Boolean = False\nProperty Message As String = \"Move the mouse to control the paddle. Click to launch.\"\n\nSub Class_Globals\n    Private xui As XUI\nEnd Sub\n\nPublic Sub Initialize\n    ' Resets HUD state for a new game.\n    Score = 0\n    Lives = 3\n    Running = False\n    Message = \"Move the mouse to control the paddle. Click to launch.\"\nEnd Sub\n\nPublic Sub AddScore(aPoints As Int)\n    ' Adds brick score to the total.\n    Score = getScore + aPoints\nEnd Sub\n\nPublic Sub LoseLife As Boolean\n    ' Stops the ball and returns True when the game is over.\n    Lives = getLives - 1\n    If getLives <= 0 Then\n        Running = False\n        Message = \"Game over. Click to restart.\"\n        Return True\n    End If\n    Running = False\n    Message = \"Life lost. Click to relaunch.\"\n    Return False\nEnd Sub\n\nPublic Sub WinGame\n    ' Stops the level and shows the victory message.\n    Running = False\n    Message = \"Victory! All bricks cleared. Click to restart.\"\nEnd Sub\n\nPublic Sub Render(aCvs As B4XCanvas, aGameWidth As Float)\n    ' Draws score, lives and status message.\n    aCvs.DrawText(\"Score: \" & getScore, 12dip, 25dip, xui.CreateDefaultBoldFont(16), xui.Color_White, \"LEFT\")\n    aCvs.DrawText(\"Lives: \" & getLives, aGameWidth - 12dip, 25dip, xui.CreateDefaultBoldFont(16), xui.Color_White, \"RIGHT\")\n    If getMessage.Length > 0 Then\n        aCvs.DrawText(getMessage, aGameWidth / 2, 455dip, xui.CreateDefaultFont(14), xui.Color_White, \"CENTER\")\n    End If\nEnd Sub\n\nEnd Class\n"
    }
  };
}

function getExamplesReadme() {
  return [
    '# B4X++ Examples',
    '',
    'This folder contains five ready-to-copy B4X++ examples:',
    '',
    '- `basic-animal`: a simple and familiar OOP example with `Animal`, `Dog`, `Cat` and `Bird`.',
    '- `language-showcase`: a broader sample that demonstrates most B4X++ directives and keywords.',
    '- `closure-console`: a B4J Non-UI example showing `Closure` / anonymous `Sub`, captured local variables and passing closures to another class.',
    '- `oop-dungeon-arena`: a small turn-based game using heavier OOP patterns: interfaces, inheritance, abstract classes, overrides, `Super`, custom property accessors, `Poly` dispatch and a `StaticCode` helper module.',
    '- `xui-breakout`: a B4J UI + XUI Breakout game using `B4XCanvas`, a `Timer`, mouse input, entities, services, collisions and rendering.',
    '',
    'Open one example folder in VS Code, then run:',
    '',
    '1. `B4X++: Sync #Project` to generate a B4J/B4A/B4i test project.',
    '2. `B4X++: Transpile Workspace` to inspect the generated B4X modules.',
    '3. `B4X++: Build .b4xlib` to package reusable B4X components.',
    ''
  ].join('\n');
}


function platformKeyFromIdePlatform(platform) {
  const p = String(platform || '').toLowerCase();
  if (p.includes('b4a')) return 'b4a';
  if (p.includes('b4i')) return 'b4i';
  if (p.includes('b4j')) return 'b4j';
  return 'b4j';
}

function getLibraryDirsForPlatformKey(config, platformKey) {
  const c = config || {};
  const arr = (camelKey, dotKey) => {
    if (Array.isArray(c[camelKey])) return c[camelKey];
    if (Array.isArray(c[dotKey])) return c[dotKey];
    return [];
  };
  const dirs = [];
  if (platformKey === 'b4j') dirs.push(...arr('b4jInternalLibraryDirs', 'b4j.internalLibraryDirs'), ...arr('b4jAdditionalLibraryDirs', 'b4j.additionalLibraryDirs'));
  else if (platformKey === 'b4a') dirs.push(...arr('b4aInternalLibraryDirs', 'b4a.internalLibraryDirs'), ...arr('b4aAdditionalLibraryDirs', 'b4a.additionalLibraryDirs'));
  else if (platformKey === 'b4i') dirs.push(...arr('b4iInternalLibraryDirs', 'b4i.internalLibraryDirs'), ...arr('b4iAdditionalLibraryDirs', 'b4i.additionalLibraryDirs'));
  dirs.push(...arr('b4xppBundledLibraryDirs', 'b4xpp.bundledLibraryDirs'), ...arr('b4xpplibBundledLibraryDirs', 'b4xpplib.bundledLibraryDirs'));
  if (!dirs.length || !(c.b4xppBundledLibraryDirs || c.b4xpplibBundledLibraryDirs)) dirs.push(...getBundledB4XPPLibDirs());
  return uniqueStrings(normalizeDirectoryList(dirs));
}

function getB4XPPLibNameSetForPlatform(platform, config) {
  const names = new Set();
  const dirs = getLibraryDirsForPlatformKey(config || {}, platformKeyFromIdePlatform(platform));
  for (const dir of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const file of entries) {
      if (!/\.b4xpplib$/i.test(file)) continue;
      const full = path.join(dir, file);
      let name = path.basename(file, '.b4xpplib');
      try {
        const lib = parseB4XPPLibFile(full);
        if (lib && lib.name) name = lib.name;
      } catch {}
      if (name) {
        names.add(String(name).toLowerCase());
        names.add(String(path.basename(file, '.b4xpplib')).toLowerCase());
      }
    }
  }
  return names;
}

function filterNativeProjectLibraries(platform, config, libraries) {
  const b4xppNames = getB4XPPLibNameSetForPlatform(platform, config || {});
  if (!b4xppNames.size) return uniqueStrings(libraries || []);
  return uniqueStrings(libraries || []).filter(lib => !b4xppNames.has(String(lib || '').toLowerCase()));
}

function getProjectLibraries(platform, config, baseLibraries) {
  let platformSpecific = [];
  if (platform === 'b4a') platformSpecific = Array.isArray(config.projectB4ADependsOn) ? config.projectB4ADependsOn : [];
  else if (platform === 'b4j-ui' || platform === 'b4j-nonui') platformSpecific = Array.isArray(config.projectB4JDependsOn) ? config.projectB4JDependsOn : [];
  else if (platform === 'b4i') platformSpecific = Array.isArray(config.projectB4iDependsOn) ? config.projectB4iDependsOn : [];

  let common = Array.isArray(config.projectDependsOn) ? config.projectDependsOn : [];
  if ((platform === 'b4j-ui' || platform === 'b4j-nonui') && platformSpecific.some(v => /^jxui$/i.test(v))) {
    common = common.filter(v => !/^xui$/i.test(v));
  }
  if (platform === 'b4i' && platformSpecific.some(v => /^ixui$/i.test(v))) {
    common = common.filter(v => !/^xui$/i.test(v));
  }
  return filterNativeProjectLibraries(platform, config, [...(baseLibraries || []), ...common, ...platformSpecific]);
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
      libraries: getProjectLibraries(platform, config, ['jcore']),
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
      libraries: getProjectLibraries(platform, config, ['jcore', 'jfx']),
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
      libraries: getProjectLibraries(platform, config, ['core']),
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
      libraries: getProjectLibraries(platform, config, ['icore']),
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
  const type = (kind === 'class' || kind === 'closure-runtime') ? 'Class' : 'StaticCode';
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

function makeB4AProject({ projectName, packageName, libraries, modules, mobileMainName }) {
  const design = makeDesignText({
    packageName,
    libraries: libraries || ['core'],
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

function makeB4IProject({ projectName, packageName, libraries, modules, mobileMainName }) {
  const design = makeDesignText({
    packageName,
    libraries: libraries || ['icore'],
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

function diagnosticSourceLineText(filePath, lineIndex) {
  const text = diagnosticSourceText(filePath);
  if (text) {
    const lines = normalizeNewlines(text).split('\n');
    return lines[lineIndex] || '';
  }
  return '';
}

function diagnosticSourceText(filePath) {
  try {
    const editor = vscode.window && vscode.window.activeTextEditor;
    if (editor && editor.document && samePath(editor.document.uri.fsPath, filePath)) {
      return editor.document.getText();
    }
  } catch {}
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {}
  return '';
}

function isLineInsideAsyncSub(filePath, lineIndex) {
  const text = diagnosticSourceText(filePath);
  if (!text) return false;
  const lines = normalizeNewlines(text).split('\n');
  let current = null;
  for (let i = 0; i <= Math.min(lineIndex, lines.length - 1); i++) {
    const code = splitCodeAndCommentForNavigation(lines[i]).code;
    const sig = code.match(/^\s*((?:(?:Public|Private|Protected|Override|Virtual|Abstract|Final|Async)\s+)*)Sub\s+[A-Za-z_][A-Za-z0-9_]*\b/i);
    if (sig) {
      const tokens = (sig[1] || '').trim().split(/\s+/).filter(Boolean).map(t => t.toLowerCase());
      current = { async: tokens.includes('async') };
      continue;
    }
    if (/^\s*End\s+Sub\b/i.test(code)) current = null;
  }
  return !!(current && current.async);
}

function shouldPublishDiagnostic(diagnostic, filePath) {
  if (!diagnostic) return false;
  if (/Await can only be used inside an Async Sub/i.test(String(diagnostic.message || ''))) {
    const lineIndex = Math.max(0, (diagnostic.line || 1) - 1);
    const lineText = diagnosticSourceLineText(filePath, lineIndex);
    // The live validator can receive stale / remapped diagnostics while the user edits.
    // Never show the Async/Await diagnostic on native B4X "Wait For" lines.
    if (!/\bAwait\b/i.test(splitCodeAndCommentForNavigation(lineText).code || '')) return false;
    if (isLineInsideAsyncSub(filePath, lineIndex)) return false;
  }
  return true;
}

function publishDiagnostics(diagnosticsByUri) {
  for (const [uriString, diagnostics] of diagnosticsByUri.entries()) {
    const uri = vscode.Uri.parse(uriString);
    const vscodeDiagnostics = diagnostics.filter(d => shouldPublishDiagnostic(d, uri.fsPath)).map((d) => {
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
    ['Class', 'Start a B4X++ class.'],
    ['Extends', 'Extend another B4X++ class.'],
    ['Property', 'Generate field + getter/setter.'],
    ['Constructor', 'Declare a B4X++ constructor.'],
    ['End Class', 'End a B4X++ class.'],
    ['End Constructor', 'End a B4X++ constructor.'],
    ['Get', 'Declare a custom B4X++ property getter.'],
    ['Set', 'Declare a custom B4X++ property setter.'],
    ['Interface', 'Start a B4X++ interface.'],
    ['End Interface', 'End a B4X++ interface.'],
    ['StaticCode', 'Start a B4X++ static module.'],
    ['End StaticCode', 'End a B4X++ static module.'],
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
  const info = { file, lines, classes: [], interfaces: [], methods: [], closures: [] };
  let currentOwner = null;
  let currentMethod = null;
  const closureStack = [];

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

    if (/^#?End\s+Class\b/i.test(trimmed)) {
      closeMethod(i);
      closeOwner(i);
      continue;
    }
    if (/^#?End\s+Interface\b/i.test(trimmed)) {
      closeMethod(i);
      closeOwner(i);
      continue;
    }
    const navClosure = currentMethod ? parseNavigationClosureLiteral(raw, i, file) : null;
    if (navClosure) {
      navClosure.ownerMethod = currentMethod.name;
      closureStack.push(navClosure);
      info.closures.push(navClosure);
    }

    if (/^End\s+Sub\b/i.test(trimmed)) {
      if (closureStack.length) {
        const c = closureStack.pop();
        c.endLine = i;
        continue;
      }
      closeMethod(i);
      continue;
    }

    const interfaceMatch = raw.match(/^\s*#?Interface\s+([A-Za-z_][A-Za-z0-9_]*)/i);
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

    const classMatch = raw.match(/^\s*#?Class\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/i);
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

    const extendsLine = raw.match(/^\s*#?Extends\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    if (extendsLine && currentOwner && currentOwner.kind === 'class') {
      currentOwner.extendsName = extendsLine[1];
      currentOwner.extendsRange = makeWordRange(raw, i, extendsLine[1], extendsLine.index);
      continue;
    }

    const implementsLine = raw.match(/^\s*#?Implements\s+(.+)$/i);
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
  const m = raw.match(/^\s*((?:(?:Public|Private|Protected|Override|Virtual|Abstract|Final|Async)\s+)*)Sub\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(?:As\s+(.+?))?\s*$/i);
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
  const closure = findNavigationClosureAt(fileInfo, line);
  if (closure) {
    const declLine = fileInfo.lines[closure.startLine] || '';
    for (const p of closure.params || []) {
      variables.set(p.name.toLowerCase(), { name: p.name, file: fileInfo.file, line: closure.startLine, range: makeWordRange(declLine, closure.startLine, p.name, 0), type: p.type || '', polyType: null, assignedType: null });
    }
  }
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


function parseNavigationClosureLiteral(raw, lineIndex, file) {
  const code = splitCodeAndCommentForNavigation(raw).code;
  const declared = code.match(/^\s*(?:Dim|Private|Public|Protected)\s+([A-Za-z_][A-Za-z0-9_]*)\s+As\s+(?:Sub|Closure)\s*=\s*Sub\s*(?:\(([^)]*)\))?/i);
  const assigned = declared ? null : code.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*Sub\s*(?:\(([^)]*)\))?/i);
  const m = declared || assigned;
  if (!m) return null;
  return {
    kind: 'closure',
    name: m[1],
    file,
    line: lineIndex,
    startLine: lineIndex,
    endLine: lineIndex,
    range: makeWordRange(raw, lineIndex, m[1], 0),
    params: v3ParseParams(m[2] || ''),
    paramsRaw: m[2] || ''
  };
}

function findNavigationClosureAt(info, line) {
  if (!info || !info.closures) return null;
  let best = null;
  for (const closure of info.closures) {
    if (line >= closure.startLine && line <= closure.endLine) {
      if (!best || closure.startLine >= best.startLine) best = closure;
    }
  }
  return best;
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


async function buildNativeB4XWithRemapCommand(platformRequest = 'auto') {
  const folder = getWorkspaceFolder();
  if (!folder) {
    vscode.window.showErrorMessage('B4X++: open a VS Code project folder first.');
    return;
  }
  const root = folder.uri.fsPath;
  const config = getConfig();
  const prepared = await prepareNativeB4XProjectForBuild(root, config, platformRequest);
  if (!prepared) return;

  const { platform, projectFile, projectRoot, result } = prepared;
  const buildPlan = await createNativeB4XBuildPlan(platform, projectFile, projectRoot, config, root);
  if (!buildPlan) return;

  b4xppOutputChannel.clear();
  b4xppOutputChannel.appendLine(`B4X++: transpile + sync + ${platform.toUpperCase()} build`);
  b4xppOutputChannel.appendLine(`Project: ${projectFile}`);
  if (result) b4xppOutputChannel.appendLine(`Transpiler: ${result.errorCount || 0} error(s), ${result.warningCount || 0} warning(s).`);
  b4xppOutputChannel.appendLine('');
  b4xppOutputChannel.appendLine(buildPlan.displayCommand);
  b4xppOutputChannel.appendLine('');
  b4xppOutputChannel.show(true);

  runNativeB4XBuildProcess(root, buildPlan, platform);
}

// Kept as a compatibility shim for older keybindings / command ids.
async function buildB4JWithRemapCommand() {
  return buildNativeB4XWithRemapCommand('b4j');
}

async function prepareNativeB4XProjectForBuild(root, config, platformRequest) {
  if (!(await ensureSourceFolderOrOfferExample(root, config))) return null;

  const result = transpileWorkspace(root, config);
  publishDiagnostics(result.allDiagnostics);

  const requested = normalizeB4XPlatform(platformRequest);
  if (result.errorCount > 0) {
    const choice = await vscode.window.showWarningMessage(
      `B4X++: ${result.errorCount} transpilation error(s) detected. Build anyway?`,
      'Build anyway',
      'Cancel'
    );
    if (choice !== 'Build anyway') return null;
  }

  if (result.project) {
    const projectPlatform = normalizeProjectBuildPlatform(result.project.platform);
    if (requested !== 'auto' && projectPlatform !== requested) {
      const choice = await vscode.window.showWarningMessage(
        `B4X++: #Project targets ${projectPlatform.toUpperCase()}, but the requested build is ${requested.toUpperCase()}.`,
        `Build ${projectPlatform.toUpperCase()} #Project`,
        'Choose existing project',
        'Cancel'
      );
      if (choice === 'Cancel' || !choice) return null;
      if (choice === 'Choose existing project') return pickExistingNativeProject(root, requested);
    }

    const projectName = sanitizeProjectName(result.project.name) || sanitizeProjectName(path.basename(root)) || 'B4XPPDemo';
    const packageName = sanitizePackageName(result.project.packageName || config.packageName) || `b4xpp.${projectName.toLowerCase()}`;
    const projectRoot = resolveConfiguredIdeProjectDir(root, config, result.project.projectDir, projectName, result.project.platform);
    fs.mkdirSync(projectRoot, { recursive: true });

    const projectConfig = makeProjectConfigWithPackageNativeDeps(config, result.project, result);
    const project = writeIdeProject(projectRoot, result.project.platform, projectName, packageName, result.outputs, projectConfig);
    writeB4XPPMetadata(root, result, projectRoot);
    return { platform: projectPlatform, projectFile: project.filePath, projectRoot, result };
  }

  const platform = requested === 'auto' ? await askForNativePlatform() : requested;
  if (!platform) return null;
  const picked = await pickExistingNativeProject(root, platform);
  return picked;
}

async function askForNativePlatform() {
  const picked = await vscode.window.showQuickPick([
    { label: 'B4J', description: 'Build a .b4j project with B4JBuilder.exe', value: 'b4j' },
    { label: 'B4A', description: 'Build a .b4a project with B4ABuilder.exe', value: 'b4a' },
    { label: 'B4i', description: 'Run a custom B4i build command and remap the output', value: 'b4i' }
  ], { placeHolder: 'B4X++: choose the native B4X platform to build' });
  return picked && picked.value;
}

async function pickExistingNativeProject(root, platform) {
  const ext = platform === 'b4a' ? 'b4a' : platform === 'b4i' ? 'b4i' : 'b4j';
  const projectFiles = findFilesRecursive(root, new RegExp(`\\.${ext}$`, 'i'), ['Objects', '.git', 'node_modules']).slice(0, 100);
  if (projectFiles.length === 0) {
    vscode.window.showWarningMessage(`B4X++: no .${ext} file found under the workspace. Add a #Project directive and run Sync #Project, or create a B4X IDE project first.`);
    return null;
  }
  const picked = projectFiles.length === 1 ? projectFiles[0] : await pickFile(root, projectFiles, `B4X++: choose the .${ext} project to build`);
  if (!picked) return null;
  return { platform, projectFile: picked, projectRoot: path.dirname(picked), result: null };
}

async function createNativeB4XBuildPlan(platform, projectFile, projectRoot, config, workspaceRoot) {
  const customCommand = getCustomBuildCommandForPlatform(platform, config);
  if (customCommand && customCommand.trim()) {
    const command = expandBuildCommandPlaceholders(customCommand, projectFile, path.dirname(projectFile), workspaceRoot, config);
    return {
      mode: 'shell',
      command,
      cwd: path.dirname(projectFile),
      displayCommand: command
    };
  }

  const builder = resolveBuilderPathForPlatform(platform, config);
  if (!builder) {
    const settingKey = platform === 'b4a' ? 'b4xpp.b4a.builderPath' : platform === 'b4i' ? 'b4xpp.b4iBuildCommand' : 'b4xpp.b4j.builderPath';
    const message = platform === 'b4i'
      ? 'B4X++: no default B4i command-line builder is configured. Set b4xpp.b4iBuildCommand to your local / custom B4i build command, then run this command again.'
      : `B4X++: ${platform.toUpperCase()} builder not found. Configure ${settingKey}.`;
    const choice = await vscode.window.showWarningMessage(message, 'Open Settings', 'Cancel');
    if (choice === 'Open Settings') vscode.commands.executeCommand('workbench.action.openSettings', settingKey);
    return null;
  }

  const args = [`-Task=${config.buildTask || 'Build'}`];
  args.push(`-Project=${projectFile}`);
  if (config.buildUseBaseFolder !== false) args.push(`-BaseFolder=${path.dirname(projectFile)}`);
  if (config.buildConfiguration) args.push(`-Configuration=${config.buildConfiguration}`);
  if (config.buildShowWarnings !== false) args.push('-ShowWarnings=True');

  return {
    mode: 'spawn',
    executable: builder,
    args,
    cwd: path.dirname(projectFile),
    displayCommand: [quoteShellPath(builder), ...args.map(a => quoteBuilderArgForDisplay(a))].join(' ')
  };
}

function runNativeB4XBuildProcess(root, buildPlan, platform) {
  const started = Date.now();
  const chunks = [];
  const append = (text) => {
    if (!text) return;
    chunks.push(String(text));
    b4xppOutputChannel.append(String(text));
  };
  const finish = (exitCode, error) => {
    if (error && error.message) append(`\n${error.message}\n`);
    const output = chunks.join('');
    const map = loadB4XPPSourceMap(root);
    if (map) {
      const remapped = remapB4XLog(root, map, output);
      showRemapResults(root, remapped, `B4X++ remapped ${platform.toUpperCase()} build output`);
    } else {
      vscode.window.showWarningMessage('B4X++: build finished, but no .b4xpp/sourceMap.json was found for remapping.');
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(2);
    if (exitCode === 0 && !error) vscode.window.showInformationMessage(`B4X++: ${platform.toUpperCase()} build completed successfully in ${seconds}s.`);
    else vscode.window.showErrorMessage(`B4X++: ${platform.toUpperCase()} build failed${typeof exitCode === 'number' ? ` with exit code ${exitCode}` : ''}. See the B4X++ output panel.`);
  };

  if (buildPlan.mode === 'shell') {
    const child = childProcess.exec(buildPlan.command, { cwd: buildPlan.cwd, maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
      append(stdout || '');
      append(stderr || '');
      finish(error && typeof error.code === 'number' ? error.code : 0, error);
    });
    child.on('error', err => finish(null, err));
    return;
  }

  const child = childProcess.spawn(buildPlan.executable, buildPlan.args, { cwd: buildPlan.cwd, windowsHide: true });
  child.stdout.on('data', d => append(d.toString()));
  child.stderr.on('data', d => append(d.toString()));
  child.on('error', err => finish(null, err));
  child.on('close', code => finish(code, null));
}

function getCustomBuildCommandForPlatform(platform, config) {
  if (platform === 'b4a') return config.b4aBuildCommand || '';
  if (platform === 'b4i') return config.b4iBuildCommand || '';
  return config.b4jBuildCommand || '';
}

function resolveBuilderPathForPlatform(platform, config) {
  const explicit = platform === 'b4a' ? config.b4aBuilderPath : platform === 'b4i' ? config.b4iBuilderPath : config.b4jBuilderPath;
  if (explicit && fs.existsSync(stripWrappingQuotes(explicit))) return stripWrappingQuotes(explicit);
  const candidates = getDefaultBuilderCandidates(platform);
  return candidates.find(file => fs.existsSync(file)) || null;
}

function getDefaultBuilderCandidates(platform) {
  if (platform === 'b4j') {
    return [
      'C:\\Program Files\\Anywhere Software\\B4J\\B4JBuilder.exe',
      'C:\\Program Files (x86)\\Anywhere Software\\B4J\\B4JBuilder.exe'
    ];
  }
  if (platform === 'b4a') {
    return [
      'C:\\Program Files\\Anywhere Software\\B4A\\B4ABuilder.exe',
      'C:\\Program Files (x86)\\Anywhere Software\\B4A\\B4ABuilder.exe',
      'C:\\Program Files\\Anywhere Software\\Basic4android\\B4ABuilder.exe',
      'C:\\Program Files (x86)\\Anywhere Software\\Basic4android\\B4ABuilder.exe'
    ];
  }
  return [];
}

function expandBuildCommandPlaceholders(command, projectFile, projectDir, workspaceRoot, config) {
  return String(command || '')
    .replace(/\{project\}/g, quoteShellPath(projectFile))
    .replace(/\{workspace\}/g, quoteShellPath(workspaceRoot))
    .replace(/\{projectDir\}/g, quoteShellPath(projectDir))
    .replace(/\{configuration\}/g, quoteShellPath((config && config.buildConfiguration) || 'Default'))
    .replace(/\{task\}/g, quoteShellPath((config && config.buildTask) || 'Build'));
}

function normalizeB4XPlatform(platform) {
  const p = String(platform || 'auto').toLowerCase();
  if (p === 'b4a' || p === 'b4j' || p === 'b4i') return p;
  return 'auto';
}

function normalizeProjectBuildPlatform(platform) {
  const p = String(platform || '').toLowerCase();
  if (p.startsWith('b4a')) return 'b4a';
  if (p.startsWith('b4i')) return 'b4i';
  return 'b4j';
}

function stripWrappingQuotes(value) {
  return String(value || '').replace(/^"|"$/g, '');
}

function quoteBuilderArgForDisplay(arg) {
  const s = String(arg || '');
  const eq = s.indexOf('=');
  if (eq > 0) {
    const k = s.slice(0, eq + 1);
    const v = s.slice(eq + 1);
    return /\s/.test(v) ? `${k}${quoteShellPath(v)}` : s;
  }
  return /\s/.test(s) ? quoteShellPath(s) : s;
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
  if (typeof clearB4XLibraryIndexCache === 'function') clearB4XLibraryIndexCache();
  b4xppV315ExternalTypeCache = null;
  b4xppV315ExternalTypeCacheKey = '';
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



//────────────────────────────────────────────────────────────
// B4X++ v0.4.0 external library type index for completion / hover
//────────────────────────────────────────────────────────────
let b4xppV315ExternalTypeCacheKey = '';
let b4xppV315ExternalTypeCache = null;

function v315DirectiveStateForDocument(document, root, config) {
  const folder = { uri: { fsPath: root } };
  let base = defaultProjectDirectiveState();
  try { base = readMainBxProjectDirectives(folder, config || getConfig()); } catch {}
  if (document && document.languageId === 'b4xpp') {
    const text = document.getText();
    const docState = v315ReadDirectiveStateFromText(text);
    if (v315DirectiveStateHasProjectData(docState)) {
      docState.mainBxPath = path.relative(root, document.uri.fsPath).replace(/\\/g, '/');
      return docState;
    }
  }
  return base;
}

function v315ReadDirectiveStateFromText(text) {
  const directives = defaultProjectDirectiveState();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^#Project\s+(\S+)(?:\s+(.+))?$/i))) { directives.projectPlatform = m[1].trim(); directives.projectName = (m[2] || '').trim(); }
    else if ((m = line.match(/^#Package\s+(.+)$/i))) directives.packageName = m[1].trim();
    else if ((m = line.match(/^#ProjectDir\s+(.+)$/i))) directives.projectDir = unquoteDirectiveValue(m[1]);
    else if ((m = line.match(/^#MainModule\s+(.+)$/i))) directives.mainModule = m[1].trim();
    else if ((m = line.match(/^#ProjectDependsOn\s+(.+)$/i))) directives.projectDependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#ProjectB4JDependsOn\s+(.+)$/i))) directives.projectB4JDependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#ProjectB4ADependsOn\s+(.+)$/i))) directives.projectB4ADependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#ProjectB4iDependsOn\s+(.+)$/i))) directives.projectB4iDependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#B4XLib\s+(.+)$/i))) directives.b4xLib = unquoteDirectiveValue(m[1]);
    else if ((m = line.match(/^#B4XLibVersion\s+(.+)$/i))) directives.b4xLibVersion = m[1].trim();
    else if ((m = line.match(/^#B4XLibAuthor\s+(.+)$/i))) directives.b4xLibAuthor = unquoteDirectiveValue(m[1]);
    else if ((m = line.match(/^#B4XLibDir\s+(.+)$/i))) directives.b4xLibDir = unquoteDirectiveValue(m[1]);
    else if ((m = line.match(/^#B4XLibSupportedPlatforms\s+(.+)$/i))) directives.b4xLibSupportedPlatforms = splitDirectiveList(m[1]);
    else if ((m = line.match(/^#B4XLibDependsOn\s+(.+)$/i))) directives.b4xLibDependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#B4XLibB4JDependsOn\s+(.+)$/i))) directives.b4xLibB4JDependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#B4XLibB4ADependsOn\s+(.+)$/i))) directives.b4xLibB4ADependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#B4XLibB4iDependsOn\s+(.+)$/i))) directives.b4xLibB4iDependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#B4XPPLib\s+(.+)$/i))) directives.b4xppLib = unquoteDirectiveValue(m[1]);
    else if ((m = line.match(/^#B4XPPLibVersion\s+(.+)$/i))) directives.b4xppLibVersion = m[1].trim();
    else if ((m = line.match(/^#B4XPPLibAuthor\s+(.+)$/i))) directives.b4xppLibAuthor = unquoteDirectiveValue(m[1]);
    else if ((m = line.match(/^#B4XPPLibDir\s+(.+)$/i))) directives.b4xppLibDir = unquoteDirectiveValue(m[1]);
    else if ((m = line.match(/^#B4XPPLibSupportedPlatforms\s+(.+)$/i))) directives.b4xppLibSupportedPlatforms = splitDirectiveList(m[1]);
    else if ((m = line.match(/^#B4XPPLibDependsOn\s+(.+)$/i))) directives.b4xppLibDependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#B4XPPLibB4JDependsOn\s+(.+)$/i))) directives.b4xppLibB4JDependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#B4XPPLibB4ADependsOn\s+(.+)$/i))) directives.b4xppLibB4ADependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#B4XPPLibB4iDependsOn\s+(.+)$/i))) directives.b4xppLibB4iDependsOn.push(...splitDirectiveList(m[1]));
    else if ((m = line.match(/^#DependsOn\s+(.+)$/i))) { directives.dependsOn.push(...splitDirectiveList(m[1])); directives.projectDependsOn.push(...splitDirectiveList(m[1])); }
    else if ((m = line.match(/^#B4JDependsOn\s+(.+)$/i))) { directives.b4jDependsOn.push(...splitDirectiveList(m[1])); directives.projectB4JDependsOn.push(...splitDirectiveList(m[1])); }
    else if ((m = line.match(/^#B4ADependsOn\s+(.+)$/i))) { directives.b4aDependsOn.push(...splitDirectiveList(m[1])); directives.projectB4ADependsOn.push(...splitDirectiveList(m[1])); }
    else if ((m = line.match(/^#B4iDependsOn\s+(.+)$/i))) { directives.b4iDependsOn.push(...splitDirectiveList(m[1])); directives.projectB4iDependsOn.push(...splitDirectiveList(m[1])); }
  }
  for (const key of ['projectDependsOn','projectB4JDependsOn','projectB4ADependsOn','projectB4iDependsOn','b4xLibDependsOn','b4xLibB4JDependsOn','b4xLibB4ADependsOn','b4xLibB4iDependsOn','b4xppLibDependsOn','b4xppLibB4JDependsOn','b4xppLibB4ADependsOn','b4xppLibB4iDependsOn','dependsOn','b4jDependsOn','b4aDependsOn','b4iDependsOn']) directives[key] = uniqueStrings(directives[key]);
  directives.b4xLibSupportedPlatforms = uniqueStrings((directives.b4xLibSupportedPlatforms || []).map(normalizePlatformLabel).filter(Boolean));
  directives.b4xppLibSupportedPlatforms = uniqueStrings((directives.b4xppLibSupportedPlatforms || []).map(normalizePlatformLabel).filter(Boolean));
  return directives;
}

function v315DirectiveStateHasProjectData(d) {
  return !!(d && (d.projectPlatform || d.projectName || d.b4xLib || d.b4xppLib || d.projectDependsOn.length || d.projectB4JDependsOn.length || d.projectB4ADependsOn.length || d.projectB4iDependsOn.length || d.b4xLibDependsOn.length || d.b4xLibB4JDependsOn.length || d.b4xLibB4ADependsOn.length || d.b4xLibB4iDependsOn.length || d.b4xppLibDependsOn.length || d.b4xppLibB4JDependsOn.length || d.b4xppLibB4ADependsOn.length || d.b4xppLibB4iDependsOn.length));
}

function v315DependencyMode(d) {
  const hasProject = !!(d && (d.projectPlatform || d.projectName || (d.projectDependsOn || []).length || (d.projectB4JDependsOn || []).length || (d.projectB4ADependsOn || []).length || (d.projectB4iDependsOn || []).length));
  return hasProject ? 'project' : 'b4xlib';
}

function v315FallbackPlatform(config) {
  const p = String((config && config.platform) || 'auto').toLowerCase();
  if (p.includes('b4a')) return 'b4a';
  if (p.includes('b4i')) return 'b4i';
  return 'b4j';
}

function v315PlatformFromProjectDirective(value) {
  const v = String(value || '').toLowerCase();
  if (v.includes('b4a')) return 'b4a';
  if (v.includes('b4i')) return 'b4i';
  if (v.includes('b4j')) return 'b4j';
  return '';
}

function v315ActivePlatformsForExternalTypes(d, config) {
  const mode = v315DependencyMode(d);
  if (mode === 'project') {
    const direct = v315PlatformFromProjectDirective(d.projectPlatform);
    if (direct) return [direct];
    const out = [];
    if ((d.projectB4JDependsOn || []).length) out.push('b4j');
    if ((d.projectB4ADependsOn || []).length) out.push('b4a');
    if ((d.projectB4iDependsOn || []).length) out.push('b4i');
    return out.length ? uniqueStrings(out) : [v315FallbackPlatform(config)];
  }
  const supported = uniqueStrings([
    ...((d.b4xLibSupportedPlatforms || []).map(v => normalizePlatformLabel(v).toLowerCase()).filter(Boolean)),
    ...((d.b4xppLibSupportedPlatforms || []).map(v => normalizePlatformLabel(v).toLowerCase()).filter(Boolean))
  ]);
  if (supported.length) return supported;
  const out = [];
  if ((d.b4xLibB4JDependsOn || []).length || (d.b4xppLibB4JDependsOn || []).length) out.push('b4j');
  if ((d.b4xLibB4ADependsOn || []).length || (d.b4xppLibB4ADependsOn || []).length) out.push('b4a');
  if ((d.b4xLibB4iDependsOn || []).length || (d.b4xppLibB4iDependsOn || []).length) out.push('b4i');
  return out.length ? uniqueStrings(out) : [v315FallbackPlatform(config)];
}

function v315DependencyNamesForExternalTypes(d, platforms) {
  const mode = v315DependencyMode(d);
  const deps = [];
  if (mode === 'project') {
    deps.push(...(d.projectDependsOn || []));
    if (platforms.includes('b4j')) deps.push(...(d.projectB4JDependsOn || []));
    if (platforms.includes('b4a')) deps.push(...(d.projectB4ADependsOn || []));
    if (platforms.includes('b4i')) deps.push(...(d.projectB4iDependsOn || []));
  } else {
    deps.push(...(d.b4xLibDependsOn || []), ...(d.b4xppLibDependsOn || []));
    if (platforms.includes('b4j')) deps.push(...(d.b4xLibB4JDependsOn || []), ...(d.b4xppLibB4JDependsOn || []));
    if (platforms.includes('b4a')) deps.push(...(d.b4xLibB4ADependsOn || []), ...(d.b4xppLibB4ADependsOn || []));
    if (platforms.includes('b4i')) deps.push(...(d.b4xLibB4iDependsOn || []), ...(d.b4xppLibB4iDependsOn || []));
  }
  return uniqueStrings(deps).map(v => String(v).trim()).filter(Boolean);
}

function v315LibraryDirsForPlatforms(config, platforms) {
  const dirs = [];
  if (platforms.includes('b4j')) dirs.push(...(config.b4jInternalLibraryDirs || []), ...(config.b4jAdditionalLibraryDirs || []));
  if (platforms.includes('b4a')) dirs.push(...(config.b4aInternalLibraryDirs || []), ...(config.b4aAdditionalLibraryDirs || []));
  if (platforms.includes('b4i')) dirs.push(...(config.b4iInternalLibraryDirs || []), ...(config.b4iAdditionalLibraryDirs || []));
  dirs.push(...(config.b4xppBundledLibraryDirs || []), ...(config.b4xpplibBundledLibraryDirs || []));
  return uniqueStrings(normalizeDirectoryList(dirs));
}

function v315ExternalLibraryTypesForDocument(document) {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri) || getWorkspaceFolder();
  const root = folder ? folder.uri.fsPath : path.dirname(document.uri.fsPath);
  return v315ExternalLibraryTypesForRoot(root, getConfig(), document);
}

function v315ExternalLibraryTypesForRoot(root, config, activeDocument) {
  const d = v315DirectiveStateForDocument(activeDocument, root, config);
  const platforms = v315ActivePlatformsForExternalTypes(d, config);
  const deps = v315DependencyNamesForExternalTypes(d, platforms);
  const dirs = v315LibraryDirsForPlatforms(config, platforms);
  const key = [root, platforms.slice().sort().join('+'), deps.map(x => x.toLowerCase()).sort().join(','), v315ExternalDirSignature(dirs)].join('::');
  if (b4xppV315ExternalTypeCache && b4xppV315ExternalTypeCacheKey === key) return b4xppV315ExternalTypeCache;
  const depSet = new Set(deps.map(x => String(x).toLowerCase()));
  const hasExplicitDeps = depSet.size > 0;
  const types = new Map();
  const libraries = new Map();
  for (const dir of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const file of entries) {
      if (!/\.(xml|b4xlib|b4xpplib)$/i.test(file)) continue;
      const full = path.join(dir, file);
      let lib = null;
      try {
        lib = /\.xml$/i.test(file) ? parseB4XLibraryXml(full) : (/\.b4xpplib$/i.test(file) ? parseB4XPPLibFile(full) : parseB4XLibFile(full));
      } catch { continue; }
      if (!lib || !lib.name) continue;
      const libKeys = new Set([lib.name, path.basename(full, path.extname(full))].map(x => String(x || '').toLowerCase()));
      if (hasExplicitDeps && !Array.from(libKeys).some(k => depSet.has(k))) continue;
      libraries.set(String(lib.name).toLowerCase(), { ...lib, path: full });
      for (const cls of lib.classes || []) v315AddExternalType(types, cls, lib, full);
      for (const typ of lib.types || []) v315AddExternalType(types, typ, lib, full);
    }
  }
  const out = { types, libraries, platforms, deps, mode: v315DependencyMode(d) };
  b4xppV315ExternalTypeCacheKey = key;
  b4xppV315ExternalTypeCache = out;
  return out;
}

function v315ExternalDirSignature(dirs) {
  const parts = [];
  for (const dir of dirs || []) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const file of entries) {
      if (!/\.(xml|b4xlib|b4xpplib)$/i.test(file)) continue;
      const full = path.join(dir, file);
      try { const st = fs.statSync(full); parts.push(`${full}:${st.mtimeMs}:${st.size}`); } catch {}
    }
  }
  return parts.sort().join('|');
}

function v315AddExternalType(types, rawType, lib, libraryPath) {
  const name = rawType.shortName || rawType.name;
  if (!name) return;
  const methods = (rawType.methods || []).map(m => ({
    ...m,
    kind: 'method',
    visibility: m.visibility || 'public',
    params: (m.params || []).map((p, i) => ({ name: p.name || `Arg${i + 1}`, type: p.type || 'Object' })),
    paramsRaw: (m.paramsRaw || (m.params || []).map((p, i) => `${p.name || 'Arg' + (i + 1)} As ${p.type || 'Object'}`).join(', ')),
    ownerName: name,
    libraryName: lib.name,
    libraryPath
  }));
  const properties = (rawType.properties || []).map(p => ({ ...p, kind: 'property', visibility: p.visibility || 'public', ownerName: name, libraryName: lib.name, libraryPath }));
  const item = {
    ...rawType,
    name,
    shortName: name,
    kind: rawType.kind || 'Class',
    libraryName: lib.name,
    libraryPath,
    source: rawType.source || libraryPath,
    methods,
    properties,
    fullName: rawType.fullName || name
  };
  for (const key of [name, rawType.name, rawType.shortName, rawType.fullName].filter(Boolean)) types.set(String(key).toLowerCase(), item);
}

function v315ExternalTypeCompletions(document) {
  const ext = v315ExternalLibraryTypesForDocument(document);
  const out = [];
  for (const t of ext.types.values()) {
    if (String(t.name || '').includes('.')) continue;
    const item = new vscode.CompletionItem(t.name, vscode.CompletionItemKind.Class);
    item.detail = `${t.name} - external ${t.kind || 'type'} from ${t.libraryName}`;
    item.documentation = new vscode.MarkdownString(`Source: \`${t.libraryPath || t.source || ''}\``);
    item.sortText = '6_' + String(t.name).toLowerCase();
    out.push(item);
  }
  return v33UniqueCompletions(out);
}

function v315FindExternalType(document, name) {
  if (!document || !name) return null;
  const ext = v315ExternalLibraryTypesForDocument(document);
  return ext.types.get(String(name).toLowerCase()) || null;
}

function v315ExternalTypeHoverMarkdown(t) {
  const methods = (t.methods || []).slice(0, 8).map(m => `- ${m.name}(${(m.params || []).map(p => `${p.name} As ${p.type || 'Object'}`).join(', ')})${m.returnType ? ' As ' + m.returnType : ''}`).join('\n');
  const props = (t.properties || []).slice(0, 8).map(p => `- ${p.name} As ${p.type || 'Object'}`).join('\n');
  return [
    `**External type ${t.name}**`,
    '',
    `Library: **${t.libraryName || ''}**`,
    t.kind ? `Kind: ${t.kind}` : '',
    t.fullName && t.fullName !== t.name ? `Full name: \`${t.fullName}\`` : '',
    t.source ? `Source module: \`${t.source}\`` : '',
    t.libraryPath ? `Library file: \`${t.libraryPath}\`` : '',
    methods ? `\n**Public methods**\n${methods}` : '',
    props ? `\n**Public properties / fields**\n${props}` : ''
  ].filter(Boolean).join('\n');
}

function v315ExternalMemberCompletions(externalType) {
  if (!externalType) return [];
  const out = [];
  const seen = new Set();
  for (const p of externalType.properties || []) {
    const key = 'p:' + String(p.name).toLowerCase(); if (seen.has(key)) continue; seen.add(key);
    const item = new vscode.CompletionItem(p.name, vscode.CompletionItemKind.Property);
    item.detail = `${externalType.name}.${p.name} As ${p.type || 'Object'} (${externalType.libraryName})`;
    out.push(item);
  }
  for (const m of externalType.methods || []) {
    const key = 'm:' + String(m.name).toLowerCase() + '#' + (m.params || []).length; if (seen.has(key)) continue; seen.add(key);
    const item = methodCompletionItem(m, `${externalType.libraryName}.${externalType.name}`);
    item.detail = `${externalType.name}.${v3MethodDetail(m)} (${externalType.libraryName})`;
    out.push(item);
  }
  return out;
}

function v313CurrentDirectiveSegment(tail) {
  const text = String(tail || '');
  const sep = Math.max(text.lastIndexOf(','), text.lastIndexOf(';'));
  const raw = sep >= 0 ? text.slice(sep + 1) : text;
  const leading = (raw.match(/^\s*/) || [''])[0].length;
  return { text: raw.slice(leading), leading, sep };
}

function v313LibraryDirectiveCompletionContext(rawPrefix, document, position) {
  const match = String(rawPrefix || '').match(/^\s*#(ProjectDependsOn|ProjectB4JDependsOn|ProjectB4ADependsOn|ProjectB4iDependsOn|B4XLibDependsOn|B4XLibB4JDependsOn|B4XLibB4ADependsOn|B4XLibB4iDependsOn|B4XPPLibDependsOn|B4XPPLibB4JDependsOn|B4XPPLibB4ADependsOn|B4XPPLibB4iDependsOn|B4JDependsOn|B4ADependsOn|B4iDependsOn|DependsOn)\s+(.+)?$/i);
  if (!match) return null;
  const directive = match[1];
  const tail = match[2] || '';
  // Library names can contain spaces (example: "XUI Views").  For completion
  // the editable token is therefore the whole segment after the last comma / semicolon,
  // not the last whitespace-delimited word.
  const segment = v313CurrentDirectiveSegment(tail);
  const currentToken = segment.text.replace(/^['"]|['"]$/g, '').trimEnd();
  const lower = directive.toLowerCase();
  let platform = 'active';
  let targetKey = 'projectDependsOn';
  if (lower.includes('b4jdependson')) { platform = 'b4j'; targetKey = lower.startsWith('b4xpplib') ? 'b4xppLibB4JDependsOn' : (lower.startsWith('b4xlib') ? 'b4xLibB4JDependsOn' : 'projectB4JDependsOn'); }
  else if (lower.includes('b4adependson')) { platform = 'b4a'; targetKey = lower.startsWith('b4xpplib') ? 'b4xppLibB4ADependsOn' : (lower.startsWith('b4xlib') ? 'b4xLibB4ADependsOn' : 'projectB4ADependsOn'); }
  else if (lower.includes('b4idependson')) { platform = 'b4i'; targetKey = lower.startsWith('b4xpplib') ? 'b4xppLibB4iDependsOn' : (lower.startsWith('b4xlib') ? 'b4xLibB4iDependsOn' : 'projectB4iDependsOn'); }
  else if (lower.startsWith('b4xpplib')) { platform = 'active'; targetKey = 'b4xppLibDependsOn'; }
  else if (lower.startsWith('b4xlib')) { platform = 'active'; targetKey = 'b4xLibDependsOn'; }
  const used = splitDirectiveList(tail).map(v => v.toLowerCase());
  const tokenStartInTail = (segment.sep >= 0 ? segment.sep + 1 : 0) + segment.leading;
  const rangeStart = Math.max(0, position.character - tail.length + tokenStartInTail);
  return {
    directive,
    platform,
    targetKey,
    currentToken,
    used,
    range: new vscode.Range(position.line, rangeStart, position.line, position.character)
  };
}

function v313LibraryDirectiveCompletions(document, context) {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri) || getWorkspaceFolder();
  if (!folder) return [];
  let state = null;
  try { state = getProjectSettingsState(folder); } catch { state = null; }
  if (!state) return [];
  const libraries = state.availableLibraries || listAvailableLibrariesForProject(folder, state, state.directives || {});
  const items = context.platform === 'active' ? (libraries.active || []) : (libraries[context.platform] || []);
  const used = new Set((context.used || []).map(v => String(v).toLowerCase()));
  const directiveLower = String(context.directive || '').toLowerCase();
  const wantedKind = directiveLower.startsWith('b4xpplib') ? 'b4xpplib' : (directiveLower.startsWith('b4xlib') ? 'b4xlib' : '');
  return (items || [])
    .filter(lib => lib && lib.name && !used.has(String(lib.name).toLowerCase()))
    .filter(lib => !wantedKind || String(lib.kind || '').toLowerCase() === wantedKind)
    .map(lib => {
      const item = new vscode.CompletionItem(lib.name, vscode.CompletionItemKind.Module);
      item.detail = `${lib.kind || 'B4X library'} library`;
      item.documentation = new vscode.MarkdownString(`Add \`${lib.name}\` to \`#${context.directive}\`.\n\n${lib.path ? '`' + lib.path + '`' : ''}`);
      item.insertText = lib.name;
      item.range = context.range;
      item.sortText = '0_' + lib.name.toLowerCase();
      return item;
    });
}


function v315DependencyDirectiveTokenAt(document, position) {
  if (!document || !position) return null;
  const text = document.lineAt(position.line).text;
  const directiveMatch = text.match(/^(\s*#(ProjectDependsOn|ProjectB4JDependsOn|ProjectB4ADependsOn|ProjectB4iDependsOn|B4XLibDependsOn|B4XLibB4JDependsOn|B4XLibB4ADependsOn|B4XLibB4iDependsOn|B4XPPLibDependsOn|B4XPPLibB4JDependsOn|B4XPPLibB4ADependsOn|B4XPPLibB4iDependsOn|B4JDependsOn|B4ADependsOn|B4iDependsOn|DependsOn)\s+)(.*)$/i);
  if (!directiveMatch) return null;
  const directive = directiveMatch[2];
  const tailStart = directiveMatch[1].length;
  const tail = directiveMatch[3] || '';
  const pos = position.character;
  // Dependencies are comma/semicolon-separated.  Names such as "XUI Views"
  // must be treated as one token for hover and lookup.
  const tokenRe = /[^,;]+/g;
  let m;
  while ((m = tokenRe.exec(tail))) {
    const raw = m[0] || '';
    const leading = (raw.match(/^\s*/) || [''])[0].length;
    const trailing = (raw.match(/\s*$/) || [''])[0].length;
    const start = tailStart + m.index + leading;
    const end = tailStart + m.index + raw.length - trailing;
    if (start >= end) continue;
    if (pos >= start && pos <= end) {
      return {
        directive,
        name: raw.trim().replace(/^['"]|['"]$/g, ''),
        range: new vscode.Range(position.line, start, position.line, end)
      };
    }
  }
  return null;
}

function v315AllLibraryDirsForDependencyHover(config) {
  const dirs = [];
  dirs.push(...(config.b4jInternalLibraryDirs || []), ...(config.b4jAdditionalLibraryDirs || []));
  dirs.push(...(config.b4aInternalLibraryDirs || []), ...(config.b4aAdditionalLibraryDirs || []));
  dirs.push(...(config.b4iInternalLibraryDirs || []), ...(config.b4iAdditionalLibraryDirs || []));
  dirs.push(...(config.b4xppBundledLibraryDirs || []), ...(config.b4xpplibBundledLibraryDirs || []));
  return uniqueStrings(normalizeDirectoryList(dirs));
}

function v315ParseLibraryFileForHover(full) {
  if (/\.xml$/i.test(full)) return { ...parseB4XLibraryXml(full), path: full, kind: 'xml' };
  if (/\.b4xlib$/i.test(full)) return { ...parseB4XLibFile(full), path: full, kind: 'b4xlib' };
  if (/\.b4xpplib$/i.test(full)) return { ...parseB4XPPLibFile(full), path: full, kind: 'b4xpplib' };
  if (/\.jar$/i.test(full)) return { name: path.basename(full, '.jar'), path: full, kind: 'jar', classes: [], types: [] };
  return null;
}

function v315LibraryHoverKeys(lib, full) {
  return [
    lib && lib.name,
    lib && lib.shortName,
    full ? path.basename(full, path.extname(full)) : ''
  ].filter(Boolean).map(v => String(v).toLowerCase());
}

function v315FindCaseInsensitiveSiblingXml(dir, jarFile, entries) {
  const base = path.basename(String(jarFile || ''), path.extname(String(jarFile || '')));
  if (!base) return '';
  const exact = path.join(dir, `${base}.xml`);
  if (fs.existsSync(exact)) return exact;
  const wanted = `${base}.xml`.toLowerCase();
  const match = (entries || []).find(e => String(e || '').toLowerCase() === wanted);
  return match ? path.join(dir, match) : '';
}

function v315FindDependencyLibraryForHover(document, directive, name) {
  if (!name) return null;
  const config = getConfig();
  const dirs = v315AllLibraryDirsForDependencyHover(config);
  const directiveLower = String(directive || '').toLowerCase();
  const wantedKind = directiveLower.startsWith('b4xpplib') ? 'b4xpplib' : (directiveLower.startsWith('b4xlib') ? 'b4xlib' : '');
  const wantedExt = wantedKind === 'b4xpplib' ? /\.b4xpplib$/i : (wantedKind === 'b4xlib' ? /\.b4xlib$/i : /\.(xml|b4xlib|b4xpplib|jar)$/i);
  const needle = String(name || '').toLowerCase();

  // For native B4X dependencies, a library commonly exists as both Name.jar and
  // Name.xml. The XML is the metadata source used by IntelliSense; the JAR is
  // only the runtime binary.  Prefer metadata files in a first pass, otherwise
  // hovering #ProjectB4JDependsOn jXUI may stop on jXUI.jar and incorrectly say
  // that no XML metadata exists while jXUI.xml is sitting next to it.
  for (const dir of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    const metadataEntries = entries.filter(file => wantedExt.test(file) && !/\.jar$/i.test(file));
    for (const file of metadataEntries) {
      const full = path.join(dir, file);
      let lib = null;
      try { lib = v315ParseLibraryFileForHover(full); } catch { continue; }
      if (!lib) continue;
      if (!v315LibraryHoverKeys(lib, full).includes(needle)) continue;
      return lib;
    }
  }

  // Fallback: if only a JAR was found, still try its sibling XML before giving
  // up, then show the JAR-specific message only when there really is no XML.
  if (!wantedKind) {
    for (const dir of dirs) {
      let entries = [];
      try { entries = fs.readdirSync(dir); } catch { continue; }
      const jarEntries = entries.filter(file => /\.jar$/i.test(file));
      for (const file of jarEntries) {
        const full = path.join(dir, file);
        const jarKeys = [path.basename(file, '.jar')].map(v => String(v).toLowerCase());
        if (!jarKeys.includes(needle)) continue;
        const siblingXml = v315FindCaseInsensitiveSiblingXml(dir, file, entries);
        if (siblingXml) {
          try {
            const xmlLib = { ...parseB4XLibraryXml(siblingXml), path: siblingXml, kind: 'xml' };
            return xmlLib;
          } catch { /* Fall through to the JAR object below. */ }
        }
        let lib = null;
        try { lib = v315ParseLibraryFileForHover(full); } catch { continue; }
        if (lib) return lib;
      }
    }
  }

  return null;
}

function v315LibraryClassesForHover(lib) {
  const out = [];
  const seen = new Set();
  for (const c of [...(lib.classes || []), ...(lib.types || [])]) {
    const name = c.shortName || c.name || c.fullName;
    if (!name) continue;
    const key = String(name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const genericSuffix = c.genericParams && c.genericParams.length ? `(Of ${c.genericParams.join(', ')})` : '';
    out.push({ name: `${name}${genericSuffix}`, kind: c.kind || 'Class', fullName: c.fullName || c.name || name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function v315DependencyLibraryHoverMarkdown(lib, token) {
  const classes = v315LibraryClassesForHover(lib);
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = false;
  const kind = lib.kind || 'library';
  md.appendMarkdown(`**${lib.name || token}** \`${kind}\`\n\n`);
  if (lib.version) md.appendMarkdown(`Version: ${lib.version}\n\n`);
  if (lib.path) md.appendMarkdown(`File: \`${lib.path}\`\n\n`);
  if (classes.length) {
    md.appendMarkdown(`**Classes available (${classes.length})**\n`);
    for (const c of classes) {
      const full = c.fullName && c.fullName !== c.name ? ` — \`${c.fullName}\`` : '';
      md.appendMarkdown(`- ${c.name}${full}\n`);
    }
  } else if (String(kind).toLowerCase() === 'jar') {
    md.appendMarkdown('No B4X XML metadata was found for this JAR. Add / keep the matching `.xml` file next to it to expose classes to B4X++ IntelliSense.');
  } else {
    md.appendMarkdown('No public class metadata found in this library.');
  }
  return md;
}

function v315DependencyDirectiveHover(document, position) {
  const token = v315DependencyDirectiveTokenAt(document, position);
  if (!token || !token.name) return null;
  const lib = v315FindDependencyLibraryForHover(document, token.directive, token.name);
  if (!lib) return null;
  return new vscode.Hover(v315DependencyLibraryHoverMarkdown(lib, token.name), token.range);
}

class B4XPPV3IntelliSenseProvider {
  provideCompletionItems(document, position) {
    const index = buildV3Index(document);
    const fileInfo = v3GetFileInfo(index, document.uri.fsPath);
    const line = document.lineAt(position.line).text;
    const rawPrefix = line.slice(0, position.character);
    const prefix = v33CodePrefix(rawPrefix);
    const currentClass = v3FindClassAt(index, fileInfo, position.line);

    if (v33IsInsideString(rawPrefix)) return [];

    const libraryDirectiveContext = v313LibraryDirectiveCompletionContext(rawPrefix, document, position);
    if (libraryDirectiveContext) return v313LibraryDirectiveCompletions(document, libraryDirectiveContext);

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
      if (resolved) return v3MemberCompletions(index, resolved.type, { currentClass: currentClass && currentClass.name, includeProtected: false, includePrivate: false, staticOnly: resolved.staticOnly, externalTypes: index.externalTypes });
      const builtIn = v3BuiltinMembers(receiver, null);
      if (builtIn.length) return builtIn;
      return [];
    }

    const ctx = v33CompletionContext(prefix);
    if (ctx === 'directive') return v33DirectiveCompletions(rawPrefix, position);
    if (ctx === 'type') return v3TypeCompletions(index, document);
    if (ctx === 'declaration') return v33DeclarationCompletions(index, currentClass);
    if (ctx === 'member-keyword') return v33MemberDeclarationCompletions();

    if (ctx === 'expression') {
      return v33ScopeCompletions(index, fileInfo, position.line, currentClass, { includeStatementKeywords: false });
    }

    // Statement / normal code completion: prefer what is actually visible here.
    // Do not return #Class / Property / top-level types in expression-like contexts,
    // otherwise VS Code proposes them in places such as `If x = ...`.
    return v33ScopeCompletions(index, fileInfo, position.line, currentClass, { includeStatementKeywords: true });
  }

  provideHover(document, position) {
    const dependencyHover = v315DependencyDirectiveHover(document, position);
    if (dependencyHover) return dependencyHover;
    const index = buildV3Index(document);
    const resolved = v3ResolveSymbolAt(index, document, position);
    if (!resolved) {
      const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
      if (!wordRange) return null;
      const word = document.getText(wordRange);
      const externalType = (index.externalTypes && index.externalTypes.get(word.toLowerCase())) || v315FindExternalType(document, word);
      if (!externalType) return null;
      const line = document.lineAt(position.line).text;
      if (!looksLikeTypeReference(line, wordRange, word) && !/[A-Za-z_][A-Za-z0-9_]*\s*\.\s*$/.test(line.slice(0, wordRange.end.character))) return null;
      const md = new vscode.MarkdownString(undefined, true);
      md.isTrusted = false;
      md.appendMarkdown(v315ExternalTypeHoverMarkdown(externalType));
      return new vscode.Hover(md, wordRange);
    }
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
  const v315ConfigSig = [config && config.platform, ...(config && config.b4jInternalLibraryDirs || []), ...(config && config.b4jAdditionalLibraryDirs || []), ...(config && config.b4aInternalLibraryDirs || []), ...(config && config.b4aAdditionalLibraryDirs || []), ...(config && config.b4iInternalLibraryDirs || []), ...(config && config.b4iAdditionalLibraryDirs || []), ...(config && config.b4xppBundledLibraryDirs || [])].join('|');
  const key = [root, v315ConfigSig, files.map(f => `${f}:${safeMTime(f)}`).join('|'), activeDocument ? activeDocument.uri.fsPath + ':' + activeDocument.version : ''].join('::');
  if (b4xppV3IndexCache && b4xppV3IndexCacheKey === key) return b4xppV3IndexCache;

  const index = {
    root,
    sourceRoot,
    files,
    classes: new Map(),
    interfaces: new Map(),
    staticCodes: new Map(),
    fileInfos: new Map(),
    duplicates: [],
    externalTypes: new Map(),
    externalLibraries: new Map()
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
  try {
    const ext = v315ExternalLibraryTypesForRoot(root, config || getConfig(), activeDocument);
    index.externalTypes = ext.types || new Map();
    index.externalLibraries = ext.libraries || new Map();
  } catch {}
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
  const info = { file, lines, includes: [], classes: [], interfaces: [], staticCodes: [], methods: [], closures: [] };
  let owner = null;
  let method = null;
  let inGlobals = false;
  const closureStack = [];

  const closeMethod = (endLine) => {
    if (method) {
      method.endLine = Math.max(method.startLine, endLine);
      v343AnnotateResumableSub(info, method);
    }
    method = null;
    inGlobals = false;
  };
  const closeOwner = (endLine) => { if (owner) { owner.endLine = Math.max(owner.startLine, endLine); owner.fullRange = new vscode.Range(owner.startLine, 0, owner.endLine, 200); } owner = null; };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const code = splitCodeAndCommentForNavigation(raw).code;
    const trimmed = code.trim();
    const inc = trimmed.match(/^#Include\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
    if (inc) info.includes.push({ value: inc[1] || inc[2] || inc[3], file, line: i, range: makeWordRange(raw, i, inc[1] || inc[2] || inc[3], 0) });

    if (/^#?End\s+(Class|Interface|StaticCode)\b/i.test(trimmed)) { closeMethod(i); closeOwner(i); continue; }

    const navClosure = method ? parseNavigationClosureLiteral(raw, i, file) : null;
    if (navClosure) {
      navClosure.ownerMethod = method.name;
      navClosure.ownerName = owner ? owner.name : path.basename(file, '.bx');
      closureStack.push(navClosure);
      info.closures.push(navClosure);
    }

    if (/^End\s+Sub\b/i.test(trimmed)) {
      if (closureStack.length) {
        const c = closureStack.pop();
        c.endLine = i;
        continue;
      }
      closeMethod(i);
      continue;
    }
    if (/^End\s+(Get|Set)\b/i.test(trimmed)) { closeMethod(i); continue; }

    const staticMatch = trimmed.match(/^#?StaticCode\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    if (staticMatch) { closeMethod(i - 1); closeOwner(i - 1); owner = v3MakeOwner('staticCode', staticMatch[1], raw, i, file); info.staticCodes.push(owner); continue; }

    const intfMatch = trimmed.match(/^#?Interface\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    if (intfMatch) { closeMethod(i - 1); closeOwner(i - 1); owner = v3MakeOwner('interface', intfMatch[1], raw, i, file); info.interfaces.push(owner); continue; }

    const clsMatch = trimmed.match(/^#?Class\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/i);
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

    const extLine = trimmed.match(/^#?Extends\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    if (extLine && owner && owner.kind === 'class') { owner.extendsName = extLine[1]; owner.extendsRange = makeWordRange(raw, i, extLine[1], 0); continue; }
    const implLine = trimmed.match(/^#?Implements\s+(.+)$/i);
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
  const m = code.match(/^Property\s+(.+?)\s+As\s+(.+)$/i);
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
  const ctor = raw.match(/^\s*#?Constructor\s*(?:\(([^)]*)\))?/i);
  if (ctor) {
    return { kind: 'method', name: 'Initialize', file, line, startLine: line, endLine: line, range: makeWordRange(raw, line, 'Constructor', 0), fullRange: new vscode.Range(line, 0, line, raw.length), ownerKind: owner ? owner.kind : 'module', ownerName: owner ? owner.name : path.basename(file, '.bx'), visibility: 'public', modifiers: ['constructor'], params: v3ParseParams(ctor[1] || ''), paramsRaw: ctor[1] || '', returnType: '' };
  }
  const m = raw.match(/^\s*((?:(?:Public|Private|Protected|Override|Virtual|Abstract|Final|Async)\s+)*)Sub\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(?:As\s+([A-Za-z_][A-Za-z0-9_\.]*))?/i);
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
  return index.classes.has(t.toLowerCase()) || index.interfaces.has(t.toLowerCase()) || index.staticCodes.has(t.toLowerCase()) || (index.externalTypes && index.externalTypes.has(t.toLowerCase()));
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


//────────────────────────────────────────────────────────────
// B4X++ v0.3.3 scoped completion helpers
//────────────────────────────────────────────────────────────
function v33CodePrefix(rawPrefix) {
  const split = splitCodeAndCommentForNavigation(rawPrefix || '');
  return split && split.code != null ? split.code : String(rawPrefix || '');
}

function v33IsInsideString(rawPrefix) {
  let inString = false;
  for (let i = 0; i < String(rawPrefix || '').length; i++) {
    const ch = rawPrefix[i];
    if (ch === '"') inString = !inString;
  }
  return inString;
}

function v33CompletionContext(prefix) {
  const p = String(prefix || '');
  const t = p.trim();
  if (/^#\w*$/i.test(t)) return 'directive';
  if (/^\s*#(?:Class|Interface|StaticCode|Property|Include|Extends|Implements|MainModule|Project|B4XLib|Version|Author|SupportedPlatforms)\b/i.test(p)) return 'directive';
  if (/\bAs\s+(?:Poly\s+)?[A-Za-z_][A-Za-z0-9_]*$/i.test(p)) return 'type';
  if (/\b(?:Extends|Implements|Poly)\s+[A-Za-z_][A-Za-z0-9_]*$/i.test(p)) return 'type';
  if (/\b(?:Extends|Implements|Poly)\s*$/i.test(p)) return 'type';
  if (/\b(?:Dim|Private|Public|Protected)\s+[A-Za-z_][A-Za-z0-9_]*\s+As\s*$/i.test(p)) return 'type';
  if (/^\s*(?:Public|Private|Protected)\s*$/i.test(p)) return 'member-keyword';
  if (/^\s*(?:Public|Private|Protected)?\s*(?:Override|Virtual|Abstract|Final\s*)*$/i.test(p) && /\b(?:Override|Virtual|Abstract|Final)\s*$/i.test(p)) return 'declaration';
  if (/^\s*(?:Public|Private|Protected)?\s*(?:Override|Virtual|Abstract|Final\s+)*\s*Sub\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*$/i.test(p)) return 'type';
  if (/\b(?:If|Else\s+If|Return|Then|Until|While|Case)\b.*$/i.test(p)) return 'expression';
  if (/[=<>+\-*/&,(]\s*[A-Za-z_][A-Za-z0-9_]*$/i.test(p) || /[=<>+\-*/&,(]\s*$/i.test(p)) return 'expression';
  if (/\b(?:And|Or|Not)\s+[A-Za-z_][A-Za-z0-9_]*$/i.test(p)) return 'expression';
  return 'statement';
}

function v33DirectiveCompletions(rawPrefix, position) {
  const directiveRows = [
    ['#Class', 'Start a B4X++ class'],
    ['#End Class', 'End the current B4X++ class'],
    ['#Interface', 'Start a B4X++ interface'],
    ['#End Interface', 'End the current B4X++ interface'],
    ['#StaticCode', 'Start a B4X++ static module'],
    ['#End StaticCode', 'End the current B4X++ static module'],
    ['#Extends', 'Declare a parent class'],
    ['#Implements', 'Declare implemented interface(s)'],
    ['#Property', 'Native B4X property directive; B4X++ generated properties use bare Property'],
    ['#Constructor', 'Declare a B4X++ constructor'],
    ['#Include', 'Include another .bx file'],
    ['#Project', 'Generate a native .b4j/.b4a/.b4i project file'],
    ['#Package', 'Native B4X project package / application id'],
    ['#ProjectDir', 'Native B4X project output folder'],
    ['#MainModule', 'Declare the generated main module'],
    ['#ProjectDependsOn', 'Native IDE project library dependency emitted as LibraryN=...'],
    ['#ProjectB4JDependsOn', 'B4J project library dependency emitted as LibraryN=...'],
    ['#ProjectB4ADependsOn', 'B4A project library dependency emitted as LibraryN=...'],
    ['#ProjectB4iDependsOn', 'B4i project library dependency emitted as LibraryN=...'],
    ['#B4XLib', 'Declare B4XLib output name'],
    ['#B4XLibVersion', 'B4XLib manifest version'],
    ['#B4XLibAuthor', 'B4XLib manifest author'],
    ['#B4XLibDir', 'B4XLib output folder'],
    ['#B4XLibSupportedPlatforms', 'Optional B4X++ B4XLib platform metadata'],
    ['#B4XLibDependsOn', 'Common B4XLib manifest dependency'],
    ['#B4XLibB4JDependsOn', 'B4J-only B4XLib manifest dependency'],
    ['#B4XLibB4ADependsOn', 'B4A-only B4XLib manifest dependency'],
    ['#B4XLibB4iDependsOn', 'B4i-only B4XLib manifest dependency'],
    ['#B4XPPLib', 'Declare B4XPPLib source package output name'],
    ['#B4XPPLibVersion', 'B4XPPLib manifest version'],
    ['#B4XPPLibAuthor', 'B4XPPLib manifest author'],
    ['#B4XPPLibDir', 'B4XPPLib output folder'],
    ['#B4XPPLibSupportedPlatforms', 'Optional B4XPPLib platform metadata'],
    ['#B4XPPLibDependsOn', 'Common B4X++ source package dependency'],
    ['#B4XPPLibB4JDependsOn', 'B4J-only B4X++ source package dependency'],
    ['#B4XPPLibB4ADependsOn', 'B4A-only B4X++ source package dependency'],
    ['#B4XPPLibB4iDependsOn', 'B4i-only B4X++ source package dependency']
  ];
  const replaceRange = v315DirectiveCompletionRange(rawPrefix, position);
  return directiveRows.map(([label, detail]) => {
    const item = v3Completion(label, vscode.CompletionItemKind.Keyword, detail);
    if (replaceRange) item.range = replaceRange;
    item.insertText = label;
    item.filterText = label;
    item.sortText = '0_' + label.toLowerCase();
    return item;
  });
}

function v315DirectiveCompletionRange(rawPrefix, position) {
  if (!position) return null;
  const prefix = String(rawPrefix || '');
  const m = prefix.match(/#(?:[A-Za-z0-9_]*)$/);
  if (!m) return null;
  return new vscode.Range(position.line, prefix.length - m[0].length, position.line, position.character);
}

function v33MemberDeclarationCompletions() {
  return [
    ['Sub', 'Declare a method'],
    ['Override Sub', 'Override a parent method'],
    ['Virtual Sub', 'Declare an overridable method'],
    ['Abstract Sub', 'Declare an abstract method'],
    ['Final Sub', 'Declare a final method'],
    ['Get', 'Declare a custom property getter'],
    ['Set', 'Declare a custom property setter'],
    ['Property', 'Declare an auto property'],
    ['Constructor', 'Declare a constructor'],
    ['Extends', 'Declare a parent class'],
    ['Implements', 'Declare implemented interface(s)']
  ].map(([label, detail]) => v3Completion(label, vscode.CompletionItemKind.Keyword, detail));
}

function v33DeclarationCompletions(index, currentClass) {
  const items = [
    ...v33MemberDeclarationCompletions(),
    ...v33DirectiveCompletions().filter(i => /^#(?:Constructor|Extends|Implements)/i.test(i.label))
  ];
  if (currentClass) items.push(...v3OverrideCompletions(index, currentClass));
  return v33UniqueCompletions(items);
}

function v33ScopeCompletions(index, info, line, currentClass, options = {}) {
  const items = [];
  const seen = new Set();
  const add = (item) => {
    if (!item || !item.label) return;
    const key = String(item.label).toLowerCase() + ':' + item.kind;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  const vars = v3CollectVariables(index, info, line);
  for (const variable of vars.values()) add(v33VariableCompletion(variable));

  if (currentClass) {
    for (const found of v33VisibleMethods(index, currentClass.name)) {
      const item = methodCompletionItem(found.method, found.owner.name);
      item.sortText = '2_' + item.label;
      add(item);
    }
    add(v3Completion('Me', vscode.CompletionItemKind.Variable, `Current ${currentClass.name} instance`));
    add(v3Completion('This', vscode.CompletionItemKind.Variable, `Current ${currentClass.name} instance`));
    if (currentClass.extendsName) add(v3Completion('Super', vscode.CompletionItemKind.Variable, `Parent ${currentClass.extendsName} instance`));
  } else if (info) {
    for (const method of info.methods.filter(m => m.ownerKind === 'module')) {
      const item = methodCompletionItem(method, method.ownerName || path.basename(info.file, '.bx'));
      item.sortText = '2_' + item.label;
      add(item);
    }
  }

  for (const mod of index.staticCodes.values()) add(v3Completion(mod.name, vscode.CompletionItemKind.Module, 'B4X++ static module'));
  for (const lit of ['True', 'False', 'Null']) add(v3Completion(lit, vscode.CompletionItemKind.Constant, 'B4X literal'));
  for (const kw of ['Not', 'And', 'Or']) add(v3Completion(kw, vscode.CompletionItemKind.Keyword, 'B4X expression keyword'));
  for (const builtin of ['DateTime', 'File', 'Regex', 'Colors']) add(v3Completion(builtin, vscode.CompletionItemKind.Module, 'B4X built-in module'));
  add(v3Completion('Log', vscode.CompletionItemKind.Function, 'B4X logging function'));

  if (options.includeStatementKeywords) {
    for (const kw of ['If', 'Then', 'Else', 'For', 'Each', 'Next', 'Return', 'Dim', 'Wait For', 'Sleep', 'Try', 'Catch', 'Select', 'Case']) {
      add(v3Completion(kw, vscode.CompletionItemKind.Keyword, 'B4X statement'));
    }
  }
  return items;
}

function v33VariableCompletion(variable) {
  const kind = variable.kind === 'field' ? vscode.CompletionItemKind.Field : variable.kind === 'property' ? vscode.CompletionItemKind.Property : vscode.CompletionItemKind.Variable;
  const item = new vscode.CompletionItem(variable.name, kind);
  const type = variable.assignedType || variable.polyType || variable.type || 'Object';
  item.detail = `${variable.name} As ${type}`;
  item.sortText = (kind === vscode.CompletionItemKind.Variable ? '0_' : '1_') + variable.name;
  return item;
}

function v33VisibleMethods(index, className) {
  const out = [];
  const seen = new Set();
  const cls = index.classes.get(String(className || '').toLowerCase());
  const owners = cls ? [cls, ...v3Ancestors(index, cls.name)] : [];
  for (const owner of owners) {
    for (const method of v3AllOwnerMethods(owner)) {
      if (!method || /^(Class_Globals|Process_Globals)$/i.test(method.name)) continue;
      const key = `${method.name.toLowerCase()}#${(method.params || []).length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!v3CanAccess(index, className, owner.name, method.visibility || 'public')) continue;
      out.push({ owner, method });
    }
  }
  return out;
}

function v33UniqueCompletions(items) {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    const key = String(item.label || '').toLowerCase() + ':' + item.kind;
    if (seen.has(key)) continue;
    seen.add(key); out.push(item);
  }
  return out;
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
  if (!owners.length) {
    const externalType = (options.externalTypes && options.externalTypes.get(String(typeName || '').toLowerCase())) || (index.externalTypes && index.externalTypes.get(String(typeName || '').toLowerCase()));
    if (externalType) return v315ExternalMemberCompletions(externalType);
  }
  for (const owner of owners) {
    for (const prop of owner.properties.values()) addProp(prop, owner);
    if (!options.staticOnly) for (const field of owner.fields.values()) addField(field, owner);
    for (const method of v3AllOwnerMethods(owner)) addMethod(method, owner);
  }
  if (!items.length && B4X_V3_TYPE_MEMBERS.has(String(typeName || '').toLowerCase())) items.push(...v3BuiltinMembers('', typeName));
  return items;
}

function v3TopLevelCompletions(index) {
  const out = [];
  for (const cls of index.classes.values()) out.push(v3Completion(cls.name, vscode.CompletionItemKind.Class, `B4X++ class${cls.extendsName ? ' extends ' + cls.extendsName : ''}`));
  for (const intf of index.interfaces.values()) out.push(v3Completion(intf.name, vscode.CompletionItemKind.Interface, 'B4X++ interface'));
  for (const mod of index.staticCodes.values()) out.push(v3Completion(mod.name, vscode.CompletionItemKind.Module, 'B4X++ static module'));
  for (const t of Array.from(B4X_V3_TYPES.values())) out.push(v3Completion(t, vscode.CompletionItemKind.Value, 'B4X++ language type'));
  // Library / platform classes (XUI, B4XView, B4XCanvas, Form, etc.) are intentionally not injected here.
  // They appear through v315ExternalTypeCompletions only when the active project declares the matching library.
  return out;
}

function v3TypeCompletions(index, document) { return v33UniqueCompletions([...(v3TopLevelCompletions(index) || []), ...(document ? v315ExternalTypeCompletions(document) : [])]); }
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
  const resumableTarget = v343ResolveResumableSubNavigation(index, info, document, position, word, range);
  if (resumableTarget) return resumableTarget;
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
  const debugInfo = [
    '---',
    '**Debug info**',
    symbol.ownerName ? `Owner: ${symbol.ownerName}` : '',
    symbol.file ? `File: ${symbol.file}` : '',
    Number.isInteger(symbol.line) ? `Line: ${symbol.line + 1}` : ''
  ].filter(Boolean).join('\n\n');
  if (symbol.kind === 'class') return `**class ${symbol.name}**${symbol.extendsName ? ` extends ${symbol.extendsName}` : ''}\n\nB4X++ class. Edit the .bx source, then regenerate .bas when needed.\n\n${debugInfo}`;
  if (symbol.kind === 'interface') return `**interface ${symbol.name}**\n\nContract used by B4X++ classes / Poly dispatch.\n\n${debugInfo}`;
  if (symbol.kind === 'staticCode') return `**static module ${symbol.name}**\n\nB4X++ helper module generated as a B4X code module.\n\n${debugInfo}`;
  if (symbol.kind === 'property') {
    const setterHint = symbol.mode === 'readonly' ? 'This property is readonly.' : `Inside the owning class you can write **${symbol.name} = value**. The transpiler generates **set${symbol.name}(value)**.`;
    const namingHint = `Prefer constructor / Sub parameters such as **a${symbol.name}** instead of **${symbol.name}**, **m${symbol.name}**, module names, method names, or B4X keywords.`;
    return `**Property ${symbol.name} As ${symbol.type || 'Object'}**\n\n${setterHint}\n\n${namingHint}\n\n${visibility}${debugInfo}`;
  }
  if (symbol.kind === 'field') return `**Field ${symbol.name} As ${symbol.type || 'Object'}**\n\n${visibility}${debugInfo}`;
  if (symbol.kind === 'method') {
    const resumableHint = v343IsResumableMethod(symbol) ? '\n\n**ResumableSub:** B4X rewrites this Sub as a state machine. `Wait For(...) Complete (...)` can jump back to this declaration.' : '';
    return `**Sub ${v3MethodDetail(symbol)}**${resumableHint}\n\nUse safe parameter names like **aX**, **aWidth** to avoid B4X debug/runtime ambiguities.\n\n${visibility}${debugInfo}`;
  }
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
// B4X++ v0.4.3 ResumableSub navigation helpers
//────────────────────────────────────────────────────────────
function v343AnnotateResumableSub(info, method) {
  if (!info || !method) return;
  const rt = String(method.returnType || '').trim().toLowerCase();
  method.isResumable = rt === 'resumablesub';
  method.hasWaitFor = false;
  method.hasSleep = false;
  const start = Math.max(0, method.startLine + 1);
  const end = Math.min(info.lines.length - 1, method.endLine || method.startLine);
  for (let i = start; i <= end; i++) {
    const code = splitCodeAndCommentForNavigation(info.lines[i]).code;
    if (/\bWait\s+For\b/i.test(code)) method.hasWaitFor = true;
    if (/\bSleep\s*\(/i.test(code)) method.hasSleep = true;
  }
  if (method.hasWaitFor || method.hasSleep) method.isResumable = true;
}

function v343IsResumableMethod(method) {
  if (!method) return false;
  return !!method.isResumable || /^ResumableSub$/i.test(String(method.returnType || '').trim()) || !!method.hasWaitFor || !!method.hasSleep;
}

function v343ResolveResumableSubNavigation(index, info, document, position, word, wordRange) {
  if (!index || !info || !document || !word || !wordRange) return null;
  const rawLine = document.lineAt(position.line).text;
  const code = splitCodeAndCommentForNavigation(rawLine).code;
  if (!/\b(?:Wait\s+For|ResumableSub|Sleep)\b/i.test(code)) return null;

  const lowerWord = word.toLowerCase();
  if (['wait', 'for', 'complete', 'resumablesub', 'sleep', 'as', 'dim'].includes(lowerWord)) return null;

  const call = v343CallNameAtRange(code, position.line, wordRange);
  if (!call) return null;

  // Built-ins are intentionally left to B4X itself.
  if (/^(Sleep|Wait|Complete)$/i.test(call.name)) return null;

  const target = v343FindCallableInScope(index, info, position.line, call.name);
  if (!target) return null;

  // For Wait For(SomeSub(...)) and Dim rs As ResumableSub = SomeSub(...), prefer actual ResumableSub targets.
  // For Wait For EventName (Args), allow a matching event Sub as a convenience even if it doesn't return ResumableSub.
  if (v343IsResumableMethod(target) || /\bWait\s+For\b/i.test(code) || /\bResumableSub\b/i.test(code)) {
    return target;
  }
  return null;
}

function v343CallNameAtRange(code, lineIndex, wordRange) {
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    const name = m[1];
    const start = m.index;
    const end = start + name.length;
    if (wordRange.start.line === lineIndex && wordRange.start.character >= start && wordRange.end.character <= end) {
      return { name, start, end };
    }
  }
  return null;
}

function v343FindCallableInScope(index, info, line, name) {
  const key = String(name || '').toLowerCase();
  if (!key) return null;
  const currentClass = v3FindClassAt(index, info, line);
  if (currentClass) {
    const found = v3FindMethodInClass(index, currentClass.name, name, { includeAncestors: true });
    if (found && found.method) return { ...found.method, ownerName: found.owner && found.owner.name };
  }
  const currentStatic = info.staticCodes && info.staticCodes.find(s => line >= s.startLine && line <= s.endLine);
  if (currentStatic) {
    const found = v3FindMethodInType(index, currentStatic.name, name);
    if (found && found.method) return { ...found.method, ownerName: found.owner && found.owner.name };
  }

  // Top-level B4X/B4X++ module Subs in the current file.
  for (const method of info.methods || []) {
    if ((method.name || '').toLowerCase() === key && (method.ownerKind || '').toLowerCase() === 'module') {
      return method;
    }
  }

  // Included / sibling module Subs. This is useful for B4X++ main modules composed with #Include.
  for (const otherInfo of index.fileInfos ? index.fileInfos.values() : []) {
    for (const method of otherInfo.methods || []) {
      if ((method.name || '').toLowerCase() === key && (method.ownerKind || '').toLowerCase() === 'module') {
        return method;
      }
    }
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
  const resumableTarget = v343ResolveResumableSubNavigation(index, info, document, position, word, range);
  if (resumableTarget) return resumableTarget;
  const local = v32ResolveLocalVariable(index, info, position.line, word, range);
  if (local) return local;
  const resolved = v3ResolveSymbolAt(index, document, position);
  if (resolved) return resolved;
  const type = index.classes.get(word.toLowerCase()) || index.interfaces.get(word.toLowerCase()) || index.staticCodes.get(word.toLowerCase());
  if (type) return type;
  return null;
}


function parseWaitForCompleteDeclarationLine(raw, lineIndex, file) {
  const code = splitCodeAndCommentForNavigation(raw).code;
  const completeIndex = code.search(/\bComplete\s*\(/i);
  if (completeIndex < 0) return null;
  const openIndex = code.indexOf('(', completeIndex);
  if (openIndex < 0) return null;
  let depth = 0;
  let endIndex = -1;
  for (let i = openIndex; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) { endIndex = i; break; }
    }
  }
  if (endIndex < 0) return null;
  const inner = code.slice(openIndex + 1, endIndex).trim();
  const m = inner.match(/^([A-Za-z_][A-Za-z0-9_]*)(\(\))?\s+As\s+(.+)$/i);
  if (!m) return null;
  const name = m[1];
  const type = (m[3] || 'Object').trim();
  const nameStartInInner = inner.search(new RegExp('^\\s*' + v32EscapeRegExp(name) + '\\b', 'i'));
  const charStart = openIndex + 1 + (nameStartInInner >= 0 ? nameStartInInner : 0);
  return {
    name,
    file,
    line: lineIndex,
    range: new vscode.Range(lineIndex, charStart, lineIndex, charStart + name.length),
    type: m[2] ? `${type}()` : type,
    polyType: null,
    assignedType: null
  };
}

function v32ResolveLocalVariable(index, info, line, word, clickedRange) {
  const method = v3FindMethodAt(info, line);
  if (!method) return null;
  const key = word.toLowerCase();
  const closure = findNavigationClosureAt(info, line);
  if (closure) {
    for (const p of closure.params || []) {
      if (p.name.toLowerCase() === key) {
        const declLine = info.lines[closure.startLine] || '';
        return { kind: 'local', name: p.name, type: p.type || '', file: info.file, line: closure.startLine, startLine: closure.startLine, endLine: closure.endLine, range: makeWordRange(declLine, closure.startLine, p.name, 0), scopeStart: closure.startLine, scopeEnd: closure.endLine };
      }
    }
  }
  for (const p of method.params || []) {
    if (p.name.toLowerCase() === key) {
      const declLine = info.lines[method.startLine] || '';
      return { kind: 'local', name: p.name, type: p.type || '', file: info.file, line: method.startLine, startLine: method.startLine, endLine: method.endLine, range: makeWordRange(declLine, method.startLine, p.name, 0), scopeStart: method.startLine, scopeEnd: method.endLine };
    }
  }
  for (let i = method.startLine; i <= Math.min(line, method.endLine); i++) {
    const decl = parseVariableDeclarationLine(info.lines[i], i, info.file, true) || parseWaitForCompleteDeclarationLine(info.lines[i], i, info.file);
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
    const m = code.match(/^#(B4XLib|B4XLibVersion|B4XLibAuthor|B4XLibSupportedPlatforms|B4XLibDependsOn|B4XLibB4JDependsOn|B4XLibB4ADependsOn|B4XLibB4iDependsOn|Version|Author|SupportedPlatforms|DependsOn|B4JDependsOn|B4ADependsOn|B4iDependsOn)\b\s*(.*)$/i);
    if (m && !directives.has(m[1].toLowerCase())) directives.set(m[1].toLowerCase(), { value: (m[2] || '').trim(), line: i });
  }
  const lib = directives.get('b4xlib');
  if (!lib) return;
  if (!lib.value) add(info.file, lib.line, 'error', '#B4XLib must specify a library name.');
  const version = directives.get('b4xlibversion') || directives.get('version');
  if (!version) add(info.file, lib.line, 'warning', 'B4XLib manifest should include #B4XLibVersion, for example #B4XLibVersion 0.30.');
  else if (!/^\d+(?:\.\d+){0,2}$/.test(version.value)) add(info.file, version.line, 'warning', `#B4XLibVersion should use a B4X-friendly numeric format, for example 0.30. Current value: ${version.value}`);
  if (!directives.get('b4xlibauthor') && !directives.get('author')) add(info.file, lib.line, 'warning', 'B4XLib manifest should include #B4XLibAuthor.');
  const platforms = directives.get('b4xlibsupportedplatforms') || directives.get('supportedplatforms');
  if (platforms && !/\bB4A\b|\bB4J\b|\bB4i\b/i.test(platforms.value)) add(info.file, platforms.line, 'warning', '#B4XLibSupportedPlatforms should list at least one of B4A, B4J, B4i.');
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


// Only language-level scalar types are offered without a library.
// Platform / library types such as XUI, B4XView and B4XCanvas must come from
// the active project's declared libraries (.xml / .b4xlib), e.g. jXUI / XUI / iXUI.
const B4X_V3_TYPES = new Map([
  'string','int','long','float','double','boolean','object','resumablesub','closure','sub'
].map(x => [x, x.replace(/(^|_)([a-z])/g, (_, a, b) => a + b.toUpperCase())]));

const B4X_V3_TYPE_MEMBERS = new Map([
  ['string', [{ name: 'Length', kind: 'property' }, { name: 'Trim' }, { name: 'ToLowerCase' }, { name: 'ToUpperCase' }, { name: 'SubString' }, { name: 'SubString2' }, { name: 'Contains' }, { name: 'Replace' }]]
]);

module.exports = {
  activate,
  deactivate,
  // Exported for regression tests. These helpers are pure enough to test
  // without activating the VS Code extension host.
  __test: {
    resolveConfiguredIdeProjectDir,
    parseWaitForCompleteDeclarationLine,
    v3ParseFile,
    shouldPublishDiagnostic,
    isLineInsideAsyncSub
  }
};
