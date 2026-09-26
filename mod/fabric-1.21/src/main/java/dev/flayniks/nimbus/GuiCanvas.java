package dev.flayniks.nimbus;

import com.mojang.blaze3d.vertex.PoseStack;
import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.reflect.Method;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;

/** Canvas over 1.20–1.21.x GuiGraphics. */
public final class GuiCanvas implements Canvas {
	private static MethodHandle drawString;
	private static boolean looked;

	private final GuiGraphics g;

	public GuiCanvas(GuiGraphics g) {
		this.g = g;
	}

	@Override
	public int width() {
		return g.guiWidth();
	}

	@Override
	public int height() {
		return g.guiHeight();
	}

	@Override
	public void rect(int x1, int y1, int x2, int y2, int argb) {
		if ((argb >>> 24) == 0 || x2 <= x1 || y2 <= y1) return;
		g.fill(x1, y1, x2, y2, argb);
	}

	@Override
	public void text(String s, int x, int y, int argb, boolean shadow) {
		// below 4 alpha, older versions treat the colour as opaque
		if ((argb >>> 24) < 4 || s.isEmpty()) return;
		MethodHandle draw = drawString();
		if (draw == null) return;
		try {
			draw.invoke(g, Minecraft.getInstance().font, s, x, y, argb, shadow);
		} catch (Throwable ignored) {
			// never let a label take the game down
		}
	}

	@Override
	public int textWidth(String s) {
		return Minecraft.getInstance().font.width(s);
	}

	/**
	 * GuiGraphics.pose() hands back a PoseStack up to 1.21.5 and a 2D JOML matrix stack after,
	 * so it is found by reflection and both kinds are handled.
	 */
	private static Method pose;
	private static boolean poseLooked;

	private static Object pose(GuiGraphics g) {
		if (!poseLooked) {
			poseLooked = true;
			for (Method m : GuiGraphics.class.getMethods()) {
				if (m.getParameterCount() != 0) continue;
				Class<?> r = m.getReturnType();
				if (r == PoseStack.class || r.getName().equals("org.joml.Matrix3x2fStack")) {
					pose = m;
					break;
				}
			}
		}
		try {
			return pose == null ? null : pose.invoke(g);
		} catch (ReflectiveOperationException e) {
			return null;
		}
	}

	@Override
	public void push(float x, float y, float scale) {
		Object p = pose(g);
		if (p instanceof PoseStack ps) {
			ps.pushPose();
			ps.translate(x, y, 0f);
			ps.scale(scale, scale, 1f);
		} else if (p != null) {
			Matrix2D.push(p, x, y, scale);
		}
	}

	@Override
	public void pop() {
		Object p = pose(g);
		if (p instanceof PoseStack ps) ps.popPose();
		else if (p != null) Matrix2D.pop(p);
	}

	/**
	 * drawString(Font, String, int, int, int, boolean) returns int up to 1.21.5 and void after,
	 * so it is looked up by its parameters instead of being linked at compile time.
	 */
	private static MethodHandle drawString() {
		if (!looked) {
			looked = true;
			for (Method m : GuiGraphics.class.getMethods()) {
				Class<?>[] p = m.getParameterTypes();
				if (p.length == 6 && p[0] == Font.class && p[1] == String.class && p[2] == int.class
					&& p[3] == int.class && p[4] == int.class && p[5] == boolean.class) {
					try {
						drawString = MethodHandles.publicLookup().unreflect(m);
					} catch (IllegalAccessException ignored) {
						// leave text off
					}
					break;
				}
			}
		}
		return drawString;
	}
}
