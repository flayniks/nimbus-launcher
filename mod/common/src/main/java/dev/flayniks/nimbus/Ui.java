package dev.flayniks.nimbus;

import net.minecraft.client.gui.components.Button;

/** Shared painting for the Nimbus menus: boxes, buttons and text that fits. */
final class Ui {
	private Ui() {
	}

	static final int TEXT = 0xFFFFFFFF;
	static final int MUTED = 0xFF8B90A5;
	static final int FAINT = 0xFF5C6178;
	static final int GOOD = 0xFF34D399;
	static final int ACCENT = 0xFF7C5CFF;
	static final int ACCENT_2 = 0xFFC084FC;

	/** A box with a 1px border and clipped corners. */
	static void panel(Canvas c, int x1, int y1, int x2, int y2, int fill, int edge) {
		c.rect(x1 + 1, y1, x2 - 1, y1 + 1, edge);
		c.rect(x1 + 1, y2 - 1, x2 - 1, y2, edge);
		c.rect(x1, y1 + 1, x1 + 1, y2 - 1, edge);
		c.rect(x2 - 1, y1 + 1, x2, y2 - 1, edge);
		c.rect(x1 + 1, y1 + 1, x2 - 1, y2 - 1, fill);
	}

	static boolean inside(int mx, int my, int x1, int y1, int x2, int y2) {
		return mx >= x1 && my >= y1 && mx < x2 && my < y2;
	}

	static boolean hovered(Button b, int mx, int my) {
		return b.visible && (inside(mx, my, b.getX(), b.getY(), b.getX() + b.getWidth(), b.getY() + b.getHeight()) || b.isFocused());
	}

	/** A vanilla button painted the Nimbus way. */
	static void button(Canvas c, Button b, String label, boolean primary, boolean selected, int mx, int my) {
		if (!b.visible) return;
		int x1 = b.getX();
		int y1 = b.getY();
		int x2 = x1 + b.getWidth();
		int y2 = y1 + b.getHeight();
		boolean on = b.active;
		boolean hover = on && hovered(b, mx, my);
		int bg;
		int edge;
		if (!on) {
			bg = 0xFF141725;
			edge = 0xFF1F2335;
		} else if (primary || selected) {
			bg = hover ? 0xFF9075FF : selected ? 0xFF2D2560 : ACCENT;
			edge = hover ? 0xFFD7C8FF : selected ? ACCENT : 0xFFA78BFA;
		} else {
			bg = hover ? 0xFF2A2F48 : 0xFF1D2133;
			edge = hover ? 0xFF4C5480 : 0xFF2E3350;
		}
		panel(c, x1, y1, x2, y2, bg, edge);
		String text = fit(c, label, b.getWidth() - 6);
		c.text(text, x1 + (b.getWidth() - c.textWidth(text) + 1) / 2, y1 + (b.getHeight() - 7) / 2, on ? TEXT : FAINT, on && primary);
	}

	/** An on/off switch; `t` runs 0 (off) to 1 (on) so it can slide. */
	static void toggle(Canvas c, int x, int y, float t, boolean enabled) {
		int w = 20;
		int h = 10;
		int off = 0xFF2E3350;
		int on = enabled ? ACCENT : 0xFF3A3560;
		int bg = mix(off, on, t);
		c.rect(x + 1, y, x + w - 1, y + h, bg);
		c.rect(x, y + 1, x + w, y + h - 1, bg);
		int kx = x + 1 + Math.round(t * (w - 10));
		int knob = enabled ? 0xFFFFFFFF : 0xFF8B90A5;
		c.rect(kx + 1, y + 1, kx + 7, y + h - 1, knob);
		c.rect(kx, y + 2, kx + 8, y + h - 2, knob);
	}

	static int mix(int a, int b, float t) {
		t = Math.max(0, Math.min(1, t));
		int ar = a >> 16 & 255;
		int ag = a >> 8 & 255;
		int ab = a & 255;
		int br = b >> 16 & 255;
		int bgc = b >> 8 & 255;
		int bb = b & 255;
		return 0xFF000000 | Math.round(ar + (br - ar) * t) << 16 | Math.round(ag + (bgc - ag) * t) << 8 | Math.round(ab + (bb - ab) * t);
	}

	static String fit(Canvas c, String s, int max) {
		if (c.textWidth(s) <= max) return s;
		String dots = "…";
		int end = s.length();
		while (end > 0 && c.textWidth(s.substring(0, end) + dots) > max) end--;
		return s.substring(0, end).trim() + dots;
	}
}
