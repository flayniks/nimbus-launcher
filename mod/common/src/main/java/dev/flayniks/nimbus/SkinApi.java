package dev.flayniks.nimbus;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Mojang's skin and cape endpoints, called with the game's own sign-in. */
public final class SkinApi {
	private static final HttpClient HTTP = HttpClient.newBuilder()
		.connectTimeout(Duration.ofSeconds(10))
		.followRedirects(HttpClient.Redirect.NORMAL)
		.build();

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
