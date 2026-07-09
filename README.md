# B4X++ for Visual Studio Code

B4X++ is a source-to-source layer and VS Code toolchain for B4X. You write `.bx` files with a more expressive syntax and stronger editor support; B4X++ generates ordinary B4J, B4A, B4i and BANano-compatible `.bas` files and project files that can still be opened and compiled by the official B4X IDEs.

B4X++ does **not** replace B4X. It keeps the final output close to classic B4X: inheritance is flattened, async code becomes native `ResumableSub` / `Wait For`, generics are specialized into concrete modules, and native directives such as `#DesignerProperty`, `#Event`, `#If B4J`, `#If CSS` and `#If JAVASCRIPT` are preserved.

## v0.6.0 highlights

This release consolidates the 0.5.1 → 0.5.18 work into the first BANano-oriented milestone:

- BANano project target with `#Project BANano`.
- Generated B4J/BANano project capable of producing `index.html`, CSS and JavaScript.
- BANanoSkeleton sample project.
- BANano build workflow: sync project, build jar with `B4JBuilder`, run jar to generate web output, then optionally serve the generated `index.html` locally.
- Integrated BANano local server to avoid browser `file://` CORS / manifest / live.js problems.
- JavaFX-aware BANano jar runner with `javaPath` and `javaFxLibPath` settings.
- Native B4X browsing for `.bas`, `.b4j`, `.b4a`, `.b4i` with syntax coloring, document symbols, hover and navigation.
- Global B4X++ settings UI separated from current project settings UI.
- BANano-aware syntax highlighting for `#BANano...`, `#If CSS`, `#If JAVASCRIPT`, `#If JS`, `#If SmartJavaScript`, SmartStrings and embedded HTML.
- Lightweight HTML/CSS/JS completions in BANano embedded web zones.
- Go to Definition / hover for B4X SmartString interpolation islands such as `${name}`.
- BANano and BANanoSkeleton IntelliSense from `.xml`, `.b4xlib`, workspace sources and fallbacks.
- Member IntelliSense for variables declared in `Process_Globals` and `Class_Globals`.
- Chained member IntelliSense such as `Layout.LastRow.Column(1).MarginTop`.
- Chained initializer IntelliSense inside assignments such as `Dim tp As SKTagPicker = Layout.LastRow.Column(1).Add.TagPicker(...)`.
- B4X++ OOP, generics, closures, async/await, `.b4xlib`, `.b4xpplib`, project sync and compiler error remapping from the previous milestones.

The BANano visual designer is intentionally **not** included yet. v0.6.0 focuses on making BANano projects compile, generate web output, serve locally and feel readable/editable inside VS Code.

## Installation

Install the `.vsix` package from VS Code:

```bash
code --install-extension b4xpp-0.6.0.vsix --force
```

Then run:

```text
Developer: Reload Window
```

Useful first commands:

```text
B4X++: Configure B4X++ Settings
B4X++: Configure Current Project Settings
B4X++: Create Example Project
B4X++: Sync #Project
B4X++: Build Current #Project + Remap Errors
```

## Project layout

Recommended workspace structure:

```text
src-b4xpp/
  Main.bx
  models/
  contracts/
generated-b4x/
b4x-ide-projects/
b4x-libs/
b4xpp-libs/
.vscode/
  settings.json
```

Generated files are normal B4X files. You can inspect them in `generated-b4x` or open the native project under `b4x-ide-projects`.

## Settings model

B4X++ separates global toolchain settings from project-local settings.

### Global B4X++ settings

Use:

```text
B4X++: Configure B4X++ Settings
```

Typical global settings:

```json
{
  "b4xpp.b4j.builderPath": "C:\\Program Files\\Anywhere Software\\B4J\\B4JBuilder.exe",
  "b4xpp.b4j.internalLibraryDirs": [
    "C:\\Program Files\\Anywhere Software\\B4J\\Libraries",
    "C:\\dev\\b4j\\libraries"
  ],
  "b4xpp.b4j.additionalLibraryDirs": [],
  "b4xpp.banano.javaPath": "C:\\b4j\\java\\bin\\java.exe",
  "b4xpp.banano.javaFxLibPath": "C:\\b4j\\java\\javafx\\lib",
  "b4xpp.banano.runJarAfterBuild": true,
  "b4xpp.banano.promptServeAfterRun": true,
  "b4xpp.bananoServer.port": 8088
}
```

These are user-level settings and are shared by all projects.

### Current project settings

Use:

```text
B4X++: Configure Current Project Settings
```

Project settings are the values that belong to the current workspace or `.bx` project: `sourceDir`, `outputDir`, `projectDir`, platform, package name, main module and project directives.

## B4X++ project directives

Project, packaging, dependency and BANano directives keep the `#` prefix.

| Directive | Purpose |
| --- | --- |
| `#Project B4J-NonUI Name` | Generate a native B4J non-UI project. |
| `#Project B4J-UI Name` | Generate a native B4J UI project. |
| `#Project B4A Name` | Generate a native B4A project. |
| `#Project B4i Name` | Generate a native B4i project. |
| `#Project BANano Name` | Generate a B4J/BANano web project. |
| `#Package com.example.app` | Native package / application id. |
| `#ProjectDir path` | Native project output folder. |
| `#MainModule Main` | Entry module. |
| `#Include "file.bx"` | Include another B4X++ source file. |
| `#ProjectB4JDependsOn BANano` | B4J dependency. |
| `#ProjectB4ADependsOn XUI` | B4A dependency. |
| `#ProjectB4iDependsOn iXUI` | B4i dependency. |
| `#B4XLib Name` | Package generated files as a native `.b4xlib`. |
| `#B4XPPLib Name` | Package B4X++ source files as a `.b4xpplib`. |
| `#B4XPPLibDependsOn B4XPP.Core` | Import a B4X++ source package. |
| `#BANanoApp AppName` | BANano app name metadata. |
| `#BANanoTitle "Title"` | BANano page title metadata. |
| `#BANanoOutput www` | BANano output metadata for tooling. |
| `#BANanoLiveSwap True` | BANano live-swap metadata for tooling. |

`#BANano...` directives are consumed by B4X++ tooling and removed from the generated `.bas`. The current BANano sample still writes `BANano.Initialize(...)` and `BANano.Header.Title = ...` explicitly in `AppStart`; the directives are used for project metadata, defaults, the integrated server and the future designer.

## Quick start: B4J Non-UI

```b4x
#Project B4J-NonUI AnimalDemo
#Package b4xpp.examples.animals
#ProjectDir b4x-ide-projects/AnimalDemo-b4j
#MainModule Main

#Include "models/Animal.bx"
#Include "models/Dog.bx"

Sub Process_Globals
End Sub

Sub AppStart(Args() As String)
    Dim dog As Dog
    dog.Initialize("Buddy")
    Log(dog.Speak)
End Sub
```

Run:

```text
B4X++: Sync #Project
B4X++: Build Current #Project + Remap Errors
```

## Quick start: BANano + BANanoSkeleton

```b4x
#Project BANano B4XPPBananoSkeletonHello
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

Sub AppStart(Form1 As Form, Args() As String)
    BANano.Initialize("BANano", "B4XPPBananoSkeletonHello", 1)
    BANano.Header.Title = "B4X++ BANanoSkeleton"
    BANano.JAVASCRIPT_NAME = "app.js"
    BANano.TranspilerOptions.MergeAllCSSFiles = True
    BANano.TranspilerOptions.MergeAllJavascriptFiles = True
    BANano.TranspilerOptions.RemoveDeadCode = False

    SKTools.WriteTheme
    BANano.Build(File.DirApp)

    #If Release
    ExitApplication
    #End If
End Sub

Sub BANano_Ready()
    Dim body As BANanoElement
    body.Initialize("#body")
    body.Append($"
<div class=""container"" style=""margin-top: 32px;"">
  <h1>B4X++ + BANanoSkeleton</h1>
  <p>This page was generated from a .bx source.</p>
  <button class=""button-primary"">Hello BANano</button>
</div>
"$)
End Sub

#If CSS
body {
    background: #f6f8fb;
}
#End If
```

BANano build workflow:

1. `B4X++: Sync #Project` generates the B4J project.
2. `B4X++: Build Current #Project + Remap Errors` runs `B4JBuilder`.
3. B4X++ runs the generated jar so BANano can produce `Objects/<AppName>/index.html` and JavaScript.
4. B4X++ asks whether to serve the generated web output locally.

Do not open BANano `index.html` directly with `file://` if the app uses manifest, fetch, live.js or service-worker features. Use:

```text
B4X++: Serve BANano Output
```

## BANano web syntax support

B4X++ understands BANano web zones:

```b4x
#If CSS
body {
    background: #297eff;
}
#End If
```

```b4x
#If JAVASCRIPT
console.log("Hello from BANano");
#End If
```

```b4x
#If SmartJavaScript
${coords} = [{x: [1, 2, 3], y: [1, 4, 9]}]
#End If
```

SmartStrings are treated as normal B4X strings by default:

```b4x
Dim name As String = "B4X++"
Dim message As String = $"Hello ${name}"$
```

SmartStrings that contain HTML get embedded HTML highlighting and lightweight completions:

```b4x
body.Append($"
<div class=""container"">
  <h1>Hello ${name}</h1>
</div>
"$)
```

`${name}` supports B4X navigation back to the local or global symbol.

BANano-specific SmartString markers such as `[BANRAW]` and `[BANCLEAN]` are preserved.

## Native B4X browsing

B4X++ is also useful when opening native B4X projects directly. It supports:

- `.bas`
- `.b4j`
- `.b4a`
- `.b4i`

Features include syntax highlighting, Outline / Document Symbols, Go to Definition, hover, basic diagnostics and project-file links to modules.

Use this when you only want to inspect a native B4X project without converting it to B4X++.

## OOP language snippets

### Interface

```b4x
Interface IAnimal
Sub Speak As String
Sub Move(Distance As Int) As String
End Interface
```

### Base class

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

### Extends / Override / Super

```b4x
Class Dog Extends Animal Final

Constructor(Name As String)
    Super.Initialize(Name)
End Constructor

Override Sub Speak As String
    Return Super.Name & " says woof"
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

Native B4X `#Property` is preserved as-is. B4X++ generated properties use bare `Property`.

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

### Generics

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

B4X++ generates concrete modules such as `Box__String.bas` and `Box__Int.bas`.

### Closures

```b4x
Sub Demo
    Dim factor As Int = 3

    Dim multiply As Closure = Sub(value As Int) As Int
        Return value * factor
    End Sub

    Log(multiply.Run1(10))
End Sub
```

### Async / Await

```b4x
Public Async Sub SumLater(a As Int, b As Int) As Int
    Sleep(100)
    Return a + b
End Sub

Public Async Sub AppStart(Args() As String)
    Dim total As Int = Await SumLater(1, 2)
    Log(total)
End Sub
```

Generated B4X shape:

```b4x
Public Sub SumLater(a As Int, b As Int) As ResumableSub
    Sleep(100)
    Return a + b
End Sub

Public Sub AppStart(Args() As String)
    Wait For (SumLater(1, 2)) Complete(total As Int)
    Log(total)
End Sub
```

`BANano.Await(...)` is preserved as a BANano method call and is not rewritten by the B4X++ `Await` transform.

### Natural polymorphism and `Poly`

```b4x
Dim animal As Animal
animal = dog
Log(animal.Speak)
```

```b4x
Dim renderable As Poly IRenderable
renderable = button
Log(renderable.Render("dark"))
```

## Source packages and libraries

### `.b4xpplib`

A `.b4xpplib` is a B4X++ source package. It ships `.bx` files, not generated `.bas` files.

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

Sub AppStart(Args() As String)
    Dim animal As SharedAnimal
    animal.Initialize
    Log(animal.Speak)
End Sub
```

### `.b4xlib`

B4X++ can package generated modules as a regular B4X library:

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

## Included source packages

The extension ships with:

```text
B4XPP.Core.b4xpplib
B4XPP.Net.b4xpplib
```

`B4XPP.Core` includes helpers such as:

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

Dim result As Result(Of String)
result.InitializeSuccess("OK")
```

`B4XPP.Net` provides async-friendly HTTP helpers over platform HTTP libraries.

## IntelliSense and diagnostics

B4X++ provides:

- completions for local variables, globals, classes, interfaces, static modules, methods, properties and external library members;
- member completions from `.xml`, `.b4xlib`, `.b4xpplib` and workspace source files;
- hover for B4X++ and native B4X symbols;
- Go to Definition for includes, classes, methods, properties, variables, dependency symbols and SmartString `${...}` variables;
- signature help for normal and chained method calls;
- chained member resolution such as `Layout.LastRow.Column(1).MarginBottom`;
- chained initializer/member resolution inside assignments such as `Dim tp As SKTagPicker = Layout.LastRow.Column(1).Add.TagPicker(...)`;
- diagnostics for unknown symbols, argument counts, type mismatches, invalid inheritance/override usage and CustomView metadata;
- generated source maps under `.b4xpp/sourceMap.json`.

## Commands

| Command | Purpose |
| --- | --- |
| `B4X++: Create Example Project` | Create an example project in the workspace. |
| `B4X++: Generate .bas Files` | Generate native `.bas` files only. |
| `B4X++: Sync #Project` | Generate/sync the native B4X project. |
| `B4X++: Build Current #Project + Remap Errors` | Build using the platform from `#Project`. |
| `B4X++: Build B4J + Remap Errors` | Build B4J and map errors back to `.bx`. |
| `B4X++: Build B4A + Remap Errors` | Build B4A and map errors back to `.bx`. |
| `B4X++: Build B4i + Remap Errors` | Run configured B4i build command and remap errors. |
| `B4X++: Build .b4xlib` | Package native `.b4xlib`. |
| `B4X++: Build .b4xpplib` | Package B4X++ source library. |
| `B4X++: Run BANano Generator JAR` | Run the generated BANano jar to emit web files. |
| `B4X++: Serve BANano Output` | Serve `Objects/<AppName>/index.html` locally. |
| `B4X++: Refresh IntelliSense Index` | Reindex sources and libraries. |
| `B4X++: Configure B4X++ Settings` | Edit global toolchain/library settings. |
| `B4X++: Configure Current Project Settings` | Edit current project settings/directives. |
| `B4X++: Set Current File Language to B4X` | Force native B4X language mode. |
| `B4X++: Generate Debug Bundle` | Create a diagnostic bundle for bug reports. |

## Snippet prefixes

Common snippet prefixes:

| Prefix | Inserts |
| --- | --- |
| `project-b4j` | B4J Non-UI project header. |
| `project-b4j-ui` | B4J UI project header. |
| `project-b4a` | B4A project header. |
| `project-b4i` | B4i project header. |
| `project-banano` | BANano project header. |
| `include` | `#Include "..."`. |
| `class` | B4X++ class template. |
| `interface` | Interface template. |
| `extends` | Class extending another class. |
| `implements` | Class implementing an interface. |
| `property` | Generated property. |
| `property-ro` | Read-only property. |
| `property-wo` | Write-only property. |
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
| `b4xlib` | B4XLib directives. |
| `b4xpplib` | B4XPPLib directives. |
| `banano-ready` | `BANano_Ready` skeleton. |
| `banano-html` | BANano HTML SmartString append. |
| `banano-css` | `#If CSS` block. |
| `banano-js` | `#If JAVASCRIPT` block. |

Actual snippet availability depends on the bundled `snippets/b4xpp.json`.

## Examples

Included examples vary by package, but the extension includes or supports:

- OOP animal demo.
- Language showcase.
- Closures demo.
- Generic core demo.
- XUI / B4J UI demos.
- B4XLib / CustomView-oriented samples.
- BANanoSkeleton web sample.

Use:

```text
B4X++: Create Example Project
```

## Design principles

B4X++ favors generated code that stays understandable:

- generated `.bas` files are plain B4X modules;
- inheritance is flattened into generated methods;
- `Super` calls are lowered to generated parent-call helpers;
- async uses B4X resumable subs;
- generics are compile-time source specializations;
- native B4X directives are preserved;
- BANano remains a real B4J/BANano project, not a separate runtime.

## Roadmap after v0.6.0

The next large direction is the BANano visual designer:

- read `.bjl` layouts;
- infer BANano parent/child relationships from rectangles;
- render BANanoSkeleton components in a live VS Code WebView;
- edit properties and save back to layout files;
- generate members/events into `.bx` files;
- optionally run the real BANano build preview when needed.

The goal is a design-time renderer that is instant, with real BANano generation used for validation and final preview.

## Contributing

Contributions are welcome.

Good ways to help:

- test B4J, B4A, B4i and BANano workflows on real installations;
- report compiler errors where generated B4X is not accepted by the official IDEs;
- improve library indexing from `.xml`, `.b4xlib` and `.b4xpplib` files;
- add BANanoSkeleton component metadata and examples;
- improve embedded HTML/CSS/JS IntelliSense;
- add focused examples for common B4X/BANano components;
- improve docs, snippets and diagnostics.

When contributing, please keep the output compatible with classic B4X. A feature is usually a good fit if it can be explained as clean `.bx` syntax that generates understandable `.bas`.

Suggested bug-report bundle:

```text
B4X++: Generate Debug Bundle
```

Please include the `.bx` source, generated `.bas`, relevant `.b4j/.b4a/.b4i` project file and compiler output when possible.

## License

MIT License. See [LICENSE](LICENSE).
