package dev.flayniks.nimbus;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/**
 * The Nimbus Features menu: HUD modules, performance settings and handy utilities,
 * in tabs of switch rows. Painted like the rest of Nimbus; vanilla buttons sit
 * underneath (unpainted) for clicks, keyboard focus and narration.
 */
public abstract class FeaturesScreenBase extends Screen {
	private static int lastTab;

	private static final class Slot {
		Button button;
		String label;
		Features.Row row;
		boolean tab;
		int tabIndex;
		boolean primary;
	}

	protected final Screen parent;
	private final List<Slot> slots = new ArrayList<>();
	private final Map<Features.Row, Float> knobs = new HashMap<>();
	private final long openedAt = System.nanoTime();
	private int tab = lastTab;
	private int page;
	private int pages = 1;
	private int listTop;
	private String hint = "";

	protected FeaturesScreenBase(Screen parent) {
		super(Component.literal("Nimbus Features"));
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
		int cw = Math.min(width - 16, 460);
		int left = (width - cw) / 2;
		int top = 34;

		// tabs
		int tabW = 76;
		for (int i = 0; i < Features.TABS.length; i++) {
			int index = i;
			Slot s = add(Features.TABS[i], left + i * (tabW + 4), top, tabW, 18, () -> {
				tab = index;
				lastTab = index;
				page = 0;
				rebuildWidgets();
			});
			s.tab = true;
			s.tabIndex = i;
		}
		if (tab == 0) {
			Slot edit = add("Edit HUD layout", left + cw - 96, top, 96, 18, () -> Compat.setScreen(Compat.hudEditor(this)));
			edit.primary = true;
		}

		// rows, two columns
		listTop = top + 24;
		int footer = height - 28;
		int rowH = 24;
		int gap = 4;
		int colW = (cw - gap) / 2;
		int perCol = Math.max(1, (footer - 6 - listTop + gap) / (rowH + gap));
		int perPage = perCol * 2;
		List<Features.Row> rows = Features.tab(tab);
		pages = Math.max(1, (rows.size() + perPage - 1) / perPage);
		page = Math.max(0, Math.min(page, pages - 1));
		for (int i = 0; i < perPage; i++) {
			int idx = page * perPage + i;
			if (idx >= rows.size()) break;
			Features.Row row = rows.get(idx);
			int col = i / perCol;
			int r = i % perCol;
			Slot s = add(row.name, left + col * (colW + gap), listTop + r * (rowH + gap), colW, rowH, row::click);
			s.row = row;
		}

		// footer
		if (pages > 1) {
			add("<", left, footer, 20, 20, () -> {
				page = (page + pages - 1) % pages;
				rebuildWidgets();
			});
			add(">", left + 60, footer, 20, 20, () -> {
				page = (page + 1) % pages;
				rebuildWidgets();
			});
		}
		add("Done", left + cw - 90, footer, 90, 20, this::onClose);
	}

	private Slot add(String label, int x, int y, int w, int h, Runnable action) {
		Slot s = new Slot();
		s.label = label;
		s.button = Button.builder(Component.literal(label), b -> action.run()).bounds(x, y, w, h).build();
		addWidget(s.button);
		slots.add(s);
		return s;
	}

	// ------------------------------------------------------------------ painting

	/** The whole frame; the version-specific subclass calls this from its render method. */
	protected void paint(Canvas c, int mx, int my) {
		long ms = (System.nanoTime() - openedAt) / 1_000_000L;
		float t = ms / 1000f;
		Minecraft mc = Minecraft.getInstance();
		NimbusArt.menuBackdrop(c, ms, mc.level == null);

		String title = "Nimbus Features";
		int tw = c.textWidth(title);
		int tx = (width - tw) / 2 + 13;
		NimbusArt.logo(c, tx - 17, 12, 8, 1, t, NimbusArt.easeOutCubic(NimbusArt.clamp01(t / 0.35f)), NimbusArt.MENU_MOTION);
		c.text(title, tx, 9, Ui.TEXT, true);

		hint = tab == 0 ? "Switch HUD boxes on, then place them with Edit HUD layout"
			: tab == 1 ? "Tweaks that help your FPS — click a row to change it"
			: "Handy extras. Hold C to zoom";
		for (Slot s : slots) {
			if (s.row != null && Ui.hovered(s.button, mx, my)) hint = s.row.available() ? s.row.description : "Not available in this Minecraft version";
		}
		String line = Ui.fit(c, hint, width - 24);
		c.text(line, (width - c.textWidth(line)) / 2, 21, Ui.MUTED, false);

		for (Slot s : slots) {
			if (s.row != null) paintRow(c, s, mx, my);
			else Ui.button(c, s.button, s.label, s.primary, s.tab && s.tabIndex == tab, mx, my);
		}
		if (pages > 1) {
			String p = (page + 1) + " / " + pages;
			int left = (width - Math.min(width - 16, 460)) / 2;
			c.text(p, left + 40 - c.textWidth(p) / 2, height - 22, Ui.MUTED, false);
		}
	}

	private void paintRow(Canvas c, Slot s, int mx, int my) {
		Button b = s.button;
		Features.Row row = s.row;
		int x1 = b.getX();
		int y1 = b.getY();
		int x2 = x1 + b.getWidth();
		int y2 = y1 + b.getHeight();
		boolean available = row.available();
		boolean hover = available && Ui.hovered(b, mx, my);
		Ui.panel(c, x1, y1, x2, y2, hover ? 0xFF22263A : 0xE0181B29, hover ? 0xFF3A4063 : 0xFF262B40);

		int controlW;
		int valueColor = available ? Ui.TEXT : Ui.FAINT;
		switch (row.kind) {
			case TOGGLE -> {
				boolean on = available && "On".equals(row.valueLabel());
				float k = knobs.getOrDefault(row, on ? 1f : 0f);
				k += ((on ? 1f : 0f) - k) * 0.35f;
				if (Math.abs(k - (on ? 1f : 0f)) < 0.01f) k = on ? 1f : 0f;
				knobs.put(row, k);
				Ui.toggle(c, x2 - 26, y1 + (b.getHeight() - 10) / 2, k, available);
				controlW = 30;
				if (on) c.rect(x1 + 1, y1 + 3, x1 + 2, y2 - 3, Ui.ACCENT);
			}
			case CYCLE -> {
				String v = available ? row.valueLabel() + " ›" : "—";
				int vw = c.textWidth(v);
				c.text(v, x2 - 6 - vw, y1 + (b.getHeight() - 7) / 2, available ? Ui.ACCENT_2 : Ui.FAINT, false);
				controlW = vw + 10;
			}
			default -> {
				String v = row.valueLabel();
				int vw = c.textWidth(v) + 10;
				Ui.panel(c, x2 - 6 - vw, y1 + 4, x2 - 6, y2 - 4, hover ? 0xFF9075FF : Ui.ACCENT, 0xFFA78BFA);
				c.text(v, x2 - 1 - vw, y1 + (b.getHeight() - 7) / 2, Ui.TEXT, true);
				controlW = vw + 10;
			}
		}
		String name = Ui.fit(c, row.name, b.getWidth() - controlW - 14);
		c.text(name, x1 + 7, y1 + (b.getHeight() - 7) / 2, valueColor, false);
	}
}
