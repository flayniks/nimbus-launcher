package dev.flayniks.nimbus;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import net.minecraft.client.Minecraft;
import net.minecraft.network.protocol.ping.ServerboundPingRequestPacket;

/**
 * Your real ping. Vanilla only updates your latency in the tab list every 30 seconds, and many
 * servers never send it, so the Ping box used to sit at 0. From 1.20.2 the game can ping the
 * server itself (F3's network chart does), so this sends one of those pings every two seconds
 * and times the answer. On 1.20 and 1.20.1 the box falls back to the tab list.
 */
final class Ping {
	private Ping() {
	}

	private static volatile int rtt = -1;
	private static volatile long measuredAt;
	private static volatile long lastEcho = Long.MIN_VALUE;
	private static long sentAt;
	private static Object connection;
	private static boolean works = true;
	private static Field timeField;

	/** Every frame while the Ping box is on: sends a ping now and then. */
	static void tick(Minecraft mc) {
		if (!works) return;
		long now = Compat.millis();
		if (now - sentAt < 2000) return;
		sentAt = now;
		try {
			var c = mc.getConnection();
			if (c != connection) {
				// another server (or none): forget the old number
				connection = c;
				rtt = -1;
			}
			if (c != null) c.send(new ServerboundPingRequestPacket(now));
		} catch (Throwable t) {
			works = false; // 1.20.1 and older: no in-game ping
		}
	}

	/** The server's answer, from PingMixin (on the network thread, then again on the game thread). */
	static void pong(Object packet) {
		long sent = time(packet);
		if (sent == Long.MIN_VALUE || sent == lastEcho) return;
		lastEcho = sent;
		long d = Compat.millis() - sent;
		if (d < 0 || d > 60_000) return;
		rtt = rtt < 0 ? (int) d : Math.round(rtt * 0.4f + d * 0.6f);
		measuredAt = System.currentTimeMillis();
	}

	/** The measured ping in milliseconds, or -1 without a recent measurement. */
	static int value() {
		return rtt >= 0 && System.currentTimeMillis() - measuredAt < 8000 ? rtt : -1;
	}

	/** The time the ping carried: a field whose name changed in 1.20.5, so it's found by type. */
	private static long time(Object packet) {
		try {
			if (timeField == null) {
				for (Field f : packet.getClass().getDeclaredFields()) {
					if (f.getType() == long.class && !Modifier.isStatic(f.getModifiers())) {
						f.setAccessible(true);
						timeField = f;
						break;
					}
				}
			}
			return timeField == null ? Long.MIN_VALUE : timeField.getLong(packet);
		} catch (ReflectiveOperationException | RuntimeException e) {
			return Long.MIN_VALUE;
		}
	}
}
