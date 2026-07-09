# Changelog

## 0.6.0 - BANano MVP and Native B4X Tooling Consolidation

This release consolidates all changes from v0.5.1 through v0.5.18 into the first stable 0.6 milestone.

### Added

- New logical BANano target: `#Project BANano`.
- Generated B4J/BANano project support with BANano and BANanoSkeleton dependencies.
- BANanoSkeleton hello-world web example.
- BANano directives: `#BANanoApp`, `#BANanoTitle`, `#BANanoOutput`, `#BANanoLiveSwap` and generic `#BANano...` grammar support.
- BANano build/run workflow:
  - sync native project;
  - build jar with `B4JBuilder`;
  - run generated jar so BANano emits `index.html` and JavaScript;
  - optionally serve generated output locally.
- Integrated local BANano output server.
- JavaFX-aware BANano jar runner with `b4xpp.banano.javaPath` and `b4xpp.banano.javaFxLibPath`.
- Native B4X language support for `.bas`, `.b4j`, `.b4a`, `.b4i`.
- Native B4X project-file links to modules.
- Separate settings UIs:
  - `B4X++: Configure B4X++ Settings` for global toolchain/library/BANano settings;
  - `B4X++: Configure Current Project Settings` for project-local values.
- Global setting registration for BANano Java, JavaFX and server settings.
- BANano-aware syntax highlighting for `#If CSS`, `#If JAVASCRIPT`, `#If JS`, `#If SmartJavaScript`, `#If JavaScriptSmart`.
- Embedded HTML highlighting for BANano SmartStrings containing HTML, including multiline strings where HTML starts after a newline.
- SmartString support for B4X interpolation such as `${name}`.
- Go to Definition and hover inside SmartString interpolation islands.
- Lightweight HTML/CSS/JS completions in BANano embedded web zones.
- BANano library fallback symbols for core BANano types and common BANanoSkeleton types.
- IntelliSense for variables declared in top-level `Process_Globals`.
- Chained member IntelliSense for expressions such as `Layout.LastRow.Column(1).MarginTop`.
- Chained initializer IntelliSense for expressions inside assignments such as `Dim tp As SKTagPicker = Layout.LastRow.Column(1).Add.TagPicker(...)`.
- Signature help and hover for chained members and chained initializer expressions.

### Changed

- `BANano.Await(...)` is preserved as a BANano method call and no longer conflicts with B4X++ bare `Await` syntax.
- BANano `GetFileAsText` sample now uses the correct three-argument call form.
- B4JBuilder invocation now uses argument-safe execution and official command-line arguments.
- Successful builds no longer show the confusing “No B4X compiler/runtime locations were recognized” message.
- SmartStrings are treated as normal B4X strings by default, with web highlighting only when the content is clearly HTML or BANano web content.
- B4X++ completions are suppressed in embedded HTML/CSS/JS zones and re-enabled only in B4X interpolation islands.
- Library lookup once again checks common B4J library folders and configured library directories.

### Fixed

- `B4X++: Sync #Project` crash caused by `uniqueFiles` being undefined.
- Command activation issue where VS Code reported `command 'b4xpp.syncDirectiveProject' not found`.
- Settings UI failure when writing unregistered BANano settings.
- Windows path handling for tools installed under `C:\Program Files\...`.
- JavaFX runtime missing error when running BANano generator jars with plain `java -jar`.
- False diagnostics for BANano core types such as `BANanoElement` and `BANanoPromise`.
- False `Cannot assign Float to BANanoPromise` diagnostic caused by `/` inside string literals.
- Diagnostic line-number drift after removing B4X++ directives before validation.
- Loss of HTML highlighting in multiline SmartStrings where HTML starts after a newline.
- Missing member completion for `Private BANano As BANano 'ignore` declared in `Process_Globals`.
- Missing completion/hover for chained BANanoSkeleton layout APIs beyond the first member level.
- Missing completion/hover/signature help for chained BANanoSkeleton APIs used inside `Dim ... = ...` initializers.

### Notes

- v0.6.0 does not include the BANano visual designer yet. It prepares the foundation: BANano project generation, build/run/server workflow, native B4X browsing and BANano-aware editing.
- For BANano, a B4J build creates the jar; the jar must then be executed to generate `index.html` and JavaScript. B4X++ now handles this automatically when configured.
