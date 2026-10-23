package dev.flayniks.nimbus;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;

/** Your player model's powers, for 1.20–1.21.x. */
public final class PowersScreen extends PowersScreenBase {
	public PowersScreen(Screen parent) {
		super(parent);
	}

	@Override
	public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
		paint(new GuiCanvas(graphics), mouseX, mouseY);
	}
}
