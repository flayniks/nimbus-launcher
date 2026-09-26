package dev.flayniks.nimbus;

import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;

/**
 * Tells the launcher where you are (the menus, a singleplayer world, which server) over the
 * same local bridge Nimbus LAN uses, for your Discord status. Only sent when it changes, and
 * again every half minute in case the launcher missed it.
 */
public final class GameStatus {
	private GameStatus() {
	}

	private static String last = "";
	private static long checkedAt;
	private static long sentAt;

	/** Called while menus and the HUD draw; cheap, and does real work about once a second. */
	public static void frame() {
		if (!NimbusLan.available()) return;
		long now = System.currentTimeMillis();
		if (now - checkedAt < 1000) return;
		checkedAt = now;
		JsonObject o = new JsonObject();
		try {
			Minecraft mc = Minecraft.getInstance();
			if (mc.level == null) {
				o.addProperty("where", "menu");
			} else if (mc.getSingleplayerServer() != null) {
				o.addProperty("where", "singleplayer");
				o.addProperty("world", Compat.worldName());
				o.addProperty("lan", NimbusLan.hosting());
			} else {
				o.addProperty("where", "multiplayer");
				ServerData d = mc.getCurrentServer();
				if (d != null && d.ip != null) o.addProperty("server", d.ip);
			}
		} catch (Throwable t) {
			return;
		}
		String s = o.toString();
		if (s.equals(last) && now - sentAt < 30_000) return;
		last = s;
		sentAt = now;
		NimbusLan.post("status", o);
	}
}
