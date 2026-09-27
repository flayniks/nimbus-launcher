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
		for (int b = 0; b < 3; b++) {
			int n = mesh.count[b];
			if (n == 0) continue;
			// the callback runs after this frame's mesh is reused, so it gets its own copy
			float[] pos = Arrays.copyOf(mesh.pos[b], n * 6);
			int[] col = Arrays.copyOf(mesh.col[b], n * 2);
			RenderType type = b == CosmeticMesh.SOLID ? cutout : b == CosmeticMesh.SEE ? translucent : glow;
			collector.submitCustomGeometry(pose, type, (p, vc) -> emit(vc, p.pose(), pos, col, n));
		}
	}

	private static void emit(VertexConsumer vc, Matrix4f m, float[] pos, int[] col, int n) {
		Vector3f v = new Vector3f();
		Vector3f nn = new Vector3f();
		for (int i = 0; i < n; i++) {
			m.transformPosition(v.set(pos[i * 6], pos[i * 6 + 1], pos[i * 6 + 2]));
			m.transformDirection(nn.set(pos[i * 6 + 3], pos[i * 6 + 4], pos[i * 6 + 5])).normalize();
			vc.addVertex(v.x, v.y, v.z, col[i * 2], 0.5f, 0.5f, OVERLAY, col[i * 2 + 1], nn.x, nn.y, nn.z);
		}
	}
}
