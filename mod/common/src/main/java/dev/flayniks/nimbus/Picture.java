package dev.flayniks.nimbus;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.zip.CRC32;
import java.util.zip.Deflater;

/**
 * Fits a picture to the screen: scaled and cropped to fill it exactly (like CSS
 * background-size: cover), averaged when shrinking so it stays smooth, then written out
 * as a PNG that Minecraft's own image loader reads on every version.
 */
final class Picture {
	private Picture() {
	}

	static byte[] coverPng(Png src, int w, int h) throws IOException {
		int[] out = new int[w * h];
		double scale = Math.max(w / (double) src.width, h / (double) src.height);
		double cropW = w / scale;
		double cropH = h / scale;
		double ox = (src.width - cropW) / 2;
		double oy = (src.height - cropH) / 2;
		boolean shrink = scale < 1;
		for (int y = 0; y < h; y++) {
			double sy0 = oy + y / scale;
			double sy1 = oy + (y + 1) / scale;
			for (int x = 0; x < w; x++) {
				double sx0 = ox + x / scale;
				double sx1 = ox + (x + 1) / scale;
				out[y * w + x] = shrink ? average(src, sx0, sy0, sx1, sy1) : bilinear(src, (sx0 + sx1) / 2 - 0.5, (sy0 + sy1) / 2 - 0.5);
			}
		}
		return encode(out, w, h);
	}

	/** The mean colour of the source pixels under one screen pixel, laid over black. */
	private static int average(Png src, double x0, double y0, double x1, double y1) {
		int ix0 = (int) Math.floor(x0);
		int iy0 = (int) Math.floor(y0);
		int ix1 = Math.max(ix0 + 1, (int) Math.ceil(x1));
		int iy1 = Math.max(iy0 + 1, (int) Math.ceil(y1));
		long r = 0;
		long g = 0;
		long b = 0;
		int n = 0;
		for (int y = iy0; y < iy1; y++) {
			for (int x = ix0; x < ix1; x++) {
				int c = src.get(Math.min(x, src.width - 1), Math.min(y, src.height - 1));
				int a = c >>> 24;
				r += ((c >> 16) & 0xFF) * a / 255;
				g += ((c >> 8) & 0xFF) * a / 255;
				b += (c & 0xFF) * a / 255;
				n++;
			}
		}
		return 0xFF000000 | (int) (r / n) << 16 | (int) (g / n) << 8 | (int) (b / n);
	}

	private static int bilinear(Png src, double x, double y) {
		int x0 = (int) Math.floor(x);
		int y0 = (int) Math.floor(y);
		double fx = x - x0;
		double fy = y - y0;
		int c00 = at(src, x0, y0);
		int c10 = at(src, x0 + 1, y0);
		int c01 = at(src, x0, y0 + 1);
		int c11 = at(src, x0 + 1, y0 + 1);
		int out = 0xFF000000;
		for (int shift = 0; shift <= 16; shift += 8) {
			double top = ((c00 >> shift) & 0xFF) * (1 - fx) + ((c10 >> shift) & 0xFF) * fx;
			double bottom = ((c01 >> shift) & 0xFF) * (1 - fx) + ((c11 >> shift) & 0xFF) * fx;
			out |= ((int) Math.round(top * (1 - fy) + bottom * fy) & 0xFF) << shift;
		}
		return out;
	}

	private static int at(Png src, int x, int y) {
		int c = src.get(Math.max(0, Math.min(x, src.width - 1)), Math.max(0, Math.min(y, src.height - 1)));
		int a = c >>> 24;
		return ((c >> 16 & 0xFF) * a / 255) << 16 | ((c >> 8 & 0xFF) * a / 255) << 8 | (c & 0xFF) * a / 255;
	}

	/** A plain 8-bit RGBA PNG. */
	static byte[] encode(int[] argb, int w, int h) throws IOException {
		byte[] raw = new byte[(w * 4 + 1) * h];
		int p = 0;
		for (int y = 0; y < h; y++) {
			raw[p++] = 0; // no filter
			for (int x = 0; x < w; x++) {
				int c = argb[y * w + x];
				raw[p++] = (byte) (c >> 16);
				raw[p++] = (byte) (c >> 8);
				raw[p++] = (byte) c;
				raw[p++] = (byte) (c >>> 24);
			}
		}
		Deflater deflater = new Deflater(Deflater.BEST_SPEED);
		deflater.setInput(raw);
		deflater.finish();
		ByteArrayOutputStream zipped = new ByteArrayOutputStream(raw.length / 3);
		byte[] buf = new byte[65536];
		while (!deflater.finished()) zipped.write(buf, 0, deflater.deflate(buf));
		deflater.end();

		ByteArrayOutputStream png = new ByteArrayOutputStream(zipped.size() + 64);
		png.write(new byte[] {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'});
		byte[] ihdr = new byte[13];
		putInt(ihdr, 0, w);
		putInt(ihdr, 4, h);
		ihdr[8] = 8; // bit depth
		ihdr[9] = 6; // RGBA
		chunk(png, "IHDR", ihdr);
		chunk(png, "IDAT", zipped.toByteArray());
		chunk(png, "IEND", new byte[0]);
		return png.toByteArray();
	}

	private static void chunk(ByteArrayOutputStream out, String type, byte[] data) throws IOException {
		byte[] len = new byte[4];
		putInt(len, 0, data.length);
		out.write(len);
		byte[] t = type.getBytes(java.nio.charset.StandardCharsets.US_ASCII);
		out.write(t);
		out.write(data);
		CRC32 crc = new CRC32();
		crc.update(t);
		crc.update(data);
		byte[] c = new byte[4];
		putInt(c, 0, (int) crc.getValue());
		out.write(c);
	}

	private static void putInt(byte[] b, int at, int v) {
		b[at] = (byte) (v >>> 24);
		b[at + 1] = (byte) (v >>> 16);
		b[at + 2] = (byte) (v >>> 8);
		b[at + 3] = (byte) v;
	}
}
