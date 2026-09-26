package dev.flayniks.nimbus;

import java.lang.reflect.Method;

/**
 * The 2D matrix stack the GUI uses from 1.21.6 on (org.joml.Matrix3x2fStack). Reached by
 * reflection so this jar also loads on versions whose JOML predates it.
 */
final class Matrix2D {
	private static Method push;
	private static Method pop;
	private static Method translate;
	private static Method scale;

	private Matrix2D() {
	}

	private static void find(Class<?> c) throws NoSuchMethodException {
		if (push != null) return;
		push = c.getMethod("pushMatrix");
		pop = c.getMethod("popMatrix");
		translate = c.getMethod("translate", float.class, float.class);
		scale = c.getMethod("scale", float.class, float.class);
	}

	static void push(Object m, float x, float y, float s) {
		try {
			find(m.getClass());
			push.invoke(m);
			translate.invoke(m, x, y);
			scale.invoke(m, s, s);
		} catch (ReflectiveOperationException ignored) {
			// draws unscaled
		}
	}

	static void pop(Object m) {
		try {
			find(m.getClass());
			pop.invoke(m);
		} catch (ReflectiveOperationException ignored) {
			// nothing was pushed
		}
	}
}
