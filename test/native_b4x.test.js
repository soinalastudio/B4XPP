'use strict';

const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') {
    class Position { constructor(line, character) { this.line = line; this.character = character; } }
    class Range { constructor(startLine, startChar, endLine, endChar) { this.start = new Position(startLine, startChar); this.end = new Position(endLine, endChar); } }
    return {
      Position,
      Range,
      Uri: { file: file => ({ fsPath: file, toString: () => `file://${file}` }) },
      workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_key, fallback) => fallback }), getWorkspaceFolder: () => null },
      window: {}, languages: {}, commands: {}, env: { clipboard: { readText: async () => '' } },
      CompletionItem: class {}, SnippetString: class {}, DocumentLink: class {}, Location: class {}, Diagnostic: class {},
      DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 }, CompletionItemKind: {}, SymbolInformation: class {}, SymbolKind: {}, CodeAction: class {}, CodeActionKind: {}
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let extension;
try { extension = require('../extension'); } finally { Module._load = originalLoad; }

const { v3ParseFile, collectNativeB4XCodeFiles, parseNativeB4XProjectModuleLine } = extension.__test;

const classSource = `Sub Class_Globals
    Private mName As String
End Sub

Public Sub Initialize(Name As String)
    mName = Name
End Sub

Public Sub Speak As String
    Return mName
End Sub
`;
const classInfo = v3ParseFile(path.join('/tmp', 'Dog.bas'), classSource);
assert.strictEqual(classInfo.nativeB4X, true);
assert.strictEqual(classInfo.classes.length, 1);
assert.strictEqual(classInfo.classes[0].name, 'Dog');
assert(classInfo.classes[0].fields.has('mname'));
assert(classInfo.classes[0].methods.has('initialize'));
assert(classInfo.classes[0].methods.has('speak'));

const moduleSource = `Sub Process_Globals
    Public AppName As String
End Sub

Sub AppStart(Args() As String)
    Log(AppName)
End Sub
`;
const moduleInfo = v3ParseFile(path.join('/tmp', 'Main.bas'), moduleSource);
assert.strictEqual(moduleInfo.staticCodes.length, 1);
assert.strictEqual(moduleInfo.staticCodes[0].name, 'Main');
assert(moduleInfo.staticCodes[0].fields.has('appname'));
assert(moduleInfo.staticCodes[0].methods.has('appstart'));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'b4x-native-index-'));
fs.mkdirSync(path.join(temp, 'generated-b4x'));
fs.writeFileSync(path.join(temp, 'Main.bas'), moduleSource, 'utf8');
fs.writeFileSync(path.join(temp, 'generated-b4x', 'Ignored.bas'), moduleSource, 'utf8');
const indexed = collectNativeB4XCodeFiles(temp, { outputDir: 'generated-b4x' }).map(f => path.basename(f));
assert.deepStrictEqual(indexed, ['Main.bas']);

const projectTarget = parseNativeB4XProjectModuleLine('Module1=Main', 2, temp);
assert(projectTarget, 'project Module line should be parsed');
assert.strictEqual(projectTarget.name, 'Main');
assert.strictEqual(projectTarget.file, path.join(temp, 'Main.bas'));

console.log('Native B4X IntelliSense tests passed.');
