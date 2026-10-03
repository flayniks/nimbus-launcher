package dev.flayniks.nimbus;

import java.util.ArrayList;
import java.util.List;

/**
 * Your own texts on the HUD, up to 20: each one is a HUD box like the others (moved and sized in
 * Edit HUD layout, switched off with ×). A colour for the whole text, rainbow included, and
 * Minecraft's colour codes (&c, &a…) for parts of it.
 */
final class CustomTexts {
	private CustomTexts() {
	}

	static final String[] COLOR_NAMES = {"White", "Accent", "Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Pink", "Gray", "Rainbow"};
	private static final int[] COLORS = {0xFFFFFFFF, 0, 0xFFFF5555, 0xFFFFAA00, 0xFFFFFF55, 0xFF55FF55, 0xFF55FFFF, 0xFF5599FF, 0xFFB57BFF, 0xFFFF77CC, 0xFFAAAAAA, 0};
	static final int ACCENT = 1;
	static final int RAINBOW = 11;
	// &0 to &f, as in chat
	private static final int[] CODES = {0x000000, 0x0000AA, 0x00AA00, 0x00AAAA, 0xAA0000, 0xAA00AA, 0xFFAA00, 0xAAAAAA, 0x555555, 0x5555FF, 0x55FF55, 0x55FFFF, 0xFF5555, 0xFF55FF, 0xFFFF55, 0xFFFFFF};

	/** A run of text in one colour. */
	record Seg(String text, int color) {
	}

	static int color(int index) {
		int i = Math.floorMod(index, COLORS.length);
		return i == ACCENT ? NimbusHud.label() : i == RAINBOW ? 0xFFFFFFFF : COLORS[i];
	}

	/** The text cut into coloured runs; codes switch the colour, and rainbow goes letter by letter. */
	static List<Seg> segments(String raw, int colorIndex, long ms) {
		List<Seg> out = new ArrayList<>();
		boolean rainbow = Math.floorMod(colorIndex, COLORS.length) == RAINBOW;
		int base = color(colorIndex);
		int current = base;
		boolean coded = false;
		StringBuilder run = new StringBuilder();
		int letter = 0;
		String s = raw == null ? "" : raw;
		for (int i = 0; i < s.length(); i++) {
			char ch = s.charAt(i);
			if (ch == '&' && i + 1 < s.length()) {
				int code = Character.digit(Character.toLowerCase(s.charAt(i + 1)), 16);
				boolean reset = Character.toLowerCase(s.charAt(i + 1)) == 'r';
				if (code >= 0 || reset) {
					if (run.length() > 0) out.add(new Seg(run.toString(), current));
					run.setLength(0);
					coded = code >= 0;
					current = coded ? 0xFF000000 | CODES[code] : base;
					i++;
					continue;
				}
			}
			if (rainbow && !coded) {
				if (run.length() > 0) out.add(new Seg(run.toString(), current));
				run.setLength(0);
				out.add(new Seg(String.valueOf(ch), hue((ms % 2_600_000L) / 2600f - letter * 0.07f)));
				letter++;
				continue;
			}
			run.append(ch);
		}
		if (run.length() > 0) out.add(new Seg(run.toString(), current));
		return out;
	}

	/** The text without its colour codes. */
	static String plain(String raw) {
		StringBuilder b = new StringBuilder();
		for (Seg s : segments(raw, 0, 0)) b.append(s.text());
		return b.toString();
	}

	static int width(Canvas c, List<Seg> segs) {
		int w = 0;
		for (Seg s : segs) w += c.textWidth(s.text());
		return w;
	}

	static void draw(Canvas c, List<Seg> segs, int x, int y, boolean shadow) {
		for (Seg s : segs) {
			c.text(s.text(), x, y, s.color(), shadow);
			x += c.textWidth(s.text());
		}
	}

	static int hue(float h) {
		float f = h - (float) Math.floor(h);
		float r = Math.abs(f * 6 - 3) - 1;
		float g = 2 - Math.abs(f * 6 - 2);
		float b = 2 - Math.abs(f * 6 - 4);
		int ri = Math.round(255 * Math.max(0, Math.min(1, r)) * 0.75f + 64);
		int gi = Math.round(255 * Math.max(0, Math.min(1, g)) * 0.75f + 64);
		int bi = Math.round(255 * Math.max(0, Math.min(1, b)) * 0.75f + 64);
		return 0xFF000000 | Math.min(255, ri) << 16 | Math.min(255, gi) << 8 | Math.min(255, bi);
	}

	// ------------------------------------------------------------------ as HUD boxes

	/** One of your texts as a HUD module; it reads the text afresh every frame, so edits show at once. */
	static final class TextModule extends NimbusHud.Module {
		TextModule(String id, String title) {
			super(id, title, "Your text", true);
		}

		@Override
		int[] paint(Canvas c, boolean draw) {
			NimbusConfig.Text t = NimbusConfig.text(id);
			String raw = t == null ? "" : t.text;
			List<Seg> segs = segments(raw, t == null ? 0 : t.color, System.currentTimeMillis());
			int w = Math.max(6, width(c, segs));
			if (t != null && t.box) {
				int pad = 4;
				int bw = w + pad * 2 + 2;
				int bh = 10 + pad * 2 - 1;
				if (draw) {
					NimbusHud.box(c, 0, 0, bw, bh);
					draw(c, segs, pad + 2, pad, NimbusHud.shadow());
				}
				return new int[] {bw, bh};
			}
			if (draw) draw(c, segs, 0, 0, true);
			return new int[] {w + 1, 9};
		}
	}

	private static int builtFor = -1;
	private static List<NimbusHud.Module> modules = List.of();

	/** A module for each of your texts, made again when they change. */
	static List<NimbusHud.Module> modules() {
		if (builtFor != NimbusConfig.textsVersion() || builtFor < 0) {
			List<NimbusHud.Module> out = new ArrayList<>();
			for (NimbusConfig.Text t : NimbusConfig.texts()) {
				String name = plain(t.text).trim();
				out.add(new TextModule(t.id, name.isEmpty() ? "Your text" : name.length() > 28 ? name.substring(0, 27) + "…" : name));
			}
			modules = out;
			builtFor = NimbusConfig.textsVersion();
		}
		return modules;
	}

	static int count() {
		return NimbusConfig.texts().size();
	}
}
