# Nimbus Core

The mod that ships inside Nimbus Launcher. It replaces Minecraft's red Mojang loading screen with an animated Nimbus one, puts a small Nimbus badge on the title screen, and adds a **Skins & Capes** menu to the title screen and the pause menu.

The launcher puts it into every Fabric and Quilt instance on Minecraft 1.20–1.21.11 and 26.x before each launch. If it gets disabled or deleted, it comes back on the next launch.

Everything it draws is built from filled rectangles (a pixel-art cube, a 5×7 pixel font, particles and a progress bar). That means it works before the game has loaded a single texture or font, and on every version in range without changes.

## Skins & Capes menu

The menu (`SkinsScreenBase`) changes the player's skin, arm model and cape through Mojang's skin service (`SkinApi`), using the access token the game was started with. It reads and writes the launcher's wardrobe folder, which the launcher passes in as `-Dnimbus.wardrobe=<folder>`. Without it, it falls back to `nimbus-skins/` in the game folder.

Like the loading screen, it is painted with rectangles and text only. Skins are decoded by a small PNG reader (`Png`) and drawn pixel by pixel (`SkinArt`), so the menu never touches Minecraft's texture code, which changes between versions. Vanilla buttons are still there for clicks, keyboard focus and narration, but they are not painted.

## Layout

| Folder | What |
|---|---|
| `common/` | The art (`NimbusArt`, `SkinArt`), the `Canvas` interface, the skins menu and Mojang API client, and the mod metadata, shared by both builds |
| `fabric-1.21/` | Built against 1.21.1 with Mojang names, remapped to Fabric intermediary. One jar covers 1.20–1.21.11 |
| `fabric-26/` | 26.x ships unobfuscated and renamed its GUI classes (`GuiGraphicsExtractor`), so it gets its own build |

## Building

```bash
cd fabric-1.21 && ./gradlew build     # JDK 21
cd fabric-26 && ./gradlew build       # JDK 25
cp fabric-1.21/build/libs/*.jar fabric-26/build/libs/*.jar ../resources/mods/
```

The launcher bundles whatever is in `resources/mods/`. Bump `version` in both `gradle.properties` files when the mod changes, so existing instances get the new jar.

## Safety

The mod can't be removed, so it must never break a game:

- Every hook is optional (`"required": false`, `defaultRequire: 0`). If a future Minecraft changes a method, that hook simply doesn't apply.
- Hiding the Mojang logo means zeroing a local variable by its position. That position was checked by bytecode on every release from 1.20 to 26.3. If a later version ever shuffles it, a watchdog notices the loading screen isn't finishing and switches the trick off for the rest of the session.
- The skins menu only opens when you click its button. Its game calls were checked against every release from 1.20 to 26.3. The ones that moved between versions (drawing text, opening a screen) are looked up at runtime, with a fallback.
