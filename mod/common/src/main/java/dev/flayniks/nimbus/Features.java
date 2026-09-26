package dev.flayniks.nimbus;

import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.IntSupplier;
import net.minecraft.client.OptionInstance;
import net.minecraft.client.Options;

/** Everything in the Nimbus Features menu, as rows: switches, choices and one-click actions. */
final class Features {
	private Features() {
	}

	static final String[] TABS = {"HUD", "Performance", "Utilities"};

	enum Kind { TOGGLE, CYCLE, ACTION }

	static final class Row {
		final int tab;
		final String name;
		final String description;
		final Kind kind;
		BooleanSupplier isOn;
		Consumer<Boolean> setOn;
		String[] labels;
		IntSupplier index;
		Consumer<Integer> choose;
		Runnable action;
		String actionLabel;

		Row(int tab, String name, String description, Kind kind) {
			this.tab = tab;
			this.name = name;
			this.description = description;
			this.kind = kind;
		}

		/** False when this Minecraft version has no such option. */
		boolean available() {
			try {
				if (kind == Kind.CYCLE) return index.getAsInt() >= 0;
				if (kind == Kind.TOGGLE) {
					isOn.getAsBoolean();
					return true;
				}
				return true;
			} catch (Throwable t) {
				return false;
			}
		}

		String valueLabel() {
			try {
				return switch (kind) {
					case TOGGLE -> isOn.getAsBoolean() ? "On" : "Off";
					case CYCLE -> {
						int i = index.getAsInt();
						yield i < 0 ? "—" : labels[i];
					}
					case ACTION -> actionLabel;
				};
			} catch (Throwable t) {
				return "—";
			}
		}

		void click() {
			try {
				switch (kind) {
					case TOGGLE -> setOn.accept(!isOn.getAsBoolean());
					case CYCLE -> {
						int i = index.getAsInt();
						choose.accept((Math.max(i, -1) + 1) % labels.length);
					}
					case ACTION -> action.run();
				}
			} catch (Throwable ignored) {
				// unavailable here
			}
		}
	}

	// ---------------------------------------------------------------- builders

	static Row toggle(int tab, String id, boolean def, String name, String description) {
		Row r = new Row(tab, name, description, Kind.TOGGLE);
		r.isOn = () -> NimbusConfig.on(id, def);
		r.setOn = (v) -> NimbusConfig.set(id, v);
		return r;
	}

	static Row choice(int tab, String id, int def, String name, String description, String... labels) {
		Row r = new Row(tab, name, description, Kind.CYCLE);
		r.labels = labels;
		r.index = () -> Math.floorMod(NimbusConfig.value(id, def), labels.length);
		r.choose = (i) -> NimbusConfig.set(id, i);
		return r;
	}

	static Row action(int tab, String name, String description, String label, Runnable run) {
		Row r = new Row(tab, name, description, Kind.ACTION);
		r.actionLabel = label;
		r.action = run;
		return r;
	}

	/** A vanilla on/off option; `invert` shows "On" when the option itself is off. */
	static Row vanillaToggle(int tab, String name, String description, Function<Options, OptionInstance<?>> getter, boolean invert) {
		Row r = new Row(tab, name, description, Kind.TOGGLE);
		r.isOn = () -> {
			Object v = Opts.get(getter);
			if (!(v instanceof Boolean b)) throw new IllegalStateException("unavailable");
			return invert != b;
		};
		r.setOn = (on) -> Opts.set(getter, invert != on);
		return r;
	}

	/** A vanilla number option with a fixed list of steps. */
	static Row vanillaSteps(int tab, String name, String description, Function<Options, OptionInstance<?>> getter, Object[] steps, String[] labels) {
		Row r = new Row(tab, name, description, Kind.CYCLE);
		r.labels = labels;
		r.index = () -> {
			Object v = Opts.get(getter);
			if (v == null) return -1;
			int best = 0;
			double bestDiff = Double.MAX_VALUE;
			for (int i = 0; i < steps.length; i++) {
				double d = Math.abs(((Number) steps[i]).doubleValue() - ((Number) v).doubleValue());
				if (d < bestDiff) {
					bestDiff = d;
					best = i;
				}
			}
			return best;
		};
		r.choose = (i) -> Opts.set(getter, steps[i]);
		return r;
	}

	/** A vanilla choice option (graphics, particles, clouds), by position in its list. */
	static Row vanillaEnum(int tab, String name, String description, Function<Options, OptionInstance<?>> getter, String... labels) {
		Row r = new Row(tab, name, description, Kind.CYCLE);
		r.labels = labels;
		r.index = () -> {
			Object v = Opts.get(getter);
			return v instanceof Enum<?> e && e.ordinal() < labels.length ? e.ordinal() : -1;
		};
		r.choose = (i) -> Tweaks.setEnum(getter, i);
		return r;
	}

	private static Object[] ints(int... v) {
		Object[] o = new Object[v.length];
		for (int i = 0; i < v.length; i++) o[i] = v[i];
		return o;
	}

	private static String[] names(int[] v, String suffix) {
		String[] s = new String[v.length];
		for (int i = 0; i < v.length; i++) s[i] = v[i] + suffix;
		return s;
	}

	// ---------------------------------------------------------------- the list

	static final List<Row> ROWS = new ArrayList<>();

	static {
		int hud = 0;
		for (NimbusHud.Module m : NimbusHud.MODULES) ROWS.add(toggle(hud, "hud." + m.id, m.defaultOn, m.title, m.description));
		ROWS.add(choice(hud, "hud.background", 0, "Box style", "The background behind each HUD box", NimbusHud.BACKGROUND_NAMES));
		ROWS.add(choice(hud, "hud.accent", 0, "Accent colour", "The colour of labels and the stripe on each box", NimbusHud.ACCENT_NAMES));
		ROWS.add(toggle(hud, "hud.shadow", true, "Text shadow", "A shadow behind HUD text, easier to read on bright ground"));
		ROWS.add(choice(hud, "clock.format", 0, "Clock format", "24-hour or 12-hour clock", "24-hour", "12-hour"));

		int perf = 1;
		Row preset = new Row(perf, "Performance preset", "Sets many video options at once. Click to switch: Max FPS, Balanced, Quality", Kind.CYCLE);
		preset.labels = Tweaks.PRESETS;
		preset.index = () -> Math.floorMod(NimbusConfig.value("preset.last", 1), Tweaks.PRESETS.length);
		preset.choose = (i) -> {
			Tweaks.applyPreset(i);
			NimbusConfig.set("preset.last", i);
		};
		ROWS.add(preset);
		ROWS.add(choice(perf, "background.fps", 2, "Background FPS limit", "Frames per second while Minecraft isn't the active window. Saves power and heat", "Off", "5 FPS", "10 FPS", "15 FPS", "30 FPS"));
		int[] rd = {4, 6, 8, 10, 12, 16, 20, 24, 32};
		ROWS.add(vanillaSteps(perf, "Render distance", "How far you can see, in chunks. Lower is faster", (o) -> o.renderDistance(), ints(rd), names(rd, " chunks")));
		int[] sim = {5, 6, 8, 10, 12, 16, 20, 24, 32};
		ROWS.add(vanillaSteps(perf, "Simulation distance", "How far away mobs and farms keep working. Lower is faster", (o) -> o.simulationDistance(), ints(sim), names(sim, " chunks")));
		int[] fps = {30, 60, 75, 120, 144, 165, 240, 260};
		String[] fpsNames = names(fps, " FPS");
		fpsNames[fpsNames.length - 1] = "Unlimited";
		ROWS.add(vanillaSteps(perf, "Max framerate", "The FPS cap. Unlimited is fastest; a cap keeps things cooler", (o) -> o.framerateLimit(), ints(fps), fpsNames));
		ROWS.add(vanillaToggle(perf, "VSync", "Syncs frames to your monitor: no tearing, but caps FPS", (o) -> o.enableVsync(), false));
		ROWS.add(vanillaEnum(perf, "Graphics", "Fast is quicker; Fancy looks better", Compat::graphics, "Fast", "Fancy", "Fabulous"));
		ROWS.add(vanillaEnum(perf, "Particles", "Fewer particles means more FPS in busy places", (o) -> o.particles(), "All", "Decreased", "Minimal"));
		ROWS.add(vanillaEnum(perf, "Clouds", "Clouds cost FPS, especially Fancy ones", (o) -> o.cloudStatus(), "Off", "Fast", "Fancy"));
		ROWS.add(vanillaToggle(perf, "Entity shadows", "The round shadows under mobs and players", (o) -> o.entityShadows(), false));
		ROWS.add(vanillaToggle(perf, "Smooth lighting", "Softer light and shade, costs some FPS", (o) -> o.ambientOcclusion(), false));
		int[] blend = {0, 1, 2, 3, 5, 7};
		ROWS.add(vanillaSteps(perf, "Biome blend", "Smooth colour changes between biomes. Off is fastest", (o) -> o.biomeBlendRadius(), ints(blend),
			new String[] {"Off", "3×3", "5×5", "7×7", "11×11", "15×15"}));
		ROWS.add(vanillaSteps(perf, "Entity distance", "How far away mobs are drawn", (o) -> o.entityDistanceScaling(),
			new Object[] {0.5, 0.75, 1.0, 1.5, 2.0, 3.0}, new String[] {"50%", "75%", "100%", "150%", "200%", "300%"}));

		int util = 2;
		ROWS.add(toggle(util, "zoom", true, "Zoom", "Hold C to zoom in, like a spyglass you always carry"));
		ROWS.add(choice(util, "zoom.level", 2, "Zoom strength", "How far Zoom goes in", "2×", "3×", "4×", "6×", "8×"));
		ROWS.add(toggle(util, "zoom.smooth", true, "Smooth zoom", "Glide in and out instead of snapping"));
		ROWS.add(toggle(util, "fullbright", false, "Fullbright", "See in caves and at night without torches"));
		ROWS.add(vanillaToggle(util, "Toggle sprint", "Press sprint once instead of holding it", (o) -> o.toggleSprint(), false));
		ROWS.add(vanillaToggle(util, "Toggle sneak", "Press sneak once instead of holding it", (o) -> o.toggleCrouch(), false));
		Row tilt = new Row(util, "No hurt shake", "The screen stops tilting when you take damage", Kind.TOGGLE);
		tilt.isOn = () -> {
			Object v = Opts.get((o) -> o.damageTiltStrength());
			if (!(v instanceof Double d)) throw new IllegalStateException("unavailable");
			return d == 0.0;
		};
		tilt.setOn = (on) -> Opts.set((o) -> o.damageTiltStrength(), on ? 0.0 : 1.0);
		ROWS.add(tilt);
		ROWS.add(vanillaToggle(util, "No view bobbing", "The camera stops bobbing while you walk", (o) -> o.bobView(), true));
		ROWS.add(toggle(util, "inventory.watermark", true, "Inventory watermark", "The Nimbus badge in the corner while your inventory is open"));
		ROWS.add(choice(util, "menu.background", 0, "Menu background", "Behind the title screen and menus: Minecraft's panorama, the Nimbus glow or your own picture", MenuBackground.MODES));
		ROWS.add(action(util, "Background picture", "Pick a PNG from your computer for the menu background", "Choose…", MenuBackground::choose));
		ROWS.add(toggle(util, "menu.shortcut", true, "Right Shift opens this menu", "Press Right Shift in game to open Nimbus Features"));
	}

	static List<Row> tab(int tab) {
		List<Row> out = new ArrayList<>();
		for (Row r : ROWS) if (r.tab == tab) out.add(r);
		return out;
	}
}
