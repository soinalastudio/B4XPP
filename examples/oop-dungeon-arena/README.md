# B4X++ OOP Dungeon Arena Example

This example is a small turn-based console game designed to stress-test and showcase B4X++ OOP features.

It demonstrates:

- multiple classes split across folders;
- `Interface` contracts;
- abstract base classes;
- inheritance with `Class ... Extends ...`;
- `Virtual Sub`, `Override Sub`, `Protected Sub` and `Super.Method`;
- `Property` with generated getters/setters;
- custom property accessors with validation;
- `Poly` interface dispatch;
- a `StaticCode` helper module;
- a generated B4J Non-UI project via `#Project`;
- `.b4xlib` packaging directives.

Open this folder in VS Code and run:

1. `B4X++: Sync #Project`
2. `B4X++: Generate .bas Files`
3. `B4X++: Build .b4xlib`

The demo logs several turns of a tiny dungeon battle where a hero collects items, moves toward enemies and fights them using polymorphic actors.
Notes for B4J compatibility:

- actor references that can point to subclasses are stored as `Object` and accessed through `Poly IActor`;
- child classes use generated accessors such as `getName`, `getHealth`, `setAttackPower`, instead of inherited private backing fields like `mName` or `mHealth`;
- `ArenaMath` includes `Process_Globals`, as required by B4J static code modules;
- the demo does not call generated `Initialize2` on a fresh instance because B4X only marks a class object initialized after its `Initialize` Sub is called.

