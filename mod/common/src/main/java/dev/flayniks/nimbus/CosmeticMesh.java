package dev.flayniks.nimbus;

/**
 * The cosmetics' quads for one frame, in three batches: solid (cutout), see-through, and glowing
 * (added on top, like spider eyes, for sparks and embers). Positions
 * are in blocks, relative to the camera; each Minecraft version's drawing code then feeds them to
 * the game (CosmeticsDraw), so everything above this is version-free.
 */
public final class CosmeticMesh {
	public static final int FULL_BRIGHT = 0xF000F0;
	public static final int SOLID = 0;
	public static final int SEE = 1;
	public static final int GLOW = 2;

	/** x, y, z, nx, ny, nz per vertex. */
	public float[][] pos = {new float[4096], new float[1024], new float[1024]};
	/** colour (ARGB) and light per vertex. */
	public int[][] col = {new int[1366], new int[342], new int[342]};
	public final int[] count = {0, 0, 0};

	public void clear() {
		count[0] = 0;
		count[1] = 0;
		count[2] = 0;
	}

	public boolean isEmpty() {
		return count[0] == 0 && count[1] == 0 && count[2] == 0;
	}

	public void vertex(int b, float x, float y, float z, int argb, int light, float nx, float ny, float nz) {
		int i = count[b];
		if ((i + 1) * 6 > pos[b].length) {
			pos[b] = java.util.Arrays.copyOf(pos[b], pos[b].length * 2);
			col[b] = java.util.Arrays.copyOf(col[b], col[b].length * 2);
		}
		if ((i + 1) * 2 > col[b].length) col[b] = java.util.Arrays.copyOf(col[b], Math.max(col[b].length * 2, (i + 1) * 2));
		float[] p = pos[b];
		p[i * 6] = x;
		p[i * 6 + 1] = y;
		p[i * 6 + 2] = z;
		p[i * 6 + 3] = nx;
		p[i * 6 + 4] = ny;
		p[i * 6 + 5] = nz;
		col[b][i * 2] = argb;
		col[b][i * 2 + 1] = light;
		count[b] = i + 1;
	}
}
