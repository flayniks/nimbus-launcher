package dev.flayniks.nimbus;

/**
 * The only drawing call Nimbus needs: a filled rectangle in GUI units.
 * Each Minecraft version wraps its own GUI class in one of these, so the
 * art itself never touches version-specific APIs.
 */
public interface Canvas {
	int width();

	int height();

	/** Fills [x1, x2) x [y1, y2) with an ARGB colour. */
	void rect(int x1, int y1, int x2, int y2, int argb);

	/** Minecraft's own font; only available once the game has loaded its resources. */
	default void text(String s, int x, int y, int argb, boolean shadow) {
	}

	default int textWidth(String s) {
		return s.length() * 6;
	}

	/** Moves the origin to (x, y) and scales everything drawn until pop(). */
	default void push(float x, float y, float scale) {
	}

	default void pop() {
	}
}
