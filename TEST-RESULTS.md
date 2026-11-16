# PokéSurvivor Standalone test results

## KryReaper credits update

Artifact `PokeSurvivor-Standalone.html` · 116,628,589 bytes

SHA-256 `5860aa13a8c99681c99e8ccb869beaa7dd4d6f31c4411c567cf951c2b3bf48fc`

Verified the full KryReaper title credit at 1280 × 760 and 960 × 620. The HTML Credits dialog displayed KryReaper and the supplied Discord invite link. Chrome opened this build from `file://` offline with audio and zero HTTP(S) requests. See `evidence/chrome-credits.json` and the matching screenshots.

## Original gameplay release

Artifact `PokeSurvivor-Standalone.html` · 116,628,197 bytes (111.2 MiB)

SHA-256 `225113f6f87e7f2224666b54c61abc77d6d93a1ce13da85ce44dd27de04e32ca`

Tests ran on Windows using the exported HTML opened via `file://`. Browser contexts were offline before navigation, and a request monitor rejected any attempted HTTP or HTTPS request. The playback test used the delivered file without a local web server. Test browsers used disposable profiles.

| Test | Result |
| --- | --- |
| Direct local and offline startup | Chrome 157.0.8103.78, Edge 157.0.4341.46 and Playwright Firefox 159.0 displayed the original game. `navigator.onLine` was false throughout startup. |
| Runtime dependencies | Zero HTTP(S) requests in the browser sessions. Embedded game data, fonts, textures, engine and audio loaded from the HTML. |
| Core survival and pause | Chrome completed the starter quiz and selected a partner. WASD and arrow keys moved the player. Escape paused the timer and resumed play. Automatic projectiles defeated enemies, dropped XP and advanced the player to level 2. |
| Upgrade choice | The first level-up presented three cards. Clicking a card changed the run's moves or upgrade stats. The completed run reached level 8 and registered 52 defeats at 1:35. |
| Boss encounter | Edge started Boss Rush and observed the first boss live at about 5.6 seconds. This case tested spawning and active combat, with the normal run supplying the death and restart test. |
| Game over and replay | Chrome reached zero HP and displayed game over. The recap recorded the completed run. Play again started a fresh survival session. |
| Audio | Web Audio produced a nonzero output signal after the user gesture in all three browsers. Chrome's complete run started short sound samples during play, and the Edge Boss Rush case also started sound samples. |
| Saves and fallback | Exported JSON, rejection of an invalid JSON save, import with a changed coin balance and persistence across reload passed in all three browsers. A Chrome session with `localStorage` blocked displayed the autosave warning and still exported and imported JSON. |
| Window controls and credits | Canvas resizing passed in all three browsers. Chrome entered and exited fullscreen and opened the accessible credits dialog with the MIT notice. |

## Performance and memory

A 2:10 gameplay stress run in headless Chrome used the Low graphics preset at a 1280 × 717 backing resolution, with Horde and Plague enabled and a trainer given permanent upgrades for the test. The run peaked at 71 active enemies and ended in game over at level 18 with 579 defeats. There were zero browser errors or crashes in the recorded run.

Across 13 periodic samples, Godot reported 94–183 FPS (median 130). The summed Chromium renderer working set ranged from 821 to 1,012 MiB, rising from 841 MiB in the first sample to 961 MiB in the last. Reported JavaScript heap usage was 190 MiB at the sampled precision. The renderer working set includes engine and browser allocations beyond the reported JavaScript heap. These are sampled measurements for one machine and configuration. They do not characterize frame-time percentiles or memory behavior over a full 60-minute run.

See `evidence/` for machine-readable results and screenshots of the actual file. The tested paths cover freestanding offline use, normal keyboard/mouse survival, the first Boss Rush encounter and profile management. Localization, controllers and late-game encounter combinations have narrower verification coverage.
