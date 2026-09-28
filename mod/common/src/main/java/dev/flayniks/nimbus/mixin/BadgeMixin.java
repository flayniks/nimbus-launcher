package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.Badge;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * The name above a player's head comes from getDisplayName. Only players in this game's own world
 * (AbstractClientPlayer) get the badge: the singleplayer server's copies don't, so chat and death
 * messages stay as they are.
 */
@Mixin(Player.class)
public abstract class BadgeMixin {
	@Inject(method = "getDisplayName", at = @At("RETURN"), cancellable = true, require = 0)
	private void nimbus$badge(CallbackInfoReturnable<Component> cir) {
		try {
			Object self = this;
			if (!(self instanceof AbstractClientPlayer p)) return;
			Component name = cir.getReturnValue();
			Component out = Badge.decorate(p.getUUID(), p.getName().getString(), name);
			if (out != name) cir.setReturnValue(out);
		} catch (Throwable ignored) {
			// the plain name then
		}
	}
}
