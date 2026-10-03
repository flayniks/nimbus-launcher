package dev.flayniks.nimbus;

import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
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

	/** One of your own texts on the HUD ("text.1" to "text.20"). */
	public static final class Text {
		public final String id;
		public String text;
		public int color;
		public boolean box;

		Text(String id, String text, int color, boolean box) {
			this.id = id;
			this.text = text;
			this.color = color;
			this.box = box;
		}
	}

	public static final int MAX_TEXTS = 20;
	public static final int MAX_TEXT_LENGTH = 100;
	private static final List<Text> TEXTS = new ArrayList<>();
	private static int textsVersion;

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
			if (o.has("texts")) {
				for (JsonElement e : o.getAsJsonArray("texts")) {
					JsonObject t = e.getAsJsonObject();
					String id = t.get("id").getAsString();
					if (!id.matches("text\\.([1-9]|1[0-9]|20)") || text(id) != null || TEXTS.size() >= MAX_TEXTS) continue;
					String value = t.has("text") ? t.get("text").getAsString() : "";
					TEXTS.add(new Text(id, value.length() > MAX_TEXT_LENGTH ? value.substring(0, MAX_TEXT_LENGTH) : value, t.has("color") ? t.get("color").getAsInt() : 0, t.has("box") && t.get("box").getAsBoolean()));
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

	// ---------------------------------------------------------------- your texts

	public static List<Text> texts() {
		load();
		return List.copyOf(TEXTS);
	}

	/** Goes up whenever a text is added, changed or removed. */
	public static int textsVersion() {
		return textsVersion;
	}

	public static Text text(String id) {
		for (Text t : TEXTS) if (t.id.equals(id)) return t;
		return null;
	}

	/** A new text in the first free slot, or null when all 20 are taken. */
	public static Text addText(String text, int color, boolean box) {
		load();
		if (TEXTS.size() >= MAX_TEXTS) return null;
		for (int n = 1; n <= MAX_TEXTS; n++) {
			String id = "text." + n;
			if (text(id) != null) continue;
			Text t = new Text(id, clip(text), color, box);
			TEXTS.add(t);
			// a slot used before starts fresh: shown, and placed again
			TOGGLES.remove("hud." + id);
			PLACES.remove(id);
			textsVersion++;
			save();
			return t;
		}
		return null;
	}

	public static void updateText(String id, String text, int color, boolean box) {
		load();
		Text t = text(id);
		if (t == null) return;
		t.text = clip(text);
		t.color = color;
		t.box = box;
		textsVersion++;
		save();
	}

	public static void removeText(String id) {
		load();
		if (!TEXTS.removeIf((t) -> t.id.equals(id))) return;
		TOGGLES.remove("hud." + id);
		PLACES.remove(id);
		textsVersion++;
		save();
	}

	private static String clip(String s) {
		String v = s == null ? "" : s;
		return v.length() > MAX_TEXT_LENGTH ? v.substring(0, MAX_TEXT_LENGTH) : v;
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
		JsonArray texts = new JsonArray();
		for (Text mine : TEXTS) {
			JsonObject e = new JsonObject();
			e.addProperty("id", mine.id);
			e.addProperty("text", mine.text);
			e.addProperty("color", mine.color);
			e.addProperty("box", mine.box);
			texts.add(e);
		}
		o.add("texts", texts);
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
