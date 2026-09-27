package dev.flayniks.nimbus;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.player.Player;
import org.joml.Matrix4f;
import org.joml.Vector3f;

/**
 * Hats, pets, wings and auras on players. Yours come from the file the launcher writes
 * (-Dnimbus.cosmetics); other players' from the friends service (-Dnimbus.api), asked about the
 * players around you in batches and remembered for a few minutes. Each Minecraft version's hook
 * calls collect() for the players it draws and hands the resulting mesh to CosmeticsDraw.
 */
public final class Cosmetics {
	private Cosmetics() {
	}

	static final String[] SLOTS = {"hat", "pet", "wings", "aura"};
	private static final float PX = 0.9375f / 16f; // one model pixel, in blocks
	private static final float D2R = (float) (Math.PI / 180);
	private static final long START = System.nanoTime();
	private static final Random RND = new Random();

	/** Other players' cosmetics can be switched off (in the launcher's settings, or here in game). */
	public static boolean showOthers() {
		return NimbusConfig.on("cosmetics.others", true);
	}

	// ------------------------------------------------------------------ what you wear

	private static final String OWN_FILE = System.getProperty("nimbus.cosmetics");
	private static String[] own = new String[4];
	private static long ownChecked;
	private static long ownModified = -1;

	static String[] own() {
		long now = System.currentTimeMillis();
		if (OWN_FILE != null && now - ownChecked > 1000) {
			ownChecked = now;
			try {
				Path f = Path.of(OWN_FILE);
				long m = Files.exists(f) ? Files.getLastModifiedTime(f).toMillis() : 0;
				if (m != ownModified) {
					ownModified = m;
					own = m == 0 ? new String[4] : worn(JsonParser.parseString(Files.readString(f)).getAsJsonObject());
				}
			} catch (Exception ignored) {
				// keep what we had
			}
		}
		return own;
	}

	private static String[] worn(JsonObject o) {
		String[] out = new String[4];
		for (int i = 0; i < 4; i++) {
			JsonElement e = o.get(SLOTS[i]);
			out[i] = e == null || e.isJsonNull() ? null : e.getAsString();
		}
		return out;
	}

	// ------------------------------------------------------------------ what everyone else wears

	private static final String API = System.getProperty("nimbus.api");
	private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).build();
	private static final long KEEP_MS = 180_000;

	private static final class Known {
		volatile String[] worn;
		volatile long at;
		volatile boolean wanted = true;
		final String name;

		Known(String name) {
			this.name = name;
		}
	}

	private static final Map<String, Known> KNOWN = new ConcurrentHashMap<>();
	private static volatile Thread fetcher;

	private static String[] others(Player p) {
		if (API == null || API.isBlank()) return null;
		String key = p.getUUID().toString().replace("-", "");
		Known k = KNOWN.computeIfAbsent(key, (x) -> new Known(p.getName().getString()));
		if (!k.wanted && System.currentTimeMillis() - k.at > KEEP_MS) k.wanted = true;
		startFetcher();
		return k.worn;
	}

	private static synchronized void startFetcher() {
		if (fetcher != null && fetcher.isAlive()) return;
		fetcher = new Thread(() -> {
			while (true) {
				try {
					Thread.sleep(1500);
					fetch();
				} catch (InterruptedException e) {
					return;
				} catch (Throwable ignored) {
					// the service is down: try again later
				}
			}
		}, "Nimbus cosmetics");
		fetcher.setDaemon(true);
		fetcher.start();
	}

	private static void fetch() throws Exception {
		List<Map.Entry<String, Known>> ask = new ArrayList<>();
		for (Map.Entry<String, Known> e : KNOWN.entrySet()) if (e.getValue().wanted && ask.size() < 60) ask.add(e);
		if (ask.isEmpty()) return;
		JsonArray players = new JsonArray();
		for (Map.Entry<String, Known> e : ask) {
			JsonObject o = new JsonObject();
			o.addProperty("uuid", e.getKey());
			if (e.getValue().name != null) o.addProperty("name", e.getValue().name);
			players.add(o);
		}
		JsonObject body = new JsonObject();
		body.add("players", players);
		HttpRequest req = HttpRequest.newBuilder(URI.create(API.replaceAll("/+$", "") + "/cosmetics/get")).timeout(Duration.ofSeconds(8))
			.header("content-type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
		HttpResponse<String> res = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
		if (res.statusCode() != 200) return;
		JsonObject found = JsonParser.parseString(res.body()).getAsJsonObject().getAsJsonObject("cosmetics");
		long now = System.currentTimeMillis();
		for (Map.Entry<String, Known> e : ask) {
			Known k = e.getValue();
			k.worn = found != null && found.has(e.getKey()) ? worn(found.getAsJsonObject(e.getKey())) : null;
			k.at = now;
			k.wanted = false;
		}
	}

	// ------------------------------------------------------------------ per-player effects

	private static final class Particle {
		double x;
		double y;
		double z;
		float vx;
		float vy;
		float vz;
		float g;
		float life;
		float age;
		int c;
		Kind kind;
		float sz;
		float spin;
		boolean solid;
	}

	private record Kind(float sx, float sy, float sz, boolean glow, boolean see, boolean tumble, boolean grow) {
	}

	private static final Map<String, Kind> KINDS = new HashMap<>();

	static {
		KINDS.put("spark", new Kind(0.6f, 0.6f, 0.6f, true, false, false, false));
		KINDS.put("ember", new Kind(0.8f, 0.8f, 0.8f, true, false, false, false));
		KINDS.put("star", new Kind(0.7f, 0.7f, 0.7f, true, false, false, false));
		KINDS.put("heart", new Kind(1.4f, 1.2f, 0.6f, true, false, false, false));
		KINDS.put("note", new Kind(1f, 1.4f, 0.4f, true, false, false, false));
		KINDS.put("snow", new Kind(0.7f, 0.7f, 0.7f, false, false, false, false));
		KINDS.put("drop", new Kind(0.35f, 1.2f, 0.35f, false, false, false, false));
		KINDS.put("confetti", new Kind(1.2f, 0.8f, 0.15f, false, false, true, false));
		KINDS.put("leaf", new Kind(1.2f, 0.25f, 0.8f, false, false, true, false));
		KINDS.put("feather", new Kind(1.6f, 0.25f, 0.6f, false, false, true, false));
		KINDS.put("bubble", new Kind(1.1f, 1.1f, 1.1f, false, true, false, false));
		KINDS.put("smoke", new Kind(1.4f, 1.4f, 1.4f, false, true, false, true));
		KINDS.put("pollen", new Kind(0.4f, 0.4f, 0.4f, false, false, false, false));
	}

	private static final class Live {
		final float phase = RND.nextFloat() * 100;
		final List<Particle> particles = new ArrayList<>();
		final float[] acc = new float[64];
		double petX;
		double petY;
		double petZ;
		float petYaw;
		boolean petPlaced;
		long last;
		long seen;
	}

	private static final Map<UUID, Live> LIVE = new HashMap<>();
	private static long swept;

	// ------------------------------------------------------------------ drawing

	/**
	 * Everything `player` wears, added to `mesh` with positions relative to the camera.
	 * `light` is the packed light at the player.
	 */
	public static void collect(Player player, double camX, double camY, double camZ, float pt, int light, CosmeticMesh mesh) {
		try {
			Minecraft mc = Minecraft.getInstance();
			boolean local = player == mc.player;
			if (!local && !showOthers()) return;
			if (player.isInvisible() || player.isSpectator()) return;
			String[] worn = local ? own() : others(player);
			if (worn == null) return;
			Map<String, CosmeticModel.Item> items = CosmeticModel.items();
			long now = System.nanoTime();
			Live live = LIVE.computeIfAbsent(player.getUUID(), (u) -> new Live());
			float dt = live.last == 0 ? 0f : Math.min(0.1f, (now - live.last) / 1e9f);
			live.last = now;
			live.seen = now;
			float t = (now - START) / 1e9f + live.phase;

			double x = lerp(pt, player.xo, player.getX());
			double y = lerp(pt, player.yo, player.getY());
			double z = lerp(pt, player.zo, player.getZ());
			float bodyYaw = rotLerp(pt, player.yBodyRotO, player.yBodyRot);
			float headYaw = rotLerp(pt, player.yHeadRotO, player.yHeadRot);
			float pitch = (float) lerp(pt, player.xRotO, player.getXRot());
			String pose = player.getPose().name();
			boolean lying = pose.equals("SWIMMING") || pose.equals("FALL_FLYING") || pose.equals("SLEEPING") || pose.equals("SPIN_ATTACK");
			boolean crouch = player.isCrouching();
			float rx = (float) (x - camX);
			float ry = (float) (y - camY);
			float rz = (float) (z - camZ);
			float neck = crouch ? 1.035f : 1.40625f;

			for (int s = 0; s < 4; s++) {
				CosmeticModel.Item item = worn[s] == null ? null : items.get(worn[s]);
				if (item == null) continue;
				Matrix4f m = new Matrix4f();
				switch (s) {
					case 0 -> { // hat: rides the head
						if (lying) continue;
						m.translate(rx, ry + neck, rz).rotateY(-headYaw * D2R).rotateX(pitch * D2R).scale(PX).translate(0, 8, 0);
					}
					case 1 -> { // pet: follows beside your shoulder
						// (-14, 27, -5) in the body's frame: right of the shoulder, a little behind
						double cos = Math.cos(bodyYaw * D2R);
						double sin = Math.sin(bodyYaw * D2R);
						double tx = x + (-14 * cos + 5 * sin) * PX;
						double ty = y + (lying ? 0.6 : 27 * PX);
						double tz = z + (-14 * sin - 5 * cos) * PX;
						if (!live.petPlaced || Math.abs(live.petX - tx) + Math.abs(live.petY - ty) + Math.abs(live.petZ - tz) > 8) {
							live.petX = tx;
							live.petY = ty;
							live.petZ = tz;
							live.petYaw = bodyYaw;
							live.petPlaced = true;
						}
						float k = 1f - (float) Math.exp(-dt * 5);
						live.petX += (tx - live.petX) * k;
						live.petY += (ty - live.petY) * k;
						live.petZ += (tz - live.petZ) * k;
						live.petYaw = rotLerp(1f - (float) Math.exp(-dt * 4), live.petYaw, bodyYaw);
						m.translate((float) (live.petX - camX), (float) (live.petY - camY), (float) (live.petZ - camZ)).rotateY(-live.petYaw * D2R).scale(PX);
					}
					case 2 -> { // wings: on your back
						if (lying) continue;
						m.translate(rx, ry + neck, rz).rotateY(-bodyYaw * D2R).rotateX(crouch ? 0.5f : 0f).scale(PX).translate(0, -4, -2);
					}
					default -> m.translate(rx, ry, rz).rotateY(-bodyYaw * D2R).scale(PX); // aura: round your feet
				}
				for (CosmeticModel.Part p : item.parts) CosmeticModel.emit(p, m, t, light, mesh);
				emitFx(item, s, m, live, dt, camX, camY, camZ);
			}
			drawParticles(live, dt, t, camX, camY, camZ, light, mesh);
			sweep(now);
		} catch (Throwable ignored) {
			// a cosmetic never takes the game down
		}
	}

	/** Every player in the world (for the versions whose hook runs once per frame). */
	public static void collectAll(double camX, double camY, double camZ, float pt, boolean firstPerson, CosmeticMesh mesh) {
		Minecraft mc = Minecraft.getInstance();
		if (mc.level == null) return;
		for (Player p : mc.level.players()) {
			if (p == mc.player && firstPerson) continue;
			if (p.distanceToSqr(camX, camY, camZ) > 96 * 96) continue;
			int light = CosmeticMesh.FULL_BRIGHT;
			try {
				light = mc.getEntityRenderDispatcher().getPackedLightCoords(p, pt);
			} catch (Throwable ignored) {
				// full bright then
			}
			collect(p, camX, camY, camZ, pt, light, mesh);
		}
	}

	private static void emitFx(CosmeticModel.Item item, int slot, Matrix4f m, Live live, float dt, double camX, double camY, double camZ) {
		if (dt <= 0f) return;
		Vector3f p = new Vector3f();
		Vector3f v = new Vector3f();
		for (int i = 0; i < item.fx.length && i < 16; i++) {
			CosmeticModel.Fx fx = item.fx[i];
			int a = slot * 16 + i;
			live.acc[a] += dt * fx.rate;
			while (live.acc[a] >= 1f && live.particles.size() < 220) {
				live.acc[a] -= 1f;
				float dx = RND.nextFloat() * 2 - 1;
				float dy = RND.nextFloat() * 2 - 1;
				float dz = RND.nextFloat() * 2 - 1;
				float len = (float) Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-4f;
				dx /= len;
				dy /= len;
				dz /= len;
				p.set(fx.at[0], fx.at[1], fx.at[2]);
				v.set(fx.v[0], fx.v[1], fx.v[2]);
				if (fx.sp < 0) {
					p.add(dx * -fx.sp, dy * -fx.sp, dz * -fx.sp);
					v.add(dx * fx.sp * 1.3f, dy * fx.sp * 1.3f, dz * fx.sp * 1.3f);
				} else {
					float r = fx.sp * RND.nextFloat();
					v.add(dx * r, dy * r, dz * r);
					p.add(dx * 0.5f, dy * 0.5f, dz * 0.5f);
				}
				m.transformPosition(p);
				m.transformDirection(v);
				Particle q = new Particle();
				q.x = p.x + camX;
				q.y = p.y + camY;
				q.z = p.z + camZ;
				q.vx = v.x;
				q.vy = v.y;
				q.vz = v.z;
				q.g = fx.g * PX;
				q.life = fx.life * (0.6f + 0.4f * RND.nextFloat());
				q.c = fx.c[RND.nextInt(fx.c.length)];
				q.kind = KINDS.getOrDefault(fx.k, KINDS.get("spark"));
				q.sz = fx.sz;
				q.spin = RND.nextFloat() * 6;
				q.solid = fx.solid;
				live.particles.add(q);
			}
		}
	}

	private static void drawParticles(Live live, float dt, float t, double camX, double camY, double camZ, int light, CosmeticMesh mesh) {
		Matrix4f m = new Matrix4f();
		Iterator<Particle> it = live.particles.iterator();
		while (it.hasNext()) {
			Particle q = it.next();
			q.age += dt;
			if (q.age >= q.life) {
				it.remove();
				continue;
			}
			q.vy += q.g * dt;
			q.x += q.vx * dt;
			q.y += q.vy * dt;
			q.z += q.vz * dt;
			float k = q.age / q.life;
			float shrink = q.kind.grow() ? 1 + k * 1.2f : 1 - k * k;
			boolean glow = q.kind.glow() && !q.solid;
			int c = q.c;
			if (glow) {
				float f = 1 - k * 0.6f;
				c = (Math.round(((c >> 16) & 255) * f) << 16) | (Math.round(((c >> 8) & 255) * f) << 8) | Math.round((c & 255) * f);
			}
			int argb = (q.kind.see() ? 0x8C000000 : 0xFF000000) | (c & 0xFFFFFF);
			m.identity().translate((float) (q.x - camX), (float) (q.y - camY), (float) (q.z - camZ)).rotateY(t * 2 + q.spin);
			if (q.kind.tumble()) m.rotateX(t * 3 + q.spin);
			m.scale(q.kind.sx() * q.sz * PX * shrink, q.kind.sy() * q.sz * PX * shrink, q.kind.sz() * q.sz * PX * shrink).translate(-0.5f, -0.5f, -0.5f);
			cube(m, argb, glow ? CosmeticMesh.FULL_BRIGHT : light, glow ? CosmeticMesh.GLOW : q.kind.see() ? CosmeticMesh.SEE : CosmeticMesh.SOLID, mesh);
		}
	}

	private static void cube(Matrix4f m, int argb, int light, int batch, CosmeticMesh mesh) {
		Vector3f v = new Vector3f();
		Vector3f n = new Vector3f();
		for (int f = 0; f < 6; f++) {
			m.transformDirection(n.set(CosmeticModel.NORMALS[f][0], CosmeticModel.NORMALS[f][1], CosmeticModel.NORMALS[f][2])).normalize();
			float[] c = CosmeticModel.CORNERS[f];
			for (int k = 0; k < 4; k++) {
				m.transformPosition(v.set(c[k * 3], c[k * 3 + 1], c[k * 3 + 2]));
				mesh.vertex(batch, v.x, v.y, v.z, argb, light, n.x, n.y, n.z);
			}
		}
	}

	/** Forgets players that haven't been drawn for a while. */
	private static void sweep(long now) {
		if (now - swept < 5_000_000_000L) return;
		swept = now;
		LIVE.values().removeIf((l) -> now - l.seen > 30_000_000_000L);
	}

	private static double lerp(float k, double a, double b) {
		return a + (b - a) * k;
	}

	private static float rotLerp(float k, float a, float b) {
		float d = ((b - a) % 360 + 540) % 360 - 180;
		return a + d * k;
	}
}
