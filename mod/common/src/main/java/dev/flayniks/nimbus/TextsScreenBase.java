package dev.flayniks.nimbus;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/**
 * Your texts: write up to 20 lines of your own to show on the screen, each with a colour and a
 * style, switched on and off one by one. They're HUD boxes, so Edit HUD layout moves and sizes
 * them. Like the other Nimbus menus, vanilla widgets sit underneath (unpainted) for typing and
 * clicks, and everything is painted here.
 */
public abstract class TextsScreenBase extends Screen {
	private static final int ENTER = 257;
	private static final int KEYPAD_ENTER = 335;

	private static final class Slot {
		Button button;
		String label;
		String kind; // "add", "save", "cancel", "toggle", "text", "color", "style", "edit", "remove", "footer", "primary"
		NimbusConfig.Text text;
	}

	protected final Screen parent;
	private final List<Slot> slots = new ArrayList<>();
	private final Map<String, Float> knobs = new HashMap<>();
	private final long openedAt = System.nanoTime();
	private EditBox input;
	private String draft = "";
	private String editing; // the id of the text being changed, or null for a new one
	private int newColor;
	private boolean newBox;
	private int page;
	private int pages = 1;
	private boolean enterWasDown = true; // the Enter that opened a menu may still be held
	private String flash = "";
	private long flashAt;
	private int fieldX1;
	private int fieldY1;
	private int fieldX2;
	private int fieldY2;
	// a click hands focus to the clicked button after its action ran, so the field takes it back next frame
	private boolean refocus;

	protected TextsScreenBase(Screen parent) {
		super(Component.literal("Your texts"));
		this.parent = parent;
	}

	@Override
	public void onClose() {
		Compat.setScreen(parent);
	}

	// ------------------------------------------------------------------ layout

	@Override
	protected void init() {
		slots.clear();
		int cw = Math.min(width - 16, 440);
		int left = (width - cw) / 2;
		int right = left + cw;
		int top = 34;
		boolean full = editing == null && NimbusConfig.texts().size() >= NimbusConfig.MAX_TEXTS;

		// the field, and its buttons
		int buttonsW = editing != null ? 50 + 4 + 50 : 70;
		fieldX1 = left;
		fieldY1 = top;
		fieldX2 = right - buttonsW - 4;
		fieldY2 = top + 20;
		input = new EditBox(font, fieldX1 + 4, fieldY1 + 1, fieldX2 - fieldX1 - 8, 18, Component.literal("Your text"));
		input.setMaxLength(NimbusConfig.MAX_TEXT_LENGTH);
		input.setValue(draft);
		addWidget(input);
		if (editing != null) {
			add("Save", "save", right - 104, top, 50, 20, null, this::submit);
			add("Cancel", "cancel", right - 50, top, 50, 20, null, () -> {
				editing = null;
				draft = "";
				refresh();
			});
		} else {
			Slot a = add("Add", "add", right - 70, top, 70, 20, null, this::submit);
			a.button.active = !full;
		}

		// what a new text will look like
		int optY = top + 24;
		if (editing == null) {
			add(colorName(newColor), "newcolor", left, optY, 118, 16, null, () -> {
				newColor = (newColor + 1) % CustomTexts.COLOR_NAMES.length;
				refresh();
			});
			add(newBox ? "In a box" : "Plain", "newstyle", left + 122, optY, 76, 16, null, () -> {
				newBox = !newBox;
				refresh();
			});
		}

		// your texts
		int listTop = optY + 22;
		int footer = height - 28;
		int rowH = 22;
		int gap = 3;
		int perPage = Math.max(1, (footer - 6 - listTop + gap) / (rowH + gap));
		List<NimbusConfig.Text> texts = NimbusConfig.texts();
		pages = Math.max(1, (texts.size() + perPage - 1) / perPage);
		page = Math.max(0, Math.min(page, pages - 1));
		for (int i = 0; i < perPage; i++) {
			int idx = page * perPage + i;
			if (idx >= texts.size()) break;
			NimbusConfig.Text t = texts.get(idx);
			int y = listTop + i * (rowH + gap);
			add("", "toggle", left, y, 30, rowH, t, () -> {
				NimbusConfig.set("hud." + t.id, !NimbusConfig.on("hud." + t.id, true));
				refresh();
			});
			int x2 = right;
			add("", "remove", x2 - 20, y, 20, rowH, t, () -> {
				NimbusConfig.removeText(t.id);
				if (t.id.equals(editing)) {
					editing = null;
					draft = "";
				}
				say("Removed");
				refresh();
			});
			add("Edit", "edit", x2 - 20 - 4 - 34, y, 34, rowH, t, () -> startEdit(t));
			add(t.box ? "Box" : "Plain", "style", x2 - 62 - 4 - 40, y, 40, rowH, t, () -> {
				NimbusConfig.updateText(t.id, t.text, t.color, !t.box);
				refresh();
			});
			add(colorName(t.color), "color", x2 - 106 - 4 - 74, y, 74, rowH, t, () -> {
				NimbusConfig.updateText(t.id, t.text, (t.color + 1) % CustomTexts.COLOR_NAMES.length, t.box);
				refresh();
			});
			add("", "text", left + 32, y, x2 - 184 - 4 - left - 32, rowH, t, () -> startEdit(t));
		}

		// footer
		if (pages > 1) {
			add("<", "footer", left, footer, 20, 20, null, () -> {
				page = (page + pages - 1) % pages;
				refresh();
			});
			add(">", "footer", left + 60, footer, 20, 20, null, () -> {
				page = (page + 1) % pages;
				refresh();
			});
		}
		add("Edit HUD layout", "footer", right - 90 - 4 - 104, footer, 104, 20, null, () -> {
			keepDraft();
			Compat.setScreen(Compat.hudEditor(this));
		});
		add("Done", "primary", right - 90, footer, 90, 20, null, this::onClose);

		// typing goes straight into the field
		setFocused(input);
	}

	private Slot add(String label, String kind, int x, int y, int w, int h, NimbusConfig.Text text, Runnable action) {
		Slot s = new Slot();
		s.label = label;
		s.kind = kind;
		s.text = text;
		s.button = Button.builder(Component.literal(label.isEmpty() ? kind : label), b -> action.run()).bounds(x, y, w, h).build();
		addWidget(s.button);
		slots.add(s);
		return s;
	}

	private static String colorName(int i) {
		return CustomTexts.COLOR_NAMES[Math.floorMod(i, CustomTexts.COLOR_NAMES.length)];
	}

	private void keepDraft() {
		if (input != null) draft = input.getValue();
	}

	/** Lays the screen out again, keeping what's typed and the focus in the field. */
	private void refresh() {
		keepDraft();
		rebuildWidgets();
		refocus = true;
	}

	private void startEdit(NimbusConfig.Text t) {
		editing = t.id;
		draft = t.text;
		refresh();
	}

	private void submit() {
		String value = input == null ? draft : input.getValue();
		if (CustomTexts.plain(value).trim().isEmpty()) {
			say("Type something first");
			return;
		}
		if (editing != null) {
			NimbusConfig.Text t = NimbusConfig.text(editing);
			if (t != null) NimbusConfig.updateText(t.id, value, t.color, t.box);
			editing = null;
			say("Saved");
		} else {
			int n = NimbusConfig.texts().size();
			NimbusConfig.Text t = NimbusConfig.addText(value, newColor, newBox);
			if (t == null) {
				say("That's 20 texts, the most. Remove one first");
				return;
			}
			// new texts start near the middle, a little apart, so they don't land on each other
			NimbusConfig.place(t.id, 0.36f + (n % 4) * 0.02f, 0.18f + (n % 12) * 0.05f, 1f);
			say("Added. Move it with Edit HUD layout");
		}
		draft = "";
		rebuildWidgets();
		refocus = true;
	}

	private void say(String message) {
		flash = message;
		flashAt = System.nanoTime();
	}

	// ------------------------------------------------------------------ painting

	/** The whole frame; the version-specific subclass calls this from its render method. */
	protected void paint(Canvas c, int mx, int my) {
		long ms = (System.nanoTime() - openedAt) / 1_000_000L;
		float t = ms / 1000f;
		Minecraft mc = Minecraft.getInstance();
		NimbusArt.menuBackdrop(c, ms, mc.level == null);

		if (refocus && input != null) {
			setFocused(input);
			refocus = false;
		}
		// Enter adds (or saves) what's typed
		boolean enter = input != null && input.isFocused() && (Compat.keyDown(ENTER) || Compat.keyDown(KEYPAD_ENTER));
		if (enter && !enterWasDown) submit();
		enterWasDown = enter;

		String title = "Your texts";
		int tw = c.textWidth(title);
		int tx = (width - tw) / 2 + 13;
		NimbusArt.logo(c, tx - 17, 12, 8, 1, t, NimbusArt.easeOutCubic(NimbusArt.clamp01(t / 0.35f)), NimbusArt.MENU_MOTION);
		c.text(title, tx, 9, Ui.TEXT, true);

		int count = NimbusConfig.texts().size();
		String hint = (System.nanoTime() - flashAt) / 1_000_000L < 2600 && !flash.isEmpty() ? flash
			: editing != null ? "Change the text, then Save (or press Enter)"
			: count >= NimbusConfig.MAX_TEXTS ? "That's 20 texts, the most. Remove one to add another"
			: "Up to 20 texts on your screen · &c &a &e… colour parts of a text";
		for (Slot s : slots) {
			if (!Ui.hovered(s.button, mx, my) || s.button.isFocused() && !Ui.inside(mx, my, s.button.getX(), s.button.getY(), s.button.getX() + s.button.getWidth(), s.button.getY() + s.button.getHeight())) continue;
			switch (s.kind) {
				case "toggle" -> hint = NimbusConfig.on("hud." + s.text.id, true) ? "Shown on your screen. Click to hide it" : "Hidden. Click to show it";
				case "color", "newcolor" -> hint = "Click for the next colour";
				case "style", "newstyle" -> hint = "Plain text, or in a box like the other HUD boxes";
				case "edit", "text" -> hint = "Change this text";
				case "remove" -> hint = "Remove this text";
				default -> { }
			}
		}
		String line = Ui.fit(c, hint, width - 24);
		c.text(line, (width - c.textWidth(line)) / 2, 21, Ui.MUTED, false);

		paintField(c, ms);
		for (Slot s : slots) paintSlot(c, s, mx, my, ms);

		int left = (width - Math.min(width - 16, 440)) / 2;
		if (count == 0) {
			String empty = "No texts yet. Type one above and press Add.";
			c.text(empty, (width - c.textWidth(empty)) / 2, fieldY2 + 50, Ui.FAINT, false);
		}
		String n = count + " / " + NimbusConfig.MAX_TEXTS;
		if (pages > 1) {
			String p = (page + 1) + " / " + pages;
			c.text(p, left + 40 - c.textWidth(p) / 2, height - 22, Ui.MUTED, false);
			c.text(n, left + 90, height - 22, Ui.FAINT, false);
		} else {
			c.text(n, left, height - 22, Ui.FAINT, false);
		}
	}

	private void paintField(Canvas c, long ms) {
		boolean focused = input != null && input.isFocused();
		Ui.panel(c, fieldX1, fieldY1, fieldX2, fieldY2, 0xFF10131E, focused ? Ui.ACCENT : 0xFF2E3350);
		int tx = fieldX1 + 6;
		int ty = fieldY1 + 6;
		int room = fieldX2 - tx - 6;
		String value = input == null ? "" : input.getValue();
		if (value.isEmpty()) {
			c.text(Ui.fit(c, editing != null ? "The text…" : "Type a text to show on your screen…", room), tx, ty, Ui.FAINT, false);
			if (focused && (ms / 500) % 2 == 0) c.rect(tx, ty - 1, tx + 1, ty + 9, Ui.TEXT);
			return;
		}
		int cursor = Math.max(0, Math.min(value.length(), input.getCursorPosition()));
		int start = 0;
		while (start < cursor && c.textWidth(value.substring(start, cursor)) > room - 2) start++;
		String shown = value.substring(start);
		while (!shown.isEmpty() && c.textWidth(shown) > room) shown = shown.substring(0, shown.length() - 1);
		c.text(shown, tx, ty, Ui.TEXT, false);
		if (focused && (ms / 500) % 2 == 0) {
			int cx = tx + c.textWidth(value.substring(start, cursor));
			c.rect(cx, ty - 1, cx + 1, ty + 9, Ui.TEXT);
		}
	}

	private void paintSlot(Canvas c, Slot s, int mx, int my, long ms) {
		Button b = s.button;
		int x1 = b.getX();
		int y1 = b.getY();
		int x2 = x1 + b.getWidth();
		int y2 = y1 + b.getHeight();
		boolean hover = Ui.inside(mx, my, x1, y1, x2, y2);
		switch (s.kind) {
			case "toggle" -> {
				boolean on = NimbusConfig.on("hud." + s.text.id, true);
				float k = knobs.getOrDefault(s.text.id, on ? 1f : 0f);
				k += ((on ? 1f : 0f) - k) * 0.35f;
				if (Math.abs(k - (on ? 1f : 0f)) < 0.01f) k = on ? 1f : 0f;
				knobs.put(s.text.id, k);
				Ui.panel(c, x1, y1, x2, y2, hover ? 0xFF22263A : 0xE0181B29, s.text.id.equals(editing) ? Ui.ACCENT : hover ? 0xFF3A4063 : 0xFF262B40);
				Ui.toggle(c, x1 + 5, y1 + (b.getHeight() - 10) / 2, k, true);
			}
			case "text" -> {
				boolean shown = NimbusConfig.on("hud." + s.text.id, true);
				Ui.panel(c, x1, y1, x2, y2, hover ? 0xFF22263A : 0xE0181B29, s.text.id.equals(editing) ? Ui.ACCENT : hover ? 0xFF3A4063 : 0xFF262B40);
				// the text as it looks on screen, cut to fit
				List<CustomTexts.Seg> segs = CustomTexts.segments(s.text.text, s.text.color, System.currentTimeMillis());
				int room = b.getWidth() - 12;
				int x = x1 + 6;
				int y = y1 + (b.getHeight() - 7) / 2;
				int used = 0;
				for (CustomTexts.Seg seg : segs) {
					String part = seg.text();
					int w = c.textWidth(part);
					if (used + w > room) {
						part = Ui.fit(c, part, room - used);
						w = c.textWidth(part);
					}
					int col = shown ? seg.color() : Ui.mix(seg.color(), 0xFF181B29, 0.6f);
					c.text(part, x + used, y, col, shown);
					used += w;
					if (used >= room) break;
				}
			}
			case "remove" -> {
				Ui.panel(c, x1, y1, x2, y2, hover ? 0xFF3A1E26 : 0xE0181B29, hover ? 0xFFF87171 : 0xFF262B40);
				int cx = x1 + (b.getWidth() - 6) / 2;
				int cy = y1 + (b.getHeight() - 6) / 2;
				int col = hover ? 0xFFFCA5A5 : Ui.MUTED;
				for (int i = 0; i < 6; i++) {
					c.rect(cx + i, cy + i, cx + i + 1, cy + i + 1, col);
					c.rect(cx + 5 - i, cy + i, cx + 6 - i, cy + i + 1, col);
				}
			}
			case "color", "newcolor" -> {
				int index = s.kind.equals("color") ? s.text.color : newColor;
				Ui.panel(c, x1, y1, x2, y2, hover ? 0xFF22263A : 0xE0181B29, hover ? 0xFF3A4063 : 0xFF262B40);
				int sw = y1 + (b.getHeight() - 8) / 2;
				if (Math.floorMod(index, CustomTexts.COLOR_NAMES.length) == CustomTexts.RAINBOW) {
					for (int i = 0; i < 8; i++) c.rect(x1 + 5 + i, sw, x1 + 6 + i, sw + 8, CustomTexts.hue((System.currentTimeMillis() % 2_600_000L) / 2600f + i / 8f));
				} else {
					c.rect(x1 + 5, sw, x1 + 13, sw + 8, CustomTexts.color(index));
				}
				String label = Ui.fit(c, (s.kind.equals("newcolor") ? "Colour: " : "") + colorName(index) + " ›", b.getWidth() - 20);
				c.text(label, x1 + 16, y1 + (b.getHeight() - 7) / 2, Ui.ACCENT_2, false);
			}
			case "style", "newstyle", "edit" -> {
				Ui.panel(c, x1, y1, x2, y2, hover ? 0xFF22263A : 0xE0181B29, hover ? 0xFF3A4063 : 0xFF262B40);
				String label = s.kind.equals("newstyle") ? (newBox ? "In a box ›" : "Plain ›") : s.kind.equals("style") ? s.label + " ›" : s.label;
				label = Ui.fit(c, label, b.getWidth() - 6);
				c.text(label, x1 + (b.getWidth() - c.textWidth(label) + 1) / 2, y1 + (b.getHeight() - 7) / 2, s.kind.equals("edit") ? Ui.TEXT : Ui.ACCENT_2, false);
			}
			default -> Ui.button(c, b, s.label, s.kind.equals("add") || s.kind.equals("save") || s.kind.equals("primary"), false, mx, my);
		}
	}
}
