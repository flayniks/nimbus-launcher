package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.CrazyFx;
import dev.flayniks.nimbus.Progress;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * What you do with your hands: every hit (for Crazy animations, however short the click, and for
 * Nimbus coins), every block you break and every block you place (for Nimbus coins).
 */
@Mixin(MultiPlayerGameMode.class)
public abstract class GameModeMixin {
	@Unique
	private BlockState nimbus$breaking;

	@Inject(method = "attack", at = @At("HEAD"), require = 0)
	private void nimbus$hit(Player player, Entity target, CallbackInfo ci) {
		CrazyFx.attacked();
		Progress.attacked(player, target);
	}

	@Inject(method = "destroyBlock", at = @At("HEAD"), require = 0)
	private void nimbus$breakStart(BlockPos pos, CallbackInfoReturnable<Boolean> cir) {
		try {
			Minecraft mc = Minecraft.getInstance();
			nimbus$breaking = mc.level == null ? null : mc.level.getBlockState(pos);
		} catch (Throwable t) {
			nimbus$breaking = null;
		}
	}

	@Inject(method = "destroyBlock", at = @At("RETURN"), require = 0)
	private void nimbus$broke(BlockPos pos, CallbackInfoReturnable<Boolean> cir) {
		if (cir.getReturnValueZ()) Progress.broke(nimbus$breaking);
		nimbus$breaking = null;
	}

	@Inject(method = "useItemOn", at = @At("HEAD"), require = 0)
	private void nimbus$useStart(LocalPlayer player, InteractionHand hand, BlockHitResult hit, CallbackInfoReturnable<?> cir) {
		Progress.useStart(hit);
	}

	@Inject(method = "useItemOn", at = @At("RETURN"), require = 0)
	private void nimbus$useEnd(LocalPlayer player, InteractionHand hand, BlockHitResult hit, CallbackInfoReturnable<?> cir) {
		Progress.useEnd();
	}
}
