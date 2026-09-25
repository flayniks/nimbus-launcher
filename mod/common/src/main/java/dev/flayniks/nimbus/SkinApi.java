package dev.flayniks.nimbus;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/** Mojang's skin and cape endpoints, called with the game's own sign-in. */
public final class SkinApi {
	private static final HttpClient HTTP = HttpClient.newBuilder()
		.connectTimeout(Duration.ofSeconds(10))
		.followRedirects(HttpClient.Redirect.NORMAL)
		.build();

	private static final java.util.concurrent.ExecutorService LOOKUPS = java.util.concurrent.Executors.newCachedThreadPool(r -> {
		Thread t = new Thread(r, "Nimbus skin lookup");
		t.setDaemon(true);
		return t;
	});

	private SkinApi() {
	}

	public static final class Cape {
		public final String id;
		public final String name;
		public final String url;
		public final boolean active;

		Cape(String id, String name, String url, boolean active) {
			this.id = id;
			this.name = name;
			this.url = url;
			this.active = active;
		}
	}

	public static final class Profile {
		public String id = "";
		public String name = "";
		public String skinUrl;
		public boolean slim;
		public final List<Cape> capes = new ArrayList<>();

		public int activeCape() {
			for (int i = 0; i < capes.size(); i++) if (capes.get(i).active) return i;
			return -1;
		}
	}

	/** A failure worded for the player. */
	public static final class Failure extends IOException {
		public Failure(String message) {
			super(message);
		}
	}

	/** A skin found by a search: someone's current skin, or one from the MineSkin gallery. */
	public static final class Found {
		public final String name;
		public final byte[] png;
		public final boolean slim;
		public final boolean player;

		Found(String name, byte[] png, boolean slim, boolean player) {
			this.name = name;
			this.png = png;
			this.slim = slim;
			this.player = player;
		}
	}

	public static final class Results {
		public final List<Found> skins = new ArrayList<>();
		public String next;
	}

	private static String prop(String key, String fallback) {
		String v = System.getProperty(key);
		return v == null || v.isBlank() ? fallback : v;
	}

	private static String base() {
		String url = System.getProperty("nimbus.services");
		return url == null || url.isBlank() ? "https://api.minecraftservices.com" : url;
	}

	public static Profile profile(String token) throws IOException {
		return parse(send(token, "GET", "/minecraft/profile", null, null));
	}

	/** Makes `png` the account's skin. Mojang only accepts 64x64 (or old 64x32) PNGs. */
	public static Profile upload(String token, byte[] png, boolean slim) throws IOException {
		String boundary = "NimbusSkin" + UUID.randomUUID().toString().replace("-", "");
		ByteArrayOutputStream body = new ByteArrayOutputStream();
		write(body, "--" + boundary + "\r\nContent-Disposition: form-data; name=\"variant\"\r\n\r\n" + (slim ? "slim" : "classic") + "\r\n");
		write(body, "--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"skin.png\"\r\nContent-Type: image/png\r\n\r\n");
		body.write(png);
		write(body, "\r\n--" + boundary + "--\r\n");
		String res = send(token, "POST", "/minecraft/profile/skins", body.toByteArray(), "multipart/form-data; boundary=" + boundary);
		return res.contains("\"skins\"") ? parse(res) : profile(token);
	}

	/** Shows one of the account's capes, or hides it when `capeId` is null. */
	public static Profile setCape(String token, String capeId) throws IOException {
		if (capeId == null) {
			send(token, "DELETE", "/minecraft/profile/capes/active", null, null);
		} else {
			JsonObject json = new JsonObject();
			json.addProperty("capeId", capeId);
			send(token, "PUT", "/minecraft/profile/capes/active", json.toString().getBytes(StandardCharsets.UTF_8), "application/json");
		}
		return profile(token);
	}

	/**
	 * One search for everything: a player with exactly that name (when it could be one)
	 * comes first, then gallery skins with the words in their name. `after` continues a
	 * previous search.
	 */
	public static Results search(String query, String after) throws IOException {
		String q = query.trim();
		CompletableFuture<Found> player = after == null && q.matches("[A-Za-z0-9_]{3,16}")
			? CompletableFuture.supplyAsync(() -> {
				try {
					return player(q);
				} catch (IOException e) {
					return null;
				}
			}, LOOKUPS)
			: CompletableFuture.completedFuture(null);

		Results out = new Results();
		String galleryError = null;
		try {
			StringBuilder url = new StringBuilder(prop("nimbus.gallery", "https://api.mineskin.org")).append("/v2/skins?size=24");
			if (!q.isEmpty()) url.append("&filter=").append(URLEncoder.encode(q, StandardCharsets.UTF_8));
			if (after != null) url.append("&after=").append(URLEncoder.encode(after, StandardCharsets.UTF_8));
			JsonObject o = JsonParser.parseString(getText(url.toString())).getAsJsonObject();
			List<String> names = new ArrayList<>();
			List<String> hashes = new ArrayList<>();
			Set<String> seen = new HashSet<>();
			for (JsonElement e : o.has("skins") ? o.getAsJsonArray("skins") : new JsonArray()) {
				JsonObject sk = e.getAsJsonObject();
				String hash = str(sk, "texture");
				String name = str(sk, "name").trim();
				// the gallery repeats textures, and nameless entries only match a search by accident
				if (!hash.matches("[0-9a-fA-F]{20,80}") || (!q.isEmpty() && name.isEmpty()) || !seen.add(hash)) continue;
				names.add(name.isEmpty() ? "Untitled skin" : name);
				hashes.add(hash);
			}
			String textures = prop("nimbus.textures", "https://textures.minecraft.net");
			List<CompletableFuture<byte[]>> downloads = new ArrayList<>();
			for (String hash : hashes) downloads.add(downloadAsync(textures + "/texture/" + hash));
			for (int i = 0; i < hashes.size(); i++) {
				byte[] png = downloads.get(i).get(30, TimeUnit.SECONDS);
				if (png == null) continue;
				try {
					Png img = Wardrobe.check(png);
					out.skins.add(new Found(names.get(i), png, SkinArt.looksSlim(img), false));
				} catch (IOException ignored) {
					// not a usable skin
				}
			}
			JsonObject pagination = o.has("pagination") ? o.getAsJsonObject("pagination") : null;
			JsonObject next = pagination != null && pagination.has("next") ? pagination.getAsJsonObject("next") : null;
			out.next = next != null && next.has("after") ? next.get("after").getAsString() : null;
		} catch (IOException | RuntimeException | java.util.concurrent.ExecutionException | java.util.concurrent.TimeoutException e) {
			galleryError = e instanceof Failure ? e.getMessage() : "Couldn't reach the skin gallery. Check your internet.";
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			throw new Failure("Cancelled.");
		}
		Found p = player.join();
		if (p != null) out.skins.add(0, p);
		if (out.skins.isEmpty() && galleryError != null) throw new Failure(galleryError);
		return out;
	}

	/** Someone's current skin, by their exact name; null if nobody has that name. */
	public static Found player(String name) throws IOException {
		String mojang = prop("nimbus.mojang", "https://api.mojang.com");
		String sessions = prop("nimbus.mojang", "https://sessionserver.mojang.com");
		HttpResponse<String> res = get(mojang + "/users/profiles/minecraft/" + URLEncoder.encode(name, StandardCharsets.UTF_8));
		if (res.statusCode() == 404 || res.statusCode() == 204 || res.body() == null || res.body().isBlank()) return null;
		if (res.statusCode() != 200) throw new Failure("Mojang's name lookup answered " + res.statusCode() + ".");
		try {
			JsonObject who = JsonParser.parseString(res.body()).getAsJsonObject();
			String id = str(who, "id");
			JsonObject profile = JsonParser.parseString(getText(sessions + "/session/minecraft/profile/" + id)).getAsJsonObject();
			for (JsonElement e : profile.getAsJsonArray("properties")) {
				JsonObject property = e.getAsJsonObject();
				if (!"textures".equals(str(property, "name"))) continue;
				JsonObject tex = JsonParser.parseString(new String(Base64.getDecoder().decode(str(property, "value")), StandardCharsets.UTF_8))
					.getAsJsonObject().getAsJsonObject("textures");
				JsonObject skin = tex == null ? null : tex.getAsJsonObject("SKIN");
				if (skin == null) return null; // a default skin: nothing to copy
				JsonObject meta = skin.has("metadata") ? skin.getAsJsonObject("metadata") : null;
				boolean slim = meta != null && "slim".equals(str(meta, "model"));
				byte[] png = download(str(skin, "url"));
				Wardrobe.check(png);
				return new Found(str(profile, "name").isEmpty() ? name : str(profile, "name"), png, slim, true);
			}
			return null;
		} catch (RuntimeException e) {
			throw new Failure("Mojang sent something odd back. Try again.");
		}
	}

	private static HttpResponse<String> get(String url) throws IOException {
		try {
			return HTTP.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(15))
				.header("User-Agent", "NimbusCore").header("Accept", "application/json").GET().build(), HttpResponse.BodyHandlers.ofString());
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			throw new Failure("Cancelled.");
		} catch (IOException | IllegalArgumentException e) {
			throw new Failure("Can't reach Mojang right now. Check your internet.");
		}
	}

	private static String getText(String url) throws IOException {
		HttpResponse<String> res = get(url);
		if (res.statusCode() != 200) throw new Failure("The server answered " + res.statusCode() + ". Try again soon.");
		return res.body();
	}

	private static CompletableFuture<byte[]> downloadAsync(String url) {
		try {
			return HTTP.sendAsync(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(20)).header("User-Agent", "NimbusCore").GET().build(),
					HttpResponse.BodyHandlers.ofByteArray())
				.thenApply(r -> r.statusCode() == 200 ? r.body() : null)
				.exceptionally(e -> null);
		} catch (IllegalArgumentException e) {
			return CompletableFuture.completedFuture(null);
		}
	}

	/** Downloads a skin or cape image. */
	public static byte[] download(String url) throws IOException {
		String src = url.replaceFirst("^http://textures\\.minecraft\\.net/", "https://textures.minecraft.net/");
		try {
			HttpResponse<byte[]> res = HTTP.send(HttpRequest.newBuilder(URI.create(src)).timeout(Duration.ofSeconds(20)).GET().build(),
				HttpResponse.BodyHandlers.ofByteArray());
			if (res.statusCode() != 200) throw new Failure("Could not download that texture (" + res.statusCode() + ").");
			return res.body();
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			throw new Failure("Cancelled.");
		} catch (Failure e) {
			throw e;
		} catch (IOException | IllegalArgumentException e) {
			throw new Failure("Can't reach Mojang right now. Check your internet.");
		}
	}

	private static void write(ByteArrayOutputStream out, String s) {
		out.writeBytes(s.getBytes(StandardCharsets.UTF_8));
	}

	private static String send(String token, String method, String path, byte[] body, String type) throws IOException {
		if (token == null || token.isBlank() || token.equals("0")) {
			throw new Failure("Sign in with a Microsoft account in Nimbus to change skins.");
		}
		HttpRequest.Builder req = HttpRequest.newBuilder(URI.create(base() + path))
			.timeout(Duration.ofSeconds(25))
			.header("Authorization", "Bearer " + token)
			.header("Accept", "application/json");
		if (type != null) req.header("Content-Type", type);
		req.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofByteArray(body));
		HttpResponse<String> res;
		try {
			res = HTTP.send(req.build(), HttpResponse.BodyHandlers.ofString());
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			throw new Failure("Cancelled.");
		} catch (IOException | IllegalArgumentException e) {
			throw new Failure("Can't reach Mojang right now. Check your internet.");
		}
		int code = res.statusCode();
		if (code >= 200 && code < 300) return res.body() == null ? "" : res.body();
		if (code == 401) throw new Failure("Your sign-in expired. Restart the game from Nimbus.");
		if (code == 429) throw new Failure("Mojang allows a few changes a minute. Wait a bit and try again.");
		if (code == 404) throw new Failure("This account doesn't own Minecraft: Java Edition.");
		if (code == 400) {
			String msg = "";
			try {
				JsonElement e = JsonParser.parseString(res.body()).getAsJsonObject().get("errorMessage");
				if (e != null) msg = e.getAsString();
			} catch (RuntimeException ignored) {
				// keep the generic message
			}
			throw new Failure(msg.isEmpty() ? "Mojang refused that skin." : "Mojang refused that: " + msg);
		}
		throw new Failure("Mojang's skin service answered " + code + ". Try again soon.");
	}

	private static Profile parse(String json) throws IOException {
		try {
			JsonObject o = JsonParser.parseString(json).getAsJsonObject();
			Profile p = new Profile();
			p.id = str(o, "id");
			p.name = str(o, "name");
			JsonArray skins = o.has("skins") ? o.getAsJsonArray("skins") : new JsonArray();
			for (JsonElement e : skins) {
				JsonObject s = e.getAsJsonObject();
				if ("ACTIVE".equals(str(s, "state"))) {
					p.skinUrl = str(s, "url");
					p.slim = "SLIM".equalsIgnoreCase(str(s, "variant"));
				}
			}
			JsonArray capes = o.has("capes") ? o.getAsJsonArray("capes") : new JsonArray();
			for (JsonElement e : capes) {
				JsonObject c = e.getAsJsonObject();
				String alias = str(c, "alias");
				p.capes.add(new Cape(str(c, "id"), alias.isEmpty() ? "Cape" : alias, str(c, "url"), "ACTIVE".equals(str(c, "state"))));
			}
			return p;
		} catch (RuntimeException e) {
			throw new Failure("Mojang sent something odd back. Try again.");
		}
	}

	private static String str(JsonObject o, String key) {
		JsonElement e = o.get(key);
		return e == null || e.isJsonNull() ? "" : e.getAsString();
	}
}
