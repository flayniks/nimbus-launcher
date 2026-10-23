package dev.flayniks.nimbus;

import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/**
 * Your player model's powers (G): its faces, as pictures to click, its forms and its power. What
 * you pick shows on you straight away, for everyone (see ModelState). Like the other Nimbus menus,
 * vanilla buttons sit underneath (unpainted) for clicks, and everything is painted here.
 */
public abstract class PowersScreenBase extends Screen {
	private static final class Slot {
		Button button;
		String kind; // "face", "form", "power", "done"
		int index;
		String label;
	}

	protected final Screen parent;
	private final List<Slot> slots = new ArrayList<>();
	private final long openedAt = System.nanoTime();
	private boolean gWasDown = true; // the G that opened the menu is still held
	private CosmeticModel.Item item;

	protected PowersScreenBase(Screen parent) {
		super(Component.literal("Powers"));
		this.parent = parent;
	}

	@Override
	public void onClose() {
		Compat.setScreen(parent);
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	// ------------------------------------------------------------------ layout

	@Override
	protected void init() {
		slots.clear();
		item = ModelState.worn();
		if (item == null) return;
		CosmeticModel.Model m = item.model;
		int cw = Math.min(width - 16, 460);
		int left = (width - cw) / 2;
		int y = 40;
		if (m.faces.length > 1) {
			int tile = 50;
			int gap = 4;
			int perRow = Math.max(1, (cw + gap) / (tile + gap));
			int rows = (m.faces.length + perRow - 1) / perRow;
			int roomY = height - 80 - (m.forms.length > 1 || m.power != null ? 30 : 0) - y - 12;
			// smaller tiles when the screen is short
			if (rows * (tile + 10 + gap) > roomY) {
				tile = Math.max(30, roomY / rows - 10 - gap);
				perRow = Math.max(1, (cw + gap) / (tile + gap));
				rows = (m.faces.length + perRow - 1) / perRow;
			}
			int rowW = Math.min(m.faces.length, perRow) * (tile + gap) - gap;
			int x0 = (width - rowW) / 2;
			y += 12;
			for (int i = 0; i < m.faces.length; i++) {
				int r = i / perRow;
				int c = i % perRow;
				add("face", i, m.faces[i], x0 + c * (tile + gap), y + r * (tile + 10 + gap), tile, tile + 10);
			}
			y += rows * (tile + 10 + gap) + 8;
		}
		if (m.forms.length > 1 || m.power != null) {
			int bw = 96;
			int n = (m.forms.length > 1 ? m.forms.length : 0) + (m.power != null ? 1 : 0);
			int x = (width - (n * (bw + 4) - 4)) / 2;
			if (m.forms.length > 1) {
				for (int i = 0; i < m.forms.length; i++) {
					add("form", i, m.forms[i], x, y + 12, bw, 20);
					x += bw + 4;
				}
			}
			if (m.power != null) add("power", 0, m.power, x, y + 12, bw, 20);
		}
		add("done", 0, "Done", width / 2 - 50, height - 28, 100, 20);
	}

	private void add(String kind, int index, String label, int x, int y, int w, int h) {
		Slot s = new Slot();
		s.kind = kind;
		s.index = index;
		s.label = label;
		s.button = Button.builder(Component.literal(label), b -> click(s)).bounds(x, y, w, h).build();
		addWidget(s.button);
		slots.add(s);
	}

	private void click(Slot s) {
		switch (s.kind) {
			case "face" -> ModelState.set(ModelState.form(), s.index, ModelState.power());
			case "form" -> ModelState.set(s.index, ModelState.face(), ModelState.power());
			case "power" -> ModelState.set(ModelState.form(), ModelState.face(), !ModelState.power());
			default -> onClose();
		}
	}

	/** The picture a face of the model wears, if its face is a picture. */
	private static String facePicture(CosmeticModel.Item it, int face) {
		for (CosmeticModel.Part p : it.parts) {
			String t = facePicture(p, face, false);
			if (t != null) return t;
		}
		return null;
	}

	private static String facePicture(CosmeticModel.Part p, int face, boolean inFace) {
		boolean here = inFace || p.we == face;
		if (p.we >= 0 && p.we != face) return null;
		if (here) for (CosmeticModel.Shape s : p.shapes) if (s.tex != null) return s.tex;
		for (CosmeticModel.Part c : p.children) {
			String t = facePicture(c, face, here);
			if (t != null) return t;
		}
		return null;
	}

	// ------------------------------------------------------------------ painting

	/** The whole frame; the version-specific subclass calls this from its render method. */
	protected void paint(Canvas c, int mx, int my) {
		long ms = (System.nanoTime() - openedAt) / 1_000_000L;
		float t = ms / 1000f;
		Minecraft mc = Minecraft.getInstance();
		NimbusArt.menuBackdrop(c, ms, mc.level == null);

		// G closes it again
		boolean g = Compat.keyDown(Compat.KEY_G);
		if (g && !gWasDown) onClose();
		gWasDown = g;

		String title = item == null ? "Powers" : item.name + " · powers";
		int tw = c.textWidth(title);
		int tx = (width - tw) / 2 + 13;
		NimbusArt.logo(c, tx - 17, 12, 8, 1, t, NimbusArt.easeOutCubic(NimbusArt.clamp01(t / 0.35f)), NimbusArt.MENU_MOTION);
		c.text(title, tx, 9, Ui.TEXT, true);
		if (item == null) {
			String none = "You're not wearing a player model. Pick one in the launcher: Cosmetics, Models.";
			c.text(Ui.fit(c, none, width - 24), (width - Math.min(c.textWidth(none), width - 24)) / 2, 40, Ui.MUTED, false);
			for (Slot s : slots) Ui.button(c, s.button, s.label, true, false, mx, my);
			return;
		}
		String hint = "Everyone sees what you pick · G closes this";
		c.text(Ui.fit(c, hint, width - 24), (width - Math.min(c.textWidth(hint), width - 24)) / 2, 21, Ui.MUTED, false);

		CosmeticModel.Model m = item.model;
		int face = ModelState.face();
		int form = ModelState.form();
		boolean power = ModelState.power();
		boolean facesTitle = false;
		boolean formsTitle = false;
		for (Slot s : slots) {
			Button b = s.button;
			int x1 = b.getX();
			int y1 = b.getY();
			int x2 = x1 + b.getWidth();
			int y2 = y1 + b.getHeight();
			boolean hover = Ui.hovered(b, mx, my);
			switch (s.kind) {
				case "face" -> {
					if (!facesTitle) {
						facesTitle = true;
						c.text("Faces", (width - c.textWidth("Faces")) / 2, y1 - 11, Ui.MUTED, false);
					}
					boolean on = s.index == face;
					Ui.panel(c, x1, y1, x2, y2, on ? 0xFF2D2560 : hover ? 0xFF22263A : 0xE0181B29, on ? Ui.ACCENT : hover ? 0xFF4C5480 : 0xFF262B40);
					int pic = b.getWidth() - 6;
					String tex = facePicture(item, s.index);
					if (tex != null) c.picture(tex, x1 + 3, y1 + 3, pic, pic);
					else c.text(String.valueOf(s.index + 1), x1 + (b.getWidth() - c.textWidth(String.valueOf(s.index + 1))) / 2, y1 + pic / 2, Ui.TEXT, false);
					String name = Ui.fit(c, s.label, b.getWidth() + 8);
					c.push(x1 + b.getWidth() / 2f, y2 - 8, 0.6f);
					c.text(name, -c.textWidth(name) / 2, 0, on ? Ui.TEXT : Ui.MUTED, false);
					c.pop();
				}
				case "form" -> {
					if (!formsTitle) {
						formsTitle = true;
						c.text("Form", (width - c.textWidth("Form")) / 2 - (m.power != null ? 50 : 0), y1 - 11, Ui.MUTED, false);
					}
					Ui.button(c, b, s.label, false, s.index == form, mx, my);
				}
				case "power" -> Ui.button(c, b, s.label + (power ? ": on" : ": off"), power, false, mx, my);
				default -> Ui.button(c, b, s.label, false, false, mx, my);
			}
		}
	}
}
