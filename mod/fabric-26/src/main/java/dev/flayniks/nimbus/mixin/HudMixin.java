package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.GuiCanvas;
import dev.flayniks.nimbus.NimbusHud;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Draws the Nimbus HUD on top of vanilla's: the HUD lives in Hud from 26.2 on, in Gui before. */
@Mixin(targets = {"net.minecraft.client.gui.Hud", "net.minecraft.client.gui.Gui"})
public abstract class HudMixin {
	@Inject(method = "extractRenderState(Lnet/minecraft/client/gui/GuiGraphicsExtractor;Lnet/minecraft/client/DeltaTracker;)V", at = @At("TAIL"), require = 0)
	private void nimbus$hud(GuiGraphicsExtractor graphics, DeltaTracker delta, CallbackInfo ci) {
		NimbusHud.render(new GuiCanvas(graphics));
	}
}
