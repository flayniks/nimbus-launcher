package dev.flayniks.nimbus;

import net.minecraft.client.gui.GuiGraphics;

/** Canvas over 1.20–1.21.x GuiGraphics. */
public final class GuiCanvas implements Canvas {
	private final GuiGraphics g;

	public GuiCanvas(GuiGraphics g) {
		this.g = g;
	}

	@Override
	public int width() {
		return g.guiWidth();
	}

	@Override
	public int height() {
		return g.guiHeight();
	}

	@Override
	public void rect(int x1, int y1, int x2, int y2, int argb) {
		if ((argb >>> 24) == 0 || x2 <= x1 || y2 <= y1) return;
		g.fill(x1, y1, x2, y2, argb);
	}
}
