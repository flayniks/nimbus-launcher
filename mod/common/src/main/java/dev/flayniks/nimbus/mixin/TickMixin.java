package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.Progress;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Twenty times a second, in menus and worlds alike: Nimbus coins count what you did. */
@Mixin(Minecraft.class)
public abstract class TickMixin {
	@Inject(method = "tick", at = @At("TAIL"), require = 0)
	private void nimbus$tick(CallbackInfo ci) {
		Progress.tick();
	}
}
