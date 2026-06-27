# Build report

Prepared for B4X++ public generator v0.1.

Expected extension behavior:

- `B4X++: Build .b4xlib` generates `b4x-libs/B4XAnalogClock.b4xlib`.
- The generated library should not include `B4XPP_Runtime.bas`, because this project does not use `Poly` or implicit dynamic dispatch.
- The generated `.bas` files should not contain `B4XPP_Runtime`, `B4XPP_Dispatch`, `SetResult`, `As Poly`, or `Protected`.
- `#DesignerProperty` and `#Event` directives from `B4XClockViewBase` should be propagated into `B4XAnalogClock.bas`.


## Remaining known compiler fixes addressed in 20260626-1755

- Replaced `B4XCanvas.IsInitialized` checks with `mCanvasReady`.
- Requires B4X++ extension build 20260626-1755 or later so generated setters do not use `Value` as the setter parameter.


## 20260626-1755 fix notes

- Removed `.IsInitialized` checks on B4X++ custom class instances (`HourHand`, `MinuteHand`, `SecondHand`). The PoC now uses an internal `mObjectsReady` flag.
- Renamed the internal ticks collection to `TickItems` and the `SetTimeTicks` parameter to `TimeTicks` to avoid B4X parameter/global name hiding after flattening.
- The package still does not ship a prebuilt `.b4xlib`; generate it with **B4X++: Build .b4xlib** using the VS Code extension.


## 20260626-1755 runtime fix

- Fixed B4J Designer color parsing in `ReadDesignerProps`.
- Color fields now use `xui.PaintOrColorToColor(...)` when reading from `Props`.
- This fixes `java.lang.NumberFormatException: For input string: "0xffffffff"`.


## 20260626-1755 note

B4J can pass Designer color properties from a `.b4xlib` custom view as strings such as `0xffffffff`. The PoC now uses `DesignerColor(Props, Key, DefaultColor)`, which first handles string colors (`0xAARRGGBB`, `#AARRGGBB`, `RRGGBB`) and otherwise falls back to `xui.PaintOrColorToColor`, matching the XUI Views style while being safer for this package.
