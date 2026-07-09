'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') {
    class Position { constructor(line, character) { this.line = line; this.character = character; } }
    class Range {
      constructor(a, b, c, d) {
        if (a instanceof Position) { this.start = a; this.end = b; }
        else { this.start = new Position(a, b); this.end = new Position(c, d); }
      }
    }
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

const { v3ParseFile, v3CollectVariables, v3ResolveReceiverType } = extension.__test;

const source = `Sub Process_Globals
    Private BANano As BANano 'ignore
    Private appName As String
End Sub

Sub AppStart (Form1 As Form, Args() As String)
    BANano.
End Sub

Sub BANano_Ready()
    BANano.
End Sub
`;

const file = path.join('/tmp', 'Demo.bx');
const info = v3ParseFile(file, source);
assert(info.moduleFields, 'top-level .bx should have moduleFields');
assert(info.moduleFields.has('banano'), 'Process_Globals BANano field should be indexed as module field');
assert(info.moduleFields.has('appname'), 'other Process_Globals fields should be indexed as module fields');

const appStartLine = 6;
const vars = v3CollectVariables({}, info, appStartLine);
assert(vars.has('banano'), 'Process_Globals BANano variable should be visible from AppStart');
assert.strictEqual(vars.get('banano').type, 'BANano');

const readyLine = 10;
const resolved = v3ResolveReceiverType({ classes: new Map(), staticCodes: new Map() }, info, readyLine, 'BANano');
assert(resolved, 'BANano receiver type should resolve from Process_Globals');
assert.strictEqual(resolved.type, 'BANano');
assert.strictEqual(resolved.staticOnly, false);

console.log('BANano Process_Globals IntelliSense tests passed.');
