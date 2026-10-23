package dev.flayniks.nimbus;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import java.util.Arrays;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.rendertype.RenderType;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.resources.Identifier;
import org.joml.Matrix4f;
import org.joml.Vector3f;

/** Hands the cosmetics mesh to Minecraft on 26.x: submitted as custom geometry. */
public final class CosmeticsDraw {
	private CosmeticsDraw() {
	}

	private static final int OVERLAY = 10 << 16; // OverlayTexture.NO_OVERLAY
	private static RenderType cutout;
	private static boolean broken;
	private static RenderType translucent;
	private static RenderType glow;
	// player models' pictures: render types (and textures) made the first time each is drawn
	private static final java.util.Map<String, RenderType> pictures = new java.util.HashMap<>();
	private static final java.util.Map<String, Identifier> textures = new java.util.HashMap<>();

	/** A player model's picture (assets/nimbus/textures/models/<name>.png), loaded once; null if it can't be. */
	public static synchronized Object texture(String name) {
		if (textures.containsKey(name)) return textures.get(name);
		Identifier id = null;
		try (java.io.InputStream in = CosmeticsDraw.class.getResourceAsStream("/assets/nimbus/textures/models/" + name + ".png")) {
			if (in != null) id = (Identifier) Compat.makeTexture(in.readAllBytes(), "models/" + name);
		} catch (Exception ignored) {
			// drawn without it
		}
		textures.put(name, id);
		return id;
	}

	private static RenderType picture(String name) {
		if (pictures.containsKey(name)) return pictures.get(name);
		Identifier id = (Identifier) texture(name);
		RenderType type = id == null ? null : RenderTypes.entityCutout(id);
		pictures.put(name, type);
		return type;
	}

	public static void submit(PoseStack pose, SubmitNodeCollector collector, CosmeticMesh mesh) {
		if (mesh.isEmpty() || broken) return;
		if (cutout == null) {
			// registered at run time: mod assets only load with Fabric API, which Nimbus doesn't need
			try (java.io.InputStream in = CosmeticsDraw.class.getResourceAsStream("/assets/nimbus/textures/misc/white.png")) {
				Identifier white = (Identifier) Compat.makeTexture(in.readAllBytes(), "cosmetics_white");
				cutout = RenderTypes.entityCutout(white);
				translucent = RenderTypes.entityTranslucent(white);
				glow = RenderTypes.eyes(white);
			} catch (Exception e) {
				broken = true;
				return;
			}
		}
		for (int b = 0; b < mesh.batches; b++) {
			int n = mesh.count[b];
			if (n == 0) continue;
			RenderType type = b >= 3 ? picture(mesh.tex[b]) : b == CosmeticMesh.SOLID ? cutout : b == CosmeticMesh.SEE ? translucent : glow;
			if (type == null) continue;
			// the callback runs after this frame's mesh is reused, so it gets its own copy
			float[] pos = Arrays.copyOf(mesh.pos[b], n * 6);
			float[] uv = Arrays.copyOf(mesh.uv[b], n * 2);
			int[] col = Arrays.copyOf(mesh.col[b], n * 2);
			collector.submitCustomGeometry(pose, type, (p, vc) -> emit(vc, p.pose(), pos, uv, col, n));
		}
	}

	private static void emit(VertexConsumer vc, Matrix4f m, float[] pos, float[] uv, int[] col, int n) {
		Vector3f v = new Vector3f();
		Vector3f nn = new Vector3f();
		for (int i = 0; i < n; i++) {
			m.transformPosition(v.set(pos[i * 6], pos[i * 6 + 1], pos[i * 6 + 2]));
			m.transformDirection(nn.set(pos[i * 6 + 3], pos[i * 6 + 4], pos[i * 6 + 5])).normalize();
			vc.addVertex(v.x, v.y, v.z, col[i * 2], uv[i * 2], uv[i * 2 + 1], OVERLAY, col[i * 2 + 1], nn.x, nn.y, nn.z);
		}
	}
}
