package dev.flayniks.nimbus;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.platform.Window;
import com.mojang.blaze3d.platform.NativeImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.lang.reflect.Method;
import java.util.function.Consumer;
import org.lwjgl.PointerBuffer;
import org.lwjgl.system.MemoryStack;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.resources.Identifier;
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
	public static final int KEY_Y = 89;
	public static final int KEY_N = 78;

	private static Method legacyIsKeyDown;
	private static boolean sdl = true;

	private Compat() {
	}

	/** Minecraft's own millisecond clock (the one its ping chart uses). */
	public static long millis() {
		return net.minecraft.util.Util.getMillis();
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
			case 89 -> 28; // Y
			case 78 -> 17; // N
			case 297 -> 65; // F8 (replay clips)
			case 257 -> 40; // Enter
			case 335 -> 88; // keypad Enter
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

	public static Screen texts(Screen parent) {
		return new TextsScreen(parent);
	}

	// ---------------------------------------------------------------- pictures (menu background)

	/** The window's size in real pixels. */
	public static int[] framebuffer() {
		Window w = Minecraft.getInstance().getWindow();
		return new int[] {w.getWidth(), w.getHeight()};
	}

	/** Turns a PNG into a texture Minecraft can draw; returns its id. */
	public static Object makeTexture(byte[] png, String name) throws IOException {
		NativeImage image = NativeImage.read(new ByteArrayInputStream(png));
		Identifier id = Identifier.fromNamespaceAndPath("nimbus", name);
		Minecraft.getInstance().getTextureManager().register(id, new DynamicTexture(() -> "Nimbus menu background", image));
		return id;
	}

	public static void releaseTexture(Object id) {
		Minecraft.getInstance().getTextureManager().release((Identifier) id);
	}

	/** Draws a whole texture over the screen, w x h in GUI units. */
	public static void blitFull(Object graphics, Object id, int w, int h, int texW, int texH) {
		((GuiGraphicsExtractor) graphics).blit((Identifier) id, 0, 0, w, h, 0f, 1f, 0f, 1f);
	}

	/**
	 * A native "open file" dialog for a PNG; gives null when cancelled. 26.1 and 26.2 still
	 * ship LWJGL's tinyfd; 26.3 runs on SDL, which has its own (asynchronous) dialog.
	 */
	public static void pickPng(Consumer<String> done) {
		try {
			Class<?> tinyfd = Class.forName("org.lwjgl.util.tinyfd.TinyFileDialogs");
			Method open = tinyfd.getMethod("tinyfd_openFileDialog", CharSequence.class, CharSequence.class, PointerBuffer.class, CharSequence.class, boolean.class);
			String path;
			try (MemoryStack stack = MemoryStack.stackPush()) {
				PointerBuffer filters = stack.mallocPointer(1);
				filters.put(stack.UTF8("*.png"));
				filters.flip();
				path = (String) open.invoke(null, "Choose a background picture", null, filters, "PNG pictures", false);
			}
			done.accept(path);
			return;
		} catch (ClassNotFoundException e) {
			// SDL below
		} catch (Throwable e) {
			done.accept(null);
			return;
		}
		try {
			SdlPicker.open(done);
		} catch (Throwable e) {
			done.accept(null);
		}
	}

	// ---------------------------------------------------------------- crazy animations

	/** The hotbar slot in hand. */
	public static int selectedSlot(net.minecraft.world.entity.player.Player player) {
		return player.getInventory().getSelectedSlot();
	}

	// ---------------------------------------------------------------- Nimbus LAN

	public static boolean inSingleplayer() {
		return Minecraft.getInstance().getSingleplayerServer() != null;
	}

	public static String worldName() {
		try {
			return Minecraft.getInstance().getSingleplayerServer().getWorldData().getLevelName();
		} catch (Throwable t) {
			return "World";
		}
	}

	/**
	 * Opens the singleplayer world on a local port (what "Open to LAN" does) and returns the
	 * port, or -1. 26.1/26.2 take (GameType, cheats, port); 26.3 takes (MultiplayerScope, guest commands, port).
	 */
	public static int publishLan() {
		try {
			var server = Minecraft.getInstance().getSingleplayerServer();
			if (server == null) return -1;
			if (server.isPublished()) return server.getPort();
			int port = net.minecraft.util.HttpUtil.getAvailablePort();
			for (Method m : server.getClass().getMethods()) {
				if (!m.getName().equals("publishServer") || m.getParameterCount() != 3) continue;
				Class<?> first = m.getParameterTypes()[0];
				Object mode;
				if (first == net.minecraft.world.level.GameType.class) mode = server.getDefaultGameType();
				else if (first.isEnum()) mode = enumConstant(first, "LAN");
				else continue;
				return Boolean.TRUE.equals(m.invoke(server, mode, false, port)) ? port : -1;
			}
		} catch (Throwable ignored) {
			// no world to open
		}
		return -1;
	}

	@SuppressWarnings({"unchecked", "rawtypes"})
	private static Object enumConstant(Class<?> type, String name) {
		return Enum.valueOf((Class) type, name);
	}
}
