package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.CrazyFx;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Tells Crazy animations about every hit, however short the click. */
@Mixin(MultiPlayerGameMode.class)
public abstract class AttackMixin {
	@Inject(method = "attack", at = @At("HEAD"), require = 0)
	private void nimbus$hit(Player player, Entity target, CallbackInfo ci) {
		CrazyFx.attacked();
	}
}
