package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.SkinsScreen;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** A Skins & Capes button in the pause menu's top-left corner (toasts cover the right). */
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
	}
}
