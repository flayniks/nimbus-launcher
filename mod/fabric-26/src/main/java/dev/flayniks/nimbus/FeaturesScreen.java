package dev.flayniks.nimbus;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;

/** The Nimbus Features menu for 26.x. */
public final class FeaturesScreen extends FeaturesScreenBase {
	public FeaturesScreen(Screen parent) {
		super(parent);
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick) {
		paint(new GuiCanvas(graphics), mouseX, mouseY);
	}
}
