package dev.flayniks.nimbus;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.gui.screens.Screen;

/** The HUD layout editor for 26.x. */
public final class HudEditor extends HudEditorBase {
	public HudEditor(Screen parent) {
		super(parent);
	}

	private boolean held;
	private boolean pending; // a click shorter than a frame still counts

	@Override
	protected boolean leftDown() {
		if (pending) {
			pending = false;
			return true;
		}
		return held;
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		if (event.button() == Compat.leftButton()) {
			held = true;
			pending = true;
			pressedAt(event.x(), event.y());
		}
		return super.mouseClicked(event, doubleClick);
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent event) {
		if (event.button() == Compat.leftButton()) held = false;
		return super.mouseReleased(event);
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick) {
		paint(new GuiCanvas(graphics), mouseX, mouseY);
	}
}
