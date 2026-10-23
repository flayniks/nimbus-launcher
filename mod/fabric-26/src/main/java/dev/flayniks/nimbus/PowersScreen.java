package dev.flayniks.nimbus;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;

/** Your player model's powers, for 26.x. */
public final class PowersScreen extends PowersScreenBase {
	public PowersScreen(Screen parent) {
		super(parent);
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick) {
		paint(new GuiCanvas(graphics), mouseX, mouseY);
	}
}
