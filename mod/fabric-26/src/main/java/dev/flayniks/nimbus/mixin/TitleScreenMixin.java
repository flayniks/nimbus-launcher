package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.GuiCanvas;
import dev.flayniks.nimbus.NimbusArt;
import dev.flayniks.nimbus.NimbusHud;
import dev.flayniks.nimbus.SkinsScreen;
import dev.flayniks.nimbus.TitleButtons;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** The Nimbus badge in the top-left corner, with the Nimbus Features and Skins & Capes buttons under it. */
@Mixin(TitleScreen.class)
public abstract class TitleScreenMixin extends Screen {
	@Unique private long nimbus$shown = -1L;
	/** {x, y1, y2, width} of the two buttons; icons are drawn on them when they are the small kind. */
	@Unique private int[] nimbus$at;

	protected TitleScreenMixin(Component title) {
		super(title);
	}

	@Inject(method = "init", at = @At("TAIL"), require = 0)
	private void nimbus$skinsButton(CallbackInfo ci) {
		Screen self = this;
		List<int[]> taken = new ArrayList<>();
		for (GuiEventListener l : this.children()) {
			if (l instanceof AbstractWidget w) taken.add(new int[] {w.getX(), w.getY(), w.getWidth(), w.getHeight()});
		}
		int[] at = TitleButtons.place(this.width, this.height, taken);
		nimbus$at = at;
		boolean small = at[3] < TitleButtons.FULL_W;
		Button features = Button.builder(Component.literal(small ? "" : "Nimbus Features"), b -> NimbusHud.openMenu(self))
			.bounds(at[0], at[1], at[3], TitleButtons.H).build();
		Button skins = Button.builder(Component.literal(small ? "" : "Skins & Capes"), b -> SkinsScreen.open(self))
			.bounds(at[0], at[2], at[3], TitleButtons.H).build();
		if (small) {
			features.setTooltip(Tooltip.create(Component.literal("Nimbus Features")));
			skins.setTooltip(Tooltip.create(Component.literal("Skins & Capes")));
		}
		this.addRenderableWidget(features);
		this.addRenderableWidget(skins);
	}

	@Inject(method = "extractRenderState", at = @At("TAIL"), require = 0)
	private void nimbus$badge(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick, CallbackInfo ci) {
		long now = System.nanoTime() / 1_000_000L;
		if (nimbus$shown < 0) nimbus$shown = now;
		GuiCanvas canvas = new GuiCanvas(graphics);
		NimbusArt.badge(canvas, now - nimbus$shown);
		int[] at = nimbus$at;
		if (at != null && at[3] < TitleButtons.FULL_W) {
			NimbusArt.featuresIcon(canvas, at[0], at[1], now - nimbus$shown);
			NimbusArt.skinsIcon(canvas, at[0], at[2]);
		}
	}
}
