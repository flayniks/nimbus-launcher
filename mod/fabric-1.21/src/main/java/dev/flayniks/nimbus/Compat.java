package dev.flayniks.nimbus;

import net.minecraft.client.Minecraft;
import net.minecraft.client.OptionInstance;
import net.minecraft.client.Options;
import net.minecraft.client.gui.screens.Screen;
import org.lwjgl.glfw.GLFW;

/** The few calls that differ between Minecraft versions, for 1.20–1.21.x. */
public final class Compat {
	public static final int KEY_RIGHT_SHIFT = GLFW.GLFW_KEY_RIGHT_SHIFT;
	public static final int KEY_C = GLFW.GLFW_KEY_C;

	private Compat() {
	}

	public static boolean keyDown(int key) {
		try {
			return GLFW.glfwGetKey(Minecraft.getInstance().getWindow().getWindow(), key) == GLFW.GLFW_PRESS;
		} catch (Throwable t) {
			return false;
		}
	}

	public static boolean mouseDown() {
		try {
			return GLFW.glfwGetMouseButton(Minecraft.getInstance().getWindow().getWindow(), GLFW.GLFW_MOUSE_BUTTON_LEFT) == GLFW.GLFW_PRESS;
		} catch (Throwable t) {
			return false;
		}
	}

	public static Screen screen() {
		return Minecraft.getInstance().screen;
	}

	public static boolean hudHidden() {
		return Minecraft.getInstance().options.hideGui;
	}

	public static long dayTime() {
		return Minecraft.getInstance().level.getDayTime();
	}

	/** Fast / Fancy / Fabulous (gone in 1.21.11, where callers see it as unavailable). */
	public static OptionInstance<?> graphics(Options options) {
		return options.graphicsMode();
	}

	public static void setScreen(Screen screen) {
		Minecraft.getInstance().setScreen(screen);
	}

	public static Screen features(Screen parent) {
		return new FeaturesScreen(parent);
	}

	public static Screen hudEditor(Screen parent) {
		return new HudEditor(parent);
	}
}
