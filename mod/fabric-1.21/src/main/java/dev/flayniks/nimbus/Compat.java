package dev.flayniks.nimbus;

import com.mojang.blaze3d.platform.NativeImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.texture.AbstractTexture;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.resources.ResourceLocation;
import org.lwjgl.PointerBuffer;
import org.lwjgl.system.MemoryStack;
import org.lwjgl.util.tinyfd.TinyFileDialogs;
import net.minecraft.client.OptionInstance;
import net.minecraft.client.Options;
import net.minecraft.client.gui.screens.Screen;
import org.lwjgl.glfw.GLFW;

/** The few calls that differ between Minecraft versions, for 1.20–1.21.x. */
public final class Compat {
	public static final int KEY_RIGHT_SHIFT = GLFW.GLFW_KEY_RIGHT_SHIFT;
	public static final int KEY_C = GLFW.GLFW_KEY_C;
	public static final int KEY_Y = GLFW.GLFW_KEY_Y;
	public static final int KEY_N = GLFW.GLFW_KEY_N;

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

	// ---------------------------------------------------------------- pictures (menu background)

	/** The window's size in real pixels. */
	public static int[] framebuffer() {
		var w = Minecraft.getInstance().getWindow();
		return new int[] {w.getWidth(), w.getHeight()};
	}

	/** Turns a PNG into a texture Minecraft can draw; returns its id. */
	public static Object makeTexture(byte[] png, String name) throws IOException, ReflectiveOperationException {
		NativeImage image = NativeImage.read(new ByteArrayInputStream(png));
		ResourceLocation id = ResourceLocation.tryBuild("nimbus", name);
		AbstractTexture texture = null;
		for (Constructor<?> k : DynamicTexture.class.getConstructors()) {
			Class<?>[] p = k.getParameterTypes();
			// (NativeImage) up to 1.21.4, (Supplier<String> label, NativeImage) from 1.21.5
			if (p.length == 1 && p[0] == NativeImage.class) texture = (AbstractTexture) k.newInstance(image);
			else if (p.length == 2 && p[0] == Supplier.class && p[1] == NativeImage.class) texture = (AbstractTexture) k.newInstance((Supplier<String>) () -> "Nimbus menu background", image);
			if (texture != null) break;
		}
		if (texture == null) throw new NoSuchMethodException("DynamicTexture");
		Minecraft.getInstance().getTextureManager().register(id, texture);
		return id;
	}

	public static void releaseTexture(Object id) {
		Minecraft.getInstance().getTextureManager().release((ResourceLocation) id);
	}

	private static Method blit;
	private static int blitKind;
	private static Function<ResourceLocation, Object> guiTextured;

	/** Draws a whole texture over the screen, w x h in GUI units. */
	public static void blitFull(Object graphics, Object id, int w, int h, int texW, int texH) {
		try {
			if (blit == null) findBlit();
			ResourceLocation tex = (ResourceLocation) id;
			switch (blitKind) {
				case 3 -> blit.invoke(graphics, tex, 0, 0, w, h, 0f, 1f, 0f, 1f);
				case 2 -> blit.invoke(graphics, guiTextured, tex, 0, 0, 0f, 0f, w, h, texW, texH, texW, texH);
				default -> blit.invoke(graphics, tex, 0, 0, w, h, 0f, 0f, texW, texH, texW, texH);
			}
		} catch (ReflectiveOperationException e) {
			throw new IllegalStateException(e);
		}
	}

	private static void findBlit() throws ReflectiveOperationException {
		Class<?> i = int.class;
		Class<?> f = float.class;
		Class<?> rl = ResourceLocation.class;
		for (Method m : GuiGraphics.class.getMethods()) {
			Class<?>[] p = m.getParameterTypes();
			// 1.21.6+: (texture, x0, y0, x1, y1, u0, u1, v0, v1)
			if (Arrays.equals(p, new Class<?>[] {rl, i, i, i, i, f, f, f, f})) {
				blit = m;
				blitKind = 3;
				return;
			}
		}
		for (Method m : GuiGraphics.class.getMethods()) {
			Class<?>[] p = m.getParameterTypes();
			// 1.21.2 - 1.21.5: (RenderType::guiTextured, texture, x, y, u, v, w, h, uw, vh, texW, texH)
			if (Arrays.equals(p, new Class<?>[] {Function.class, rl, i, i, f, f, i, i, i, i, i, i})) {
				Method gui = null;
				for (Method r : RenderType.class.getMethods()) {
					if (r.getName().equals("method_62277") || r.getName().equals("guiTextured")) gui = r;
				}
				if (gui == null) throw new NoSuchMethodException("RenderType.guiTextured");
				Method g = gui;
				guiTextured = (loc) -> {
					try {
						return g.invoke(null, loc);
					} catch (ReflectiveOperationException e) {
						throw new IllegalStateException(e);
					}
				};
				blit = m;
				blitKind = 2;
				return;
			}
		}
		for (Method m : GuiGraphics.class.getMethods()) {
			// 1.20 - 1.21.1: (texture, x, y, w, h, u, v, uw, vh, texW, texH)
			if (Arrays.equals(m.getParameterTypes(), new Class<?>[] {rl, i, i, i, i, f, f, i, i, i, i})) {
				blit = m;
				blitKind = 1;
				return;
			}
		}
		throw new NoSuchMethodException("GuiGraphics.blit");
	}

	/** A native "open file" dialog for a PNG; gives null when cancelled. */
	public static void pickPng(Consumer<String> done) {
		String path = null;
		try (MemoryStack stack = MemoryStack.stackPush()) {
			PointerBuffer filters = stack.mallocPointer(1);
			filters.put(stack.UTF8("*.png"));
			filters.flip();
			path = TinyFileDialogs.tinyfd_openFileDialog("Choose a background picture", null, filters, "PNG pictures", false);
		} catch (Throwable ignored) {
			// no dialog on this system
		}
		done.accept(path);
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

	/** Opens the singleplayer world on a local port (what "Open to LAN" does) and returns the port, or -1. */
	public static int publishLan() {
		try {
			var server = Minecraft.getInstance().getSingleplayerServer();
			if (server == null) return -1;
			if (server.isPublished()) return server.getPort();
			int port = net.minecraft.util.HttpUtil.getAvailablePort();
			return server.publishServer(server.getDefaultGameType(), false, port) ? port : -1;
		} catch (Throwable t) {
			return -1;
		}
	}
}
