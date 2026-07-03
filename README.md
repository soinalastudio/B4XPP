# B4X++ for Visual Studio Code

> Build note: `settings-save-fix6` keeps the public version at `0.4.0` and moves the Project Settings WebView logic to an external script so buttons work reliably in VS Code.

B4X++ is a proof-of-concept source-to-source layer for B4X. You write `.bx` files with extra OOP and editor-friendly syntax, then B4X++ generates normal B4J / B4A / B4i `.bas` files and native project headers.

It is not a replacement for the official B4X IDEs. The goal is to make library and component authoring easier, especially when the same logic is reused across several B4X modules or B4XLibs.

## What is in v0.4.0

v0.4.0 is the first consolidated release after v0.3.5. It brings the cleaned property syntax, validation and library indexing work, Project Settings UI, native B4X project header support, library-driven IntelliSense, and B4X++ closures.

Main areas now included:

- OOP source syntax: `#Class`, `Extends`, `Implements`, `Override`, `Virtual`, `Protected`, `Super.Method`, `This`, `Poly` dispatch.
- B4X property sugar: readable `Name = ...`, `If Visible Then`, `Return Points` source syntax generating classic `setName(...)`, `getVisible`, `getPoints` calls.
- Constructor and method overloads by arity, generating B4X-compatible `Initialize`, `Initialize2`, `Method`, `Method2`, etc.
- Validation baseline: unknown identifiers, unknown types, simple type mismatch, method argument count, and library metadata checks.
- Library indexing from `.xml` and `.b4xlib`, cached by platform and folder signature.
- Platform-scoped library folders: B4J reads B4J dirs only, B4A reads B4A dirs only, B4i reads B4i dirs only.
- Project Settings UI for current workspace configuration.
- Native `.b4j`, `.b4a`, `.b4i` header support and import of existing project libraries.
- Separation between native project dependencies and B4XLib manifest dependencies.
- VS Code IntelliSense: scoped completion, dependency completion, type completion from active libraries, member completion, hover for external types.

## Closures / anonymous Sub literals

Preferred B4X++ syntax:

```b4x
Dim add As Closure = Sub(i As Int) As Int
    Return a + i
End Sub

Log(add(5))
```

`As Sub` is still accepted as a compatibility alias:

```b4x
Dim add As Sub = Sub(i As Int) As Int
    Return a + i
End Sub
```

### Local closure lifting

When a closure is only called locally, B4X++ does not generate a class. It lifts the body to a private generated Sub and passes captured variables as extra arguments.

Source:

```b4x
Sub Test
    Dim a As Int
    a = 2

    Dim add As Closure = Sub(i As Int) As Int
        Return a + i
    End Sub

    Log(add(5))
    a = 10
    Log(add(5))
End Sub
```

Generated shape:

```b4x
Sub Test
    Dim a As Int
    a = 2

    Log(B4XPP_Closure_Main_Test_1(a, 5))
    a = 10
    Log(B4XPP_Closure_Main_Test_1(a, 5))
End Sub

Private Sub B4XPP_Closure_Main_Test_1(a As Int, i As Int) As Int
    Return a + i
End Sub
```

This keeps the common case simple and fast.

### Closure as a value

When a closure is passed to another method, stored, returned, or otherwise escapes the local call site, B4X++ generates a `B4XPPClosure` runtime value.

```b4x
Dim factor As Int = 3
Dim multiply As Closure = Sub(value As Int) As Int
    Return value * factor
End Sub

runner.Add("triple", multiply)
```

Generated code stores the captured values in a `List`, initializes `B4XPPClosure`, and invokes it with `Run`, `Run1`, `Run2`, etc. Closure parameters declared as `Closure` are generated as `B4XPPClosure` in classic B4X.

## Project directives

A `.bx` entry file can generate a native B4X project:

```b4x
#Project B4J-NonUI MyConsoleApp
#Package com.example.demo
#ProjectDir b4x-ide-projects/MyConsoleApp-b4j-nonui
#MainModule Main
```

For B4J UI:

```b4x
#Project B4J-UI MyJavaFXApp
#Package com.example.ui
#ProjectDir b4x-ide-projects/MyJavaFXApp-b4j-ui
#MainModule Main
#ProjectB4JDependsOn jXUI
```

Native project library dependencies are written to the `.b4j`, `.b4a`, or `.b4i` header as `Library1=...`, `Library2=...`:

```b4x
#ProjectDependsOn SomeCommonLibrary
#ProjectB4JDependsOn jXUI
#ProjectB4ADependsOn XUI
#ProjectB4iDependsOn iXUI
```

## B4XLib directives

B4XLib metadata is separate from native project configuration:

```b4x
#B4XLib MyLibrary
#B4XLibVersion 1.00
#B4XLibAuthor Your Name
#B4XLibDir b4x-libs
#B4XLibSupportedPlatforms B4A, B4J, B4i
#B4XLibB4JDependsOn jXUI
#B4XLibB4ADependsOn XUI
#B4XLibB4iDependsOn iXUI
```

Legacy directives such as `#Version`, `#Author`, `#SupportedPlatforms`, `#B4JDependsOn`, `#B4ADependsOn`, and `#B4iDependsOn` are still read for compatibility, but new projects should use the explicit `#Project...` and `#B4XLib...` prefixes.

## Library folders

B4X++ follows the B4X platform model. There is no separate `.b4xlib` folder setting.

For B4J:

```json
{
  "b4xpp.b4j.internalLibraryDirs": [
    "C:/Program Files/Anywhere Software/B4J/Libraries"
  ],
  "b4xpp.b4j.additionalLibraryDirs": [
    "C:/dev/b4j/libraries"
  ]
}
```

Same idea for B4A and B4i:

```json
{
  "b4xpp.b4a.internalLibraryDirs": [],
  "b4xpp.b4a.additionalLibraryDirs": [],
  "b4xpp.b4i.internalLibraryDirs": [],
  "b4xpp.b4i.additionalLibraryDirs": []
}
```

Each configured platform folder may contain:

```text
*.jar + *.xml
*.b4xlib
```

Type completion, member completion, hover metadata and semantic validation use only the active platform dependencies. For example, `#ProjectB4JDependsOn jXUI` uses only B4J library folders.

## Project Settings UI

Open the command palette and run:

```text
B4X++: Configure Project Settings
```

The UI edits the current workspace `.vscode/settings.json` and the main `.bx` directives. It can also import libraries from an existing `.b4j`, `.b4a`, or `.b4i` file header.

## Examples

Included examples:

- `examples/closure-console` — B4J Non-UI closure demo.
- `examples/xui-breakout` — B4J UI / XUI Breakout demo.
- `examples/oop-dungeon-arena` — console OOP demo with inheritance and dynamic dispatch.
- `examples/B4XAnalogClock-B4XPP-PoC-v0.1` — CustomView / B4XLib proof-of-concept.
- `examples/basic-animal` and `examples/language-showcase` — smaller language samples.

## Useful commands

```text
B4X++: Transpile Current File
B4X++: Transpile Workspace
B4X++: Configure Project Settings
B4X++: Refresh IntelliSense Index
B4X++: Validate B4XLib / CustomViews
B4X++: Create B4A/B4J/B4i Project
B4X++: Build B4J Project
```

## Current limitations

B4X++ is still a proof-of-concept. Important caveats:

- Generated inheritance is flattened into `.bas`; it is not real JVM/Android/iOS inheritance at runtime.
- Constructor overloads generate `Initialize2`, `Initialize3`, etc., but in official B4X only `Initialize` marks a fresh class instance as initialized.
- Runtime closure values passed around with `B4XPPClosure` currently capture values at initialization time. Local lifted closures pass captures at call time.
- Validation is useful but not a full B4X compiler yet.
- Some B4A/B4i project header details such as complex file groups and manifest blocks are still conservative.

## Development

Run the Node tests:

```bash
node --check extension.js
node --check lib/transpiler.js
node test/transpiler.test.js
```

## License

MIT License

Copyright (c) 2026 Soinala Studio

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
