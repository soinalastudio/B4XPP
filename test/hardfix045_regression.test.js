'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { transpileText } = require('../lib/transpiler');

const source = `#Project B4J-NonUI AnimalDemo
#ProjectDir AnimalDemo
#MainModule Main

Public Async Sub SumLater2(a As Int, b As Int) As Int
    Sleep(10)
    Return a + b
End Sub

Public Async Sub AppStart (Args() As String)
    Dim total As Int = Await SumLater2(1, 2)
    Log(total)
End Sub
`;

const result = transpileText(path.join(__dirname, 'AnimalDemoAsync.bx'), source, { addGeneratedHeader: false });
const errors = result.diagnostics.filter(d => d.severity === 'error').map(d => d.message);
assert.deepStrictEqual(errors, []);
const main = result.outputs.find(o => o.fileName === 'Main.bas').content;
assert(!/\bAwait\b/i.test(main), main);
assert(main.includes('Wait For (SumLater2(1, 2)) Complete (total As Int)'), main);

const extensionText = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
assert(/Public\|Private\|Protected\|Override\|Virtual\|Abstract\|Final\|Async/.test(extensionText), 'navigation parser must recognize Async Sub');
assert(/const baseDir = path\.isAbsolute\(baseRaw\)/.test(extensionText), 'Sync #Project must resolve through configured projectDir base');

console.log('0.4.6 hardfix regression tests passed.');
