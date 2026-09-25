package dev.flayniks.nimbus;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;
import net.minecraft.client.Minecraft;
import org.lwjgl.PointerBuffer;
import org.lwjgl.system.MemoryStack;
import org.lwjgl.util.tinyfd.TinyFileDialogs;

/** The system "open file" dialog, through the tinyfd library these versions ship. */
final class FilePicker {
	private FilePicker() {
	}

	static void pick(Consumer<List<Path>> chosen, Runnable fallback) {
		boolean mac = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("mac");
		Runnable job = () -> {
			List<Path> out = new ArrayList<>();
			boolean failed = false;
			try (MemoryStack stack = MemoryStack.stackPush()) {
				PointerBuffer filters = stack.mallocPointer(1);
				filters.put(stack.UTF8("*.png"));
				filters.flip();
				String res = TinyFileDialogs.tinyfd_openFileDialog("Add skins to your Nimbus wardrobe", null, filters, "PNG skin files", true);
				if (res != null) for (String p : res.split("\\|")) if (!p.isBlank()) out.add(Path.of(p));
			} catch (Throwable e) {
				failed = true;
			}
			boolean fail = failed;
			Minecraft.getInstance().execute(() -> {
				chosen.accept(out);
				if (fail) fallback.run();
			});
		};
		// macOS only allows dialogs from the main thread; elsewhere keep the game running meanwhile
		if (mac) job.run();
		else {
			Thread t = new Thread(job, "Nimbus file picker");
			t.setDaemon(true);
			t.start();
		}
	}
}
