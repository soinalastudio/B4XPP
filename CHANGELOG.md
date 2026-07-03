# Changelog

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
