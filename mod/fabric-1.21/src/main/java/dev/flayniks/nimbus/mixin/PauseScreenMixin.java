package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.Compat;
import dev.flayniks.nimbus.GuiCanvas;
import dev.flayniks.nimbus.NimbusHud;
import dev.flayniks.nimbus.NimbusLan;
import dev.flayniks.nimbus.SkinsScreen;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Skins & Capes and Nimbus Features buttons down the pause menu's left side (toasts cover the right). */
@Mixin(PauseScreen.class)
public abstract class PauseScreenMixin extends Screen {
	protected PauseScreenMixin(Component title) {
		super(title);
	}

	@Inject(method = "init", at = @At("TAIL"), require = 0)
	private void nimbus$skinsButton(CallbackInfo ci) {
		// F3+Esc pauses without a menu: leave that screen empty
		if (this.children().isEmpty()) return;
		Screen self = this;
		this.addRenderableWidget(Button.builder(Component.literal("Skins & Capes"), b -> SkinsScreen.open(self))
			.bounds(6, 6, 98, 20).build());
		this.addRenderableWidget(Button.builder(Component.literal("Nimbus Features"), b -> NimbusHud.openMenu(self))
			.bounds(6, 30, 98, 20).build());
		// your singleplayer world, open to friends through the launcher
		if (NimbusLan.available() && Compat.inSingleplayer()) {
			Button lan = Button.builder(Component.literal(NimbusLan.hosting() ? "Nimbus LAN: on" : "Nimbus LAN"), b -> {
				NimbusLan.open();
				b.setMessage(Component.literal("Nimbus LAN: on"));
				b.active = false;
			}).bounds(6, 54, 98, 20).build();
			lan.active = !NimbusLan.hosting();
			this.addRenderableWidget(lan);
		}
	}

	/** Nimbus LAN's "wants to join" question, above the menu's blur. */
	@Inject(method = "render", at = @At("TAIL"), require = 0)
	private void nimbus$lanQuestion(GuiGraphics graphics, int mouseX, int mouseY, float partialTick, CallbackInfo ci) {
		NimbusLan.draw(new GuiCanvas(graphics));
	}
}
