package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.Badge;
import net.minecraft.client.gui.components.PlayerTabOverlay;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** The same badge in the player list (Tab). */
@Mixin(PlayerTabOverlay.class)
public abstract class TabBadgeMixin {
	@Inject(method = "getNameForDisplay", at = @At("RETURN"), cancellable = true, require = 0)
	private void nimbus$badge(PlayerInfo info, CallbackInfoReturnable<Component> cir) {
		try {
			Component name = cir.getReturnValue();
			Component out = Badge.decorate(Badge.profileId(info.getProfile()), null, name);
			if (out != name) cir.setReturnValue(out);
		} catch (Throwable ignored) {
			// the plain name then
		}
	}
}
