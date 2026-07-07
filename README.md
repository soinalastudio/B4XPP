# B4X++ for Visual Studio Code

B4X++ is a source-to-source layer for B4X. You write `.bx` files with a cleaner, more expressive syntax, and the extension generates normal B4J, B4A, and B4i `.bas` files and project files that the official B4X tools can compile.

B4X++ does not replace B4X. It stays deliberately close to the B4X runtime and compiler model: classes become classic B4X class modules, async code becomes native `ResumableSub` / `Wait For`, and generated projects remain ordinary `.b4j`, `.b4a`, or `.b4i` projects.

The goal is practical: make medium and large B4X projects easier to structure, navigate, reuse, package, and build, while still producing B4X code that can be inspected and opened in the official IDEs.

## Status

`v0.5.0` collects and cleans up the improvements made during the 0.4.x series:

- natural OOP syntax: `Class`, `Interface`, `Constructor`, `Property`, `StaticCode`;
- legacy compatibility for `#Class`, `#Constructor`, `#Interface`, `#StaticCode`, and matching `#End ...` forms;
- clear split between B4X++ `Property` and native B4X `#Property`;
- inheritance flattening, `Super`, `This`, `Override`, `Virtual`, `Abstract`, `Final`, `Protected`;
- interfaces and explicit or natural polymorphism with `Poly`;
- generic source specialization with `Type(Of T)` syntax;
- closures / anonymous `Sub` literals;
- `Async Sub` and `Await` lowered to native B4X resumable subs;
- `.b4xlib` and `.b4xpplib` packaging;
- B4J / B4A / B4i project sync;
- native builder commands with compiler error remapping;
- IntelliSense, hover, diagnostics, Go to Definition, and source maps.

## Quick Start

Create a `.bx` entry file:

```b4x
#Project B4J-NonUI AnimalDemo
#Package b4xpp.examples.animals
#ProjectDir b4x-ide-projects/AnimalDemo-b4j-nonui
#MainModule Main

#Include "contracts/IAnimal.bx"
#Include "models/Animal.bx"
#Include "models/Dog.bx"

Sub Process_Globals
End Sub

Sub AppStart (Args() As String)
    Dim dogInstance As Dog
    dogInstance.Initialize("Buddy")
    Log(dogInstance.Speak)
End Sub
```

Then run:

1. `B4X++: Sync #Project` to generate the native B4J / B4A / B4i project.
2. `B4X++: Generate .bas Files` to inspect generated modules.
3. `B4X++: Build Current #Project + Remap Errors` to compile with the configured B4X builder and map errors back to `.bx` lines.

## Project Layout

Recommended layout:

```text
src-b4xpp/
  Demo.bx
  contracts/
    IAnimal.bx
  models/
    Animal.bx
    Dog.bx
generated-b4x/
b4x-ide-projects/
b4x-libs/
b4xpp-libs/
```

Default folders can be changed in VS Code settings:

```json
{
  "b4xpp.sourceDir": "src-b4xpp",
  "b4xpp.outputDir": "generated-b4x",
  "b4xpp.projectDir": "b4x-ide-projects",
  "b4xpp.b4xlibDir": "b4x-libs",
  "b4xpp.b4xpplibDir": "b4xpp-libs"
}
```

## Language Directives

Project, packaging, include, and platform directives keep the `#` prefix:

| Directive | Purpose |
| --- | --- |
| `#Project B4J-NonUI Name` | Generate a native B4J non-UI project. |
| `#Project B4J-UI Name` | Generate a native B4J UI project. |
| `#Project B4A Name` | Generate a native B4A project. |
| `#Project B4i Name` | Generate a native B4i project. |
| `#Package com.example.app` | Native package / application id. |
| `#ProjectDir path` | Native project output folder. |
| `#MainModule Main` | Main `.bx` module for generated project entry. |
| `#Include "file.bx"` | Include another B4X++ source file. |
| `#ProjectB4JDependsOn jXUI` | Native B4J project dependency. |
| `#ProjectB4ADependsOn XUI` | Native B4A project dependency. |
| `#ProjectB4iDependsOn iXUI` | Native B4i project dependency. |
| `#B4XLib Name` | Generate a `.b4xlib`. |
| `#B4XPPLib Name` | Generate a `.b4xpplib` source package. |
| `#B4XPPLibDependsOn B4XPP.Core` | Import a B4X++ source package. |

OOP language constructs are natural keywords in v0.5:

| B4X++ keyword | Meaning |
| --- | --- |
| `Class` / `End Class` | B4X++ class source block. |
| `Interface` / `End Interface` | Interface contract. |
| `StaticCode` / `End StaticCode` | Static B4X code module. |
| `Constructor` / `End Constructor` | Generates `Initialize`, `Initialize2`, etc. |
| `Property` | Generates backing field and B4X getter/setter. |
| `Extends` | Flatten parent class into generated class module. |
| `Implements` | Declare implemented interface(s). |
| `Abstract` | Require child implementation. |
| `Virtual` | Mark a method as overridable. |
| `Override` | Override a parent method. |
| `Final` | Prevent inheritance or overriding. |
| `Protected` | Source-level protected member, lowered safely for B4X. |
| `Super` | Call flattened parent implementation. |
| `This` | Reference current B4X++ instance. |
| `Poly` | Explicit dynamic dispatch through a base class or interface. |
| `Closure` | Anonymous `Sub` value. |
| `Async` / `Await` | Readable syntax over B4X resumable subs. |

Legacy `#Class`, `#Interface`, `#Constructor`, `#StaticCode`, `#End Class`, `#End Interface`, `#End Constructor`, and `#End StaticCode` are still accepted for compatibility.

Important: `#Property` is native B4X. B4X++ generated properties use bare `Property`.

```b4x
Property Name As String = "Unknown"  ' B4X++: generates mName, getName, setName
#Property NativeB4XName As String    ' B4X: preserved as-is in generated .bas
```

## OOP Snippets

### Interface

```b4x
Interface IAnimal
Sub Speak As String
Sub Move(Distance As Int) As String
End Interface
```

### Base Class

```b4x
Class Animal Abstract Implements IAnimal

Property ReadOnly Name As String = "Unknown"

Constructor(Name As String)
    mName = Name
End Constructor

Virtual Sub Speak As String
    Return "I am " & mName
End Sub

Virtual Sub Move(Distance As Int) As String
    Return mName & " moves " & Distance & " m"
End Sub

End Class
```

### Class Extends

```b4x
Class Dog Extends Animal Final

Constructor(Name As String)
    Super.Initialize(Name)
End Constructor

Override Sub Speak As String
    Return Super.Name & " says woof"
End Sub

Override Sub Move(Distance As Int) As String
    Return Super.Name & " runs " & Distance & " m"
End Sub

End Class
```

### Property

```b4x
Class ScoreBoard

Property Score As Int = 0
Property ReadOnly CreatedAt As Long = 0
Property WriteOnly Secret As String

Constructor
    mCreatedAt = DateTime.Now
End Constructor

End Class
```

Generated shape:

```b4x
Private mScore As Int = 0
Public Sub getScore As Int
    Return mScore
End Sub
Public Sub setScore(B4XPP_Score As Int)
    mScore = B4XPP_Score
End Sub
```

### Custom Property Accessors

```b4x
Class LabelModel

Property Public Text As String = ""

Public Get Text As String
    Return mText.ToUpperCase
End Get

Public Set Text(Value As String)
    mText = Value.Trim
End Set

End Class
```

### Property Read / Write Sugar

Inside class methods, B4X++ can rewrite readable property usage to classic B4X getter/setter calls:

```b4x
If Broken Then Return 0
Broken = True
Visible = False
Return Points
```

Generated shape:

```b4x
If getBroken Then Return 0
setBroken(True)
setVisible(False)
Return getPoints
```

### Abstract / Virtual / Override / Final

```b4x
Class BaseComponent Abstract

Abstract Sub ComponentType As String

Virtual Sub Render As String
    Return "base"
End Sub

Final Sub Signature As String
    Return ComponentType & "-" & DateTime.Now
End Sub

End Class
```

```b4x
Class ButtonComponent Extends BaseComponent Final

Override Sub ComponentType As String
    Return "button"
End Sub

Override Sub Render As String
    Return Super.Render & ":button"
End Sub

End Class
```

### Protected Members

```b4x
Class GameEntity

Property Protected X As Float = 0
Property Protected Y As Float = 0

Protected Sub FormatPosition As String
    Return "(" & getX & "," & getY & ")"
End Sub

End Class
```

B4X has no direct `Protected` keyword in class modules, so B4X++ validates protected access at source level and lowers generated members safely.

### Super and This

```b4x
Override Sub Render As String
    Return Super.Render & " type=" & This.ComponentType
End Sub
```

`Super.Method` becomes a generated flattened parent method call such as `B4XPP_Super_Base_Render`.

### Natural Polymorphism

```b4x
Dim animal As Animal

animal = dogInstance
Log(animal.Speak)

animal = catInstance
Log(animal.Move(3))
```

When B4X++ can prove that assigned child classes extend the declared base class, it generates safe object storage and dynamic dispatch.

### Explicit Poly

```b4x
Dim renderable As Poly IRenderable
renderable = button
Log(renderable.Render("dark", 2, True))
```

`Poly` is useful when the declared type is an interface or when you want to make dynamic dispatch explicit.

### StaticCode

```b4x
StaticCode MathTools

Sub Process_Globals
End Sub

Public Sub Clamp(Value As Int, MinValue As Int, MaxValue As Int) As Int
    If Value < MinValue Then Return MinValue
    If Value > MaxValue Then Return MaxValue
    Return Value
End Sub

End StaticCode
```

## Constructors and Overloads

Multiple `Constructor` blocks generate B4X-compatible initializer overloads:

```b4x
Class Person

Property Name As String = ""
Property Age As Int = 0

Constructor
End Constructor

Constructor(Name As String)
    mName = Name
End Constructor

Constructor(Name As String, Age As Int)
    mName = Name
    mAge = Age
End Constructor

End Class
```

Generated shape:

```b4x
Public Sub Initialize
End Sub

Public Sub Initialize2(Name As String)
End Sub

Public Sub Initialize3(Name As String, Age As Int)
End Sub
```

Method overloads by arity are also supported:

```b4x
Public Sub Draw(Text As String)
End Sub

Public Sub Draw(Text As String, Color As Int)
End Sub
```

## Generics

B4X++ generics are source-generation generics. They produce concrete B4X class modules for used type combinations.

```b4x
Class Box(Of T)

Sub Class_Globals
    Private mValue As T
End Sub

Public Sub Initialize(Value As T)
    mValue = Value
End Sub

Public Sub GetValue As T
    Return mValue
End Sub

End Class
```

Usage:

```b4x
Dim nameBox As Box(Of String)
Dim countBox As Box(Of Int)
```

Generated modules:

```text
Box__String.bas
Box__Int.bas
```

Nested generic usage is supported:

```b4x
Dim item As Pair(Of String, Box(Of Int))
```

Generated modules:

```text
Box__Int.bas
Pair__String__Box__Int.bas
```

## B4XPP.Core

The extension includes `B4XPP.Core.b4xpplib`, a source package with common generic helpers:

```text
Optional(Of T)
Result(Of T)
Pair(Of TFirst, TSecond)
Box(Of T)
TypedList(Of T)
TypedMap(Of TKey, TValue)
EventArgs(Of T)
Task(Of T)
B4XPPAsync
```

Use it with:

```b4x
#B4XPPLibDependsOn B4XPP.Core

Dim names As TypedList(Of String)
names.Add("B4X++")

Dim result As Result(Of String)
result.InitializeSuccess("OK")
```

B4X++ can automatically initialize local generated classes with parameterless `Initialize` before first use.

## Closures

Preferred syntax:

```b4x
Sub Demo
    Dim a As Int = 2

    Dim add As Closure = Sub(i As Int) As Int
        Return a + i
    End Sub

    Log(add(5))
End Sub
```

Local closures are lifted into generated private Subs when possible.

When a closure escapes the local call site, B4X++ generates a `B4XPPClosure` runtime value:

```b4x
Dim factor As Int = 3
Dim multiply As Closure = Sub(value As Int) As Int
    Return value * factor
End Sub

runner.Add("triple", multiply)
```

Separate assignment is supported:

```b4x
Dim factory As Closure
factory = Sub(name As String) As Dog
    Dim dogInstance As Dog
    dogInstance.Initialize(name)
    Return dogInstance
End Sub

Dim buddy As Dog = factory.Run1("Buddy")
```

Generated B4X never keeps `factory = Sub(...)`; it creates a `B4XPPClosure` and lifts the body.

## Async / Await

B4X++ async syntax is sugar over native B4X resumable subs.

```b4x
Public Async Sub SumLater(a As Int, b As Int) As Int
    Sleep(100)
    Return a + b
End Sub

Public Async Sub AppStart (Args() As String)
    Dim total As Int = Await SumLater(1, 2)
    Log(total)
End Sub
```

Generated shape:

```b4x
Public Sub SumLater(a As Int, b As Int) As ResumableSub
    Sleep(100)
    Return a + b
End Sub

Public Sub AppStart (Args() As String)
    Wait For (SumLater(1, 2)) Complete (total As Int)
    Log(total)
End Sub
```

MVP supported forms:

```b4x
Dim value As T = Await SomeResumableSub()
value = Await SomeResumableSub()
Return Await SomeResumableSub()
Await SomeResumableSub()
```

Complex expression awaits such as `Log((Await Load()).Name)` should be written with a temporary variable.

## B4XPP.Net

`B4XPP.Net.b4xpplib` provides async-friendly HTTP helpers:

```b4x
#B4XPPLibDependsOn B4XPP.Net

Public Async Sub FetchText(Url As String) As String
    Dim response As B4XPPHttpResponse = Await B4XPPHttp.Get(Url)
    If response.Success Then Return response.Body
    Return response.ErrorMessage
End Sub
```

It declares native dependencies per platform:

```text
B4J: jOkHttpUtils2
B4A: OkHttpUtils2
B4i: iHttpUtils2
```

## B4XPPLib Source Packages

A `.b4xpplib` is a B4X++ source package. It ships `.bx` files, not generated `.bas` files. The consuming project transpiles the package as part of its own build.

Package source:

```b4x
#B4XPPLib SharedModels
#B4XPPLibVersion 1.0.0
#B4XPPLibAuthor YourName

Class SharedAnimal
Public Sub Speak As String
    Return "Animal"
End Sub
End Class
```

Consumer:

```b4x
#Project B4J-NonUI Demo
#B4XPPLibDependsOn SharedModels
#MainModule Main

Sub AppStart (Args() As String)
    Dim animal As SharedAnimal
    animal.Initialize
    Log(animal.Speak)
End Sub
```

Do not add `.b4xpplib` packages as native B4X `LibraryN` entries. B4X++ consumes them, generates the required `.bas` modules, and filters them out of native project libraries.

## B4XLib Packaging

B4X++ can package generated modules as a regular `.b4xlib`:

```b4x
#B4XLib AnimalComponents
#B4XLibVersion 1.00
#B4XLibAuthor B4X++ Team
#B4XLibDir b4x-libs
#B4XLibSupportedPlatforms B4J, B4A, B4i
#B4XLibDependsOn XUI
```

Run:

```text
B4X++: Build .b4xlib
```

## Build and Error Remapping

B4X++ can sync the native project, call the platform builder, capture compiler output, and remap errors back to `.bx` source lines.

Commands:

| Command | Purpose |
| --- | --- |
| `B4X++: Build B4J + Remap Errors` | Run B4J build and map errors. |
| `B4X++: Build B4A + Remap Errors` | Run B4A build and map errors. |
| `B4X++: Build B4i + Remap Errors` | Run a configured B4i build command and map errors. |
| `B4X++: Build Current #Project + Remap Errors` | Pick platform from `#Project`. |
| `B4X++: Remap B4X Compiler / Runtime Errors` | Remap pasted compiler/runtime output. |

Typical B4J settings:

```json
{
  "b4xpp.b4j.builderPath": "C:\\Program Files\\Anywhere Software\\B4J\\B4JBuilder.exe",
  "b4xpp.buildTask": "Build",
  "b4xpp.buildConfiguration": "Default",
  "b4xpp.buildShowWarnings": true,
  "b4xpp.buildUseBaseFolder": true
}
```

Custom command placeholders:

```text
{project}
{workspace}
{projectDir}
{configuration}
{task}
```

Example:

```json
{
  "b4xpp.b4jBuildCommand": "\"C:\\Program Files\\Anywhere Software\\B4J\\B4JBuilder.exe\" -Task=Build -Project={project} -BaseFolder={projectDir} -Configuration={configuration} -ShowWarnings=True"
}
```

## IntelliSense and Diagnostics

The extension provides:

- Go to Definition for classes, methods, properties, includes, dependencies, `Wait For (...) Complete (...)` result variables, and resumable-sub calls;
- hover documentation for B4X++ symbols and indexed B4X libraries;
- type and member completions from workspace sources, `.xml`, `.b4xlib`, and `.b4xpplib` packages;
- diagnostics for unknown symbols, method argument count, type mismatches, inheritance issues, custom-view metadata, and unsafe B4X names;
- source maps under `.b4xpp/sourceMap.json` for generated-line to source-line mapping.

## Snippet Prefixes

Common snippet prefixes:

| Prefix | Inserts |
| --- | --- |
| `project-b4j` | B4J Non-UI project header. |
| `project-b4j-ui` | B4J UI project header. |
| `project-b4a` | B4A project header. |
| `project-b4i` | B4i project header. |
| `include` | `#Include "..."`. |
| `class` | B4X++ class with property and constructor. |
| `interface` | B4X++ interface. |
| `extends` | Class extending another class. |
| `implements` | Class implementing an interface. |
| `property` | B4X++ generated property. |
| `property-ro` | Read-only generated property. |
| `property-wo` | Write-only generated property. |
| `constructor` | Constructor block. |
| `constructor-overload` | Constructor overload block. |
| `override` | Override method. |
| `virtual` | Virtual method. |
| `abstract` | Abstract method. |
| `final` | Final method. |
| `poly` | Explicit `Poly` variable. |
| `closure` | Anonymous `Sub` literal. |
| `async-sub` | Async sub skeleton. |
| `await` | Await assignment pattern. |
| `generic-class` | Generic class template. |
| `generic-use` | Generic variable usage. |
| `b4xlib` | B4XLib packaging directives. |
| `b4xpplib` | B4XPPLib source package directives. |

## Examples

Included example projects:

- `basic-animal`: small OOP example with `Animal`, `Dog`, `Cat`, and `Bird`.
- `language-showcase`: broad syntax and IntelliSense showcase.
- `closure-console`: closures and captured variables.
- `generic-core`: generic utilities from `B4XPP.Core`.
- `xui-breakout`: B4J UI / XUI game sample.
- `oop-dungeon-arena`: heavier OOP sample with inheritance, interfaces, `Poly`, and services.
- `B4XAnalogClock-B4XPP-PoC-v0.1`: CustomView-oriented proof of concept.

Use `B4X++: Create Example Project` to create a fresh sample in the workspace.

## Design Notes

B4X++ favors generated code that remains understandable:

- generated `.bas` files are plain B4X modules;
- inheritance is flattened instead of relying on unavailable runtime inheritance;
- async uses B4X resumable subs;
- generic classes are specialized into concrete B4X class modules;
- native B4X directives such as `#DesignerProperty`, `#Event`, and `#Property` are preserved.

This keeps the bridge honest: B4X++ improves source ergonomics and editor tooling, but the final application still belongs to the B4X compiler and runtime.

## Contributing

Contributions are welcome.

Good places to help:

- test B4J, B4A, and B4i build workflows on real installations;
- report cases where generated B4X is not accepted by the official IDEs;
- improve B4X library indexing and diagnostics;
- add focused examples for common B4X components;
- expand async wrappers in `B4XPP.Core` and `B4XPP.Net`;
- improve documentation and snippets.

Please keep changes compatible with classic B4X output. A feature is usually a good fit when it can be explained as clean `.bx` syntax that generates understandable `.bas`.

## License

MIT License. See [LICENSE](LICENSE).
