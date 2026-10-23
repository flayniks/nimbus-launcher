package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.Cosmetics;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** The inventory's picture of you shows your own skin, not your player model. */
@Mixin(InventoryScreen.class)
public abstract class InventoryScreenMixin {
	@Inject(method = "extractRenderState(Lnet/minecraft/world/entity/LivingEntity;)Lnet/minecraft/client/renderer/entity/state/EntityRenderState;", at = @At("HEAD"), require = 0)
	private static void nimbus$dollIn(CallbackInfoReturnable<?> cir) {
		Cosmetics.doll++;
	}

	@Inject(method = "extractRenderState(Lnet/minecraft/world/entity/LivingEntity;)Lnet/minecraft/client/renderer/entity/state/EntityRenderState;", at = @At("RETURN"), require = 0)
	private static void nimbus$dollOut(CallbackInfoReturnable<?> cir) {
		Cosmetics.doll = Math.max(0, Cosmetics.doll - 1);
	}
}
