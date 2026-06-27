'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { transpileText, transpileFiles } = require('../lib/transpiler');

const source = `#MainModule Main

Sub AppStart (Args() As String)
End Sub

#Interface ISpeaker
Sub Speak As String
Sub Describe(Name As String, Count As Int, Location As String) As String
#End Interface

#Class Base Implements ISpeaker
#Property Name As String = "Unknown"
#Constructor(Name As String)
    mName = Name
#End Constructor
Virtual Sub Speak As String
    Return "base"
End Sub
Virtual Sub Describe(Name As String, Count As Int, Location As String) As String
    Return Name & Count & Location
End Sub
#End Class

#Class Child Extends Base
#Constructor(Name As String)
    Super.Initialize(Name)
#End Constructor
Override Sub Speak As String
    Return Super.Speak & ":child"
End Sub
Override Sub Describe(Name As String, Count As Int, Location As String) As String
    Return Name & Count & Location
End Sub
#End Class
`;

const result = transpileText(path.join(__dirname, 'Demo.bx'), source, {
  addGeneratedHeader: true,
  workspaceRoot: path.join(__dirname, '..')
});

assert.strictEqual(result.outputs.length, 3, 'Must generate Main.bas, Base.bas and Child.bas');
assert(result.outputs.some(o => o.fileName === 'Main.bas'));
assert(result.outputs.some(o => o.fileName === 'Base.bas'));
const base = result.outputs.find(o => o.fileName === 'Base.bas');
assert(base.content.includes('Private mName As String = "Unknown"'), 'Property must inject mName with default value');
assert(base.content.includes('Public Sub getName As String'), 'Property must generate getter');
const child = result.outputs.find(o => o.fileName === 'Child.bas');
assert(!child.content.includes('Private b4xpp_super As Base'), 'Flattened output must not require a b4xpp_super field');
assert(child.content.includes('B4XPP_Super_Base_Initialize'), 'Must flatten parent Initialize for Super.Initialize');
assert(child.content.includes('Public Sub Speak'), 'Override Sub must become Public Sub');
assert(child.content.includes('B4XPP_Super_Base_Speak'), 'Super.Method must call flattened parent implementation');
assert(!child.content.includes('B4XPP_Dispatch'), 'Classes without Poly / implicit dynamic dispatch must not include B4XPP_Dispatch');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'b4xpp-test-'));
const src = path.join(temp, 'src-b4xpp');
fs.mkdirSync(path.join(src, 'models'), { recursive: true });
fs.mkdirSync(path.join(src, 'contracts'), { recursive: true });
fs.writeFileSync(path.join(src, 'Demo.bx'), `#Project B4J-NonUI DemoPoly
#Package b4xpp.demo
#MainModule Main
#Include "contracts/ISpeaker.bx"
#Include "models/Animal.bx"
#Include "models/Dog.bx"
Sub AppStart (Args() As String)
    Dim dog As Dog
    dog.Initialize("Rex")
    Dim p As Poly ISpeaker
    p = dog
    Log(p.Speak)
    Log(p.Describe("golden retriever", 3, "City"))
    Dim animal As Animal
    animal = dog
    Log(animal.Speak)
End Sub
`);
fs.writeFileSync(path.join(src, 'contracts', 'ISpeaker.bx'), `#Interface ISpeaker
Sub Speak As String
Sub Describe(Name As String, Count As Int, Location As String) As String
#End Interface
`);
fs.writeFileSync(path.join(src, 'models', 'Animal.bx'), `#Class Animal Implements ISpeaker
Virtual Sub Speak As String
    Return "Animal"
End Sub
Virtual Sub Describe(Name As String, Count As Int, Location As String) As String
    Return Name & Count & Location
End Sub
#End Class
`);
fs.writeFileSync(path.join(src, 'models', 'Dog.bx'), `#Class Dog Extends Animal
Override Sub Speak As String
    Return "Dog"
End Sub
Override Sub Describe(Name As String, Count As Int, Location As String) As String
    Return Name & Count & Location
End Sub
#End Class
`);
const files = [
  path.join(src, 'Demo.bx'),
  path.join(src, 'contracts', 'ISpeaker.bx'),
  path.join(src, 'models', 'Animal.bx'),
  path.join(src, 'models', 'Dog.bx')
];
const workspaceResult = transpileFiles(files, { addGeneratedHeader: true, workspaceRoot: temp });
assert.strictEqual(workspaceResult.project.platform, 'b4j-nonui');
assert(workspaceResult.outputs.some(o => o.fileName === 'B4XPP_Runtime.bas'), 'Poly must generate B4XPP_Runtime.bas');
const main = workspaceResult.outputs.find(o => o.fileName === 'Main.bas').content;
assert(main.includes('B4XPP_Runtime.Dispatch(p, "Speak", B4XPP_Runtime.Args0)'), 'Zero-argument Poly call must use Dispatch');
assert(main.includes('B4XPP_Runtime.Dispatch(p, "Describe", B4XPP_Runtime.Args3("golden retriever", 3, "City"))'), 'Three-argument Poly call must use advanced Dispatch');
assert(main.includes('Dim animal As Object'), 'Implicit polymorphic base variables must be generated As Object');
assert(main.includes('B4XPP_Runtime.Dispatch(animal, "Speak", B4XPP_Runtime.Args0)'), 'Implicit polymorphic method calls must use Dispatch');
assert.strictEqual(workspaceResult.diagnostics.filter(d => d.severity === 'error').length, 0);

console.log('B4X++ transpiler tests OK');

const visibilitySource = `#Class VisibilityBase
#Property Protected AngleDegrees As Double = 0
Sub Class_Globals
    Private mSecret As String
    Protected mShared As String
End Sub
Private Sub SecretName As String
    Return mSecret
End Sub
Protected Virtual Sub ProtectedName As String
    Return mShared
End Sub
Public Virtual Sub PublicName As String
    Return ProtectedName
End Sub
#End Class

#Class VisibilityChild Extends VisibilityBase
Override Sub PublicName As String
    Return Super.PublicName
End Sub
Public Sub ReadShared As String
    Return mShared
End Sub
#End Class
`;
const visibilityResult = transpileText(path.join(__dirname, 'VisibilityDemo.bx'), visibilitySource, {
  addGeneratedHeader: true,
  workspaceRoot: path.join(__dirname, '..')
});
assert.strictEqual(visibilityResult.diagnostics.filter(d => d.severity === 'error').length, 0);
const visibilityChild = visibilityResult.outputs.find(o => o.fileName === 'VisibilityChild.bas').content;
assert(visibilityChild.includes('Private B4XPP_Private_VisibilityBase_mSecret As String'), 'Inherited Private fields must be renamed during flattening');
assert(visibilityChild.includes('Private mShared As String'), 'Protected fields must be lowered to Private but keep their inherited name');
assert(visibilityChild.includes('Private Sub getAngleDegrees As Double'), 'Protected #Property getters must be Private in generated B4X');
assert(visibilityChild.includes('Private Sub ProtectedName As String'), 'Protected Sub must be Private in generated B4X');
assert(visibilityChild.includes('B4XPP_Private_VisibilityBase_SecretName'), 'Inherited Private methods must be renamed during flattening');

const invalidPrivateOverride = transpileText(path.join(__dirname, 'InvalidPrivateOverride.bx'), `#Class A
Private Virtual Sub Hidden
End Sub
#End Class
#Class B Extends A
Override Sub Hidden
End Sub
#End Class`, { addGeneratedHeader: false });
assert(invalidPrivateOverride.diagnostics.some(d => d.severity === 'error' && /Private/.test(d.message)), 'Private Virtual / Override must produce diagnostics');

console.log('B4X++ v0.2 visibility tests OK');

const invalidProtectedExternalAccess = transpileText(path.join(__dirname, 'InvalidProtectedExternalAccess.bx'), `#MainModule Main
#Class Animal
Protected Sub GetType As String
    Return "Animal"
End Sub
#End Class
#Class Dog Extends Animal
Protected Sub GetType As String
    Return "Dog"
End Sub
#End Class
Sub AppStart (Args() As String)
    Dim dogInstance As Dog
    Dim t As String = dogInstance.GetType()
End Sub`, { addGeneratedHeader: false });
assert(invalidProtectedExternalAccess.diagnostics.some(d => d.severity === 'error' && /not accessible/i.test(d.message) && /GetType/.test(d.message)), 'Protected methods must not be callable from main / outside class');

const validProtectedInternalAccess = transpileText(path.join(__dirname, 'ValidProtectedInternalAccess.bx'), `#Class Animal
Protected Sub GetType As String
    Return "Animal"
End Sub
#End Class
#Class Dog Extends Animal
Public Sub Test As String
    Return GetType
End Sub
#End Class`, { addGeneratedHeader: false });
assert.strictEqual(validProtectedInternalAccess.diagnostics.filter(d => d.severity === 'error').length, 0, 'Protected methods must be accessible inside descendants');

console.log('B4X++ v0.2 member access tests OK');
