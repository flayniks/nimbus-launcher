package dev.flayniks.nimbus;

/**
 * Flat player previews painted pixel by pixel from the skin image, so they look
 * the same in every Minecraft version without touching its texture code.
 */
public final class SkinArt {
	private SkinArt() {
	}

	/**
	 * A 16x32 (skin pixels) front or back view with its top-left at (x, y).
	 * The cape, when given, hangs on the back.
	 */
	public static void player(Canvas c, Png skin, boolean slim, boolean back, Png cape, int x, int y, int s, float alpha) {
		if (skin == null || alpha <= 0.01f) return;
		boolean legacy = skin.height == 32;
		int a = slim ? 3 : 4; // arm width
		if (!back) {
			face(c, skin, 8, 8, 8, 8, x + 4 * s, y, s, false, false, alpha);
			face(c, skin, 20, 20, 8, 12, x + 4 * s, y + 8 * s, s, false, false, alpha);
			face(c, skin, 44, 20, a, 12, x + (4 - a) * s, y + 8 * s, s, false, false, alpha);
			if (legacy) face(c, skin, 44, 20, a, 12, x + 12 * s, y + 8 * s, s, true, false, alpha);
			else face(c, skin, 36, 52, a, 12, x + 12 * s, y + 8 * s, s, false, false, alpha);
			face(c, skin, 4, 20, 4, 12, x + 4 * s, y + 20 * s, s, false, false, alpha);
			if (legacy) face(c, skin, 4, 20, 4, 12, x + 8 * s, y + 20 * s, s, true, false, alpha);
			else face(c, skin, 20, 52, 4, 12, x + 8 * s, y + 20 * s, s, false, false, alpha);

			if (!legacy || !opaqueHat(skin)) face(c, skin, 40, 8, 8, 8, x + 4 * s, y, s, false, true, alpha);
			if (!legacy) {
				face(c, skin, 20, 36, 8, 12, x + 4 * s, y + 8 * s, s, false, true, alpha);
				face(c, skin, 44, 36, a, 12, x + (4 - a) * s, y + 8 * s, s, false, true, alpha);
				face(c, skin, 52, 52, a, 12, x + 12 * s, y + 8 * s, s, false, true, alpha);
				face(c, skin, 4, 36, 4, 12, x + 4 * s, y + 20 * s, s, false, true, alpha);
				face(c, skin, 4, 52, 4, 12, x + 8 * s, y + 20 * s, s, false, true, alpha);
			}
			return;
		}
		// seen from behind, the player's left side is on the viewer's left
		face(c, skin, 24, 8, 8, 8, x + 4 * s, y, s, false, false, alpha);
		face(c, skin, 32, 20, 8, 12, x + 4 * s, y + 8 * s, s, false, false, alpha);
		if (legacy) face(c, skin, 48 + a, 20, a, 12, x + (4 - a) * s, y + 8 * s, s, true, false, alpha);
		else face(c, skin, 40 + a, 52, a, 12, x + (4 - a) * s, y + 8 * s, s, false, false, alpha);
		face(c, skin, 48 + a, 20, a, 12, x + 12 * s, y + 8 * s, s, false, false, alpha);
		if (legacy) face(c, skin, 12, 20, 4, 12, x + 4 * s, y + 20 * s, s, true, false, alpha);
		else face(c, skin, 28, 52, 4, 12, x + 4 * s, y + 20 * s, s, false, false, alpha);
		face(c, skin, 12, 20, 4, 12, x + 8 * s, y + 20 * s, s, false, false, alpha);

		if (!legacy || !opaqueHat(skin)) face(c, skin, 56, 8, 8, 8, x + 4 * s, y, s, false, true, alpha);
		if (!legacy) {
			face(c, skin, 32, 36, 8, 12, x + 4 * s, y + 8 * s, s, false, true, alpha);
			face(c, skin, 56 + a, 52, a, 12, x + (4 - a) * s, y + 8 * s, s, false, true, alpha);
			face(c, skin, 48 + a, 36, a, 12, x + 12 * s, y + 8 * s, s, false, true, alpha);
			face(c, skin, 12, 52, 4, 12, x + 4 * s, y + 20 * s, s, false, true, alpha);
			face(c, skin, 12, 36, 4, 12, x + 8 * s, y + 20 * s, s, false, true, alpha);
		}
		if (cape != null) capeFace(c, cape, x + 3 * s, y + 8 * s, s, alpha);
	}

	/** The outside of a cape, 10x16 cape pixels. */
	public static void capeFace(Canvas c, Png cape, int x, int y, int s, float alpha) {
		int k = Math.max(1, cape.width / 64);
		for (int row = 0; row < 16; row++) {
			int runStart = 0;
			int runColor = 0;
			for (int col = 0; col <= 10; col++) {
				int color = col < 10 ? solid(cape.get((1 + col) * k, (1 + row) * k), false, alpha) : 0;
				if (col == 10 || color != runColor) {
					if (col > runStart && runColor != 0) c.rect(x + runStart * s, y + row * s, x + col * s, y + (row + 1) * s, runColor);
					runStart = col;
					runColor = color;
				}
			}
		}
	}

	/** Paints one face of a body part, merging same-coloured runs so a doll costs a few hundred rectangles. */
	private static void face(Canvas c, Png img, int sx, int sy, int w, int h, int dx, int dy, int s, boolean mirror, boolean overlay, float alpha) {
		for (int row = 0; row < h; row++) {
			int runStart = 0;
			int runColor = 0;
			for (int col = 0; col <= w; col++) {
				int color = 0;
				if (col < w) color = solid(img.get(mirror ? sx + w - 1 - col : sx + col, sy + row), overlay, alpha);
				if (col == w || color != runColor) {
					if (col > runStart && runColor != 0) c.rect(dx + runStart * s, dy + row * s, dx + col * s, dy + (row + 1) * s, runColor);
					runStart = col;
					runColor = color;
				}
			}
		}
	}

	/** Minecraft draws skin pixels either fully or not at all; 0 means "skip". */
	private static int solid(int argb, boolean overlay, float alpha) {
		int a = argb >>> 24;
		if (a == 0 || (overlay && a < 26)) return 0;
		int out = Math.round(255 * alpha);
		return out <= 0 ? 0 : (out << 24) | (argb & 0xFFFFFF);
	}

	/** Old skins often fill the hat layer with a solid colour meaning "no hat" (vanilla ignores it too). */
	private static boolean opaqueHat(Png skin) {
		for (int y = 0; y < 16; y++) {
			for (int x = 32; x < 64; x++) if ((skin.get(x, y) >>> 24) < 255) return false;
		}
		return true;
	}

	/** Slim (Alex) skins leave the outermost arm column empty. */
	public static boolean looksSlim(Png skin) {
		if (skin.height == 32) return false;
		for (int y = 20; y < 32; y++) {
			for (int x = 54; x < 56; x++) if ((skin.get(x, y) >>> 24) != 0) return false;
		}
		return true;
	}
}
