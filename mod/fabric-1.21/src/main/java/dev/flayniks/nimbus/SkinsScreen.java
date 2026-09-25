package dev.flayniks.nimbus;

import java.nio.file.Path;
import java.util.List;
import java.util.function.Consumer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;

/** The in-game wardrobe for 1.20–1.21.x. */
public final class SkinsScreen extends SkinsScreenBase {
	public SkinsScreen(Screen parent) {
		super(parent);
	}

	public static void open(Screen parent) {
		Minecraft.getInstance().setScreen(new SkinsScreen(parent));
	}

	@Override
	public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
		paint(new GuiCanvas(graphics), mouseX, mouseY);
	}

	@Override
	protected void show(Screen screen) {
		Minecraft.getInstance().setScreen(screen);
	}

	@Override
	protected void pickFiles(Consumer<List<Path>> chosen) {
		FilePicker.pick(chosen, this::openWardrobeFolder);
	}
}
