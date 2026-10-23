package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.Cosmetics;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** The inventory's picture of you shows your own skin, not your player model (intermediary names). */
@Mixin(InventoryScreen.class)
public abstract class InventoryScreenMixin {
	@Inject(method = {"method_2486", "method_48472"}, at = @At("HEAD"), require = 0, remap = false)
	private static void nimbus$dollIn(CallbackInfo ci) {
		Cosmetics.doll++;
	}

	@Inject(method = {"method_2486", "method_48472"}, at = @At("RETURN"), require = 0, remap = false)
	private static void nimbus$dollOut(CallbackInfo ci) {
		Cosmetics.doll = Math.max(0, Cosmetics.doll - 1);
	}
}
