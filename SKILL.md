# B4X++ Skill — AI Agent Guidance

**Target version:** B4X++ v0.3.3, commit package `20260701-0810`  
**Generator version:** `0.3.2`  
**Primary audience:** AI coding agents and developers generating or modifying B4X++ `.bx` projects.

B4X++ is an experimental precompiler / transpiler layer for the B4X ecosystem. It lets developers write `.bx` files with source-level OOP conveniences, then generates classic B4X `.bas` modules compatible with B4A, B4J and B4i.

B4X++ is **not** a replacement for the official B4X IDE or the B4X compiler. The official IDE remains responsible for layouts, designer files, visual forms, final platform settings and final compilation.

```text
B4X++ source (.bx)
        ↓
VS Code extension / transpiler
        ↓
Classic B4X modules (.bas)
        ↓
B4A / B4J / B4i IDE or .b4xlib package
```

---

## 1. Golden rules for AI agents

When asked to create, edit, fix, review or refactor B4X++ code:

1. Treat `src-b4xpp/**/*.bx` as the source of truth.
2. Treat generated `.bas` files as build artifacts. Do not manually edit them unless the user explicitly asks for generated output inspection.
3. Generate B4X++ syntax only when it is supported by the current version described here.
4. Preserve compatibility with classic B4X output.
5. Preserve B4X conditional directives such as `#If B4A`, `#If B4J`, `#If B4i`, `#If Java`, `#Else If`, `#Else`, and `#End If`.
6. Prefer B4X-compatible naming that avoids B4X warning #30: avoid variables with the same name as modules/classes. Use names such as `dogInstance`, `animalInstance`, `clockView`, etc.
7. For CustomView / `.b4xlib` work, always consider B4A, B4J and B4i compatibility, especially designer properties and color handling.
8. Do not invent unsupported features such as native namespaces, generics, multiple inheritance or native B4X interfaces.
9. If an error exists in B4X++ source, fix the `.bx` file first, then regenerate `.bas` output.
10. Keep examples small, compilable and easy to debug in B4J Non-UI whenever possible.

---

## 2. Recommended repository structure

Use this layout unless the existing project already has a different structure:

```text
MyB4XPPProject/
├─ src-b4xpp/
│  ├─ Demo.bx
│  ├─ Library.bx
│  ├─ contracts/
│  │  └─ IAnimal.bx
│  ├─ models/
│  │  ├─ Animal.bx
│  │  └─ Dog.bx
│  └─ Files/
│     └─ readme.txt
├─ generated-b4x/
├─ b4x-ide-projects/
├─ b4x-libs/
└─ .b4xpp/
   ├─ symbols.json
   └─ sourceMap.json
```

Recommended conventions:

- Put B4X++ source in `src-b4xpp`.
- Put contracts in `src-b4xpp/contracts`.
- Put reusable classes in folders such as `models`, `core`, `objects`, `services`.
- Put optional library resources in `src-b4xpp/Files` and reference them with `#LibraryFilesDir`.
- Use `generated-b4x` for inspection output.
- Use `b4x-ide-projects` for synchronized B4A/B4J/B4i projects.
- Use `b4x-libs` for generated `.b4xlib` packages.

---

## 3. VS Code commands available in v0.3.3

The extension contributes these command-palette actions:

```text
B4X++: Generate .bas Files
B4X++: Create Example Project
B4X++: Open Generated Folder
B4X++: Create B4A/B4J/B4i Project
B4X++: Sync #Project
B4X++: Build .b4xlib
B4X++: Remap B4X Compiler / Runtime Errors
B4X++: Generate Debug Bundle
B4X++: Run B4J Build Command + Remap Errors
B4X++: Refresh IntelliSense Index
B4X++: Validate B4XLib / CustomViews
```

Recommended workflow:

1. Write or update `.bx` files.
2. Run `B4X++: Generate .bas Files` for quick generated-output inspection.
3. Run `B4X++: Sync #Project` when a `#Project` directive exists.
4. Open the generated B4X project in B4A/B4J/B4i for compilation.
5. Run `B4X++: Build .b4xlib` for reusable libraries or CustomViews.
6. Use `B4X++: Remap B4X Compiler / Runtime Errors` to map generated `.bas` errors back to `.bx` source.

---

## 4. VS Code settings

Known configuration keys:

```json
{
  "b4xpp.sourceDir": "src-b4xpp",
  "b4xpp.outputDir": "generated-b4x",
  "b4xpp.mainModuleName": "",
  "b4xpp.addGeneratedHeader": true,
  "b4xpp.overwriteGeneratedFiles": true,
  "b4xpp.includeTimestamp": false,
  "b4xpp.projectDir": "b4x-ide-projects",
  "b4xpp.packageName": "b4xpp.example",
  "b4xpp.mobileMainModuleName": "B4XPPMain",
  "b4xpp.b4xlibDir": "b4x-libs",
  "b4xpp.b4jBuildCommand": "",
  "b4xpp.writeLineSourceMap": true,
  "b4xpp.enableSemanticDiagnostics": true
}
```

For B4J build remapping, `b4xpp.b4jBuildCommand` can use placeholders:

```json
{
  "b4xpp.b4jBuildCommand": "java -jar C:/B4J/B4JBuilder.jar {project}"
}
```

Supported placeholders:

```text
{project}
{workspace}
{projectDir}
```

---

## 5. Supported top-level project directives

Use these directives in a main `.bx` file such as `Demo.bx` or `Library.bx`.

```vb
#Project B4J-NonUI AnimalDemo
#Package b4xpp.examples.animals
#ProjectDir b4x-ide-projects/AnimalDemo-b4j-nonui
#MainModule Main

#B4XLib AnimalComponents
#Version 1.00
#Author B4X++ Team
#B4XLibDir b4x-libs
#SupportedPlatforms B4A, B4J, B4i

#DependsOn XUI
#B4JDependsOn jXUI
#B4ADependsOn XUI
#B4iDependsOn iXUI
#LibraryFilesDir src-b4xpp/Files

#Include "contracts/IAnimal.bx"
#Include "models/Animal.bx"
#Include "models/Dog.bx"
```

Supported `#Project` platforms:

```text
B4J-NonUI
B4J-UI
B4A
B4i
```

The transpiler also accepts aliases such as `B4J`, `B4J-Console`, `Android`, and `iOS`, but agents should prefer the canonical platform names above.

Rules:

- `#Project` controls B4A/B4J/B4i project synchronization.
- `#MainModule` collects top-level Subs into the named generated main module.
- `#B4XLib` controls `.b4xlib` generation.
- `#Version` should use a B4X-friendly numeric format, such as `1.00` or `0.30`.
- `#SupportedPlatforms` should list at least one of `B4A`, `B4J`, `B4i`.
- `#Include` can use relative paths and may include `.bx` extension explicitly.
- Circular includes are diagnostics.
- Missing include files are errors.

---

## 6. Supported module forms

### 6.1 Class modules

Syntax:

```vb
#Class Animal Abstract Implements IAnimal

#Property Public Name As String = "Unknown"

#Constructor(Name As String)
    mName = Name
#End Constructor

Public Virtual Sub Speak As String
    Return "I am " & mName
End Sub

#End Class
```

Supported class modifiers:

```text
Abstract
Final
```

Supported class relationships:

```vb
#Class Dog Extends Animal Final
#Class Animal Implements IAnimal
#Class ButtonComponent Extends BaseComponent Implements IRenderable, IIdentifiable
```

Important: `Extends`, `Implements`, `Abstract`, and `Final` are used inside the `#Class` line. Do not generate unsupported standalone directives such as `#Extends Parent` unless the project explicitly adds support for them later.

### 6.2 Interfaces

Interfaces are metadata contracts. They are used for diagnostics, override checks and polymorphic dispatch. They are not emitted as native B4X interface modules.

```vb
#Interface IAnimal
Sub Speak As String
Sub Move(Distance As Int) As String
#End Interface
```

Rules:

- A class can implement one or more interfaces.
- Missing required interface methods are errors.
- Unknown interfaces are warnings in some contexts.

### 6.3 Static code modules

Use `#StaticCode` for B4X-style static modules:

```vb
#StaticCode B4XClockMath

Public Sub DegToRad(Degrees As Double) As Double
    Return Degrees * cPI / 180
End Sub

#End StaticCode
```

Generated output is a classic B4X `Type=StaticCode` module.

### 6.4 Main module

Use `#MainModule` to collect top-level Subs:

```vb
#MainModule Main

Sub AppStart (Args() As String)
    Log("Hello from B4X++")
End Sub
```

Without `#MainModule`, top-level code is not generated into a main module unless `b4xpp.mainModuleName` is configured.

---

## 7. Inheritance and flattening rules

B4X++ does not modify the B4X compiler. Inheritance is generated by flattening inherited fields, properties, methods, `#DesignerProperty`, and `#Event` directives into the final child `.bas` module.

Example:

```vb
#Class Dog Extends Animal Final

#Constructor(Name As String)
    Super.Initialize(Name)
#End Constructor

Public Override Sub Speak As String
    Return Super.Speak & ": dog"
End Sub

#End Class
```

Generated shape:

```vb
Public Sub B4XPP_Super_Animal_Initialize(Name As String)
    mName = Name
End Sub

Public Sub Initialize(Name As String)
    B4XPP_Super_Animal_Initialize(Name)
End Sub
```

Rules:

- The child `.bas` should not require a runtime `b4xpp_super` parent object field.
- Parent implementations used by `Super.Method` are renamed internally as `B4XPP_Super_<Parent>_<Method>`.
- Inherited `Private` fields are renamed during flattening, for example `B4XPP_Private_Parent_mSecret`.
- `Protected` fields keep their inherited source name but are emitted as B4X-compatible `Private`.
- Field and method collisions are diagnostics; inherited conflicting members may be skipped or renamed depending on context.
- A class cannot extend a `Final` class.
- Circular inheritance is an error.
- Missing parent class is an error.

---

## 8. Method modifiers and visibility

Supported method visibility:

```text
Public
Protected
Private
```

Supported method modifiers:

```text
Virtual
Override
Abstract
Final
```

Examples:

```vb
Public Virtual Sub Refresh
End Sub

Protected Virtual Sub RefreshInternal
End Sub

Public Override Sub Refresh
    Super.Refresh
End Sub

Public Final Sub ComponentType As String
    Return "Button"
End Sub

Public Abstract Sub Render(Theme As String) As String
```

Rules:

- `Protected` is a B4X++ source-level concept and is emitted as `Private` in generated `.bas`.
- `Protected` members are accessible in the declaring class and descendants only.
- `Private` members are accessible only in their declaring class.
- `Private Virtual`, `Private Override`, and overriding a private parent method are errors.
- Overriding a `Final` parent method is an error.
- `Override` without a matching parent method is an error.
- Signature mismatch during override is a warning or error depending on context.
- Avoid relying on B4X native inheritance; generated `.bas` must remain classic B4X.

---

## 9. Constructors and overloads

B4X++ constructors use `#Constructor` blocks and generate B4X `Initialize`, `Initialize2`, `Initialize3`, etc.

```vb
#Class Person

#Constructor
#End Constructor

#Constructor(Name As String)
#End Constructor

#Constructor(Name As String, Age As Int)
#End Constructor

#End Class
```

Generated B4X:

```vb
Public Sub Initialize
End Sub

Public Sub Initialize2(Name As String)
End Sub

Public Sub Initialize3(Name As String, Age As Int)
End Sub
```

Call rewriting:

```vb
p.Initialize("Jane")      ' generated as p.Initialize2("Jane")
p.Initialize("Jane", 12)  ' generated as p.Initialize3("Jane", 12)
```

Rules:

- Constructor overload resolution is based on parameter count only.
- Same-arity constructor overloads are errors.
- `Super.Initialize(...)` resolves to the correct generated parent constructor during flattening.

---

## 10. Method overloads

Safe method overloads are supported when the parameter count is different.

```vb
Public Sub Label As String
    Return "person"
End Sub

Public Sub Label(Prefix As String) As String
    Return Prefix
End Sub
```

Generated B4X:

```vb
Public Sub Label As String
    Return "person"
End Sub

Public Sub Label2(Prefix As String) As String
    Return Prefix
End Sub
```

Call rewriting:

```vb
Log(p.Label("Ms."))  ' generated as Log(p.Label2("Ms."))
```

Rules:

- Overload resolution is based on parameter count only.
- Same-arity overloads are rejected because type-based overload resolution is not implemented.
- Overloads without explicit visibility are still renamed correctly.
- `Super.Method(...)` resolves to the correct overload when possible.

---

## 11. Properties

B4X++ properties generate backing fields and B4X-style `getX` / `setX` accessors.

```vb
#Property Public Text As String = ""
#Property Protected AngleDegrees As Double = 0
#Property Private CacheKey As String = ""
#Property Public ReadOnly IsRunning As Boolean = False
#Property Public WriteOnly Secret As String
```

Generated shape:

```vb
Private mText As String = ""

Public Sub getText As String
    Return mText
End Sub

Public Sub setText(B4XPP_Value As String)
    mText = B4XPP_Value
End Sub
```

Rules:

- Default values are supported.
- Use B4X-compatible generated declaration syntax.
- Setter parameters may be renamed internally to avoid B4X parameter/global name hiding errors.
- `ReadOnly` generates only getter unless a custom setter is explicitly present.
- `WriteOnly` generates only setter unless a custom getter is explicitly present.
- `Protected` accessors are emitted as `Private` in generated B4X.

---

## 12. Custom property accessors and computed properties

B4X++ supports custom getters and setters.

```vb
#Property Public Text As String = ""

Public Get Text As String
    Return mText.ToUpperCase
End Get

Public Set Text(Value As String)
    If Value = Null Then Value = ""
    mText = Value.Trim
End Set
```

Generated shape:

```vb
Private mText As String = ""

Public Sub getText As String
    Return mText.ToUpperCase
End Sub

Public Sub setText(Value As String)
    If Value = Null Then Value = ""
    mText = Value.Trim
End Sub
```

Computed properties are also supported without `#Property`:

```vb
Public Get IsReady As Boolean
    Return True
End Get

Private Set DebugName(Name As String)
End Set
```

Rules:

- A custom getter replaces the auto-generated getter.
- A custom setter replaces the auto-generated setter.
- If only one accessor is custom, B4X++ generates the missing accessor.
- Custom setters must declare exactly one parameter.
- Custom getters without return type may generate `Object` and should be avoided.

---

## 13. Polymorphism and dispatch

B4X++ supports two polymorphism styles.

### 13.1 Natural polymorphism

```vb
Dim dogInstance As Dog
dogInstance.Initialize("Rex")

Dim animalInstance As Animal
animalInstance = dogInstance
Log(animalInstance.Speak)
```

When the assigned class extends the declared type, B4X++ generates the base variable as `Object` and uses runtime dispatch.

Generated shape:

```vb
Dim animalInstance As Object
animalInstance = dogInstance
Log(B4XPP_Runtime.Dispatch(animalInstance, "Speak", B4XPP_Runtime.Args0))
```

### 13.2 Explicit `Poly`

```vb
Dim renderable As Poly IRenderable
renderable = labelComponent
Log(renderable.Render("dark", 2, True))
```

Generated shape:

```vb
Log(B4XPP_Runtime.Dispatch(renderable, "Render", B4XPP_Runtime.Args3("dark", 2, True)))
```

Rules:

- `Poly` variables generate `Object` variables in B4X.
- Runtime dispatch is generated only when needed.
- `B4XPP_Runtime.bas` is included only when `Poly` or implicit dynamic dispatch is used.
- B4X++ generated classes use `B4XPP_Dispatch` with `Args As List`, so they support more than two user arguments.
- External non-B4X++ object fallback uses B4X `CallSub`, `CallSub2`, and `CallSub3`, so it is limited to zero, one or two user arguments.

---

## 14. `Super`, `This`, and `Me`

Supported forms:

```vb
Super.Initialize(Name)
Super.Speak
This.Refresh
Me.Refresh
```

Rules:

- `Super.Method` is valid only in a class with `Extends`.
- `Super.Method` resolves to flattened parent implementations.
- `This.` and `Me.` are source-level conveniences and should resolve to current-class members.
- Member completion and navigation respect visibility rules in v0.3.3.

---

## 15. B4XLib and CustomView guidance

For reusable components and CustomViews, prefer a `.bx` library header like:

```vb
#B4XLib B4XAnalogClock
#Version 0.30
#Author Your Name
#B4XLibDir b4x-libs
#SupportedPlatforms B4A, B4J, B4i
#DependsOn XUI
#B4JDependsOn jXUI
#B4ADependsOn XUI
#B4iDependsOn iXUI
#LibraryFilesDir src-b4xpp/Files
```

CustomView classes should usually expose:

```vb
Public Sub Initialize(Callback As Object, EventName As String)
End Sub

Public Sub DesignerCreateView(Base As Object, Lbl As Label, Props As Map)
End Sub

Private Sub Base_Resize(Width As Double, Height As Double)
End Sub
```

Recommended fields:

```vb
Public mBase As B4XView
Public Tag As Object
Private xui As XUI
```

Designer directives:

```vb
#DesignerProperty: Key: Title, DisplayName: Title, FieldType: String, DefaultValue: Untitled
#Event: Click
#Event: ValueChanged (Value As Int)
```

Rules:

- Inherited `#DesignerProperty` and `#Event` directives must be propagated into the final generated CustomView class.
- In generated `.b4xlib` modules, designer directives should appear immediately after `@EndOfDesignText@`, matching common XUI custom view patterns.
- Missing `DesignerCreateView` or `Initialize(Callback As Object, EventName As String)` is a serious CustomView warning or error depending on whether the class is meant to be used by the Designer.
- `Base_Resize` is recommended but may be a warning rather than a hard error.
- `mBase` and `Tag` are compatibility hints, not always hard errors.

### Designer color properties

For `FieldType: Color`, avoid direct assignment from `Props.GetDefault(...)` to `Int` in CustomViews.

Prefer:

```vb
mFaceColor = xui.PaintOrColorToColor(Props.GetDefault("FaceColor", mFaceColor))
```

For B4J `.b4xlib` CustomViews, the Designer can pass colors as strings such as `0xffffffff`. For maximum safety, use a helper that handles strings like:

```text
0xAARRGGBB
#AARRGGBB
RRGGBB
```

and otherwise falls back to `xui.PaintOrColorToColor(...)`.

---

## 16. Generated output expectations

Generated `.bas` files should include a header when configured:

```vb
' AUTO-GENERATED BY B4X++ v0.3.2
' DO NOT EDIT THIS FILE DIRECTLY
' GeneratorVersion: 0.3.2
```

Expected outputs:

- `#Class Name` generates `Name.bas`.
- `#StaticCode ModuleName` generates `ModuleName.bas` as a static module.
- `#MainModule Main` generates `Main.bas` from top-level Subs.
- `#Interface` does not generate a native B4X module.
- `B4XPP_Runtime.bas` is generated only when polymorphic dispatch is required.
- `.b4xpp/symbols.json` and `.b4xpp/sourceMap.json` are generated for editor tooling and error remapping.

Generated `.bas` must not contain unsupported B4X++ syntax such as:

```text
#Class
#Interface
#Constructor
#Property
#End Class
#End Interface
Protected
As Poly
```

unless the line is inside a generated comment.

---

## 17. Diagnostics policy

Agents should classify issues as follows.

### Hard errors

Fix before expecting valid generated output:

- Invalid class/module/interface name.
- Missing include file.
- Circular include.
- Unknown or invalid `#Project` platform.
- Duplicate class, interface or static module in project.
- Missing parent class.
- Circular inheritance.
- Extending a final class.
- Missing required interface methods.
- Invalid `Override` with no parent method.
- Overriding a `Private` or `Final` parent method.
- `Private Virtual` or `Private Override`.
- Same-arity constructor overloads.
- Same-arity method overloads.
- Invalid custom setter with zero or multiple parameters.
- Invalid `#DesignerProperty` syntax when required fields are missing.
- Invalid `#Event` syntax.

### Warnings

Usually generate output, but review carefully:

- Missing `#End Class`, `#End Interface`, or `#End StaticCode` closed implicitly.
- `#End Class`, `#End Interface`, or `#End StaticCode` without matching opener.
- Unknown interface in some contexts.
- Override parent method exists but is not marked `Virtual`, `Abstract`, or `Override`.
- Override signature mismatch.
- Override return type mismatch.
- Multiple `#Project` directives; first one is used.
- Unknown `Poly` type.
- `Super` used in a class without `Extends`.
- Flattening field or method collisions.
- Parameter renamed because it conflicts with a generated field/global/property.
- Duplicate `#DesignerProperty` key.
- CustomView missing recommended `Base_Resize`.
- CustomView color reads that do not use `xui.PaintOrColorToColor(...)` or a safe helper.
- Missing B4XLib manifest hints such as `#Version`, `#Author`, or `#SupportedPlatforms`.

---

## 18. IntelliSense, navigation and editor features in v0.3.3

B4X++ v0.3.3 is mainly an editor-quality release. Generated `.bas` output remains compatible with v0.3.2.

Supported editor behaviors:

- Workspace indexing of `src-b4xpp/**/*.bx`.
- Context-aware completions inside normal code blocks.
- Directive suggestions only in `#...` contexts.
- Type suggestions mainly in type positions such as `As`, `Extends`, `Implements`, and `Poly`.
- Current-scope variables, parameters, fields, properties and visible Subs in expression contexts.
- Member completion after `Super.`, `This.`, `Me.`, and receiver variables.
- Visibility-aware suggestions for `Public`, `Protected`, and `Private` members.
- Override candidate snippets.
- Hover documentation for methods, properties, fields and classes.
- Signature help for B4X++ methods and common XUI/B4X APIs.
- Go to Definition for classes, interfaces, static modules, fields, properties, methods, locals, parameters, `Super.Method`, `This.Method`, `Me.Method`, and `#Include`.
- Find References for B4X++ symbols.
- Safe Rename for local variables, parameters, fields, properties and methods.
- Type/module rename is intentionally not enabled yet.
- Auto Include quick fix for project types referenced but not included.
- Semantic diagnostics for missing includes, missing parent classes, bad overrides and inaccessible `Protected` / `Private` member calls.

---

## 19. Debugging and source maps

Generation writes metadata under `.b4xpp`:

```text
.b4xpp/sourceMap.json
.b4xpp/symbols.json
```

Use these commands:

```text
B4X++: Remap B4X Compiler / Runtime Errors
B4X++: Generate Debug Bundle
B4X++: Run B4J Build Command + Remap Errors
```

Rules for agents:

- When a B4X compiler error references generated `.bas`, map it back to the `.bx` source before editing.
- Prefer fixing `.bx` source rather than generated `.bas`.
- Source maps are best-effort. Directly transformed lines map better than generated helper lines.
- Debug bundles should include output hashes, diagnostics and references to source map / symbol metadata.

---

## 20. Known limitations and unsupported features

Do not generate these unless the project explicitly adds support later:

```text
Native namespaces
Generics
Multiple inheritance
Native B4X interfaces
Native B4X protected members
Type-based overload resolution
Type/module rename across the full workspace
External .b4xlib semantic indexing
Full compiler-grade language server behavior
Designer/layout generation
Automatic final app signing / packaging
```

Clarifications:

- Interfaces are B4X++ metadata contracts, not native B4X interface modules.
- Inheritance is flattening, not native runtime inheritance.
- `Protected` is source-level metadata lowered to `Private` in B4X.
- Method and constructor overloads resolve by parameter count only.
- External non-B4X++ dispatch fallback is limited by B4X `CallSub`, `CallSub2`, and `CallSub3`.

---

## 21. Recommended code style

Use clear, B4X-friendly code.

Preferred:

```vb
Dim dogInstance As Dog
Dim catInstance As Cat
Dim animalInstance As Animal
Dim clockView As B4XAnalogClock
```

Avoid:

```vb
Dim Dog As Dog
Dim Cat As Cat
Dim Animal As Animal
```

Prefer explicit visibility in reusable classes:

```vb
Public Sub Initialize
End Sub

Private Sub BuildCacheKey As String
End Sub

Protected Sub RefreshInternal
End Sub
```

Prefer small classes and `#Include` rather than one huge `.bx` file.

Prefer B4J Non-UI examples for quick language testing:

```vb
#Project B4J-NonUI Demo
#MainModule Main
```

Prefer `.b4xlib` examples for component / CustomView validation.

---

## 22. Minimal valid examples

### 22.1 Basic B4J Non-UI example

```vb
#Project B4J-NonUI AnimalDemo
#Package b4xpp.examples.animals
#ProjectDir b4x-ide-projects/AnimalDemo-b4j-nonui
#MainModule Main

#Include "models/Animal.bx"
#Include "models/Dog.bx"

Sub AppStart (Args() As String)
    Dim dogInstance As Dog
    dogInstance.Initialize("Rex")

    Dim animalInstance As Animal
    animalInstance = dogInstance
    Log(animalInstance.Speak)
End Sub
```

```vb
#Class Animal

#Property Public Name As String = "Unknown"

#Constructor(Name As String)
    mName = Name
#End Constructor

Public Virtual Sub Speak As String
    Return "Animal: " & mName
End Sub

#End Class
```

```vb
#Class Dog Extends Animal Final

#Constructor(Name As String)
    Super.Initialize(Name)
#End Constructor

Public Override Sub Speak As String
    Return Super.Speak & " says woof"
End Sub

#End Class
```

### 22.2 Interface + explicit polymorphism

```vb
#Interface IRenderable
Sub Render(Theme As String, Scale As Int, Enabled As Boolean) As String
#End Interface
```

```vb
#Class LabelComponent Implements IRenderable

Public Sub Render(Theme As String, Scale As Int, Enabled As Boolean) As String
    Return Theme & ":" & Scale & ":" & Enabled
End Sub

#End Class
```

```vb
Dim renderableInstance As Poly IRenderable
renderableInstance = labelComponent
Log(renderableInstance.Render("dark", 2, True))
```

---

## 23. Verification checklist for agents

Before delivering B4X++ changes, verify as much of this as possible:

```text
[ ] .bx source remains the source of truth.
[ ] Generated .bas contains no unsupported B4X++ syntax.
[ ] #If B4A / #If B4J / #If B4i / #If Java blocks are preserved.
[ ] #Include paths are valid and relative.
[ ] Class names, file names and module names do not create B4X warning #30 in examples.
[ ] Constructors generate Initialize / Initialize2 / Initialize3 as expected.
[ ] Method overloads differ by parameter count only.
[ ] Same-arity overloads are rejected or refactored.
[ ] Overrides match parent methods.
[ ] Super.Method resolves to flattened B4XPP_Super_* method.
[ ] Inherited Private members are renamed during flattening.
[ ] Protected members are not accessed from outside class/descendants.
[ ] Properties generate backing fields and safe getter/setter names.
[ ] Custom getters/setters preserve body logic.
[ ] Polymorphism generates B4XPP_Runtime only when needed.
[ ] CustomView classes expose Initialize and DesignerCreateView when intended for Designer use.
[ ] Designer color properties use PaintOrColorToColor or a safe color helper.
[ ] B4XLib metadata contains #B4XLib, #Version, #Author and #SupportedPlatforms.
[ ] .b4xlib output is tested in every target platform listed.
[ ] B4X compiler/runtime errors are remapped to .bx before fixing.
```

---

## 24. Regression scenarios to preserve

When editing the transpiler or generating major examples, keep these scenarios working:

1. Basic Animal demo with `Animal`, `Dog`, `Cat`, `Bird`.
2. Natural polymorphism: `Dim animalInstance As Animal` assigned from `Dog`.
3. Explicit `Poly IInterface` dispatch with three or more arguments.
4. Inheritance flattening with `Super.Initialize` and `Super.Method`.
5. `Protected` fields/methods visible in descendants but not from `#MainModule`.
6. Inherited `Private` fields/methods renamed during flattening.
7. Custom properties with generated backing fields and custom getter/setter bodies.
8. Computed properties without `#Property`.
9. Constructor overloads generating `Initialize`, `Initialize2`, `Initialize3`.
10. Method overloads generating `Method`, `Method2`, etc.
11. Same-arity method overload diagnostic.
12. `#StaticCode` module generation.
13. B4XAnalogClock CustomView `.b4xlib` build without unnecessary `B4XPP_Runtime.bas`.
14. Inherited `#DesignerProperty` and `#Event` propagation.
15. B4J Designer color values such as `0xffffffff` handled safely.

---

## 25. Agent response pattern

When an AI agent answers B4X++ implementation requests, prefer this pattern:

1. State whether the requested feature is already supported, partially supported, or unsupported.
2. Identify the `.bx` source file(s) to change.
3. Explain the generated `.bas` consequence only when useful.
4. Provide code in B4X++ `.bx` first.
5. Mention validation steps: Generate `.bas`, Sync `#Project`, Build `.b4xlib`, or Remap errors.
6. Avoid claiming final B4X IDE compilation success unless it was actually run.

Example answer framing:

```text
This should be implemented in the .bx source, not directly in generated .bas.
The transpiler will flatten the parent class and rewrite Super.Initialize(...) to the generated B4XPP_Super_* method.
After the change, run B4X++: Generate .bas Files, then B4X++: Sync #Project.
```
