package dev.flayniks.nimbus;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.events.ContainerEventHandler;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;

/**
 * Crazy animations, off until switched on in Nimbus Features. Menus burst in, the cursor
 * leaves a rainbow trail, the button under the mouse glows and sparkles float up behind
 * every menu. In game, hits, combos, level ups, pickups, damage, big landings and
 * sprinting each get their own show. All of it is rectangles, like the rest of Nimbus.
 */
public final class CrazyFx {
	private CrazyFx() {
	}

	static final String[] LEVELS = {"Wild", "Insane", "Maximum chaos"};
	private static final float[] AMOUNT = {0.55f, 1f, 1.9f};

	static boolean on() {
		return NimbusConfig.on("fx.crazy", false);
	}

	private static boolean part(String key) {
		return on() && NimbusConfig.on(key, true);
	}

	private static float amount() {
		return AMOUNT[Math.floorMod(NimbusConfig.value("fx.level", 1), AMOUNT.length)];
	}

	private static int many(float n) {
		return Math.max(1, Math.round(n * amount()));
	}

	// ------------------------------------------------------------------ particles

	private static final int DOT = 0;
	private static final int SPARK = 1;
	private static final int CONFETTI = 2;
	private static final int STAR = 3;
	private static final int RING = 4;
	private static final int WORD = 5;
	private static final int HIT = 6;
	private static final int BOX = 7;

	private static final class P {
		int kind;
		float x;
		float y;
		float vx;
		float vy;
		float grav;
		float drag = 1f;
		float age;
		float life = 1f;
		float size = 1f;
		float alpha = 1f;
		float hue;
		float r0;
		float r1;
		float ry = 1f;
		int trail = 4;
		int rgb = 0xFFFFFF;
		boolean rainbow;
		String text;
	}

	/** One set of particles with its own clock: menus draw one, the in-game HUD the other. */
	private static final class Layer {
		final List<P> list = new ArrayList<>();
		long last;

		float tick(long now) {
			// a layer nobody drew for a while (menu closed, world left) starts clean
			if (last != 0 && now - last > 500_000_000L) list.clear();
			float d = last == 0 ? 0f : (now - last) / 1e9f;
			last = now;
			return Math.max(0f, Math.min(d, 0.05f));
		}
	}

	private static final Layer MENU = new Layer();
	private static final Layer HUD = new Layer();
	private static final Random RND = new Random();
	private static final int CAP = 1600;
	private static final P DISCARD = new P();

	private static float rnd(float a, float b) {
		return a + RND.nextFloat() * (b - a);
	}

	private static P add(Layer l, int kind, float x, float y, float vx, float vy, float life, float size, int rgb) {
		if (l.list.size() >= CAP) return DISCARD;
		P p = new P();
		p.kind = kind;
		p.x = x;
		p.y = y;
		p.vx = vx;
		p.vy = vy;
		p.life = life;
		p.size = size;
		p.rgb = rgb;
		l.list.add(p);
		return p;
	}

	private static P rainbow(P p) {
		p.rainbow = true;
		p.hue = RND.nextFloat();
		return p;
	}

	/** Sparks flying out in every direction. */
	private static void burst(Layer l, float x, float y, int n, float speed, float life, int rgb) {
		for (int i = 0; i < n; i++) {
			double a = RND.nextDouble() * Math.PI * 2;
			float v = rnd(speed * 0.35f, speed);
			P p = add(l, SPARK, x, y, (float) Math.cos(a) * v, (float) Math.sin(a) * v, rnd(life * 0.5f, life), RND.nextInt(3) == 0 ? 2 : 1, rgb);
			p.drag = 0.08f;
			if (rgb == 0) rainbow(p);
		}
	}

	private static void confetti(Layer l, float x, float y, int n, float vx0, float vx1, float vy0, float vy1, float life) {
		for (int i = 0; i < n; i++) {
			P p = rainbow(add(l, CONFETTI, x, y, rnd(vx0, vx1), rnd(vy0, vy1), rnd(life * 0.6f, life), rnd(1.5f, 3f), 0));
			p.grav = 260f;
			p.drag = 0.5f;
		}
	}

	private static P ring(Layer l, float x, float y, float r0, float r1, float ry, float life, float delay, int rgb) {
		P p = add(l, RING, x, y, 0, 0, life, 1, rgb);
		p.r0 = r0;
		p.r1 = r1;
		p.ry = ry;
		p.age = -delay;
		if (rgb == 0) p.rainbow = true;
		return p;
	}

	private static P word(Layer l, String text, float x, float y, int cell, float life, int rgb) {
		P p = add(l, WORD, x, y, 0, 0, life, cell, rgb);
		p.text = text;
		if (rgb == 0) rainbow(p);
		return p;
	}

	/** Moves everything along, drops what has burned out and draws the rest. */
	private static void run(Layer l, Canvas c, float dt, float t) {
		List<P> list = l.list;
		int keep = 0;
		int n = list.size();
		for (int i = 0; i < n; i++) {
			P p = list.get(i);
			p.age += dt;
			if (p.age >= p.life) continue;
			list.set(keep++, p);
			if (p.age < 0) continue;
			if (p.drag < 1f) {
				float d = (float) Math.pow(p.drag, dt);
				p.vx *= d;
				p.vy *= d;
			}
			p.vy += p.grav * dt;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			try {
				draw(c, p, t);
			} catch (Throwable ignored) {
				// one bad particle never stops the rest
			}
		}
		if (keep < n) list.subList(keep, n).clear();
	}

	private static void draw(Canvas c, P p, float t) {
		float k = p.age / p.life;
		int col = p.rainbow ? hue(p.hue + t * 0.6f) : p.rgb;
		int x = Math.round(p.x);
		int y = Math.round(p.y);
		int s = Math.max(1, Math.round(p.size));
		switch (p.kind) {
			case DOT -> {
				float a = (1 - k * k) * p.alpha;
				c.rect(x - s, y - s, x + s * 2, y + s * 2, NimbusArt.argb(col, a * 0.2f));
				c.rect(x, y, x + s, y + s, NimbusArt.argb(col, a));
			}
			case SPARK -> {
				float a = (1 - k) * p.alpha;
				for (int j = p.trail - 1; j >= 0; j--) {
					float f = j * 0.009f;
					int tx = Math.round(p.x - p.vx * f);
					int ty = Math.round(p.y - p.vy * f);
					int tc = j == 0 ? NimbusArt.mix(col, 0xFFFFFF, 0.6f) : col;
					c.rect(tx, ty, tx + s, ty + s, NimbusArt.argb(tc, a * (1f - j / (float) p.trail)));
				}
			}
			case CONFETTI -> {
				float flip = Math.abs((float) Math.cos(p.age * 9f + p.hue * 20f));
				int w = Math.max(1, Math.round(p.size * 1.6f * flip));
				float a = k > 0.75f ? (1 - k) / 0.25f : 1f;
				c.rect(x - w / 2, y, x - w / 2 + w, y + s, NimbusArt.argb(col, a));
			}
			case STAR -> {
				float tw = 0.45f + 0.55f * (float) Math.sin(p.age * 8f + p.hue * 30f);
				float a = (k < 0.15f ? k / 0.15f : 1 - (k - 0.15f) / 0.85f) * tw * p.alpha;
				c.rect(x - s, y, x + s + 1, y + 1, NimbusArt.argb(col, a * 0.8f));
				c.rect(x, y - s, x + 1, y + s + 1, NimbusArt.argb(col, a * 0.8f));
				c.rect(x, y, x + 1, y + 1, NimbusArt.argb(0xFFFFFF, a));
			}
			case RING -> {
				float r = p.r0 + (p.r1 - p.r0) * NimbusArt.easeOutCubic(k);
				int cell = r > 60 ? 2 : 1;
				NimbusArt.wave(c, x, y, r, r * p.ry, cell, (1 - k) * 0.9f * p.alpha, p.rainbow ? 0 : p.rgb);
			}
			case WORD -> drawWord(c, p, t);
			case HIT -> {
				float g = 3 + 6 * NimbusArt.easeOutCubic(k);
				float a = 1 - k;
				for (int dx = -1; dx <= 1; dx += 2) {
					for (int dy = -1; dy <= 1; dy += 2) {
						for (int d = 0; d < 4; d++) {
							int px = x + Math.round(dx * (g + d));
							int py = y + Math.round(dy * (g + d));
							c.rect(px, py, px + 1, py + 1, NimbusArt.argb(d == 0 ? 0xFFFFFF : col, a));
						}
					}
				}
			}
			case BOX -> {
				int r = Math.round(p.r0 + (p.r1 - p.r0) * NimbusArt.easeOutCubic(k));
				if (p.trail == 0) {
					// a flash filling the box
					c.rect(x - r, y - r, x + r, y + r, NimbusArt.argb(col, (1 - k) * p.alpha));
				} else {
					frame(c, x - r, y - r, x + r, y + r, NimbusArt.argb(col, 1 - k));
					frame(c, x - r + 1, y - r + 1, x + r - 1, y + r - 1, NimbusArt.argb(col, (1 - k) * 0.6f));
				}
			}
			default -> {
			}
		}
	}

	/** Big pixel words that slam in, shake, bob letter by letter and fade. */
	private static void drawWord(Canvas c, P p, float t) {
		int cell = Math.max(1, Math.round(p.size));
		float slam = NimbusArt.clamp01(p.age / 0.32f);
		float scale = 1f + 1.6f * (1f - NimbusArt.easeOutBack(slam));
		float a = Math.min(1f, p.age / 0.08f) * (p.age > p.life - 0.4f ? (p.life - p.age) / 0.4f : 1f);
		float shake = p.age < 0.45f ? (float) Math.sin(p.age * 90f) * 2.2f * (1 - p.age / 0.45f) : 0f;
		int w = NimbusArt.textWidth(p.text, cell, 1);
		int h = 7 * cell;
		c.push(p.x + shake, p.y, scale);
		try {
			int cx = -w / 2;
			for (int i = 0; i < p.text.length(); i++) {
				String ch = String.valueOf(p.text.charAt(i));
				int bob = p.rainbow ? Math.round((float) Math.sin(t * 7f + i * 0.7f) * cell * 0.8f) : 0;
				int rgb = p.rainbow ? hue(p.hue + i * 0.07f + t * 0.5f) : p.rgb;
				NimbusArt.text(c, ch, cx + cell, -h / 2 + bob + cell, cell, 0, 0x000000, a * 0.55f);
				NimbusArt.text(c, ch, cx, -h / 2 + bob, cell, 0, rgb, a);
				cx += NimbusArt.textWidth(ch, cell, 0) + cell;
			}
		} finally {
			c.pop();
		}
	}

	// ------------------------------------------------------------------ small helpers

	/** A bright rainbow colour; `h` wraps around 0..1. */
	static int hue(float h) {
		h -= (float) Math.floor(h);
		float r = NimbusArt.clamp01(Math.abs(h * 6 - 3) - 1);
		float g = NimbusArt.clamp01(2 - Math.abs(h * 6 - 2));
		float b = NimbusArt.clamp01(2 - Math.abs(h * 6 - 4));
		return lift(r) << 16 | lift(g) << 8 | lift(b);
	}

	private static int lift(float v) {
		return Math.round((0.25f + 0.75f * v) * 255f);
	}

	private static void frame(Canvas c, int x1, int y1, int x2, int y2, int argb) {
		c.rect(x1, y1, x2, y1 + 1, argb);
		c.rect(x1, y2 - 1, x2, y2, argb);
		c.rect(x1, y1 + 1, x1 + 1, y2 - 1, argb);
		c.rect(x2 - 1, y1 + 1, x2, y2 - 1, argb);
	}

	/** A glow coming in from the screen edges. */
	private static void vignette(Canvas c, int w, int h, int rgb, float a) {
		if (a <= 0.01f) return;
		int band = Math.max(2, Math.min(w, h) / 36);
		for (int i = 0; i < 8; i++) {
			int o = i * band;
			if (o * 2 + band * 2 >= Math.min(w, h)) break;
			float k = 1 - i / 8f;
			int col = NimbusArt.argb(rgb, a * k * k * 0.55f);
			c.rect(o, o, w - o, o + band, col);
			c.rect(o, h - o - band, w - o, h - o, col);
			c.rect(o, o + band, o + band, h - o - band, col);
			c.rect(w - o - band, o + band, w - o, h - o - band, col);
		}
	}

	private static float seconds(long nanos) {
		return (nanos % 3_600_000_000_000L) / 1e9f;
	}

	private static int[] perimeter(int x1, int y1, int x2, int y2, float pos) {
		int w = x2 - x1;
		int h = y2 - y1;
		int per = 2 * (w + h);
		int d = Math.floorMod(Math.round(pos), per);
		if (d < w) return new int[] {x1 + d, y1};
		d -= w;
		if (d < h) return new int[] {x2 - 1, y1 + d};
		d -= h;
		if (d < w) return new int[] {x2 - 1 - d, y2 - 1};
		d -= w;
		return new int[] {x1, y2 - 1 - d};
	}

	/** Confetti rain, rings and a big word: the "you did it" moment. */
	private static void party(Layer l, int w, int h, String text) {
		word(l, text, w / 2f, h * 0.36f, w < 360 ? 2 : 3, 2.4f, 0);
		ring(l, w / 2f, h * 0.36f, 4, w * 0.45f, 1f, 0.8f, 0f, 0);
		ring(l, w / 2f, h * 0.36f, 4, w * 0.3f, 1f, 0.8f, 0.12f, 0);
		burst(l, w / 2f, h * 0.36f, many(40), 260f, 0.9f, 0);
		for (int i = 0; i < many(90); i++) {
			P p = rainbow(add(l, CONFETTI, rnd(0, w), rnd(-40, -4), rnd(-40, 40), rnd(20, 110), rnd(2.2f, 3.4f), rnd(1.5f, 3f), 0));
			p.grav = 60f;
			p.drag = 0.7f;
		}
	}

	// ------------------------------------------------------------------ menus

	private static final int BLOCKS = 0;
	private static final int SHUTTER = 1;
	private static final int ZOOM = 2;

	private static final ArrayDeque<Boolean> PUSHED = new ArrayDeque<>();
	private static Screen lastScreen;
	private static long openedAt;
	private static long lastTransition;
	private static int transition = -1;
	private static int seed;
	private static boolean openBurst;
	private static volatile boolean celebrate;
	private static int lastMx = Integer.MIN_VALUE;
	private static int lastMy;
	private static boolean leftWas;
	private static boolean rightWas;
	private static AbstractWidget hoverWas;
	private static float moteAcc;
	private static float starIn = 1.5f;

	/** Nimbus Features calls this when the switch is turned on. */
	static void celebrate() {
		celebrate = true;
	}

	/** How far a Nimbus Features row still has to slide in, `i` rows down the list. */
	static float slideIn(float seconds, int i) {
		float k = NimbusArt.clamp01((seconds - i * 0.035f) / 0.4f);
		return (1f - NimbusArt.easeOutBack(k)) * (i % 2 == 0 ? -90f : 90f);
	}

	/** Before a menu draws: notices a new menu and, for the zoom slam, scales it. */
	public static void beforeScreen(Canvas c, Screen screen) {
		boolean pushed = false;
		try {
			long now = System.nanoTime();
			if (screen != lastScreen) {
				lastScreen = screen;
				openedAt = now;
				transition = -1;
				// the loading screens flash past one after another: one bang is enough
				if (part("fx.transitions") && !(screen instanceof ChatScreen) && now - lastTransition > 600_000_000L) {
					transition = RND.nextInt(3);
					seed = RND.nextInt();
					lastTransition = now;
					openBurst = true;
				}
			}
			if (transition == ZOOM && on()) {
				float k = (now - openedAt) / 1e9f / 0.42f;
				if (k < 1f) {
					float s = 1f + 0.24f * (1f - NimbusArt.easeOutCubic(k));
					c.push(c.width() / 2f * (1 - s), c.height() / 2f * (1 - s), s);
					pushed = true;
				}
			}
		} catch (Throwable ignored) {
			// no zoom this frame
		}
		PUSHED.push(pushed);
	}

	/** After a menu draws: transition, glow, cursor trail and particles on top. */
	public static void afterScreen(Canvas c, Screen screen, int mx, int my) {
		if (!PUSHED.isEmpty() && PUSHED.pop()) c.pop();
		try {
			if (!on()) {
				MENU.list.clear();
				MENU.last = 0;
				transition = -1;
				return;
			}
			long now = System.nanoTime();
			float dt = MENU.tick(now);
			float t = seconds(now);
			int w = c.width();
			int h = c.height();
			if (part("fx.sparkles")) ambient(w, h, dt);
			if (part("fx.cursor")) cursor(mx, my);
			else lastMx = Integer.MIN_VALUE;
			if (openBurst) {
				openBurst = false;
				opening(w, h);
			}
			if (celebrate) {
				celebrate = false;
				party(MENU, w, h, "CRAZY MODE ON!");
			}
			if (transition >= 0) drawTransition(c, w, h, (now - openedAt) / 1e9f);
			if (part("fx.buttons")) glow(c, screen, mx, my, t);
			run(MENU, c, dt, t);
			if (part("fx.cursor")) orbit(c, mx, my, t);
		} catch (Throwable ignored) {
			// effects are extra: the menu itself is already drawn
		}
	}

	private static void opening(int w, int h) {
		float cx = w / 2f;
		float cy = h / 2f;
		switch (transition) {
			case SHUTTER -> {
				for (int i = 0; i < many(46); i++) {
					P p = rainbow(add(MENU, SPARK, cx + rnd(-w * 0.3f, w * 0.3f), cy, rnd(-320, 320), rnd(-70, 70), rnd(0.4f, 0.8f), RND.nextInt(3) == 0 ? 2 : 1, 0));
					p.drag = 0.1f;
				}
			}
			case ZOOM -> {
				ring(MENU, cx, cy, 4, w * 0.55f, 1f, 0.55f, 0f, 0);
				ring(MENU, cx, cy, 4, w * 0.38f, 1f, 0.55f, 0.08f, 0xFFFFFF);
				burst(MENU, cx, cy, many(50), 380f, 0.7f, 0);
			}
			default -> {
				ring(MENU, cx, cy, 4, w * 0.5f, 1f, 0.6f, 0.1f, 0);
				burst(MENU, cx, cy, many(24), 260f, 0.7f, 0);
			}
		}
	}

	private static void drawTransition(Canvas c, int w, int h, float s) {
		switch (transition) {
			case BLOCKS -> {
				// the menu is revealed block by block, breaking outward from the middle
				if (s > 0.62f) {
					transition = -1;
					return;
				}
				int cell = Math.max(10, Math.round(Math.min(w, h) / 11f));
				int cols = (w + cell - 1) / cell;
				int rows = (h + cell - 1) / cell;
				float far = (float) Math.hypot(w / 2f, h / 2f);
				for (int i = 0; i < cols; i++) {
					for (int j = 0; j < rows; j++) {
						float dist = (float) Math.hypot((i + 0.5f) * cell - w / 2f, (j + 0.5f) * cell - h / 2f) / far;
						float at = 0.04f + dist * 0.3f + NimbusArt.hash(seed + i * 131 + j * 7919) * 0.14f;
						float k = (s - at) / 0.12f;
						if (k >= 1f) continue;
						int x1 = i * cell;
						int y1 = j * cell;
						if (k <= 0f) {
							c.rect(x1, y1, x1 + cell, y1 + cell, 0xF20B0D14);
							c.rect(x1, y1, x1 + cell, y1 + 1, NimbusArt.argb(hue(dist + s), 0.35f));
							c.rect(x1, y1 + 1, x1 + 1, y1 + cell, NimbusArt.argb(hue(dist + s), 0.2f));
						} else {
							int in = Math.round(k * cell / 2f);
							int col = NimbusArt.mix(0x0B0D14, hue(dist * 2 + s), k);
							c.rect(x1 + in, y1 + in, x1 + cell - in, y1 + cell - in, NimbusArt.argb(col, 1 - k * 0.6f));
						}
					}
				}
			}
			case SHUTTER -> {
				// two halves slide apart with glowing rainbow edges
				float k = s / 0.45f;
				if (k >= 1f) {
					transition = -1;
					return;
				}
				float e = k < 0.5f ? 4 * k * k * k : 1 - (float) Math.pow(-2 * k + 2, 3) / 2;
				int half = h / 2;
				int off = Math.round(e * (half + 6));
				int top = half - off;
				int bottom = half + off;
				c.rect(0, 0, w, top, 0xF40B0D14);
				c.rect(0, bottom, w, h, 0xF40B0D14);
				for (int x = 0; x < w; x += 6) {
					int col = hue(x / (float) w + s * 2);
					c.rect(x, top - 2, x + 6, top, NimbusArt.argb(col, 1));
					c.rect(x, top, x + 6, top + 3, NimbusArt.argb(col, 0.3f));
					c.rect(x, bottom, x + 6, bottom + 2, NimbusArt.argb(col, 1));
					c.rect(x, bottom - 3, x + 6, bottom, NimbusArt.argb(col, 0.3f));
				}
			}
			case ZOOM -> {
				float k = s / 0.5f;
				if (k >= 1f) {
					transition = -1;
					return;
				}
				c.rect(0, 0, w, h, NimbusArt.argb(0xFFFFFF, 0.5f * (1 - k) * (1 - k)));
			}
			default -> transition = -1;
		}
	}

	/** Twinkles floating up, and now and then a shooting star. */
	private static void ambient(int w, int h, float dt) {
		moteAcc += dt * 16f * amount();
		while (moteAcc >= 1f) {
			moteAcc -= 1f;
			P p = rainbow(add(MENU, RND.nextInt(3) == 0 ? STAR : DOT, rnd(0, w), h + 3, rnd(-6, 6), rnd(-40, -12), rnd(3f, 7f), RND.nextInt(4) == 0 ? 2 : 1, 0));
			p.alpha = 0.55f;
		}
		starIn -= dt;
		if (starIn <= 0f) {
			starIn = rnd(1.6f, 4.2f) / amount();
			P p = add(MENU, SPARK, rnd(-20, w * 0.6f), rnd(-10, h * 0.35f), rnd(180, 290), rnd(50, 120), 1.2f, 1, 0xFFFFFF);
			p.trail = 20;
			p.alpha = 0.9f;
		}
	}

	/** Rainbow sparkles behind the mouse, and a burst on every click. */
	private static void cursor(int mx, int my) {
		if (lastMx != Integer.MIN_VALUE) {
			float dx = mx - lastMx;
			float dy = my - lastMy;
			float d = (float) Math.hypot(dx, dy);
			int n = Math.min(40, (int) (d * amount() / 3f));
			for (int i = 1; i <= n; i++) {
				float f = i / (float) n;
				P p = rainbow(add(MENU, DOT, lastMx + dx * f + rnd(-1, 1), lastMy + dy * f + rnd(-1, 1), rnd(-14, 14), rnd(-14, 14), rnd(0.3f, 0.65f), rnd(1f, 2.2f), 0));
				p.drag = 0.3f;
			}
		}
		lastMx = mx;
		lastMy = my;
		boolean left = mouse(true);
		boolean right = mouse(false);
		if (left && !leftWas) click(mx, my, false);
		if (right && !rightWas) click(mx, my, true);
		leftWas = left;
		rightWas = right;
	}

	private static void click(int x, int y, boolean right) {
		ring(MENU, x, y, 1, 20, 1f, 0.45f, 0f, right ? 0x22D3EE : 0);
		ring(MENU, x, y, 1, 11, 1f, 0.35f, 0.06f, 0xFFFFFF);
		burst(MENU, x, y, many(12), 180f, 0.5f, right ? 0x22D3EE : 0);
		confetti(MENU, x, y, many(8), -70, 70, -150, -60, 1.1f);
	}

	private static boolean mouse(boolean left) {
		try {
			var m = Minecraft.getInstance().mouseHandler;
			return left ? m.isLeftPressed() : m.isRightPressed();
		} catch (Throwable t) {
			return false;
		}
	}

	/** Three little lights circling the mouse. */
	private static void orbit(Canvas c, int mx, int my, float t) {
		for (int i = 0; i < 3; i++) {
			double a = t * 5.5 + i * Math.PI * 2 / 3;
			int x = mx + (int) Math.round(Math.cos(a) * 7);
			int y = my + (int) Math.round(Math.sin(a) * 7);
			int col = hue(t * 0.5f + i / 3f);
			c.rect(x - 1, y - 1, x + 2, y + 2, NimbusArt.argb(col, 0.25f));
			c.rect(x, y, x + 1, y + 1, NimbusArt.argb(col, 1f));
		}
	}

	/** The button under the mouse: a soft glow, a shine sweeping across and two comets racing round. */
	private static void glow(Canvas c, Screen screen, int mx, int my, float t) {
		AbstractWidget hover = hovered(screen.children(), mx, my, 0);
		if (hover != hoverWas && hover != null) {
			for (int i = 0; i < many(10); i++) {
				int[] pt = perimeter(hover.getX(), hover.getY(), hover.getX() + hover.getWidth(), hover.getY() + hover.getHeight(), rnd(0, 4000));
				float vx = (pt[0] - (hover.getX() + hover.getWidth() / 2f)) * 1.5f;
				float vy = (pt[1] - (hover.getY() + hover.getHeight() / 2f)) * 3f;
				P p = rainbow(add(MENU, SPARK, pt[0], pt[1], vx, vy, rnd(0.3f, 0.55f), 1, 0));
				p.drag = 0.05f;
			}
		}
		hoverWas = hover;
		if (hover == null) return;
		int x1 = hover.getX();
		int y1 = hover.getY();
		int x2 = x1 + hover.getWidth();
		int y2 = y1 + hover.getHeight();
		int col = hue(t * 0.35f);
		for (int i = 1; i <= 3; i++) frame(c, x1 - i, y1 - i, x2 + i, y2 + i, NimbusArt.argb(col, 0.3f / i));
		float band = (t * 0.9f) % 1.5f - 0.25f;
		int bx = x1 + Math.round(band * (x2 - x1));
		if (bx > x1 && bx < x2 - 6) {
			c.rect(bx, y1 + 1, bx + 3, y2 - 1, NimbusArt.argb(0xFFFFFF, 0.16f));
			c.rect(bx + 4, y1 + 1, bx + 5, y2 - 1, NimbusArt.argb(0xFFFFFF, 0.1f));
		}
		int per = 2 * ((x2 - x1 + 2) + (y2 - y1 + 2));
		for (int k = 0; k < 2; k++) {
			float head = (t * 110f + k * per / 2f) % per;
			for (int j = 0; j < 16; j++) {
				int[] pt = perimeter(x1 - 1, y1 - 1, x2 + 1, y2 + 1, head - j * 2.2f);
				int size = j < 3 ? 2 : 1;
				int jc = j == 0 ? 0xFFFFFF : hue(t * 0.6f + j * 0.03f + k * 0.5f);
				c.rect(pt[0] - size / 2, pt[1] - size / 2, pt[0] - size / 2 + size, pt[1] - size / 2 + size, NimbusArt.argb(jc, 1f - j / 16f));
			}
		}
	}

	/** The smallest button-sized widget under the mouse, looking inside lists too. */
	private static AbstractWidget hovered(List<? extends GuiEventListener> children, int mx, int my, int depth) {
		AbstractWidget best = null;
		for (GuiEventListener l : children) {
			AbstractWidget found = null;
			if (l instanceof AbstractWidget w && w.visible && mx >= w.getX() && my >= w.getY() && mx < w.getX() + w.getWidth() && my < w.getY() + w.getHeight()) {
				if (w.getHeight() <= 40 && w.getWidth() <= 420) found = w;
			}
			if (found == null && depth < 3 && l instanceof ContainerEventHandler box) {
				try {
					found = hovered(box.children(), mx, my, depth + 1);
				} catch (Throwable ignored) {
					// not a list we can look into
				}
			}
			if (found != null && (best == null || found.getWidth() * found.getHeight() < best.getWidth() * best.getHeight())) best = found;
		}
		return best;
	}

	// ------------------------------------------------------------------ in game

	private static Object lastPlayer;
	private static float lastHealth = -1f;
	private static int lastLevel = -1;
	private static float lastProgress;
	private static int lastSlot = -1;
	private static Map<Item, Integer> lastItems;
	private static long itemsAt;
	private static long settleUntil;
	private static boolean hadScreen;
	private static int attacks;
	private static int attacksSeen;
	private static int combo;
	private static long comboAt;
	private static P comboWord;
	private static float minVy;
	private static boolean wasGround = true;
	private static float sprint;
	private static float hurtFlash;
	private static float landFlash;
	private static float healFlash;
	private static long joinedAt;
	private static boolean welcomed = true;
	private static final float[][] LINES = new float[72][4];

	private static final class Pop {
		String name;
		int count;
		float age;
		float bump = 1f;
	}

	private static final List<Pop> POPS = new ArrayList<>();

	/** Called by the game each time you hit something. */
	public static void attacked() {
		attacks++;
	}

	/** Every frame from the in-game HUD. */
	public static void hud(Canvas c) {
		if (!on()) {
			if (lastPlayer != null || !HUD.list.isEmpty()) {
				HUD.list.clear();
				POPS.clear();
				lastPlayer = null;
			}
			HUD.last = 0;
			return;
		}
		Minecraft mc = Minecraft.getInstance();
		LocalPlayer p = mc.player;
		long now = System.nanoTime();
		float dt = HUD.tick(now);
		float t = seconds(now);
		if (p == null) {
			lastPlayer = null;
			return;
		}
		int w = c.width();
		int h = c.height();
		Screen screen = Compat.screen();
		if (p != lastPlayer) {
			// joined a world, respawned or changed dimension: start counting from here
			if (lastPlayer == null) {
				joinedAt = now;
				welcomed = false;
			}
			lastPlayer = p;
			lastHealth = p.getHealth();
			lastLevel = p.experienceLevel;
			lastProgress = p.experienceProgress;
			lastSlot = Compat.selectedSlot(p);
			lastItems = null;
			minVy = 0;
			wasGround = true;
			settleUntil = now + 1_000_000_000L;
		}
		boolean action = part("fx.action");
		try {
			if (action) events(mc, p, screen, w, h, now);
		} catch (Throwable ignored) {
			// a lookup this version lacks: skip those effects
		}
		if (Compat.hudHidden()) return;

		if (part("fx.speed")) {
			float bps = (float) NimbusHud.speed;
			float goal = screen != null ? 0f : Math.min(1f, (p.isSprinting() && bps > 3.5f ? 0.65f : 0f) + NimbusArt.clamp01((bps - 8f) / 20f));
			sprint += (goal - sprint) * Math.min(1f, dt * 5f);
			if (sprint > 0.02f) speedLines(c, w, h, dt, sprint);
		}
		if (part("fx.heartbeat")) {
			float hp = p.getHealth();
			if (hp > 0f && hp <= 6.5f) {
				float danger = 1f - hp / 7f;
				float ph = (t * (1.1f + danger * 1.3f)) % 1f;
				float env = (float) Math.exp(-ph * 10f) + (ph > 0.2f ? 0.7f * (float) Math.exp(-(ph - 0.2f) * 10f) : 0f);
				vignette(c, w, h, 0xE11D48, Math.min(1.4f, (0.4f + 0.9f * env) * (0.7f + danger * 0.5f)));
			}
		}
		hurtFlash = Math.max(0f, hurtFlash - dt * 1.8f);
		landFlash = Math.max(0f, landFlash - dt * 3f);
		healFlash = Math.max(0f, healFlash - dt * 1.5f);
		vignette(c, w, h, 0x22C55E, healFlash);
		vignette(c, w, h, 0xFF2E4D, hurtFlash);
		vignette(c, w, h, 0xFFFFFF, landFlash);
		run(HUD, c, dt, t);
		pops(c, w, h, dt);
	}

	private static void events(Minecraft mc, LocalPlayer p, Screen screen, int w, int h, long now) {
		if (!welcomed && now - joinedAt > 900_000_000L) {
			welcomed = true;
			if (screen == null && now - joinedAt < 8_000_000_000L) party(HUD, w, h, "GAME ON!");
		}

		float hp = p.getHealth();
		if (p.isAlive() && lastHealth >= 0f) {
			float d = lastHealth - hp;
			if (d >= 0.99f) hurt(w, h, d);
			else if (d <= -0.99f) heal(w, h, -d);
		}
		lastHealth = hp;

		int level = p.experienceLevel;
		if (level > lastLevel && lastLevel >= 0) levelUp(w, h, level);
		else if (level == lastLevel && p.experienceProgress > lastProgress + 0.001f) xp(w, h, p.experienceProgress);
		lastLevel = level;
		lastProgress = p.experienceProgress;

		int slot = Compat.selectedSlot(p);
		if (slot >= 0 && lastSlot >= 0 && slot != lastSlot) slotPop(w, h, slot);
		lastSlot = slot;

		if (attacks != attacksSeen) {
			attacksSeen = attacks;
			hit(w, h, now);
		}

		double vy = p.getDeltaMovement().y;
		boolean ground = p.onGround();
		if (!ground) minVy = vy > -0.08 ? 0f : Math.min(minVy, (float) vy);
		else {
			if (!wasGround && minVy < -0.85f) land(w, h, -minVy);
			minVy = 0f;
		}
		wasGround = ground;

		if (screen != null) {
			// chat comes and goes all the time: only real menus count
			hadScreen = !(screen instanceof ChatScreen);
			// items left in a crafting grid drop back into your inventory when it closes
			if (screen instanceof AbstractContainerScreen<?>) settleUntil = Math.max(settleUntil, now + 300_000_000L);
		} else if (hadScreen) {
			hadScreen = false;
			if (part("fx.transitions")) {
				ring(HUD, w / 2f, h / 2f, 2, 46, 1f, 0.4f, 0f, 0);
				burst(HUD, w / 2f, h / 2f, many(14), 200f, 0.45f, 0);
			}
		}
		if (now - itemsAt > 100_000_000L) {
			itemsAt = now;
			Map<Item, ItemStack> names = new HashMap<>();
			Map<Item, Integer> items = items(p.getInventory(), names);
			if (lastItems != null && screen == null && now > settleUntil) {
				for (Map.Entry<Item, Integer> e : items.entrySet()) {
					int gained = e.getValue() - lastItems.getOrDefault(e.getKey(), 0);
					if (gained > 0) pickup(w, h, names.get(e.getKey()).getHoverName().getString(), gained);
				}
			}
			lastItems = items;
		}
	}

	private static Map<Item, Integer> items(Inventory inv, Map<Item, ItemStack> names) {
		Map<Item, Integer> out = new HashMap<>();
		int n = Math.min(inv.getContainerSize(), 64);
		for (int i = 0; i < n; i++) {
			ItemStack s = inv.getItem(i);
			if (s.isEmpty()) continue;
			out.merge(s.getItem(), s.getCount(), Integer::sum);
			names.putIfAbsent(s.getItem(), s);
		}
		return out;
	}

	private static void hurt(int w, int h, float d) {
		hurtFlash = Math.min(1f, 0.45f + d / 8f);
		P n = word(HUD, "-" + (int) Math.ceil(d), w / 2f + rnd(-24, 24), h / 2f - 18, 2, 1f, 0xFF4D5E);
		n.vx = rnd(-30, 30);
		n.vy = -40f;
		for (int i = 0; i < many(16); i++) {
			double a = RND.nextDouble() * Math.PI * 2;
			float v = rnd(80, 240);
			P s = add(HUD, SPARK, w / 2f, h / 2f, (float) Math.cos(a) * v, (float) Math.sin(a) * v, rnd(0.3f, 0.6f), 2, RND.nextBoolean() ? 0xFF4D5E : 0xFB923C);
			s.drag = 0.1f;
		}
	}

	private static void heal(int w, int h, float d) {
		int x0 = w / 2 - 91;
		healFlash = Math.min(0.7f, 0.3f + d / 20f);
		P n = word(HUD, "+" + (int) Math.floor(d), x0 + 40, h - 50, 1, 1.1f, 0x4ADE80);
		n.vy = -30f;
		for (int i = 0; i < many(8 + d * 2); i++) {
			P s = add(HUD, STAR, x0 + rnd(0, 81), h - 39 + rnd(-2, 6), rnd(-10, 10), rnd(-70, -30), rnd(0.8f, 1.3f), 3, RND.nextBoolean() ? 0x4ADE80 : 0xBBF7D0);
			s.hue = RND.nextFloat();
		}
	}

	private static void xp(int w, int h, float progress) {
		float x = w / 2f - 91 + 182 * progress;
		for (int i = 0; i < many(4); i++) add(HUD, DOT, x + rnd(-3, 3), h - 29, rnd(-15, 15), rnd(-50, -15), rnd(0.4f, 0.8f), 1, RND.nextBoolean() ? 0xA3E635 : 0xFACC15);
	}

	private static void levelUp(int w, int h, int level) {
		float y = h * 0.3f;
		int cell = w < 360 ? 2 : 3;
		word(HUD, "LEVEL UP!", w / 2f, y, cell, 2.6f, 0);
		word(HUD, "LEVEL " + level, w / 2f, y + cell * 11 + 4, Math.max(1, cell - 1), 2.6f, 0xFACC15).age = -0.15f;
		for (int i = 0; i < 3; i++) ring(HUD, w / 2f, y, 6, w * (0.3f + i * 0.12f), 1f, 0.9f, i * 0.12f, 0);
		burst(HUD, w / 2f, y, many(40), 320f, 0.9f, 0);
		confetti(HUD, 0, h, many(55), 60, 240, -340, -170, 2.6f);
		confetti(HUD, w, h, many(55), -240, -60, -340, -170, 2.6f);
	}

	private static void slotPop(int w, int h, int slot) {
		float x = w / 2f - 91 + 11 + 20 * slot;
		float y = h - 11;
		P b = rainbow(add(HUD, BOX, x, y, 0, 0, 0.55f, 1, 0));
		b.r0 = 12;
		b.r1 = 19;
		P flash = add(HUD, BOX, x, y, 0, 0, 0.3f, 1, 0xFFFFFF);
		flash.r0 = 11;
		flash.r1 = 11;
		flash.alpha = 0.55f;
		flash.trail = 0;
		ring(HUD, x, y, 4, 22, 1f, 0.4f, 0f, 0);
		for (int i = 0; i < many(12); i++) {
			P s = rainbow(add(HUD, SPARK, x, y - 6, rnd(-90, 90), rnd(-200, -80), rnd(0.35f, 0.6f), RND.nextInt(3) == 0 ? 2 : 1, 0));
			s.grav = 320f;
		}
	}

	private static void hit(int w, int h, long now) {
		combo = now - comboAt < 1_500_000_000L ? combo + 1 : 1;
		comboAt = now;
		float cx = w / 2f;
		float cy = h / 2f;
		add(HUD, HIT, cx, cy, 0, 0, 0.3f, 1, combo > 2 ? 0xFACC15 : 0xFF6B6B);
		ring(HUD, cx, cy, 3, 16, 1f, 0.3f, 0f, 0xFFFFFF);
		burst(HUD, cx, cy, many(10), 220f, 0.35f, combo > 2 ? 0 : 0xFFB86B);
		if (combo >= 2) {
			if (comboWord != null) comboWord.age = comboWord.life;
			comboWord = word(HUD, "COMBO X" + combo, cx + 48, cy - 24, combo >= 6 ? 2 : 1, 1f, 0);
			if (combo % 5 == 0) ring(HUD, cx, cy, 6, w * 0.4f, 1f, 0.6f, 0f, 0);
		}
	}

	private static void land(int w, int h, float speed) {
		float power = NimbusArt.clamp01((speed - 0.8f) / 2.5f);
		landFlash = 0.35f + power * 0.5f;
		ring(HUD, w / 2f, h - 6, 10, w * (0.3f + power * 0.4f), 0.18f, 0.6f, 0f, 0xFFFFFF);
		ring(HUD, w / 2f, h - 6, 10, w * (0.2f + power * 0.3f), 0.18f, 0.6f, 0.1f, 0);
		for (int i = 0; i < many(30 * (0.5f + power)); i++) {
			P s = add(HUD, DOT, rnd(0, w), h - 1, rnd(-40, 40), -rnd(60, 200) * (0.6f + power), rnd(0.6f, 1f), RND.nextInt(3) == 0 ? 2 : 1, RND.nextBoolean() ? 0xB0B4C8 : 0xFFFFFF);
			s.grav = 320f;
		}
	}

	private static void pickup(int w, int h, String name, int count) {
		for (Pop p : POPS) {
			if (p.name.equals(name) && p.age < 2.2f) {
				p.count += count;
				p.age = Math.min(p.age, 0.3f);
				p.bump = 0f;
				return;
			}
		}
		Pop p = new Pop();
		p.name = name;
		p.count = count;
		POPS.add(p);
		if (POPS.size() > 6) POPS.remove(0);
		for (int i = 0; i < many(5); i++) add(HUD, STAR, w / 2f + 100 + rnd(0, 30), h - 8 + rnd(-3, 3), rnd(-10, 10), rnd(-40, -15), rnd(0.5f, 0.9f), 2, 0x86EFAC);
	}

	/** "+3 Oak Log" notes stacking up beside the hotbar. */
	private static void pops(Canvas c, int w, int h, float dt) {
		for (int i = POPS.size() - 1; i >= 0; i--) {
			Pop p = POPS.get(i);
			p.age += dt;
			p.bump += dt;
			if (p.age > 2.7f) POPS.remove(i);
		}
		int x = w / 2 + 100;
		for (int i = 0; i < POPS.size(); i++) {
			Pop p = POPS.get(i);
			int row = POPS.size() - 1 - i;
			float k = NimbusArt.clamp01(p.age / 0.25f);
			float slide = (1f - NimbusArt.easeOutBack(k)) * 40f;
			float a = p.age > 2.2f ? 1f - (p.age - 2.2f) / 0.5f : 1f;
			float scale = 1f + 0.35f * (1f - NimbusArt.clamp01(p.bump / 0.2f));
			String count = "+" + p.count + " ";
			String name = Ui.fit(c, p.name, Math.max(20, w - x - 8 - c.textWidth(count)));
			c.push(x + slide, h - 14 - row * 11, scale);
			try {
				c.text(count, 0, 0, NimbusArt.argb(0x86EFAC, a), true);
				c.text(name, c.textWidth(count), 0, NimbusArt.argb(0xFFFFFF, a), true);
			} finally {
				c.pop();
			}
		}
	}

	/** Anime speed lines rushing in from the edges. */
	private static void speedLines(Canvas c, int w, int h, float dt, float strength) {
		int n = Math.min(LINES.length, Math.round(40 * amount()));
		float cx = w / 2f;
		float cy = h / 2f;
		float far = (float) Math.hypot(cx, cy);
		for (int i = 0; i < n; i++) {
			float[] l = LINES[i];
			if (l[2] == 0f || l[1] >= 1f) {
				boolean fresh = l[2] == 0f;
				l[0] = rnd(0, (float) (Math.PI * 2));
				l[1] = fresh ? rnd(0, 1) : 0f;
				l[2] = rnd(2.2f, 4f);
				l[3] = rnd(0.1f, 0.28f);
			}
			l[1] += dt * l[2];
			float outer = far * (1.02f - Math.min(1f, l[1]) * 0.42f);
			float inner = outer - l[3] * far;
			float cos = (float) Math.cos(l[0]);
			float sin = (float) Math.sin(l[0]);
			float a = strength * (float) Math.sin(Math.PI * Math.min(1f, l[1]));
			int size = i % 2 == 0 ? 2 : 1;
			int rgb = i % 3 == 0 ? 0xCFFAFE : 0xFFFFFF;
			for (float r = inner; r < outer; r += 1.5f) {
				float f = (r - inner) / (outer - inner);
				int x = Math.round(cx + cos * r);
				int y = Math.round(cy + sin * r);
				c.rect(x, y, x + size, y + size, NimbusArt.argb(rgb, a * (0.25f + 0.75f * f)));
			}
		}
	}
}
