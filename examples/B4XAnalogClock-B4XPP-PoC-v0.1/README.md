# B4XAnalogClock - B4X++ proof of concept

`B4XAnalogClock` is a small XUI custom view written in B4X++ and intended to be packaged as a `.b4xlib` with the VS Code extension.

It demonstrates B4X++ in a realistic component-library scenario:

- `Class` and one-class-per-generated-`.bas` output.
- `Extends` with flattened `.bas` generation.
- `Super.Initialize` and inherited method reuse.
- `Property` with default values.
- inherited `#DesignerProperty` and `#Event` propagation to the final custom view.
- `StaticCode` helper module.
- XUI / B4XCanvas custom view usable from code and from the Designer.
- B4A + B4J `.b4xlib` packaging.

## Structure

```text
src-b4xpp/
  B4XAnalogClockLib.bx          # library directives and includes
  B4XAnalogClock.bx             # final CustomView class
  core/
    B4XClockViewBase.bx         # common custom view behavior and designer properties
    B4XClockDrawableBase.bx     # base drawable object
    B4XClockMath.bx             # StaticCode helper
  objects/
    B4XClockHand.bx             # base hand object
    B4XClockHourHand.bx
    B4XClockMinuteHand.bx
    B4XClockSecondHand.bx
    B4XClockNumber.bx
    B4XClockTick.bx
examples/
  B4J-B4XPages/B4XMainPage.bas
  B4A-B4XPages/B4XMainPage.bas
```

## Build the .b4xlib

Install the matching B4X++ VS Code extension build, open this folder in VS Code, then run:

```text
Ctrl + Shift + P
B4X++: Build .b4xlib
```

The extension will create:

```text
b4x-libs/B4XAnalogClock.b4xlib
```

Copy that file to your B4X Additional Libraries folder. Restart B4A/B4J, then select:

```text
B4XAnalogClock
XUI / jXUI
```

## Use from code

```vb
Sub Class_Globals
    Private Root As B4XView
    Private xui As XUI
    Private Clock As B4XAnalogClock
End Sub

Private Sub B4XPage_Created (Root1 As B4XView)
    Root = Root1
    Clock.Initialize(Me, "Clock")
    Clock.AddToParent(Root, 20dip, 40dip, 300dip, 300dip)
    Clock.Start
End Sub
```

## Use from Designer

After copying the generated `.b4xlib` to Additional Libraries and restarting the IDE:

1. Open the Designer.
2. Add a `CustomView`.
3. Set its class/type to `B4XAnalogClock`.
4. Configure the designer properties such as `FaceColor`, `ShowNumbers`, `ShowTicks`, `ShowSecondHand`, `NumberSize`, etc.

## Why this is a good B4X++ example

The final B4X class `B4XAnalogClock` inherits designer properties and behavior from `B4XClockViewBase`, while the clock hands, ticks and numbers are modeled as separate objects.

B4X++ keeps the source maintainable, then generates B4X-compatible `.bas` files for the `.b4xlib`.


## 20260626-1755 notes

This PoC avoids `B4XCanvas.IsInitialized` and uses an internal `mCanvasReady` Boolean, as `B4XCanvas` does not expose `IsInitialized` consistently across B4X targets.
Generated `Property` setters also use internal parameter names such as `B4XPP_Value` to avoid B4X compiler name-hiding errors.


## 20260626-1755 fix notes

- Removed `.IsInitialized` checks on B4X++ custom class instances (`HourHand`, `MinuteHand`, `SecondHand`). The PoC now uses an internal `mObjectsReady` flag.
- Renamed the internal ticks collection to `TickItems` and the `SetTimeTicks` parameter to `TimeTicks` to avoid B4X parameter/global name hiding after flattening.
- The package still does not ship a prebuilt `.b4xlib`; generate it with **B4X++: Build .b4xlib** using the VS Code extension.

### Runtime fix 20260626-1755

B4J Designer may pass `Color` designer properties as strings such as `"0xffffffff"`. The PoC now reads color properties with `xui.DesignerColor(...), which wraps PaintOrColorToColor and also parses string colors such as 0xffffffff`, following the same pattern used by official XUI Views. This fixes the runtime `NumberFormatException` in `ReadDesignerProps`.


## 20260626-1755 note

B4J can pass Designer color properties from a `.b4xlib` custom view as strings such as `0xffffffff`. The PoC now uses `DesignerColor(Props, Key, DefaultColor)`, which first handles string colors (`0xAARRGGBB`, `#AARRGGBB`, `RRGGBB`) and otherwise falls back to `xui.PaintOrColorToColor`, matching the XUI Views style while being safer for this package.
