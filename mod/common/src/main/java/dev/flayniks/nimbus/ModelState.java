package dev.flayniks.nimbus;

import java.util.EnumSet;
import java.util.Set;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.player.PlayerModelPart;

/**
 * Your player model's powers: its form, its face and its power (on or off), switched in the
 * Powers menu (G). Everyone else sees them through the seven skin-layer switches (jacket, sleeves,
 * hat...), which every server passes on to everyone at once: while you wear a model with powers,
 * Nimbus sends its state in them instead of your skin settings (the model hides your skin anyway,
 * and your settings come back the moment you take it off).
 *
 * The seven bits: the face (0-31), the form (32) and the power (64). A face past the model's last
 * one (as with every layer on, 127) means "not set": the first face, the first form, no power.
 */
public final class ModelState {
	private ModelState() {
	}

	private static String wornId;
	private static int form;
	private static int face;
	private static boolean power;
	private static long lastSent;
	private static boolean pending;

	/** The model you wear, if it's one Nimbus knows. */
	public static CosmeticModel.Item worn() {
		String[] own = Cosmetics.own();
		String id = own.length > 4 ? own[4] : null;
		CosmeticModel.Item it = id == null ? null : CosmeticModel.items().get(id);
		return it != null && it.model != null ? it : null;
	}

	/** Your model's state (remembered for each model). */
	static CosmeticModel.State own() {
		CosmeticModel.Item it = worn();
		sync(it);
		CosmeticModel.State s = new CosmeticModel.State();
		s.form = form;
		s.face = face;
		s.power = power;
		return s;
	}

	public static int form() {
		sync(worn());
		return form;
	}

	public static int face() {
		sync(worn());
		return face;
	}

	public static boolean power() {
		sync(worn());
		return power;
	}

	/** Switches to another model: its remembered state, sent to everyone. */
	private static void sync(CosmeticModel.Item it) {
		String id = it == null ? null : it.id;
		if (java.util.Objects.equals(id, wornId)) return;
		wornId = id;
		if (it == null) {
			form = 0;
			face = 0;
			power = false;
		} else {
			int saved = NimbusConfig.value("model." + it.id, 0);
			int[] st = decode(saved, it.model);
			form = st[0];
			face = st[1];
			power = st[2] == 1;
		}
		send();
	}

	public static void set(int newForm, int newFace, boolean newPower) {
		CosmeticModel.Item it = worn();
		if (it == null) return;
		sync(it);
		form = Math.max(0, Math.min(newForm, Math.max(0, it.model.forms.length - 1)));
		face = Math.max(0, Math.min(newFace, Math.max(0, it.model.faces.length - 1)));
		power = newPower && it.model.power != null;
		NimbusConfig.set("model." + it.id, encode());
		send();
	}

	static int encode() {
		return (face & 31) | (form & 1) << 5 | (power ? 64 : 0);
	}

	/** {form, face, power} from the seven bits, for a model. */
	static int[] decode(int bits, CosmeticModel.Model m) {
		int f = bits & 31;
		int fo = bits >> 5 & 1;
		int p = bits >> 6 & 1;
		if (f >= Math.max(1, m.faces.length)) return new int[] {0, 0, 0};
		if (fo >= Math.max(1, m.forms.length)) fo = 0;
		if (m.power == null) p = 0;
		return new int[] {fo, f, p};
	}

	/** Another player's model state, from their skin-layer switches. */
	static CosmeticModel.State of(Player p, CosmeticModel.Model m) {
		int[] st = decode(Compat.modelParts(p), m);
		CosmeticModel.State s = new CosmeticModel.State();
		s.form = st[0];
		s.face = st[1];
		s.power = st[2] == 1;
		return s;
	}

	/**
	 * What the game sends as your skin layers: your settings, or while you wear a model with powers,
	 * its state (Options' mixin calls this when it builds the packet).
	 */
	public static Set<PlayerModelPart> parts(Set<PlayerModelPart> real) {
		try {
			CosmeticModel.Item it = worn();
			sync(it);
			if (it == null || !it.model.powers()) return real;
			int bits = encode();
			Set<PlayerModelPart> out = EnumSet.noneOf(PlayerModelPart.class);
			for (PlayerModelPart part : PlayerModelPart.values()) if ((bits & part.getMask()) != 0) out.add(part);
			return out;
		} catch (Throwable t) {
			return real;
		}
	}

	/** Sends your skin layers (that is, the state) to the server, a few times a second at most. */
	private static void send() {
		pending = true;
		tick();
	}

	/** Called every frame by the HUD: sends a waiting change, and notices a model put on or off. */
	public static void tick() {
		try {
			sync(worn());
			if (!pending) return;
			long now = System.currentTimeMillis();
			if (now - lastSent < 250) return;
			Minecraft mc = Minecraft.getInstance();
			if (mc.player == null || mc.getConnection() == null) return;
			pending = false;
			lastSent = now;
			mc.execute(() -> mc.options.broadcastOptions());
		} catch (Throwable ignored) {
			// not in a world yet
		}
	}
}
