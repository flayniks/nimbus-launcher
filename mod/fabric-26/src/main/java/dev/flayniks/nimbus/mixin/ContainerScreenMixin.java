package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.GuiCanvas;
import dev.flayniks.nimbus.NimbusArt;
import dev.flayniks.nimbus.NimbusConfig;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.CreativeModeInventoryScreen;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * The Nimbus badge in the top-left corner while your inventory is open. On 26.x the
 * survival inventory draws itself without going through AbstractContainerScreen's
 * extractRenderState, so this hooks the entry point every screen is drawn through.
 */
@Mixin(Screen.class)
public abstract class ContainerScreenMixin {
	@Unique private long nimbus$opened = -1L;

	@Inject(method = "extractRenderStateWithTooltipAndSubtitles", at = @At("TAIL"), require = 0)
	private void nimbus$watermark(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick, CallbackInfo ci) {
		Object self = this;
		if (!(self instanceof InventoryScreen) && !(self instanceof CreativeModeInventoryScreen)) return;
		if (!NimbusConfig.on("inventory.watermark", true)) return;
		long now = System.nanoTime() / 1_000_000L;
		if (nimbus$opened < 0) nimbus$opened = now;
		NimbusArt.badgeAt(new GuiCanvas(graphics), 6, 6, now - nimbus$opened);
	}
}
