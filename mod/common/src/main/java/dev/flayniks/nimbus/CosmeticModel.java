package dev.flayniks.nimbus;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import org.joml.Matrix4f;
import org.joml.Vector3f;

/**
 * The cosmetics as built by tools/cosmetics (assets/nimbus/cosmetics.json): parts made of boxes,
 * with animations. The maths here matches the launcher's previews (src/renderer/js/cosmetics3d.js)
 * so a hat moves the same in both places. Units are pixels, 1/16 of a block.
 */
final class CosmeticModel {
	private CosmeticModel() {
	}

	static final int GLOW = 1;
	static final int SEE = 2;
	static final int RAINBOW = 4;
	static final int FLICKER = 8;

	static final class Anim {
		String t;
		char ax = 'y';
		float sp;
		float amp;
		float ph;
		float r;
		float h;
		float every = 1;
		float dur;
	}

	static final class Part {
		float px;
		float py;
		float pz;
		float[] rot;
		float s = 1f;
		Anim[] anims = new Anim[0];
		float[] box = new float[0]; // x, y, z, w, h, d per box
		int[] colour = new int[0];
		int[] flags = new int[0];
		int[] faces = new int[0];
		Part[] children = new Part[0];
	}

	static final class Fx {
		String k;
		float[] at;
		float rate;
		float[] v;
		float sp;
		float life;
		float g;
		float sz;
		int[] c;
		boolean solid;
	}

	static final class Item {
		String id;
		String slot;
		Part[] parts;
		Fx[] fx;
	}

	private static Map<String, Item> items;

	/** Every cosmetic by id; read from the jar the first time it's asked for. */
	static synchronized Map<String, Item> items() {
		if (items != null) return items;
		Map<String, Item> out = new HashMap<>();
		try (InputStream in = CosmeticModel.class.getResourceAsStream("/assets/nimbus/cosmetics.json")) {
			if (in != null) {
				JsonObject root = JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject();
				for (JsonElement e : root.getAsJsonArray("items")) {
					Item item = item(e.getAsJsonObject());
					out.put(item.id, item);
				}
			}
		} catch (Exception ignored) {
			// no cosmetics then
		}
		items = out;
		return out;
	}

	private static Item item(JsonObject o) {
		Item it = new Item();
		it.id = o.get("id").getAsString();
		it.slot = o.get("slot").getAsString();
		JsonArray parts = o.getAsJsonArray("parts");
		it.parts = new Part[parts.size()];
		for (int i = 0; i < parts.size(); i++) it.parts[i] = part(parts.get(i).getAsJsonObject());
		JsonArray fx = o.has("fx") ? o.getAsJsonArray("fx") : new JsonArray();
		it.fx = new Fx[fx.size()];
		for (int i = 0; i < fx.size(); i++) {
			JsonObject f = fx.get(i).getAsJsonObject();
			Fx x = new Fx();
			x.k = f.get("k").getAsString();
			x.at = floats(f.getAsJsonArray("at"));
			x.rate = f.get("rate").getAsFloat();
			x.v = floats(f.getAsJsonArray("v"));
			x.sp = f.get("sp").getAsFloat();
			x.life = f.get("life").getAsFloat();
			x.g = f.get("g").getAsFloat();
			x.sz = f.get("sz").getAsFloat();
			JsonArray cs = f.getAsJsonArray("c");
			x.c = new int[cs.size()];
			for (int k = 0; k < cs.size(); k++) x.c[k] = (int) cs.get(k).getAsLong();
			x.solid = f.has("solid");
			it.fx[i] = x;
		}
		return it;
	}

	private static Part part(JsonObject o) {
		Part p = new Part();
		float[] pivot = floats(o.getAsJsonArray("p"));
		p.px = pivot[0];
		p.py = pivot[1];
		p.pz = pivot[2];
		if (o.has("r")) p.rot = floats(o.getAsJsonArray("r"));
		if (o.has("s")) p.s = o.get("s").getAsFloat();
		if (o.has("a")) {
			JsonArray as = o.getAsJsonArray("a");
			p.anims = new Anim[as.size()];
			for (int i = 0; i < as.size(); i++) {
				JsonObject a = as.get(i).getAsJsonObject();
				Anim x = new Anim();
				x.t = a.get("t").getAsString();
				if (a.has("ax")) x.ax = a.get("ax").getAsString().charAt(0);
				x.sp = num(a, "sp");
				x.amp = num(a, "amp");
				x.ph = num(a, "ph");
				x.r = num(a, "r");
				x.h = num(a, "h");
				x.every = a.has("every") ? a.get("every").getAsFloat() : 1f;
				x.dur = num(a, "dur");
				p.anims[i] = x;
			}
		}
		if (o.has("b")) {
			JsonArray bs = o.getAsJsonArray("b");
			int n = bs.size();
			p.box = new float[n * 6];
			p.colour = new int[n];
			p.flags = new int[n];
			p.faces = new int[n];
			for (int i = 0; i < n; i++) {
				JsonArray b = bs.get(i).getAsJsonArray();
				for (int k = 0; k < 6; k++) p.box[i * 6 + k] = b.get(k).getAsFloat();
				p.colour[i] = (int) b.get(6).getAsLong();
				p.flags[i] = b.get(7).getAsInt();
				p.faces[i] = b.size() > 8 ? b.get(8).getAsInt() : 63;
			}
		}
		if (o.has("c")) {
			JsonArray cs = o.getAsJsonArray("c");
			p.children = new Part[cs.size()];
			for (int i = 0; i < cs.size(); i++) p.children[i] = part(cs.get(i).getAsJsonObject());
		}
		return p;
	}

	private static float num(JsonObject o, String k) {
		return o.has(k) ? o.get(k).getAsFloat() : 0f;
	}

	private static float[] floats(JsonArray a) {
		float[] out = new float[a.size()];
		for (int i = 0; i < out.length; i++) out[i] = a.get(i).getAsFloat();
		return out;
	}

	// ------------------------------------------------------------------ animation

	private static final float TAU = (float) (Math.PI * 2);
	private static final float D2R = (float) (Math.PI / 180);

	private static void rotate(Matrix4f m, char ax, float deg) {
		if (deg == 0f) return;
		float rad = deg * D2R;
		if (ax == 'x') m.rotateX(rad);
		else if (ax == 'z') m.rotateZ(rad);
		else m.rotateY(rad);
	}

	private static float wave(float sp, float ph, float t) {
		return (float) Math.sin(TAU * (sp * t + ph));
	}

	private static float mod(float a, float b) {
		float r = a % b;
		return r < 0 ? r + b : r;
	}

	static void animate(Matrix4f m, Anim a, float t) {
		switch (a.t) {
			case "spin" -> rotate(m, a.ax, a.sp * t + a.ph);
			case "sway" -> rotate(m, a.ax, a.amp * wave(a.sp, a.ph, t));
			case "flap" -> {
				float s = wave(a.sp, a.ph, t);
				rotate(m, a.ax, a.amp * (0.5f + 0.5f * Math.signum(s) * (float) Math.pow(Math.abs(s), 0.7)));
			}
			case "bob" -> {
				float d = a.amp * wave(a.sp, a.ph, t);
				if (a.ax == 'x') m.translate(d, 0, 0);
				else if (a.ax == 'z') m.translate(0, 0, d);
				else m.translate(0, d, 0);
			}
			case "orbit" -> {
				float ang = (a.sp * t + a.ph) * D2R;
				float c = (float) Math.cos(ang) * a.r;
				float s = (float) Math.sin(ang) * a.r;
				if (a.ax == 'x') m.translate(0, c, s);
				else if (a.ax == 'z') m.translate(c, s, 0);
				else m.translate(c, 0, s);
			}
			case "pulse" -> {
				float k = 1 + a.amp * wave(a.sp, a.ph, t);
				m.scale(k);
			}
			case "hop" -> {
				float u = mod(a.sp * t + a.ph, 1f);
				float k = (float) Math.sin(Math.PI * u);
				m.translate(0, a.h * k, 0);
				float sy = 0.88f + 0.17f * k;
				float sxz = (float) (1 / Math.sqrt(sy));
				m.scale(sxz, sy, sxz);
			}
			case "trick" -> {
				float u = mod(t + a.ph, a.every);
				if (u < a.dur) {
					float k = u / a.dur;
					float e = k < 0.5f ? 2 * k * k : 1 - (float) Math.pow(-2 * k + 2, 2) / 2;
					rotate(m, a.ax, 360 * e);
				}
			}
			case "twitch" -> {
				float u = mod(t + a.ph, a.every);
				if (u < a.dur) rotate(m, a.ax, a.amp * (float) Math.sin(Math.PI * (u / a.dur)));
			}
			default -> {
			}
		}
	}

	static void partMatrix(Matrix4f m, Part p, float t) {
		m.translate(p.px, p.py, p.pz);
		if (p.rot != null) {
			rotate(m, 'x', p.rot[0]);
			rotate(m, 'y', p.rot[1]);
			rotate(m, 'z', p.rot[2]);
		}
		for (Anim a : p.anims) animate(m, a, t);
		if (p.s != 1f) m.scale(p.s);
	}

	// ------------------------------------------------------------------ colours

	/** A box's colour right now, as ARGB. */
	static int colour(int c, int flags, float t, float x, float y, float z) {
		int a = (flags & SEE) != 0 ? (c >>> 24 == 0 ? 255 : c >>> 24) : 255;
		float r = ((c >> 16) & 255) / 255f;
		float g = ((c >> 8) & 255) / 255f;
		float b = (c & 255) / 255f;
		if ((flags & RAINBOW) != 0) {
			float[] rgb = hueShift(r, g, b, t, x, y, z);
			r = rgb[0];
			g = rgb[1];
			b = rgb[2];
		}
		if ((flags & FLICKER) != 0) {
			float f = 0.7f + 0.3f * (float) Math.sin(t * 7 + x * 1.3f + y * 0.7f + z * 1.1f);
			r *= f;
			g *= f;
			b *= f;
		}
		return (a << 24) | (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
	}

	private static float[] hueShift(float r, float g, float b, float t, float x, float y, float z) {
		float max = Math.max(r, Math.max(g, b));
		float min = Math.min(r, Math.min(g, b));
		float l = (max + min) / 2;
		float s = max == min ? 0 : l > 0.5f ? (max - min) / (2 - max - min) : (max - min) / (max + min);
		float h = 0;
		if (max != min) {
			if (max == r) h = (g - b) / (max - min) + (g < b ? 6 : 0);
			else if (max == g) h = (b - r) / (max - min) + 2;
			else h = (r - g) / (max - min) + 4;
			h /= 6;
		}
		if (s < 0.3f) s = 0.8f;
		h = mod(h + t * 0.25f + (x + y + z) * 0.02f, 1f);
		float q = l < 0.5f ? l * (1 + s) : l + s - l * s;
		float p = 2 * l - q;
		return new float[] {hue(p, q, h + 1 / 3f), hue(p, q, h), hue(p, q, h - 1 / 3f)};
	}

	private static float hue(float p, float q, float t) {
		t = mod(t, 1f);
		if (t < 1 / 6f) return p + (q - p) * 6 * t;
		if (t < 1 / 2f) return q;
		if (t < 2 / 3f) return p + (q - p) * (2 / 3f - t) * 6;
		return p;
	}

	// ------------------------------------------------------------------ geometry

	// faces: -x +x -y +y -z +z; four corners each (0/1 along each axis) and a normal
	static final float[][] CORNERS = {
		{0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0},
		{1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1},
		{0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1},
		{0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0},
		{1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0},
		{0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1},
	};
	static final float[][] NORMALS = {{-1, 0, 0}, {1, 0, 0}, {0, -1, 0}, {0, 1, 0}, {0, 0, -1}, {0, 0, 1}};

	/** Adds a part and its children, transformed by `parent`, to the mesh. */
	static void emit(Part p, Matrix4f parent, float t, int light, CosmeticMesh mesh) {
		Matrix4f m = new Matrix4f(parent);
		partMatrix(m, p, t);
		Vector3f v = new Vector3f();
		Vector3f n = new Vector3f();
		int count = p.colour.length;
		for (int i = 0; i < count; i++) {
			float x = p.box[i * 6];
			float y = p.box[i * 6 + 1];
			float z = p.box[i * 6 + 2];
			float w = p.box[i * 6 + 3];
			float h = p.box[i * 6 + 4];
			float d = p.box[i * 6 + 5];
			int flags = p.flags[i];
			int argb = colour(p.colour[i], flags, t, x, y, z);
			int batch = (flags & SEE) != 0 ? CosmeticMesh.SEE : CosmeticMesh.SOLID;
			int l = (flags & GLOW) != 0 ? CosmeticMesh.FULL_BRIGHT : light;
			int faces = p.faces[i];
			for (int f = 0; f < 6; f++) {
				if ((faces & (1 << f)) == 0) continue;
				m.transformDirection(n.set(NORMALS[f][0], NORMALS[f][1], NORMALS[f][2])).normalize();
				float[] c = CORNERS[f];
				for (int k = 0; k < 4; k++) {
					m.transformPosition(v.set(x + c[k * 3] * w, y + c[k * 3 + 1] * h, z + c[k * 3 + 2] * d));
					mesh.vertex(batch, v.x, v.y, v.z, argb, l, n.x, n.y, n.z);
				}
			}
		}
		for (Part c : p.children) emit(c, m, t, light, mesh);
	}
}
