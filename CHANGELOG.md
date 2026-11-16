# Release notes

## v6.2-offline.1

- Packages JayElDragon's Godot 6.2 port as one HTML file using threadless Godot WebAssembly and WebGL 2.
- Adds offline startup, fullscreen, a credits dialog, and JSON save import and export. The menu reports when browser storage is unavailable.
- Preserves the original survival gameplay, menus, controls, soundtrack, sound effects, and Pokémon sprites. Animated mode previews reduce the download size.
- Credits KryReaper on the title screen and in the HTML credits, where the Discord invite is linked.
- Verified local offline startup and save handling in Chrome, Edge, and Firefox. See [test results](TEST-RESULTS.md) for coverage and performance measurements.

| Release asset | Value |
| --- | --- |
| File | `PokeSurvivor-Standalone.html` |
| Size | 116,628,589 bytes |
| SHA-256 | `5860aa13a8c99681c99e8ccb869beaa7dd4d6f31c4411c567cf951c2b3bf48fc` |
