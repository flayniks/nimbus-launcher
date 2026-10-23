package dev.flayniks.nimbus.mixin;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.flayniks.nimbus.Cosmetics;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.entity.player.PlayerRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Up to 1.21.1: a player wearing a player model isn't drawn (their model is, by Cosmetics). The
 * body, its layers (armour, cape, what's in their hands) all shrink to nothing; the name stays.
 */
@Mixin(PlayerRenderer.class)
public abstract class PlayerRendererMixin {
	@Inject(method = "scale(Lnet/minecraft/client/player/AbstractClientPlayer;Lcom/mojang/blaze3d/vertex/PoseStack;F)V", at = @At("TAIL"), require = 0)
	private void nimbus$model(AbstractClientPlayer player, PoseStack pose, float partialTick, CallbackInfo ci) {
		if (Cosmetics.hidesVanilla(player)) pose.scale(1e-4f, 1e-4f, 1e-4f);
	}
}
