'use strict';

const assert = require('assert');
const path = require('path');
const { transpileText, sanitizeProjectPlatform } = require('../lib/transpiler');

const source = `#Project BANano B4XPPBananoSkeletonHello
#Package b4xpp.examples.banano
#ProjectDir b4x-ide-projects/B4XPPBananoSkeletonHello-banano
#MainModule Main

#ProjectB4JDependsOn BANano
#ProjectB4JDependsOn BANanoSkeleton
#BANanoApp B4XPPBananoSkeletonHello
#BANanoTitle "B4X++ BANanoSkeleton"

Sub Process_Globals
    Private BANano As BANano 'ignore
End Sub

Sub AppStart (Form1 As Form, Args() As String)
    BANano.Initialize("BANano", "B4XPPBananoSkeletonHello", 1)
    BANano.Header.Title = "B4X++ BANanoSkeleton"
    SKTools.WriteTheme
    BANano.Build(File.DirApp)
End Sub

Sub BANano_Ready()
    Dim body As BANanoElement
    body.Initialize("#body")
    body.Append($"<div id="mainHolder"></div>"$)
    Dim indexTextProm As BANanoPromise = BANano.GetFileAsText("./index.html", Null, "UTF-8")
    Dim indexText As String = BANano.Await(indexTextProm)
    Log(indexText.Length)
End Sub

#If CSS
body { background: #f6f8fb; }
#End If
`;

assert.strictEqual(sanitizeProjectPlatform('BANano'), 'banano');
assert.strictEqual(sanitizeProjectPlatform('B4J-BANano'), 'banano');

const result = transpileText(path.join(__dirname, 'BananoDemo.bx'), source, { addGeneratedHeader: false });
const errors = result.diagnostics.filter(d => d.severity === 'error').map(d => d.message);
assert.deepStrictEqual(errors, []);
assert(result.project, 'project metadata should be detected');
assert.strictEqual(result.project.platform, 'banano');
assert.strictEqual(result.project.banano.app, 'B4XPPBananoSkeletonHello');
assert.strictEqual(result.project.banano.title, 'B4X++ BANanoSkeleton');
const main = result.outputs.find(o => o.fileName === 'Main.bas').content;
assert(!main.includes('#BANanoApp'), main);
assert(main.includes('Dim indexTextProm As BANanoPromise = BANano.GetFileAsText("./index.html", Null, "UTF-8")'), main);
assert(main.includes('Dim indexText As String = BANano.Await(indexTextProm)'), main);
assert(!main.includes('Wait For (BANano.GetFileAsText'), main);
assert(!main.includes('Wait For (indexTextProm'), main);
assert(main.includes('#If CSS'), main);

console.log('BANano target tests passed.');
