package dev.flayniks.nimbus;

import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/**
 * Drag HUD modules wherever you like and resize them. Dragging is read straight from
 * the mouse every frame (the mouse event methods changed shape across versions), and
 * boxes snap to the screen edges and centre lines.
 */
public abstract class HudEditorBase extends Screen {
	private static final int SNAP = 5;

	protected final Screen parent;
	private final long openedAt = System.nanoTime();
	private final List<Button> buttons = new ArrayList<>();
	private final List<String> labels = new ArrayList<>();
	private String selected;
	private String dragging;
	private int grabX;
	private int grabY;
	private boolean wasDown = true; // the click that opened the editor is still held
	private boolean snapX;
	private boolean snapY;
	// the size toolbar: real buttons (so clicks never slip between frames) that follow the selection
	private Button minus;
	private Button plus;
	private Button hide;

	protected HudEditorBase(Screen parent) {
		super(Component.literal("Edit HUD layout"));
		this.parent = parent;
		NimbusHud.editing = true;
	}

	@Override
	public void onClose() {
		NimbusHud.editing = false;
		Compat.setScreen(parent);
	}

	@Override
	public void removed() {
		NimbusHud.editing = false;
	}

	@Override
	protected void init() {
		NimbusHud.editing = true;
		buttons.clear();
		labels.clear();
		int y = height - 28;
		add("Reset layout", width / 2 - 104, y, 100, () -> {
			NimbusConfig.clearPlaces();
			selected = null;
		});
		add("Done", width / 2 + 4, y, 100, this::onClose);
		minus = tool(() -> resizeSelected(-0.1f));
		plus = tool(() -> resizeSelected(0.1f));
		hide = tool(() -> {
			if (selected != null) NimbusConfig.set("hud." + selected, false);
			selected = null;
		});
	}

	private Button tool(Runnable action) {
		Button b = Button.builder(Component.literal(""), btn -> action.run()).bounds(0, 0, 14, 14).build();
		b.visible = false;
		addWidget(b);
		return b;
	}

	private void resizeSelected(float by) {
		for (NimbusHud.Module m : NimbusHud.enabled()) {
			if (!m.id.equals(selected)) continue;
			NimbusConfig.Place p = NimbusConfig.place(m.id);
			float s = Math.round(Math.max(0.5f, Math.min(2.5f, NimbusHud.scale(m) + by)) * 10f) / 10f;
			if (p != null) NimbusConfig.place(m.id, p.x, p.y, s);
			else pendingScale = s;
		}
	}

	private float pendingScale = -1f;

	private void add(String label, int x, int y, int w, Runnable action) {
		Button b = Button.builder(Component.literal(label), btn -> action.run()).bounds(x, y, w, 20).build();
		addWidget(b);
		buttons.add(b);
		labels.add(label);
	}

	/** The whole frame; the version-specific subclass calls this from its render method. */
	protected void paint(Canvas c, int mx, int my) {
		Minecraft mc = Minecraft.getInstance();
		long ms = (System.nanoTime() - openedAt) / 1_000_000L;
		if (mc.level == null) NimbusArt.menuBackdrop(c, ms, true);
		else c.rect(0, 0, width, height, 0x40000000);

		List<NimbusHud.Module> mods = NimbusHud.enabled();
		List<int[]> boxes = NimbusHud.layout(c, mods);

		handleMouse(c, mc, mx, my, mods, boxes);

		// guides while dragging
		if (dragging != null) {
			if (snapX) c.rect(width / 2, 0, width / 2 + 1, height, 0x807C5CFF);
			if (snapY) c.rect(0, height / 2, width, height / 2 + 1, 0x807C5CFF);
		}

		String hovered = null;
		for (int i = mods.size() - 1; i >= 0; i--) {
			int[] r = boxes.get(i);
			if (Ui.inside(mx, my, r[0], r[1], r[0] + r[2], r[1] + r[3])) {
				hovered = mods.get(i).id;
				break;
			}
		}
		for (int i = 0; i < mods.size(); i++) {
			NimbusHud.Module m = mods.get(i);
			int[] r = boxes.get(i);
			NimbusHud.draw(c, m, r);
			boolean sel = m.id.equals(selected);
			boolean hov = m.id.equals(hovered);
			int edge = sel ? Ui.ACCENT : hov ? 0xC0FFFFFF : 0x60FFFFFF;
			outline(c, r[0] - 1, r[1] - 1, r[0] + r[2] + 1, r[1] + r[3] + 1, edge, sel || hov);
			if (hov && !sel && dragging == null) {
				String name = m.title;
				int ly = r[1] > 12 ? r[1] - 11 : r[1] + r[3] + 3;
				c.rect(r[0] - 1, ly - 1, r[0] + c.textWidth(name) + 3, ly + 9, 0xC0000000);
				c.text(name, r[0] + 1, ly, Ui.TEXT, false);
			}
		}

		// size toolbar for the selected module
		boolean shown = false;
		for (int i = 0; i < mods.size(); i++) {
			if (!mods.get(i).id.equals(selected)) continue;
			int[] r = boxes.get(i);
			NimbusHud.Module m = mods.get(i);
			if (pendingScale > 0) {
				// first resize of a module that was never moved: pin it where it is
				NimbusConfig.place(m.id, r[0] / (float) width, r[1] / (float) height, pendingScale);
				pendingScale = -1f;
			}
			String pct = Math.round(NimbusHud.scale(m) * 100) + "%";
			int pw = c.textWidth(pct) + 8;
			int w = 14 + 4 + pw + 4 + 14 + 4 + 14;
			int tx = Math.max(2, Math.min(width - w - 2, r[0]));
			int ty = r[1] + r[3] + 4 + 14 <= height - 32 ? r[1] + r[3] + 4 : r[1] - 18;
			place(minus, tx, ty);
			place(plus, tx + 18 + pw + 4, ty);
			place(hide, tx + 18 + pw + 4 + 18, ty);
			tool(c, minus, "-", mx, my);
			Ui.panel(c, tx + 18, ty, tx + 18 + pw, ty + 14, 0xE0101320, 0xFF2E3350);
			c.text(pct, tx + 22, ty + 3, Ui.TEXT, false);
			tool(c, plus, "+", mx, my);
			tool(c, hide, "×", mx, my);
			c.text(m.title, tx, ty + 17 <= height - 32 ? ty + 17 : ty - 11, Ui.ACCENT_2, true);
			shown = true;
		}
		if (!shown) {
			minus.visible = false;
			plus.visible = false;
			hide.visible = false;
		}

		String hint = mods.isEmpty() ? "No HUD boxes are on. Switch some on in the HUD tab first."
			: "Drag boxes to move them · click one for its size · × hides it";
		c.text(hint, (width - c.textWidth(hint)) / 2, height - 42, Ui.TEXT, true);
		for (int i = 0; i < buttons.size(); i++) Ui.button(c, buttons.get(i), labels.get(i), labels.get(i).equals("Done"), false, mx, my);
	}

	private static void place(Button b, int x, int y) {
		b.setX(x);
		b.setY(y);
		b.visible = true;
	}

	private void tool(Canvas c, Button b, String label, int mx, int my) {
		int x = b.getX();
		int y = b.getY();
		boolean hover = Ui.hovered(b, mx, my);
		Ui.panel(c, x, y, x + 14, y + 14, hover ? 0xFF9075FF : 0xE0101320, hover ? 0xFFD7C8FF : Ui.ACCENT);
		c.text(label, x + (14 - c.textWidth(label) + 1) / 2, y + 3, Ui.TEXT, false);
	}

	private static void outline(Canvas c, int x1, int y1, int x2, int y2, int color, boolean solid) {
		if (solid) {
			c.rect(x1, y1, x2, y1 + 1, color);
			c.rect(x1, y2 - 1, x2, y2, color);
			c.rect(x1, y1, x1 + 1, y2, color);
			c.rect(x2 - 1, y1, x2, y2, color);
			return;
		}
		for (int x = x1; x < x2; x += 4) {
			c.rect(x, y1, Math.min(x + 2, x2), y1 + 1, color);
			c.rect(x, y2 - 1, Math.min(x + 2, x2), y2, color);
		}
		for (int y = y1; y < y2; y += 4) {
			c.rect(x1, y, x1 + 1, Math.min(y + 2, y2), color);
			c.rect(x2 - 1, y, x2, Math.min(y + 2, y2), color);
		}
	}

	/** Whether the left mouse button is held right now (vanilla only tracks it while no screen is open). */
	protected abstract boolean leftDown();

	// where a click landed, when the version tells us (so a fast drag still grabs the right box)
	private int pressX = Integer.MIN_VALUE;
	private int pressY;

	protected void pressedAt(double x, double y) {
		pressX = (int) x;
		pressY = (int) y;
	}

	private void handleMouse(Canvas c, Minecraft mc, int mx, int my, List<NimbusHud.Module> mods, List<int[]> boxes) {
		boolean down;
		try {
			down = leftDown();
		} catch (Throwable t) {
			return;
		}
		boolean pressed = down && !wasDown;
		wasDown = down;
		if (pressed && pressX != Integer.MIN_VALUE) {
			mx = pressX;
			my = pressY;
		}
		pressX = Integer.MIN_VALUE;

		if (pressed) {
			for (Button b : buttons) if (Ui.inside(mx, my, b.getX(), b.getY(), b.getX() + b.getWidth(), b.getY() + b.getHeight())) return;
			for (Button b : new Button[] {minus, plus, hide}) {
				if (b.visible && Ui.inside(mx, my, b.getX(), b.getY(), b.getX() + b.getWidth(), b.getY() + b.getHeight())) return;
			}
			for (int i = mods.size() - 1; i >= 0; i--) {
				int[] r = boxes.get(i);
				if (Ui.inside(mx, my, r[0], r[1], r[0] + r[2], r[1] + r[3])) {
					selected = mods.get(i).id;
					dragging = selected;
					grabX = mx - r[0];
					grabY = my - r[1];
					return;
				}
			}
			selected = null;
		}

		if (dragging != null) {
			NimbusHud.Module m = find(mods, dragging);
			if (m == null || !down) {
				dragging = null;
				NimbusConfig.save();
				return;
			}
			int[] r = boxes.get(mods.indexOf(m));
			int x = mx - grabX;
			int y = my - grabY;
			// snap to the edges and the centre lines
			snapX = false;
			snapY = false;
			if (Math.abs(x) < SNAP) x = 0;
			if (Math.abs(y) < SNAP) y = 0;
			if (Math.abs(x + r[2] - width) < SNAP) x = width - r[2];
			if (Math.abs(y + r[3] - height) < SNAP) y = height - r[3];
			if (Math.abs(x + r[2] / 2 - width / 2) < SNAP) {
				x = width / 2 - r[2] / 2;
				snapX = true;
			}
			if (Math.abs(y + r[3] / 2 - height / 2) < SNAP) {
				y = height / 2 - r[3] / 2;
				snapY = true;
			}
			x = Math.max(0, Math.min(width - r[2], x));
			y = Math.max(0, Math.min(height - r[3], y));
			NimbusConfig.place(m.id, x / (float) width, y / (float) height, NimbusHud.scale(m), false);
		}
	}

	private static NimbusHud.Module find(List<NimbusHud.Module> mods, String id) {
		for (NimbusHud.Module m : mods) if (m.id.equals(id)) return m;
		return null;
	}
}
