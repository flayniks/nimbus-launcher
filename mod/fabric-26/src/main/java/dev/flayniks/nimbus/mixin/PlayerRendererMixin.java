package dev.flayniks.nimbus.mixin;

import net.minecraft.client.renderer.entity.LivingEntityRenderer;
import org.spongepowered.asm.mixin.Mixin;

/** Nothing on 26.x (LivingEntityRendererMixin hides players wearing a model); the 1.21 jar needs it up to 1.21.1. */
@Mixin(LivingEntityRenderer.class)
public abstract class PlayerRendererMixin {
}
