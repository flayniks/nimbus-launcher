package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.CrazyFx;
import dev.flayniks.nimbus.GameStatus;
import dev.flayniks.nimbus.NimbusLan;
import dev.flayniks.nimbus.GuiCanvas;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Crazy animations over every menu (and the Discord status check, which needs a hook that runs in menus). renderWithTooltip is the one call every screen is drawn
 * through (renamed renderWithTooltipAndSubtitles in 1.21.6, same intermediary name).
 */
@Mixin(Screen.class)
public abstract class ScreenFxMixin {
	@Inject(method = "renderWithTooltip", at = @At("HEAD"), require = 0)
	private void nimbus$fxBefore(GuiGraphics graphics, int mouseX, int mouseY, float partialTick, CallbackInfo ci) {
		CrazyFx.beforeScreen(new GuiCanvas(graphics), (Screen) (Object) this);
	}

	@Inject(method = "renderWithTooltip", at = @At("TAIL"), require = 0)
	private void nimbus$fx(GuiGraphics graphics, int mouseX, int mouseY, float partialTick, CallbackInfo ci) {
		NimbusLan.watch();
		GameStatus.frame();
		CrazyFx.afterScreen(new GuiCanvas(graphics), (Screen) (Object) this, mouseX, mouseY);
	}
}
