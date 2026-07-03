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

const customPropertyResult = transpileText(path.join(__dirname, 'CustomPropertyAccessors.bx'), `#Class CustomPropertyAccessors
#Property Public Text As String = ""
#Property Public Value As Int = 0
#Property Protected Angle As Double = 0

Public Get Text As String
    Return mText.ToUpperCase
End Get

Public Set Text(Value As String)
    If Value = Null Then Value = ""
    mText = Value.Trim
End Set

Public Set Value(Value As Int)
    If Value < 0 Then Value = 0
    mValue = Value
End Set

Protected Get Angle As Double
    Return mAngle
End Get
#End Class`, { addGeneratedHeader: false });
assert.strictEqual(customPropertyResult.diagnostics.filter(d => d.severity === 'error').length, 0, 'Custom property accessors should not produce errors');
const customPropertyContent = customPropertyResult.outputs.find(o => o.fileName === 'CustomPropertyAccessors.bas').content;
assert(customPropertyContent.includes('Private mText As String = ""'), 'Custom accessor #Property should still generate its backing field');
assert(customPropertyContent.includes('Public Sub getText As String'), 'Custom Get must generate getText');
assert(customPropertyContent.includes('Return mText.ToUpperCase'), 'Custom getter body must be preserved');
assert(customPropertyContent.includes('Public Sub setText(aValue As String)'), 'Custom Set must generate setText with a safe parameter name');
assert(customPropertyContent.includes('mText = aValue.Trim'), 'Custom setter body must be preserved with renamed parameter');
assert(!customPropertyContent.includes('Return mText\nEnd Sub\n\n\' B4X++ custom property accessor: public set Text'), 'Auto getter must not be generated when custom getter exists');
assert(customPropertyContent.includes('Public Sub getValue As Int'), 'Auto getter must remain when only custom setter exists');
assert(customPropertyContent.includes('Public Sub setValue(aValue As Int)'), 'Setter parameter that hides the B4X property name must be renamed');
assert(customPropertyContent.includes('mValue = aValue'), 'Renamed setter parameter must be rewritten in body');
assert(customPropertyContent.includes('Private Sub getAngle As Double'), 'Protected custom getter must be lowered to Private in generated B4X');

const computedPropertyResult = transpileText(path.join(__dirname, 'ComputedProperty.bx'), `#Class ComputedProperty
Public Get IsReady As Boolean
    Return True
End Get
Private Set DebugName(Name As String)
End Set
#End Class`, { addGeneratedHeader: false });
assert.strictEqual(computedPropertyResult.diagnostics.filter(d => d.severity === 'error').length, 0, 'Manual computed properties should be accepted without #Property');
const computedContent = computedPropertyResult.outputs.find(o => o.fileName === 'ComputedProperty.bas').content;
assert(computedContent.includes('Public Sub getIsReady As Boolean'), 'Manual computed getter must generate getIsReady');
assert(computedContent.includes('Private Sub setDebugName(Name As String)'), 'Manual private setter must generate a Private setDebugName');

console.log('B4X++ v0.2.1 custom property accessor tests OK');

const propertyAssignmentResult = transpileText(path.join(__dirname, 'PropertyAssignmentSugar.bx'), `#Class PropertyAssignmentSugar
#Property X As Float = 0
#Property Width As Float = 10
#Constructor(X As Float, Width As Float)
    X = X
    Width = Width
#End Constructor
Public Sub Resize(Width As Float)
    If Width > 0 Then Width = Width
End Sub
#End Class`, { addGeneratedHeader: false });
assert.strictEqual(propertyAssignmentResult.diagnostics.filter(d => d.severity === 'error').length, 0, 'Property assignment sugar should not produce errors');
const propertyAssignmentContent = propertyAssignmentResult.outputs.find(o => o.fileName === 'PropertyAssignmentSugar.bas').content;
assert(propertyAssignmentContent.includes('Public Sub Initialize(aX As Float, aWidth As Float)'), 'Unsafe constructor parameter names should be renamed to aX / aWidth');
assert(propertyAssignmentContent.includes('setX(aX)'), 'Bare property assignment X = value must generate setX(value)');
assert(propertyAssignmentContent.includes('If aWidth > 0 Then setWidth(aWidth)'), 'Inline one-line If property assignment must generate a setter call after Then');
assert(propertyAssignmentContent.includes('Public Sub Resize(aWidth As Float)'), 'Unsafe method parameter names should be renamed to aWidth');

const propertyReadResult = transpileText(path.join(__dirname, 'PropertyReadSugar.bx'), `#Class PropertyReadSugar
#Property Points As Int = 10
#Property Broken As Boolean = False
Public Sub Hit As Int
    If Broken Then Return 0
    Broken = True
    Return Points
End Sub
#End Class`, { addGeneratedHeader: false });
assert.strictEqual(propertyReadResult.diagnostics.filter(d => d.severity === 'error').length, 0, 'Property read sugar should not produce errors');
const propertyReadContent = propertyReadResult.outputs.find(o => o.fileName === 'PropertyReadSugar.bas').content;
assert(propertyReadContent.includes('If getBroken Then Return 0'), 'Bare boolean property read must generate getBroken');
assert(propertyReadContent.includes('setBroken(True)'), 'Bare property assignment must still generate setter');
assert(propertyReadContent.includes('Return getPoints'), 'Bare property return must generate getter');
assert(!/\bIf\s+Broken\b/i.test(propertyReadContent), 'Generated B4X must not leave bare property reads');
assert(!/\bReturn\s+Points\b/i.test(propertyReadContent), 'Generated B4X must not leave bare property returns');

console.log('B4X++ property assignment/read sugar tests OK');

const overloadResult = transpileText(path.join(__dirname, 'OverloadDemo.bx'), `#Class Person
#Constructor
#End Constructor
#Constructor(Name As String)
#End Constructor
#Constructor(Name As String, Age As Int)
#End Constructor
Public Sub Label As String
    Return "person"
End Sub
Public Sub Label(Prefix As String) As String
    Return Prefix
End Sub
#End Class
#Class Student Extends Person
#Constructor(Name As String)
    Super.Initialize(Name)
#End Constructor
Public Sub Test As String
    Return Super.Label("student")
End Sub
#End Class
#MainModule Main
Sub AppStart(Args() As String)
    Dim p As Person
    p.Initialize
    p.Initialize("Jane")
    p.Initialize("Jane", 12)
    Log(p.Label)
    Log(p.Label("Ms."))
End Sub`, { addGeneratedHeader: false, mainModuleName: 'Main' });
assert.strictEqual(overloadResult.diagnostics.filter(d => d.severity === 'error').length, 0, 'Constructor and safe method overloads should not produce errors');
const personContent = overloadResult.outputs.find(o => o.fileName === 'Person.bas').content;
assert(personContent.includes('Public Sub Initialize'), 'First constructor must generate Initialize');
assert(personContent.includes('Public Sub Initialize2(Name As String)'), 'Second constructor must generate Initialize2');
assert(personContent.includes('Public Sub Initialize3(Name As String, Age As Int)'), 'Third constructor must generate Initialize3');
assert(personContent.includes('Public Sub Label2(Prefix As String) As String'), 'Second method overload must generate suffix 2');
const mainContent = overloadResult.outputs.find(o => o.fileName === 'Main.bas').content;
assert(mainContent.includes('p.Initialize2("Jane")'), 'Constructor call with one arg must rewrite to Initialize2');
assert(mainContent.includes('p.Initialize3("Jane", 12)'), 'Constructor call with two args must rewrite to Initialize3');
assert(mainContent.includes('p.Label2("Ms.")'), 'Overloaded method call with one arg must rewrite to Label2');
const studentContent = overloadResult.outputs.find(o => o.fileName === 'Student.bas').content;
assert(studentContent.includes('B4XPP_Super_Person_Initialize2(Name)'), 'Super.Initialize(Name) must resolve to parent Initialize2');
assert(studentContent.includes('B4XPP_Super_Person_Label2("student")'), 'Super.Label(one arg) must resolve to parent overload Label2');

const ambiguousOverload = transpileText(path.join(__dirname, 'AmbiguousOverload.bx'), `#Class Ambiguous
Public Sub SetValue(Value As String)
End Sub
Public Sub SetValue(Value As Int)
End Sub
#End Class`, { addGeneratedHeader: false });
assert(ambiguousOverload.diagnostics.some(d => d.severity === 'error' && /Ambiguous overload/i.test(d.message)), 'Same-arity method overloads must be rejected until type-based resolution is implemented');

console.log('B4X++ v0.3.1 overload tests OK');

const implicitVisibilityOverload = transpileText(path.join(__dirname, 'ImplicitVisibilityOverload.bx'), `#Class DrawDemo
Sub Class_Globals
    Private mBase As Object
End Sub
Sub TestDraw()
    If mBase.IsInitialized = False Then Return
End Sub
Sub TestDraw(i As Int)
    If mBase.IsInitialized = False Then Return
End Sub
Sub Caller
    TestDraw(1)
End Sub
#End Class`, { addGeneratedHeader: false });
assert.strictEqual(implicitVisibilityOverload.diagnostics.filter(d => d.severity === 'error').length, 0, 'Safe overloads without explicit visibility should not produce errors');
const drawDemoContent = implicitVisibilityOverload.outputs.find(o => o.fileName === 'DrawDemo.bas').content;
assert(drawDemoContent.includes('Sub TestDraw()'), 'First implicit-visibility overload should keep original name');
assert(drawDemoContent.includes('Sub TestDraw2(i As Int)'), 'Second implicit-visibility overload should generate suffix 2');
assert(drawDemoContent.includes('TestDraw2(1)'), 'Calls to second implicit-visibility overload should be rewritten');

console.log('B4X++ v0.3.2 implicit visibility overload tests OK');

const gameExampleRoot = path.join(__dirname, '..', 'examples', 'oop-dungeon-arena', 'src-b4xpp');
function collectBxExampleFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectBxExampleFiles(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.bx')) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
if (fs.existsSync(gameExampleRoot)) {
  const gameResult = transpileFiles(collectBxExampleFiles(gameExampleRoot), {
    addGeneratedHeader: true,
    workspaceRoot: path.join(__dirname, '..', 'examples', 'oop-dungeon-arena')
  });
  assert.strictEqual(gameResult.diagnostics.filter(d => d.severity === 'error').length, 0, 'OOP Dungeon Arena example should transpile without errors');
  assert(gameResult.outputs.some(o => o.fileName === 'GameWorld.bas'), 'Game example must generate GameWorld.bas');
  assert(gameResult.outputs.some(o => o.fileName === 'B4XPP_Runtime.bas'), 'Game example uses Poly and must generate B4XPP_Runtime.bas');
  const gameOutputsByName = new Map(gameResult.outputs.map(o => [o.fileName, o.content]));
  assert(/Sub Process_Globals/i.test(gameOutputsByName.get('ArenaMath.bas') || ''), 'StaticCode helper must include Process_Globals for B4J code modules');
  const gameWorldContent = gameOutputsByName.get('GameWorld.bas') || '';
  const b4jRejectedComparison = new RegExp('B4XPP_Runtime\\.Dispatch\\([^\\n]+\\)=\\s*False', 'i');
  assert(!b4jRejectedComparison.test(gameWorldContent), 'GameWorld must avoid direct Dispatch() comparison forms that B4J can reject');
  assert(!gameWorldContent.includes('goblinOne.Initialize2'), 'GameWorld must not call Initialize2 on a fresh B4X class instance');
  assert(!/\bPublic\s+Sub\s+Step\b/i.test(gameWorldContent), 'GameWorld must not generate Step because Step is a B4X reserved keyword');
  assert(!/\bStep\b/.test(gameWorldContent), 'GameWorld generated code must avoid Step as a call, sub name or dispatch case');
  assert(gameWorldContent.includes('Public Sub RunTurn'), 'GameWorld should expose RunTurn instead of Step');
  for (const fileName of ['Hero.bas', 'Enemy.bas', 'Slime.bas', 'Goblin.bas', 'Boss.bas']) {
    const content = gameOutputsByName.get(fileName) || '';
    assert(!content.includes('Dim gameWorld As GameWorld'), `${fileName} must avoid local variables named like the GameWorld module`);
  }
  const inheritedPrivateBackingFieldUse = /[^A-Za-z0-9_]mName\b|[^A-Za-z0-9_]mX\b|[^A-Za-z0-9_]mY\b|[^A-Za-z0-9_]mHealth\b|[^A-Za-z0-9_]mPicked\b/;
  for (const fileName of ['Hero.bas', 'Enemy.bas', 'Slime.bas', 'Goblin.bas', 'Boss.bas', 'HealthPotion.bas', 'DamageBoost.bas']) {
    const content = gameOutputsByName.get(fileName) || '';
    assert(!inheritedPrivateBackingFieldUse.test(content), `${fileName} must not reference inherited private backing fields directly`);
  }
}

console.log('B4X++ OOP Dungeon Arena example tests OK');

const breakoutExampleRoot = path.join(__dirname, '..', 'examples', 'xui-breakout', 'src-b4xpp');
if (fs.existsSync(breakoutExampleRoot)) {
  const breakoutResult = transpileFiles(collectBxExampleFiles(breakoutExampleRoot), {
    addGeneratedHeader: true,
    workspaceRoot: path.join(__dirname, '..', 'examples', 'xui-breakout')
  });
  assert.strictEqual(breakoutResult.diagnostics.filter(d => d.severity === 'error').length, 0, 'XUI Breakout example should transpile without errors');
  assert.strictEqual(breakoutResult.project.platform, 'b4j-ui', 'XUI Breakout must be a B4J UI project');
  assert((breakoutResult.project.b4jDependsOn || []).some(v => /^jxui$/i.test(v)), 'XUI Breakout #Project should carry B4J jXUI dependency');
  assert(breakoutResult.outputs.some(o => o.fileName === 'BreakoutGame.bas'), 'XUI Breakout must generate BreakoutGame.bas');
  assert(breakoutResult.outputs.some(o => o.fileName === 'BreakoutMath.bas'), 'XUI Breakout must generate BreakoutMath.bas');
  assert(!breakoutResult.outputs.some(o => o.fileName === 'B4XPP_Runtime.bas'), 'XUI Breakout should not need B4XPP_Runtime because it avoids Poly dispatch');
  const breakoutOutputsByName = new Map(breakoutResult.outputs.map(o => [o.fileName, o.content]));
  assert(/Sub Process_Globals/i.test(breakoutOutputsByName.get('BreakoutMath.bas') || ''), 'Breakout StaticCode helper must include Process_Globals for B4J');
  const ballBreakoutContent = breakoutOutputsByName.get('Ball.bas') || '';
  assert(ballBreakoutContent.includes('Public Sub ResetAt(aBallCenterX As Float, aBallCenterY As Float)'), 'Ball.ResetAt must avoid CenterX/CenterY parameter names that collide with inherited helper Subs');
  assert(!ballBreakoutContent.includes('Public Sub ResetAt(CenterX As Float, CenterY As Float)'), 'Ball.ResetAt must not use CenterX/CenterY as parameters');
  assert(ballBreakoutContent.includes('setVelocityX(190)'), 'Readable B4X++ property assignment should still generate setter calls');
  const mainBreakoutContent = breakoutOutputsByName.get('Main.bas') || '';
  assert(mainBreakoutContent.includes('Private gameClock As Timer'), 'Breakout Main must keep Timer as a Process_Globals field');
  assert(mainBreakoutContent.includes('Private breakoutApp As BreakoutGame'), 'Breakout Main must keep the game object as a Process_Globals field');
  for (const [fileName, content] of breakoutOutputsByName.entries()) {
    assert(!/\bPublic\s+Sub\s+Step\b/i.test(content), `${fileName} must avoid Step as a reserved B4X keyword`);
    assert(!/\.Initialize2\b/i.test(content), `${fileName} must avoid Initialize2 as a first-constructor pattern`);
    assert(!/Intersects\s*\(\s*Other\s+As\s+GameEntity/i.test(content), `${fileName} must avoid Intersects(Other As GameEntity) because flattened subclasses are not true B4J subclasses`);
    assert(!/\.Intersects\s*\(\s*mPaddle\s*\)/i.test(content), `${fileName} must avoid passing Paddle to Intersects(GameEntity)`);
    assert(!/\.Intersects\s*\(\s*brickItem\s*\)/i.test(content), `${fileName} must avoid passing Brick to Intersects(GameEntity)`);

    assert(!/\bIf\s+gainedPoints\s*>\s*0\s+Then\s+Remaining\s*=/i.test(content), `${fileName} must rewrite inline If property assignments after Then`);
  }
  for (const fileName of ['BreakoutGame.bas', 'BrickGrid.bas']) {
    const content = breakoutOutputsByName.get(fileName) || '';
    assert(!/Dim\s+ball\s+As\s+Ball/i.test(content), `${fileName} must avoid local variable names that match module names`);
    assert(!/Dim\s+brick\s+As\s+Brick/i.test(content), `${fileName} must avoid local variable names that match module names`);
  }
}

console.log('B4X++ XUI Breakout example tests OK');


//────────────────────────────────────────────────────────────
// B4X++ consolidated validation core tests
//────────────────────────────────────────────────────────────
const strictPropertyValidation = transpileText(path.join(__dirname, 'StrictPropertyValidation.bx'), `#Class Brick
#Property Points As Int = 10
#Property Broken As Boolean = False
Public Sub Hit As Int
    If Broken Then Return 0
    Broken = True
    Return Point
End Sub
#End Class`, { addGeneratedHeader: false, validationStrict: true, enableSemanticDiagnostics: true });
assert(strictPropertyValidation.outputs.find(o => o.fileName === 'Brick.bas').content.includes('If getBroken Then Return 0'), 'Property reads must become getters in generated B4X.');
assert(strictPropertyValidation.outputs.find(o => o.fileName === 'Brick.bas').content.includes('setBroken(True)'), 'Property writes must become setters in generated B4X.');
assert(strictPropertyValidation.diagnostics.some(d => d.severity === 'error' && /Unknown identifier 'Point'/i.test(d.message)), 'Strict validation must catch unknown identifiers before B4X compile.');

const strictTypeValidation = transpileText(path.join(__dirname, 'StrictTypeValidation.bx'), `#Class TypeDemo
Public Sub Bad
    Dim score As Int = "hello"
End Sub
#End Class`, { addGeneratedHeader: false, validationStrict: true, enableSemanticDiagnostics: true });
assert(strictTypeValidation.diagnostics.some(d => d.severity === 'error' && /Cannot assign String to Int/i.test(d.message)), 'Strict validation must catch obvious type mismatches.');

const cssUtilsValidation = transpileText(path.join(__dirname, 'CssUtilsValidation.bx'), `#Project B4J-UI CssUtilsDemo
#B4JDependsOn CSSUtils
#MainModule Main
Sub AppStart (Form1 As Form, Args() As String)
    CSSUtils.SetBorder(Form1.RootPane, 2dip, Null)
End Sub`, {
  addGeneratedHeader: false,
  validationStrict: true,
  enableSemanticDiagnostics: true,
  workspaceRoot: __dirname,
  b4jAdditionalLibraryDirs: [path.join(__dirname, 'fixtures', 'libs')]
});
assert(cssUtilsValidation.diagnostics.some(d => d.severity === 'error' && /Wrong argument count for CSSUtils\.SetBorder/i.test(d.message)), 'Library XML index must validate external method argument counts.');

console.log('B4X++ validation core tests OK');

//────────────────────────────────────────────────────────────
// B4X++ .b4xlib library indexing tests
//────────────────────────────────────────────────────────────
const designerUtilsValidation = transpileText(path.join(__dirname, 'DesignerUtilsValidation.bx'), `#Project B4J-UI DesignerUtilsDemo
#B4JDependsOn DesignerUtils
#MainModule Main
Sub AppStart (Form1 As Form, Args() As String)
    Dim d As DDD
    d.Initialize
    Dim views As List = d.GetViewsByClass("toolbar", "extra")
End Sub`, {
  addGeneratedHeader: false,
  validationStrict: true,
  enableSemanticDiagnostics: true,
  workspaceRoot: __dirname,
  b4jAdditionalLibraryDirs: [path.join(__dirname, 'fixtures', 'libs')]
});
assert(!designerUtilsValidation.diagnostics.some(d => /Unknown type 'DDD'/i.test(d.message)), '.b4xlib index must expose DDD type from DesignerUtils.b4xlib');
assert(designerUtilsValidation.diagnostics.some(d => d.severity === 'error' && /Wrong argument count for d\.GetViewsByClass/i.test(d.message)), '.b4xlib index must validate public methods extracted from internal .bas modules.');

const parsedDesignerUtils = require('../lib/transpiler').parseB4XLibFile(path.join(__dirname, 'fixtures', 'libs', 'DesignerUtils.b4xlib'));
assert.strictEqual(parsedDesignerUtils.name, 'DesignerUtils', '.b4xlib parser must use archive filename as library name');
assert(parsedDesignerUtils.classes.some(c => c.shortName === 'DDD'), '.b4xlib parser must expose DDD.bas as a library class');
assert(parsedDesignerUtils.classes.find(c => c.shortName === 'DDD').methods.some(m => m.name === 'GetViewsByClass' && m.params.length === 1), '.b4xlib parser must extract public Sub signatures');

console.log('B4X++ .b4xlib library indexing tests OK');


//────────────────────────────────────────────────────────────
// B4X++ unified library folder cache tests
//────────────────────────────────────────────────────────────
const unifiedLibDirsValidation = transpileText(path.join(__dirname, 'UnifiedLibDirsValidation.bx'), `#Project B4J-UI UnifiedLibDirsDemo
#B4JDependsOn CSSUtils
#B4JDependsOn DesignerUtils
#MainModule Main
Sub AppStart (Form1 As Form, Args() As String)
    Dim d As DDD
    d.Initialize
    CSSUtils.ColorToHex(0xff000000)
    Dim views As List = d.GetViewsByClass("toolbar", "extra")
End Sub`, {
  addGeneratedHeader: false,
  validationStrict: true,
  enableSemanticDiagnostics: true,
  workspaceRoot: __dirname,
  b4jAdditionalLibraryDirs: [path.join(__dirname, 'fixtures', 'libs')]
});
assert(!unifiedLibDirsValidation.diagnostics.some(d => /B4X library metadata not found for dependency '(cssutils|designerutils)'/i.test(d.message)), 'Platform additionalLibraryDirs must load both .xml and .b4xlib dependencies.');
assert(unifiedLibDirsValidation.diagnostics.some(d => d.severity === 'error' && /Wrong argument count for d\.GetViewsByClass/i.test(d.message)), 'Unified library folder must still validate .b4xlib method signatures.');

const packageJson = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
assert(!packageJson.includes('b4xpp.b4xlibLibraryDirs'), 'Do not expose a separate b4xlibLibraryDirs setting; use platform internal/additional library folders.');

const transpilerModule = require('../lib/transpiler');
transpilerModule.clearB4XLibraryIndexCache();
const manualIndex1 = transpilerModule.buildB4XLibraryIndex({
  platform: 'b4j',
  b4jAdditionalLibraryDirs: [path.join(__dirname, 'fixtures', 'libs')]
}, { projects: [], classes: new Map(), interfaces: new Map(), staticCodes: new Map() }, []);
const manualIndex2 = transpilerModule.buildB4XLibraryIndex({
  platform: 'b4j',
  b4jAdditionalLibraryDirs: [path.join(__dirname, 'fixtures', 'libs')]
}, { projects: [], classes: new Map(), interfaces: new Map(), staticCodes: new Map() }, []);
assert.strictEqual(manualIndex1.libs, manualIndex2.libs, 'Library index should reuse cached Maps when folder contents did not change.');
assert.strictEqual(manualIndex1.types, manualIndex2.types, 'Library type index should be cached instead of re-reading hundreds of libraries every validation.');

console.log('B4X++ unified library folder cache tests OK');


//────────────────────────────────────────────────────────────
// B4X++ platform-scoped library indexing tests
//────────────────────────────────────────────────────────────
const platformScopedRoot = path.join(__dirname, 'fixtures', 'platform-scoped-libs');
const platformB4JDir = path.join(platformScopedRoot, 'b4j');
const platformB4ADir = path.join(platformScopedRoot, 'b4a');
fs.mkdirSync(platformB4JDir, { recursive: true });
fs.mkdirSync(platformB4ADir, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'fixtures', 'libs', 'CSSUtils.xml'), path.join(platformB4JDir, 'CSSUtils.xml'));
fs.copyFileSync(path.join(__dirname, 'fixtures', 'libs', 'DesignerUtils.b4xlib'), path.join(platformB4ADir, 'DesignerUtils.b4xlib'));

transpilerModule.clearB4XLibraryIndexCache();
const b4jOnlyLibValidation = transpileText(path.join(__dirname, 'B4JOnlyLibValidation.bx'), `#Project B4J-UI B4JOnlyLibValidation
#B4ADependsOn DesignerUtils
#B4JDependsOn CSSUtils
#MainModule Main
Sub AppStart (Form1 As Form, Args() As String)
    CSSUtils.ColorToHex(0xff000000)
    Dim d As DDD
End Sub`, {
  addGeneratedHeader: false,
  validationStrict: true,
  enableSemanticDiagnostics: true,
  workspaceRoot: __dirname,
  b4jAdditionalLibraryDirs: [platformB4JDir],
  b4aAdditionalLibraryDirs: [platformB4ADir]
});
assert(!b4jOnlyLibValidation.diagnostics.some(d => /metadata not found for dependency 'cssutils'/i.test(d.message)), 'B4J project must use B4J library dirs for B4J dependencies.');
assert(!b4jOnlyLibValidation.diagnostics.some(d => /metadata not found for dependency 'designerutils'/i.test(d.message)), 'B4J project must ignore B4A-only dependency directives during B4J validation.');
assert(b4jOnlyLibValidation.diagnostics.some(d => /Unknown type 'DDD'/i.test(d.message)), 'B4J project must not load types from B4A library dirs.');

transpilerModule.clearB4XLibraryIndexCache();
const b4xLibMultiPlatformValidation = transpileText(path.join(__dirname, 'B4XLibMultiPlatformValidation.bx'), `#B4XLib MultiPlatformLib
#SupportedPlatforms B4A, B4J
#B4ADependsOn DesignerUtils
#B4JDependsOn CSSUtils
Sub Process_Globals
End Sub
Public Sub Check
    Dim d As DDD
    d.Initialize
    CSSUtils.ColorToHex(0xff000000)
End Sub`, {
  addGeneratedHeader: false,
  validationStrict: true,
  enableSemanticDiagnostics: true,
  workspaceRoot: __dirname,
  platform: 'auto',
  b4jAdditionalLibraryDirs: [platformB4JDir],
  b4aAdditionalLibraryDirs: [platformB4ADir]
});
assert(!b4xLibMultiPlatformValidation.diagnostics.some(d => /metadata not found for dependency '(cssutils|designerutils)'/i.test(d.message)), 'B4XLib validation must load the union of directories declared by #SupportedPlatforms.');
assert(!b4xLibMultiPlatformValidation.diagnostics.some(d => /Unknown type 'DDD'/i.test(d.message)), 'B4XLib supporting B4A must see B4A library types.');

transpilerModule.clearB4XLibraryIndexCache();
const b4xLibB4JOnlyValidation = transpileText(path.join(__dirname, 'B4XLibB4JOnlyValidation.bx'), `#B4XLib B4JOnlyLib
#SupportedPlatforms B4J
#B4ADependsOn DesignerUtils
#B4JDependsOn CSSUtils
Sub Process_Globals
End Sub
Public Sub Check
    Dim d As DDD
End Sub`, {
  addGeneratedHeader: false,
  validationStrict: true,
  enableSemanticDiagnostics: true,
  workspaceRoot: __dirname,
  platform: 'auto',
  b4jAdditionalLibraryDirs: [platformB4JDir],
  b4aAdditionalLibraryDirs: [platformB4ADir]
});
assert(!b4xLibB4JOnlyValidation.diagnostics.some(d => /metadata not found for dependency 'designerutils'/i.test(d.message)), 'B4XLib with #SupportedPlatforms B4J must ignore B4A-only dependencies.');
assert(b4xLibB4JOnlyValidation.diagnostics.some(d => /Unknown type 'DDD'/i.test(d.message)), 'B4XLib with #SupportedPlatforms B4J must not load B4A library types.');

console.log('B4X++ platform-scoped library indexing tests OK');

//────────────────────────────────────────────────────────────
// B4X++ native IDE header + separated B4XLib directives tests
//────────────────────────────────────────────────────────────
const b4jHeader = fs.readFileSync('/mnt/data/B4XAnalogClock.b4j', 'utf8');
const parsedB4JHeader = transpilerModule.parseB4XIdeProjectHeader(b4jHeader, 'B4XAnalogClock.b4j');
assert.strictEqual(parsedB4JHeader.platform, 'b4j');
assert.strictEqual(parsedB4JHeader.appType, 'JavaFX');
assert(parsedB4JHeader.libraries.includes('jcore'));
assert(parsedB4JHeader.libraries.includes('b4xanalogclock'));
assert(parsedB4JHeader.libraries.includes('jxui'));
assert(parsedB4JHeader.modules.includes('|relative|..\\B4XMainPage') || parsedB4JHeader.modules.includes('|relative|../B4XMainPage'));
assert.strictEqual(parsedB4JHeader.packageName, 'b4j.example');

const b4aHeader = fs.readFileSync('/mnt/data/B4XDaisyKitTest.b4a', 'utf8');
const parsedB4AHeader = transpilerModule.parseB4XIdeProjectHeader(b4aHeader, 'B4XDaisyKitTest.b4a');
assert.strictEqual(parsedB4AHeader.platform, 'b4a');
assert(parsedB4AHeader.libraries.includes('core'));
assert(parsedB4AHeader.libraries.includes('b4xpages'));
assert(parsedB4AHeader.libraries.includes('b4xdaisyuikit'));
assert(parsedB4AHeader.manifestCode.includes('AddManifestText'));

const splitProjectVsB4XLib = transpileText(path.join(__dirname, 'SplitProjectVsB4XLib.bx'), `#Project B4J-UI SplitProjectVsB4XLib
#Package b4xpp.tests.split
#ProjectB4JDependsOn jXUI
#B4XLib SplitLib
#B4XLibVersion 1.20
#B4XLibAuthor Tester
#B4XLibSupportedPlatforms B4J
#B4XLibB4JDependsOn CSSUtils
#MainModule Main
Sub AppStart (Form1 As Form, Args() As String)
End Sub`, { addGeneratedHeader: false });
assert.strictEqual(splitProjectVsB4XLib.project.b4jDependsOn[0], 'jXUI');
assert.strictEqual(splitProjectVsB4XLib.project.b4xLibB4JDependsOn[0], 'CSSUtils');
assert.strictEqual(splitProjectVsB4XLib.project.b4xLibVersion, '1.20');
assert.strictEqual(splitProjectVsB4XLib.project.b4xLibAuthor, 'Tester');

console.log('B4X++ native IDE header and B4XLib directive separation tests OK');

//────────────────────────────────────────────────────────────
// B4X++ editor type-completion policy tests
//────────────────────────────────────────────────────────────
const extensionSourceForTypePolicy = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
assert(extensionSourceForTypePolicy.includes("'string','int','long','float','double','boolean','object'"), 'VS Code type completion should keep only scalar language types as unconditional built-ins.');
assert(!/B4X_V3_TYPES = new Map\(\[[\s\S]*?b4xview/i.test(extensionSourceForTypePolicy), 'B4XView must not be an unconditional type-completion built-in.');
assert(!/B4X_V3_TYPES = new Map\(\[[\s\S]*?b4xcanvas/i.test(extensionSourceForTypePolicy), 'B4XCanvas must not be an unconditional type-completion built-in.');
assert(!/B4X_V3_TYPES = new Map\(\[[\s\S]*?xui/i.test(extensionSourceForTypePolicy), 'XUI must not be an unconditional type-completion built-in.');
assert(extensionSourceForTypePolicy.includes('They appear through v315ExternalTypeCompletions only when the active project declares the matching library.'), 'Type-completion policy should document that library/platform types come from active library metadata.');

console.log('B4X++ library-driven type completion policy tests OK');

//────────────────────────────────────────────────────────────
// B4X++ v0.4.0 closure / lifted anonymous Sub tests
//────────────────────────────────────────────────────────────
const closureLiteralResult = transpileText(path.join(__dirname, 'ClosureLiteral.bx'), `#Class ClosureDemo
Public Sub Test
    Dim subOk As Closure = Sub (msg As String)
        Log(msg)
    End Sub
    subOk("Hello")
End Sub
#End Class`, { addGeneratedHeader: false, validationStrict: true, enableSemanticDiagnostics: true });
const closureDemo = closureLiteralResult.outputs.find(o => o.fileName === 'ClosureDemo.bas').content;
assert(closureDemo.includes("' B4XPP_LIFTED_CLOSURE subOk B4XPP_Closure_ClosureDemo_Test_1"), 'Local non-escaping closure should be recorded as a lifted closure.');
assert(closureDemo.includes('B4XPP_Closure_ClosureDemo_Test_1("Hello")'), 'Direct closure call sugar must become a direct generated Private Sub call.');
assert(closureDemo.includes('Private Sub B4XPP_Closure_ClosureDemo_Test_1(msg As String)'), 'Non-escaping closure body must be lifted into a generated Private Sub.');
assert(!closureLiteralResult.outputs.some(o => o.fileName === 'B4XPPClosure.bas'), 'Non-escaping local closure should not emit the runtime closure class.');
assert(!closureLiteralResult.diagnostics.some(d => d.severity === 'error'), 'Valid lifted closure literal should not emit strict validation errors.');

const closureCaptureResult = transpileText(path.join(__dirname, 'ClosureCapture.bx'), `#Class ClosureCaptureDemo
Public Sub Test
    Dim a As Int
    a = 2
    Dim add As Closure = Sub(i As Int) As Int
        Return a + i
    End Sub
    Log(add(5))
    a = 10
    Log(add(5))
End Sub
#End Class`, { addGeneratedHeader: false, validationStrict: true, enableSemanticDiagnostics: true });
const captureDemo = closureCaptureResult.outputs.find(o => o.fileName === 'ClosureCaptureDemo.bas').content;
assert(captureDemo.includes("' B4XPP_LIFTED_CLOSURE add B4XPP_Closure_ClosureCaptureDemo_Test_1 a"), 'Captured parent-scope variable should be listed in lifted closure metadata.');
assert(captureDemo.includes('Log(B4XPP_Closure_ClosureCaptureDemo_Test_1(a, 5))'), 'Captured variable should be passed as a generated Private Sub argument at call time.');
assert(captureDemo.includes('Private Sub B4XPP_Closure_ClosureCaptureDemo_Test_1(a As Int, i As Int) As Int'), 'Generated closure Private Sub must receive captures before closure parameters.');
assert(!closureCaptureResult.diagnostics.some(d => /unsupported captured local variable/i.test(d.message)), 'Local capture should no longer be reported as unsupported.');

const closureEscapeResult = transpileText(path.join(__dirname, 'ClosureEscape.bx'), `#Class ClosureEscapeDemo
Public Sub Test
    Dim a As Int = 2
    Dim add As Closure = Sub(i As Int) As Int
        Return a + i
    End Sub
    UseClosure(add)
End Sub
Public Sub UseClosure(c As Closure)
    Log(c(5))
End Sub
#End Class`, { addGeneratedHeader: false, validationStrict: true, enableSemanticDiagnostics: true });
const escapeDemo = closureEscapeResult.outputs.find(o => o.fileName === 'ClosureEscapeDemo.bas').content;
assert(escapeDemo.includes('Dim add As B4XPPClosure'), 'Escaping closure must be represented as a runtime B4XPPClosure value.');
assert(escapeDemo.includes('add.Initialize(Me, "B4XPP_Closure_ClosureEscapeDemo_Test_1", B4XPP_add_captures)'), 'Escaping closure must call the real B4X Initialize constructor with captured values.');
assert(/Public Sub UseClosure\([^)]* As B4XPPClosure\)/.test(escapeDemo), 'Closure parameters must generate As B4XPPClosure in B4X.');
assert(/\.Run1\(5\)/.test(escapeDemo), 'Calling a runtime closure parameter should use Run1(...).');
const closureRuntimeOutput = closureEscapeResult.outputs.find(o => o.fileName === 'B4XPPClosure.bas');
assert(closureRuntimeOutput, 'Escaping closure usage must emit B4XPPClosure runtime class.');
assert.strictEqual(closureRuntimeOutput.kind, 'class', 'B4XPPClosure runtime must be emitted as a class module, never StaticCode.');
assert(closureRuntimeOutput.content.includes('Public Sub Initialize(Callback As Object, MethodName As String, Captures As List)'), 'B4XPPClosure must expose Initialize(...) as the real first constructor with captures.');
assert(!closureRuntimeOutput.content.includes('Public Sub Initialize2'), 'B4XPPClosure runtime must not expose Initialize2; generated B4X classes require Initialize(...) as the real constructor.');
assert(!escapeDemo.includes('.Initialize2(Me, "B4XPP_Closure_ClosureEscapeDemo_Test_1"'), 'Generated escaping closures must not call Initialize2 as the first method on a fresh class instance.');

const extensionSourceForClosurePolicy = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
assert(extensionSourceForClosurePolicy.includes("'string','int','long','float','double','boolean','object','closure','sub'"), 'VS Code type completion should include the preferred B4X++ Closure type and legacy Sub alias.');
const grammarSourceForClosure = fs.readFileSync(path.join(__dirname, '..', 'syntaxes', 'b4xpp.tmLanguage.json'), 'utf8');
assert(grammarSourceForClosure.includes('Closure'), 'Syntax grammar should color the Closure keyword.');
assert(extensionSourceForClosurePolicy.includes('parseNavigationClosureLiteral'), 'VS Code navigation should parse anonymous Sub / Closure literal scopes.');
assert(extensionSourceForClosurePolicy.includes('findNavigationClosureAt(info, line)'), 'VS Code Go to Definition should resolve variables and parameters inside closure bodies.');

console.log('B4X++ v0.4.0 closure runtime and navigation tests OK');
