package dev.flayniks.nimbus;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/**
 * Nimbus' in-game wardrobe: pick a skin, arm model and cape and wear them without
 * leaving the game, or search for new skins by keyword or player name. Everything is
 * painted with plain rectangles and text; vanilla buttons and the text box are only
 * used, unpainted, for clicks, typing, keyboard focus and narration, so the screen
 * behaves the same across every supported Minecraft version.
 */
public abstract class SkinsScreenBase extends Screen {
	private static ExecutorService worker(String name) {
		return Executors.newSingleThreadExecutor(r -> {
			Thread t = new Thread(r, name);
			t.setDaemon(true);
			return t;
		});
	}

	private static final ExecutorService IO = worker("Nimbus skins");
	// searches get their own thread so an upload or a folder check never holds them up
	private static final ExecutorService SEARCH = worker("Nimbus skin search");

	static final int TEXT = 0xFFFFFFFF;
	static final int MUTED = 0xFF8B90A5;
	static final int FAINT = 0xFF5C6178;
	static final int GOOD = 0xFF34D399;
	static final int BAD = 0xFFF87171;
	static final int ACCENT = 0xFF7C5CFF;
	static final int ACCENT_2 = 0xFFC084FC;

	private static final int NORMAL = 0;
	private static final int PRIMARY = 1;
	private static final int TILE = 2;
	private static final int ICON = 3;

	private enum Kind { CURRENT, WARDROBE, FOUND, PLAYER }

	private static final class Tile {
		final Kind kind;
		final String name;
		final String wardrobeId;
		final byte[] png;
		final Png image;
		final boolean slim;
		final String key;

		Tile(Kind kind, String name, String wardrobeId, byte[] png, Png image, boolean slim) {
			this.kind = kind;
			this.name = name;
			this.wardrobeId = wardrobeId;
			this.png = png;
			this.image = image;
			this.slim = slim;
			this.key = kind == Kind.WARDROBE ? "w:" + wardrobeId : kind + ":" + java.util.Arrays.hashCode(png) + ":" + name;
		}

		boolean found() {
			return kind == Kind.FOUND || kind == Kind.PLAYER;
		}
	}

	private static final class Btn {
		Button button;
		String label;
		int kind;
		int tile = -1;
	}

	protected final Screen parent;
	private final Wardrobe wardrobe;
	private final String token;
	private final ConcurrentLinkedQueue<Runnable> inbox = new ConcurrentLinkedQueue<>();
	private final long openedAt = System.nanoTime();
	private final List<Btn> btns = new ArrayList<>();

	private SkinApi.Profile profile;
	private byte[] currentPng;
	private Png currentImage;
	private Map<String, Png> capeImages = new HashMap<>();
	private String wornId;
	private List<Wardrobe.Entry> entries = new ArrayList<>();
	private final List<Tile> tiles = new ArrayList<>();

	// searching
	private EditBox searchBox;
	private boolean searchFocused;
	private String query = "";
	private long typedAt;
	private String searched = "";
	private final List<Tile> found = new ArrayList<>();
	private String next;
	private boolean searching;
	private String searchError;
	private int searchGen;

	private Tile chosen;
	private boolean slim;
	private int cape = -1;
	private boolean back;
	private int page;
	private boolean loading = true;
	private boolean busy;
	private boolean picking;
	private String status = "Loading your skin";
	private int statusColor = MUTED;
	private boolean statusDots = true;
	private long changedAt;
	private long lastPoll;
	private boolean polling;

	// layout, worked out in init()
	private int stageX1, stageY1, stageX2, stageY2;
	private int gridX, gridY, gridW, tileW, tileH, tileScale, cols, perPage, pages;
	private int boxX1, boxY1, boxX2, boxY2;
	private Btn armsBtn, capeBtn, wearBtn, turnBtn, addBtn, nextBtn;

	protected SkinsScreenBase(Screen parent) {
		super(Component.literal("Skins & Capes"));
		this.parent = parent;
		Minecraft mc = Minecraft.getInstance();
		this.wardrobe = new Wardrobe(mc.gameDirectory.toPath().resolve("nimbus-skins"));
		this.token = mc.getUser().getAccessToken();
		reload(null, null);
	}

	/** Swaps the game to another screen (the call moved between versions). */
	protected abstract void show(Screen screen);

	/** Lets the player choose skin files, or opens the wardrobe folder where there is no file dialog. */
	protected abstract void pickFiles(java.util.function.Consumer<List<Path>> chosen);

	@Override
	public void onClose() {
		show(parent);
	}

	private boolean searchMode() {
		return !query.isEmpty();
	}

	// ------------------------------------------------------------------ data

	private void reload(String selectId, String doneMessage) {
		loading = true;
		IO.execute(() -> {
			wardrobe.importLoose();
			List<Wardrobe.Entry> list = wardrobe.list();
			SkinApi.Profile p = null;
			byte[] cur = null;
			Png curImg = null;
			Map<String, Png> capes = new HashMap<>();
			String error = null;
			try {
				p = SkinApi.profile(token);
				if (p.skinUrl != null && !p.skinUrl.isEmpty()) {
					cur = SkinApi.download(p.skinUrl);
					curImg = Png.read(cur);
				}
				for (SkinApi.Cape c : p.capes) {
					try {
						capes.put(c.id, Png.read(SkinApi.download(c.url)));
					} catch (IOException ignored) {
						// shown without a picture
					}
				}
			} catch (IOException e) {
				error = e.getMessage();
			}
			String worn = p == null ? null : wardrobe.wornId(p.id, p.skinUrl);
			SkinApi.Profile fp = p;
			byte[] fcur = cur;
			Png fimg = curImg;
			String ferr = error;
			inbox.add(() -> {
				profile = fp;
				currentPng = fcur;
				currentImage = fimg;
				capeImages = capes;
				wornId = worn;
				entries = list;
				loading = false;
				cape = fp == null ? -1 : fp.activeCape();
				buildTiles(selectId);
				if (ferr != null) setStatus(ferr, BAD);
				else if (doneMessage != null) setStatus(doneMessage, GOOD);
				else if (!searchMode()) setStatus(tiles.isEmpty() ? "Search for skins, or drop PNGs on this window" : "Pick a skin, or search for a new one", MUTED);
				rebuild();
			});
		});
	}

	/** Re-reads only the wardrobe folder (after adding files). */
	private void refreshWardrobe(String selectId, String message) {
		polling = true;
		IO.execute(() -> {
			String imported = wardrobe.importLoose();
			List<Wardrobe.Entry> list = wardrobe.list();
			String pick = selectId != null ? selectId : imported;
			inbox.add(() -> {
				polling = false;
				boolean changed = list.size() != entries.size() || pick != null;
				entries = list;
				if (!changed) return;
				buildTiles(searchMode() ? null : pick);
				if (message != null) setStatus(message, GOOD);
				else if (imported != null) setStatus("Added a skin from the wardrobe folder", GOOD);
				rebuild();
			});
		});
	}

	private void buildTiles(String selectId) {
		tiles.clear();
		if (searchMode()) {
			tiles.addAll(found);
		} else {
			if (profile != null && currentImage != null && wornId == null) {
				tiles.add(new Tile(Kind.CURRENT, "Your current skin", null, currentPng, currentImage, profile.slim));
			}
			for (Wardrobe.Entry e : entries) tiles.add(new Tile(Kind.WARDROBE, e.name, e.id, e.png, e.image, e.slim));
		}
		Tile pick = null;
		String want = selectId != null ? "w:" + selectId : chosen != null ? chosen.key : null;
		for (Tile t : tiles) if (t.key.equals(want)) pick = t;
		if (pick == null && chosen == null && !searchMode()) {
			for (Tile t : tiles) if (isNow(t)) pick = t;
			if (pick == null && !tiles.isEmpty()) pick = tiles.get(0);
		}
		if (pick != null) {
			if (chosen == null || !pick.key.equals(chosen.key) || selectId != null) select(pick);
			else chosen = pick;
			if (perPage > 0) page = tiles.indexOf(pick) / perPage;
		} else if (chosen != null && chosen.kind == Kind.WARDROBE && !searchMode()) {
			// it was deleted in the launcher
			select(tiles.isEmpty() ? null : tiles.get(0));
		}
	}

	private boolean isNow(Tile t) {
		if (profile == null || t == null) return false;
		return switch (t.kind) {
			case CURRENT -> currentImage != null;
			case WARDROBE -> t.wardrobeId.equals(wornId);
			default -> false;
		};
	}

	private void select(Tile t) {
		chosen = t;
		back = false;
		changedAt = millis();
		if (t != null) slim = isNow(t) && profile != null ? profile.slim : t.slim;
	}

	private boolean dirty() {
		if (profile == null || chosen == null) return false;
		return !isNow(chosen) || slim != profile.slim || cape != profile.activeCape();
	}

	private void wear() {
		if (busy || profile == null || chosen == null) return;
		Tile t = chosen;
		boolean skinChange = !isNow(t) || slim != profile.slim;
		boolean capeChange = cape != profile.activeCape();
		if (!skinChange && !capeChange) {
			setStatus("You're already wearing this", MUTED);
			return;
		}
		busy = true;
		setStatus(skinChange ? "Uploading your skin" : "Changing your cape", ACCENT_2);
		statusDots = true;
		byte[] png = t.png;
		boolean wantSlim = slim;
		String capeId = cape >= 0 ? profile.capes.get(cape).id : null;
		String knownId = t.wardrobeId;
		boolean fromSearch = t.found();
		String saveName = t.kind == Kind.PLAYER ? t.name + "'s skin" : t.name;
		// a skin that only lives on Mojang's side would be lost once replaced: keep it in the wardrobe
		byte[] keep = null;
		if (skinChange && t.kind != Kind.CURRENT && currentPng != null && wornId == null) keep = currentPng;
		byte[] keepPng = keep;
		boolean keepSlim = profile.slim;
		IO.execute(() -> {
			String error = null;
			String entryId = knownId;
			try {
				if (keepPng != null) wardrobe.add(keepPng, "My old skin", keepSlim);
				// skins from a search are kept too, so you can come back to them
				if (skinChange && fromSearch) entryId = wardrobe.add(png, saveName, wantSlim);
				if (skinChange) {
					SkinApi.Profile p = SkinApi.upload(token, png, wantSlim);
					wardrobe.setWorn(p.id, entryId, p.skinUrl);
					if (entryId != null) wardrobe.setVariant(entryId, wantSlim);
				}
				if (capeChange) SkinApi.setCape(token, capeId);
			} catch (IOException e) {
				error = e.getMessage();
			}
			String ferr = error;
			String fid = entryId;
			inbox.add(() -> {
				busy = false;
				if (ferr != null) {
					setStatus(ferr, BAD);
					updateButtons();
					return;
				}
				if (fromSearch && skinChange) clearSearch();
				chosen = null;
				reload(fid, "Saved! Everyone sees it next time you join a server");
			});
		});
		updateButtons();
	}

	/** Keeps a search result in the wardrobe without wearing it. */
	private void saveChosen() {
		if (chosen == null || !chosen.found()) return;
		Tile t = chosen;
		String name = t.kind == Kind.PLAYER ? t.name + "'s skin" : t.name;
		boolean wantSlim = slim;
		IO.execute(() -> {
			String error = null;
			boolean already = wardrobe.has(t.png);
			try {
				if (!already) wardrobe.add(t.png, name, wantSlim);
			} catch (IOException e) {
				error = e.getMessage();
			}
			String ferr = error;
			inbox.add(() -> {
				if (ferr != null) setStatus(ferr, BAD);
				else if (already) setStatus("That one's already in your wardrobe", MUTED);
				else {
					setStatus("Saved " + name + " to your wardrobe", GOOD);
					refreshWardrobe(null, null);
				}
			});
		});
	}

	private void addFiles(List<Path> files) {
		IO.execute(() -> {
			String last = null;
			String error = null;
			int added = 0;
			for (Path f : files) {
				try {
					last = wardrobe.addFile(f);
					added++;
				} catch (IOException e) {
					error = e.getMessage();
				}
			}
			String id = last;
			String msg = added == 1 ? "Added to your wardrobe — press Wear it to put it on"
				: added > 1 ? "Added " + added + " skins to your wardrobe" : null;
			String ferr = error;
			inbox.add(() -> {
				if (id != null) {
					clearSearch();
					refreshWardrobe(id, msg);
				}
				if (ferr != null && id == null) setStatus(ferr, BAD);
			});
		});
	}

	@Override
	public void onFilesDrop(List<Path> files) {
		List<Path> pngs = new ArrayList<>();
		for (Path f : files) if (f.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".png")) pngs.add(f);
		if (pngs.isEmpty()) setStatus("Drop PNG skin files here", BAD);
		else addFiles(pngs);
	}

	/** Opens the wardrobe folder in the system file manager. */
	protected void openWardrobeFolder() {
		Path dir = wardrobe.dir();
		try {
			java.nio.file.Files.createDirectories(dir);
			String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
			String[] cmd = os.contains("win") ? new String[] {"explorer.exe", dir.toString()}
				: os.contains("mac") ? new String[] {"open", dir.toString()} : new String[] {"xdg-open", dir.toString()};
			new ProcessBuilder(cmd).start();
			setStatus("Copy skin PNGs into the folder that opened — they show up here", MUTED);
		} catch (IOException e) {
			setStatus("Couldn't open the folder: " + dir, BAD);
		}
	}

	private void setStatus(String text, int color) {
		status = text == null ? "" : text;
		statusColor = color;
		statusDots = false;
	}

	// ------------------------------------------------------------------ searching

	/** Called every frame: starts a search once typing pauses. */
	private void watchSearch(long now) {
		if (searchBox == null) return;
		String q = searchBox.getValue().trim();
		if (!q.equals(query)) {
			boolean wasSearching = searchMode();
			query = q;
			typedAt = now;
			if (q.isEmpty()) {
				leaveSearch();
			} else if (!wasSearching) {
				// switch the grid over straight away; results follow
				found.clear();
				next = null;
				searchError = null;
				searched = "";
				page = 0;
				buildTiles(null);
				rebuild();
			}
		}
		if (searchMode() && !query.equals(searched) && now - typedAt > 450) runSearch(false);
	}

	private void runSearch(boolean more) {
		String q = query;
		String after = more ? next : null;
		if (more && after == null) return;
		int gen = ++searchGen;
		searching = true;
		searchError = null;
		if (!more) {
			searched = q;
			found.clear();
			next = null;
			page = 0;
			buildTiles(null);
			rebuild();
		}
		setStatus("Searching for “" + q + "”", ACCENT_2);
		statusDots = true;
		SEARCH.execute(() -> {
			List<Tile> out = new ArrayList<>();
			String cursor = null;
			String error = null;
			try {
				SkinApi.Results r = SkinApi.search(q, after);
				for (SkinApi.Found f : r.skins) {
					try {
						out.add(new Tile(f.player ? Kind.PLAYER : Kind.FOUND, f.name, null, f.png, Png.read(f.png), f.slim));
					} catch (IOException ignored) {
						// skip a broken image
					}
				}
				cursor = r.next;
			} catch (IOException e) {
				error = e.getMessage();
			}
			String fcursor = cursor;
			String ferr = error;
			inbox.add(() -> {
				if (gen != searchGen) return;
				searching = false;
				java.util.Set<String> have = new java.util.HashSet<>();
				for (Tile t : found) have.add(t.key);
				for (Tile t : out) if (have.add(t.key)) found.add(t);
				next = fcursor;
				searchError = ferr;
				if (ferr != null) setStatus(ferr, BAD);
				else if (found.isEmpty()) setStatus("Nothing called “" + q + "” — try another word", MUTED);
				else if (found.get(0).kind == Kind.PLAYER) setStatus("Found " + found.get(0).name + " and " + (found.size() - 1) + " more — click one to try it on", GOOD);
				else setStatus("Found " + found.size() + (next != null ? "+" : "") + " skins — click one to try it on", GOOD);
				buildTiles(null);
				// "next page" asked for more: go straight to it
				if (more && perPage > 0 && (page + 1) * perPage < tiles.size()) page++;
				rebuild();
			});
		});
	}

	private void leaveSearch() {
		searchGen++;
		searching = false;
		found.clear();
		next = null;
		searched = "";
		searchError = null;
		page = 0;
		if (chosen != null && chosen.found()) chosen = null;
		buildTiles(null);
		setStatus("Pick a skin, or search for a new one", MUTED);
		rebuild();
	}

	private void clearSearch() {
		if (searchBox != null) searchBox.setValue("");
		if (!query.isEmpty()) {
			query = "";
			leaveSearch();
		}
	}

	// ------------------------------------------------------------------ layout

	/** Rebuilds the widgets, keeping the search box's focus. */
	private void rebuild() {
		searchFocused = searchBox != null && searchBox.isFocused();
		rebuildWidgets();
	}

	@Override
	protected void init() {
		btns.clear();
		int cw = Math.min(width - 16, 460);
		int left = (width - cw) / 2;
		int top = 34;
		int actionsY = height - 28;
		int bottom = actionsY - 6;

		int stageW = Math.max(96, Math.min(150, cw * 3 / 10));
		stageX1 = left;
		stageX2 = left + stageW;
		stageY1 = top;
		stageY2 = bottom;

		gridX = stageX2 + 8;
		gridW = left + cw - gridX;
		gridY = top + 24;
		int gridH = bottom - gridY;
		boolean big = gridH >= 2 * 70 + 4;
		tileScale = big ? 2 : 1;
		tileW = big ? 40 : 24;
		tileH = big ? 70 : 38;
		cols = Math.max(1, (gridW + 4) / (tileW + 4));
		int rows = Math.max(1, (gridH + 4) / (tileH + 4));
		perPage = cols * rows;
		pages = Math.max(1, (tiles.size() + perPage - 1) / perPage);
		page = Math.max(0, Math.min(page, pages - 1));
		int used = cols * (tileW + 4) - 4;
		int x0 = gridX + Math.max(0, (gridW - used) / 2);

		for (int i = 0; i < perPage; i++) {
			int idx = page * perPage + i;
			if (idx >= tiles.size()) break;
			int x = x0 + (i % cols) * (tileW + 4);
			int y = gridY + (i / cols) * (tileH + 4);
			Tile tile = tiles.get(idx);
			Btn t = add(tile.name, TILE, x, y, tileW, tileH, () -> {
				select(tile);
				updateButtons();
			});
			t.tile = idx;
		}

		// header: search box, add/save, paging
		int right = left + cw;
		boolean more = searchMode() && next != null;
		if (pages > 1 || more) {
			nextBtn = add(">", NORMAL, right - 18, top, 18, 18, () -> {
				if (page + 1 < pages) page++;
				else if (searchMode() && next != null) {
					if (!searching) runSearch(true);
					return;
				} else page = 0;
				rebuild();
			});
			add("<", NORMAL, right - 18 - 34 - 18, top, 18, 18, () -> {
				page = page > 0 ? page - 1 : pages - 1;
				rebuild();
			});
			right -= 18 + 34 + 18 + 4;
		} else {
			nextBtn = null;
		}
		addBtn = add("", NORMAL, right - 50, top, 50, 18, () -> {
			if (searchMode()) {
				saveChosen();
				return;
			}
			if (picking) return;
			picking = true;
			pickFiles(files -> {
				picking = false;
				if (!files.isEmpty()) addFiles(files);
			});
		});
		boxX1 = gridX;
		boxY1 = top;
		boxX2 = right - 54;
		boxY2 = top + 18;
		// the box is never drawn by vanilla; it sits where our text goes (vanilla insets text by 4)
		boolean hadFocus = searchFocused;
		searchBox = new EditBox(font, boxX1 + 10, boxY1, boxX2 - boxX1 - 10 - (query.isEmpty() ? 0 : 14), 18, Component.literal("Search skins or a player name"));
		searchBox.setMaxLength(40);
		searchBox.setValue(query);
		addWidget(searchBox);
		if (hadFocus) setFocused(searchBox);
		searchFocused = false;
		if (!query.isEmpty()) add("x", ICON, boxX2 - 14, boxY1 + 2, 12, 14, this::clearSearch);

		turnBtn = add("", NORMAL, stageX1 + 6, stageY2 - 24, stageX2 - stageX1 - 12, 18, () -> {
			back = !back;
			changedAt = millis();
			updateButtons();
		});

		int gap = 4;
		int avail = cw - gap * 3;
		int wArms = avail * 25 / 100;
		int wCape = avail * 30 / 100;
		int wWear = avail * 25 / 100;
		int wDone = avail - wArms - wCape - wWear;
		int x = left;
		armsBtn = add("", NORMAL, x, actionsY, wArms, 20, () -> {
			slim = !slim;
			changedAt = millis();
			updateButtons();
		});
		x += wArms + gap;
		capeBtn = add("", NORMAL, x, actionsY, wCape, 20, () -> {
			if (profile == null || profile.capes.isEmpty()) return;
			cape = cape + 1 >= profile.capes.size() ? -1 : cape + 1;
			back = true;
			changedAt = millis();
			updateButtons();
		});
		x += wCape + gap;
		wearBtn = add("Wear it", PRIMARY, x, actionsY, wWear, 20, this::wear);
		x += wWear + gap;
		add("Done", NORMAL, x, actionsY, wDone, 20, this::onClose);
		updateButtons();
	}

	private Btn add(String label, int kind, int x, int y, int w, int h, Runnable action) {
		Btn b = new Btn();
		b.label = label;
		b.kind = kind;
		b.button = Button.builder(Component.literal(label), btn -> action.run()).bounds(x, y, w, h).build();
		addWidget(b.button);
		btns.add(b);
		return b;
	}

	private void label(Btn b, String text) {
		if (b == null || text.equals(b.label)) return;
		b.label = text;
		b.button.setMessage(Component.literal(text));
	}

	private void updateButtons() {
		if (armsBtn == null) return;
		boolean haveSkin = chosen != null;
		label(armsBtn, slim ? "Arms: Slim" : "Arms: Classic");
		armsBtn.button.active = haveSkin && !busy;
		String capeName = cape >= 0 && profile != null && cape < profile.capes.size() ? profile.capes.get(cape).name : "None";
		label(capeBtn, profile != null && profile.capes.isEmpty() ? "No capes" : "Cape: " + capeName);
		capeBtn.button.active = profile != null && !profile.capes.isEmpty() && !busy;
		wearBtn.button.active = profile != null && haveSkin && !busy && !loading && dirty();
		label(turnBtn, back ? "Show front" : "Show back");
		turnBtn.button.active = haveSkin;
		label(addBtn, searchMode() ? "Save" : "+ Add");
		addBtn.button.active = searchMode() ? chosen != null && chosen.found() : !picking;
		if (nextBtn != null) nextBtn.button.active = !searching;
	}

	// ------------------------------------------------------------------ painting

	private static long millis() {
		return System.nanoTime() / 1_000_000L;
	}

	/** The whole frame; version-specific subclasses call this from their render method. */
	protected void paint(Canvas c, int mx, int my) {
		for (Runnable r; (r = inbox.poll()) != null; ) r.run();
		long now = millis();
		watchSearch(now);
		if (now - lastPoll > 2500 && !loading && !polling && !busy) {
			lastPoll = now;
			refreshWardrobe(null, null);
		}
		long ms = (System.nanoTime() - openedAt) / 1_000_000L;
		float t = ms / 1000f;
		float intro = NimbusArt.easeOutCubic(NimbusArt.clamp01(t / 0.35f));
		Minecraft mc = Minecraft.getInstance();
		NimbusArt.menuBackdrop(c, ms, mc.level == null);

		// title
		String title = "Skins & Capes";
		int tw = c.textWidth(title);
		int tx = (width - tw) / 2 + 9;
		NimbusArt.cube(c, tx - 11, 13, 8, 1, t, intro, false);
		c.text(title, tx, 9, TEXT, true);
		String line = status + (statusDots ? ".".repeat((int) (t * 3) % 4) : "");
		line = fit(c, line, width - 24);
		c.text(line, (width - c.textWidth(line)) / 2, 21, statusColor, false);

		// stage
		panel(c, stageX1, stageY1, stageX2, stageY2, 0xC0121522, 0xFF262B40);
		paintStage(c, now, t);

		paintSearchBox(c, now);
		if (pages > 1 || (searchMode() && next != null)) {
			String p = (page + 1) + "/" + pages + (searchMode() && next != null ? "+" : "");
			int right = Math.min(width - 8, (width + Math.min(width - 16, 460)) / 2);
			c.text(p, right - 18 - 17 - c.textWidth(p) / 2, stageY1 + 5, MUTED, false);
		}
		String dots = ".".repeat((int) (t * 3) % 4);
		if (searchMode() && tiles.isEmpty()) {
			if (searching || !query.equals(searched)) c.text("Searching" + dots, gridX + 4, gridY + 6, MUTED, false);
			else if (searchError != null) wrap(c, searchError, gridX + 4, gridY + 6, gridW - 8, BAD);
			else {
				c.text("No skins called “" + fit(c, query, gridW - 90) + "”.", gridX + 4, gridY + 6, MUTED, false);
				c.text("Try another word, or a player's name.", gridX + 4, gridY + 18, FAINT, false);
			}
		} else if (!searchMode() && loading && tiles.isEmpty()) {
			c.text("Loading" + dots, gridX + 4, gridY + 6, MUTED, false);
		} else if (!searchMode() && tiles.isEmpty()) {
			c.text("No skins yet.", gridX + 4, gridY + 6, MUTED, false);
			c.text("Search above, drop PNGs on this window,", gridX + 4, gridY + 18, FAINT, false);
			c.text("or use the Skins page in Nimbus.", gridX + 4, gridY + 30, FAINT, false);
		}

		for (Btn b : btns) {
			if (b.kind == TILE) paintTile(c, b, mx, my);
			else if (b.kind == ICON) paintClear(c, b, mx, my);
			else paintButton(c, b, mx, my);
		}
	}

	private void paintSearchBox(Canvas c, long now) {
		boolean focused = searchBox != null && searchBox.isFocused();
		panel(c, boxX1, boxY1, boxX2, boxY2, 0xFF10131E, focused ? ACCENT : 0xFF2E3350);
		// a little magnifying glass
		int ix = boxX1 + 5;
		int iy = boxY1 + 5;
		int ic = focused ? ACCENT_2 : MUTED;
		c.rect(ix + 1, iy, ix + 4, iy + 1, ic);
		c.rect(ix + 1, iy + 4, ix + 4, iy + 5, ic);
		c.rect(ix, iy + 1, ix + 1, iy + 4, ic);
		c.rect(ix + 4, iy + 1, ix + 5, iy + 4, ic);
		c.rect(ix + 4, iy + 5, ix + 5, iy + 6, ic);
		c.rect(ix + 5, iy + 6, ix + 6, iy + 7, ic);

		int tx = boxX1 + 14;
		int room = boxX2 - tx - (query.isEmpty() ? 4 : 18);
		String value = searchBox == null ? "" : searchBox.getValue();
		if (value.isEmpty()) {
			c.text(fit(c, focused ? "Skin name or player…" : "Search skins or players", room), tx, boxY1 + 5, FAINT, false);
			if (focused && (now / 500) % 2 == 0) c.rect(tx, boxY1 + 4, tx + 1, boxY1 + 14, TEXT);
			return;
		}
		int cursor = Math.max(0, Math.min(value.length(), searchBox.getCursorPosition()));
		int start = 0;
		while (start < cursor && c.textWidth(value.substring(start, cursor)) > room - 2) start++;
		String shown = value.substring(start);
		while (!shown.isEmpty() && c.textWidth(shown) > room) shown = shown.substring(0, shown.length() - 1);
		c.text(shown, tx, boxY1 + 5, TEXT, false);
		if (focused && (now / 500) % 2 == 0) {
			int cx = tx + c.textWidth(value.substring(start, cursor));
			c.rect(cx, boxY1 + 4, cx + 1, boxY1 + 14, TEXT);
		}
	}

	private void paintClear(Canvas c, Btn b, int mx, int my) {
		Button btn = b.button;
		int x = btn.getX() + 3;
		int y = btn.getY() + 4;
		boolean hover = inside(mx, my, btn.getX(), btn.getY(), btn.getX() + btn.getWidth(), btn.getY() + btn.getHeight()) || btn.isFocused();
		int col = hover ? TEXT : MUTED;
		for (int i = 0; i < 6; i++) {
			c.rect(x + i, y + i, x + i + 1, y + i + 1, col);
			c.rect(x + 5 - i, y + i, x + 6 - i, y + i + 1, col);
		}
	}

	private void paintStage(Canvas c, long now, float t) {
		int w = stageX2 - stageX1;
		int infoH = 26;
		int areaTop = stageY1 + 8;
		int areaBottom = stageY2 - 24 - infoH - 4;
		int scale = Math.max(1, Math.min((areaBottom - areaTop) / 32, (w - 16) / 16));
		int dollW = 16 * scale;
		int dollH = 32 * scale;
		int dx = stageX1 + (w - dollW) / 2;
		int dy = areaTop + Math.max(0, (areaBottom - areaTop - dollH) / 2);

		// soft glow and a shadow under the feet
		int gx = stageX1 + w / 2;
		int gy = dy + dollH / 2;
		for (int level = 1; level <= 4; level++) {
			int rx = Math.round(dollW * 0.45f * level);
			int ry = Math.round(dollH * 0.18f * level);
			int col = NimbusArt.argb(0x7C5CFF, 0.035f);
			for (int y = -ry; y < ry; y += 2) {
				float k = (y + 1f) / ry;
				if (k * k >= 1f) continue;
				int half = Math.min(w / 2 - 2, Math.round(rx * (float) Math.sqrt(1 - k * k)));
				c.rect(gx - half, gy + y, gx + half, gy + y + 2, col);
			}
		}
		int sy = dy + dollH + 1;
		for (int i = 0; i < 3; i++) {
			int half = dollW / 2 + 4 - i * 3;
			c.rect(gx - half, sy + i, gx + half, sy + i + 1, 0x30000000);
		}

		if (chosen == null) return;
		Tile tile = chosen;
		float k = NimbusArt.easeOutCubic(NimbusArt.clamp01((now - changedAt) / 260f));
		int lift = Math.round((1 - k) * 6);
		int bob = (int) Math.round(Math.sin(t * Math.PI * 2 / 3.2) * 0.6 + 0.4);
		Png capeImg = cape >= 0 && profile != null && cape < profile.capes.size() ? capeImages.get(profile.capes.get(cape).id) : null;
		SkinArt.player(c, tile.image, slim, back, capeImg, dx, dy + lift - bob, scale, k);

		int iy = stageY2 - 24 - infoH;
		String name = fit(c, tile.kind == Kind.PLAYER ? tile.name + "'s skin" : tile.name, w - 12);
		c.text(name, stageX1 + (w - c.textWidth(name)) / 2, iy, TEXT, true);
		boolean wearing = profile != null && !dirty();
		String tag = wearing ? "Wearing now" : tile.kind == Kind.PLAYER ? "Player's skin" : tile.kind == Kind.FOUND ? "From the gallery" : "Preview";
		int tagW = c.textWidth(tag) + 8;
		int tagX = stageX1 + (w - tagW) / 2;
		panel(c, tagX, iy + 11, tagX + tagW, iy + 23, wearing ? 0x3334D399 : 0x337C5CFF, wearing ? 0x8034D399 : 0x807C5CFF);
		c.text(tag, tagX + 4, iy + 13, wearing ? GOOD : ACCENT_2, false);
	}

	private void paintTile(Canvas c, Btn b, int mx, int my) {
		Button btn = b.button;
		int x1 = btn.getX();
		int y1 = btn.getY();
		int x2 = x1 + btn.getWidth();
		int y2 = y1 + btn.getHeight();
		boolean hover = inside(mx, my, x1, y1, x2, y2) || btn.isFocused();
		if (b.tile < 0 || b.tile >= tiles.size()) return;
		Tile tile = tiles.get(b.tile);
		boolean on = chosen != null && tile.key.equals(chosen.key);
		int bg = on ? 0xFF231F3D : hover ? 0xFF22263A : 0xFF191C2B;
		int edge = on ? ACCENT : hover ? 0xFF3A4063 : tile.kind == Kind.PLAYER ? 0xFF5B4A9E : 0xFF262B40;
		panel(c, x1, y1, x2, y2, bg, edge);
		int s = tileScale;
		int px = x1 + (btn.getWidth() - 16 * s) / 2;
		int py = y2 - 32 * s - 3;
		int lift = hover && !on ? 1 : 0;
		boolean tileSlim = isNow(tile) && profile != null ? profile.slim : tile.slim;
		SkinArt.player(c, tile.image, tileSlim, false, null, px, py - lift, s, 1f);
		if (isNow(tile)) {
			c.rect(x2 - 6, y1 + 3, x2 - 3, y1 + 6, GOOD);
			c.rect(x2 - 7, y1 + 4, x2 - 2, y1 + 5, GOOD);
			c.rect(x2 - 5, y1 + 2, x2 - 4, y1 + 7, GOOD);
		}
		if (tile.kind == Kind.PLAYER) {
			// a little person: this one is a player's own skin
			c.rect(x1 + 3, y1 + 2, x1 + 6, y1 + 5, ACCENT_2);
			c.rect(x1 + 2, y1 + 6, x1 + 7, y1 + 9, ACCENT_2);
		}
	}

	private void paintButton(Canvas c, Btn b, int mx, int my) {
		Button btn = b.button;
		int x1 = btn.getX();
		int y1 = btn.getY();
		int x2 = x1 + btn.getWidth();
		int y2 = y1 + btn.getHeight();
		boolean on = btn.active;
		boolean hover = on && (inside(mx, my, x1, y1, x2, y2) || btn.isFocused());
		int bg;
		int edge;
		if (!on) {
			bg = 0xFF141725;
			edge = 0xFF1F2335;
		} else if (b.kind == PRIMARY) {
			bg = hover ? 0xFF9075FF : ACCENT;
			edge = hover ? 0xFFD7C8FF : 0xFFA78BFA;
		} else {
			bg = hover ? 0xFF2A2F48 : 0xFF1D2133;
			edge = hover ? 0xFF4C5480 : 0xFF2E3350;
		}
		panel(c, x1, y1, x2, y2, bg, edge);
		String text = fit(c, b.label, btn.getWidth() - 6);
		int color = !on ? FAINT : TEXT;
		c.text(text, x1 + (btn.getWidth() - c.textWidth(text) + 1) / 2, y1 + (btn.getHeight() - 7) / 2, color, on && b.kind == PRIMARY);
	}

	/** A box with a 1px border and clipped corners. */
	private static void panel(Canvas c, int x1, int y1, int x2, int y2, int fill, int edge) {
		c.rect(x1 + 1, y1, x2 - 1, y1 + 1, edge);
		c.rect(x1 + 1, y2 - 1, x2 - 1, y2, edge);
		c.rect(x1, y1 + 1, x1 + 1, y2 - 1, edge);
		c.rect(x2 - 1, y1 + 1, x2, y2 - 1, edge);
		c.rect(x1 + 1, y1 + 1, x2 - 1, y2 - 1, fill);
	}

	/** Word-wrapped text, for longer messages. */
	private static void wrap(Canvas c, String s, int x, int y, int max, int color) {
		StringBuilder line = new StringBuilder();
		for (String word : s.split(" ")) {
			String tryLine = line.length() == 0 ? word : line + " " + word;
			if (c.textWidth(tryLine) > max && line.length() > 0) {
				c.text(line.toString(), x, y, color, false);
				y += 11;
				line = new StringBuilder(word);
			} else {
				line = new StringBuilder(tryLine);
			}
		}
		if (line.length() > 0) c.text(line.toString(), x, y, color, false);
	}

	private static boolean inside(int mx, int my, int x1, int y1, int x2, int y2) {
		return mx >= x1 && my >= y1 && mx < x2 && my < y2;
	}

	private static String fit(Canvas c, String s, int max) {
		if (c.textWidth(s) <= max) return s;
		String dots = "…";
		int end = s.length();
		while (end > 0 && c.textWidth(s.substring(0, end) + dots) > max) end--;
		return s.substring(0, end).trim() + dots;
	}
}
