# Nimbus Core

The mod that ships inside Nimbus Launcher. It replaces Minecraft's red Mojang loading screen with an animated Nimbus one, and puts a small Nimbus badge on the title screen.

The launcher puts it into every Fabric and Quilt instance on Minecraft 1.20–1.21.11 and 26.x before each launch. If it gets disabled or deleted, it comes back on the next launch.

Everything it draws is built from filled rectangles (a pixel-art cube, a 5×7 pixel font, particles and a progress bar). That means it works before the game has loaded a single texture or font, and on every version in range without changes.

## Layout

| Folder | What |
|---|---|
| `common/` | The art (`NimbusArt`), the `Canvas` interface and the mod metadata, shared by both builds |
| `fabric-1.21/` | Built against 1.21.1 with Mojang names, remapped to Fabric intermediary. One jar covers 1.20–1.21.11 |
| `fabric-26/` | 26.x ships unobfuscated and renamed its GUI classes (`GuiGraphicsExtractor`), so it gets its own build |

## Building

```bash
cd fabric-1.21 && ./gradlew build     # JDK 21
cd fabric-26 && ./gradlew build       # JDK 25
cp fabric-1.21/build/libs/*.jar fabric-26/build/libs/*.jar ../resources/mods/
```

The launcher bundles whatever is in `launcher/resources/mods/`. Bump `version` in both `gradle.properties` files when the mod changes, so existing instances get the new jar.

## Safety

The mod can't be removed, so it must never break a game:

- Every hook is optional (`"required": false`, `defaultRequire: 0`). If a future Minecraft changes a method, that hook simply doesn't apply.
- Hiding the Mojang logo means zeroing a local variable by its position. That position was checked by bytecode on every release from 1.20 to 26.3. If a later version ever shuffles it, a watchdog notices the loading screen isn't finishing and switches the trick off for the rest of the session.
