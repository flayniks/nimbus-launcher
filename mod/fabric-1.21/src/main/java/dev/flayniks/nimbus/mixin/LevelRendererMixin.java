package dev.flayniks.nimbus.mixin;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.flayniks.nimbus.Compat;
import dev.flayniks.nimbus.CosmeticMesh;
import dev.flayniks.nimbus.Cosmetics;
import dev.flayniks.nimbus.CosmeticsDraw;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.LevelRenderer;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Coerce;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Cosmetics in the world. Up to 1.21.8 every entity is drawn through renderEntity, so each player's
 * cosmetics go in right after the player. From 1.21.9 entities are "submitted" instead; after
 * submitEntities (written in intermediary names, since this jar is built against 1.21.1) every
 * player's cosmetics are submitted too.
 */
@Mixin(LevelRenderer.class)
public abstract class LevelRendererMixin {
	@Unique private static final CosmeticMesh nimbus$mesh = new CosmeticMesh();

	@Inject(method = "renderEntity", at = @At("TAIL"), require = 0)
	private void nimbus$cosmetics(Entity entity, double camX, double camY, double camZ, float partialTick, PoseStack pose, MultiBufferSource buffers, CallbackInfo ci) {
		if (!(entity instanceof Player player)) return;
		CosmeticMesh mesh = nimbus$mesh;
		mesh.clear();
		int light = Minecraft.getInstance().getEntityRenderDispatcher().getPackedLightCoords(player, partialTick);
		Cosmetics.collect(player, camX, camY, camZ, partialTick, light, mesh);
		CosmeticsDraw.draw(pose, buffers, mesh);
	}

	@Inject(method = "method_72916(Lnet/minecraft/class_4587;Lnet/minecraft/class_11658;Lnet/minecraft/class_11659;)V", at = @At("TAIL"), require = 0, remap = false)
	private void nimbus$cosmeticsSubmit(PoseStack pose, @Coerce Object state, @Coerce Object collector, CallbackInfo ci) {
		double[] cam = Compat.camera();
		if (cam == null) return;
		CosmeticMesh mesh = nimbus$mesh;
		mesh.clear();
		Cosmetics.collectAll(cam[0], cam[1], cam[2], (float) cam[3], cam[4] == 0, mesh);
		CosmeticsDraw.submit(pose, collector, mesh);
	}
}
