package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.GuiCanvas;
import com.llamalad7.mixinextras.injector.ModifyExpressionValue;
import dev.flayniks.nimbus.NimbusArt;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.util.Util;
import net.minecraft.client.gui.screens.LoadingOverlay;
import net.minecraft.server.packs.resources.ReloadInstance;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Swaps the red Mojang loading screen for the Nimbus one. Vanilla keeps running its
 * own logic (fades, finishing the reload, closing the overlay); we only recolour its
 * background, hide its logo and bar, and draw ours on top.
 */
@Mixin(LoadingOverlay.class)
public abstract class LoadingOverlayMixin {
	@Shadow @Final private boolean fadeIn;
	@Shadow private float currentProgress;
	@Shadow private long fadeOutStart;
	@Shadow private long fadeInStart;
	@Shadow @Final private ReloadInstance reload;

	@Unique private long nimbus$born = -1L;

	/**
	 * Set when the loading screen looks stuck. Zeroing a local by position is the one
	 * fragile trick here; if a future version reshuffles its locals, this switches it off.
	 */
	@Unique private static boolean nimbus$safeMode;

	/**
	 * Vanilla reads its red brand colour from an IntSupplier for every background it paints,
	 * the fades and the clear colour alike. Answer with ours and red never shows.
	 */
	@ModifyExpressionValue(method = "extractRenderState", at = @At(value = "INVOKE", target = "Ljava/util/function/IntSupplier;getAsInt()I"), require = 0)
	private int nimbus$background(int color) {
		return NimbusArt.LOADING ? 0xFF000000 | NimbusArt.BG : color;
	}

	/** extractRenderState()'s float locals are partialTick, fade-out, fade-in, then the logo's opacity: zero that last one. */
	@ModifyVariable(method = "extractRenderState", at = @At("STORE"), ordinal = 3, require = 0)
	private float nimbus$hideLogo(float logoAlpha) {
		return nimbus$safeMode || !NimbusArt.LOADING ? logoAlpha : 0f;
	}

	@Inject(method = "extractProgressBar", at = @At("HEAD"), cancellable = true, require = 0)
	private void nimbus$hideBar(GuiGraphicsExtractor graphics, int x1, int y1, int x2, int y2, float alpha, CallbackInfo ci) {
		if (NimbusArt.LOADING) ci.cancel();
	}

	@Inject(method = "extractRenderState", at = @At("TAIL"), require = 0)
	private void nimbus$draw(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick, CallbackInfo ci) {
		// Settings → Animations → "Nimbus loading screen" off: leave Mojang\'s screen alone
		if (!NimbusArt.LOADING) return;
		// vanilla's own clock: on 26.x it is not System.nanoTime(), and the fade times are on it
		long now = Util.getMillis();
		if (nimbus$born < 0) nimbus$born = now;
		float out = fadeOutStart > -1L ? (now - fadeOutStart) / 1000f : -1f;
		float in = fadeInStart > -1L ? (now - fadeInStart) / 500f : -1f;
		float alpha;
		boolean opaque;
		if (out >= 1f) {
			alpha = 1f - NimbusArt.clamp01(out - 1f);
			opaque = false;
		} else if (fadeIn) {
			alpha = NimbusArt.clamp01(in);
			opaque = in >= 1f;
		} else {
			alpha = 1f;
			opaque = true;
		}
		float bar = out < 0f ? 1f : 1f - NimbusArt.clamp01(out);

		// a normal fade-out takes two seconds and a fade-in half a second
		boolean stuckOut = fadeOutStart > -1L && now - fadeOutStart > 5000L;
		boolean stuckIn = fadeIn && fadeOutStart == -1L && fadeInStart > -1L && now - fadeInStart > 5000L && reload.isDone();
		if (!nimbus$safeMode && (stuckOut || stuckIn)) nimbus$safeMode = true;
		NimbusArt.loading(new GuiCanvas(graphics), currentProgress, alpha, bar, opaque, now - nimbus$born, fadeIn);
	}
}
