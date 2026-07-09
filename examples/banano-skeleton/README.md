# B4X++ BANanoSkeleton sample

This is the first B4X++ BANano target sample for v0.5.1.

Goal:

1. Open this folder in VS Code.
2. Run `B4X++: Sync #Project`.
3. Open `b4x-ide-projects/B4XPPBananoSkeletonHello-banano/B4XPPBananoSkeletonHello.b4j` in B4J.
4. Make sure `BANano` and `BANanoSkeleton` are installed in the B4J Additional Libraries folder.
5. Run the B4J project. BANano will generate the web app under `Objects/B4XPPBananoSkeletonHello/` with `index.html`, CSS and JavaScript files.
6. Serve the generated folder with a local web server for browser APIs that do not work from `file://`.

This sample intentionally has no designer yet. It validates the language target, project generation, BANanoSkeleton dependency, `BANano.Build(File.DirApp)`, `#If CSS`, and preserving `BANano.Await(...)`.
