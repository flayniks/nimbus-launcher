package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.GuiCanvas;
import dev.flayniks.nimbus.NimbusArt;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.TitleScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** A small Nimbus badge in the title screen's top-left corner. */
@Mixin(TitleScreen.class)
public abstract class TitleScreenMixin {
	@Unique private long nimbus$shown = -1L;

	@Inject(method = "extractRenderState", at = @At("TAIL"), require = 0)
	private void nimbus$badge(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick, CallbackInfo ci) {
		long now = System.nanoTime() / 1_000_000L;
		if (nimbus$shown < 0) nimbus$shown = now;
		NimbusArt.badge(new GuiCanvas(graphics), now - nimbus$shown);
	}
}
