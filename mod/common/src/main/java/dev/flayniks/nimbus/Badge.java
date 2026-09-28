package dev.flayniks.nimbus;

import java.util.UUID;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;
import net.minecraft.network.chat.TextColor;

/** The Nimbus badge: a little violet cloud before the name of every player on Nimbus. */
public final class Badge {
	private Badge() {
	}

	private static final String CLOUD = "☁ ";
	private static final int COLOUR = 0xA78BFA;

	private static java.lang.reflect.Method idMethod;

	/** A GameProfile's uuid: getId() up to 1.21.8, id() since profiles became records in 1.21.9. */
	public static UUID profileId(Object profile) {
		if (profile == null) return null;
		try {
			if (idMethod == null || !idMethod.getDeclaringClass().isInstance(profile)) {
				java.lang.reflect.Method m;
				try {
					m = profile.getClass().getMethod("getId");
				} catch (NoSuchMethodException e) {
					m = profile.getClass().getMethod("id");
				}
				idMethod = m;
			}
			return (UUID) idMethod.invoke(profile);
		} catch (ReflectiveOperationException | ClassCastException e) {
			return null;
		}
	}

	public static boolean enabled() {
		return NimbusConfig.on("badge.nametag", true);
	}

	/** `name` with the badge in front, when the player is on Nimbus (and badges are on). */
	public static Component decorate(UUID uuid, String plain, Component name) {
		if (name == null || !enabled() || !Cosmetics.isNimbus(uuid, plain)) return name;
		if (name.getString().startsWith(CLOUD)) return name;
		MutableComponent out = Component.literal(CLOUD).withStyle(Style.EMPTY.withColor(TextColor.fromRgb(COLOUR)));
		return out.append(name);
	}
}
