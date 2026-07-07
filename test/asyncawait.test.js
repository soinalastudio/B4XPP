'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { transpileText, transpileFiles } = require('../lib/transpiler');

const source = `#MainModule Main

Public Async Sub SumLater(a As Int, b As Int) As Int
    Sleep(10)
    Return a + b
End Sub

Public Async Sub AppStart(Args() As String)
    Dim total As Int = Await SumLater(1, 2)
    Log(total)
    total = Await SumLater(3, 4)
    Log(total)
End Sub

Public Async Sub ReturnAwait As Int
    Return Await SumLater(5, 6)
End Sub
`;

const result = transpileText(path.join(__dirname, 'AsyncAwaitDemo.bx'), source, { addGeneratedHeader: false });
const errors = result.diagnostics.filter(d => d.severity === 'error').map(d => d.message);
assert.deepStrictEqual(errors, []);
const main = result.outputs.find(o => o.fileName === 'Main.bas').content;
assert(main.includes('Public Sub SumLater(a As Int, b As Int) As ResumableSub'));
assert(main.includes('Wait For (SumLater(1, 2)) Complete (total As Int)'));
assert(main.includes('Wait For (SumLater(3, 4)) Complete (B4XPP_await_1 As Int)'));
assert(main.includes('total = B4XPP_await_1'));
assert(main.includes('Public Sub ReturnAwait As ResumableSub'));
assert(main.includes('Wait For (SumLater(5, 6)) Complete (B4XPP_await_1 As Int)'));
assert(main.includes('Return B4XPP_await_1'));

const invalid = transpileText(path.join(__dirname, 'InvalidAwait.bx'), `#MainModule Main
Sub AppStart(Args() As String)
    Dim x As Int = Await SumLater(1, 2)
End Sub
`, { addGeneratedHeader: false });
assert(invalid.diagnostics.some(d => d.severity === 'error' && /Await can only be used inside an Async Sub/i.test(d.message)));
const invalidMain = invalid.outputs.find(o => o.fileName === 'Main.bas').content;
assert(!/\bAwait\b/i.test(invalidMain.replace(/^'.*$/gm, '')), invalidMain);
assert(invalidMain.includes('Wait For (SumLater(1, 2)) Complete (x As Int)'), invalidMain);


const topLevelInvalid = transpileText(path.join(__dirname, 'TopLevelInvalidAwait.bx'), `#MainModule Main
Dim x As Int = Await SumLater(1, 2)
Sub AppStart(Args() As String)
End Sub
`, { addGeneratedHeader: false });
assert(topLevelInvalid.diagnostics.some(d => d.severity === 'error' && /Await can only be used inside an Async Sub/i.test(d.message)));

const asyncWithComment = transpileText(path.join(__dirname, 'AsyncAwaitComment.bx'), `#MainModule Main
Public Async Sub AppStart (Args() As String) ' comment
    Dim total As Int = Await SumLater(1, 2)
    Log(total)
End Sub
`, { addGeneratedHeader: false });
const asyncWithCommentMain = asyncWithComment.outputs.find(o => o.fileName === 'Main.bas').content;
assert(!asyncWithComment.diagnostics.some(d => d.severity === 'error'), JSON.stringify(asyncWithComment.diagnostics));
assert(asyncWithCommentMain.includes('Public Sub AppStart(Args() As String)'));
assert(asyncWithCommentMain.includes('Wait For (SumLater(1, 2)) Complete (total As Int)'));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b4xpp-async-overrides-'));
const overrideFile = path.join(tempRoot, 'Demo.bx');
fs.writeFileSync(overrideFile, `#MainModule Main
Sub AppStart (Args() As String)
    Dim total As Int = Await SumLater2(1, 2)
    Log(total)
End Sub
`, 'utf8');
const overrideText = `#MainModule Main
Public Async Sub AppStart (Args() As String)
    Dim total As Int = Await SumLater2(1, 2)
    Log(total)
End Sub
`;
const overrideResult = transpileFiles([overrideFile], {
  addGeneratedHeader: false,
  fileTextOverrides: new Map([[path.resolve(overrideFile), overrideText]])
});
const overrideMain = overrideResult.outputs.find(o => o.fileName === 'Main.bas').content;
assert(!overrideResult.diagnostics.some(d => d.severity === 'error'), JSON.stringify(overrideResult.diagnostics));
assert(overrideMain.includes('Wait For (SumLater2(1, 2)) Complete (total As Int)'), overrideMain);
assert(!/\bAwait\b/i.test(overrideMain.replace(/^'.*$/gm, '')), overrideMain);

console.log('Async/Await MVP tests passed.');
