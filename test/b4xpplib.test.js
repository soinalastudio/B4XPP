'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { transpileFiles, parseB4XPPLibFile } = require('../lib/transpiler');

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

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'b4xpp-b4xpplib-'));
const libDir = path.join(temp, 'libs');
const srcDir = path.join(temp, 'src');
fs.mkdirSync(libDir, { recursive: true });
fs.mkdirSync(srcDir, { recursive: true });

const libPath = path.join(libDir, 'SharedModels.b4xpplib');
writeZipStore([
  { name: 'manifest.txt', data: 'Name=SharedModels\nVersion=1.0.0\nAuthor=Test\n' },
  { name: 'SharedAnimal.bx', data: `#B4XPPLib SharedModels
#Class SharedAnimal
Private mName As String
Public Sub Initialize(Name As String)
    mName = Name
End Sub
Public Sub Speak As String
    Return "Animal:" & mName
End Sub
#End Class
` }
], libPath);

fs.writeFileSync(path.join(srcDir, 'App.bx'), `#Project B4J-NonUI DemoB4XPPLib
#B4XPPLibDependsOn SharedModels
#MainModule Main

Sub AppStart (Args() As String)
    Dim a As SharedAnimal
    a.Initialize("Rex")
    Log(a.Speak)
End Sub
`);

const parsed = parseB4XPPLibFile(libPath);
assert.strictEqual(parsed.name, 'SharedModels');
assert.strictEqual(parsed.kind, 'b4xpplib');
assert(parsed.classes.some(c => c.name === 'SharedAnimal'));
assert(parsed.parsedFiles.some(p => p.fromB4XPPLib));

const result = transpileFiles([path.join(srcDir, 'App.bx')], {
  workspaceRoot: temp,
  platform: 'b4j',
  b4jAdditionalLibraryDirs: [libDir],
  addGeneratedHeader: false
});
assert.deepStrictEqual(result.diagnostics.filter(d => d.severity === 'error').map(d => d.message), []);
assert(result.b4xpplibDependencies.some(l => l.name === 'SharedModels'));
assert(result.outputs.some(o => o.fileName === 'Main.bas'));
assert(result.outputs.some(o => o.fileName === 'SharedAnimal.bas'));
assert(result.outputs.find(o => o.fileName === 'SharedAnimal.bas').content.includes('Public Sub Speak As String'));

fs.writeFileSync(path.join(srcDir, 'AppNativeMistake.bx'), `#Project B4J-NonUI DemoB4XPPLibNativeMistake
#ProjectB4JDependsOn SharedModels
#MainModule Main

Sub AppStart (Args() As String)
    Dim a As SharedAnimal
    a.Initialize("Rex")
    Log(a.Speak)
End Sub
`);

const nativeMistakeResult = transpileFiles([path.join(srcDir, 'AppNativeMistake.bx')], {
  workspaceRoot: temp,
  platform: 'b4j',
  b4jAdditionalLibraryDirs: [libDir],
  addGeneratedHeader: false
});
assert.deepStrictEqual(nativeMistakeResult.diagnostics.filter(d => d.severity === 'error').map(d => d.message), []);
assert(nativeMistakeResult.b4xpplibDependencies.some(l => l.name === 'SharedModels'), 'A .b4xpplib accidentally listed in #ProjectB4JDependsOn must still be resolved as source package.');
assert(nativeMistakeResult.outputs.some(o => o.fileName === 'SharedAnimal.bas'), 'B4XPPLib classes must be emitted as .bas modules even when migrated from native dependency directives.');

console.log('B4X++ B4XPPLib tests OK');
