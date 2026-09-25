package dev.flayniks.nimbus;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.zip.DataFormatException;
import java.util.zip.Inflater;

/**
 * A small PNG reader, enough for skins and capes. It keeps Nimbus away from
 * Minecraft's texture classes, which change shape between versions.
 */
public final class Png {
	public final int width;
	public final int height;
	private final int[] argb;

	private Png(int width, int height, int[] argb) {
		this.width = width;
		this.height = height;
		this.argb = argb;
	}

	/** The pixel at (x, y) as ARGB, or fully transparent outside the image. */
	public int get(int x, int y) {
		if (x < 0 || y < 0 || x >= width || y >= height) return 0;
		return argb[y * width + x];
	}

	public static int width(byte[] data) {
		return data.length >= 24 ? readInt(data, 16) : 0;
	}

	public static int height(byte[] data) {
		return data.length >= 24 ? readInt(data, 20) : 0;
	}

	public static Png read(byte[] data) throws IOException {
		byte[] sig = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'};
		if (data.length < 33) throw new IOException("That file is not a PNG image.");
		for (int i = 0; i < 8; i++) if (data[i] != sig[i]) throw new IOException("That file is not a PNG image.");

		int w = 0, h = 0, depth = 0, type = 0, interlace = 0;
		int[] palette = new int[0];
		ByteArrayOutputStream idat = new ByteArrayOutputStream();
		int at = 8;
		while (at + 8 <= data.length) {
			int len = readInt(data, at);
			String name = new String(data, at + 4, 4, java.nio.charset.StandardCharsets.US_ASCII);
			int body = at + 8;
			if (len < 0 || body + len > data.length) throw new IOException("That PNG is damaged.");
			switch (name) {
				case "IHDR" -> {
					w = readInt(data, body);
					h = readInt(data, body + 4);
					depth = data[body + 8] & 0xFF;
					type = data[body + 9] & 0xFF;
					interlace = data[body + 12] & 0xFF;
				}
				case "PLTE" -> {
					palette = new int[len / 3];
					for (int i = 0; i < palette.length; i++) {
						palette[i] = 0xFF000000 | (data[body + i * 3] & 0xFF) << 16 | (data[body + i * 3 + 1] & 0xFF) << 8 | (data[body + i * 3 + 2] & 0xFF);
					}
				}
				case "tRNS" -> {
					for (int i = 0; i < len && i < palette.length; i++) {
						palette[i] = (palette[i] & 0xFFFFFF) | (data[body + i] & 0xFF) << 24;
					}
				}
				case "IDAT" -> idat.write(data, body, len);
				default -> {
				}
			}
			if (name.equals("IEND")) break;
			at = body + len + 4;
		}
		if (w <= 0 || h <= 0 || w > 4096 || h > 4096) throw new IOException("That PNG has an odd size.");
		if (interlace != 0) throw new IOException("Interlaced PNGs are not supported — re-save it without interlacing.");
		int channels = switch (type) {
			case 0, 3 -> 1;
			case 2 -> 3;
			case 4 -> 2;
			case 6 -> 4;
			default -> throw new IOException("Unsupported PNG colour type " + type + ".");
		};
		int bits = channels * depth;
		int stride = (w * bits + 7) / 8;
		int bpp = Math.max(1, bits / 8);
		byte[] raw = inflate(idat.toByteArray(), (stride + 1) * h);

		int[] out = new int[w * h];
		byte[] prev = new byte[stride];
		byte[] row = new byte[stride];
		int pos = 0;
		for (int y = 0; y < h; y++) {
			int filter = raw[pos++] & 0xFF;
			System.arraycopy(raw, pos, row, 0, stride);
			pos += stride;
			unfilter(filter, row, prev, bpp);
			for (int x = 0; x < w; x++) out[y * w + x] = pixel(row, x, type, depth, channels, palette);
			byte[] t = prev;
			prev = row;
			row = t;
		}
		return new Png(w, h, out);
	}

	private static byte[] inflate(byte[] zipped, int size) throws IOException {
		Inflater inf = new Inflater();
		try {
			inf.setInput(zipped);
			byte[] out = new byte[size];
			int n = 0;
			while (n < size && !inf.finished()) {
				int got = inf.inflate(out, n, size - n);
				if (got == 0 && (inf.needsInput() || inf.needsDictionary())) break;
				n += got;
			}
			if (n < size) throw new IOException("That PNG is damaged.");
			return out;
		} catch (DataFormatException e) {
			throw new IOException("That PNG is damaged.", e);
		} finally {
			inf.end();
		}
	}

	private static void unfilter(int filter, byte[] row, byte[] prev, int bpp) throws IOException {
		for (int i = 0; i < row.length; i++) {
			int a = i >= bpp ? row[i - bpp] & 0xFF : 0;
			int b = prev[i] & 0xFF;
			int c = i >= bpp ? prev[i - bpp] & 0xFF : 0;
			int x = row[i] & 0xFF;
			switch (filter) {
				case 0 -> {
				}
				case 1 -> x += a;
				case 2 -> x += b;
				case 3 -> x += (a + b) >> 1;
				case 4 -> {
					int p = a + b - c;
					int pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
					x += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
				}
				default -> throw new IOException("That PNG is damaged.");
			}
			row[i] = (byte) x;
		}
	}

	/** One channel value scaled to 0..255 (16-bit keeps the high byte, low bit depths stretch). */
	private static int sample(byte[] row, int index, int depth) {
		if (depth == 8) return row[index] & 0xFF;
		if (depth == 16) return row[index * 2] & 0xFF;
		int perByte = 8 / depth;
		int b = row[index / perByte] & 0xFF;
		int shift = 8 - depth * (index % perByte + 1);
		return (b >> shift) & ((1 << depth) - 1);
	}

	private static int pixel(byte[] row, int x, int type, int depth, int channels, int[] palette) {
		int i = x * channels;
		int max = depth >= 8 ? 255 : (1 << depth) - 1;
		switch (type) {
			case 3 -> {
				int idx = sample(row, x, depth);
				return idx < palette.length ? palette[idx] : 0;
			}
			case 0 -> {
				int v = sample(row, i, depth) * 255 / max;
				return 0xFF000000 | v << 16 | v << 8 | v;
			}
			case 4 -> {
				int v = sample(row, i, depth);
				return sample(row, i + 1, depth) << 24 | v << 16 | v << 8 | v;
			}
			case 2 -> {
				return 0xFF000000 | sample(row, i, depth) << 16 | sample(row, i + 1, depth) << 8 | sample(row, i + 2, depth);
			}
			default -> {
				return sample(row, i + 3, depth) << 24 | sample(row, i, depth) << 16 | sample(row, i + 1, depth) << 8 | sample(row, i + 2, depth);
			}
		}
	}

	private static int readInt(byte[] b, int at) {
		return (b[at] & 0xFF) << 24 | (b[at + 1] & 0xFF) << 16 | (b[at + 2] & 0xFF) << 8 | (b[at + 3] & 0xFF);
	}
}
