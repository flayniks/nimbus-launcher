package dev.flayniks.nimbus;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.ConcurrentLinkedDeque;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;

/**
 * Nimbus LAN, the in-game half: opens your singleplayer world, tells the launcher (which
 * tells your friends), and asks you when someone wants in: "NICK wants to join your world",
 * Y to let them in, N to say no. The launcher does the networking.
 */
public final class NimbusLan {
	private NimbusLan() {
	}

	/** The launcher's local address for us, when this game was started by Nimbus. */
	private static final String BRIDGE = System.getProperty("nimbus.bridge");
	private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
	static final int ASK_SECONDS = 90;

	record Ask(String id, String name, long at) {
	}

	private static volatile boolean hosting;
	private static final ConcurrentLinkedDeque<Ask> ASKS = new ConcurrentLinkedDeque<>();
	private static volatile String notice;
	private static volatile long noticeUntil;
	private static volatile Thread poller;
	private static boolean yWas;
	private static boolean nWas;

	public static boolean available() {
		return BRIDGE != null && !BRIDGE.isBlank();
	}

	public static boolean hosting() {
		return hosting;
	}

	/** The pause menu's "Open to Nimbus LAN". */
	public static void open() {
		if (!available() || hosting) return;
		int port = Compat.publishLan();
		if (port <= 0) {
			notice("Couldn't open your world to Nimbus LAN", 6000);
			return;
		}
		JsonObject body = new JsonObject();
		body.addProperty("port", port);
		body.addProperty("world", Compat.worldName());
		body.addProperty("mc", System.getProperty("nimbus.mc", ""));
		body.addProperty("loader", System.getProperty("nimbus.loader", ""));
		post("host", body);
		hosting = true;
		notice("Your world is on Nimbus LAN · friends can ask to join from their launcher", 8000);
		startPoller();
	}

	static void stop() {
		if (!hosting) return;
		hosting = false;
		ASKS.clear();
		post("unhost", new JsonObject());
	}

	private static void startPoller() {
		if (poller != null && poller.isAlive()) return;
		poller = new Thread(() -> {
			while (hosting) {
				try {
					HttpResponse<String> r = HTTP.send(HttpRequest.newBuilder(URI.create(BRIDGE + "/events")).timeout(Duration.ofSeconds(3)).GET().build(), HttpResponse.BodyHandlers.ofString());
					JsonArray events = JsonParser.parseString(r.body()).getAsJsonObject().getAsJsonArray("events");
					for (JsonElement e : events) handle(e.getAsJsonObject());
				} catch (Throwable ignored) {
					// launcher busy or gone: try again
				}
				try {
					Thread.sleep(1000);
				} catch (InterruptedException e) {
					return;
				}
			}
		}, "Nimbus LAN");
		poller.setDaemon(true);
		poller.start();
	}

	private static void handle(JsonObject e) {
		String type = e.get("type").getAsString();
		String id = e.has("id") ? e.get("id").getAsString() : "";
		String name = e.has("name") ? e.get("name").getAsString() : "Someone";
		switch (type) {
			case "join-request" -> ASKS.add(new Ask(id, name, System.currentTimeMillis()));
			case "join-cancel" -> {
				ASKS.removeIf((a) -> a.id.equals(id));
				notice(name + " stopped asking", 4000);
			}
			case "joining" -> notice("Letting " + name + " in…", 6000);
			default -> {
			}
		}
	}

	static void decide(Ask ask, boolean allow) {
		ASKS.remove(ask);
		JsonObject body = new JsonObject();
		body.addProperty("id", ask.id);
		body.addProperty("allow", allow);
		post("decide", body);
		if (!allow) notice("Told " + ask.name + " no", 3000);
	}

	private static void post(String action, JsonObject body) {
		if (!available()) return;
		HttpRequest req = HttpRequest.newBuilder(URI.create(BRIDGE + "/" + action)).timeout(Duration.ofSeconds(3))
			.POST(HttpRequest.BodyPublishers.ofString(body.toString())).header("content-type", "application/json").build();
		HTTP.sendAsync(req, HttpResponse.BodyHandlers.discarding());
	}

	static void notice(String text, long ms) {
		notice = text;
		noticeUntil = System.currentTimeMillis() + ms;
	}

	/** Every frame: keys for the question, and noticing when the world closes. */
	static void tick() {
		if (hosting && !Compat.inSingleplayer()) stop();
		long now = System.currentTimeMillis();
		ASKS.removeIf((a) -> now - a.at > ASK_SECONDS * 1000L);
		Ask ask = ASKS.peekFirst();
		Screen open = Compat.screen();
		boolean free = open == null || open instanceof PauseScreen;
		boolean y = free && ask != null && Compat.keyDown(Compat.KEY_Y);
		boolean n = free && ask != null && Compat.keyDown(Compat.KEY_N);
		if (ask != null && y && !yWas) decide(ask, true);
		else if (ask != null && n && !nWas) decide(ask, false);
		yWas = y;
		nWas = n;
	}

	/** The question (or a short notice) at the top of the screen. */
	public static void draw(Canvas c) {
		Ask ask = ASKS.peekFirst();
		long now = System.currentTimeMillis();
		String title;
		String line;
		if (ask != null) {
			long left = Math.max(0, ASK_SECONDS - (now - ask.at) / 1000);
			title = ask.name + " wants to join your world";
			line = "[Y] Let them in   [N] No   · " + left + "s";
		} else if (notice != null && now < noticeUntil) {
			title = notice;
			line = null;
		} else {
			return;
		}
		int w = Math.max(c.textWidth(title), line == null ? 0 : c.textWidth(line)) + 44;
		int h = line == null ? 24 : 34;
		int x = (c.width() - w) / 2;
		int y = 8;
		float pulse = ask != null ? 0.5f + 0.5f * (float) Math.sin(now / 180.0) : 0f;
		c.rect(x - 1, y - 1, x + w + 1, y + h + 1, NimbusArt.argb(NimbusArt.mix(0x7C5CFF, 0xF472B6, pulse), 0.9f));
		c.rect(x, y, x + w, y + h, 0xF0120E26);
		NimbusArt.logo(c, x + 16, y + h / 2, 5, 1, now / 1000f, 1f, true);
		c.text(title, x + 32, y + (line == null ? 8 : 6), 0xFFFFFFFF, true);
		if (line != null) c.text(line, x + 32, y + 19, 0xFFC4B5FD, false);
	}
}
