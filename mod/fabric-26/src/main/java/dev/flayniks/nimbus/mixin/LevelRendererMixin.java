package dev.flayniks.nimbus.mixin;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.flayniks.nimbus.CosmeticMesh;
import dev.flayniks.nimbus.Cosmetics;
import dev.flayniks.nimbus.CosmeticsDraw;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.LevelRenderer;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.state.level.LevelRenderState;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Cosmetics in the world: after the entities are submitted, every player's cosmetics are too. */
@Mixin(LevelRenderer.class)
public abstract class LevelRendererMixin {
	@Unique private static final CosmeticMesh nimbus$mesh = new CosmeticMesh();

	@Inject(method = "submitEntities", at = @At("TAIL"), require = 0)
	private void nimbus$cosmetics(PoseStack pose, LevelRenderState state, SubmitNodeCollector collector, CallbackInfo ci) {
		Minecraft mc = Minecraft.getInstance();
		// the camera's position is in the render state (GameRenderer's camera getter was renamed in 26.3)
		Vec3 p = state.cameraRenderState.pos;
		if (p == null) return;
		float pt = mc.getDeltaTracker().getGameTimeDeltaPartialTick(false);
		CosmeticMesh mesh = nimbus$mesh;
		mesh.clear();
		Cosmetics.collectAll(p.x, p.y, p.z, pt, mc.options.getCameraType().isFirstPerson(), mesh);
		CosmeticsDraw.submit(pose, collector, mesh);
	}
}
