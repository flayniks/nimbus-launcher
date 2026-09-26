package dev.flayniks.nimbus;

import java.time.LocalTime;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;

/**
 * The Nimbus HUD: small movable, resizable info boxes (FPS, coordinates, keystrokes…)
 * plus the per-frame work behind zoom, fullbright, the background FPS limit and the
 * Right Shift shortcut. Everything is drawn with rectangles and text, and every game
 * lookup sits behind a catch, so a version that lacks something just shows less.
 */
public final class NimbusHud {
	private NimbusHud() {
	}

	// state shared by the modules and the per-frame work below
	static boolean editing;
	private static final int LEFT = 0;
	private static final int RIGHT = 1;
	private static final ArrayDeque<Long>[] CLICKS = new ArrayDeque[] {new ArrayDeque<Long>(), new ArrayDeque<Long>()};
	private static final boolean[] WAS_DOWN = new boolean[2];
	private static long sessionStart;
	private static double lastX = Double.NaN;
	private static double lastZ;
	private static long lastMove;
	private static double speed;
	private static boolean shortcutWasDown;

	// ------------------------------------------------------------------ modules

	/** One line of a module: parts in different colours. */
	static final class Line {
		final List<String> texts = new ArrayList<>();
		final List<Integer> colors = new ArrayList<>();

		Line add(String text, int color) {
			texts.add(text);
			colors.add(color);
			return this;
		}
	}

	abstract static class Module {
		final String id;
		final String title;
		final String description;
		final boolean defaultOn;

		Module(String id, String title, String description, boolean defaultOn) {
			this.id = id;
			this.title = title;
			this.description = description;
			this.defaultOn = defaultOn;
		}

		boolean enabled() {
			return NimbusConfig.on("hud." + id, defaultOn);
		}

		/** Draws at (0, 0) in module space and returns {width, height}; with draw=false only measures. */
		abstract int[] paint(Canvas c, boolean draw);
	}

	/** A module made of text lines in a box. */
	abstract static class TextModule extends Module {
		TextModule(String id, String title, String description, boolean defaultOn) {
			super(id, title, description, defaultOn);
		}

		abstract List<Line> lines();

		@Override
		int[] paint(Canvas c, boolean draw) {
			List<Line> lines;
			try {
				lines = lines();
			} catch (Throwable t) {
				lines = List.of(new Line().add(title, label()).add(" —", value()));
			}
			int w = 0;
			for (Line l : lines) {
				int lw = 0;
				for (String s : l.texts) lw += c.textWidth(s);
				w = Math.max(w, lw);
			}
			int pad = 4;
			int bw = w + pad * 2 + 2;
			int bh = lines.size() * 10 + pad * 2 - 1;
			if (!draw) return new int[] {bw, bh};
			box(c, 0, 0, bw, bh);
			int y = pad;
			for (Line l : lines) {
				int x = pad + 2;
				for (int i = 0; i < l.texts.size(); i++) {
					c.text(l.texts.get(i), x, y, l.colors.get(i), shadow());
					x += c.textWidth(l.texts.get(i));
				}
				y += 10;
			}
			return new int[] {bw, bh};
		}
	}

	static TextModule text(String id, String title, String description, boolean defaultOn, java.util.function.Supplier<List<Line>> lines) {
		return new TextModule(id, title, description, defaultOn) {
			@Override
			List<Line> lines() {
				return lines.get();
			}
		};
	}

	static List<Line> one(String value, String unit) {
		return List.of(new Line().add(value, value()).add(unit, label()));
	}

	static List<Line> labeled(String label, String value) {
		return List.of(new Line().add(label + " ", label()).add(value, value()));
	}

	static final List<Module> MODULES = new ArrayList<>();

	static {
		MODULES.add(text("fps", "FPS", "Frames per second", true, () -> one(String.valueOf(mc().getFps()), " FPS")));
		MODULES.add(text("coords", "Coordinates", "Where you are: X, Y and Z", true, () -> {
			Player p = mc().player;
			if (p == null) return labeled("XYZ", "128 64 -256");
			return List.of(new Line().add("X ", label()).add(fmt(p.getX()), value()).add("  Y ", label()).add(fmt(p.getY()), value()).add("  Z ", label()).add(fmt(p.getZ()), value()));
		}));
		MODULES.add(text("direction", "Direction", "Which way you are facing", true, () -> {
			Player p = mc().player;
			float yaw = p == null ? 180 : p.getYRot();
			return labeled("Facing", facing(yaw));
		}));
		MODULES.add(text("biome", "Biome", "The biome you are standing in", false, () -> {
			Player p = mc().player;
			if (p == null || mc().level == null) return labeled("Biome", "Plains");
			return labeled("Biome", biome(p.blockPosition()));
		}));
		MODULES.add(text("clock", "Clock", "Real-world time (12 or 24 hour, see Utilities)", false, () -> {
			LocalTime t = LocalTime.now();
			String s = NimbusConfig.value("clock.format", 0) == 1
				? String.format(Locale.ROOT, "%d:%02d %s", (t.getHour() + 11) % 12 + 1, t.getMinute(), t.getHour() < 12 ? "AM" : "PM")
				: String.format(Locale.ROOT, "%02d:%02d", t.getHour(), t.getMinute());
			return one(s, "");
		}));
		MODULES.add(text("ping", "Ping", "Your connection delay to the server", false, () -> one(String.valueOf(ping()), " ms")));
		MODULES.add(text("cps", "CPS", "Clicks per second, left and right", false, () -> List.of(new Line().add(String.valueOf(count(LEFT)), value()).add(" | ", label()).add(String.valueOf(count(RIGHT)), value()).add(" CPS", label()))));
		MODULES.add(new Keystrokes());
		MODULES.add(text("speed", "Speed", "How fast you are moving, in blocks per second", false, () -> one(String.format(Locale.ROOT, "%.2f", speed), " b/s")));
		MODULES.add(text("memory", "Memory", "How much memory Minecraft is using", false, () -> {
			Runtime r = Runtime.getRuntime();
			long used = (r.totalMemory() - r.freeMemory()) >> 20;
			long max = r.maxMemory() >> 20;
			return List.of(new Line().add("RAM ", label()).add(used * 100 / Math.max(1, max) + "%", value()).add(" " + used + "/" + max + " MB", label()));
		}));
		MODULES.add(text("held", "Held item", "The item in your hand and how worn it is", false, () -> {
			Player p = mc().player;
			if (p == null) return labeled("Diamond Pickaxe", "1561/1561");
			ItemStack s = p.getMainHandItem();
			if (s.isEmpty()) return labeled("Hand", "empty");
			String name = s.getHoverName().getString();
			if (s.isDamageableItem()) {
				int left = s.getMaxDamage() - s.getDamageValue();
				return List.of(new Line().add(name + " ", label()).add(left + "/" + s.getMaxDamage(), wear(left, s.getMaxDamage())));
			}
			return labeled(name, "×" + s.getCount());
		}));
		MODULES.add(text("armor", "Armor", "How worn each piece of armor is", false, () -> {
			Player p = mc().player;
			List<Line> out = new ArrayList<>();
			String[] names = {"Helmet", "Chest", "Legs", "Boots"};
			EquipmentSlot[] slots = {EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET};
			for (int i = 0; i < 4; i++) {
				ItemStack s = p == null ? ItemStack.EMPTY : p.getItemBySlot(slots[i]);
				if (s.isEmpty()) {
					if (p == null) out.add(new Line().add(names[i] + " ", label()).add("100%", value()));
					continue;
				}
				if (!s.isDamageableItem()) {
					out.add(new Line().add(names[i] + " ", label()).add("∞", value()));
					continue;
				}
				int left = s.getMaxDamage() - s.getDamageValue();
				out.add(new Line().add(names[i] + " ", label()).add(left * 100 / Math.max(1, s.getMaxDamage()) + "%", wear(left, s.getMaxDamage())));
			}
			if (out.isEmpty()) out.add(new Line().add("No armor", label()));
			return out;
		}));
		MODULES.add(text("server", "Server", "The server you are playing on", false, () -> {
			String s = "Singleplayer";
			try {
				if (mc().getCurrentServer() != null) s = mc().getCurrentServer().ip;
			} catch (Throwable ignored) {
				// keep the default
			}
			return labeled("Server", s);
		}));
		MODULES.add(text("light", "Light level", "The light level where you stand (mobs spawn at 0)", false, () -> {
			Player p = mc().player;
			if (p == null || mc().level == null) return labeled("Light", "15");
			int l = mc().level.getMaxLocalRawBrightness(p.blockPosition());
			return List.of(new Line().add("Light ", label()).add(String.valueOf(l), l == 0 ? 0xFFF87171 : value()));
		}));
		MODULES.add(text("daytime", "World time", "The day number and in-game time", false, () -> {
			long t = worldTime();
			if (t < 0) return labeled("Day", "—");
			long day = t / 24000L + 1;
			long ticks = (t + 6000L) % 24000L;
			return List.of(new Line().add("Day " + day + " ", label()).add(String.format(Locale.ROOT, "%02d:%02d", ticks / 1000, ticks % 1000 * 60 / 1000), value()));
		}));
		MODULES.add(text("session", "Session time", "How long you have been playing this session", false, () -> {
			long s = sessionStart == 0 ? 0 : (System.currentTimeMillis() - sessionStart) / 1000;
			return labeled("Playing", s >= 3600 ? String.format(Locale.ROOT, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String.format(Locale.ROOT, "%d:%02d", s / 60, s % 60));
		}));
		MODULES.add(text("chunk", "Chunk", "Which chunk you are in, and where inside it", false, () -> {
			Player p = mc().player;
			BlockPos b = p == null ? new BlockPos(0, 64, 0) : p.blockPosition();
			return List.of(new Line().add("Chunk ", label()).add((b.getX() >> 4) + ", " + (b.getZ() >> 4), value()).add("  in " + (b.getX() & 15) + ", " + (b.getZ() & 15), label()));
		}));
		MODULES.add(new Module("logo", "Nimbus logo", "The Nimbus badge, wherever you like it", false) {
			@Override
			int[] paint(Canvas c, boolean draw) {
				if (draw) NimbusArt.badgeAt(c, 0, 0, 10_000L + System.currentTimeMillis() % 3_600_000L);
				return NimbusArt.badgeSize();
			}
		});
	}

	/** The WASD / mouse / space boxes. */
	static final class Keystrokes extends Module {
		Keystrokes() {
			super("keys", "Keystrokes", "Shows the movement keys and mouse buttons you press", false);
		}

		@Override
		int[] paint(Canvas c, boolean draw) {
			int k = 19;
			int g = 2;
			int w = k * 3 + g * 2;
			int h = k * 2 + g + g + 14 + g + 9;
			if (!draw) return new int[] {w, h};
			key(c, k + g, 0, k, k, "W", down(0));
			key(c, 0, k + g, k, k, "A", down(1));
			key(c, k + g, k + g, k, k, "S", down(2));
			key(c, (k + g) * 2, k + g, k, k, "D", down(3));
			int my = (k + g) * 2;
			int half = (w - g) / 2;
			key(c, 0, my, half, 14, count(LEFT) + " LMB", mouse(LEFT));
			key(c, half + g, my, w - half - g, 14, count(RIGHT) + " RMB", mouse(RIGHT));
			key(c, 0, my + 14 + g, w, 9, "", down(4));
			c.rect(w / 2 - 8, my + 14 + g + 4, w / 2 + 8, my + 14 + g + 5, down(4) ? 0xFF10131E : value());
			return new int[] {w, h};
		}

		private static void key(Canvas c, int x, int y, int w, int h, String label, boolean pressed) {
			int bg = pressed ? (0xE0000000 | (accent() & 0xFFFFFF)) : background();
			if ((bg >>> 24) != 0) c.rect(x, y, x + w, y + h, bg);
			if (!label.isEmpty()) c.text(label, x + (w - c.textWidth(label) + 1) / 2, y + (h - 7) / 2, pressed ? 0xFFFFFFFF : value(), shadow());
		}

		private static boolean down(int i) {
			try {
				var o = mc().options;
				return switch (i) {
					case 0 -> o.keyUp.isDown();
					case 1 -> o.keyLeft.isDown();
					case 2 -> o.keyDown.isDown();
					case 3 -> o.keyRight.isDown();
					default -> o.keyJump.isDown();
				};
			} catch (Throwable t) {
				return false;
			}
		}
	}

	// ------------------------------------------------------------------ style

	static final String[] ACCENT_NAMES = {"Purple", "Blue", "Green", "Orange", "Pink", "White"};
	private static final int[] ACCENTS = {0x7C5CFF, 0x3B82F6, 0x22C55E, 0xF97316, 0xEC4899, 0xFFFFFF};
	static final String[] BACKGROUND_NAMES = {"Dark", "Glass", "None"};

	static int accent() {
		return 0xFF000000 | ACCENTS[Math.floorMod(NimbusConfig.value("hud.accent", 0), ACCENTS.length)];
	}

	static int background() {
		return switch (NimbusConfig.value("hud.background", 0)) {
			case 1 -> 0x50000000;
			case 2 -> 0;
			default -> 0xA0101320;
		};
	}

	static boolean shadow() {
		return NimbusConfig.on("hud.shadow", true);
	}

	static int label() {
		int a = accent();
		// accent mixed with white, so labels read on any background
		int r = ((a >> 16 & 255) + 255 * 2) / 3;
		int g = ((a >> 8 & 255) + 255 * 2) / 3;
		int b = ((a & 255) + 255 * 2) / 3;
		return 0xFF000000 | r << 16 | g << 8 | b;
	}

	static int value() {
		return 0xFFFFFFFF;
	}

	static int wear(int left, int max) {
		float f = max <= 0 ? 1 : left / (float) max;
		return f > 0.5f ? 0xFF4ADE80 : f > 0.2f ? 0xFFFACC15 : 0xFFF87171;
	}

	static void box(Canvas c, int x, int y, int w, int h) {
		int bg = background();
		if ((bg >>> 24) != 0) {
			c.rect(x + 1, y, x + w - 1, y + h, bg);
			c.rect(x, y + 1, x + 1, y + h - 1, bg);
			c.rect(x + w - 1, y + 1, x + w, y + h - 1, bg);
		}
		c.rect(x + 1, y + 2, x + 2, y + h - 2, accent());
	}

	// ------------------------------------------------------------------ placement

	/**
	 * Where each module sits on this screen, in GUI units: {x, y, width, height}. Modules
	 * that were never placed stack down the left edge, wrapping into a new column.
	 */
	static List<int[]> layout(Canvas c, List<Module> mods) {
		List<int[]> out = new ArrayList<>();
		int sx = 4;
		int sy = 4;
		int colW = 0;
		for (Module m : mods) {
			int[] size;
			try {
				size = m.paint(c, false);
			} catch (Throwable t) {
				size = new int[] {40, 17};
			}
			float s = scale(m);
			int w = Math.round(size[0] * s);
			int h = Math.round(size[1] * s);
			NimbusConfig.Place p = NimbusConfig.place(m.id);
			int x;
			int y;
			if (p != null) {
				x = Math.round(p.x * c.width());
				y = Math.round(p.y * c.height());
			} else {
				if (sy > 4 && sy + h > c.height() - 4) {
					sx += colW + 4;
					sy = 4;
					colW = 0;
				}
				x = sx;
				y = sy;
				sy += h + 2;
				colW = Math.max(colW, w);
			}
			x = Math.max(0, Math.min(c.width() - w, x));
			y = Math.max(0, Math.min(c.height() - h, y));
			out.add(new int[] {x, y, w, h});
		}
		return out;
	}

	static float scale(Module m) {
		NimbusConfig.Place p = NimbusConfig.place(m.id);
		return p == null ? 1f : Math.max(0.5f, Math.min(2.5f, p.scale));
	}

	static List<Module> enabled() {
		List<Module> out = new ArrayList<>();
		for (Module m : MODULES) if (m.enabled()) out.add(m);
		return out;
	}

	/** Draws one module at its place (from layout()). */
	static void draw(Canvas c, Module m, int[] r) {
		float s = scale(m);
		c.push(r[0], r[1], s);
		try {
			m.paint(c, true);
		} catch (Throwable ignored) {
			// a lookup this version lacks: skip the module
		} finally {
			c.pop();
		}
	}

	// ------------------------------------------------------------------ every frame


	/** Called from the in-game HUD every frame. */
	public static void render(Canvas c) {
		try {
			tick();
			NimbusLan.tick();
		} catch (Throwable ignored) {
			// never let a helper break the HUD
		}
		try {
			drawModules(c);
		} finally {
			try {
				// with a menu open it's drawn by the menu instead, above its blur
				if (Compat.screen() == null) NimbusLan.draw(c);
			} catch (Throwable ignored) {
				// the question box is extra
			}
		}
	}

	private static void drawModules(Canvas c) {
		try {
			if (Compat.hudHidden() || editing) return;
			Screen open = Compat.screen();
			if (open instanceof FeaturesScreenBase || open instanceof SkinsScreenBase) return;
		} catch (Throwable ignored) {
			// fine, draw anyway
		}
		List<Module> list = enabled();
		List<int[]> places = layout(c, list);
		for (int i = 0; i < list.size(); i++) draw(c, list.get(i), places.get(i));
	}

	private static void tick() {
		Minecraft mc = mc();
		long now = System.currentTimeMillis();
		if (mc.level != null && sessionStart == 0) sessionStart = now;
		if (mc.level == null) sessionStart = 0;

		// clicks
		track(LEFT, mouse(LEFT), now);
		track(RIGHT, mouse(RIGHT), now);

		// speed, from how far you moved
		Player p = mc.player;
		if (p != null) {
			if (Double.isNaN(lastX)) {
				lastX = p.getX();
				lastZ = p.getZ();
				lastMove = now;
			} else if (now - lastMove >= 250) {
				double d = Math.hypot(p.getX() - lastX, p.getZ() - lastZ);
				double v = d / ((now - lastMove) / 1000.0);
				speed = speed * 0.5 + v * 0.5;
				lastX = p.getX();
				lastZ = p.getZ();
				lastMove = now;
			}
		}

		// Right Shift opens the menu
		boolean shortcut = Compat.screen() == null && NimbusConfig.on("menu.shortcut", true) && Compat.keyDown(Compat.KEY_RIGHT_SHIFT);
		if (shortcut && !shortcutWasDown) mc.execute(() -> Compat.setScreen(Compat.features(null)));
		shortcutWasDown = shortcut;

		Tweaks.frame(mc);
	}

	private static boolean mouse(int button) {
		try {
			return button == LEFT ? mc().options.keyAttack.isDown() : mc().options.keyUse.isDown();
		} catch (Throwable t) {
			return false;
		}
	}

	private static void track(int button, boolean down, long now) {
		if (down && !WAS_DOWN[button]) CLICKS[button].addLast(now);
		WAS_DOWN[button] = down;
		while (!CLICKS[button].isEmpty() && now - CLICKS[button].peekFirst() > 1000) CLICKS[button].pollFirst();
	}

	private static int count(int button) {
		return CLICKS[button].size();
	}

	// ------------------------------------------------------------------ lookups

	static Minecraft mc() {
		return Minecraft.getInstance();
	}

	private static String fmt(double v) {
		return String.valueOf((int) Math.floor(v));
	}

	private static String facing(float yaw) {
		String[] dirs = {"South (+Z)", "South-West", "West (-X)", "North-West", "North (-Z)", "North-East", "East (+X)", "South-East"};
		int i = Math.floorMod(Math.round(yaw / 45f), 8);
		return dirs[i];
	}

	private static String biome(BlockPos pos) {
		try {
			String key = mc().level.getBiome(pos).unwrapKey().map(Object::toString).orElse("");
			// "ResourceKey[minecraft:worldgen/biome / minecraft:dark_forest]"
			int slash = key.lastIndexOf(" / ");
			String id = slash >= 0 ? key.substring(slash + 3).replace("]", "") : key;
			id = id.contains(":") ? id.substring(id.indexOf(':') + 1) : id;
			StringBuilder out = new StringBuilder();
			for (String w : id.split("_")) {
				if (w.isEmpty()) continue;
				if (out.length() > 0) out.append(' ');
				out.append(Character.toUpperCase(w.charAt(0))).append(w.substring(1));
			}
			return out.length() == 0 ? "Unknown" : out.toString();
		} catch (Throwable t) {
			return "Unknown";
		}
	}

	private static int ping() {
		try {
			Player p = mc().player;
			if (p == null || mc().getConnection() == null) return 0;
			var info = mc().getConnection().getPlayerInfo(p.getUUID());
			return info == null ? 0 : info.getLatency();
		} catch (Throwable t) {
			return 0;
		}
	}

	private static long worldTime() {
		try {
			return mc().level == null ? 1000 : Compat.dayTime();
		} catch (Throwable t) {
			return -1;
		}
	}

	/** Used by the HUD editor to preview modules on the title screen. */
	static void resetSession() {
		sessionStart = 0;
	}

	/** Opens the Nimbus Features menu. */
	public static void openMenu(Screen parent) {
		Compat.setScreen(Compat.features(parent));
	}
}
