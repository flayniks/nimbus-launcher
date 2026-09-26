package dev.flayniks.nimbus;

import net.minecraft.client.Minecraft;

/**
 * Nimbus' gameplay tweaks that need a little work every frame: zoom, fullbright and
 * the background FPS limit. Zoom and fullbright bend vanilla options past their normal
 * range for as long as they are on, and put the real values back afterwards.
 */
final class Tweaks {
	private Tweaks() {
	}

	static final int[] ZOOM_LEVELS = {2, 3, 4, 6, 8};
	static final int[] BACKGROUND_FPS = {0, 5, 10, 15, 30};

	private static float zoom = 1f;
	private static Integer fovBefore;
	private static Double sensitivityBefore;
	private static boolean brightened;
	private static long lastFrame = System.nanoTime();

	static void frame(Minecraft mc) {
		long now = System.nanoTime();
		float dt = Math.min(0.1f, (now - lastFrame) / 1e9f);
		lastFrame = now;
		zoom(mc, dt);
		fullbright();
		limitBackgroundFps(mc);
	}

	// ---------------------------------------------------------------- zoom

	private static void zoom(Minecraft mc, float dt) {
		boolean wanted = NimbusConfig.on("zoom", true) && Compat.screen() == null && mc.player != null && Compat.keyDown(Compat.KEY_C);
		float target = wanted ? ZOOM_LEVELS[Math.floorMod(NimbusConfig.value("zoom.level", 2), ZOOM_LEVELS.length)] : 1f;
		if (zoom == 1f && target == 1f) return;
		if (fovBefore == null) {
			Object fov = Opts.get((o) -> o.fov());
			Object sens = Opts.get((o) -> o.sensitivity());
			if (!(fov instanceof Integer f) || !(sens instanceof Double s)) return;
			fovBefore = f;
			sensitivityBefore = s;
		}
		boolean smooth = NimbusConfig.on("zoom.smooth", true);
		zoom = smooth ? zoom + (target - zoom) * Math.min(1f, dt * 14f) : target;
		if (Math.abs(zoom - target) < 0.02f) zoom = target;
		if (zoom <= 1.001f && target == 1f) {
			// fully zoomed out: put the player's own settings back
			zoom = 1f;
			Opts.setRaw((o) -> o.fov(), fovBefore);
			Opts.setRaw((o) -> o.sensitivity(), sensitivityBefore);
			fovBefore = null;
			sensitivityBefore = null;
			return;
		}
		Opts.setRaw((o) -> o.fov(), Math.max(1, Math.round(fovBefore / zoom)));
		Opts.setRaw((o) -> o.sensitivity(), sensitivityBefore / Math.sqrt(zoom));
	}

	// ---------------------------------------------------------------- fullbright

	private static void fullbright() {
		boolean on = NimbusConfig.on("fullbright", false);
		Object gamma = Opts.get((o) -> o.gamma());
		if (!(gamma instanceof Double g)) return;
		if (on) {
			if (g < 10) {
				if (!brightened) NimbusConfig.setNumber("fullbright.before", Math.min(1, g));
				brightened = true;
				Opts.setRaw((o) -> o.gamma(), 16.0);
			}
		} else if (g > 1.0) {
			brightened = false;
			Opts.setRaw((o) -> o.gamma(), NimbusConfig.number("fullbright.before", 0.5));
		}
	}

	// ---------------------------------------------------------------- background FPS

	private static long lastPaced = System.nanoTime();

	/** When the window is in the background, draw only a few frames a second (saves power and heat). */
	static void limitBackgroundFps(Minecraft mc) {
		int fps = BACKGROUND_FPS[Math.floorMod(NimbusConfig.value("background.fps", 2), BACKGROUND_FPS.length)];
		long now = System.nanoTime();
		boolean active;
		try {
			active = mc.isWindowActive();
		} catch (Throwable t) {
			active = true;
		}
		if (fps > 0 && !active) {
			long frame = 1_000_000_000L / fps;
			long wait = frame - (now - lastPaced);
			if (wait > 0) {
				try {
					Thread.sleep(Math.min(250, wait / 1_000_000L));
				} catch (InterruptedException e) {
					Thread.currentThread().interrupt();
				}
			}
		}
		lastPaced = System.nanoTime();
	}

	// ---------------------------------------------------------------- presets

	static final String[] PRESETS = {"Max FPS", "Balanced", "Quality"};

	/** One click to a whole set of video options. */
	static void applyPreset(int which) {
		int rd = new int[] {8, 12, 16}[which];
		int sim = new int[] {6, 8, 12}[which];
		Opts.set((o) -> o.renderDistance(), rd);
		Opts.set((o) -> o.simulationDistance(), sim);
		setEnum((o) -> o.particles(), which == 0 ? 2 : which == 1 ? 1 : 0);
		setEnum((o) -> o.cloudStatus(), which == 0 ? 0 : which == 1 ? 1 : 2);
		setEnum(Compat::graphics, which == 0 ? 0 : 1);
		Opts.set((o) -> o.entityShadows(), which != 0);
		Opts.set((o) -> o.ambientOcclusion(), which != 0);
		Opts.set((o) -> o.biomeBlendRadius(), new int[] {0, 2, 5}[which]);
		Opts.set((o) -> o.entityDistanceScaling(), new double[] {0.75, 1.0, 1.25}[which]);
		if (which == 0) {
			Opts.set((o) -> o.enableVsync(), false);
			Opts.set((o) -> o.framerateLimit(), 260);
		}
	}

	static void setEnum(java.util.function.Function<net.minecraft.client.Options, net.minecraft.client.OptionInstance<?>> getter, int ordinal) {
		Object cur = Opts.get(getter);
		Object next = Opts.enumAt(cur, ordinal);
		if (next != null) Opts.set(getter, next);
	}
}
