# B4X++ v0.5.0

- Consolidated the 0.4.x work into a clean release.
- Rewrote `README.md` with a clearer overview of B4X++, its goals, OOP features, snippets, keywords, async/await, packaging, build/remap workflow, examples, contribution notes, and MIT license section.
- Promoted natural language constructs (`Class`, `Constructor`, `Property`, `Interface`, `StaticCode`) while preserving legacy `#Class`, `#Constructor`, `#Interface`, and `#StaticCode` compatibility.
- Clarified that B4X++ generated properties use bare `Property`; native B4X `#Property` directives are preserved as-is.
- Includes the prior 0.4.x improvements: async/await lowering, closures, generics, `B4XPP.Core`, `B4XPP.Net`, source packages, native build commands, error remapping, diagnostics, snippets, and navigation improvements.

# B4X++ v0.4.6 hotfix

- Hard fix: `Sync #Project` resolves simple `#ProjectDir AnimalDemo` under configured `b4xpp.projectDir` / `b4x-ide-projects`, including absolute configured folders.
- Hard fix: navigation parser recognizes `Async Sub`, so local variables and `Complete (Result As Type)` go-to-definition work inside async/resumable methods.
- Verified: `Public Async Sub AppStart (Args() As String)` with `Dim total As Int = Await ...` generates native B4X `Wait For (...) Complete (...)` with no residual `Await`.

## 0.4.5 hotfix - Sync path, Await lowering, Wait For locals

- Fixed **Sync #Project** path resolution: simple relative `#ProjectDir` values are now created under the configured `b4xpp.projectDir` / `B4X IDE projects folder`, instead of producing stray native project files at workspace root.
- Hardened `Async Sub` detection and added a safety pass so supported `Await` statements are lowered to native B4X `Wait For (...) Complete (...)` before `.b4j/.b4a/.b4i` output is written.
- Improved **Go to Definition** for B4X `Wait For (...) Complete (Result As Int)` local result variables. Ctrl+click/F12 on `Result` now jumps to the `Complete (Result As Int)` declaration.
- Reduced false `Await can only be used inside an Async Sub` diagnostics for valid `Public Async Sub ...` scopes.

## 0.4.5 hotfix - Await diagnostic crash

- Fixed **Sync #Project** crash `Cannot read properties of null (reading 'lineIndex')` when an `Await` token is found outside a recognized `Async Sub` scope.
- The transpiler now reports a proper diagnostic instead of throwing.
- Added a regression test for top-level / out-of-scope `Await`.



## 0.4.5 - Async wrappers

- Added `B4XPPAsync` helpers in `B4XPP.Core`:
  - `Delay(Milliseconds) As ResumableSub`
  - `FromValue(Value) As ResumableSub`
  - `FromBoolean(Value) As ResumableSub`
  - `FromString(Value) As ResumableSub`
- Added generic `Task(Of T)` wrapper type to `B4XPP.Core`.
- Added bundled `B4XPP.Net.b4xpplib` with:
  - `B4XPPHttp.Get(Url) As ResumableSub`
  - `B4XPPHttp.PostString(Url, Body) As ResumableSub`
  - `B4XPPHttpResponse` response object.
- `.b4xpplib` packages can now propagate native B4X library dependencies into generated `.b4j/.b4a/.b4i` projects.
- `B4XPP.Net` declares `jOkHttpUtils2` for B4J, `OkHttpUtils2` for B4A, and `iHttpUtils2` for B4i.
- Added `test/asyncwrappers.test.js`.


## 0.4.4 - Async/Await MVP

- Added `Async Sub` syntax over native B4X ResumableSub semantics.
- Added `Await` lowering for simple forms:
  - `Dim value As T = Await SomeAsync()`
  - `value = Await SomeAsync()`
  - `Return Await SomeAsync()`
  - `Await SomeAsync()`
- `Async Sub ... As T` is generated as `Sub ... As ResumableSub`.
- `Async Sub` without return type keeps the native B4X event-handler signature and is made resumable by generated `Wait For` statements.
- Added snippets and syntax highlighting for `Async` / `Await`.
- Added `test/asyncawait.test.js`.
# Changelog

## v0.4.3 hotfix — ResumableSub navigation

### Added

- Improved Go to Definition for B4X `ResumableSub` patterns in `.bx` files.
- `Wait For(SomeSub(...)) Complete (...)` now resolves `SomeSub` to its B4X++ Sub declaration.
- `Dim rs As ResumableSub = SomeSub(...)` now resolves `SomeSub` to its declaration.
- `Wait For EventName (...)` now resolves `EventName` to a matching event Sub when available.
- Hover on resumable targets now explains that B4X rewrites the Sub as a resumable state machine.


## v0.4.3 hotfix — Closure assignment transpilation

### Fixed

- Fixed separate closure assignments such as `Dim c As Closure` followed by `c = Sub(...) ... End Sub`.
- Generated B4X now initializes a `B4XPPClosure` runtime value and lifts the anonymous body into a generated method instead of leaving the unsupported `c = Sub(...)` syntax in `.bas`.
- VS Code navigation now recognizes both inline closure declarations and separate closure assignments.


## v0.4.3 — Native B4X build + error remapping

B4X++ can now transpile / sync the generated B4X project and run native build commands from VS Code:

- **B4X++: Build B4J + Remap Errors**
- **B4X++: Build B4A + Remap Errors**
- **B4X++: Build B4i + Remap Errors**
- **B4X++: Build Current #Project + Remap Errors**

For B4J, the default builder candidate is:

```text
C:\Program Files\Anywhere Software\B4J\B4JBuilder.exe
```

The default generated command is equivalent to:

```text
B4JBuilder.exe -Task=Build -Project=<project.b4j> -BaseFolder=<project folder> -Configuration=Default -ShowWarnings=True
```

For B4A, B4X++ similarly uses `B4ABuilder.exe` when found. B4i is supported through a custom command (`b4xpp.b4iBuildCommand`) because B4i normally relies on the Mac builder workflow rather than the same public Windows CLI builder pattern.

Build output is captured in the **B4X++** output panel, parsed, and remapped from generated `.bas` locations back to the original `.bx` files using `.b4xpp/sourceMap.json`.

Useful settings:

```json
{
  "b4xpp.b4j.builderPath": "C:\\Program Files\\Anywhere Software\\B4J\\B4JBuilder.exe",
  "b4xpp.b4a.builderPath": "C:\\Program Files\\Anywhere Software\\B4A\\B4ABuilder.exe",
  "b4xpp.buildConfiguration": "Default",
  "b4xpp.buildTask": "Build",
  "b4xpp.buildShowWarnings": true,
  "b4xpp.buildUseBaseFolder": true
}
```

Custom commands are still supported with placeholders: `{project}`, `{workspace}`, `{projectDir}`, `{configuration}`, `{task}`.



## 0.4.3 - Generic classes and B4XPP.Core

### Added

- Added MVP generic class syntax with `#Class Name(Of T)` and multiple parameters such as `#Class Pair(Of TFirst, TSecond)`.
- Added usage-driven specialization: B4X++ generates only the concrete modules used by the project, for example `Box(Of String)` -> `Box__String.bas`.
- Added nested generic type usage rewriting, for example `Pair(Of String, Box(Of Int))` -> `Pair__String__Box__Int.bas`.
- Added generic specialization for classes imported from `.b4xpplib` source packages.
- Added bundled `B4XPP.Core.b4xpplib` with `Optional(Of T)`, `Result(Of T)`, `Pair(Of TFirst, TSecond)`, `Box(Of T)`, `TypedList(Of T)`, `TypedMap(Of TKey, TValue)`, and `EventArgs(Of T)`.
- Added automatic local class initialization injection for B4X++ class variables with a parameterless `Initialize`, so first-use calls such as `r.InitializeSuccess("OK")` safely generate `r.Initialize` first.
- Added automatic search-path registration for bundled B4XPPLib packages, so `#B4XPPLibDependsOn B4XPP.Core` works without copying the package into the project.
- Added B4XPPLib dependency directive completions, including `#B4XPPLibDependsOn` when typing `#`.
- Added dependency hover for `#*DependsOn` directives: hovering a library name shows the classes exposed by `.xml`, `.b4xlib`, `.b4xpplib`, or the matching `.jar` placeholder when XML metadata is unavailable.
- Added snippets for generic classes, generic usage, and `#B4XPPLibDependsOn B4XPP.Core`.
- Added `test/generics.test.js`, including bundled-library resolution for `B4XPP.Core` and auto-initialization coverage.

### Fixed

- Fixed `.b4xpplib` dependencies leaking into generated native B4X project headers as `LibraryN=...`. B4XPPLib packages are now treated strictly as B4X++ source packages: they generate `.bas` modules and are removed from native B4J/B4A/B4i library lists.
- Fixed dependency hover for native `.jar` / `.xml` libraries: when both `jXUI.jar` and `jXUI.xml` exist, B4X++ now prefers the XML metadata and shows the real available classes instead of stopping on the JAR placeholder.
- Added a migration safety net: if a `.b4xpplib` such as `B4XPP.Core` was accidentally listed in `#ProjectB4JDependsOn`, the transpiler still resolves it as a B4X++ source package while the project writer filters it out of `LibraryN`.

- Fixed `B4XPP.Core.Result(Of T)` and similar Core classes causing `Class instance was not initialized` when the source used convenience methods such as `InitializeSuccess`, `InitializeValue`, `Put`, or `Add` without a manual `Initialize` first.
- Fixed `TypedMap(Of TKey, TValue).Remove` returning an undefined local variable in the generated specialization.

### Notes

- Generic methods and generic constraints are intentionally not part of this MVP.
- Generic templates are compile-time templates: the raw template module is not emitted unless a non-generic class with that exact name exists.

## 0.4.1 - B4XPPLib source packages

### Added

- Added initial `.b4xpplib` support: a B4X++ source package is a ZIP containing `.bx` files plus an optional `manifest.txt`.
- Added B4XPPLib project/package directives: `#B4XPPLib`, `#B4XPPLibVersion`, `#B4XPPLibAuthor`, `#B4XPPLibSupportedPlatforms`, `#B4XPPLibDependsOn`, and platform-specific dependency directives.
- Added dependency resolution for `#B4XPPLibDependsOn` / platform-specific B4XPPLib dependencies from the existing B4J/B4A/B4i library folders.
- Added transpilation of `.bx` sources coming from declared `.b4xpplib` packages into normal generated `.bas` modules in the consuming project.
- Added `.b4xpplib` indexing for type/member completion, dependency completion, and validation.
- Added `B4X++: Build .b4xpplib` command and `b4xpp.b4xpplibDir` setting.
- Added Project Settings UI fields for B4XPPLib metadata and dependencies.

### Changed

- Library folder scans now look for `.xml`, `.b4xlib`, and `.b4xpplib` files.
- Dependency diagnostics now mention both native B4X libraries and B4XPPLib source packages.

### Tested

- Added `test/b4xpplib.test.js` covering package parsing, dependency resolution, and generation of `.bas` files from a `.b4xpplib`.

## 0.4.0 settings-save-fix6

- Move the Project Settings WebView logic to an external `media/project-settings.js` script.
- Load the WebView script through `webview.asWebviewUri(...)` with `localResourceRoots` to avoid inline-script / CSP failures.
- Keep the public extension version at 0.4.0; the file suffix is only to bypass local VS Code caches while testing.


## v0.4.0 settings-save-fix4 packaging note

- Keeps the public version at 0.4.0.
- Hardens B4X++ Project Settings WebView save flow with direct DOM click fallback, relaxed local script CSP, direct `.vscode/settings.json` verification, and visible UI build marker.


## 0.4.0 - Closure release and consolidated editor/runtime update

### Added

- Added B4X++ closures / anonymous `Sub` literals.
- Added preferred `Closure` source type with `Sub` kept as a compatibility alias:
  - `Dim add As Closure = Sub(i As Int) As Int ... End Sub`
  - `Dim add As Sub = Sub(i As Int) As Int ... End Sub`
- Added local closure lifting: closures that are only called in the same scope are generated as `Private Sub` methods with captured variables passed as arguments.
- Added runtime closure values for closures that are passed, stored, or returned, using generated `B4XPPClosure` class modules.
- Added `B4XPPClosure.Initialize(Callback, MethodName, Captures)` as the only runtime closure constructor used by generated code.
- Added syntax highlighting and snippets for `Closure` and the latest B4X++ project / B4XLib directives.
- Added Go to Definition support for closure parameters and captured variables inside anonymous `Sub` bodies.
- Added `examples/closure-console`, a B4J Non-UI project demonstrating closure use cases.

### Changed

- Consolidated all post-0.3.5 work into this single `0.4.0` release.
- Cleaned and reorganized `README.md`; the license is placed at the end.
- Separated native project dependencies from B4XLib manifest dependencies:
  - `#ProjectB4JDependsOn`, `#ProjectB4ADependsOn`, `#ProjectB4iDependsOn`
  - `#B4XLibB4JDependsOn`, `#B4XLibB4ADependsOn`, `#B4XLibB4iDependsOn`
- B4XLib metadata now uses explicit prefixed directives such as `#B4XLibVersion`, `#B4XLibAuthor`, and `#B4XLibSupportedPlatforms`.
- Type completion now comes from the current project plus the libraries actually declared and indexed for the active platform. XUI/B4X UI types are not injected unless the matching library is declared.
- Generated native project headers now include the project library list as `Library1=...`, `Library2=...`, and `NumberOfLibraries=...`.

### Fixed

- Fixed B4X property read/write sugar in expressions and inline statements.
- Fixed external library indexing from `.xml` and `.b4xlib` files.
- Fixed platform-scoped library indexing so B4J, B4A, and B4i only see their own configured library folders.
- Fixed Project Settings UI loading from `.vscode/settings.json` and main `.bx` directives.
- Fixed Project Settings UI saving by writing directly to the current workspace `.vscode/settings.json`, avoiding stale VS Code configuration scope refreshes.
- Fixed IntelliSense / dependency completion to read the current workspace `.vscode/settings.json` directly, matching the Project Settings UI state.
- Fixed dependency completion so each `#ProjectB4xDependsOn` / `#B4XLibB4xDependsOn` directive lists only libraries from the matching platform.
- Fixed generated closure runtime module type: `B4XPPClosure.bas` is generated as `Type=Class`.
- Fixed runtime closure initialization: generated code calls the real B4X constructor `Initialize(...)`; no generated code calls `Initialize2(...)` on fresh class instances.
- Removed the old `B4XPPClosure.Initialize2(...)` compatibility helper to keep the runtime simple and B4X-compliant.

## v0.4.0 settings-save-fix5

- Fix the Configure Project Settings WebView script escaping bug that prevented the save JavaScript from running.
- The WebView now correctly posts modified values to the extension backend, allowing `.vscode/settings.json` and main `.bx` directives to be saved from the UI.
- Keep the public extension version as 0.4.0; filenames include the `settings-save-fix5` suffix only to avoid VS Code/client cache confusion.

## 0.4.3 patch - spaced library names + diagnostics policy

- Fixed dependency hover/completion tokenization for library names containing spaces, for example `XUI Views` in `#ProjectB4JDependsOn B4XPP.Core, jXUI, KeyValueStore, XUI Views, B4XDrawer`.
- Dependency hover now treats comma/semicolon-separated entries as library tokens; spaces inside the token are preserved.
- Stopped renaming ordinary method/constructor parameters such as `Name`, `Value`, `Width` only because they match a property/type/member name.
- Added a targeted case-insensitive warning for the real B4X issue: local/global variable names that match a known type/module, for example `Dim dog As Dog`.

## v0.4.3 hotfix — Closure runtime module registration

- Fixed a blocking issue where generated code could contain `Dim c As B4XPPClosure` without emitting/registering `B4XPPClosure.bas` in the generated B4X project.
- Added a transpiler safety net: whenever any generated module references `B4XPPClosure`, the closure runtime class is emitted and added as a normal B4X module.
- This specifically fixes split closure assignments such as `Dim c As Closure` followed by `c = Sub (...) ... End Sub`.
