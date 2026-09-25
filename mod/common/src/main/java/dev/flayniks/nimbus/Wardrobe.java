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
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;

/**
 * The same wardrobe the launcher's Skins page uses: PNGs next to an index.json.
 * Nimbus passes its folder in with -Dnimbus.wardrobe, so skins saved in the
 * launcher show up in game and the other way round.
 */
public final class Wardrobe {
	public static final class Entry {
		public final String id;
		public final String name;
		public final boolean slim;
		public final byte[] png;
		public final Png image;

		Entry(String id, String name, boolean slim, byte[] png, Png image) {
			this.id = id;
			this.name = name;
			this.slim = slim;
			this.png = png;
			this.image = image;
		}
	}

	private final Path dir;

	public Wardrobe(Path fallback) {
		String prop = System.getProperty("nimbus.wardrobe");
		this.dir = prop == null || prop.isBlank() ? fallback : Path.of(prop);
	}

	public List<Entry> list() {
		List<Entry> out = new ArrayList<>();
		for (JsonElement e : index()) {
			try {
				JsonObject o = e.getAsJsonObject();
				String id = o.get("id").getAsString();
				if (!id.matches("[A-Za-z0-9_-]+")) continue;
				byte[] png = Files.readAllBytes(dir.resolve(id + ".png"));
				String name = o.has("name") ? o.get("name").getAsString() : "Skin";
				boolean slim = o.has("variant") && "slim".equals(o.get("variant").getAsString());
				out.add(new Entry(id, name, slim, png, Png.read(png)));
			} catch (IOException | RuntimeException ignored) {
				// removed by hand or broken: leave it out
			}
		}
		return out;
	}

	/** Whether this exact image is already in the wardrobe. */
	public boolean has(byte[] png) {
		String hash = sha1(png);
		for (JsonElement e : index()) {
			JsonObject o = e.getAsJsonObject();
			if (o.has("hash") && hash.equals(o.get("hash").getAsString())) return true;
		}
		return false;
	}

	/** Adds a skin (unless the exact image is already there) and returns its id. */
	public String add(byte[] png, String name, boolean slim) throws IOException {
		check(png);
		String hash = sha1(png);
		JsonArray items = index();
		for (JsonElement e : items) {
			JsonObject o = e.getAsJsonObject();
			if (o.has("hash") && hash.equals(o.get("hash").getAsString())) return o.get("id").getAsString();
		}
		JsonObject entry = new JsonObject();
		String id = hash.substring(0, 12);
		entry.addProperty("id", id);
		entry.addProperty("hash", hash);
		entry.addProperty("name", name.length() > 40 ? name.substring(0, 40) : name);
		entry.addProperty("variant", slim ? "slim" : "classic");
		entry.addProperty("source", "game");
		entry.addProperty("added", System.currentTimeMillis());
		Files.createDirectories(dir);
		Files.write(dir.resolve(id + ".png"), png);
		JsonArray next = new JsonArray();
		next.add(entry);
		next.addAll(items);
		save(dir.resolve("index.json"), next);
		return id;
	}

	public Path dir() {
		return dir;
	}

	/** Reads a skin PNG from disk and adds it, named after the file. Returns its id. */
	public String addFile(Path file) throws IOException {
		byte[] png = Files.readAllBytes(file);
		Png img = check(png);
		String name = file.getFileName().toString().replaceFirst("(?i)\\.png$", "");
		return add(png, name, SkinArt.looksSlim(img));
	}

	/** Picks up PNGs someone copied straight into the wardrobe folder. Returns the last id added. */
	public String importLoose() {
		String last = null;
		java.util.Set<String> known = new java.util.HashSet<>();
		for (JsonElement e : index()) {
			try {
				known.add(e.getAsJsonObject().get("id").getAsString() + ".png");
			} catch (RuntimeException ignored) {
				// skip odd entries
			}
		}
		try (java.util.stream.Stream<Path> files = Files.list(dir)) {
			for (Path f : (Iterable<Path>) files::iterator) {
				String n = f.getFileName().toString();
				if (!n.toLowerCase(java.util.Locale.ROOT).endsWith(".png") || known.contains(n) || !Files.isRegularFile(f)) continue;
				try {
					last = addFile(f);
					Files.deleteIfExists(f);
				} catch (IOException ignored) {
					// not a skin: leave it where it is
				}
			}
		} catch (IOException ignored) {
			// no folder yet
		}
		return last;
	}

	/** Minecraft skins are 64x64, or the old 64x32. */
	public static Png check(byte[] png) throws IOException {
		Png img = Png.read(png);
		if (img.width != 64 || (img.height != 64 && img.height != 32)) {
			throw new SkinApi.Failure("Skins are 64×64 pixels — that one is " + img.width + "×" + img.height + ".");
		}
		return img;
	}

	/** Remembers the arm model a wardrobe skin was last worn with. */
	public void setVariant(String id, boolean slim) {
		try {
			JsonArray items = index();
			for (JsonElement e : items) {
				JsonObject o = e.getAsJsonObject();
				if (o.has("id") && id.equals(o.get("id").getAsString())) o.addProperty("variant", slim ? "slim" : "classic");
			}
			save(dir.resolve("index.json"), items);
		} catch (IOException | RuntimeException ignored) {
			// cosmetic only
		}
	}

	/** Which wardrobe skin an account wears, tied to the texture Mojang gave back (shared with the launcher). */
	public String wornId(String uuid, String url) {
		try {
			JsonObject worn = JsonParser.parseString(Files.readString(dir.resolve("worn.json"))).getAsJsonObject();
			JsonObject w = worn.getAsJsonObject(uuid);
			if (w != null && url != null && url.equals(w.get("url").getAsString())) return w.get("id").getAsString();
		} catch (IOException | RuntimeException ignored) {
			// nothing recorded yet
		}
		return null;
	}

	public void setWorn(String uuid, String id, String url) {
		try {
			Path file = dir.resolve("worn.json");
			JsonObject worn;
			try {
				worn = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
			} catch (IOException | RuntimeException e) {
				worn = new JsonObject();
			}
			if (id == null) {
				worn.remove(uuid);
			} else {
				JsonObject w = new JsonObject();
				w.addProperty("id", id);
				w.addProperty("url", url);
				worn.add(uuid, w);
			}
			Files.createDirectories(dir);
			save(file, worn);
		} catch (IOException ignored) {
			// only a nicety for the launcher's "Wearing" badge
		}
	}

	private JsonArray index() {
		try {
			JsonElement e = JsonParser.parseString(Files.readString(dir.resolve("index.json")));
			if (e.isJsonArray()) return e.getAsJsonArray();
		} catch (IOException | RuntimeException ignored) {
			// no wardrobe yet
		}
		return new JsonArray();
	}

	private static void save(Path file, JsonElement json) throws IOException {
		Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
		Files.writeString(tmp, new GsonBuilder().setPrettyPrinting().create().toJson(json), StandardCharsets.UTF_8);
		Files.move(tmp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
	}

	private static String sha1(byte[] data) {
		try {
			StringBuilder sb = new StringBuilder();
			for (byte b : MessageDigest.getInstance("SHA-1").digest(data)) sb.append(String.format("%02x", b));
			return sb.toString();
		} catch (NoSuchAlgorithmException e) {
			throw new IllegalStateException(e);
		}
	}
}
