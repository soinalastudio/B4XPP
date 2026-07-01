# Changelog

## 0.3.5 - 2026-07-01

- Fixed B4X++ property assignment sugar inside one-line `If ... Then` statements.
- `If gainedPoints > 0 Then Remaining = getRemaining - 1` now generates `If gainedPoints > 0 Then setRemaining(getRemaining - 1)`.
- Regenerated the XUI Breakout example and B4J project files with the inline setter fix.

## 0.3.4 - 2026-07-01

- Added B4X++ property assignment sugar: `Property = value` is generated as `setProperty(value)` in `.bas` files.
- Updated VS Code hover/snippet guidance to recommend safe argument names such as `aX`, `aWidth`, `aColor`.
- Updated the XUI Breakout example and its Create Example Project template with readable `.bx` source and clean generated `.bas` output.
- Added tests to prevent property assignment sugar from leaking into generated B4X files.

## Unreleased

### Added
- Added source-level property assignment sugar: inside a class, `PropertyName = value` is generated as `setPropertyName(value)`.
- Added safer generated parameter renaming to `aName` when a source parameter collides with a property, method, module/class, generated field or B4X keyword.
- Added VS Code hover help for properties that explains `Property = value` first and shows debug metadata below the help.
- Added `examples/xui-breakout`, a B4J UI + XUI Breakout game written in B4X++ with `B4XCanvas`, a `Timer`, mouse input, OOP entities, services, collision handling and a ready-to-open B4J project.
- Added `XUI game sample: Breakout` to `B4X++: Create Example Project`.

### Changed
- Updated the XUI Breakout source to use readable property assignments such as `X = aX` and safe argument names such as `aWidth`, with explanatory comments under constructors and Subs.

### Fixed
- `B4X++: Sync #Project` now preserves platform-specific project dependencies such as `#B4JDependsOn jXUI` when generating B4J projects.

## 0.3.3 - 2026-07-01

### Fixed
- Reworked VS Code completion to be scope-aware in normal code and expression contexts.
- Removed the legacy completion provider from activation so old keyword/directive suggestions no longer pollute IntelliSense.
- Prevented `#Class`, `#Property`, type names and top-level directives from appearing while typing expressions such as `If x = ...`.
- Added local variables, parameters, class fields, properties and visible methods to completion inside method bodies.
- Added expression completions for `True`, `False`, `Null`, `Not`, `And`, `Or`, built-in modules and current-scope methods.
- Kept directive completion restricted to `#...` contexts and type completion restricted to `As`, `Extends`, `Implements` and `Poly` contexts.

### Notes
- v0.3.3 is an IntelliSense quality fix. It does not change generated `.bas` output compared with v0.3.2.

## 0.3.2 - 2026-07-01

### Added
- Complete navigation pass for `.bx` files: improved Go to Definition for types, local variables, fields, properties, methods, `Super`, `This` / `Me` and `#Include` targets.
- Find References provider for B4X++ symbols.
- Safe Rename provider for local variables, parameters, fields, properties and methods. Type / module rename remains intentionally disabled until a full workspace rename engine is added.
- Auto Include quick fix: when a referenced class / interface / static module exists in `src-b4xpp` but is not included by the current source file, VS Code can add the correct `#Include`.
- `B4X++: Validate B4XLib / CustomViews` command.
- CustomView assistant diagnostics: validates `Initialize`, `DesignerCreateView`, `Base_Resize`, `mBase`, `Tag`, `#DesignerProperty` and `#Event` shape.
- B4XLib manifest diagnostics for `#B4XLib`, `#Version`, `#Author` and `#SupportedPlatforms`.
- Quick fix for Designer color reads to wrap `Props.Get(...)` / `Props.GetDefault(...)` with `xui.PaintOrColorToColor(...)`.

### Fixed
- Fixed safe method overload generation when class body lines are transformed after `Class_Globals` extraction.
- Overloaded methods without explicit `Public` / `Private` / `Protected` are now renamed correctly in generated B4X output, e.g. `Sub TestDraw()` + `Sub TestDraw(i As Int)` becomes `TestDraw` + `TestDraw2`.
- Call-site rewriting for these overloads is preserved.

## 0.3.1 - Constructor and safe method overloads

This release adds B4X++-level overloads while keeping generated B4X compatible with classic B4X naming conventions.

### Added
- Multiple `#Constructor(...)` declarations in the same class.
- Automatic generation of `Initialize`, `Initialize2`, `Initialize3`, ... when a class has overloaded constructors.
- Call-site rewriting for constructor overloads, for example `p.Initialize("Jane", 12)` -> `p.Initialize3("Jane", 12)`.
- `Super.Initialize(...)` overload resolution during flattening, including calls to generated parent methods such as `B4XPP_Super_Animal_Initialize2(...)`.
- Safe method overloads when overloads have different parameter counts. Generated B4X methods use suffixes: `SetValue`, `SetValue2`, `SetValue3`, ...
- Call-site rewriting for safe method overloads based on argument count.
- IntelliSense signature help now shows all overload signatures for constructors and methods.
- Completion / hover keeps the source-facing method name while showing overload signatures.
- Semantic diagnostics for ambiguous same-arity overloads. Type-based overload resolution is intentionally deferred.

### Notes
- v0.3.1 resolves overloads by parameter count only. `Sub SetValue(Value As String)` and `Sub SetValue(Value As Int)` are reported as ambiguous because both have one parameter.
- All v0.1, v0.2.x and v0.3.0 features remain available.

## 0.3.0 - Language intelligence

This release starts the B4X++ IntelliSense track. It keeps all v0.1, v0.2, v0.2.1 and v0.2.2 features intact and focuses on making `.bx` editing feel closer to a real B4X development environment.

### Added
- Workspace IntelliSense indexer for `src-b4xpp/**/*.bx` files.
- `B4X++: Refresh IntelliSense Index` command.
- Extended completion after `.` for B4X++ classes, interfaces, static modules, properties, fields and methods.
- Context-aware visibility rules in completion: external code sees `Public`; subclasses see `Public` + `Protected`; class internals see all members.
- `Super.` and `This.` / `Me.` member completions based on the inheritance hierarchy.
- Override candidate snippets from parent `Virtual`, `Abstract` and `Override` methods.
- Type completions for B4X++ classes, interfaces and common B4X/XUI types.
- Hover information for classes, interfaces, static modules, properties, fields and methods.
- Signature help for B4X++ methods and a first set of common XUI/B4X members.
- Document symbols and workspace symbols for `.bx` files.
- Semantic diagnostics for duplicate symbols, missing `#Include`, missing parent classes, missing interfaces, inheritance cycles, invalid overrides and inaccessible `Protected` / `Private` member calls.
- CustomView-specific warning when Designer `Color` properties are read without `xui.PaintOrColorToColor(...)` or a helper such as `DesignerColor(...)`.
- New setting: `b4xpp.enableSemanticDiagnostics`.

### Notes
- v0.3.0 does not yet index external installed `.b4xlib` libraries. Unknown external B4X types are therefore reported as warnings, not errors.
- This release is intentionally focused on editing intelligence. The transpiler output remains compatible with the v0.2.2 workflow.

## 0.2.2 - Source maps, remapping and debug bundle

### Added
- Fine-grained best-effort `.b4xpp/sourceMap.json` mappings from generated `.bas` lines back to `.bx` source lines.
- `B4X++: Remap B4X Compiler / Runtime Errors` command. Paste B4J/B4A/B4i compiler output or runtime stack traces and B4X++ maps generated module/line locations back to `.bx` files.
- `B4X++: Generate Debug Bundle` command. Writes `.b4xpp/debug-bundle.json` with generator version, outputs, diagnostics, hashes and metadata references.
- `B4X++: Run B4J Build Command + Remap Errors` command with configurable `b4xpp.b4jBuildCommand`.
- New settings: `b4xpp.b4jBuildCommand` and `b4xpp.writeLineSourceMap`.

### Notes
- The source map is intentionally best-effort in v0.2.2. Exact unchanged/transformed lines are mapped directly; generated helper lines fall back to the nearest source context.
- This release keeps all v0.1 / v0.2 / v0.2.1 features intact.

## 0.2.1 - Custom property accessors

This maintenance release keeps all v0.2.0 functionality and adds custom getter / setter support for `#Property` and computed properties.

### Added

- `Public Get PropertyName As Type` / `End Get` custom getters.
- `Public Set PropertyName(Value As Type)` / `End Set` custom setters.
- `Protected` and `Private` custom accessors. `Protected` is still lowered to B4X-compatible `Private` in generated `.bas` files.
- Partial custom properties: `#Property` still generates the backing field and only auto-generates missing accessors.
- Manual computed properties without `#Property`, for example `Public Get IsReady As Boolean`.
- Tests covering custom getters, custom setters, protected getters, computed properties and setter parameter renaming.

### Fixed

- Custom setters named like `setValue(Value As Int)` now have their parameter safely renamed in generated B4X to avoid `Parameter name cannot hide global variable name`.
- `symbols.json` now includes custom accessors as generated property methods through the existing method metadata pipeline.

## 0.2.0 - OOP language server groundwork

This release keeps all v0.1 workflows and adds the first v0.2 foundations for safer B4X++ development.

### Added

- Generator version bumped to `v0.2`; generated files now include `AUTO-GENERATED BY B4X++ v0.2`.
- First-class `Public`, `Protected` and `Private` parsing for B4X++ method declarations.
- `#Property Public`, `#Property Protected` and `#Property Private` with default values.
- `Protected` is accepted in `.bx` source but lowered to B4X-compatible `Private` in generated `.bas`.
- Inherited `Private` fields and methods are renamed during flattening to avoid accidental child access or collisions.
- Metadata generation in `.b4xpp/symbols.json` and `.b4xpp/sourceMap.json`.
- Basic IntelliSense completion for B4X++ visibility keywords, `Super.`, `This.`, member calls and `Override` candidates.
- Diagnostics for invalid `Private Override`, `Private Virtual` and overriding private parent methods.
- Diagnostics for invalid access to `Protected` / `Private` members from outside the allowed scope.

### Fixed

- Protected methods used from `#MainModule` or unrelated classes are now reported by B4X++ before B4J/B4A compilation.

- Removed a duplicated `Case 2` branch in the runtime external dispatch fallback.
- Kept v0.1 features intact: `#Include`, `#Project`, `.b4xlib` build, flattened `#Extends`, `Super.Method`, inherited designer properties/events, natural polymorphism and generated runtime when needed.

## 0.1.0 - Public preview

### Build 20260626-1235
- Added `#StaticCode` / `#End StaticCode` for porting existing B4X static modules.
- Added a B4XDaisy UIKit B4X++ port starter in the downloadable bundle.



### Maintenance build 20260626-1205

- Clarified `B4XPP_Runtime.Dispatch`: B4X++ generated targets support unlimited method arguments through `B4XPP_Dispatch(MethodName, Args As List)`.
- Moved the 0..2 argument limitation into the explicit external fallback path used only for non-B4X++ objects.
- Updated generated examples and README wording to avoid confusion around `CallSub3`.


This release resets the extension version to **0.1.0** for the first public GitHub preview. Generated B4X files use the B4X++ generator version **v0.1** in their headers.

### Added

- `.bx` language support for VS Code.
- Syntax highlighting and snippets for B4X++ directives and OOP keywords.
- B4X++ to classic B4X `.bas` generation.
- Flattened `#Extends` generation: inherited fields, methods, properties, `#DesignerProperty` and `#Event` directives are emitted into the final child class.
- `#Project` based B4A / B4J / B4i project synchronization.
- `.b4xlib` packaging for component/library developers.
- `#Include` with Ctrl+Click / F12 navigation.
- Lightweight symbol navigation for classes, parent classes, variables, `Super`, `This`, and common member calls.
- Interfaces as B4X++ metadata contracts.
- Default values for `#Property`, for example `#Property Title As String = "Untitled"`.
- Collision diagnostics during flattening for inherited fields and methods.
- Preservation of B4X conditional directives such as `#If B4A`, `#If B4J`, `#If B4i` and `#If Java`.
- Natural polymorphism for declarations such as `Dim animal As Animal` followed by child assignments, generated with `Object` + `B4XPP_Runtime.Dispatch`.
- Explicit polymorphism with `Poly` variables and `B4XPP_Runtime.Dispatch`.
- Versioned generated headers:
  - `AUTO-GENERATED BY B4X++ v0.1`
  - `GeneratorVersion: 0.1`
- Warning before overwriting B4X++ generated files created by another generator version.
- Two clean public examples:
  - Basic OOP sample: `Animal`, `Dog`, `Cat`, `Bird`.
  - Language showcase sample covering most B4X++ keywords.

### Fixed

- Replaced generated class dispatch signatures that used `Args() As Object` with a `List` based class dispatcher to improve B4X IDE compatibility.
- Runtime argument helpers now generate calls such as `B4XPP_Runtime.Args0` and `B4XPP_Runtime.Args3(...)`, avoiding `Array As Object(...)` in generated user modules.
- Public examples no longer contain domain-specific names.
- Basic Animal example now avoids variable names identical to module names, preventing B4X warning #30.
- Basic Animal example now uses natural `Dim animalInstance As Animal` polymorphism instead of `Poly IAnimal`.

## 0.1.0 public build 20260626-1435

- Improved `.b4xlib` packaging compatibility with the B4X IDE.
- Writes `manifest.txt` with B4X numeric versions (`0.10` instead of semver `0.1.0`).
- Uses B4J-style module headers for `.b4xlib` modules, matching the common XUI Views pattern.
- Places `#DesignerProperty` and `#Event` directives immediately after `@EndOfDesignText@` in generated B4X modules.


### Build 20260626-1445
- Fixed `.b4xlib` runtime packaging for generated dynamic dispatch methods (`B4XPP_Runtime`).
- Prevents B4X errors such as `Variable non déclarée b4xpp_runtime` when a library contains generated `B4XPP_Dispatch` methods.
### 20260626-1620 internal build

- Fixed `.b4xlib` generation so `B4XPP_Runtime` and `B4XPP_Dispatch` are emitted only when dynamic dispatch is actually used.
- Lowered `Protected` fields to B4X-compatible `Private` fields during flattening.
- Kept public version at `0.1.0` / generator `v0.1`.

### 20260626-1645 maintenance build
- Fixed generated `#Property` setters to avoid B4X's `Parameter name cannot hide global variable name` error by using internal setter parameter names.
- B4XAnalogClock PoC notes updated: use a canvas-ready Boolean instead of `B4XCanvas.IsInitialized`.



### v0.1.0 public build 20260626-1735

- Fixed generated method parameters that collide with generated Class_Globals fields. The transpiler now renames colliding parameters and rewrites their method body references.
- Keeps .b4xlib generation conservative for custom views: no runtime module unless dynamic dispatch is actually used.


### 20260626-1735

- Added a diagnostic warning for unsafe B4J Designer color reads: color designer properties should be read through `xui.PaintOrColorToColor(...)`.


## 20260626-1755

- Updated the Designer color diagnostic note. XUI Views normally use `xui.PaintOrColorToColor(Props.Get(...))`, but B4J `.b4xlib` CustomViews can still pass colors as strings such as `0xffffffff`; component authors should use a defensive helper when needed.
- Packaging checked: VSIX contains `extension/package.json`.
