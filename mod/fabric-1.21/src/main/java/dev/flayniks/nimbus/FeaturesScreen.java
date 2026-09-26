package dev.flayniks.nimbus;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;

/** The Nimbus Features menu for 1.20–1.21.x. */
public final class FeaturesScreen extends FeaturesScreenBase {
	public FeaturesScreen(Screen parent) {
		super(parent);
	}

	@Override
	public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
		paint(new GuiCanvas(graphics), mouseX, mouseY);
	}
}
