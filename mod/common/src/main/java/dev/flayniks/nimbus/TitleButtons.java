package dev.flayniks.nimbus;

import java.util.List;

/**
 * Where the Nimbus buttons go on the title screen: a column in the top-left corner under
 * the Nimbus badge, clear of the Minecraft logo and of anything other mods put there.
 * When the screen is too narrow for the full buttons beside the logo, they become small
 * icon buttons (with tooltips).
 */
public final class TitleButtons {
	private TitleButtons() {
	}

	public static final int FULL_W = 98;
	public static final int ICON_W = 20;
	public static final int H = 20;

	/**
	 * @param taken widgets already on the screen, as {x, y, w, h}
	 * @return {x, first y, second y, width}
	 */
	public static int[] place(int width, int height, List<int[]> taken) {
		// the Minecraft logo is 256 wide, centred, from y 30 down to about 88
		int logoLeft = width / 2 - 132;
		int w = logoLeft >= 6 + FULL_W + 4 ? FULL_W : ICON_W;
		int x = 6;
		for (int y = 28; y + H + 24 <= height - 14; y += 24) {
			if (free(x, y, w, taken) && free(x, y + 24, w, taken)) return new int[] {x, y, y + 24, w};
		}
		return new int[] {x, 28, 52, w};
	}

	private static boolean free(int x, int y, int w, List<int[]> taken) {
		for (int[] r : taken) {
			if (x < r[0] + r[2] && r[0] < x + w && y < r[1] + r[3] && r[1] < y + H) return false;
		}
		return true;
	}
}
