package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.GuiCanvas;
import dev.flayniks.nimbus.MenuBackground;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.renderer.PanoramaRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Menu background: replaces the spinning panorama behind the title screen and the menus
 * with the Nimbus glow or your picture. 1.20–1.20.4 draw the panorama elsewhere, see
 * TitleScreenMixin.
 */
@Mixin(PanoramaRenderer.class)
public abstract class PanoramaMixin {
	/** 1.20.5 – 1.21.5 */
	@Inject(method = "render(Lnet/minecraft/client/gui/GuiGraphics;IIFF)V", at = @At("HEAD"), cancellable = true, require = 0)
	private void nimbus$background(GuiGraphics graphics, int width, int height, float alpha, float partialTick, CallbackInfo ci) {
		if (MenuBackground.draw(new GuiCanvas(graphics), graphics)) ci.cancel();
	}

	/** 1.21.6 – 1.21.11 */
	@Inject(method = "method_3317(Lnet/minecraft/class_332;IIZ)V", at = @At("HEAD"), cancellable = true, require = 0, remap = false)
	private void nimbus$backgroundSpin(GuiGraphics graphics, int width, int height, boolean spin, CallbackInfo ci) {
		if (MenuBackground.draw(new GuiCanvas(graphics), graphics)) ci.cancel();
	}
}
