package dev.flayniks.nimbus;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;

/** The HUD layout editor for 1.20–1.21.x. */
public final class HudEditor extends HudEditorBase {
	public HudEditor(Screen parent) {
		super(parent);
	}

	@Override
	protected boolean leftDown() {
		return Compat.mouseDown();
	}

	@Override
	public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
		paint(new GuiCanvas(graphics), mouseX, mouseY);
	}
}
