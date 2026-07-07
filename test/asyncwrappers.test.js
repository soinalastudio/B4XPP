'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { transpileFiles, parseB4XPPLibFile } = require('../lib/transpiler');

const libDir = path.join(__dirname, '..', 'b4xpp-libs');
const net = parseB4XPPLibFile(path.join(libDir, 'B4XPP.Net.b4xpplib'));
assert.strictEqual(net.name, 'B4XPP.Net');
assert(net.dependsOn.includes('B4XPP.Core'));
assert(net.nativeB4JDependsOn.includes('jOkHttpUtils2'));
assert(net.classes.some(c => c.name === 'B4XPPHttp'));
assert(net.classes.some(c => c.name === 'B4XPPHttpResponse'));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'b4xpp-async-wrappers-'));
const src = path.join(temp, 'src-b4xpp');
fs.mkdirSync(src, { recursive: true });
fs.writeFileSync(path.join(src, 'App.bx'), `#Project B4J-NonUI AsyncNetDemo
#B4XPPLibDependsOn B4XPP.Net
#MainModule Main

Public Async Sub FetchText(Url As String) As String
    Dim response As B4XPPHttpResponse = Await B4XPPHttp.Get(Url)
    If response.Success Then Return response.Body
    Return response.ErrorMessage
End Sub
`);
const result = transpileFiles([path.join(src, 'App.bx')], {
  workspaceRoot: temp,
  platform: 'b4j',
  b4jAdditionalLibraryDirs: [libDir],
  addGeneratedHeader: false
});
const errors = result.diagnostics.filter(d => d.severity === 'error').map(d => d.message);
assert.deepStrictEqual(errors, []);
assert(result.outputs.some(o => o.fileName === 'B4XPPHttp.bas'));
assert(result.outputs.some(o => o.fileName === 'B4XPPHttpResponse.bas'));
assert(result.outputs.find(o => o.fileName === 'Main.bas').content.includes('Wait For (B4XPPHttp.Get(Url)) Complete (response As B4XPPHttpResponse)'));
assert(result.b4xpplibDependencies.some(l => l.name === 'B4XPP.Net'));
assert(result.b4xpplibDependencies.some(l => l.name === 'B4XPP.Core'));
console.log('Async wrapper package tests passed.');
