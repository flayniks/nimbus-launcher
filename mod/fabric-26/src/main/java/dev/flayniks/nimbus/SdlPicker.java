package dev.flayniks.nimbus;

import java.nio.ByteBuffer;
import java.util.function.Consumer;
import net.minecraft.client.Minecraft;
import org.lwjgl.sdl.SDLDialog;
import org.lwjgl.sdl.SDL_DialogFileCallback;
import org.lwjgl.sdl.SDL_DialogFileFilter;
import org.lwjgl.system.MemoryUtil;

/**
 * SDL's file dialog, for 26.3 and later. It answers later through a callback, so the
 * filter strings and the callback have to stay alive until then.
 */
final class SdlPicker {
	private static SDL_DialogFileCallback callback;
	private static SDL_DialogFileFilter.Buffer filters;
	private static ByteBuffer name;
	private static ByteBuffer pattern;

	private SdlPicker() {
	}

	static void open(Consumer<String> done) {
		if (callback != null) return; // one dialog at a time
		name = MemoryUtil.memUTF8("PNG pictures");
		pattern = MemoryUtil.memUTF8("png");
		filters = SDL_DialogFileFilter.calloc(1);
		filters.get(0).name(name).pattern(pattern);
		callback = SDL_DialogFileCallback.create((userdata, filelist, filter) -> {
			String path = null;
			if (filelist != 0L) {
				long first = MemoryUtil.memGetAddress(filelist);
				if (first != 0L) path = MemoryUtil.memUTF8(first);
			}
			String chosen = path;
			Minecraft.getInstance().execute(() -> {
				free();
				done.accept(chosen);
			});
		});
		SDLDialog.SDL_ShowOpenFileDialog(callback, 0L, 0L, filters, (CharSequence) null, false);
	}

	private static void free() {
		if (callback != null) callback.free();
		if (filters != null) filters.free();
		if (name != null) MemoryUtil.memFree(name);
		if (pattern != null) MemoryUtil.memFree(pattern);
		callback = null;
		filters = null;
		name = null;
		pattern = null;
	}
}
