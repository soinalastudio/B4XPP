# B4X++ Generic Core example

Demonstrates v0.4.2 usage-driven generic specialization with the bundled `B4XPP.Core.b4xpplib` package.

The project source uses:

```b4x
#B4XPPLibDependsOn B4XPP.Core
Dim result As Result(Of String)
Dim names As TypedList(Of String)
Dim scores As TypedMap(Of String, Int)
```

B4X++ generates only the concrete classes used by the app. It also inserts the required `Initialize` calls before first use, so the source can stay concise:

```text
Result__String.bas
TypedList__String.bas
TypedMap__String__Int.bas
```
