# B4X++ Closure Console Demo

A small B4J Non-UI example showing B4X++ closures / anonymous `Sub` literals.

It demonstrates:

- `Dim say As Closure = Sub(...)` without capture;
- a closure that captures a local variable from the parent scope;
- passing a closure to another class as a `B4XPPClosure` runtime value;
- generated classic B4X `.bas` output.

Open `src-b4xpp/Demo.bx`, run **B4X++: Transpile Workspace**, then open the generated B4J project under `b4x-ide-projects/B4XPPClosureConsole-b4j-nonui`.
