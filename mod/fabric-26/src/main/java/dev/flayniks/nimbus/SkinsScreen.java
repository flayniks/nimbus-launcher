package dev.flayniks.nimbus;

import java.nio.file.Path;
import java.util.List;
import java.util.function.Consumer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;

/** The in-game wardrobe for 26.x. */
public final class SkinsScreen extends SkinsScreenBase {
	public SkinsScreen(Screen parent) {
		super(parent);
	}

	public static void open(Screen parent) {
		setScreen(new SkinsScreen(parent));
	}

	/** 26.2 moved setScreen from Minecraft to its Gui. */
	static void setScreen(Screen screen) {
		Minecraft mc = Minecraft.getInstance();
		try {
			mc.gui.setScreen(screen);
		} catch (NoSuchMethodError e) {
			try {
				Minecraft.class.getMethod("setScreen", Screen.class).invoke(mc, screen);
			} catch (ReflectiveOperationException ex) {
				throw new IllegalStateException("Could not open the screen", ex);
			}
		}
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick) {
		paint(new GuiCanvas(graphics), mouseX, mouseY);
	}

	@Override
	protected void show(Screen screen) {
		setScreen(screen);
	}

	@Override
	protected void pickFiles(Consumer<List<Path>> chosen) {
		// 26.x dropped tinyfd, so point at the wardrobe folder instead (files dropped there are picked up)
		chosen.accept(List.of());
		openWardrobeFolder();
	}
}
