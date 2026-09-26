# Nimbus Core

The mod that ships inside Nimbus Launcher. It replaces Minecraft's red Mojang loading screen with an animated Nimbus one, puts a small Nimbus badge on the title screen, and adds **Skins & Capes** and **Nimbus Features** menus to the title screen and the pause menu.

The launcher puts it into every Fabric and Quilt instance on Minecraft 1.20–1.21.11 and 26.x before each launch. If it gets disabled or deleted, it comes back on the next launch.

Everything it draws is built from filled rectangles (the pixel-art Nimbus logo, a block inside a tilted halo ring, plus a 5×7 pixel font, particles and a progress bar). That means it works before the game has loaded a single texture or font, and on every version in range without changes.

## Skins & Capes menu

The menu (`SkinsScreenBase`) changes the player's skin, arm model and cape through Mojang's skin service (`SkinApi`), using the access token the game was started with. Its search box looks up players by exact name (Mojang) and skins by keyword (the MineSkin gallery), with results arriving on a background thread. It reads and writes the launcher's wardrobe folder, which the launcher passes in as `-Dnimbus.wardrobe=<folder>`. Without it, it falls back to `nimbus-skins/` in the game folder.

Like the loading screen, it is painted with rectangles and text only. Skins are decoded by a small PNG reader (`Png`) and drawn pixel by pixel (`SkinArt`), so the menu never touches Minecraft's texture code, which changes between versions. Vanilla buttons and the vanilla text box are still there for clicks, typing, keyboard focus and narration, but they are not painted.

## Nimbus Features

`FeaturesScreenBase` lists every option (`Features`) in three tabs: HUD, Performance and Utilities. The HUD boxes (`NimbusHud`) are drawn after the vanilla HUD (`HudMixin`) and placed with `HudEditorBase`, which stores each box's position as a fraction of the screen, so layouts survive a window resize. Zoom, fullbright and the background FPS limit (`Tweaks`) bend vanilla options past their normal range through an accessor (`OptionAccess`) and put the real values back when they're switched off. Everything is saved to the file given as `-Dnimbus.features=<file>` (the launcher shares one between all instances), or `config/nimbus-features.json` without it.

Right Shift opens the menu and C zooms. On 26.3, which reads keys through SDL, the key codes are translated at runtime.

## Menu background

`MenuBackground` replaces the spinning panorama behind the title screen and the menus with the Nimbus glow or a picture (`PanoramaMixin`; 1.20–1.20.4 draw it from `TitleScreenMixin`). The picture comes from `-Dnimbus.menu.image=<png>` (the launcher's `menu-background.png`), or `config/nimbus-background.png`. It is decoded by `Png`, scaled and cropped to the window by `Picture` on a background thread, written back out as a PNG and handed to Minecraft's own image loader, so the only texture calls are the few in `Compat`. *Choose…* opens LWJGL's tinyfd file dialog, or SDL's on 26.3, which no longer ships tinyfd.

## Animation options

The launcher passes *Settings → Animations* in as system properties: `nimbus.anim.loading`, `particles`, `badge`, `menus` (each `true`/`false`), `nimbus.anim.speed` (a multiplier), and `nimbus.anim.style` / `nimbus.anim.reloadStyle` (`spin`, `bounce`, `splash`, `pulse`, `flip` or `still`) for the logo while the game starts and while resource packs reload. With `loading=false` every loading-screen hook steps aside and Mojang's screen shows as usual.

The loading screen times its fades with vanilla's `Util.getMillis()`, never `System.nanoTime()`: on 26.x the two clocks differ, and mixing them made the Nimbus screen vanish (and Mojang's logo flash) when loading finished.

## Layout

| Folder | What |
|---|---|
| `common/` | The art (`NimbusArt`, `SkinArt`), the `Canvas` interface, the skins menu and Mojang API client, Nimbus Features (menu, HUD, editor, tweaks, config), and the mod metadata, shared by both builds |
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
- The HUD, the Features menu and the tweaks catch their own errors: an option that doesn't exist in a version is simply skipped.
- The skins menu only opens when you click its button. Its game calls were checked against every release from 1.20 to 26.3. The ones that moved between versions (drawing text, opening a screen) are looked up at runtime, with a fallback.
