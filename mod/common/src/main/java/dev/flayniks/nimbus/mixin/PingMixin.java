package dev.flayniks.nimbus.mixin;

import dev.flayniks.nimbus.NimbusHud;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.protocol.ping.ClientboundPongResponsePacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** The server answering a ping, for the Ping box (1.20.2 and later; older versions have no such answer in game). */
@Mixin(ClientPacketListener.class)
public abstract class PingMixin {
	@Inject(method = "handlePongResponse", at = @At("HEAD"), require = 0)
	private void nimbus$pong(ClientboundPongResponsePacket packet, CallbackInfo ci) {
		NimbusHud.pong(packet);
	}
}
