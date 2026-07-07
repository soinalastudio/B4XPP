'use strict';

const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') {
    class Position {
      constructor(line, character) { this.line = line; this.character = character; }
    }
    class Range {
      constructor(startLine, startChar, endLine, endChar) {
        this.start = new Position(startLine, startChar);
        this.end = new Position(endLine, endChar);
      }
    }
    return {
      Position,
      Range,
      Uri: { file: file => ({ fsPath: file, toString: () => `file://${file}` }) },
      workspace: {
        workspaceFolders: [],
        getConfiguration: () => ({ get: (_key, fallback) => fallback }),
        getWorkspaceFolder: () => null
      },
      window: {},
      languages: {},
      commands: {},
      env: { clipboard: { readText: async () => '' } },
      CompletionItem: class {},
      SnippetString: class {},
      DocumentLink: class {},
      Location: class {},
      Diagnostic: class {},
      DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
      CompletionItemKind: {},
      SymbolInformation: class {},
      SymbolKind: {},
      CodeAction: class {},
      CodeActionKind: {}
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let extension;
try {
  extension = require('../extension');
} finally {
  Module._load = originalLoad;
}

const { resolveConfiguredIdeProjectDir, parseWaitForCompleteDeclarationLine, v3ParseFile, shouldPublishDiagnostic, isLineInsideAsyncSub } = extension.__test;

const root = path.join('/tmp', 'B4XPP');
assert.strictEqual(
  resolveConfiguredIdeProjectDir(root, { projectDir: 'b4x-ide-projects' }, 'AnimalDemo', 'AnimalDemo', 'b4j-nonui'),
  path.join(root, 'b4x-ide-projects', 'AnimalDemo')
);
assert.strictEqual(
  resolveConfiguredIdeProjectDir(root, { projectDir: 'b4x-ide-projects' }, 'b4x-ide-projects/AnimalDemo', 'AnimalDemo', 'b4j-nonui'),
  path.join(root, 'b4x-ide-projects', 'AnimalDemo')
);

const source = `#MainModule Main
Public Async Sub AppStart (Args() As String)
    Wait For (SumLater(5, 3)) Complete (Result As Int)
    Log("Result: " & Result)
End Sub
`;
const info = v3ParseFile(path.join(root, 'src-b4xpp', 'Demo.bx'), source);
const appStart = info.methods.find(m => m.name === 'AppStart');
assert(appStart, 'Async Sub AppStart must be indexed as a method');
assert(appStart.modifiers.includes('async'), 'Async modifier must be preserved in the navigation index');

const completeDecl = parseWaitForCompleteDeclarationLine(info.lines[2], 2, info.file);
assert(completeDecl, 'Wait For (...) Complete (Result As Int) must declare a local Result variable');
assert.strictEqual(completeDecl.name, 'Result');
assert.strictEqual(completeDecl.type, 'Int');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b4xpp-waitfor-diagnostic-'));
const waitForFile = path.join(tempDir, 'NativeWaitFor.bx');
fs.writeFileSync(waitForFile, source, 'utf8');
assert.strictEqual(
  shouldPublishDiagnostic({ line: 3, message: 'Await can only be used inside an Async Sub.' }, waitForFile),
  false,
  'Async/Await diagnostic must not be shown on native Wait For lines'
);
assert.strictEqual(
  shouldPublishDiagnostic({ line: 3, message: 'Other diagnostic' }, waitForFile),
  true,
  'Unrelated diagnostics should still be shown'
);
const awaitFile = path.join(tempDir, 'BadAwait.bx');
fs.writeFileSync(awaitFile, `#MainModule Main
Sub AppStart(Args() As String)
    Dim total As Int = Await SumLater(1, 2)
End Sub
`, 'utf8');
assert.strictEqual(
  shouldPublishDiagnostic({ line: 3, message: 'Await can only be used inside an Async Sub.' }, awaitFile),
  true,
  'Real Await outside Async Sub must still be reported'
);

const asyncAwaitFile = path.join(tempDir, 'GoodAwait.bx');
fs.writeFileSync(asyncAwaitFile, `#MainModule Main
Public Async Sub AppStart (Args() As String)
    Dim total As Int = Await SumLater2(1, 2)
    Log(total)
End Sub
`, 'utf8');
assert.strictEqual(isLineInsideAsyncSub(asyncAwaitFile, 2), true, 'Await line must be detected inside Async Sub');
assert.strictEqual(isLineInsideAsyncSub(asyncAwaitFile, 3), true, 'Following Log line must still be detected inside Async Sub');
assert.strictEqual(
  shouldPublishDiagnostic({ line: 3, message: 'Await can only be used inside an Async Sub.' }, asyncAwaitFile),
  false,
  'Await inside Public Async Sub must not publish the outside-Async diagnostic'
);

console.log('Async sync/navigation regression tests passed.');
