package dev.flayniks.nimbus;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.platform.Window;
import java.lang.reflect.Method;
import net.minecraft.client.Minecraft;
import net.minecraft.client.OptionInstance;
import net.minecraft.client.Options;
import net.minecraft.client.gui.screens.Screen;

/**
 * The few calls that differ between Minecraft versions, for 26.x. Key codes are given in
 * GLFW numbers; 26.3 moved to SDL, whose numbers differ, so they are translated.
 */
public final class Compat {
	public static final int KEY_RIGHT_SHIFT = 344;
	public static final int KEY_C = 67;

	private static Method legacyIsKeyDown;
	private static boolean sdl = true;

	private Compat() {
	}

	public static boolean keyDown(int glfwKey) {
		try {
			if (sdl) {
				try {
					return InputConstants.isKeyDown(toSdl(glfwKey));
				} catch (NoSuchMethodError e) {
					sdl = false; // 26.1 and 26.2: GLFW, isKeyDown(Window, int)
				}
			}
			if (legacyIsKeyDown == null) legacyIsKeyDown = InputConstants.class.getMethod("isKeyDown", Window.class, int.class);
			return (Boolean) legacyIsKeyDown.invoke(null, Minecraft.getInstance().getWindow(), glfwKey);
		} catch (Throwable t) {
			return false;
		}
	}

	private static int leftButton = -1;

	/**
	 * The left mouse button's number: 0 under GLFW (26.1, 26.2), 1 under SDL (26.3). Read at run
	 * time, since the compiled-in constant would always be 26.3's.
	 */
	public static int leftButton() {
		if (leftButton < 0) {
			try {
				leftButton = InputConstants.class.getField("MOUSE_BUTTON_LEFT").getInt(null);
			} catch (ReflectiveOperationException e) {
				leftButton = 0;
			}
		}
		return leftButton;
	}

	private static int toSdl(int glfwKey) {
		return switch (glfwKey) {
			case 344 -> 229; // right shift
			case 67 -> 6; // C
			default -> glfwKey;
		};
	}

	/** 26.2 moved the open screen onto Gui; 26.1 still has Minecraft.screen. */
	public static Screen screen() {
		Minecraft mc = Minecraft.getInstance();
		try {
			return mc.gui.screen();
		} catch (NoSuchMethodError e) {
			return (Screen) field(mc, "screen");
		}
	}

	/** F1: Hud.isHidden() from 26.2, Options.hideGui in 26.1. */
	public static boolean hudHidden() {
		Minecraft mc = Minecraft.getInstance();
		try {
			return mc.gui.hud.isHidden();
		} catch (NoSuchFieldError | NoSuchMethodError e) {
			Object v = field(mc.options, "hideGui");
			return v instanceof Boolean b && b;
		}
	}

	public static long dayTime() {
		return Minecraft.getInstance().level.getOverworldClockTime();
	}

	/** 26.x replaced Fast/Fancy/Fabulous with a graphics preset (same first three, plus Custom). */
	public static OptionInstance<?> graphics(Options options) {
		return options.graphicsPreset();
	}

	private static Object field(Object owner, String name) {
		try {
			java.lang.reflect.Field f = owner.getClass().getField(name);
			return f.get(owner);
		} catch (ReflectiveOperationException e) {
			return null;
		}
	}

	public static void setScreen(Screen screen) {
		SkinsScreen.setScreen(screen);
	}

	public static Screen features(Screen parent) {
		return new FeaturesScreen(parent);
	}

	public static Screen hudEditor(Screen parent) {
		return new HudEditor(parent);
	}
}
