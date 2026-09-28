package dev.flayniks.nimbus;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Replay clips: F8 asks the launcher to save the last seconds it has been recording of this
 * window. The launcher does the recording (so it works the same on every Minecraft version and
 * costs the game nothing); this only sends the key press and shows the answer.
 */
public final class Clips {
	private Clips() {
	}

	private static final int KEY_F8 = 297; // GLFW_KEY_F8
	private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
	private static boolean was;
	private static volatile boolean saving;

	/** Every frame, from the HUD and the menus. */
	public static void tick() {
		boolean down;
		try {
			down = NimbusConfig.on("clips.key", true) && Compat.keyDown(KEY_F8);
		} catch (Throwable t) {
			down = false;
		}
		if (down && !was) save();
		was = down;
	}

	private static void save() {
		String bridge = System.getProperty("nimbus.bridge");
		if (bridge == null || bridge.isBlank()) {
			NimbusLan.notice("Replay clips need the Nimbus Launcher", 3000);
			return;
		}
		if (saving) return;
		saving = true;
		NimbusLan.notice("Saving your clip…", 8000);
		HttpRequest req = HttpRequest.newBuilder(URI.create(bridge + "/clip")).timeout(Duration.ofSeconds(20))
			.header("content-type", "application/json").POST(HttpRequest.BodyPublishers.ofString("{}")).build();
		HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofString()).whenComplete((res, err) -> {
			saving = false;
			try {
				if (err != null) throw err;
				JsonObject o = JsonParser.parseString(res.body()).getAsJsonObject();
				if (o.has("ok") && o.get("ok").getAsBoolean()) {
					int s = o.has("seconds") ? o.get("seconds").getAsInt() : 0;
					NimbusLan.notice("Clip saved" + (s > 0 ? " (" + s + " s)" : "") + ", find it in the launcher's Gallery", 5000);
				} else {
					NimbusLan.notice(o.has("error") ? o.get("error").getAsString() : "Couldn't save the clip", 6000);
				}
			} catch (Throwable t) {
				NimbusLan.notice("Couldn't reach the launcher to save the clip", 5000);
			}
		});
	}
}
