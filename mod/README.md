# Nimbus Core

The mod that ships inside Nimbus Launcher. It replaces Minecraft's red Mojang loading screen with an animated Nimbus one, puts a small Nimbus badge on the title screen, and adds **Skins & Capes** and **Nimbus Features** menus to the title screen and the pause menu.

The launcher puts it into every Fabric and Quilt instance on Minecraft 1.20–1.21.11 and 26.x before each launch. If it gets disabled or deleted, it comes back on the next launch.

Everything it draws is built from filled rectangles (the pixel-art Nimbus logo, a block inside a tilted halo ring, plus a 5×7 pixel font, particles and a progress bar). That means it works before the game has loaded a single texture or font, and on every version in range without changes.

## Skins & Capes menu

The menu (`SkinsScreenBase`) changes the player's skin, arm model and cape through Mojang's skin service (`SkinApi`), using the access token the game was started with. Its search box looks up players by exact name (Mojang) and skins by keyword (the MineSkin gallery), with results arriving on a background thread. It reads and writes the launcher's wardrobe folder, which the launcher passes in as `-Dnimbus.wardrobe=<folder>`. Without it, it falls back to `nimbus-skins/` in the game folder.

Like the loading screen, it is painted with rectangles and text only. Skins are decoded by a small PNG reader (`Png`) and drawn pixel by pixel (`SkinArt`), so the menu never touches Minecraft's texture code, which changes between versions. Vanilla buttons and the vanilla text box are still there for clicks, typing, keyboard focus and narration, but they are not painted.

## Nimbus Features

`FeaturesScreenBase` lists every option (`Features`) in four tabs: HUD, Performance, Utilities and Animations. The HUD boxes (`NimbusHud`) are drawn after the vanilla HUD (`HudMixin`) and placed with `HudEditorBase`, which stores each box's position as a fraction of the screen, so layouts survive a window resize. Zoom, fullbright and the background FPS limit (`Tweaks`) bend vanilla options past their normal range through an accessor (`OptionAccess`) and put the real values back when they're switched off. Everything is saved to the file given as `-Dnimbus.features=<file>` (the launcher shares one between all instances), or `config/nimbus-features.json` without it.

Right Shift opens the menu and C zooms. On 26.3, which reads keys through SDL, the key codes are translated at runtime.

## Crazy animations

`CrazyFx` is off until *Animations → Crazy animations* is switched on (`fx.crazy`), and every effect has its own switch (`fx.transitions`, `fx.cursor`, `fx.buttons`, `fx.sparkles`, `fx.action`, `fx.speed`, `fx.heartbeat`) plus an amount (`fx.level`). It keeps two particle layers, each with its own clock, both drawn with the `Canvas` rectangles like the rest of the art:

- **Menus** (`ScreenFxMixin`, around `Screen.renderWithTooltip`, `extractRenderStateWithTooltipAndSubtitles` on 26.x): a new screen gets a block dissolve, shutters or a zoom slam (the zoom scales the whole screen through the pose stack for 0.4 s), then the cursor trail, click bursts, the glow around the hovered widget (found by position, looking inside lists) and the floating sparkles are drawn on top.
- **In game** (from `NimbusHud.render`): it compares health, XP level and progress, the hotbar slot (`Compat.selectedSlot`: a field up to 1.21.4, a method from 1.21.5), what's in your inventory and how you're moving with the last frame, and plays the matching effect. Hits come from `GameModeMixin` on `MultiPlayerGameMode.attack`, so short clicks at a low frame rate are never missed. Chat opening and closing is ignored, and pickups wait a moment after a container closes so items falling back out of a crafting grid don't count.

## Nimbus coins

`Progress` counts what you do for the launcher's daily tasks and achievements, all from the client so it works on any server: `TickMixin` runs it every client tick (time played, time with other players and in the Nether or the End, distance walked, sprinted, swum, flown and ridden with a per-tick cap so teleports don't count, food going up just after you used an item, experience, levels, nights slept, fish turning up in your bag while a line is out, and mobs you hit that die within four seconds, each counted once). `GameModeMixin` adds blocks you break (`destroyBlock`: all, ores, diamond ores, logs) and blocks you place (`useItemOn`: a block appearing where there was room for one, so opening doors doesn't count). Creative and spectator don't count for mining, placing or fighting. Today's totals (by UTC day) go to `-Dnimbus.progress` every 15 seconds and when the game closes; today's tasks come back from the launcher in `-Dnimbus.tasks`, for the *Daily tasks* HUD box and the card that drops in when one is done.

## Cosmetics

`CosmeticModel` reads `assets/nimbus/cosmetics.json` (built by `tools/cosmetics`): parts made of boxes, with animations (spin, sway, flap, bob, orbit, pulse, hop, trick, twitch) evaluated with the same maths as the launcher's previews. `Cosmetics` works out, for each player drawn, where each slot sits (hats ride the head, wings the body, auras the feet, pets follow a point beside the shoulder with a little lag), fills a `CosmeticMesh` with camera-relative quads in three batches (solid, see-through, glowing particles) and runs the particles. Yours come from the file the launcher writes (`-Dnimbus.cosmetics`); other players' from the friends service (`-Dnimbus.api`, `cosmetics/get`), asked in batches in the background and kept for three minutes, looked up by name when the server is in offline mode. `cosmetics.others` switches other players' off.

Drawing is the version-specific part (`CosmeticsDraw`, `LevelRendererMixin`):

- **1.20–1.21.8:** after `LevelRenderer.renderEntity` for each player, straight into the frame's buffers. The vertex call is found at run time (float colours up to 1.20.6, an int after), and so are the render types.
- **1.21.9–1.21.11:** entities are submitted instead of drawn; after `submitEntities` (hooked by its intermediary name) every player's cosmetics are submitted as custom geometry through a proxy of the callback interface, which this jar, built against 1.21.1, can only name at run time. 1.21.11 moved the render type factories to `RenderTypes`.
- **26.x:** the same, called directly.

The white texture everything is tinted from is registered at run time: assets inside the mod jar only load with Fabric API, which Nimbus doesn't need.

## Ping

Vanilla only updates your latency in the tab list every 30 seconds, and many servers never send it, so a Ping box that read it sat at 0. `Ping` sends the same ping F3's network chart uses (`ServerboundPingRequestPacket`, 1.20.2 and later) every two seconds while the box is on, and `PingMixin` times the answer (`handlePongResponse`). The packet's time field changed name in 1.20.5, so it's found by type. On 1.20 and 1.20.1, which have no in-game ping, the box falls back to the tab list.

## Nimbus badges

`Badge` puts a violet ☁ before the names of players on Nimbus: above their heads (`BadgeMixin` on `Player.getDisplayName`, only for players drawn on this client) and in the Tab list (`TabBadgeMixin` on `PlayerTabOverlay.getNameForDisplay`). Who is on Nimbus comes from the answers the cosmetics lookup already gets (`Cosmetics.isNimbus`), so it costs no extra requests. `GameProfile.getId()` became `id()` when profiles turned into records in 1.21.9, so the uuid is read through `Badge.profileId`. *Nimbus badges* in *Utilities* turns it off (`badge.nametag`).

## Replay clips

The launcher records the game window itself (a hidden window with WebCodecs), so the mod only has to ask. `Clips.tick` watches F8 every frame (from the HUD, only with no screen open) and posts `/clip` to the launcher's bridge; the answer shows in the corner as "Clip saved (30 s), find it in the launcher's Gallery", or why it couldn't. *F8 saves a replay clip* in *Utilities* turns the key off (`clips.key`).

## Nimbus LAN

`NimbusLan` adds **Nimbus LAN** to the pause menu in singleplayer. It opens the world on a local port (`Compat.publishLan`: `publishServer(GameType, cheats, port)`, and on 26.3 `publishServer(MultiplayerScope.LAN, guestCommands, port)`) and tells the launcher over a local HTTP bridge (`-Dnimbus.bridge=http://127.0.0.1:<port>/<token>`). A background thread asks the bridge for events every second. A join request shows **"NICK wants to join your world"** at the top of the screen, drawn above the pause menu's blur. **Y** or **N** answers it (SDL scancodes on 26.3). Hosting stops once the world it opened closes (`NimbusLan.watch`, run from menus too, since the HUD isn't drawn while you leave a world). `GameStatus` also sends the launcher where you are (menus, singleplayer, server address) over the same bridge, for the Discord status. The launcher does the rest: WebRTC between the two launchers, and a local port on the friend's side that their game connects to.

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
