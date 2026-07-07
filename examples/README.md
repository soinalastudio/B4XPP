# B4X++ Examples

This folder contains five ready-to-copy B4X++ examples:

- `basic-animal`: a simple OOP example with `Animal`, `Dog`, `Cat` and `Bird`.
- `language-showcase`: a broader sample demonstrating most B4X++ directives and keywords.
- `closure-console`: a B4J Non-UI example showing `Closure` / anonymous `Sub`, captured local variables and passing closures to another class.
- `oop-dungeon-arena`: a small turn-based game using heavier OOP patterns: interfaces, inheritance, abstract classes, overrides, `Super`, custom property accessors, `Poly` dispatch and a `StaticCode` helper module.
- `xui-breakout`: a B4J UI + XUI Breakout game using `B4XCanvas`, a `Timer`, mouse input, entities, services, collisions and rendering.

Open one example folder in VS Code, then run:

1. `B4X++: Sync #Project` to generate a B4J/B4A/B4i test project.
2. `B4X++: Transpile Workspace` to inspect the generated B4X modules.
3. `B4X++: Build .b4xlib` to package reusable B4X components.


### B4X naming caution

Avoid parameter or local variable names that match existing Subs in the same generated module. The XUI Breakout example uses `BallCenterX` / `BallCenterY` instead of `CenterX` / `CenterY` in `Ball.ResetAt` for this reason.
