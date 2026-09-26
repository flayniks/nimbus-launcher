package dev.flayniks.nimbus.mixin;

import net.minecraft.client.OptionInstance;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Sets an option's value without its range check (zoom goes below the FOV slider, fullbright above gamma's). */
@Mixin(OptionInstance.class)
public interface OptionAccess {
	@Accessor("value")
	void nimbus$setRaw(Object value);
}
