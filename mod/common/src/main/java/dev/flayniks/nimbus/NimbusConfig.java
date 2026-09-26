package dev.flayniks.nimbus;

import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import net.minecraft.client.Minecraft;

/**
 * Nimbus Features settings: switches, choices and where each HUD module sits.
 * The launcher passes one shared file (-Dnimbus.features), so the setup follows
 * you into every instance; without it the file lives in the game's config folder.
 */
public final class NimbusConfig {
	public static final class Place {
		public float x;
		public float y;
		public float scale = 1f;

		Place(float x, float y, float scale) {
			this.x = x;
			this.y = y;
			this.scale = scale;
		}
	}

	private static final Map<String, Boolean> TOGGLES = new HashMap<>();
	private static final Map<String, Integer> VALUES = new HashMap<>();
	private static final Map<String, Place> PLACES = new HashMap<>();
	private static final Map<String, Double> NUMBERS = new HashMap<>();
	private static boolean loaded;

	private NimbusConfig() {
	}

	private static Path file() {
		String prop = System.getProperty("nimbus.features");
		if (prop != null && !prop.isBlank()) return Path.of(prop);
		return Minecraft.getInstance().gameDirectory.toPath().resolve("config").resolve("nimbus-features.json");
	}

	private static void load() {
		if (loaded) return;
		loaded = true;
		try {
			JsonObject o = JsonParser.parseString(Files.readString(file())).getAsJsonObject();
			if (o.has("toggles")) for (Map.Entry<String, JsonElement> e : o.getAsJsonObject("toggles").entrySet()) TOGGLES.put(e.getKey(), e.getValue().getAsBoolean());
			if (o.has("values")) for (Map.Entry<String, JsonElement> e : o.getAsJsonObject("values").entrySet()) VALUES.put(e.getKey(), e.getValue().getAsInt());
			if (o.has("numbers")) for (Map.Entry<String, JsonElement> e : o.getAsJsonObject("numbers").entrySet()) NUMBERS.put(e.getKey(), e.getValue().getAsDouble());
			if (o.has("hud")) {
				for (Map.Entry<String, JsonElement> e : o.getAsJsonObject("hud").entrySet()) {
					JsonObject p = e.getValue().getAsJsonObject();
					PLACES.put(e.getKey(), new Place(p.get("x").getAsFloat(), p.get("y").getAsFloat(), p.has("scale") ? p.get("scale").getAsFloat() : 1f));
				}
			}
		} catch (IOException | RuntimeException ignored) {
			// first run, or a broken file: start from the defaults
		}
	}

	public static boolean on(String id, boolean fallback) {
		load();
		return TOGGLES.getOrDefault(id, fallback);
	}

	public static void set(String id, boolean on) {
		load();
		TOGGLES.put(id, on);
		save();
	}

	public static int value(String id, int fallback) {
		load();
		return VALUES.getOrDefault(id, fallback);
	}

	public static void set(String id, int value) {
		load();
		VALUES.put(id, value);
		save();
	}

	public static double number(String id, double fallback) {
		load();
		return NUMBERS.getOrDefault(id, fallback);
	}

	public static void setNumber(String id, double value) {
		load();
		NUMBERS.put(id, value);
		save();
	}

	public static Place place(String id) {
		load();
		return PLACES.get(id);
	}

	public static void place(String id, float x, float y, float scale) {
		place(id, x, y, scale, true);
	}

	/** With persist=false the change stays in memory (while dragging); save() writes it later. */
	public static void place(String id, float x, float y, float scale, boolean persist) {
		load();
		PLACES.put(id, new Place(x, y, scale));
		if (persist) save();
	}

	public static void clearPlaces() {
		load();
		PLACES.clear();
		save();
	}

	/** Writes the file. */
	public static void save() {
		JsonObject o = new JsonObject();
		JsonObject t = new JsonObject();
		TOGGLES.forEach(t::addProperty);
		JsonObject v = new JsonObject();
		VALUES.forEach(v::addProperty);
		JsonObject n = new JsonObject();
		NUMBERS.forEach(n::addProperty);
		JsonObject h = new JsonObject();
		PLACES.forEach((id, p) -> {
			JsonObject e = new JsonObject();
			e.addProperty("x", p.x);
			e.addProperty("y", p.y);
			e.addProperty("scale", p.scale);
			h.add(id, e);
		});
		o.add("toggles", t);
		o.add("values", v);
		o.add("numbers", n);
		o.add("hud", h);
		try {
			Path f = file();
			Files.createDirectories(f.getParent());
			Path tmp = f.resolveSibling(f.getFileName() + ".tmp");
			Files.writeString(tmp, new GsonBuilder().setPrettyPrinting().create().toJson(o), StandardCharsets.UTF_8);
			Files.move(tmp, f, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
		} catch (IOException ignored) {
			// settings stay in memory for this session
		}
	}
}
