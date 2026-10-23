package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.Compat;
import net.minecraft.client.renderer.entity.LivingEntityRenderer;
import net.minecraft.world.entity.LivingEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Coerce;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * From 1.21.2 entities are drawn from a "render state" filled in first: a player wearing a player
 * model gets a tiny scale there (so nothing of theirs is drawn but the name, which goes above the
 * model). In intermediary names, since this jar is built against 1.21.1.
 */
@Mixin(LivingEntityRenderer.class)
public abstract class LivingEntityRendererMixin {
	@Inject(method = "method_62355(Lnet/minecraft/class_1309;Lnet/minecraft/class_10042;F)V", at = @At("TAIL"), require = 0, remap = false)
	private void nimbus$model(LivingEntity entity, @Coerce Object state, float partialTick, CallbackInfo ci) {
		Compat.hideForModel(entity, state);
	}
}
