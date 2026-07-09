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

const {
  v3ParseFile,
  v317ResolveExpressionType,
  v317CompletionReceiverExpression,
  v317DottedMemberExpressionAt,
  v318ExpressionTail,
  v3FindMemberInType,
  v3ParseCallAt
} = extension.__test;

const source = `#Class SKLayout
Public Sub Initialize(Parent As String)
End Sub
Public Sub LastRow As SKRow
End Sub
#End Class

#Class SKRow
Public Sub Column(Index As Int) As SKColumn
End Sub
#End Class

#Class SKColumn
Public Sub setMarginTop(Value As String)
End Sub
Public Sub getMarginTop As String
End Sub
Public Sub Add As SKAdd
End Sub
#End Class

#Class SKAdd
Public Sub TagPicker(ID As String, EventName As String, Hint As String, Multiple As Boolean, FreeText As Boolean, Min As Int, Max As Int, Step As Int, Clearable As Boolean, Search As Boolean, CloseOnSelect As Boolean) As SKTagPicker
End Sub
#End Class

#Class SKTagPicker
Public Sub Focus
End Sub
#End Class

Sub AppStart
    Dim Layout As SKLayout
    Layout.LastRow.Column(1).MarginTop = "20px"
End Sub
`;

const file = path.join('/tmp', 'ChainDemo.bx');
const info = v3ParseFile(file, source);
const index = { classes: new Map(), interfaces: new Map(), staticCodes: new Map(), externalTypes: new Map() };
for (const cls of info.classes) index.classes.set(cls.name.toLowerCase(), cls);

const line = 74;
assert.strictEqual(v317CompletionReceiverExpression('Layout.LastRow.Column(1).'), 'Layout.LastRow.Column(1)');
assert.strictEqual(v317CompletionReceiverExpression('Dim tp As SKTagPicker = Layout.LastRow.Column(1).Add.'), 'Layout.LastRow.Column(1).Add');
assert.strictEqual(v318ExpressionTail('Dim tp As SKTagPicker = Layout.LastRow.Column(1).Add'), 'Layout.LastRow.Column(1).Add');
assert.deepStrictEqual(v317ResolveExpressionType(index, info, line, 'Layout'), { type: 'SKLayout', staticOnly: false });
assert.deepStrictEqual(v317ResolveExpressionType(index, info, line, 'Layout.LastRow'), { type: 'SKRow', staticOnly: false });
assert.deepStrictEqual(v317ResolveExpressionType(index, info, line, 'Layout.LastRow.Column(1)'), { type: 'SKColumn', staticOnly: false });
assert.deepStrictEqual(v317ResolveExpressionType(index, info, line, 'Layout.LastRow.Column(1).Add'), { type: 'SKAdd', staticOnly: false });
assert.deepStrictEqual(v317ResolveExpressionType(index, info, line, 'Layout.LastRow.Column(1).Add.TagPicker("tp", "tp", "pick some tags", False, False, 10, 30, 0, True, True, False)'), { type: 'SKTagPicker', staticOnly: false });
assert(v3FindMemberInType(index, 'SKColumn', 'MarginTop'), 'chained final type should expose MarginTop property/getter');

const doc = { lineAt: () => ({ text: '    Dim tp As SKTagPicker = Layout.LastRow.Column(1, ' }) };
const parsedCall = v3ParseCallAt(doc, { line: 0, character: '    Dim tp As SKTagPicker = Layout.LastRow.Column(1, '.length });
assert.strictEqual(parsedCall.receiver, 'Layout.LastRow');
assert.strictEqual(parsedCall.name, 'Column');
assert.strictEqual(parsedCall.argumentIndex, 1);

console.log('Chained member IntelliSense tests passed.');
