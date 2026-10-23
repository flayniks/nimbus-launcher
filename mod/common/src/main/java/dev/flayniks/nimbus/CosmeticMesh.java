package dev.flayniks.nimbus;

/**
 * The cosmetics' quads for one frame, in batches: solid (cutout), see-through, glowing (added on
 * top, like spider eyes, for sparks and embers), and from 3 on one batch per picture the smooth
 * shapes of player models wear (assets/nimbus/textures/models/<name>.png). Positions are in blocks,
 * relative to the camera; each Minecraft version's drawing code then feeds them to the game
 * (CosmeticsDraw), so everything above this is version-free.
 */
public final class CosmeticMesh {
	public static final int FULL_BRIGHT = 0xF000F0;
	public static final int SOLID = 0;
	public static final int SEE = 1;
	public static final int GLOW = 2;
	public static final int MAX = 24;

	/** x, y, z, nx, ny, nz per vertex. */
	public float[][] pos = new float[MAX][];
	/** u, v per vertex (the middle of the plain white texture for the first three batches). */
	public float[][] uv = new float[MAX][];
	/** colour (ARGB) and light per vertex. */
	public int[][] col = new int[MAX][];
	public final int[] count = new int[MAX];
	/** The picture each batch from 3 on is drawn with. */
	public final String[] tex = new String[MAX];
	/** How many batches are in use (3 plus one per picture). */
	public int batches = 3;

	public CosmeticMesh() {
		for (int b = 0; b < MAX; b++) {
			pos[b] = new float[b == 0 ? 4096 : 1024];
			uv[b] = new float[pos[b].length / 3];
			col[b] = new int[pos[b].length / 3];
		}
	}

	public void clear() {
		for (int b = 0; b < batches; b++) count[b] = 0;
		batches = 3;
	}

	public boolean isEmpty() {
		for (int b = 0; b < batches; b++) if (count[b] > 0) return false;
		return true;
	}

	/** The batch for a picture (solid if there are too many pictures in one frame). */
	public int textured(String name) {
		for (int b = 3; b < batches; b++) if (name.equals(tex[b])) return b;
		if (batches >= MAX) return SOLID;
		tex[batches] = name;
		count[batches] = 0;
		return batches++;
	}

	public void vertex(int b, float x, float y, float z, int argb, int light, float nx, float ny, float nz) {
		vertex(b, x, y, z, 0.5f, 0.5f, argb, light, nx, ny, nz);
	}

	public void vertex(int b, float x, float y, float z, float u, float v, int argb, int light, float nx, float ny, float nz) {
		int i = count[b];
		if ((i + 1) * 6 > pos[b].length) pos[b] = java.util.Arrays.copyOf(pos[b], Math.max(pos[b].length * 2, (i + 1) * 6));
		if ((i + 1) * 2 > uv[b].length) uv[b] = java.util.Arrays.copyOf(uv[b], Math.max(uv[b].length * 2, (i + 1) * 2));
		if ((i + 1) * 2 > col[b].length) col[b] = java.util.Arrays.copyOf(col[b], Math.max(col[b].length * 2, (i + 1) * 2));
		float[] p = pos[b];
		p[i * 6] = x;
		p[i * 6 + 1] = y;
		p[i * 6 + 2] = z;
		p[i * 6 + 3] = nx;
		p[i * 6 + 4] = ny;
		p[i * 6 + 5] = nz;
		uv[b][i * 2] = u;
		uv[b][i * 2 + 1] = v;
		col[b][i * 2] = argb;
		col[b][i * 2 + 1] = light;
		count[b] = i + 1;
	}
}
