# PokéSurvivor Standalone development kit

Open `PokeSurvivor-Standalone.html` directly in Chrome, Edge or Firefox. Copy the HTML wherever you want to play. It needs WebGL 2 and a current desktop browser. From the game menu, **Save files** exports or imports a JSON backup. Autosave is specific to the browser and file location. Export before moving to another computer or browser.

The title screen credits KryReaper for the standalone edition. The HTML Credits dialog includes the Discord invite.

## Build

The Godot project at `1eb34592308f7c1731b3939a37738619b797609e` is the game source. This kit contains the browser-specific source, source transformations, export configuration, packaging code and tests. The upstream checkout supplies gameplay scripts and licensed assets.

1. Clone `https://github.com/JayElDragon/poke-survivor.git` into a disposable directory and check out `1eb34592308f7c1731b3939a37738619b797609e`.
2. Download Godot 4.7.2 Standard Windows from the `godotengine/godot-builds` tag `4.7.2-stable`. Extract the Windows editor ZIP. From `Godot_v4.7.2-stable_export_templates.tpz`, extract `templates/web_nothreads_release.zip`.
3. With Node.js 22 or newer, run the command below. Use a disposable checkout because the build applies source edits and overrides its export preset. Godot's first import and full export can each take several minutes.

```powershell
node build.mjs C:/dev/poke-survivor C:/dev/godot/Godot_v4.7.2-stable_win64_console.exe C:/dev/templates/web_nothreads_release.zip C:/dev/output/PokeSurvivor-Standalone.html
```

The build imports the upstream assets using the desktop-compatible Godot renderer, exports a threadless WASM engine and resource pack, gzip-compresses the pack and engine, then base64-encodes them in bounded chunks. It inlines the browser shell and loader, validates script syntax and the Wasm and PCK signatures, round-trips the compressed data, and reports the HTML size and SHA-256. Godot's intermediate export and import/export logs are written to `web-export` next to the checkout. Only the final HTML goes to the playback computer.

`build.mjs --pack-only` also accepts an existing `web-export` with `game.pck`, `godot.js`, `godot.wasm` and both audio worklets. Use it after editing the shell when the Godot project has already been exported.

To package the verified HTML for ordinary static HTTPS hosting, run `node build-hosted.mjs PokeSurvivor-Standalone.html dist`. This extracts the exact compressed resources from the offline file. The generated `index.html` loads its assets from the same directory over HTTPS.

## Code map

| System | Godot source and browser execution |
| --- | --- |
| Entry, title and character selection | `project.godot` launches `scenes/menu.tscn` and `scripts/menu.gd`. The menu runs the starter survey, Pokémon picker, mode selection and settings. `starters_data.gd`, `data/pokedex.json` and `save_data.gd` supply unlocks, stats and a starting move. The offline shell calls the title ready when the Godot scene is active. |
| Player, camera and input | `scenes/main.tscn` runs `main.gd`. `_add_input_actions`, `_unhandled_input` and `_update_player` map WASD, arrows, touch and gamepad through Godot. Godot continues to handle camera, coordinates, sprites and UI. The browser resizes the canvas to the available viewport. |
| Enemies, movement and attacks | `_update_spawner` creates time-scaled casts and timed surges. `_enemy_step`, `_enemy_special`, `_enemy_shoot` and `_update_ebullets` drive pursuit, leading, dashes, ranged spacing and collision. `tileworld.gd` handles terrain and wall collision. `navgrid.gd` is menu-focus navigation. |
| Player combat | `_tick_move` and `_nearest_enemy` drive automatic casts. `_update_bullets`, `_hit_enemy`, `_damage_enemy` and `_hurt_player` keep the native projectile, area, type, status and damage rules. `moves_data.gd`, `types_data.gd`, `abilities.gd`, `evo_abil.gd` and `fusions.gd` define combat content. |
| XP and upgrades | `_drop`, `_update_orbs` and `_gain_xp` retain drop values, pickup and thresholds. `_offer`, `_on_card_chosen`, `_level_up_move` and `_evolve` implement acquisition, cards and evolutions. Permanent upgrades remain in `save_data.gd`. |
| Waves, bosses and events | `_update_director`, `_spawn_boss`, `_boss_move`, `_boss_cast` and `_update_rush` retain wave timing and mechanics. `arena.gd`, `judgment.gd`, `invasion.gd`, `alpha.gd`, `meteor.gd` and other encounter scripts stay in the Godot pack. |
| Worlds and special areas | `tileworld.gd`, `poi.gd`, `cave.gd`, `cave_int.gd`, `lab_int.gd` and `kecleon.gd` retain terrain, biome generation, pickups, shops and interiors. `data/sprite_meta.json` drives frames from upstream sprite sheets. |
| UI, audio and language | The menus, Godot CanvasItem HUD/cards, `pause_ui.gd`, VFX modules and `lang.gd` remain native in the Web build. `audio.gd` keeps its pooled sound players, music and volume controls. Embedded worklet scripts are supplied as data URLs to Godot's Web Audio backend. |
| Progression and saving | `save_data.gd`, `progress.gd`, `ach.gd`, `challenges.gd` and menu systems retain currency, permanent upgrades, records, achievements and collections. Save writes cross the Godot JavaScript bridge to browser storage with an in-memory fallback. Imports reload the menu with the imported trainer. |

## Scope and browser differences

- The Web edition runs the Godot gameplay and source UI through WASM and WebGL 2. It retains Godot's update order and simulation timing. Browser integration is in `offline_bridge.gd`, `prepare.mjs`, `boot.js`, and the HTML/CSS shell.
- Native Android updates and the donation screen are removed from the browser flow. Credits and the manual What's New screen are available in the game. Fresh profiles mark the included release notes as seen so the recap and replay controls appear after the first run. Mode preview videos are excluded and Godot's animated mode previews take their place.
- Graphics options, localized screens and gamepad code ship with the game. Their complete combinations, and every encounter and item, require more testing. Hardware and browser settings affect rendering and sound.
- Exported saves are version-1 Godot-edition trainer JSON. An in-progress battle cannot be resumed from a save file. Save files are managed from the menu. The separate hosted browser game's saves have not been tested for interchange.
- Code notices, the sprite creator table, the noncommercial sprite terms and font/engine notices are embedded in the Credits dialog. See `notices/` for development copies. Upstream code and asset licenses apply to their respective materials.

## Tests

`qa.mjs` and `qa-play.mjs` use Playwright. Set `POKESURVIVOR_PLAYWRIGHT` to your installed module if `playwright` is outside the kit directory. `qa.mjs` takes the artifact, browser name, executable path (or `-` for Playwright's browser), and scenario (`smoke`, `no-storage`, `controls`, `credits`, `flow`, `boss`, or `stress`). It puts screenshots and JSON results in `POKESURVIVOR_TEST_OUTPUT` or `qa-output`. The last three scenarios enable the shell's read-only diagnostics to sample the actual run.

```powershell
npm install playwright
npx playwright install firefox
node qa.mjs C:/dev/output/PokeSurvivor-Standalone.html chrome 'C:/Program Files/Google/Chrome/Application/chrome.exe' smoke
node qa.mjs C:/dev/output/PokeSurvivor-Standalone.html firefox - smoke
```
