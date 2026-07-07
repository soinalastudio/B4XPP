'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { transpileText, transpileFiles } = require('../lib/transpiler');

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (const b of buffer) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeZipStore(entries, targetPath) {
  const localParts = [];
  const records = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const data = Buffer.from(entry.data, 'utf8');
    const local = Buffer.alloc(30 + nameBuf.length);
    let p = 0;
    local.writeUInt32LE(0x04034b50, p); p += 4;
    local.writeUInt16LE(20, p); p += 2;
    local.writeUInt16LE(0x0800, p); p += 2;
    local.writeUInt16LE(0, p); p += 2;
    local.writeUInt16LE(0, p); p += 2;
    local.writeUInt16LE(0, p); p += 2;
    local.writeUInt32LE(crc32(data), p); p += 4;
    local.writeUInt32LE(data.length, p); p += 4;
    local.writeUInt32LE(data.length, p); p += 4;
    local.writeUInt16LE(nameBuf.length, p); p += 2;
    local.writeUInt16LE(0, p); p += 2;
    nameBuf.copy(local, p);
    localParts.push(local, data);
    records.push({ nameBuf, crc: crc32(data), size: data.length, offset });
    offset += local.length + data.length;
  }
  const centralParts = [];
  let centralSize = 0;
  for (const rec of records) {
    const c = Buffer.alloc(46 + rec.nameBuf.length);
    let p = 0;
    c.writeUInt32LE(0x02014b50, p); p += 4;
    c.writeUInt16LE(20, p); p += 2;
    c.writeUInt16LE(20, p); p += 2;
    c.writeUInt16LE(0x0800, p); p += 2;
    c.writeUInt16LE(0, p); p += 2;
    c.writeUInt16LE(0, p); p += 2;
    c.writeUInt16LE(0, p); p += 2;
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
  end.writeUInt16LE(records.length, p); p += 2;
  end.writeUInt16LE(records.length, p); p += 2;
  end.writeUInt32LE(centralSize, p); p += 4;
  end.writeUInt32LE(offset, p); p += 4;
  end.writeUInt16LE(0, p);
  fs.writeFileSync(targetPath, Buffer.concat([...localParts, ...centralParts, end]));
}

const inlineSource = `#MainModule Main
#Class Box(Of T)
Sub Class_Globals
    Private mValue As T
End Sub
Public Sub Initialize(Value As T)
    mValue = Value
End Sub
Public Sub GetValue As T
    Return mValue
End Sub
#End Class
#Class Pair(Of TFirst, TSecond)
Sub Class_Globals
    Public First As TFirst
    Public Second As TSecond
End Sub
#End Class
Sub AppStart (Args() As String)
    Dim s As Box(Of String)
    Dim i As Box(Of Int)
    Dim nested As Pair(Of String, Box(Of Int))
    s.Initialize("hello")
    i.Initialize(42)
    Log(s.GetValue)
End Sub
`;
const inlineResult = transpileText(path.join(__dirname, 'GenericInline.bx'), inlineSource, { addGeneratedHeader: false });
assert.deepStrictEqual(inlineResult.diagnostics.filter(d => d.severity === 'error').map(d => d.message), []);
assert(inlineResult.outputs.some(o => o.fileName === 'Box__String.bas'));
assert(inlineResult.outputs.some(o => o.fileName === 'Box__Int.bas'));
assert(inlineResult.outputs.some(o => o.fileName === 'Pair__String__Box__Int.bas'));
assert(!inlineResult.outputs.some(o => o.fileName === 'Box.bas'), 'Generic template must not generate a raw Box.bas');
assert(inlineResult.outputs.find(o => o.fileName === 'Box__String.bas').content.includes('Private mValue As String'));
assert(inlineResult.outputs.find(o => o.fileName === 'Box__Int.bas').content.includes('Private mValue As Int'));
assert(inlineResult.outputs.find(o => o.fileName === 'Pair__String__Box__Int.bas').content.includes('Public Second As Box__Int'));
assert(inlineResult.outputs.find(o => o.fileName === 'Main.bas').content.includes('Dim s As Box__String'));
assert(inlineResult.outputs.find(o => o.fileName === 'Main.bas').content.includes('Dim nested As Pair__String__Box__Int'));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'b4xpp-generics-'));
const libDir = path.join(temp, 'libs');
const srcDir = path.join(temp, 'src');
fs.mkdirSync(libDir, { recursive: true });
fs.mkdirSync(srcDir, { recursive: true });
const libPath = path.join(libDir, 'GenericCore.b4xpplib');
writeZipStore([
  { name: 'manifest.txt', data: 'Name=GenericCore\nVersion=1.0.0\nAuthor=Test\n' },
  { name: 'Result.bx', data: `#B4XPPLib GenericCore
#Class Result(Of T)
Sub Class_Globals
    Private mSuccess As Boolean
    Private mValue As T
End Sub
Public Sub InitializeSuccess(Value As T)
    mSuccess = True
    mValue = Value
End Sub
Public Sub IsSuccess As Boolean
    Return mSuccess
End Sub
Public Sub Value As T
    Return mValue
End Sub
#End Class
` }
], libPath);
fs.writeFileSync(path.join(srcDir, 'App.bx'), `#Project B4J-NonUI DemoGenericLib
#B4XPPLibDependsOn GenericCore
#MainModule Main
Sub AppStart (Args() As String)
    Dim r As Result(Of String)
    r.InitializeSuccess("OK")
    Log(r.Value)
End Sub
`);
const libResult = transpileFiles([path.join(srcDir, 'App.bx')], {
  workspaceRoot: temp,
  platform: 'b4j',
  b4jAdditionalLibraryDirs: [libDir],
  addGeneratedHeader: false
});
assert.deepStrictEqual(libResult.diagnostics.filter(d => d.severity === 'error').map(d => d.message), []);
assert(libResult.outputs.some(o => o.fileName === 'Result__String.bas'));
assert(libResult.outputs.find(o => o.fileName === 'Result__String.bas').content.includes('Private mValue As String'));
assert(libResult.outputs.find(o => o.fileName === 'Main.bas').content.includes('Dim r As Result__String'));
assert(libResult.outputs.find(o => o.fileName === 'Main.bas').content.includes('r.Initialize'));
assert(libResult.outputs.find(o => o.fileName === 'Result__String.bas').content.includes('Public Sub Initialize'));

const coreTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'b4xpp-core-generics-'));
const coreSrc = path.join(coreTemp, 'src');
fs.mkdirSync(coreSrc, { recursive: true });
fs.writeFileSync(path.join(coreSrc, 'CoreApp.bx'), `#Project B4J-NonUI CoreGenericDemo
#B4XPPLibDependsOn B4XPP.Core
#MainModule Main
Sub AppStart (Args() As String)
    Dim result As Result(Of String)
    result.InitializeSuccess("OK")
    Dim scores As TypedMap(Of String, Int)
    scores.Initialize
    scores.Put("A", 10)
End Sub
`);
const coreResult = transpileFiles([path.join(coreSrc, 'CoreApp.bx')], {
  workspaceRoot: coreTemp,
  platform: 'b4j',
  b4xppBundledLibraryDirs: [path.join(__dirname, '..', 'b4xpp-libs')],
  addGeneratedHeader: false
});
assert.deepStrictEqual(coreResult.diagnostics.filter(d => d.severity === 'error').map(d => d.message), []);
assert(coreResult.outputs.some(o => o.fileName === 'Result__String.bas'));
assert(coreResult.outputs.some(o => o.fileName === 'TypedMap__String__Int.bas'));
assert(coreResult.outputs.find(o => o.fileName === 'Main.bas').content.includes('Dim result As Result__String'));
assert(coreResult.outputs.find(o => o.fileName === 'Main.bas').content.includes('result.Initialize'));
assert(coreResult.outputs.find(o => o.fileName === 'Main.bas').content.includes('scores.Initialize'));

console.log('B4X++ generic specialization tests OK');
