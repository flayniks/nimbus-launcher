package dev.flayniks.nimbus;

import dev.flayniks.nimbus.mixin.OptionAccess;
import java.util.function.Function;
import net.minecraft.client.Minecraft;
import net.minecraft.client.OptionInstance;
import net.minecraft.client.Options;

/**
 * Vanilla video and control options, reached safely: not every option exists in
 * every Minecraft version, so each lookup runs behind a catch and a missing one
 * simply shows as unavailable.
 */
final class Opts {
	private Opts() {
	}

	@SuppressWarnings("unchecked")
	static OptionInstance<Object> find(Function<Options, OptionInstance<?>> getter) {
		try {
			return (OptionInstance<Object>) getter.apply(Minecraft.getInstance().options);
		} catch (Throwable t) {
			return null;
		}
	}

	static Object get(Function<Options, OptionInstance<?>> getter) {
		OptionInstance<Object> o = find(getter);
		try {
			return o == null ? null : o.get();
		} catch (Throwable t) {
			return null;
		}
	}

	/** Sets a value through vanilla (range checks and side effects included) and saves options.txt. */
	static boolean set(Function<Options, OptionInstance<?>> getter, Object value) {
		OptionInstance<Object> o = find(getter);
		if (o == null) return false;
		try {
			o.set(value);
			Minecraft.getInstance().options.save();
			return true;
		} catch (Throwable t) {
			return false;
		}
	}

	/** Sets a value directly, past vanilla's range check. Not saved. */
	static boolean setRaw(Function<Options, OptionInstance<?>> getter, Object value) {
		OptionInstance<Object> o = find(getter);
		if (o == null) return false;
		try {
			((OptionAccess) (Object) o).nimbus$setRaw(value);
			return true;
		} catch (Throwable t) {
			return false;
		}
	}

	/** The next value of an enum option (graphics, particles, clouds), found without naming the enum. */
	static Object nextEnum(Object current) {
		if (!(current instanceof Enum<?> e)) return current;
		Object[] all = e.getDeclaringClass().getEnumConstants();
		return all[(e.ordinal() + 1) % all.length];
	}

	static Object enumAt(Object sample, int ordinal) {
		if (!(sample instanceof Enum<?> e)) return null;
		Object[] all = e.getDeclaringClass().getEnumConstants();
		return ordinal >= 0 && ordinal < all.length ? all[ordinal] : null;
	}
}
