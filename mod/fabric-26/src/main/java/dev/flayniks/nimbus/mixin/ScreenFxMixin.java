package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.CrazyFx;
import dev.flayniks.nimbus.GuiCanvas;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Crazy animations over every menu, hooked on the call every screen is drawn through. */
@Mixin(Screen.class)
public abstract class ScreenFxMixin {
	@Inject(method = "extractRenderStateWithTooltipAndSubtitles", at = @At("HEAD"), require = 0)
	private void nimbus$fxBefore(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick, CallbackInfo ci) {
		CrazyFx.beforeScreen(new GuiCanvas(graphics), (Screen) (Object) this);
	}

	@Inject(method = "extractRenderStateWithTooltipAndSubtitles", at = @At("TAIL"), require = 0)
	private void nimbus$fx(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick, CallbackInfo ci) {
		CrazyFx.afterScreen(new GuiCanvas(graphics), (Screen) (Object) this, mouseX, mouseY);
	}
}
