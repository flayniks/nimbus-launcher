package dev.flayniks.nimbus;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.Difficulty;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.monster.Enemy;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;

/**
 * Counts what you do in game for Nimbus coins: blocks mined and placed, mobs beaten, blocks
 * walked, time played... Today's totals (by UTC day, like the tasks) go into the file the
 * launcher passes with -Dnimbus.progress; the launcher sends them to the Nimbus service, which
 * pays out daily tasks and achievements. Today's tasks come back in -Dnimbus.tasks, so a
 * finished one can be cheered right away.
 *
 * Everything is seen from the client, so it works on any server: a block counts as mined when
 * your game breaks it, a mob as beaten when it dies soon after you hit it. Creative mode
 * doesn't count for mining, placing or fighting.
 */
public final class Progress {
	private Progress() {
	}

	private static final String FILE = System.getProperty("nimbus.progress");
	private static final String TASKS_FILE = System.getProperty("nimbus.tasks");
	private static final Map<String, Double> STATS = new LinkedHashMap<>();
	private static String day;
	private static boolean loaded;
	private static boolean dirty;
	private static long savedAt;
	private static long lastTick;

	// what the last tick saw, to count the difference
	private static Player seenPlayer;
	private static Object seenLevel;
	private static long settleUntil;
	private static double px;
	private static double py;
	private static double pz;
	private static int food = -1;
	private static int xp = -1;
	private static int level = -1;
	private static boolean sleeping;
	private static int fishHeld = -1;
	private static long fishingSeen;
	private static long fishChecked;
	private static long usingSeen;
	private static final Map<Entity, Long> HIT = new IdentityHashMap<>();
	/** Mobs already counted, so hitting one again while it falls over doesn't count twice. */
	private static final Map<Entity, Boolean> COUNTED = new java.util.WeakHashMap<>();

	// today's tasks, to say when one is done
	private static long tasksChecked;
	private static long tasksModified = -1;
	private static JsonArray tasks = new JsonArray();
	private static final Set<String> CHEERED = new HashSet<>();

	public static boolean enabled() {
		return FILE != null;
	}

	/** Every client tick (Minecraft.tick). */
	public static void tick() {
		if (FILE == null) return;
		try {
			step();
		} catch (Throwable ignored) {
			// counting is extra: never break the game over it
		}
	}

	private static void step() {
		long now = System.currentTimeMillis();
		String today = LocalDate.now(ZoneOffset.UTC).toString();
		if (!loaded) load(today);
		if (!today.equals(day)) {
			save();
			day = today;
			STATS.clear();
			CHEERED.clear();
			dirty = true;
		}
		float dt = lastTick == 0 ? 0 : Math.min(1000, now - lastTick) / 1000f;
		lastTick = now;

		Minecraft mc = Minecraft.getInstance();
		Player p = mc.player;
		if (mc.level == null || p == null) {
			seenPlayer = null;
			HIT.clear();
			if (dirty) save();
			return;
		}
		// a new world, a respawn or a new dimension: start the differences over, and let the
		// server's first updates (health, food, experience) arrive before counting them
		if (p != seenPlayer || mc.level != seenLevel) {
			seenPlayer = p;
			seenLevel = mc.level;
			settleUntil = now + 3000;
			px = p.getX();
			py = p.getY();
			pz = p.getZ();
			food = -1;
			xp = -1;
			level = -1;
			fishHeld = -1;
			sleeping = p.isSleeping();
		}
		boolean settled = now >= settleUntil;
		boolean spectator = p.isSpectator();

		if (!mc.isPaused()) {
			add("play", dt);
			if (mc.level.players().size() > 1) add("together", dt);
			String dim = String.valueOf(mc.level.dimension());
			if (dim.contains("the_nether")) add("nether", dt);
			else if (dim.contains("the_end")) add("end", dt);
		}

		// moving: on foot, sprinting, swimming, flying with an elytra, riding
		double dx = p.getX() - px;
		double dy = p.getY() - py;
		double dz = p.getZ() - pz;
		px = p.getX();
		py = p.getY();
		pz = p.getZ();
		double flat = Math.sqrt(dx * dx + dz * dz);
		double full = Math.sqrt(dx * dx + dy * dy + dz * dz);
		// per tick, more than anyone can go that way is a teleport (or a server correcting you)
		if (settled && !spectator && full > 0.001 && !p.getAbilities().flying) {
			if (p.isPassenger()) {
				if (full < 4) add("ride", flat);
			} else if (p.isFallFlying()) {
				if (full < 5) add("fly", full);
			} else if (p.isSwimming() || p.isInWater()) {
				if (full < 1.5) add("swim", full);
			} else if (flat < 1.5) {
				add("walk", flat);
				if (p.isSprinting()) add("sprint", flat);
			}
		}

		// eating: food going up just after you were using an item (not saturation, not peaceful's
		// regrowth); experience and levels: what the server tells us went up
		if (p.isUsingItem()) usingSeen = now;
		int f = p.getFoodData().getFoodLevel();
		if (settled && food >= 0 && f > food && now - usingSeen < 1500 && mc.level.getDifficulty() != Difficulty.PEACEFUL) add("eat", 1);
		food = f;
		int x = p.totalExperience;
		if (settled && xp >= 0 && x > xp) add("xp", x - xp);
		xp = x;
		int l = p.experienceLevel;
		if (settled && level >= 0 && l > level) add("levels", l - level);
		level = l;
		boolean s = p.isSleeping();
		if (s && !sleeping) add("sleep", 1);
		sleeping = s;

		// fish: fish turning up in your bag while (or just after) a line is out
		if (p.fishing != null) fishingSeen = now;
		if (now - fishChecked > 500 || fishHeld < 0) {
			fishChecked = now;
			int n = fishCount(p);
			if (settled && fishHeld >= 0 && n > fishHeld && now - fishingSeen < 4000) add("fish", n - fishHeld);
			fishHeld = n;
		}

		// mobs you hit that died soon after
		for (Iterator<Map.Entry<Entity, Long>> it = HIT.entrySet().iterator(); it.hasNext();) {
			Map.Entry<Entity, Long> e = it.next();
			Entity target = e.getKey();
			if (target instanceof LivingEntity living && living.isDeadOrDying()) {
				add("kills", 1);
				if (target instanceof Enemy) add("hostile", 1);
				COUNTED.put(target, Boolean.TRUE);
				it.remove();
			} else if (now - e.getValue() > 4000 || target.isRemoved()) {
				it.remove();
			}
		}

		cheer(now);
		if (dirty && now - savedAt > 15_000) save();
	}

	private static int fishCount(Player p) {
		int n = 0;
		var inv = p.getInventory();
		for (int i = 0; i < inv.getContainerSize(); i++) {
			ItemStack st = inv.getItem(i);
			if (st.isEmpty()) continue;
			String id = String.valueOf(BuiltInRegistries.ITEM.getKey(st.getItem()));
			if (id.endsWith(":cod") || id.endsWith(":salmon") || id.endsWith(":tropical_fish") || id.endsWith(":pufferfish")) n += st.getCount();
		}
		return n;
	}

	private static boolean counts(Player p) {
		return p != null && !p.isSpectator() && !p.getAbilities().instabuild;
	}

	// ------------------------------------------------------------------ from the mixins

	/** You broke a block (MultiPlayerGameMode.destroyBlock). */
	public static void broke(BlockState state) {
		if (FILE == null || state == null) return;
		try {
			if (!counts(Minecraft.getInstance().player) || state.isAir()) return;
			add("mine", 1);
			String id = String.valueOf(BuiltInRegistries.BLOCK.getKey(state.getBlock()));
			if (id.endsWith("_ore") || id.endsWith(":ancient_debris")) add("ores", 1);
			if (id.endsWith("diamond_ore")) add("diamonds", 1);
			if (id.endsWith("_log") || id.endsWith("_stem") || id.endsWith("_wood") || id.endsWith("_hyphae")) add("logs", 1);
		} catch (Throwable ignored) {
			// not counted
		}
	}

	private static BlockPos placeAt;
	private static BlockPos placeNext;
	private static BlockState placeBefore;
	private static BlockState nextBefore;

	/** Right-clicking a block, before the game does anything (MultiPlayerGameMode.useItemOn). */
	public static void useStart(BlockHitResult hit) {
		placeAt = null;
		if (FILE == null || hit == null) return;
		try {
			Minecraft mc = Minecraft.getInstance();
			if (mc.level == null || !counts(mc.player)) return;
			placeAt = hit.getBlockPos();
			placeNext = placeAt.relative(hit.getDirection());
			placeBefore = mc.level.getBlockState(placeAt);
			nextBefore = mc.level.getBlockState(placeNext);
		} catch (Throwable ignored) {
			placeAt = null;
		}
	}

	/** ...and after: a block appeared where there was room for one. Doors opening and the like don't count. */
	public static void useEnd() {
		if (placeAt == null) return;
		try {
			Minecraft mc = Minecraft.getInstance();
			if (mc.level == null) return;
			if (appeared(placeBefore, mc.level.getBlockState(placeAt)) || appeared(nextBefore, mc.level.getBlockState(placeNext))) add("place", 1);
		} catch (Throwable ignored) {
			// not counted
		} finally {
			placeAt = null;
		}
	}

	private static boolean appeared(BlockState before, BlockState after) {
		return before != after && (before.isAir() || before.canBeReplaced()) && !after.isAir() && !after.canBeReplaced();
	}

	/** You hit something (MultiPlayerGameMode.attack): remember it, and count a critical hit. */
	public static void attacked(Player p, Entity target) {
		if (FILE == null || target == null) return;
		try {
			if (!counts(p) || !(target instanceof LivingEntity living) || living.isDeadOrDying() || COUNTED.containsKey(target)) return;
			HIT.put(target, System.currentTimeMillis());
			boolean falling = !p.onGround() && p.getDeltaMovement().y < 0 && !p.onClimbable() && !p.isInWater() && !p.isPassenger() && !p.isSprinting();
			if (falling && p.getAttackStrengthScale(0.5f) > 0.9f) add("crits", 1);
		} catch (Throwable ignored) {
			// not counted
		}
	}

	// ------------------------------------------------------------------ totals

	private static void add(String stat, double n) {
		if (n <= 0) return;
		STATS.merge(stat, n, Double::sum);
		dirty = true;
	}

	private static void load(String today) {
		loaded = true;
		day = today;
		// closing the game from inside a world skips the save on the way out
		Runtime.getRuntime().addShutdownHook(new Thread(Progress::save, "Nimbus progress"));
		try {
			Path f = Path.of(FILE);
			if (!Files.exists(f)) return;
			JsonObject o = JsonParser.parseString(Files.readString(f, StandardCharsets.UTF_8)).getAsJsonObject();
			if (!today.equals(o.has("day") ? o.get("day").getAsString() : "")) return;
			for (Map.Entry<String, JsonElement> e : o.getAsJsonObject("stats").entrySet()) STATS.put(e.getKey(), e.getValue().getAsDouble());
		} catch (Exception ignored) {
			// start today from zero
		}
	}

	/** Writes today's totals (whole numbers) for the launcher. */
	static synchronized void save() {
		if (FILE == null || day == null) return;
		dirty = false;
		savedAt = System.currentTimeMillis();
		JsonObject stats = new JsonObject();
		for (Map.Entry<String, Double> e : STATS.entrySet()) stats.addProperty(e.getKey(), (long) Math.floor(e.getValue()));
		JsonObject o = new JsonObject();
		o.addProperty("day", day);
		o.add("stats", stats);
		o.addProperty("at", savedAt);
		try {
			Path f = Path.of(FILE);
			Path tmp = f.resolveSibling(f.getFileName() + ".tmp");
			Files.writeString(tmp, o.toString(), StandardCharsets.UTF_8);
			Files.move(tmp, f, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
		} catch (Exception e) {
			try {
				Files.writeString(Path.of(FILE), o.toString(), StandardCharsets.UTF_8);
			} catch (Exception ignored) {
				// try again later
			}
		}
	}

	// ------------------------------------------------------------------ cheering

	private static void cheer(long now) {
		if (TASKS_FILE == null) return;
		if (now - tasksChecked > 3000) {
			tasksChecked = now;
			try {
				Path f = Path.of(TASKS_FILE);
				long m = Files.exists(f) ? Files.getLastModifiedTime(f).toMillis() : 0;
				if (m != tasksModified) {
					tasksModified = m;
					JsonObject o = m == 0 ? null : JsonParser.parseString(Files.readString(f, StandardCharsets.UTF_8)).getAsJsonObject();
					tasks = o != null && day.equals(o.get("day").getAsString()) ? o.getAsJsonArray("tasks") : new JsonArray();
				}
			} catch (Exception ignored) {
				// keep what we had
			}
		}
		for (JsonElement el : tasks) {
			JsonObject t = el.getAsJsonObject();
			String id = t.get("id").getAsString();
			if (CHEERED.contains(id)) continue;
			if (t.has("done") && t.get("done").getAsBoolean()) {
				CHEERED.add(id); // done before this session
				continue;
			}
			double have = STATS.getOrDefault(t.get("stat").getAsString(), 0.0);
			if (have >= t.get("goal").getAsDouble()) {
				CHEERED.add(id);
				CHEERS.add(new Cheer(t.get("title").getAsString(), t.get("reward").getAsInt(), now));
				save(); // so the launcher sees it at its next look
			}
		}
	}

	private record Cheer(String title, int reward, long at) {
	}

	private static final java.util.List<Cheer> CHEERS = new java.util.ArrayList<>();
	private static final long CHEER_MS = 6000;

	/** A little card at the top for each task just finished, drawn with the HUD (clear of vanilla's toasts on the right). */
	public static void draw(Canvas c) {
		if (CHEERS.isEmpty()) return;
		long now = System.currentTimeMillis();
		CHEERS.removeIf((ch) -> now - ch.at > CHEER_MS);
		int y = 30;
		for (Cheer ch : CHEERS) {
			float age = (now - ch.at) / 1000f;
			float in = NimbusArt.clamp01(age / 0.35f);
			float out = NimbusArt.clamp01((CHEER_MS / 1000f - age) / 0.35f);
			float k = Math.min(NimbusArt.easeOutBack(in), out);
			String title = "Daily task done!";
			String line = ch.title;
			String coins = "+" + ch.reward;
			int w = Math.max(c.textWidth(title) + c.textWidth(coins) + 16, c.textWidth(line)) + 40;
			int h = 32;
			int x = (c.width() - w) / 2;
			int dy = Math.round((1f - k) * -(h + 30));
			int top = y + dy;
			float glow = 0.5f + 0.5f * (float) Math.sin(age * 6);
			c.rect(x - 1, top - 1, x + w + 1, top + h + 1, NimbusArt.argb(NimbusArt.mix(0xF59E0B, 0xFDE68A, glow), 0.95f));
			c.rect(x, top, x + w, top + h, 0xF2120E26);
			coin(c, x + 8, top + 8, age);
			c.text(title, x + 30, top + 5, 0xFFFCD34D, true);
			c.text(coins, x + w - 8 - c.textWidth(coins), top + 5, 0xFFFDE68A, true);
			c.text(line, x + 30, top + 18, 0xFFFFFFFF, false);
			// a strip that runs out with the card
			int bar = Math.round((w - 2) * NimbusArt.clamp01(1f - age / (CHEER_MS / 1000f)));
			c.rect(x + 1, top + h - 2, x + 1 + bar, top + h - 1, 0x99FBBF24);
			y += h + 6;
		}
	}

	/** A 16px gold coin with an N, spinning a little. */
	private static void coin(Canvas c, int x, int y, float t) {
		float squash = 0.55f + 0.45f * Math.abs((float) Math.cos(t * 3));
		int half = Math.max(1, Math.round(8 * squash));
		int cx = x + 8;
		for (int j = 0; j < 16; j++) {
			float dy = (j + 0.5f - 8) / 8f;
			float span = (float) Math.sqrt(Math.max(0, 1 - dy * dy));
			int w = Math.round(half * span);
			if (w <= 0) continue;
			c.rect(cx - w, y + j, cx + w, y + j + 1, 0xFFB45309);
			if (w > 1) c.rect(cx - w + 1, y + j, cx + w - 1, y + j + 1, j < 8 ? 0xFFFCD34D : 0xFFFBBF24);
		}
		if (half >= 5) {
			// the N
			int nx = cx - 3;
			c.rect(nx, y + 4, nx + 1, y + 12, 0xFF92400E);
			c.rect(nx + 5, y + 4, nx + 6, y + 12, 0xFF92400E);
			for (int i = 0; i < 4; i++) c.rect(nx + 1 + i, y + 5 + i * 2, nx + 2 + i, y + 7 + i * 2, 0xFF92400E);
		}
	}

	/** How far along today's tasks are, for the Nimbus menu: [title, have, goal, reward, done] each. */
	public static java.util.List<Object[]> today() {
		java.util.List<Object[]> out = new java.util.ArrayList<>();
		for (JsonElement el : tasks) {
			JsonObject t = el.getAsJsonObject();
			double goal = t.get("goal").getAsDouble();
			double have = Math.min(goal, STATS.getOrDefault(t.get("stat").getAsString(), 0.0));
			boolean done = have >= goal || (t.has("done") && t.get("done").getAsBoolean());
			out.add(new Object[] {t.get("title").getAsString(), have, goal, t.get("reward").getAsInt(), done, t.get("stat").getAsString()});
		}
		return out;
	}
}
