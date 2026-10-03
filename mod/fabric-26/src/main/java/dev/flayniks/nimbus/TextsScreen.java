package dev.flayniks.nimbus;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;

/** Your texts, for 26.x. */
public final class TextsScreen extends TextsScreenBase {
	public TextsScreen(Screen parent) {
		super(parent);
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick) {
		paint(new GuiCanvas(graphics), mouseX, mouseY);
	}
}
