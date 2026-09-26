package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.GuiCanvas;
import dev.flayniks.nimbus.NimbusHud;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.GuiGraphics;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Draws the Nimbus HUD on top of vanilla's. */
@Mixin(Gui.class)
public abstract class HudMixin {
	// 1.21 and later: render(GuiGraphics, DeltaTracker). The full signature matters: by name alone
	// Mixin would also pick 1.20's render(GuiGraphics, float) and refuse the whole class.
	@Inject(method = "render(Lnet/minecraft/client/gui/GuiGraphics;Lnet/minecraft/client/DeltaTracker;)V", at = @At("TAIL"), require = 0)
	private void nimbus$hud(GuiGraphics graphics, DeltaTracker delta, CallbackInfo ci) {
		NimbusHud.render(new GuiCanvas(graphics));
	}

	// 1.20.x: render(GuiGraphics, float), written in intermediary names since this jar is built against 1.21
	@Inject(method = "method_1753(Lnet/minecraft/class_332;F)V", at = @At("TAIL"), require = 0, remap = false)
	private void nimbus$hudLegacy(GuiGraphics graphics, float partialTick, CallbackInfo ci) {
		NimbusHud.render(new GuiCanvas(graphics));
	}
}
