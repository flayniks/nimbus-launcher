package dev.flayniks.nimbus;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.Arrays;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.resources.ResourceLocation;
import org.joml.Matrix4f;
import org.joml.Vector3f;

/**
 * Hands the cosmetics mesh to Minecraft, for 1.20–1.21.11. The calls moved around a lot in
 * those versions, so they are looked up once at run time:
 * - the vertex call: one bulk call per vertex, with float colours up to 1.20.6 and an int after;
 * - the render types: static factories on RenderType, moved to RenderTypes in 1.21.11;
 * - from 1.21.9 geometry is "submitted" through a SubmitNodeCollector instead of written straight
 *   into a buffer, with a callback interface this jar can only reach by name.
 */
public final class CosmeticsDraw {
	private CosmeticsDraw() {
	}

	private static final int OVERLAY = 10 << 16; // OverlayTexture.NO_OVERLAY
	private static boolean looked;
	private static boolean ok;
	private static Object cutout;
	private static Object translucent;
	private static Object glow;
	private static MethodHandle intColour; // (vc, x, y, z, argb, u, v, overlay, light, nx, ny, nz)
	private static MethodHandle floatColour; // (vc, x, y, z, r, g, b, a, u, v, overlay, light, nx, ny, nz)
	private static Method submitGeometry;
	private static Class<?> geometryCallback;

	private static synchronized boolean ready() {
		if (looked) return ok;
		looked = true;
		try {
			// registered at run time: mod assets only load with Fabric API, which Nimbus doesn't need
			ResourceLocation white = (ResourceLocation) Compat.makeTexture(whitePng(), "cosmetics_white");
			cutout = factory(white, "method_23578", "method_75969", "method_75994", "entityCutoutNoCull");
			translucent = factory(white, "method_23580", "method_75980", "method_76000", "entityTranslucent");
			glow = factory(white, "method_23026", "method_76014", "eyes");
			Class<?> f = float.class;
			Class<?> i = int.class;
			for (Method m : VertexConsumer.class.getMethods()) {
				Class<?>[] p = m.getParameterTypes();
				if (m.getReturnType() != void.class) continue;
				if (Arrays.equals(p, new Class<?>[] {f, f, f, i, f, f, i, i, f, f, f})) {
					intColour = MethodHandles.publicLookup().unreflect(m).asType(MethodType.methodType(void.class, VertexConsumer.class, f, f, f, i, f, f, i, i, f, f, f));
				} else if (Arrays.equals(p, new Class<?>[] {f, f, f, f, f, f, f, f, f, i, i, f, f, f})) {
					floatColour = MethodHandles.publicLookup().unreflect(m).asType(MethodType.methodType(void.class, VertexConsumer.class, f, f, f, f, f, f, f, f, f, i, i, f, f, f));
				}
			}
			if (glow == null) glow = cutout;
			ok = cutout != null && translucent != null && (intColour != null || floatColour != null);
		} catch (Throwable t) {
			ok = false;
		}
		return ok;
	}

	static byte[] whitePng() throws java.io.IOException {
		try (java.io.InputStream in = CosmeticsDraw.class.getResourceAsStream("/assets/nimbus/textures/misc/white.png")) {
			return in.readAllBytes();
		}
	}

	private static Object factory(ResourceLocation tex, String... names) {
		for (String cls : new String[] {"net.minecraft.class_12249", "net.minecraft.class_1921", RenderType.class.getName()}) {
			Class<?> c;
			try {
				c = Class.forName(cls);
			} catch (Throwable t) {
				continue;
			}
			for (String name : names) {
				for (Method m : c.getMethods()) {
					if (m.getName().equals(name) && m.getParameterCount() == 1 && m.getParameterTypes()[0] == ResourceLocation.class) {
						try {
							return m.invoke(null, tex);
						} catch (ReflectiveOperationException ignored) {
							// try the next one
						}
					}
				}
			}
		}
		return null;
	}

	/** Up to 1.21.8: straight into the frame's buffers. */
	public static void draw(PoseStack pose, MultiBufferSource buffers, CosmeticMesh mesh) {
		if (mesh.isEmpty() || !ready()) return;
		Matrix4f m = pose.last().pose();
		try {
			for (int b = 0; b < 3; b++) {
				if (mesh.count[b] == 0) continue;
				VertexConsumer vc = buffers.getBuffer((RenderType) type(b));
				emit(vc, m, mesh.pos[b], mesh.col[b], mesh.count[b]);
			}
		} catch (Throwable t) {
			ok = false; // something about this version doesn't fit: stop trying
		}
	}

	/** 1.21.9 to 1.21.11: submitted as custom geometry, drawn later in the frame. */
	public static void submit(PoseStack pose, Object collector, CosmeticMesh mesh) {
		if (mesh.isEmpty() || !ready()) return;
		try {
			if (submitGeometry == null) {
				for (Method m : collector.getClass().getMethods()) {
					Class<?>[] p = m.getParameterTypes();
					if (p.length == 3 && p[0] == PoseStack.class && p[1].isInstance(cutout) && p[2].isInterface() && (m.getName().equals("method_73483") || m.getName().equals("submitCustomGeometry"))) {
						submitGeometry = m;
						geometryCallback = p[2];
						break;
					}
				}
				if (submitGeometry == null) throw new NoSuchMethodException("submitCustomGeometry");
			}
			for (int b = 0; b < 3; b++) {
				int n = mesh.count[b];
				if (n == 0) continue;
				// the callback runs after this frame's mesh is reused, so it gets its own copy
				float[] pos = Arrays.copyOf(mesh.pos[b], n * 6);
				int[] col = Arrays.copyOf(mesh.col[b], n * 2);
				Object callback = Proxy.newProxyInstance(geometryCallback.getClassLoader(), new Class<?>[] {geometryCallback}, (proxy, method, args) -> {
					if (method.getDeclaringClass() == Object.class) {
						return switch (method.getName()) {
							case "hashCode" -> System.identityHashCode(proxy);
							case "equals" -> proxy == args[0];
							default -> "Nimbus cosmetics";
						};
					}
					emit((VertexConsumer) args[1], ((PoseStack.Pose) args[0]).pose(), pos, col, n);
					return null;
				});
				submitGeometry.invoke(collector, pose, type(b), callback);
			}
		} catch (Throwable t) {
			ok = false;
		}
	}

	private static Object type(int batch) {
		return batch == CosmeticMesh.SOLID ? cutout : batch == CosmeticMesh.SEE ? translucent : glow;
	}

	private static void emit(VertexConsumer vc, Matrix4f m, float[] pos, int[] col, int n) throws Throwable {
		Vector3f v = new Vector3f();
		Vector3f nn = new Vector3f();
		for (int i = 0; i < n; i++) {
			m.transformPosition(v.set(pos[i * 6], pos[i * 6 + 1], pos[i * 6 + 2]));
			m.transformDirection(nn.set(pos[i * 6 + 3], pos[i * 6 + 4], pos[i * 6 + 5])).normalize();
			int argb = col[i * 2];
			int light = col[i * 2 + 1];
			if (intColour != null) {
				intColour.invokeExact(vc, v.x, v.y, v.z, argb, 0.5f, 0.5f, OVERLAY, light, nn.x, nn.y, nn.z);
			} else {
				floatColour.invokeExact(vc, v.x, v.y, v.z, ((argb >> 16) & 255) / 255f, ((argb >> 8) & 255) / 255f, (argb & 255) / 255f, (argb >>> 24) / 255f, 0.5f, 0.5f, OVERLAY, light, nn.x, nn.y, nn.z);
			}
		}
	}
}
