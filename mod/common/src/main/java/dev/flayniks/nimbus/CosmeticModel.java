package dev.flayniks.nimbus;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
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

	/** How a player model's parts follow the player (see Cosmetics.pose). */
	static final String[] ROLES = {"head", "look", "body", "armL", "armR", "legL", "legR", "tail", "hop", "lean"};

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
		Shape[] shapes = new Shape[0];
		Part[] children = new Part[0];
		int role = -1;
		// shown only in this form / with this face / with the power on (1) or off (0); -1 any
		int wf = -1;
		int we = -1;
		int wp = -1;
	}

	/** A smooth shape (a ball, a tube or a sculpted mesh) as quads: x, y, z, nx, ny, nz, u, v per vertex. */
	static final class Shape {
		float[] v;
		int[] rgb; // a colour per vertex (meshes), or null for one colour
		int colour;
		int flags;
		String tex;
	}

	/** A player model's powers: its forms, faces and power, and its height in each form. */
	static final class Model {
		float[] h = {32};
		String[] forms = new String[0];
		String[] faces = new String[0];
		String power;

		boolean powers() {
			return forms.length > 1 || faces.length > 1 || power != null;
		}

		float height(int form) {
			return h[Math.max(0, Math.min(form, h.length - 1))];
		}
	}

	/** Where the player looks, how they walk; see role(). */
	static final class Pose {
		float yaw;
		float pitch;
		float walk;
		float speed;
		float attack;
		boolean crouch;
	}

	/** A model's form, face and power, and the form it had before (for the change between). */
	static final class State {
		int form;
		int face;
		boolean power;
		int prev = -1;
		float changed = -99f;
	}

	/** While a model changes form: which form shows, and how it's moved and scaled. */
	static final class Trans {
		int show;
		float scale = 1f;
		float dx;
		float dz;
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
		int wf = -1;
		int we = -1;
		int wp = -1;
	}

	static final class Item {
		String id;
		String name;
		String slot;
		Part[] parts;
		Fx[] fx;
		Model model;
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
		it.name = o.has("name") ? o.get("name").getAsString() : it.id;
		it.slot = o.get("slot").getAsString();
		if (o.has("m")) {
			JsonObject m = o.getAsJsonObject("m");
			Model model = new Model();
			if (m.has("h")) model.h = floats(m.getAsJsonArray("h"));
			if (m.has("forms")) model.forms = strings(m.getAsJsonArray("forms"));
			if (m.has("faces")) model.faces = strings(m.getAsJsonArray("faces"));
			if (m.has("power")) model.power = m.get("power").getAsString();
			it.model = model;
		}
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
			if (f.has("w")) {
				int[] w = ints(f.getAsJsonArray("w"));
				x.wf = w[0];
				x.we = w[1];
				x.wp = w[2];
			}
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
		if (o.has("k")) {
			String k = o.get("k").getAsString();
			for (int i = 0; i < ROLES.length; i++) if (ROLES[i].equals(k)) p.role = i;
		}
		if (o.has("w")) {
			int[] w = ints(o.getAsJsonArray("w"));
			p.wf = w[0];
			p.we = w[1];
			p.wp = w[2];
		}
		if (o.has("g")) {
			JsonArray gs = o.getAsJsonArray("g");
			p.shapes = new Shape[gs.size()];
			for (int i = 0; i < gs.size(); i++) p.shapes[i] = shape(gs.get(i).getAsJsonObject());
		}
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

	private static String[] strings(JsonArray a) {
		String[] out = new String[a.size()];
		for (int i = 0; i < out.length; i++) out[i] = a.get(i).getAsString();
		return out;
	}

	private static int[] ints(JsonArray a) {
		int[] out = new int[a.size()];
		for (int i = 0; i < out.length; i++) out[i] = a.get(i).getAsInt();
		return out;
	}

	// ------------------------------------------------------------------ smooth shapes (same maths as the launcher's shapeQuads)

	private static Shape shape(JsonObject o) {
		Shape s = new Shape();
		String t = o.get("t").getAsString();
		s.flags = o.has("f") ? o.get("f").getAsInt() : 0;
		s.colour = o.has("col") ? (int) o.get("col").getAsLong() : 0xFFFFFF;
		s.tex = o.has("tex") ? o.get("tex").getAsString() : null;
		java.util.List<float[]> verts = new java.util.ArrayList<>();
		if (t.equals("mesh")) return mesh(s, o);
		int n = o.get("n").getAsInt();
		if (t.equals("ball")) {
			float[] c = floats(o.getAsJsonArray("c"));
			float[] r = floats(o.getAsJsonArray("r"));
			float[] tp = o.has("tp") ? floats(o.getAsJsonArray("tp")) : new float[] {0, 0};
			boolean wrap = o.has("wrap");
			int rings = Math.max(4, Math.round(n / 4f) * 2);
			int last = o.has("half") ? rings / 2 : rings;
			for (int i = 0; i < last; i++) {
				double t0 = Math.PI * i / rings;
				double t1 = Math.PI * (i + 1) / rings;
				boolean front = i < rings / 2;
				for (int j = 0; j < n; j++) {
					double p0 = 2 * Math.PI * j / n;
					double p1 = 2 * Math.PI * (j + 1) / n;
					verts.add(ballVertex(c, r, tp, wrap, t0, p0, front));
					verts.add(ballVertex(c, r, tp, wrap, t1, p0, front));
					verts.add(ballVertex(c, r, tp, wrap, t1, p1, front));
					verts.add(ballVertex(c, r, tp, wrap, t0, p1, front));
				}
			}
		} else {
			float[] a = floats(o.getAsJsonArray("a"));
			float[] b = floats(o.getAsJsonArray("b"));
			float[] r = floats(o.getAsJsonArray("r"));
			double dx = b[0] - a[0];
			double dy = b[1] - a[1];
			double dz = b[2] - a[2];
			double len = Math.sqrt(dx * dx + dy * dy + dz * dz);
			if (len == 0) len = 1;
			dx /= len;
			dy /= len;
			dz /= len;
			double hx = Math.abs(dy) < 0.9 ? 0 : 1;
			double hy = Math.abs(dy) < 0.9 ? 1 : 0;
			double ux = hy * dz;
			double uy = -hx * dz;
			double uz = hx * dy - hy * dx;
			double ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
			if (ul == 0) ul = 1;
			ux /= ul;
			uy /= ul;
			uz /= ul;
			double[] u = {ux, uy, uz};
			double[] w = {dy * uz - dz * uy, dz * ux - dx * uz, dx * uy - dy * ux};
			double[] d = {dx, dy, dz};
			double slope = (r[0] - r[1]) / len;
			for (int j = 0; j < n; j++) {
				double p0 = 2 * Math.PI * j / n;
				double p1 = 2 * Math.PI * (j + 1) / n;
				verts.add(limbVertex(a, b, r, u, w, d, slope, p0, false));
				verts.add(limbVertex(a, b, r, u, w, d, slope, p1, false));
				verts.add(limbVertex(a, b, r, u, w, d, slope, p1, true));
				verts.add(limbVertex(a, b, r, u, w, d, slope, p0, true));
			}
		}
		s.v = new float[verts.size() * 8];
		for (int i = 0; i < verts.size(); i++) System.arraycopy(verts.get(i), 0, s.v, i * 8, 8);
		return s;
	}

	private static float[] ballVertex(float[] c, float[] r, float[] tp, boolean wrap, double th, double ph, boolean front) {
		double ux = Math.sin(th) * Math.cos(ph);
		double uy = Math.sin(th) * Math.sin(ph);
		double uz = Math.cos(th);
		double kx = 1 + tp[0] * uy;
		double kz = 1 + tp[1] * uy;
		double nx = ux / (r[0] * kx);
		double ny = uy / r[1];
		double nz = uz / (r[2] * kz);
		double l = Math.sqrt(nx * nx + ny * ny + nz * nz);
		if (l == 0) l = 1;
		float u;
		float v;
		if (wrap) {
			u = (float) (ph / (2 * Math.PI));
			v = (float) (th / Math.PI);
		} else {
			u = front ? (float) (0.5 + 0.5 * ux) : 0.004f;
			v = front ? (float) (0.5 - 0.5 * uy) : 0.004f;
		}
		return new float[] {(float) (c[0] + r[0] * kx * ux), (float) (c[1] + r[1] * uy), (float) (c[2] + r[2] * kz * uz), (float) (nx / l), (float) (ny / l), (float) (nz / l), u, v};
	}

	private static float[] limbVertex(float[] a, float[] b, float[] r, double[] u, double[] w, double[] d, double slope, double ph, boolean end) {
		double c = Math.cos(ph);
		double s = Math.sin(ph);
		double rx = u[0] * c + w[0] * s;
		double ry = u[1] * c + w[1] * s;
		double rz = u[2] * c + w[2] * s;
		double rad = end ? r[1] : r[0];
		double nx = rx + d[0] * slope;
		double ny = ry + d[1] * slope;
		double nz = rz + d[2] * slope;
		double l = Math.sqrt(nx * nx + ny * ny + nz * nz);
		if (l == 0) l = 1;
		float[] o = end ? b : a;
		return new float[] {(float) (o[0] + rx * rad), (float) (o[1] + ry * rad), (float) (o[2] + rz * rad), (float) (nx / l), (float) (ny / l), (float) (nz / l), (float) (ph / (2 * Math.PI)), end ? 1f : 0f};
	}

	/** A sculpted mesh: 12 bytes a vertex (int16 x, y, z in 1/64 px; int8 normal; rgb), uint16 triangles. */
	private static Shape mesh(Shape s, JsonObject o) {
		int n = o.get("n").getAsInt();
		ByteBuffer v = ByteBuffer.wrap(Base64.getDecoder().decode(o.get("v").getAsString())).order(ByteOrder.LITTLE_ENDIAN);
		ByteBuffer idx = ByteBuffer.wrap(Base64.getDecoder().decode(o.get("i").getAsString())).order(ByteOrder.LITTLE_ENDIAN);
		float[] pos = new float[n * 6];
		int[] rgb = new int[n];
		for (int k = 0; k < n; k++) {
			int b = k * 12;
			pos[k * 6] = v.getShort(b) / 64f;
			pos[k * 6 + 1] = v.getShort(b + 2) / 64f;
			pos[k * 6 + 2] = v.getShort(b + 4) / 64f;
			pos[k * 6 + 3] = v.get(b + 6) / 127f;
			pos[k * 6 + 4] = v.get(b + 7) / 127f;
			pos[k * 6 + 5] = v.get(b + 8) / 127f;
			rgb[k] = (v.get(b + 9) & 255) << 16 | (v.get(b + 10) & 255) << 8 | (v.get(b + 11) & 255);
		}
		// each triangle as a quad with its last corner twice: Minecraft draws entities in quads
		int tris = idx.capacity() / 6;
		s.v = new float[tris * 4 * 8];
		s.rgb = new int[tris * 4];
		for (int t = 0; t < tris; t++) {
			for (int k = 0; k < 4; k++) {
				int vi = idx.getShort((t * 3 + Math.min(k, 2)) * 2) & 0xFFFF;
				int at = (t * 4 + k) * 8;
				System.arraycopy(pos, vi * 6, s.v, at, 6);
				s.v[at + 6] = 0.5f;
				s.v[at + 7] = 0.5f;
				s.rgb[t * 4 + k] = rgb[vi];
			}
		}
		return s;
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

	/** How a player model's role part moves (the same maths as the launcher's role()). */
	static void role(Matrix4f m, int role, Pose pose, float t) {
		if (role < 0 || pose == null) return;
		float c = (float) Math.cos(pose.walk * 0.6662f) * pose.speed;
		final float r2d = 1 / D2R;
		switch (ROLES[role]) {
			case "head", "look" -> {
				rotate(m, 'y', pose.yaw);
				rotate(m, 'x', pose.pitch);
			}
			case "legL" -> rotate(m, 'x', c * 1.4f * r2d);
			case "legR" -> rotate(m, 'x', -c * 1.4f * r2d);
			case "armL" -> rotate(m, 'x', -c * r2d);
			case "armR" -> rotate(m, 'x', c * r2d - (float) Math.sin(Math.sqrt(pose.attack) * Math.PI) * 80);
			case "body" -> {
				if (pose.crouch) rotate(m, 'x', 28);
			}
			case "tail" -> rotate(m, 'y', (float) Math.sin(t * (2 + 6 * pose.speed)) * (10 + 25 * pose.speed));
			case "hop" -> {
				float k = Math.abs((float) Math.sin(pose.walk * 0.6662f)) * pose.speed;
				m.translate(0, k * 7, 0);
				float squash = 0.12f * (1 - k) * pose.speed;
				m.scale(1 + squash, 1 - squash + 0.1f * k, 1 + squash);
			}
			case "lean" -> rotate(m, 'x', pose.speed * 25);
			default -> {
			}
		}
	}

	/** The change between forms, or null when there's none going on (the launcher's transition()). */
	static Trans transition(State s, float t) {
		float d = t - s.changed;
		if (d >= 0.9f || s.prev < 0 || s.prev == s.form) return null;
		Trans tr = new Trans();
		if (d < 0.5f) {
			tr.show = ((int) Math.floor(d / 0.07f)) % 2 == 0 ? s.form : s.prev;
			tr.dx = (float) Math.sin(d * 91) * 0.9f;
			tr.dz = (float) Math.cos(d * 77) * 0.9f;
			return tr;
		}
		float k = (d - 0.5f) / 0.4f;
		float back = 1 + 2.70158f * (float) Math.pow(k - 1, 3) + 1.70158f * (float) Math.pow(k - 1, 2);
		tr.show = s.form;
		tr.scale = 0.6f + 0.4f * back;
		return tr;
	}

	/** Whether something with these conditions shows. */
	static boolean shows(int wf, int we, int wp, State s, Trans tr) {
		if (s == null) return true;
		int form = tr != null ? tr.show : s.form;
		return (wf < 0 || wf == form) && (we < 0 || we == s.face) && (wp < 0 || wp == (s.power ? 1 : 0));
	}

	static void partMatrix(Matrix4f m, Part p, float t) {
		partMatrix(m, p, t, null, null);
	}

	static void partMatrix(Matrix4f m, Part p, float t, Pose pose, Trans tr) {
		m.translate(p.px, p.py, p.pz);
		if (tr != null && p.wf >= 0) {
			m.translate(tr.dx, 0, tr.dz);
			if (tr.scale != 1f) m.scale(tr.scale);
		}
		if (p.rot != null) {
			rotate(m, 'x', p.rot[0]);
			rotate(m, 'y', p.rot[1]);
			rotate(m, 'z', p.rot[2]);
		}
		role(m, p.role, pose, t);
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
		emit(p, parent, t, light, mesh, null, null, null);
	}

	/** The same for a player model's part, posed, in its state. */
	static void emit(Part p, Matrix4f parent, float t, int light, CosmeticMesh mesh, Pose pose, State st, Trans tr) {
		if (!shows(p.wf, p.we, p.wp, st, tr)) return;
		Matrix4f m = new Matrix4f(parent);
		partMatrix(m, p, t, pose, tr);
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
		for (Shape s : p.shapes) emitShape(s, m, t, light, mesh);
		for (Part c : p.children) emit(c, m, t, light, mesh, pose, st, tr);
	}

	private static void emitShape(Shape s, Matrix4f m, float t, int light, CosmeticMesh mesh) {
		int batch = s.tex != null ? mesh.textured(s.tex) : (s.flags & SEE) != 0 ? CosmeticMesh.SEE : CosmeticMesh.SOLID;
		int l = (s.flags & GLOW) != 0 ? CosmeticMesh.FULL_BRIGHT : light;
		int argb = s.tex != null ? 0xFFFFFFFF : colour(s.colour, s.flags, t, 0, 0, 0);
		Vector3f v = new Vector3f();
		Vector3f n = new Vector3f();
		float[] d = s.v;
		int count = d.length / 8;
		for (int i = 0; i < count; i++) {
			int o = i * 8;
			m.transformPosition(v.set(d[o], d[o + 1], d[o + 2]));
			m.transformDirection(n.set(d[o + 3], d[o + 4], d[o + 5])).normalize();
			mesh.vertex(batch, v.x, v.y, v.z, d[o + 6], d[o + 7], s.rgb != null ? 0xFF000000 | s.rgb[i] : argb, l, n.x, n.y, n.z);
		}
	}
}
