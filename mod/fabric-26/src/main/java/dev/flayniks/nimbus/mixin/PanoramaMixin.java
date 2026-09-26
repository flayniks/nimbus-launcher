package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.GuiCanvas;
import dev.flayniks.nimbus.MenuBackground;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.renderer.Panorama;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Menu background: the Nimbus glow or your picture instead of the spinning panorama. */
@Mixin(Panorama.class)
public abstract class PanoramaMixin {
	/** 26.3 */
	@Inject(method = "extractRenderState(Lnet/minecraft/client/gui/GuiGraphicsExtractor;II)V", at = @At("HEAD"), cancellable = true, require = 0)
	private void nimbus$background(GuiGraphicsExtractor graphics, int width, int height, CallbackInfo ci) {
		if (MenuBackground.draw(new GuiCanvas(graphics), graphics)) ci.cancel();
	}

	/** 26.1 – 26.2 */
	@Inject(method = "extractRenderState(Lnet/minecraft/client/gui/GuiGraphicsExtractor;IIZ)V", at = @At("HEAD"), cancellable = true, require = 0)
	private void nimbus$backgroundSpin(GuiGraphicsExtractor graphics, int width, int height, boolean spin, CallbackInfo ci) {
		if (MenuBackground.draw(new GuiCanvas(graphics), graphics)) ci.cancel();
	}
}
