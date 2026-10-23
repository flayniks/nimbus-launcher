package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.Cosmetics;
import net.minecraft.client.renderer.entity.LivingEntityRenderer;
import net.minecraft.client.renderer.entity.state.LivingEntityRenderState;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * A player wearing a player model gets a tiny scale in their render state (nothing of theirs is
 * drawn but the name, which goes up above the model).
 */
@Mixin(LivingEntityRenderer.class)
public abstract class LivingEntityRendererMixin {
	@Inject(method = "extractRenderState(Lnet/minecraft/world/entity/LivingEntity;Lnet/minecraft/client/renderer/entity/state/LivingEntityRenderState;F)V", at = @At("TAIL"), require = 0)
	private void nimbus$model(LivingEntity entity, LivingEntityRenderState state, float partialTick, CallbackInfo ci) {
		try {
			if (!Cosmetics.hidesVanilla(entity)) return;
			state.scale = 1e-4f;
			double top = Cosmetics.modelTop(entity);
			Vec3 at = state.nameTagAttachment;
			if (at != null && top > 0 && at.y < top + 0.25) state.nameTagAttachment = new Vec3(at.x, top + 0.25, at.z);
		} catch (Throwable ignored) {
			// drawn as usual
		}
	}
}
