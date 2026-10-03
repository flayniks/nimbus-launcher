<p align="center"><img src="docs/logo.png" width="160" alt="Nimbus logo"></p>

# Nimbus Launcher

A fast, good-looking launcher for **Minecraft: Java Edition** with licensed (Microsoft) accounts.

- **Every version.** Everything in Mojang's manifest: releases, snapshots, April Fools versions, beta, alpha and 2009 pre-classic (`rd-132211`).
- **Every loader.** Vanilla, Fabric, Quilt, Forge (1.6.1+) and NeoForge, each with its own loader version picker.
- **Browse Modrinth.** Search mods, modpacks, resource packs and shaders. The results are filtered to fit the instance you install into, and required dependencies come along automatically.
- **Modpacks.** Install `.mrpack` packs from Browse, or import a file you already have.
- **Your own files.** An *Add file* button on every Browse tab and instance tab (mods, packs, shaders), or just drop files on the window. Resource packs and shader packs you add, however you add them (even straight into the folder), are switched on for you the next time you play.
- **Nimbus Features in game.** Press *Nimbus Features* in the pause menu or title screen (or Right Shift) for 18 HUD boxes you can drag and resize (FPS, coordinates, keystrokes, CPS, ping and more), up to 20 texts of your own on the screen (any colour, even rainbow), zoom, fullbright, one-click FPS presets and 20+ other options.
- **Make it yours.** Six themes, accent colours (or your own two), animated backgrounds (aurora, starfield, neon grid) or any picture, glass, card styles, corners, UI size and sidebar labels. Every animation, in the launcher, the launch splash and the game, has its own switch.
- **Friends & chat.** Add friends by their Minecraft name, see who's online and what they're playing, chat in the launcher and send them your screenshots. Messages wait for friends who are offline.
- **Nimbus LAN.** Open your singleplayer world with the *Nimbus LAN* button in the pause menu. Friends see "Hosting" and press *Join*. You get "NICK wants to join your world" in game, press **Y**, and they're in: their launcher starts the right Minecraft and connects straight to your world. No port forwarding, no server.
- **Player counter.** The top of the window shows how many people have Nimbus open, how many are playing, and how many have installed it. It is anonymous and can be turned off.
- **FPS Boost.** One click tunes an instance for more, steadier frames (details below).
- **Right Java, automatically.** Nimbus downloads Mojang's own Java runtime for each version (8, 16, 17, 21 or 25), so you never install Java yourself.
- **Nimbus loading screen.** Hit Play and an animated Nimbus splash follows the launch. In Fabric and Quilt instances the game itself then loads on the Nimbus screen instead of Mojang's red one, through the built-in **Nimbus Core** mod.
- **Skins & capes.** Search thousands of skins or copy any player's skin by name, try them on a 3D player, keep a wardrobe and switch capes, right in the launcher. In Fabric and Quilt games you can do all of it from the title screen or the pause menu too.
- **Updates itself.** Every time it opens, Nimbus checks for a new version, downloads it and restarts into it (it waits while you play or download, and *Later* keeps it for the next close). Settings has a *Check now* button too.
- **Servers.** Search servers by name, game mode or address; your favourites, the ones in your games' server lists and popular ones, all pinged live with their message, players and ping. *Play* starts the right instance and joins.
- **Gallery and replay clips.** Every instance's screenshots in one place, to copy, use as your background or delete. Turn on *Replay clips* and **F8** in game saves the last 15–60 seconds as a video.
- **Crash doctor.** When a game crashes (or a mod loader refuses to start), Nimbus says why in plain words and offers the fix: install the missing mod, turn off the broken one, give Java more memory…
- **One-click mod updates.** Home shows which instances have updates; *Update all* does them in one go.
- **Import instances** from CurseForge, Prism Launcher, MultiMC, ATLauncher and the Modrinth App, with their mods, worlds and settings.
- **Nimbus badges.** Other Nimbus players get a little ☁ by their name, above their head and in the Tab list, on offline-mode servers too.
- **Cloud Hop.** A small game on the launch splash to play while Minecraft starts.
- Live game console, play time, one-click Repair, instance duplication and an auto-join server option.

![Home](docs/home.png)

| Your look | Settings |
|---|---|
| ![Two custom looks](docs/looks.png) | ![Appearance settings](docs/settings-appearance.png) |

| New instance | FPS Boost |
|---|---|
| ![New instance](docs/new-instance.png) | ![FPS Boost](docs/boost.png) |

## Running it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/flayniks/nimbus-launcher.git
cd nimbus-launcher
npm install
npm start          # run the launcher
npm test           # offline unit tests
```

### Building an installer

```bash
npm run dist:win     # NSIS installer + latest.yml update feed -> dist/
npm run dist:mac     # .dmg
npm run dist:linux   # AppImage
```

Build each platform on that platform. Cross-building Windows and macOS installers only partly works.

## Downloading

**[Download Nimbus-Launcher-Setup.exe](https://github.com/flayniks/nimbus-launcher/releases/latest/download/Nimbus-Launcher-Setup.exe)**. The link always gives the newest version. It's a normal installer with desktop and Start menu shortcuts. It isn't code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.

Once installed, it keeps itself up to date.

## Publishing an update

1. On GitHub, open **Actions → Release → Run workflow**.
2. Pick **patch** (1.1.0 → 1.1.1), **minor** (→ 1.2.0) or **major** (→ 2.0.0) and press **Run workflow**.

That's it. The workflow bumps the version, commits it, builds the installer on Windows, publishes a `nimbus-v…` release, and refreshes the `nimbus-latest` release that installed launchers check. Every launcher finds the update the next time it opens (or within four hours if it stays open), downloads it, and restarts into it after a five-second countdown. It holds off while a game or a download is running. **Later** skips the countdown, and then the update installs the next time the launcher closes. After the restart the launcher says which version it's on.

Pushing to `main` also rebuilds the installer, but a launcher only updates when the version number goes up. So when you want people to get a change, use the button (or bump `version` in `package.json` yourself).

Don't delete the `nimbus-latest` release: it's the update feed.

## Skins & capes

The **Skins & capes** page shows your player in 3D (idle, walk, run or fly with an elytra) and changes your look for every version and server.

| Try it on | Find skins |
|---|---|
| ![Skins](docs/skins.png) | ![Skin search](docs/skin-search.png) |

- **Wardrobe.** Skins you add are kept on this computer, so you can switch back and forth. The skin you had the first time you opened the page is saved in it, so changing is never a one-way trip.
- **Find skins.** One search box for both: type a player's name to get the skin they wear right now, or a word like *knight* or *hoodie* to search the [MineSkin](https://mineskin.org) gallery. Click a result to try it on, then wear it or save it.
- **Add your own** by uploading a PNG or dropping one anywhere on the page.
- **Try before you wear.** Click a skin to preview it and pick classic or slim arms, then press *Wear this skin*.
- **Capes.** Every cape your account owns, plus *No cape*. The preview shows it on your back.

The same wardrobe is in the game. Nimbus Core adds a **Skins & Capes** button to the title screen (top right) and the pause menu (top left). There you can pick a skin, switch arms, cycle through your capes, turn the preview around and press *Wear it*. Its search box works like the launcher's: type a player's name or a word, click a result, and wear it (it's saved to your wardrobe too) or just *Save* it. You can drop PNG files onto the game window to add them. On 1.20–1.21 *Add skin* opens a file picker; on 26.x it opens the wardrobe folder, and PNGs copied there show up by themselves.

| In the menu | Searching by player name | In a world |
|---|---|---|
| ![In-game skins](docs/ingame-skins.png) | ![In-game search](docs/ingame-search.png) | ![In-game skins in a world](docs/ingame-skins-world.png) |

Skins go through Mojang's own skin service with the account you're signed in with, so nothing is server-side or mod-only: everyone sees your new look the next time you join a server. Mojang allows a few changes a minute.

## Nimbus Core and the loading screen

Nimbus Core ([`mod/`](mod/README.md)) is a small Fabric mod that ships inside the launcher. It replaces Minecraft's red Mojang loading screen with an animated Nimbus one (pixel-art cube, drop-in lettering, particles, progress bar), adds a Nimbus badge to the title screen, and adds the in-game Skins & Capes and Nimbus Features menus.

| In-game loading screen | Title screen badge | Launch splash |
|---|---|---|
| ![Loading screen](docs/loading-screen.png) | ![Title badge](docs/title-badge.png) | ![Splash](docs/splash.png) |

- It is put into every **Fabric** and **Quilt** instance on **1.20–1.21.11** and **26.x** before each launch.
- It shows as **Built in** in the instance's mod list, with no off switch or delete button. If someone disables or deletes the file by hand, it comes back on the next launch.
- Forge, NeoForge, vanilla and older versions don't get it. Those still get the launcher's own animated splash while the game starts.

The splash is a separate window that shows from Play until the game opens its window. It follows the downloads, Java and mod loading as they happen. Click it to hide it, or change or turn it off in *Settings → Animations*.

## Nimbus Features (in game)

In Fabric and Quilt games, **Nimbus Features** sits on the left of the pause menu and in the top-left corner of the title screen (under the Nimbus badge, clear of the Minecraft logo; on a narrow screen it becomes a small icon button), and Right Shift opens it anywhere in game.

| The menu | Editing the HUD | In a world |
|---|---|---|
| ![Nimbus Features](docs/ingame-features.png) | ![HUD editor](docs/ingame-hud-editor.png) | ![HUD](docs/ingame-hud.png) |

- **HUD:** FPS, coordinates, direction, biome, clock, ping, CPS, keystrokes, speed, memory, held item, armour, server, light level, day counter, session time, chunk and the Nimbus logo. Switch them on, press *Edit HUD layout*, then drag them anywhere. Click one to resize or hide it. Boxes snap to the edges and the centre. Box style, accent colour, text shadow and a 12/24-hour clock are in the same tab.
- **Your texts:** put your own words on the screen, up to 20. *Your texts* at the top of the HUD tab opens a list: type a text and press Enter (or *Add*), pick its colour (white, your accent colour, red, orange, yellow, green, aqua, blue, purple, pink, gray, or an animated **rainbow**) and whether it sits in a box like the other HUD boxes or plain. Minecraft's colour codes colour parts of a text: `&cRed &aGreen &9Blue`. Each text has an on/off switch, *Edit* and ×. They're HUD boxes, so *Edit HUD layout* moves and sizes them like the rest.
- **Performance:** Max FPS / Balanced / Quality presets, a background FPS limit (the game barely runs while it's in the background), render and simulation distance, max frame rate, VSync, graphics, particles, clouds, entity shadows, smooth lighting, biome blend and entity distance.
- **Utilities:** zoom (hold C, five strengths, smooth or instant), fullbright, toggle sprint and sneak, no hurt shake, no view bobbing, the inventory watermark and the Right Shift shortcut.
- **Animations:** **Crazy animations**, off until you switch it on. Then menus burst open (blocks breaking away, shutters sliding apart or a zoom slam), the mouse leaves a rainbow trail and sets off a burst on every click, light races around the button under it, and sparkles and shooting stars drift through every menu. In a world you get hit markers and a rainbow **COMBO** counter, a **LEVEL UP!** explosion with confetti, damage and heal numbers, "+3 Oak Log" pickups beside the hotbar, a pop on the hotbar slot, a shockwave when you land a big fall, speed lines when you sprint or fly fast, a red heartbeat around the screen when you're nearly dead, and **GAME ON!** when you join a world. *How crazy* sets the amount (Wild, Insane or Maximum chaos), and each effect has its own switch.

The settings are shared by every instance, so your HUD looks the same everywhere.

## Make it yours

Settings has an **Appearance** section and an **Animations** section.

![Animations settings](docs/settings-animations.png)

- **Appearance:** theme (Midnight, Void, Nebula, Ocean, Forest, Ember), accent colour (six presets or two colours of your own), background (Aurora, Starfield, Neon grid, Plain or your own picture with blur and darken), glass and how frosted it is, card style, corners, UI size (90–125%) and sidebar labels.
- **Your own background:** *Settings → Appearance → Background → Your picture*, or drop a picture anywhere on that page. PNG, JPG, WebP or GIF of any size: big ones are scaled down, not refused.
- **Game menus:** what's behind Minecraft's title screen and menus in Fabric and Quilt instances: the normal **Minecraft** panorama, the **Nimbus** glow, or **your picture** (the launcher's, or another one). It can also be changed in game: *Nimbus Features → Utilities → Menu background*, with a *Choose…* button for a PNG.
- **Animations in the launcher:** on/off, speed, how pages change (rise, fade, slide, zoom or none), lists sliding in, what cards do on hover (lift, tilt, glow or nothing) and the moving background.
- **Launch splash:** on/off, particles, and how the logo moves: **Spin**, **Bounce** (hops with squash and stretch), **Splash** (drops in and lands in rippling water), **Pulse** (beats and sends out waves), **Flip**, **Still** or **Minimal** (just the name). Every choice has a live preview card.
- **In the game** (through Nimbus Core): the Nimbus loading screen (off shows Mojang's), particles, animation speed, the title screen badge, the moving glow behind the Nimbus menus, and the same logo styles picked separately for **when the game starts** and **when resource packs load** (F3+T, or changing packs in game).

## Friends, chat and Nimbus LAN

The *Friends* page (people icon in the sidebar) signs in with the Microsoft account you play with. Nimbus proves the account is yours the same way joining a server does, through Mojang's session server, so no password or token goes to Nimbus. The friends service is a small Netlify Function that lives next to the website ([`website/`](website/README.md)).

- **Add** someone by their Minecraft name. They get a request and a badge; once they accept, you see each other's status: online, playing a version, or hosting a world.
- **Chat** in the launcher. A message you're not looking at pops up with a *Reply* button. History is kept for each friend.
- **Send screenshots.** The picture button in a chat picks one of your screenshots, and *Send to a friend* in the Gallery sends the one you're looking at, with a message if you like. Your friend sees it in the chat, can open it big, copy it or save it. The launcher makes it a JPEG of at most 1600 px before it goes; only the two of you can fetch it, it goes when the chat history gets trimmed, and each person can send 60 a day.
- **Nimbus LAN**, in Fabric and Quilt games:
  1. In your world, open the pause menu and press **Nimbus LAN**. Your friends' launchers now show *Hosting "World"* and a **Join** button.
  2. When a friend presses Join, you get **"NICK wants to join your world"** at the top of the screen, with 90 seconds to press **Y** (let them in) or **N** (no).
  3. On a yes, the two launchers connect directly (WebRTC). Your friend's launcher starts a Minecraft on the same version (it makes one if they don't have it) and joins your world. Only the handshake goes through the friends service; the game traffic flows straight between the two computers.

A few networks (some mobile and school or office networks) block direct connections between computers. Nimbus then says it couldn't reach your friend's computer.

## Cosmetics

**Cosmetics** in the sidebar has 145 3D hats, pets, wings and auras: 57 hats (crowns, halos, wizard hats, floating suns, a black hole, a snow globe, a UFO beaming you up…), 54 pets (dragons that breathe fire or frost, a sky whale, a shark that swims round you, a mini wither, animals on little clouds…), 17 pairs of wings and 17 auras. Every one is animated, many throw particles, and the glowing parts stay bright in the dark. Pick one per slot on a 3D preview of your own skin; hovering a card tries it on, locked ones too.

They show in Fabric and Quilt games, on you (in third person) and on every other Nimbus player near you, whatever server you're on. What you wear is shared through the friends service, which only takes it from the Microsoft account that owns it; games ask it about the players around them. With an offline account, only you see yours. The Cosmetics page says when yours aren't shared and why (signed out, or the online service can't be reached), keeps retrying by itself and has a *Retry* button. *Settings → General → Cosmetics* (or *Nimbus Features → Utilities* in game) hides other players' cosmetics.

The models are built by `tools/cosmetics` (`node tools/cosmetics/build.mjs`) into one file that both the game and the launcher's previews read, plus the price list the service uses.

### Nimbus coins

Commons are free. Everything else is unlocked with **Nimbus coins** (rare 150, epic 300, legendary 600, mythic 1,000), which you earn by playing with Nimbus:

- **Daily tasks:** three a day (an easy one for 30 coins, a medium one for 50 and a hard one for 80, plus 50 more for finishing all three), picked for you from things like *Mine 250 blocks*, *Beat 20 hostile mobs*, *Sprint 1,000 blocks*, *Catch 3 fish*, *Mine 3 diamond ores* or *Play 20 minutes with other players*. New ones every day at midnight UTC.
- **Achievements:** 24 one-off goals over everything you've done (*Diamonds!*, *Slayer*, *Globetrotter*, *The End?*, *Collector*…), from 50 to 1,000 coins.
- **Playing:** a coin every 3 minutes, up to 50 a day.
- **Log-in streak:** 10 coins a day, 5 more for every day in a row, up to 50.
- New players start with 250.

Nimbus Core counts what you do in any Fabric or Quilt game: blocks mined, ores, logs and diamonds, blocks placed, mobs beaten, critical hits, distance walked, sprinted, swum, flown and ridden, food eaten, experience and levels, fish caught, nights slept, time played, time with other players and time in the Nether and the End. Creative mode doesn't count for mining, placing or fighting. It writes the day's totals to a file; while the game runs the launcher sends them to the service every minute, and the service pays out, so balances can't be edited on your computer (and each day's totals are capped at what a person could really do). In game, a *Daily tasks* box on the HUD (on by default, in *Nimbus Features → HUD*) shows how far along you are, and a card drops in at the top of the screen when you finish one. The coins arrive in the launcher with a toast. The *Earn coins* tab on the Cosmetics page lists today's tasks, what else pays and every achievement.

## Servers

**Servers** in the sidebar pings every server as you look: its message of the day (with colours), players online (and some names), version and ping. Your favourites come first (*Add server*), then the servers already in your instances' in-game lists, then a few popular ones. *Play* picks an instance that fits the server's version (or the one you choose), starts it and joins straight away. Pings use Minecraft's own Server List Ping, with SRV records, from your computer.

**Search** at the top finds servers by name, game mode (*skyblock*, *lifesteal*, *bed wars*…) or address, or with the game-mode buttons under it. It looks through your own servers, a built-in list of nearly 60 well-known public servers (`src/core/serverdir.json`, each one checked online when it was added), and every player-run server online on Minehut right now (from Minehut's public list). Busy servers come first. Type an address (`play.example.com`) and that server shows up to ping, play or add.

## Gallery and replay clips

**Gallery** shows the screenshots from every instance, newest first. Click one to see it big, then send it to a friend, copy it (to paste into Discord, say), use it as the launcher background, show it in its folder or send it to the recycle bin.

**Replay clips** (*Settings → General → Replay clips*, off by default) keep recording the last 15, 30 or 60 seconds of your game while you play. Press **F8** in game and they're saved as an MP4 in *Gallery → Clips*; Nimbus Core says "Clip saved" in the corner. Nothing is written to disk until you press F8. Clips are 720p at 30 fps or 1080p at 60 fps, encoded on the graphics card where it can (H.264, or VP9 as a fallback), and on Windows they can record the game's sound. Clips are kept in *Videos/Nimbus Clips*.

## Crash doctor

When a game crashes, Nimbus reads the crash report, the log and any Java crash file, and explains what went wrong with buttons that fix it:

- a missing mod or library (*Install Fabric API*), or a mod that needs a newer version of another one: install or update it from Modrinth
- two mods that don't work together: which one said so, about which versions, and the fix that keeps both when there is one. *Simple Voice Chat 2.6.24 doesn't work with Flashback 0.39.9 or older* becomes "Your Flashback is too old for Simple Voice Chat" with *Update Flashback* first; when Fabric works out a fix itself, the doctor follows it. Mods bundled inside other mods (like Voice Chat's API) are traced back to the jar they came in. *Update* only ever moves a mod forward, never back to an older release
- a mod for another Minecraft version or a mod that fails to load (named in the report, found in its stack trace, or suspected by Fabric/Forge): update it or turn it off
- out of memory: give Java more
- the wrong Java: switch back to the automatic one
- graphics driver crashes: turn shaders off, or update the driver
- a broken config file: reset it (the old one is kept, renamed to `.broken-…`)
- damaged game files: Repair

Fabric and Forge sometimes show their own error window instead of closing; the doctor spots those in the log and opens straight away. The *Crash doctor* button on every instance looks at the last crash again.

## Mod updates and importing

Nimbus checks installed Modrinth mods, packs and shaders for updates in the background (by their file hashes, so it works for files you added yourself too). Home puts an *N updates* tag on instances that have them, and the instance page lists them with *Update* and *Update all*. The old files are replaced.

*Import* on Home finds the instances of CurseForge, Prism Launcher, MultiMC, ATLauncher and the Modrinth App on your computer (or in a folder you pick), shows their version, loader, mods and worlds, and copies the ones you tick into Nimbus with the same Minecraft version and loader. The originals are left alone.

## Nimbus badges

In Fabric and Quilt games, Nimbus Core puts a little violet ☁ before the name of every player who uses Nimbus, above their head and in the Tab list, on any server. It knows who they are from the same service that shares cosmetics. *Nimbus Features → Utilities → Nimbus badges* turns them off.

The service knows every player who signed in to Nimbus, whether they wear cosmetics or not, by their account, by name, and by the uuid an offline-mode server makes from their name, so the badge also shows on cracked servers and under a nickname there. What it can't see through: a server that gives a player a made-up uuid and name (some nick plugins), or one that hides real nametags and draws its own with separate entities.

## Cloud Hop

Hit Play and the launch splash has a *Play Cloud Hop while you wait* button: hop the Nimbus cube between block pillars with Space or a click, and grab coins for bonus points. Your best score is kept. When Minecraft is ready, your current run finishes (or 15 seconds pass) and the splash gets out of the way.

## Admin

Nimbus admins get an **Admin** page in the sidebar (the lock). Admins are set by Minecraft uuid in `website/netlify/functions/api.mjs` (Its_Flayniks, `7bc9c85e…`), plus any listed in the `NIMBUS_ADMINS` environment variable on Netlify, comma separated. A uuid, not a name, because names can be changed and then taken by someone else. The service checks it on every admin call; the page is only the way in.

- **Everyone:** every player who has signed in to Nimbus, with who's online, playing or hosting right now, when they were last seen, when they started, their coins and how many launcher installs they used. Totals at the top (users, online, playing, new today, banned), a search by name or uuid, and *Everyone / Online / Banned* filters. It refreshes every 30 seconds.
- **Ban** someone from their row, or *Ban by name* (they don't need to have used Nimbus yet), with a reason they see and a length (1 day, 7 days, 30 days or forever). **Unban** from the same row.

A banned player's launcher shows a ban screen with the reason and when it ends, and won't start games (one that's already open isn't closed, which could damage a world). The service refuses them friends, chat, cosmetics and coins, and their Nimbus badge goes. The ban covers the account and every install of the launcher it was used on, so another account on the same computer is banned too. For that, each launcher makes a random install id the first time it runs (in `friends.json`, nothing taken from the computer) and sends it when it signs in. The ban is remembered, so going offline doesn't lift it. It's checked at start, every 5 minutes, and with every friends update, so a ban or unban arrives within about 15 seconds while the launcher is open. Admins can't be banned.

The launcher runs on the player's computer, so someone determined could change it to skip the ban screen; the service's side of the ban (friends, chat, cosmetics, coins) doesn't depend on the launcher.

## Discord status

With the Discord app open, your Discord profile shows what you're doing: *In the launcher*, *In the menus*, *Playing singleplayer*, *Hosting a world on Nimbus LAN*, *Playing on mc.hypixel.net* or *In Alex's world on Nimbus LAN*, with the Minecraft version, the loader and how long you've played. Server names are shown, but never IP addresses or your own computer. Both are switches in *Settings → General → Discord*. The launcher talks to the Discord app on your computer directly (its local socket), and Nimbus Core tells the launcher where you are in the game.

The Discord app id comes from `services.json` (`"discord"`), so it can be set or changed without a new release. Until it's set, the status stays off.

## Player counter

The pill at the top of the window shows people online (with Nimbus open), people playing, and everyone who has installed Nimbus. Each launcher adds one to a counter for the current five-minute window, and one to "playing" while a game runs. The all-time counter goes up once per install. No account, name or ID is sent, only anonymous counter bumps ([Abacus](https://abacus.jasoncameron.dev)). *Settings → General* can hide the counter or stop counting you.

## Resource packs and shaders

Minecraft never switches on a new pack by itself, so Nimbus does it for you. Before each launch it looks for resource packs and shader packs it hasn't seen in that instance before, and turns them on: resource packs go on top of the list in `options.txt` (also marked as accepted, so a pack made for another version still loads), and a new shader pack is selected for Iris, Oculus or OptiFine. Packs that were already there are left alone, so one you turn off in game stays off.

## FPS Boost

Pick a preset (**Potato**, **Balanced** or **Max FPS**) and switch individual parts on or off:

| Part | What it does |
|---|---|
| Performance mods | Installs whichever of these have a build for the instance: Sodium (or Embeddium on older Forge), Lithium, FerriteCore, EntityCulling, ImmediatelyFast, ModernFix, Dynamic FPS, More Culling and BadOptimizations. It skips anything already installed, and skips Sodium when OptiFine is present. |
| Garbage collector | Tuned G1 flags. The **Max FPS** preset uses generational ZGC on Java 21+ machines with 12 GB+ RAM and a 4 GB+ heap. A GC you set in the instance's JVM arguments always wins. |
| Smart memory | Sizes the heap to the mod count (2–8 GB) and never gives Java more than half your RAM. Too much heap makes GC pauses longer. |
| Video settings | Writes render/simulation distance, graphics mode, clouds, particles, shadows, mipmaps and biome blend into `options.txt`, with VSync off and FPS uncapped. The original file is backed up once, and **Revert** restores it. Keys are written in the format each game era expects. |
| Process priority | Raises Minecraft's priority when it starts. On Linux/macOS this needs admin rights, and is skipped quietly without them. |
| Dedicated GPU | Windows only. Tells Windows to run Java on the discrete GPU on laptops that have two. |

Performance mods need a mod loader. For a vanilla instance, the boost still tunes Java, memory and video settings, and suggests a Fabric instance or the Fabulously Optimized modpack.

The launcher stays out of the game's way too. By default it hides itself while you play. Its background animation pauses when a game is running, animations can be turned off completely, and progress updates are throttled so the UI never floods.

## How it works

```
main.js / preload.js         Electron shell, IPC, Microsoft sign-in window
src/core/                    everything that is not UI (plain Node, testable without Electron)
  launcher.js                facade the UI talks to: tasks, prepare, launch
  builtin.js                 keeps Nimbus Core in Fabric/Quilt instances
  versions.js                Mojang manifest, version JSON inheritance
  install.js                 libraries, natives, assets (incl. pre-1.6 and legacy virtual assets), log4j config
  java.js                    Mojang Java runtimes, system Java discovery
  loaders/fabric.js          Fabric and Quilt profiles
  loaders/forge.js           Forge/NeoForge installers: install_profile, library download, processors
  launch.js                  argument building and spawning
  auth.js / accounts.js      Microsoft → Xbox Live → Minecraft sign-in, encrypted token storage
  modrinth.js                search, dependency resolution, .mrpack, update checks
  boost.js                   the FPS Boost
  servers.js                 Server List Ping, servers.dat, favourites
  serverdir.js               server search: the built-in list, Minehut, typed addresses
  gallery.js                 screenshots and replay clips (served over nimbus-media://)
  crashdoctor.js             reads crash reports and logs, suggests fixes
  importer.js                instances from CurseForge, Prism, MultiMC, ATLauncher, Modrinth App
src/renderer/                the UI: vanilla JS modules, no framework (splash.html is the launch splash)
mod/                         Nimbus Core, the built-in Fabric mod (Gradle, see mod/README.md)
resources/mods/              the built Nimbus Core jars the launcher ships
```

- **Storage.** Everything lives in one folder (Settings → Storage). Libraries, assets and Java runtimes are shared between instances. Each instance has its own `minecraft` folder for worlds, mods and `options.txt`.
- **Downloads** run in parallel (16 at a time by default), are verified against their SHA-1 after download, and are skipped when a file with the right size already exists. That makes a second launch of an instance take under a second to prepare. **Repair** re-hashes everything.
- **Forge and NeoForge** are installed straight from their official installer jars. Nimbus reads `install_profile.json`, fetches the libraries and runs the installer's processors with the game's own Java. The installer UI never appears. Forge 1.6–1.12 installers have no processors, so their files are simply unpacked.
- **Sign-in** opens Microsoft's own login page in a separate window. Nimbus never sees your password. It keeps only the refresh token and the Minecraft token, sealed with your OS keychain through Electron's `safeStorage`. By default it uses the public Minecraft client ID that most open-source launchers use. If you have your own Azure app approved for the Minecraft API, set its client ID in Settings.
- **Security.** The UI runs sandboxed with context isolation and a strict CSP, and has no network access of its own. Modrinth descriptions are sanitized with DOMPurify, and only `https` links open, always in your browser.

## Tested

With `test/smoke.js`, which installs an instance for real and starts the game under a virtual display:

- vanilla: `rd-132211`, `b1.7.3`, 1.8.9, 1.21.1, 26.3
- Fabric: 1.21.1, 26.3
- Quilt: 1.20.1
- Forge: 1.6.4, 1.7.10, 1.12.2, 1.20.1 (processors)
- NeoForge: 1.21.1, 26.3
- modpack: Fabulously Optimized (`node test/smoke.js modpack fabulously-optimized`)

Every one of them started, loaded its mod loader and got as far as creating the game window. The 1.8.9, 1.12.2 and 26.x runs failed at that last step, because the headless test machine's virtual display cannot give them the display modes or OpenGL context they ask for. The rest rendered. The UI flows were exercised in the real Electron app: create an instance, browse, add a mod with its dependencies, apply the FPS Boost, launch with the live console, then stop.

Nimbus Core was checked in real games on the virtual display on Fabric 1.20.1, 1.21.1, 1.21.11 and 26.3, and on Quilt 1.21.1. Each one loaded on the Nimbus screen, faded straight to the title screen with the badge, and never showed Mojang's red screen or got stuck. The variable it hides the Mojang logo with was checked in the bytecode of every release from 1.20 to 26.3.

The skins page was tested against stand-ins for Mojang's skin service, its name lookup and the MineSkin gallery (`test/mock-services.js`): search by player name and by keyword, save a result, preview, wear with slim arms, switch capes and hide the cape. The search was also run against the real gallery and Mojang. The in-game menu was tested the same way on Fabric 1.20.1, 1.21.1, 1.21.11 and 26.3: from the title screen and from the pause menu in a world, typing a player's name, wearing their skin, searching a keyword and saving a result. Every game method the menu calls was checked to exist in each release from 1.20 to 26.3.

Nimbus Features was tested in real games on Fabric 1.20.1, 1.21.1, 1.21.11 and 26.3: opening the menu from the pause menu, the title screen and Right Shift, switching HUD boxes on, dragging and resizing them in the editor, zoom and the inventory watermark. The in-game animation options were checked on 1.21.1 (Mojang's loading screen, no badge, flip) and on 26.1.2 and 26.3 (still logo, no particles, bounce and pulse at start, splash on an F3+T resource reload, which now fades straight back into the world). The inventory watermark was checked on 1.21.1 and 26.1.2. Cosmetics were checked in real games on Fabric 1.20.1, 1.21.1, 1.21.5, 1.21.11 and 26.3 (each era of Minecraft's entity drawing), day and night, and with two Nimbus players on one server, each seeing the other's cosmetics fetched from a local copy of the friends service. All of them were then looked at in game from behind and in front, with armour and crouching, which is how the wings that hung down over your arms, the rings that flipped through your body, the flames sunk into the ground and the pets bumping into your head were found and fixed. Nimbus coins were tested with the real launcher and a local copy of the service: on a server in 1.21.1, walking, mining, placing, a zombie, experience and eating were each counted once (teleports and the saturation effect not at all), the daily task card and the HUD box showed up, and the totals reached the service; walking, mining and experience were also counted on 1.20.1 and 26.3. The Ping box and the Discord status were checked with the real launcher against a local vanilla server behind a proxy that holds every packet for 50 ms each way: the box read 104 ms (it used to say 0), and a stand-in Discord app received *In the launcher*, *In the menus*, *Playing singleplayer*, *Hosting a world on Nimbus LAN*, *Playing on play.nimbus.test* and a cleared status when the launcher quit. Leaving a world you opened to Nimbus LAN now stops hosting, and the world comes back normal when you rejoin. Crazy animations were checked in real games on Fabric 1.20.1, 1.21.1, 1.21.11 and 26.3 (menu transitions, cursor trail, glowing buttons, level up, combos, damage, heal, pickups, hotbar pop, landing, speed lines and the heartbeat), and switched off it draws nothing. The launcher's look (themes, backgrounds, your own picture and colours, shapes, size), the animation settings, the player counter (against a stand-in counter) and the *Add file* buttons were run through in the real Electron app.

The 1.8.0 features were run in the real launcher. Servers pinged a local vanilla 1.21.1 server (message, players, version, ping). The gallery showed an instance's screenshots, opened one big and copied it to the clipboard. The crash doctor was given a Fabric instance missing Fabric API: it opened while Fabric's own error window was still up, named the problem, installed Fabric API from Modrinth, and the game then started. Mod updates found an old mod, tagged the instance on Home and updated it. Import read made-up CurseForge, Prism, MultiMC, ATLauncher and Modrinth App instances (`test/unit.js`) and imported a Prism one in the app. Badges were checked with two Nimbus players on one server in 1.21.1, above heads and in the Tab list, and the methods they hook were checked to exist in every release from 1.20 to 26.3. Replay clips were recorded from a real game: F8 saved a 1280×720 MP4 with a poster, the game said "Clip saved", and the clip played in the Gallery. Cloud Hop was played on the real launch splash with the keyboard, and the splash left once Minecraft's window was up.

In 1.8.1, two real launchers (Alex and Steve) on a local copy of the friends service sent each other screenshots: Alex from the Gallery with a message, Steve from the chat's picture button. Each got a toast, saw the picture in the chat, opened it big and copied it. The service's rules (friends only, real pictures only, size, 60 a day, pictures going with trimmed history) are in `test/unit.js`. Server search was run against the live Minehut list and the built-in list, whose addresses were all checked with a status service when they were added. The crash doctor was run against a real Fabric 1.21.1 game with Simple Voice Chat 2.6.24 and Flashback 0.39.9: it said "Your Flashback is too old for Simple Voice Chat", its first button updated Flashback to 0.39.10, and the game then started with both mods.

In 1.8.2, two real launchers ran against a local copy of the service with Alex as the admin. Alex saw the Admin page (Steve didn't), the user list and totals, banned Steve for 7 days with a reason, and within a few seconds Steve's launcher showed the ban screen and refused to start a game; it was still banned after a restart. After Alex unbanned him, *Check again* cleared it. A ban by name worked too. The service's rules (admins only, admins can't be banned, a ban covering the account's installs and another account on them, bans running out, banned players losing their badge) and the badge lookups (players who wear nothing, offline-mode uuids, names, sessions from before) are in `test/unit.js`.

In 1.8.3, *Your texts* was driven in a real Fabric 1.21.1 game: adding texts with Enter and the *Add* button, rainbow and colour codes, a boxed one, editing one, switching styles and typing straight after a click, removing one, dragging and resizing a text in *Edit HUD layout*, and seeing them in a world; the 21st text was refused. Every game method the new screen uses was checked to exist in each release from 1.20 to 26.3.

The updater was tested by having a 1.0.0 build read a local copy of the release feed, find 1.1.0, download it and verify its checksum. The final "install and restart" step only runs on Windows.

The one thing that cannot be tested without a real Microsoft account is the sign-in round trip.

## Limits

- Content search is Modrinth only. CurseForge's API needs a private key.
- Forge older than 1.6 was a jar mod with no launcher profile, so it is not offered.
- Linux on ARM has no Mojang Java runtime. Install a matching Java yourself and pick it in the instance settings.
- On Apple Silicon and Windows on ARM, versions without ARM natives (1.18 and older) run on the x64 Java under Rosetta/emulation.

Nimbus is not affiliated with Mojang or Microsoft. Forge is funded by the ads on its download site. If you use it a lot, consider supporting it.
