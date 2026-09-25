package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.GuiCanvas;
import dev.flayniks.nimbus.NimbusArt;
import dev.flayniks.nimbus.SkinsScreen;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** The Nimbus badge in the top-left corner and a Skins & Capes button in the top-right. */
@Mixin(TitleScreen.class)
public abstract class TitleScreenMixin extends Screen {
	@Unique private long nimbus$shown = -1L;

	protected TitleScreenMixin(Component title) {
		super(title);
	}

	@Inject(method = "init", at = @At("TAIL"), require = 0)
	private void nimbus$skinsButton(CallbackInfo ci) {
		Screen self = this;
		this.addRenderableWidget(Button.builder(Component.literal("Skins & Capes"), b -> SkinsScreen.open(self))
			.bounds(this.width - 104, 6, 98, 20).build());
	}

	@Inject(method = "extractRenderState", at = @At("TAIL"), require = 0)
	private void nimbus$badge(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick, CallbackInfo ci) {
		long now = System.nanoTime() / 1_000_000L;
		if (nimbus$shown < 0) nimbus$shown = now;
		NimbusArt.badge(new GuiCanvas(graphics), now - nimbus$shown);
	}
}
