package dev.flayniks.nimbus;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;

/**
 * What's behind the title screen and the menus: Minecraft's panorama, the Nimbus glow, or
 * a picture of your own. The picture is fitted to the window on a background thread, then
 * handed to Minecraft as a texture; it is redone when the window changes size or the file
 * changes.
 */
public final class MenuBackground {
	private MenuBackground() {
	}

	static final String[] MODES = {"Minecraft", "Nimbus", "Your picture"};

	private static volatile Object texture;
	private static volatile int texW;
	private static volatile int texH;
	private static volatile long texStamp;
	private static volatile boolean loading;
	private static volatile long failedStamp;
	private static int serial;
	private static long shown = -1;

	/** The picture file: the launcher passes its own, otherwise one in the config folder. */
	static Path file() {
		String p = System.getProperty("nimbus.menu.image");
		if (p != null && !p.isBlank()) return Path.of(p);
		return FabricLoader.getInstance().getConfigDir().resolve("nimbus-background.png");
	}

	static int mode() {
		return Math.floorMod(NimbusConfig.value("menu.background", 0), MODES.length);
	}

	/** Paints the background; false means leave it to Minecraft's panorama. */
	public static boolean draw(Canvas c, Object graphics) {
		int mode = mode();
		if (mode == 0) return false;
		long now = System.currentTimeMillis();
		if (shown < 0) shown = now;
		try {
			if (mode == 2 && picture(c, graphics)) return true;
		} catch (Throwable t) {
			// a texture call this version doesn't have: the Nimbus glow instead
			failedStamp = texStamp;
		}
		NimbusArt.menuBackdrop(c, now - shown, true);
		return true;
	}

	private static boolean picture(Canvas c, Object graphics) {
		Path f = file();
		long stamp;
		try {
			stamp = Files.exists(f) ? Files.getLastModifiedTime(f).toMillis() : 0;
		} catch (IOException e) {
			stamp = 0;
		}
		if (stamp == 0) return false;
		int[] fb = Compat.framebuffer();
		int w = Math.max(1, Math.min(fb[0], 3840));
		int h = Math.max(1, Math.min(fb[1], 2160));
		boolean fresh = texture != null && texStamp == stamp && texW == w && texH == h;
		if (!fresh && !loading && failedStamp != stamp) load(f, stamp, w, h);
		if (texture == null) return false;
		Compat.blitFull(graphics, texture, c.width(), c.height(), texW, texH);
		return true;
	}

	private static void load(Path f, long stamp, int w, int h) {
		loading = true;
		Thread t = new Thread(() -> {
			try {
				byte[] png = Picture.coverPng(Png.read(Files.readAllBytes(f)), w, h);
				Minecraft.getInstance().execute(() -> {
					try {
						Object old = texture;
						texture = Compat.makeTexture(png, "menu_background_" + (++serial));
						texW = w;
						texH = h;
						texStamp = stamp;
						if (old != null) Compat.releaseTexture(old);
					} catch (Throwable e) {
						failedStamp = stamp;
					} finally {
						loading = false;
					}
				});
			} catch (Throwable e) {
				failedStamp = stamp;
				loading = false;
			}
		}, "Nimbus menu background");
		t.setDaemon(true);
		t.start();
	}

	/** Opens a file picker for a PNG and makes it the menu background. */
	static void choose() {
		Compat.pickPng(MenuBackground::use);
	}

	private static void use(String path) {
		if (path == null || path.isBlank()) return;
		try {
			byte[] data = Files.readAllBytes(Path.of(path));
			Png.read(data); // refuse anything we can't show
			Path target = file();
			if (target.getParent() != null) Files.createDirectories(target.getParent());
			Files.write(target, data);
			failedStamp = 0;
			NimbusConfig.set("menu.background", 2);
		} catch (Throwable e) {
			// not a PNG we can read: the background stays as it was
		}
	}
}
