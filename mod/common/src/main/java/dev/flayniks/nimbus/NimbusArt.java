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

	// ------------------------------------------------------------------ loading screen

	/**
	 * @param progress 0..1, Minecraft's smoothed reload progress
	 * @param alpha    overall opacity of the overlay (fades in and out with vanilla's)
	 * @param barAlpha opacity of the progress bar, which fades out first
	 * @param opaque   paint the background too (vanilla's is hidden underneath)
	 * @param millis   time since this loading screen appeared
	 */
	public static void loading(Canvas c, float progress, float alpha, float barAlpha, boolean opaque, long millis) {
		if (alpha <= 0.01f) return;
		int w = c.width();
		int h = c.height();
		float t = millis / 1000f;

		if (opaque) c.rect(0, 0, w, h, argb(BG, 1f));
		backdrop(c, w, h, t, alpha);

		int size = clamp(Math.round(h * 0.11f), 14, 44);
		int cell = Math.max(1, Math.round(size / 8f));
		int cx = w / 2;
		int cy = Math.round(h * 0.36f);
		float intro = easeOutCubic(clamp01(t / 0.6f));
		int bob = Math.round((float) Math.sin(t * Math.PI * 2 / 2.4) * size * 0.08f);
		cube(c, cx, cy + bob + Math.round((1 - intro) * size * 0.4f), size, cell, t, alpha * intro, true);

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

	/** The corner badge on the title screen. */
	public static void badge(Canvas c, long millis) {
		float t = millis / 1000f;
		float a = easeOutCubic(clamp01((t - 0.2f) / 0.8f));
		if (a <= 0.01f) return;
		int slide = Math.round((1 - a) * -8);
		int x = 6 + slide;
		int y = 6;
		cube(c, x + 7, y + 8, 8, 1, t, a, false);
		wordmark(c, "NIMBUS", x + 18, y, 1, t + 10, a);
		text(c, "LAUNCHER", x + 18, y + 9, 1, 1, MUTED, a * 0.9f);
	}

	// ------------------------------------------------------------------ pieces

	private static void backdrop(Canvas c, int w, int h, float t, float alpha) {
		// soft glow behind the logo: nested ellipses drawn a row at a time, so the edges stay round
		int gx = w / 2;
		int gy = Math.round(h * 0.4f);
		float pulse = 1f + 0.04f * (float) Math.sin(t * 1.6f);
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
		for (int i = 0; i < 28; i++) {
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
	 * An isometric cube drawn as pixel art. Each cell is classified into the top,
	 * left or right face of the hexagon, so the look scales to any size.
	 */
	private static void cube(Canvas c, int cx, int cy, int size, int cell, float t, float alpha, boolean orbit) {
		if (orbit) orbiters(c, cx, cy, size, t, alpha, false);
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
					col = mix(0xE9E3FF, WHITE, band * 0.8f);
				} else if (u < 0) {
					col = mix(0xB9A5FF, 0x9A7BF7, (v + 0.5f) / 1.5f);
				} else {
					col = mix(0x8B6CFF, 0x5F43D9, (v + 0.5f) / 1.5f);
				}
				c.rect(cx + px, cy + py, cx + px + cell, cy + py + cell, argb(col, alpha));
			}
		}
		if (orbit) orbiters(c, cx, cy, size, t, alpha, true);
	}

	/** Little squares circling the cube; the ones behind are drawn before it. */
	private static void orbiters(Canvas c, int cx, int cy, int size, float t, float alpha, boolean front) {
		for (int i = 0; i < 5; i++) {
			double ang = t * 1.4 + i * Math.PI * 2 / 5;
			boolean isFront = Math.sin(ang) > 0;
			if (isFront != front) continue;
			int x = cx + (int) Math.round(Math.cos(ang) * size * 1.7);
			int y = cy + (int) Math.round(Math.sin(ang) * size * 0.45) + size / 4;
			int s = isFront ? 3 : 2;
			float a = (isFront ? 0.9f : 0.4f) * alpha;
			c.rect(x - s / 2, y - s / 2, x - s / 2 + s, y - s / 2 + s, argb(i % 2 == 0 ? A2 : A1, a));
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

	private static float easeOutCubic(float k) {
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
