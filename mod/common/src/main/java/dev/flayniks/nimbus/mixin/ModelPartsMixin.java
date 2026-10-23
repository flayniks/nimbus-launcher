package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.ModelState;
import java.util.Set;
import net.minecraft.client.Options;
import net.minecraft.world.entity.player.PlayerModelPart;
import org.objectweb.asm.Opcodes;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/**
 * The skin layers the game tells the server about: while you wear a player model with powers they
 * carry its form, face and power instead (see ModelState), so every player sees them. Read in
 * buildPlayerInformation from 1.20.2, in broadcastOptions before.
 */
@Mixin(Options.class)
public abstract class ModelPartsMixin {
	@Shadow
	@Final
	private Set<PlayerModelPart> modelParts;

	@Redirect(method = {"buildPlayerInformation", "broadcastOptions"}, at = @At(value = "FIELD", target = "Lnet/minecraft/client/Options;modelParts:Ljava/util/Set;", opcode = Opcodes.GETFIELD), require = 0)
	private Set<PlayerModelPart> nimbus$parts(Options self) {
		return ModelState.parts(modelParts);
	}
}
