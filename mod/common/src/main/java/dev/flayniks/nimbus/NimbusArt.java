package dev.flayniks.nimbus;

import java.util.HashMap;
import java.util.Map;

/**
 * Everything Nimbus draws, built from nothing but filled rectangles so it works
 * before Minecraft has loaded a single texture or font: a pixel-art cube, a
 * 5x7 pixel font, drifting particles and a progress bar.
 */
public final class NimbusArt {
	public static final int BG = 0x0B0D14;
	static final int A1 = 0x7C5CFF;
	static final int A2 = 0xC084FC;
	static final int MUTED = 0x8B90A5;
	static final int TRACK = 0x1E2233;
	static final int WHITE = 0xFFFFFF;

	private NimbusArt() {
	}

	// ------------------------------------------------------------------ animation options

	/** Settings → Animations in the launcher, passed in as -Dnimbus.anim.* when the game starts. */
	public static final boolean LOADING = flag("loading");
	static final boolean PARTICLES = flag("particles");
	/** Animation styles for the logo on the loading screen. */
	static final java.util.List<String> STYLES = java.util.List.of("spin", "bounce", "splash", "pulse", "flip", "still");
	/** When the game starts; the older on/off "cube" switch maps to spin or still. */
	static final String STYLE = pick(System.getProperty("nimbus.anim.style"), flag("cube") ? "spin" : "still");
	/** When resource packs load in game. */
	static final String RELOAD_STYLE = pick(System.getProperty("nimbus.anim.reloadStyle"), STYLE);
	static final boolean CUBE_MOTION = !"still".equals(STYLE);
	public static final boolean BADGE = flag("badge");
	static final boolean MENU_MOTION = flag("menus");
	static final float SPEED = speed();

	private static String pick(String value, String fallback) {
		return value != null && STYLES.contains(value) ? value : fallback;
	}

	private static boolean flag(String name) {
		return !"false".equalsIgnoreCase(System.getProperty("nimbus.anim." + name));
	}

	private static float speed() {
		try {
			float v = Float.parseFloat(System.getProperty("nimbus.anim.speed", "1"));
			return v > 0.1f && v < 5f ? v : 1f;
		} catch (NumberFormatException e) {
			return 1f;
		}
	}

	// ------------------------------------------------------------------ loading screen

	/**
	 * @param progress 0..1, Minecraft's smoothed reload progress
	 * @param alpha    overall opacity of the overlay (fades in and out with vanilla's)
	 * @param barAlpha opacity of the progress bar, which fades out first
	 * @param opaque   paint the background too (vanilla's is hidden underneath)
	 * @param millis   time since this loading screen appeared
	 */
	public static void loading(Canvas c, float progress, float alpha, float barAlpha, boolean opaque, long millis) {
		loading(c, progress, alpha, barAlpha, opaque, millis, false);
	}

	/** @param reload true when resource packs are loading in game, false when the game starts */
	public static void loading(Canvas c, float progress, float alpha, float barAlpha, boolean opaque, long millis, boolean reload) {
		if (alpha <= 0.01f) return;
		int w = c.width();
		int h = c.height();
		float t = millis * SPEED / 1000f;

		if (opaque) c.rect(0, 0, w, h, argb(BG, 1f));
		backdrop(c, w, h, t, alpha, PARTICLES, true);

		int size = clamp(Math.round(h * 0.11f), 14, 44);
		int cell = Math.max(1, Math.round(size / 8f));
		int cx = w / 2;
		int cy = Math.round(h * 0.36f);
		animatedLogo(c, reload ? RELOAD_STYLE : STYLE, cx, cy, size, cell, t, alpha);

		int big = Math.max(2, Math.round(h / 72f));
		String word = "NIMBUS";
		int wordW = textWidth(word, big, 1);
		int wordX = cx - wordW / 2;
		int wordY = cy + Math.round(size * 1.35f) + 6;
		wordmark(c, word, wordX, wordY, big, t, alpha);

		int small = Math.max(1, big / 2);
		String sub = "LAUNCHER";
		float subA = alpha * easeOutCubic(clamp01((t - 0.55f) / 0.5f));
		text(c, sub, cx - textWidth(sub, small, 2) / 2, wordY + 7 * big + small * 4, small, 2, MUTED, subA);

		if (barAlpha > 0.01f) {
			int barW = Math.min(Math.round(w * 0.42f), 220);
			int barH = Math.max(3, big);
			int barX = cx - barW / 2;
			int barY = Math.round(h * 0.8f);
			bar(c, barX, barY, barW, barH, progress, t, alpha * barAlpha);

			int tiny = 1;
			int dots = (int) (t * 2.5f) % 4;
			String status = progress >= 0.999f ? "READY" : "LOADING MINECRAFT" + ".".repeat(dots);
			text(c, status, barX, barY + barH + 5, tiny, 1, MUTED, alpha * barAlpha);
			String pct = Math.round(progress * 100) + "%";
			text(c, pct, barX + barW - textWidth(pct, tiny, 1), barY + barH + 5, tiny, 1, WHITE, alpha * barAlpha * 0.8f);
		}
	}

	/** The Nimbus Features icon for a small 20x20 button: the logo. */
	public static void featuresIcon(Canvas c, int x, int y, long millis) {
		logo(c, x + 10, y + 10, 5, 1, millis * SPEED / 1000f, 1f, CUBE_MOTION);
	}

	/** The Skins & Capes icon for a small 20x20 button: a little pixel shirt. */
	public static void skinsIcon(Canvas c, int x, int y) {
		String[] rows = {
			"..##..##..",
			".########.",
			"##########",
			"##.####.##",
			"...####...",
			"...####...",
			"...####...",
			"...####...",
		};
		for (int r = 0; r < rows.length; r++) {
			for (int col = 0; col < rows[r].length(); col++) {
				if (rows[r].charAt(col) != '#') continue;
				int rgb = mix(RING_B, 0x6D3DF0, r / 8f);
				c.rect(x + 5 + col, y + 6 + r, x + 6 + col, y + 7 + r, argb(rgb, 1f));
			}
		}
	}

	/** Where the lettering starts in a badge, after the logo and its ring. */
	private static final int BADGE_TEXT_X = 30;

	/** Width and height of a badge, for laying it out. */
	public static int[] badgeSize() {
		return new int[] {BADGE_TEXT_X + Math.max(textWidth("NIMBUS", 1, 1), textWidth("LAUNCHER", 1, 1)), 17};
	}

	/** The badge at any spot, fully shown (for the HUD and the inventory). */
	public static void badgeAt(Canvas c, int x, int y, long millis) {
		float t = millis * SPEED / 1000f;
		float a = easeOutCubic(clamp01(t / 0.35f));
		if (a <= 0.01f) return;
		badgeArt(c, x, y, t, a);
	}

	/** The corner badge on the title screen. */
	public static void badge(Canvas c, long millis) {
		if (!BADGE) return;
		float t = millis * SPEED / 1000f;
		float a = easeOutCubic(clamp01((t - 0.2f) / 0.8f));
		if (a <= 0.01f) return;
		int slide = Math.round((1 - a) * -8);
		badgeArt(c, 6 + slide, 6, t, a);
	}

	private static void badgeArt(Canvas c, int x, int y, float t, float a) {
		logo(c, x + 14, y + 8, 8, 1, t, a, CUBE_MOTION);
		wordmark(c, "NIMBUS", x + BADGE_TEXT_X, y, 1, t + 10, a);
		text(c, "LAUNCHER", x + BADGE_TEXT_X, y + 9, 1, 1, MUTED, a * 0.9f);
	}

	/** The Nimbus glow and drifting particles behind a menu; `opaque` paints the dark background first. */
	public static void menuBackdrop(Canvas c, long millis, boolean opaque) {
		int w = c.width();
		int h = c.height();
		c.rect(0, 0, w, h, opaque ? argb(BG, 1f) : argb(BG, 0.78f));
		// "Moving menus" off: a still glow and no drifting sparks
		backdrop(c, w, h, MENU_MOTION ? millis * SPEED / 1000f : 0f, opaque ? 1f : 0.7f, PARTICLES && MENU_MOTION, MENU_MOTION);
	}

	// ------------------------------------------------------------------ pieces

	private static void backdrop(Canvas c, int w, int h, float t, float alpha, boolean particles, boolean pulsing) {
		// soft glow behind the logo: nested ellipses drawn a row at a time, so the edges stay round
		int gx = w / 2;
		int gy = Math.round(h * 0.4f);
		float pulse = pulsing ? 1f + 0.04f * (float) Math.sin(t * 1.6f) : 1f;
		int step = Math.max(1, h / 120);
		for (int level = 1; level <= 5; level++) {
			float rx = w * 0.09f * level * pulse;
			float ry = h * 0.085f * level * pulse;
			int glow = argb(A1, 0.022f * alpha);
			for (int y = -Math.round(ry); y < Math.round(ry); y += step) {
				float k = (y + step / 2f) / ry;
				if (k * k >= 1f) continue;
				int half = Math.round(rx * (float) Math.sqrt(1 - k * k));
				c.rect(gx - half, gy + y, gx + half, gy + y + step, glow);
			}
		}
		// particles drifting upwards
		for (int i = 0; particles && i < 28; i++) {
			float rx = hash(i * 3 + 1);
			float speed = 6 + hash(i * 3 + 2) * 16;
			float phase = hash(i * 3 + 3);
			int s = 1 + (int) (hash(i * 7 + 5) * 2.99f);
			float span = h + 20;
			float y = span - ((t * speed + phase * span) % span) - 10;
			int x = Math.round(rx * w);
			float fade = clamp01(y / (h * 0.35f)) * clamp01((h - y) / (h * 0.2f));
			float pa = (0.12f + hash(i * 11) * 0.3f) * fade * alpha;
			int col = mix(A1, A2, hash(i * 13));
			c.rect(x, Math.round(y), x + s, Math.round(y) + s, argb(col, pa));
		}
	}

	/**
	 * The logo on the loading screen, moving in the chosen style:
	 * spin (bobs, a glint runs round the ring), bounce (hops with squash and stretch),
	 * splash (drops in and lands in rippling water), pulse (beats and sends out waves),
	 * flip (flips over now and then) or still.
	 */
	static void animatedLogo(Canvas c, String style, int cx, int cy, int size, int cell, float t, float alpha) {
		float intro = easeOutCubic(clamp01(t / 0.6f));
		float a = alpha * intro;
		int dy = Math.round((1 - intro) * size * 0.4f);
		float sx = 1f;
		float sy = 1f;
		int ground = cy + Math.round(size * 1.25f);
		switch (style) {
			case "bounce" -> {
				float p = (t % 0.9f) / 0.9f;
				float up = 4 * p * (1 - p);
				float contact = Math.max(0f, 1f - Math.min(p, 1 - p) / 0.12f);
				dy += -Math.round(up * size * 0.9f) + Math.round(contact * size * 0.12f);
				sx = 1f + 0.18f * contact - 0.04f * up;
				sy = 1f - 0.2f * contact + 0.06f * up;
				shadow(c, cx, ground, size, 1f - up * 0.55f, a);
			}
			case "splash" -> {
				float fall = clamp01(t / 0.7f);
				a = alpha * clamp01(t / 0.25f);
				if (fall < 1f) {
					dy = -Math.round((1 - fall * fall) * size * 3.2f);
					sy = 1f + 0.12f * fall;
					sx = 1f - 0.06f * fall;
				} else {
					float k = t - 0.7f;
					float wob = (float) (Math.exp(-k * 6) * Math.sin(k * 26));
					sx = 1f + 0.2f * wob;
					sy = 1f - 0.2f * wob;
					dy = Math.round((float) Math.sin(Math.max(0, k - 0.6f) * Math.PI * 2 / 2.4) * size * 0.08f);
					splash(c, cx, ground - size / 4, size, cell, k, alpha);
				}
			}
			case "pulse" -> {
				float p = t % 1.3f;
				float beat = bump(p, 0.12f, 0.12f) + 0.7f * bump(p, 0.36f, 0.1f);
				sx = sy = 1f + 0.14f * beat;
				for (float start : new float[] {0.12f, 0.36f}) {
					float k = p - start;
					if (k < 0) k += 1.3f;
					if (k < 0.9f) wave(c, cx, cy + size / 6, size * (1.2f + k * 2.4f), size * (0.5f + k * 1.1f), cell, a * (1 - k / 0.9f) * 0.6f, 0x0);
				}
			}
			case "flip" -> {
				float p = (t % 2.2f) / 2.2f;
				if (p > 0.35f && p < 0.7f) {
					float k = (p - 0.35f) / 0.35f;
					sy = (float) Math.abs(Math.cos(Math.PI * easeInOut(k)));
					dy -= Math.round((float) Math.sin(Math.PI * k) * size * 0.6f);
				}
				shadow(c, cx, ground, size, 0.8f, a * 0.8f);
			}
			case "still" -> {
				logo(c, cx, cy + dy, size, cell, 1f, a, false, 1f, 1f);
				return;
			}
			default -> dy += Math.round((float) Math.sin(t * Math.PI * 2 / 2.4) * size * 0.08f);
		}
		logo(c, cx, cy + dy, size, cell, t, a, true, sx, sy);
	}

	/** A soft bump 0..1..0 centred on `at`, `width` seconds wide. */
	private static float bump(float x, float at, float width) {
		float d = Math.abs(x - at) / width;
		return d >= 1f ? 0f : (float) (0.5 + 0.5 * Math.cos(Math.PI * d));
	}

	private static float easeInOut(float k) {
		return k < 0.5f ? 2 * k * k : 1 - (float) Math.pow(-2 * k + 2, 2) / 2;
	}

	/** A dark ellipse on the ground under the logo. */
	private static void shadow(Canvas c, int cx, int y, int size, float scale, float alpha) {
		float rx = size * 0.95f * scale;
		float ry = size * 0.16f * Math.max(0.5f, scale);
		int step = Math.max(1, Math.round(ry / 3));
		for (int row = -Math.round(ry); row < Math.round(ry); row += step) {
			float k = (row + step / 2f) / ry;
			if (k * k >= 1f) continue;
			int half = Math.round(rx * (float) Math.sqrt(1 - k * k));
			c.rect(cx - half, y + row, cx + half, y + row + step, argb(0x000000, 0.22f * alpha));
		}
	}

	/** Landing in water: rings spreading out every couple of seconds, and a burst of drops at first. */
	private static void splash(Canvas c, int cx, int y, int size, int cell, float k, float alpha) {
		for (int i = 0; i < 3; i++) {
			float r = (k - i * 0.22f) % 2.4f;
			if (r < 0 || r > 1.4f) continue;
			float f = r / 1.4f;
			wave(c, cx, y, size * (0.9f + f * 2.6f), size * (0.25f + f * 0.7f), cell, alpha * (1 - f) * 0.8f, 0x0);
		}
		if (k < 0.9f) {
			for (int i = 0; i < 12; i++) {
				float vx = (hash(i * 5 + 1) - 0.5f) * size * 5f;
				float vy = -(0.9f + hash(i * 5 + 2)) * size * 3.4f;
				int x = cx + Math.round(vx * k);
				int yy = y + Math.round(vy * k + 9f * size * k * k);
				int s = Math.max(cell, Math.round(size / 10f));
				c.rect(x, yy, x + s, yy + s, argb(i % 3 == 0 ? RING_A : i % 3 == 1 ? RING_B : WHITE, alpha * (1 - k / 0.9f)));
			}
		}
	}

	/** A flat ellipse outline in pixels, for ripples and pulse waves. `rgb` 0 means the ring gradient. */
	private static void wave(Canvas c, int cx, int cy, float rx, float ry, int cell, float alpha, int rgb) {
		if (alpha <= 0.01f) return;
		int steps = Math.max(48, Math.round(rx * 6f / cell));
		int lastX = Integer.MIN_VALUE;
		int lastY = Integer.MIN_VALUE;
		for (int i = 0; i < steps; i++) {
			double ang = i * Math.PI * 2 / steps;
			int x = cx + Math.floorDiv((int) Math.round(Math.cos(ang) * rx), cell) * cell;
			int y = cy + Math.floorDiv((int) Math.round(Math.sin(ang) * ry), cell) * cell;
			if (x == lastX && y == lastY) continue;
			lastX = x;
			lastY = y;
			float along = (float) (Math.cos(ang) + 1) / 2;
			int col = rgb != 0 ? rgb : along < 0.5f ? mix(RING_A, RING_B, along * 2) : mix(RING_B, RING_C, along * 2 - 1);
			c.rect(x, y, x + cell, y + cell, argb(col, alpha));
		}
	}

	/** The Nimbus logo: the block inside its tilted halo ring, back half of the ring first. */
	static void logo(Canvas c, int cx, int cy, int size, int cell, float t, float alpha, boolean motion) {
		logo(c, cx, cy, size, cell, t, alpha, motion, 1f, 1f);
	}

	/** The logo squashed or stretched by sx and sy around its centre. */
	static void logo(Canvas c, int cx, int cy, int size, int cell, float t, float alpha, boolean motion, float sx, float sy) {
		ring(c, cx, cy, size, cell, t, alpha, false, motion, sx, sy);
		cube(c, cx, cy, size, cell, t, alpha, sx, sy);
		ring(c, cx, cy, size, cell, t, alpha, true, motion, sx, sy);
	}

	/**
	 * An isometric cube drawn as pixel art. Each cell is classified into the top,
	 * left or right face of the hexagon, so the look scales to any size.
	 */
	static void cube(Canvas c, int cx, int cy, int size, int cell, float t, float alpha) {
		cube(c, cx, cy, size, cell, t, alpha, 1f, 1f);
	}

	static void cube(Canvas c, int cx, int cy, int size, int cell, float t, float alpha, float sx, float sy) {
		float r3 = (float) Math.sqrt(3);
		int half = size;
		int halfW = Math.round(size * r3 / 2f);
		float shimmer = (float) ((t % 3.2f) / 3.2f) * 3f - 1f;
		for (int py = -half; py < half; py += cell) {
			for (int px = -halfW; px < halfW; px += cell) {
				float u = (px + cell / 2f) / size;
				float v = (py + cell / 2f) / size;
				float au = Math.abs(u);
				if (au > r3 / 2f || Math.abs(v) + au / r3 > 1f) continue;
				int col;
				if (v < -au / r3) {
					float band = 1 - Math.min(1, Math.abs((u + v) - shimmer) * 3f);
					col = mix(0xDDD1FF, WHITE, (-v - 0.2f) * 0.9f);
					// the lighter diamond in the middle of the top face
					if (au / (r3 / 2f) + Math.abs(v + 0.5f) / 0.5f <= 0.5f) col = mix(col, WHITE, 0.75f);
					col = mix(col, WHITE, band * 0.7f);
				} else if (u < 0) {
					col = mix(0xB69CFF, 0x7043F0, (v + 0.5f) / 1.5f);
				} else {
					col = mix(0x6D3DF0, 0x3A168F, (v + 0.5f) / 1.5f);
				}
				int x0 = cx + Math.round(px * sx);
				int y0 = cy + Math.round(py * sy);
				int x1 = cx + Math.round((px + cell) * sx);
				int y1 = cy + Math.round((py + cell) * sy);
				if (x1 > x0 && y1 > y0) c.rect(x0, y0, x1, y1, argb(col, alpha));
			}
		}
	}

	static final int RING_A = 0x22D3EE;
	static final int RING_B = 0xA78BFA;
	static final int RING_C = 0xF472B6;

	/**
	 * The halo: an ellipse tilted like the logo's, cyan to violet to pink, snapped to
	 * the pixel grid. A glint runs round it while `motion` is on.
	 */
	private static void ring(Canvas c, int cx, int cy, int size, int cell, float t, float alpha, boolean front, boolean motion, float sx, float sy) {
		float rx = size * 1.55f;
		float ry = size * 0.45f;
		int thick = Math.max(cell, Math.round(size * 0.2f / cell) * cell);
		double tilt = Math.toRadians(-16);
		double ct = Math.cos(tilt);
		double st = Math.sin(tilt);
		int oy = cy + Math.round(size * 0.1f);
		int steps = Math.max(64, Math.round(rx * 8f / cell));
		float glint = motion ? (t * 0.3f) % 1f : 0.62f;
		int lastX = Integer.MIN_VALUE;
		int lastY = Integer.MIN_VALUE;
		for (int i = 0; i < steps; i++) {
			double a = i * Math.PI * 2 / steps;
			double ex = Math.cos(a) * rx;
			double ey = Math.sin(a) * ry;
			if ((ey > 0) != front) continue;
			int x = cx + Math.floorDiv((int) Math.round((ex * ct - ey * st) * sx) - thick / 2, cell) * cell;
			int y = cy + Math.round((oy - cy) * sy) + Math.floorDiv((int) Math.round((ex * st + ey * ct) * sy) - thick / 2, cell) * cell;
			if (x == lastX && y == lastY) continue;
			lastX = x;
			lastY = y;
			float along = (float) (ex / rx + 1) / 2;
			int col = along < 0.5f ? mix(RING_A, RING_B, along * 2) : mix(RING_B, RING_C, along * 2 - 1);
			float d = Math.abs(i / (float) steps - glint);
			d = Math.min(d, 1 - d);
			col = mix(col, WHITE, Math.max(0, 1 - d * 16) * 0.85f);
			c.rect(x, y, x + thick, y + thick, argb(col, alpha * (front ? 1f : 0.8f)));
		}
	}

	/** Gradient text whose letters drop in one by one, with a light sweep running across. */
	private static void wordmark(Canvas c, String s, int x, int y, int cell, float t, float alpha) {
		int total = textWidth(s, cell, 1);
		float sweep = ((t % 2.6f) / 2.6f) * (total + 60) - 30;
		int cursor = x;
		for (int i = 0; i < s.length(); i++) {
			String[] g = glyph(s.charAt(i));
			float k = clamp01((t - 0.15f - i * 0.07f) / 0.45f);
			int dy = Math.round((1 - easeOutBack(k)) * cell * 4);
			float la = alpha * easeOutCubic(k);
			if (la > 0.01f) {
				for (int row = 0; row < g.length; row++) {
					for (int col = 0; col < g[row].length(); col++) {
						if (g[row].charAt(col) != '#') continue;
						int px = cursor + col * cell;
						float along = (px - x) / (float) Math.max(1, total);
						int base = mix(A1, A2, clamp01(along + 0.2f * (float) Math.sin(t * 1.3)));
						float glow = Math.max(0, 1 - Math.abs(px - x - sweep) / 18f) * 0.55f;
						c.rect(px, y + dy + row * cell, px + cell, y + dy + row * cell + cell, argb(mix(base, WHITE, glow), la));
					}
				}
			}
			cursor += (g[0].length() + 1) * cell;
		}
	}

	private static void bar(Canvas c, int x, int y, int w, int h, float p, float t, float alpha) {
		c.rect(x, y, x + w, y + h, argb(TRACK, alpha));
		int fill = Math.round(w * clamp01(p));
		if (fill <= 0) return;
		int segs = 24;
		for (int i = 0; i < segs; i++) {
			int a = x + fill * i / segs;
			int b = x + fill * (i + 1) / segs;
			if (b > a) c.rect(a, y, b, y + h, argb(mix(A1, A2, i / (float) segs), alpha));
		}
		// a highlight that keeps moving so the bar never looks frozen
		int travel = fill + 40;
		int hx = x - 20 + Math.round((t * 110) % travel);
		int ha = Math.max(x, hx);
		int hb = Math.min(x + fill, hx + 16);
		if (hb > ha) c.rect(ha, y, hb, y + h, argb(WHITE, 0.28f * alpha));
		c.rect(x + fill - 1, y - 1, x + fill + 1, y + h + 1, argb(WHITE, 0.85f * alpha));
	}

	// ------------------------------------------------------------------ pixel font

	/** Draws text in the 5x7 pixel font, merging lit cells on a row into one rectangle. */
	public static void text(Canvas c, String s, int x, int y, int cell, int tracking, int rgb, float alpha) {
		if (alpha <= 0.01f) return;
		int color = argb(rgb, alpha);
		int cursor = x;
		for (int i = 0; i < s.length(); i++) {
			String[] g = glyph(s.charAt(i));
			for (int row = 0; row < g.length; row++) {
				String line = g[row];
				int col = 0;
				while (col < line.length()) {
					if (line.charAt(col) != '#') { col++; continue; }
					int start = col;
					while (col < line.length() && line.charAt(col) == '#') col++;
					c.rect(cursor + start * cell, y + row * cell, cursor + col * cell, y + row * cell + cell, color);
				}
			}
			cursor += (g[0].length() + tracking) * cell;
		}
	}

	public static int textWidth(String s, int cell, int tracking) {
		int w = 0;
		for (int i = 0; i < s.length(); i++) w += (glyph(s.charAt(i))[0].length() + tracking) * cell;
		return Math.max(0, w - tracking * cell);
	}

	private static final Map<Character, String[]> FONT = new HashMap<>();

	private static void def(char ch, String... rows) {
		FONT.put(ch, rows);
	}

	static {
		def('A', ".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#");
		def('B', "####.", "#...#", "#...#", "####.", "#...#", "#...#", "####.");
		def('C', ".###.", "#...#", "#....", "#....", "#....", "#...#", ".###.");
		def('D', "####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####.");
		def('E', "#####", "#....", "#....", "####.", "#....", "#....", "#####");
		def('F', "#####", "#....", "#....", "####.", "#....", "#....", "#....");
		def('G', ".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####");
		def('H', "#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#");
		def('I', "###", ".#.", ".#.", ".#.", ".#.", ".#.", "###");
		def('J', "..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##..");
		def('K', "#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#");
		def('L', "#....", "#....", "#....", "#....", "#....", "#....", "#####");
		def('M', "#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#");
		def('N', "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#");
		def('O', ".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###.");
		def('P', "####.", "#...#", "#...#", "####.", "#....", "#....", "#....");
		def('Q', ".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#");
		def('R', "####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#");
		def('S', ".####", "#....", "#....", ".###.", "....#", "....#", "####.");
		def('T', "#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#..");
		def('U', "#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###.");
		def('V', "#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#..");
		def('W', "#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#");
		def('X', "#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#");
		def('Y', "#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#..");
		def('Z', "#####", "....#", "...#.", "..#..", ".#...", "#....", "#####");
		def('0', ".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###.");
		def('1', ".#.", "##.", ".#.", ".#.", ".#.", ".#.", "###");
		def('2', ".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####");
		def('3', "####.", "....#", "....#", ".###.", "....#", "....#", "####.");
		def('4', "...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#.");
		def('5', "#####", "#....", "####.", "....#", "....#", "#...#", ".###.");
		def('6', ".###.", "#....", "#....", "####.", "#...#", "#...#", ".###.");
		def('7', "#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#...");
		def('8', ".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###.");
		def('9', ".###.", "#...#", "#...#", ".####", "....#", "....#", ".###.");
		def('%', "##..#", "##..#", "...#.", "..#..", ".#...", "#..##", "#..##");
		def('.', ".", ".", ".", ".", ".", ".", "#");
		def(':', ".", "#", ".", ".", ".", "#", ".");
		def('-', "...", "...", "...", "###", "...", "...", "...");
		def('/', "....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#....");
		def('!', "#", "#", "#", "#", "#", ".", "#");
		def(' ', "..", "..", "..", "..", "..", "..", "..");
	}

	private static String[] glyph(char ch) {
		String[] g = FONT.get(Character.toUpperCase(ch));
		return g != null ? g : FONT.get(' ');
	}

	// ------------------------------------------------------------------ maths

	static int argb(int rgb, float a) {
		int alpha = Math.round(clamp01(a) * 255f);
		return (alpha << 24) | (rgb & 0xFFFFFF);
	}

	static int mix(int c1, int c2, float t) {
		t = clamp01(t);
		int r = Math.round(((c1 >> 16) & 255) * (1 - t) + ((c2 >> 16) & 255) * t);
		int g = Math.round(((c1 >> 8) & 255) * (1 - t) + ((c2 >> 8) & 255) * t);
		int b = Math.round((c1 & 255) * (1 - t) + (c2 & 255) * t);
		return (r << 16) | (g << 8) | b;
	}

	public static float clamp01(float v) {
		return v < 0 ? 0 : v > 1 ? 1 : v;
	}

	private static int clamp(int v, int lo, int hi) {
		return Math.max(lo, Math.min(hi, v));
	}

	static float easeOutCubic(float k) {
		float x = 1 - k;
		return 1 - x * x * x;
	}

	private static float easeOutBack(float k) {
		float c1 = 1.70158f;
		float c3 = c1 + 1;
		float x = k - 1;
		return 1 + c3 * x * x * x + c1 * x * x;
	}

	/** Stable pseudo-random 0..1 per index, so particles do not jump between frames. */
	private static float hash(int n) {
		int x = n * 0x27d4eb2d;
		x ^= x >>> 15;
		x *= 0x85ebca6b;
		x ^= x >>> 13;
		return (x & 0xFFFFFF) / (float) 0x1000000;
	}
}
