## v0.3.3: Scoped IntelliSense fix

B4X++ v0.3.3 improves completion inside real code blocks. Completion is now context-aware:

- inside `If x = ...`, method calls and assignments, VS Code proposes current-scope variables, parameters, fields, properties and visible Subs;
- `#Class`, `#Property`, `#Include` and other directives are suggested only in `#...` contexts;
- classes and B4X/XUI types are suggested mainly in type positions such as `As`, `Extends`, `Implements` and `Poly`;
- `Super.`, `This.`, `Me.` and `receiver.` member completion still uses visibility rules;
- the legacy completion provider is no longer activated, so old generic suggestions do not mix with the v0.3 IntelliSense engine.

This is an editor-quality release only. Generated B4X output remains compatible with v0.3.2.

# B4X++ for Visual Studio Code


## v0.3.2: Navigation + B4XLib / CustomView assistant

This release also includes the navigation and B4XLib assistant features that were planned after v0.3.0.

### Navigation

- Go to Definition for classes, interfaces, static modules, fields, properties, methods, local variables and parameters.
- Go to Definition for `Super.Method`, `This.Method`, `Me.Method` and `#Include "file.bx"`.
- Find References for B4X++ symbols.
- Safe Rename for local variables, parameters, fields, properties and methods. Type/module rename is intentionally not enabled yet.
- Auto Include quick fix for existing project types that are referenced but not included in the current `.bx` file.

### CustomView / B4XLib assistant

Command:

```text
B4X++: Validate B4XLib / CustomViews
```

The assistant checks common CustomView and B4XLib mistakes before the code reaches B4A / B4J / B4i:

- `DesignerCreateView(Base As Object, Lbl As Label, Props As Map)` presence.
- `Initialize(Callback As Object, EventName As String)` presence.
- `Base_Resize(Width As Double, Height As Double)` recommendation.
- `Public mBase As B4XView` and `Public Tag As Object` compatibility hints.
- `#DesignerProperty` syntax, duplicate keys and known `FieldType` values.
- `#Event` syntax and parameter shape.
- Designer color reads that should use `xui.PaintOrColorToColor(...)` or a helper.
- `#B4XLib`, `#Version`, `#Author` and `#SupportedPlatforms` manifest hints.

A quick fix is available for common Designer color reads:

```vb
mFaceColor = Props.GetDefault("FaceColor", mFaceColor)
```

can be rewritten to:

```vb
mFaceColor = xui.PaintOrColorToColor(Props.GetDefault("FaceColor", mFaceColor))
```

## v0.3.2: Constructor / Method Overloads + IntelliSense

B4X++ v0.3.2 adds source-level overloads while generating classic B4X-compatible `Initialize`, `Initialize2`, `Method`, `Method2`, ... names. IntelliSense and signature help understand these overloads.

### Constructor overloading

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

Generated B4X uses:

```vb
Public Sub Initialize
End Sub

Public Sub Initialize2(Name As String)
End Sub

Public Sub Initialize3(Name As String, Age As Int)
End Sub
```

Calls are rewritten automatically:

```vb
p.Initialize("Jane")      ' -> p.Initialize2("Jane")
p.Initialize("Jane", 12)  ' -> p.Initialize3("Jane", 12)
```

`Super.Initialize(...)` is resolved to the correct generated parent constructor during flattening.

### Safe method overloads

B4X++ also supports method overloads when the parameter count is different:

```vb
Public Sub SetValue(Value As String)
End Sub

Public Sub SetValue(Value As String, Format As String)
End Sub
```

Generated B4X:

```vb
Public Sub SetValue(Value As String)
End Sub

Public Sub SetValue2(Value As String, Format As String)
End Sub
```

Same-arity overloads are rejected for now because v0.3.2 does not yet perform stable type-based overload resolution.

As of v0.3.2, overloads without an explicit visibility modifier are also renamed correctly:

```vb
Sub TestDraw()
End Sub

Sub TestDraw(i As Int)
End Sub
```

Generated B4X uses `TestDraw` and `TestDraw2`.

## v0.3.0: Language Intelligence

B4X++ v0.3.0 starts the IntelliSense-focused track. The goal is to make `.bx` files comfortable to edit directly in VS Code while preserving the v0.1/v0.2 transpilation workflow.

New editor features include:

- workspace indexing of `src-b4xpp/**/*.bx`;
- completion after `.` for classes, inherited members, properties, fields, interfaces and static modules;
- visibility-aware suggestions for `Public`, `Protected` and `Private`;
- `Super.` and `This.` / `Me.` completion;
- override candidate snippets;
- type completion for B4X++ classes and common B4X/XUI types;
- hover documentation for methods, properties, fields and classes;
- signature help for B4X++ methods and common XUI/B4X APIs;
- document/workspace symbols;
- semantic diagnostics for missing includes, missing parent classes, bad overrides, inaccessible protected/private members and common CustomView color-property mistakes.

Refresh the index manually with:

```text
B4X++: Refresh IntelliSense Index
```

The semantic diagnostics can be disabled if needed:

```json
{
  "b4xpp.enableSemanticDiagnostics": false
}
```

External `.b4xlib` indexing is not included yet. Unknown external B4X types are warnings in this release and will be improved in a future version.


## v0.2.2: source mapping and debug workflow

B4X++ now writes `.b4xpp/sourceMap.json` and `.b4xpp/symbols.json` whenever files are generated. The source map is used by the new debugging commands:

- **B4X++: Remap B4X Compiler / Runtime Errors**: paste a B4J/B4A/B4i compiler log or runtime stack trace and jump back to the matching `.bx` source line.
- **B4X++: Generate Debug Bundle**: creates `.b4xpp/debug-bundle.json` with output hashes, diagnostics and references to the source map/symbols metadata.
- **B4X++: Run B4J Build Command + Remap Errors**: runs your configured B4J build command and remaps generated `.bas` errors back to `.bx`. Configure `b4xpp.b4jBuildCommand` first.

Example B4J build command setting:

```json
{
  "b4xpp.b4jBuildCommand": "java -jar C:/B4J/B4JBuilder.jar {project}"
}
```

Supported placeholders: `{project}`, `{workspace}`, `{projectDir}`.

The source map is best-effort in v0.2.2: unchanged and directly transformed lines map accurately; generated helper lines fall back to the nearest source context.



## v0.2.1 custom property accessors

B4X++ `#Property` now supports custom getters and setters. This is useful for component developers who need validation, normalization or redraw logic inside setters while keeping the concise property declaration.

```vb
#Property Public Text As String = ""

Public Set Text(Value As String)
    If Value = Null Then Value = ""
    mText = Value.Trim
    Refresh
End Set
```

B4X++ generates the backing field and the missing getter automatically, while using the custom setter body:

```vb
Private mText As String = ""

Public Sub getText As String
    Return mText
End Sub

Public Sub setText(Value As String)
    If Value = Null Then Value = ""
    mText = Value.Trim
    Refresh
End Sub
```

You can also create computed properties without `#Property`:

```vb
Public Get IsRunning As Boolean
    Return mTimer.Enabled
End Get
```

Visibility works as expected:

```vb
Protected Get AngleDegrees As Double
    Return mAngleDegrees
End Get
```

`Protected` is a B4X++-only concept and is emitted as `Private` in the generated `.bas` file.

B4X++ is an experimental precompiler / transpiler layer for the B4X ecosystem. It lets you write `.bx` files with a small set of OOP-oriented extensions, then generates classic B4X `.bas` modules that can be opened and compiled with the official B4A, B4J or B4i IDE.

The project is intentionally **not** a replacement for the B4X IDE. The first practical target is B4X component and library developers who want less repetition, cleaner shared code, simple inheritance-like patterns, interfaces, explicit polymorphism and direct `.b4xlib` packaging.

```text
B4X++ source (.bx)
        ↓
VS Code extension / transpiler
        ↓
Classic B4X modules (.bas)
        ↓
B4A / B4J / B4i IDE or .b4xlib package
```

### v0.2 visibility diagnostics

B4X++ v0.2 validates visibility before generating B4X code. For example, this is now rejected in VS Code / transpilation:

```vb
#Class Dog Extends Animal
Protected Sub GetType As String
    Return "Dog"
End Sub
#End Class

Sub AppStart (Args() As String)
    Dim dogInstance As Dog
    Dim t As String = dogInstance.GetType() ' error: GetType is Protected
End Sub
```

`Protected` members are visible only inside their declaring class and descendants. The generated `.bas` still lowers `Protected` to B4X-compatible `Private`, so B4X never receives an unsupported `Protected` keyword.

## Current status

This public preview is version **0.2**. It is an early preview. It is already useful for experimenting with component-style code, but generated output should still be reviewed in the B4X IDE. Designer workflows, layouts, visual forms and final platform settings remain the responsibility of the official B4X IDE.

## Main features

- Syntax highlighting for `.bx` files.
- Snippets for project headers, classes, interfaces, constructors, properties, polymorphic variables and `.b4xlib` metadata.
- `#Include` support with Ctrl+Click / F12 navigation.
- Symbol navigation for classes, interfaces, variables, inherited methods, `Super`, `This` and many member calls.
- Generation of classic `.bas` files.
- Generation of starter B4J / B4A / B4i projects.
- `#Project` based synchronization, so the generated `.bas` files are written directly into the project used by the B4X IDE.
- Explicit polymorphism through `Poly` variables.
- Advanced dispatch for B4X++ generated classes, including methods with more than two arguments.
- `.b4xlib` build command for reusable component libraries.
- First-class B4X++ visibility modifiers: `Public`, `Protected`, and `Private`.
- Metadata outputs: `.b4xpp/symbols.json` and `.b4xpp/sourceMap.json`.
- Basic context-aware completion for visibility keywords, `Super.`, `This.`, members and `Override` candidates.

## Installation

Install the `.vsix` file from VS Code:

1. Open **Extensions**.
2. Click the `...` menu.
3. Choose **Install from VSIX...**.
4. Select the downloaded `b4xpp-vscode-extension-v0.2.0.vsix` file.
5. Run **Developer: Reload Window**.

After installation, open a normal project folder, not the extension folder itself, unless you are developing the extension.

## Recommended folder structure

```text
MyComponentProject/
├─ src-b4xpp/
│  ├─ Demo.bx
│  ├─ contracts/
│  │  └─ IAnimal.bx
│  └─ models/
│     ├─ Animal.bx
│     ├─ Dog.bx
│     ├─ Cat.bx
│     └─ Bird.bx
├─ b4x-ide-projects/
│  └─ AnimalDemo-b4j-nonui/
│     ├─ AnimalDemo.b4j
│     ├─ Animal.bas
│     ├─ Dog.bas
│     ├─ Cat.bas
│     ├─ Bird.bas
│     ├─ Main.bas
│     └─ B4XPP_Runtime.bas
└─ b4x-libs/
   └─ AnimalComponents.b4xlib
```

`src-b4xpp` is the source of truth. Generated `.bas` files should not be edited manually.

## Commands

Open the Command Palette with `Ctrl+Shift+P`, then search for `B4X++`.

| Command | Purpose |
|---|---|
| `B4X++: Create Example Project` | Create a basic OOP sample, a language showcase sample, or both GitHub example folders. |
| `B4X++: Generate .bas Files` | Generate `.bas` files into `generated-b4x`. Useful for inspection. |
| `B4X++: Sync #Project` | Generate/synchronize the B4A/B4J/B4i project declared by `#Project`. This is the recommended test workflow. |
| `B4X++: Create B4A/B4J/B4i Project` | Create a project interactively when no `#Project` directive is used. |
| `B4X++: Build .b4xlib` | Package generated modules and optional resources into a `.b4xlib`. |
| `B4X++: Open Generated Folder` | Open the `generated-b4x` folder. |

## Two included examples

This version includes two clean, generic examples. No farm, company or local domain-specific naming is used.

### 1. Basic OOP sample: Animal / Dog / Cat / Bird

Use this one first. It demonstrates a small and familiar hierarchy.

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

#Include "contracts/IAnimal.bx"
#Include "models/Animal.bx"
#Include "models/Dog.bx"
#Include "models/Cat.bx"
#Include "models/Bird.bx"
```

The main module uses natural polymorphism:

```vb
Dim dogInstance As Dog
dogInstance.Initialize("Rex")

Dim animalInstance As Animal
animalInstance = dogInstance
Log(animalInstance.Speak)
Log(animalInstance.Move(3))
```

Generated B4X output uses `B4XPP_Runtime.Dispatch(...)` with runtime argument helpers such as `B4XPP_Runtime.Args0` and `B4XPP_Runtime.Args3(...)`. For B4X++ generated classes, arguments are packed into a `List` and passed to `B4XPP_Dispatch`, so polymorphic calls are not limited to two user arguments.

### 2. Language showcase sample

The showcase example demonstrates most current B4X++ keywords and directives:

- `#Project`
- `#Package`
- `#ProjectDir`
- `#MainModule`
- `#B4XLib`
- `#Version`
- `#Author`
- `#B4XLibDir`
- `#SupportedPlatforms`
- `#DependsOn`
- `#B4JDependsOn`
- `#B4ADependsOn`
- `#B4iDependsOn`
- `#LibraryFilesDir`
- `#Include`
- `#Interface`
- `#Class`
- `#Extends`
- `#Implements`
- `#Abstract`
- `#Final`
- `#Property`
- `#Property ReadOnly`
- `#Property WriteOnly`
- `#Property ... = defaultValue`
- `#Constructor`
- `Virtual Sub`
- `Override Sub`
- `Protected Sub`
- `Abstract Sub`
- `Final Sub`
- `Super.`
- `This.`
- `Poly`


## Generated file versioning

Generated modules now include the generator version in the header:

```vb
' AUTO-GENERATED BY B4X++ v0.1
' DO NOT EDIT THIS FILE DIRECTLY
' GeneratorVersion: 0.1
```

When the extension is about to overwrite existing B4X++ generated files created by another generator version, it shows a warning first. This helps avoid silently mixing generated code from incompatible B4X++ versions.

## Minimal class example

```vb
#Class Animal Abstract Implements IAnimal

#Property ReadOnly Name As String = "Unknown"

#Constructor(Name As String)
    mName = Name
#End Constructor

Virtual Sub Speak As String
    Return "I am " & mName
End Sub

#End Class
```

Generated output becomes a classic B4X class module with `Class_Globals`, a `Public Sub Initialize`, generated property accessors, and normal B4X `Sub` declarations.

## Inheritance pattern: flattened `.bas` output

B4X++ does not modify the B4X compiler. `#Extends` is compiled by **flattening** inherited fields, properties and methods into the generated child `.bas` file. This is especially useful for B4X component / `.b4xlib` developers because the final class contains the inherited `#DesignerProperty` and `#Event` directives needed by the B4X IDE designer.

```vb
#Class Dog Extends Animal Final

#Constructor(Name As String)
    Super.Initialize(Name)
#End Constructor

Override Sub Speak As String
    Return Super.Name & " says woof"
End Sub

#End Class
```

The generated child class does **not** require a runtime parent object field. Parent implementations needed by `Super.Method` are renamed internally:

```vb
Public Sub B4XPP_Super_Animal_Initialize(Name As String)
    mName = Name
End Sub

Public Sub Initialize(Name As String)
    B4XPP_Super_Animal_Initialize(Name)
End Sub
```

Inherited designer directives are propagated to the final class:

```vb
#DesignerProperty: Key: Title, DisplayName: Title, FieldType: String, DefaultValue: Untitled
#Event: Click
```

B4X conditional sections are kept intact:

```vb
#If B4J
    ' B4J-specific code
#Else If B4A
    ' B4A-specific code
#End If
```

## Interfaces

Interfaces are B4X++ metadata contracts. They are not emitted as B4X modules, but they are used for diagnostics, override checks and polymorphic dispatch.

```vb
#Interface IAnimal
Sub Speak As String
Sub Move(Distance As Int) As String
#End Interface
```

A class can implement one or more interfaces:

```vb
#Class Animal Abstract Implements IAnimal
```

The transpiler reports an error when a required interface method is missing.

## Properties

B4X++ properties generate backing fields and B4X-style getters/setters.

```vb
#Property Name As String
#Property ReadOnly Id As String
#Property WriteOnly Secret As String
```

Default values are supported in B4X++:

```vb
#Property Title As String = "Untitled"
#Property Enabled As Boolean = True
#Property Count As Int = 0
#Property AccentColor As Int = 0xFF007ACC
#Property ReadOnly CreatedAt As Long = 0
```

Generated shape:

```vb
Private mTitle As String = "Untitled"

Public Sub getTitle As String
    Return mTitle
End Sub

Public Sub setTitle(Value As String)
    mTitle = Value
End Sub
```

B4X++ intentionally emits B4X-compatible declaration syntax (`Private field = value As Type`) instead of `Private field As Type = value`.

## Constructors

```vb
#Constructor(Name As String)
    mName = Name
#End Constructor
```

becomes:

```vb
Public Sub Initialize(Name As String)
    mName = Name
End Sub
```

## Polymorphism

B4X does not support classic OOP polymorphism like this directly in generated `.bas` files:

```vb
Dim animal As Animal
animal = dogInstance
```

B4X++ lets you write the natural OOP form in `.bx` files when the assigned class extends the declared type:

```vb
Dim animal As Animal
animal = dogInstance
Log(animal.Speak)
```

B4X++ detects that `Dog` extends `Animal` and generates safe B4X code:

```vb
' B4X++ implicit polymorphism: animal As Animal generated As Object with dynamic dispatch.
Dim animal As Object
animal = dogInstance
Log(B4XPP_Runtime.Dispatch(animal, "Speak", B4XPP_Runtime.Args0))
```

You can also force polymorphism explicitly with `Poly`, which is useful with interfaces or contracts:

```vb
Dim renderable As Poly IRenderable
renderable = labelComponent
Log(renderable.Render("dark", 2, True))
```

For B4X++ generated classes, the dispatch path supports any number of arguments:

```vb
Log(renderable.Render("dark", 2, True))
```

becomes:

```vb
Log(B4XPP_Runtime.Dispatch(renderable, "Render", B4XPP_Runtime.Args3("dark", 2, True)))
```

Only the external fallback for non-B4X++ objects is limited to zero, one or two user arguments, because it uses B4X `CallSub`, `CallSub2` and `CallSub3`. Normal B4X++ generated classes are unlimited because they receive all parameters through `Args As List`.

## Building a B4X library

Add library directives to a `.bx` file, usually `Demo.bx` or `Library.bx`:

```vb
#B4XLib MyComponents
#Version 1.00
#Author Your Name
#B4XLibDir b4x-libs
#SupportedPlatforms B4A, B4J, B4i
#DependsOn XUI
#B4JDependsOn jXUI
#B4ADependsOn XUI
#B4iDependsOn iXUI
#LibraryFilesDir src-b4xpp/Files
```

Then run:

```text
B4X++: Build .b4xlib
```

The extension writes:

```text
b4x-libs/MyComponents.b4xlib
```

Main modules are excluded from the `.b4xlib`. Classes, generated runtime modules and optional `Files/` resources are included.

## Generated B4X projects

A project directive controls project generation:

```vb
#Project B4J-NonUI AnimalDemo
#Package b4xpp.examples.animals
#ProjectDir b4x-ide-projects/AnimalDemo-b4j-nonui
#MainModule Main
```

Supported platforms:

```text
B4J-NonUI
B4J-UI
B4A
B4i
```

Then run:

```text
B4X++: Sync #Project
```

The generated `.b4j`, `.b4a` or `.b4i` file can be opened in the matching B4X IDE.

## Navigation support

Ctrl+Click / F12 works for many common cases:

```vb
#Include "models/Dog.bx"   ' opens the included file
#Class Dog Extends Animal   ' Animal jumps to Animal.bx
Super.Initialize(Name)      ' Super jumps to the parent class / method
This.ComponentType          ' Generated as ComponentType and navigates to the current class / method
Dim dog As Dog              ' Dog jumps to Dog.bx
dog.Speak                   ' Speak jumps to Dog.Speak
```

For implicit polymorphic variables and `Poly` variables, the extension tries to follow assignments:

```vb
Dim animal As Animal
animal = dogInstance
Log(animal.Speak)           ' jumps to Dog.Speak when dogInstance is known as Dog

Dim renderable As Poly IRenderable
renderable = labelComponent
Log(renderable.Render("dark", 2, True))
```

This is still a lightweight language service, not a full compiler-grade semantic engine.

## Snippets

Available snippet prefixes include:

```text
project-b4j
project-b4j-ui
project-b4a
project-b4i
b4xpp-header
include
interface
class
extends
implements
main
poly
poly-natural
property
property-ro
property-wo
property-default
property-ro-default
constructor
override
virtual
protected
abstract
final
b4xlib
```

## Recommended workflow for component developers

1. Write reusable code in `src-b4xpp`.
2. Use `#Include` to split classes by topic.
3. Use `#Interface` for contracts.
4. Use `#Class`, `#Extends`, `#Property` and `#Constructor` to reduce boilerplate.
5. Run `B4X++: Sync #Project` to test quickly in B4J Non-UI.
6. Run `B4X++: Build .b4xlib` when the component is ready to test inside a real B4A/B4J/B4i app.
7. Keep the official B4X IDE for designer files, layouts, visual forms and final app compilation.

## Important limitations

- This is a precompiler, not a new B4X compiler.
- Generated `.bas` files should be considered build artifacts.
- Interfaces are metadata contracts; they are not emitted as native B4X interface modules.
- Inheritance is simulated with composition and generated wrappers.
- B4X++ cannot replace the B4X visual designer.
- `.b4xlib` generation is meant for reusable components and should be tested in all target platforms.
- The language service is intentionally lightweight and may not resolve every advanced symbol case.

## Contributing

Good first areas to test and improve:

- Real B4X IDE compilation compatibility.
- `.b4xlib` behavior across B4A, B4J and B4i.
- More language-server features.
- Better diagnostics and Quick Fix actions.
- More B4X-specific project templates.
- Component authoring patterns.

## License

MIT


### Static code modules

Use `#StaticCode ModuleName` / `#End StaticCode` to generate a B4X `Type=StaticCode` module. This is useful when porting existing B4X libraries that expose helpers such as `B4XDaisyVariants.SomeMethod`.


## Build 20260626-1445 note

This build fixes `.b4xlib` packaging when generated modules contain `B4XPP_Dispatch`: the required `B4XPP_Runtime.bas` module is now automatically included.

## v0.1.0 build notes for B4XLib generation

This public preview now keeps `.b4xlib` output conservative by default:

- `B4XPP_Runtime.bas` is generated only when the source actually uses `Poly` or implicit polymorphic dispatch.
- classes without dynamic dispatch do not receive `B4XPP_Dispatch`.
- `Protected` fields in `Class_Globals` are lowered to B4X-compatible `Private` fields in the flattened `.bas` output.
- inherited `#DesignerProperty` and `#Event` directives are moved immediately after `@EndOfDesignText@` when packaging `.b4xlib`, matching the pattern used by XUI custom views.

For custom views, the recommended workflow is:

1. write the component in `src-b4xpp`;
2. run **B4X++: Build .b4xlib**;
3. copy the generated `.b4xlib` from `b4x-libs/` to the B4X Additional Libraries folder;
4. restart B4A/B4J and select the library.



## Generated property setters

B4X++ generates property setters with internal parameter names:

```vb
#Property Value As Int = 0
```

becomes:

```vb
Private mValue As Int = 0

Public Sub getValue As Int
    Return mValue
End Sub

Public Sub setValue(B4XPP_Value As Int)
    mValue = B4XPP_Value
End Sub
```

This avoids B4X compiler errors where a setter parameter name hides the generated property/global name.



## Build 20260626-1735 notes

This build fixes a B4X compiler issue where a generated or inherited method parameter could hide a generated `Class_Globals` field after flattening. B4X++ now renames such parameters safely during generation and rewrites their references inside the method body.


### Designer color properties

When reading `FieldType: Color` designer properties manually, use `xui.PaintOrColorToColor(Props.GetDefault(...))`. B4J Designer can pass color values as strings such as `0xffffffff`, and direct assignment to `Int` can throw a runtime `NumberFormatException`.


## 20260626-1755

- Updated the Designer color diagnostic note. XUI Views normally use `xui.PaintOrColorToColor(Props.Get(...))`, but B4J `.b4xlib` CustomViews can still pass colors as strings such as `0xffffffff`; component authors should use a defensive helper when needed.
- Packaging checked: VSIX contains `extension/package.json`.

## B4X++ v0.2 visibility rules

B4X official does not support inheritance or `Protected`. B4X++ treats visibility as source-level metadata and lowers it to compiler-friendly B4X during flattening.

```vb
#Class BaseComponent

Public mBase As B4XView
Protected mEventName As String
Private mInternalCacheKey As String

Public Virtual Sub Refresh
End Sub

Protected Virtual Sub RefreshInternal
End Sub

Private Sub BuildCacheKey As String
    Return mInternalCacheKey
End Sub

#End Class
```

Generation rules:

| B4X++ visibility | Meaning in `.bx` | Generated `.bas` |
|---|---|---|
| `Public` | Visible from outside the class | `Public` |
| `Protected` | Visible in the class and child classes | `Private` in the flattened final module |
| `Private` | Visible only in the declaring class | `Private`; inherited private members are renamed during flattening |

`Private Override`, `Private Virtual` and overriding a private parent method are diagnostics in v0.2.

Properties also support visibility:

```vb
#Property Public Text As String = ""
#Property Protected AngleDegrees As Double = 0
#Property Private CacheKey As String = ""
#Property Public ReadOnly IsRunning As Boolean = False
```

For component authors this means the public API stays clean while shared parent code can still be reused by child components.

## Metadata files

Every generation command writes metadata under `.b4xpp/`:

```text
.b4xpp/symbols.json
.b4xpp/sourceMap.json
```

`symbols.json` is used by editor tooling and future LSP work. `sourceMap.json` currently stores a module-level mapping from generated `.bas` files back to their `.bx` source files. Fine-grained line mappings are planned for later releases.


### v0.3.2 overload fix

B4X++ now correctly renames safe method overloads even when the overloaded Subs do not explicitly declare `Public`, `Private`, or `Protected`.

```vb
Sub TestDraw()
End Sub

Sub TestDraw(i As Int)
End Sub
```

Generates valid B4X:

```vb
Sub TestDraw()
End Sub

Sub TestDraw2(i As Int)
End Sub
```

Calls such as `TestDraw(1)` are rewritten to `TestDraw2(1)`.
