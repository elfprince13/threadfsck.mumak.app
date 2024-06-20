
type ENOSYS = Error & {code : string}
const enosys = function(): ENOSYS {
	const err = new Error("not implemented");
	(err as ENOSYS).code = "ENOSYS";
	return err as ENOSYS;
};


const encoder = new TextEncoder(); //utf-8
const decoder = new TextDecoder("utf-8");
const DummyWASM = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])))

let outputBuf = "";

type FSCallback = (...args : any[]) => void
const fsShim = {
	constants: { O_WRONLY: -1, O_RDWR: -1, O_CREAT: -1, O_TRUNC: -1, O_APPEND: -1, O_EXCL: -1 }, // unused
	writeSync(fd: number, buf: Uint8Array) {
		outputBuf += decoder.decode(buf);
		const nl = outputBuf.lastIndexOf("\n");
		if (nl != -1) {
			console.log(outputBuf.substring(0, nl));
			outputBuf = outputBuf.substring(nl + 1);
		}
		return buf.length;
	},
	write(fd: number, buf: Uint8Array, offset: number, length: number, position: number, callback: FSCallback) {
		if (offset !== 0 || length !== buf.length || position !== null) {
			callback(enosys());
			return;
		}
		const n = this.writeSync(fd, buf);
		callback(null, n);
	},
	chmod(path: string, mode: number, callback: FSCallback) { callback(enosys()); },
	chown(path: string, uid: number, gid: number, callback: FSCallback) { callback(enosys()); },
	close(fd: number, callback: FSCallback) { callback(enosys()); },
	fchmod(fd: number, mode: number, callback: FSCallback) { callback(enosys()); },
	fchown(fd: number, uid: number, gid: number, callback: FSCallback) { callback(enosys()); },
	fstat(fd: number, callback: FSCallback) { callback(enosys()); },
	fsync(fd: number, callback: FSCallback) { callback(null); },
	ftruncate(fd: number, length: number, callback: FSCallback) { callback(enosys()); },
	lchown(path: string, uid: number, gid: number, callback: FSCallback) { callback(enosys()); },
	link(path: string, link: string, callback: FSCallback) { callback(enosys()); },
	lstat(path: string, callback: FSCallback) { callback(enosys()); },
	mkdir(path: string, perm: number, callback: FSCallback) { callback(enosys()); },
	open(path: string, flags: number, mode: number, callback: FSCallback) { callback(enosys()); },
	read(fd: number, buffer: Uint8Array, offse: number, length: number, position: number, callback: FSCallback) { callback(enosys()); },
	readdir(path: string, callback: FSCallback) { callback(enosys()); },
	readlink(path: string, callback: FSCallback) { callback(enosys()); },
	rename(from: string, to: string, callback: FSCallback) { callback(enosys()); },
	rmdir(path: string, callback: FSCallback) { callback(enosys()); },
	stat(path: string, callback: FSCallback) { callback(enosys()); },
	symlink(path: string, link: string, callback: FSCallback) { callback(enosys()); },
	truncate(path: string, length: number, callback: FSCallback) { callback(enosys()); },
	unlink(path: string, callback: FSCallback) { callback(enosys()); },
	utimes(path: string, atime: number, mtime: number, callback: FSCallback) { callback(enosys()); },
};

declare global {
	var fs: typeof fsShim
}


if (!globalThis.fs) {
	globalThis.fs = fsShim
}


const processShim = {
	getuid() { return -1; },
	getgid() { return -1; },
	geteuid() { return -1; },
	getegid() { return -1; },
	getgroups() { throw enosys(); },
	pid: -1,
	ppid: -1,
	umask() { throw enosys(); },
	cwd() { throw enosys(); },
	chdir() { throw enosys(); },
}

declare global {
	var process: typeof processShim
}

if (!globalThis.process) {
	globalThis.process = processShim
}

if (!globalThis.crypto) {
	throw new Error("globalThis.crypto is not available, polyfill required (crypto.getRandomValues only)");
}

if (!globalThis.performance) {
	throw new Error("globalThis.performance is not available, polyfill required (performance.now only)");
}

if (!globalThis.TextEncoder) {
	throw new Error("globalThis.TextEncoder is not available, polyfill required");
}

if (!globalThis.TextDecoder) {
	throw new Error("globalThis.TextDecoder is not available, polyfill required");
}

function GoImportObject(self : Go) {
	const setInt64 = (addr: number, v: number) => {
		self.mem.setUint32(addr + 0, v, true);
		self.mem.setUint32(addr + 4, Math.floor(v / 4294967296), true);
	}

	/*
	const setInt32 = (addr: number, v: number) => {
		self.mem.setUint32(addr + 0, v, true);
	}
	*/

	const getInt64 = (addr: number) => {
		const low = self.mem.getUint32(addr + 0, true);
		const high = self.mem.getInt32(addr + 4, true);
		return low + high * 4294967296;
	}

	const loadValue = (addr: number) => {
		const f = self.mem.getFloat64(addr, true);
		if (f === 0) {
			return undefined;
		}
		if (!isNaN(f)) {
			return f;
		}

		const id = self.mem.getUint32(addr, true);
		return self._values[id];
	}

	const storeValue = (addr: number, v: any) => {
		const nanHead = 0x7FF80000;

		if (typeof v === "number" && v !== 0) {
			if (isNaN(v)) {
				self.mem.setUint32(addr + 4, nanHead, true);
				self.mem.setUint32(addr, 0, true);
				return;
			}
			self.mem.setFloat64(addr, v, true);
			return;
		}

		if (v === undefined) {
			self.mem.setFloat64(addr, 0, true);
			return;
		}

		let id = self._ids.get(v);
		if (id === undefined) {
			id = self._idPool.pop();
			if (id === undefined) {
				id = self._values.length;
			}
			self._values[id] = v;
			self._goRefCounts[id] = 0;
			self._ids.set(v, id);
		}
		self._goRefCounts[id]++;
		let typeFlag = 0;
		switch (typeof v) {
			case "object":
				if (v !== null) {
					typeFlag = 1;
				}
				break;
			case "string":
				typeFlag = 2;
				break;
			case "symbol":
				typeFlag = 3;
				break;
			case "function":
				typeFlag = 4;
				break;
		}
		self.mem.setUint32(addr + 4, nanHead | typeFlag, true);
		self.mem.setUint32(addr, id, true);
	}

	const loadSlice = (addr: number) => {
		const array = getInt64(addr + 0);
		const len = getInt64(addr + 8);
		return new Uint8Array((self._inst.exports.mem as unknown as WebAssembly.Memory).buffer, array, len);
	}

	const loadSliceOfValues = (addr: number) => {
		const array = getInt64(addr + 0);
		const len = getInt64(addr + 8);
		const a = new Array(len);
		for (let i = 0; i < len; i++) {
			a[i] = loadValue(array + i * 8);
		}
		return a;
	}

	const loadString = (addr : number) => {
		const saddr = getInt64(addr + 0);
		const len = getInt64(addr + 8);
		return decoder.decode(new DataView((self._inst.exports.mem as unknown as WebAssembly.Memory).buffer, saddr, len));
	}

	const timeOrigin = Date.now() - performance.now();

	return {
		_gotest: {
			add: (a: number, b: number) => a + b,
		},
		gojs: {
			// Go's SP does not change as long as no Go code is running. Some operations (e.g. calls, getters and setters)
			// may synchronously trigger a Go event handler. This makes Go code get executed in the middle of the imported
			// function. A goroutine can switch to a new stack if the current stack is too small (see morestack function).
			// This changes the SP, thus we have to update the SP used by the imported function.

			// func wasmExit(code int32)
			"runtime.wasmExit": (sp : number) => {
				sp >>>= 0;
				const code = self.mem.getInt32(sp + 8, true);
				self.exited = true;
				// Instead of deleting which would break out type, set them all to dummy values
				self._inst = DummyWASM;
				self._values = [];
				self._goRefCounts = [];
				self._ids = new Map;
				self._idPool = [];
				self.exit(code);
			},

			// func wasmWrite(fd uintptr, p unsafe.Pointer, n int32)
			"runtime.wasmWrite": (sp : number) => {
				sp >>>= 0;
				const fd = getInt64(sp + 8);
				const p = getInt64(sp + 16);
				const n = self.mem.getInt32(sp + 24, true);
				fs.writeSync(fd, new Uint8Array((self._inst.exports.mem as unknown as WebAssembly.Memory).buffer, p, n));
			},

			// func resetMemoryDataView()
			"runtime.resetMemoryDataView": (sp : number) => {
				sp >>>= 0;
				self.mem = new DataView((self._inst.exports.mem as unknown as WebAssembly.Memory).buffer);
			},

			// func nanotime1() int64
			"runtime.nanotime1": (sp : number) => {
				sp >>>= 0;
				setInt64(sp + 8, (timeOrigin + performance.now()) * 1000000);
			},

			// func walltime() (sec int64, nsec int32)
			"runtime.walltime": (sp : number) => {
				sp >>>= 0;
				const msec = (new Date).getTime();
				setInt64(sp + 8, msec / 1000);
				self.mem.setInt32(sp + 16, (msec % 1000) * 1000000, true);
			},

			// func scheduleTimeoutEvent(delay int64) int32
			"runtime.scheduleTimeoutEvent": (sp : number) => {
				sp >>>= 0;
				const id = self._nextCallbackTimeoutID;
				self._nextCallbackTimeoutID++;
				self._scheduledTimeouts.set(id, setTimeout(
					() => {
						self._resume();
						while (self._scheduledTimeouts.has(id)) {
							// for some reason Go failed to register the timeout event, log and try again
							// (temporary workaround for https://github.com/golang/go/issues/28975)
							console.warn("scheduleTimeoutEvent: missed timeout event");
							self._resume();
						}
					},
					getInt64(sp + 8),
				));
				self.mem.setInt32(sp + 16, id, true);
			},

			// func clearTimeoutEvent(id int32)
			"runtime.clearTimeoutEvent": (sp : number) => {
				sp >>>= 0;
				const id = self.mem.getInt32(sp + 8, true);
				clearTimeout(self._scheduledTimeouts.get(id));
				self._scheduledTimeouts.delete(id);
			},

			// func getRandomData(r []byte)
			"runtime.getRandomData": (sp : number) => {
				sp >>>= 0;
				crypto.getRandomValues(loadSlice(sp + 8));
			},

			// func finalizeRef(v ref)
			"syscall/js.finalizeRef": (sp : number) => {
				sp >>>= 0;
				const id = self.mem.getUint32(sp + 8, true);
				self._goRefCounts[id]--;
				if (self._goRefCounts[id] === 0) {
					const v = self._values[id];
					self._values[id] = null;
					self._ids.delete(v);
					self._idPool.push(id);
				}
			},

			// func stringVal(value string) ref
			"syscall/js.stringVal": (sp : number) => {
				sp >>>= 0;
				storeValue(sp + 24, loadString(sp + 8));
			},

			// func valueGet(v ref, p string) ref
			"syscall/js.valueGet": (sp : number) => {
				sp >>>= 0;
				const result = Reflect.get(loadValue(sp + 8), loadString(sp + 16));
				sp = (self._inst.exports.getsp as unknown as (() => number))() >>> 0; // see comment above
				storeValue(sp + 32, result);
			},

			// func valueSet(v ref, p string, x ref)
			"syscall/js.valueSet": (sp : number) => {
				sp >>>= 0;
				Reflect.set(loadValue(sp + 8), loadString(sp + 16), loadValue(sp + 32));
			},

			// func valueDelete(v ref, p string)
			"syscall/js.valueDelete": (sp : number) => {
				sp >>>= 0;
				Reflect.deleteProperty(loadValue(sp + 8), loadString(sp + 16));
			},

			// func valueIndex(v ref, i int) ref
			"syscall/js.valueIndex": (sp : number) => {
				sp >>>= 0;
				storeValue(sp + 24, Reflect.get(loadValue(sp + 8), getInt64(sp + 16)));
			},

			// valueSetIndex(v ref, i int, x ref)
			"syscall/js.valueSetIndex": (sp : number) => {
				sp >>>= 0;
				Reflect.set(loadValue(sp + 8), getInt64(sp + 16), loadValue(sp + 24));
			},

			// func valueCall(v ref, m string, args []ref) (ref, bool)
			"syscall/js.valueCall": (sp : number) => {
				sp >>>= 0;
				try {
					const v = loadValue(sp + 8);
					const m = Reflect.get(v, loadString(sp + 16));
					const args = loadSliceOfValues(sp + 32);
					const result = Reflect.apply(m, v, args);
					sp = (self._inst.exports.getsp as unknown as (() => number))() >>> 0; // see comment above
					storeValue(sp + 56, result);
					self.mem.setUint8(sp + 64, 1);
				} catch (err) {
					sp = (self._inst.exports.getsp as unknown as (() => number))() >>> 0; // see comment above
					storeValue(sp + 56, err);
					self.mem.setUint8(sp + 64, 0);
				}
			},

			// func valueInvoke(v ref, args []ref) (ref, bool)
			"syscall/js.valueInvoke": (sp : number) => {
				sp >>>= 0;
				try {
					const v = loadValue(sp + 8);
					const args = loadSliceOfValues(sp + 16);
					const result = Reflect.apply(v, undefined, args);
					sp = (self._inst.exports.getsp as unknown as (() => number))() >>> 0; // see comment above
					storeValue(sp + 40, result);
					self.mem.setUint8(sp + 48, 1);
				} catch (err) {
					sp = (self._inst.exports.getsp as unknown as (() => number))() >>> 0; // see comment above
					storeValue(sp + 40, err);
					self.mem.setUint8(sp + 48, 0);
				}
			},

			// func valueNew(v ref, args []ref) (ref, bool)
			"syscall/js.valueNew": (sp : number) => {
				sp >>>= 0;
				try {
					const v = loadValue(sp + 8);
					const args = loadSliceOfValues(sp + 16);
					const result = Reflect.construct(v, args);
					sp = (self._inst.exports.getsp as unknown as (() => number))() >>> 0; // see comment above
					storeValue(sp + 40, result);
					self.mem.setUint8(sp + 48, 1);
				} catch (err) {
					sp = (self._inst.exports.getsp as unknown as (() => number))() >>> 0; // see comment above
					storeValue(sp + 40, err);
					self.mem.setUint8(sp + 48, 0);
				}
			},

			// func valueLength(v ref) int
			"syscall/js.valueLength": (sp : number) => {
				sp >>>= 0;
				setInt64(sp + 16, parseInt(loadValue(sp + 8).length));
			},

			// valuePrepareString(v ref) (ref, int)
			"syscall/js.valuePrepareString": (sp : number) => {
				sp >>>= 0;
				const str = encoder.encode(String(loadValue(sp + 8)));
				storeValue(sp + 16, str);
				setInt64(sp + 24, str.length);
			},

			// valueLoadString(v ref, b []byte)
			"syscall/js.valueLoadString": (sp : number) => {
				sp >>>= 0;
				const str = loadValue(sp + 8);
				loadSlice(sp + 16).set(str);
			},

			// func valueInstanceOf(v ref, t ref) bool
			"syscall/js.valueInstanceOf": (sp : number) => {
				sp >>>= 0;
				self.mem.setUint8(sp + 24, (loadValue(sp + 8) instanceof loadValue(sp + 16)) ? 1 : 0);
			},

			// func copyBytesToGo(dst []byte, src ref) (int, bool)
			"syscall/js.copyBytesToGo": (sp : number) => {
				sp >>>= 0;
				const dst = loadSlice(sp + 8);
				const src = loadValue(sp + 32);
				if (!(src instanceof Uint8Array || src instanceof Uint8ClampedArray)) {
					self.mem.setUint8(sp + 48, 0);
					return;
				}
				const toCopy = src.subarray(0, dst.length);
				dst.set(toCopy);
				setInt64(sp + 40, toCopy.length);
				self.mem.setUint8(sp + 48, 1);
			},

			// func copyBytesToJS(dst ref, src []byte) (int, bool)
			"syscall/js.copyBytesToJS": (sp : number) => {
				sp >>>= 0;
				const dst = loadValue(sp + 8);
				const src = loadSlice(sp + 16);
				if (!(dst instanceof Uint8Array || dst instanceof Uint8ClampedArray)) {
					self.mem.setUint8(sp + 48, 0);
					return;
				}
				const toCopy = src.subarray(0, dst.length);
				dst.set(toCopy);
				setInt64(sp + 40, toCopy.length);
				self.mem.setUint8(sp + 48, 1);
			},

			"debug": (value : any) => {
				console.log(value);
			},
		}
	};
}

export class Go {
	argv: Array<string> = ["js"];
	env: { [key:string] : string } = {}
	exit = (code: number) => {
		if (code !== 0) {
			console.warn("exit code:", code);
		}
	};
	_resolveExitPromise = (value: unknown) => {}
	_exitPromise = new Promise((resolve) => {
		this._resolveExitPromise = resolve;
	});
	_pendingEvent: null | {
		id: any;
		this: any;
		args: any[];
		result: any;
	} = null
	_scheduledTimeouts = new Map<number, number>()
	_nextCallbackTimeoutID = 1
	mem = new DataView(new ArrayBuffer(0))
	_ids = new Map<any, number>()
	_values = new Array<any>()
	_idPool = new Array<number>()
	_goRefCounts = new Array<number>()
	// '\0asm' magic number, version number 1
	// see page numbers 154 / 155 of https://webassembly.github.io/spec/core/_download/WebAssembly.pdf
	_inst: WebAssembly.Instance = DummyWASM
	importObject = GoImportObject(this)
	exited: boolean = false

	constructor() {
	}

	async run(instance: WebAssembly.Instance) {
		if (!(instance instanceof WebAssembly.Instance)) {
			throw new Error("Go.run: WebAssembly.Instance expected");
		}
		this._inst = instance;
		this.mem = new DataView((this._inst.exports.mem as unknown as WebAssembly.Memory).buffer);
		this._values = [ // JS values that Go currently has references to, indexed by reference id
			NaN,
			0,
			null,
			true,
			false,
			globalThis,
			this,
		];
		this._goRefCounts = new Array(this._values.length).fill(Infinity); // number of references that Go has to a JS value, indexed by reference id
		this._ids = new Map([ // mapping from JS values to reference ids
			[0 as any, 1],
			[null, 2],
			[true, 3],
			[false, 4],
			[globalThis, 5],
			[this, 6],
		]);
		this._idPool = [];   // unused ids that have been garbage collected
		this.exited = false; // whether the Go program has exited

		// Pass command line arguments and environment variables to WebAssembly by writing them to the linear memory.
		let offset = 4096;

		const strPtr = (str : string) => {
			const ptr = offset;
			const bytes = encoder.encode(str + "\0");
			new Uint8Array(this.mem.buffer, offset, bytes.length).set(bytes);
			offset += bytes.length;
			if (offset % 8 !== 0) {
				offset += 8 - (offset % 8);
			}
			return ptr;
		};

		const argc = this.argv.length;

		const argvPtrs = [];
		this.argv.forEach((arg) => {
			argvPtrs.push(strPtr(arg));
		});
		argvPtrs.push(0);

		const keys = Object.keys(this.env).sort();
		keys.forEach((key) => {
			argvPtrs.push(strPtr(`${key}=${this.env[key]}`));
		});
		argvPtrs.push(0);

		const argv = offset;
		argvPtrs.forEach((ptr) => {
			this.mem.setUint32(offset, ptr, true);
			this.mem.setUint32(offset + 4, 0, true);
			offset += 8;
		});

		// The linker guarantees global data starts from at least wasmMinDataAddr.
		// Keep in sync with cmd/link/internal/ld/data.go:wasmMinDataAddr.
		const wasmMinDataAddr = 4096 + 8192;
		if (offset >= wasmMinDataAddr) {
			throw new Error("total length of command line and environment variables exceeds limit");
		}

		(this._inst.exports.run as unknown as ((a0: number, a1: number) => void))(argc, argv);
		if (this.exited) {
			this._resolveExitPromise(undefined);
		}
		await this._exitPromise;
	}

	_resume() {
		if (this.exited) {
			throw new Error("Go program has already exited");
		}
		(this._inst.exports.resume as unknown as (() => void))();
		if (this.exited) {
			this._resolveExitPromise(undefined);
		}
	}

	_makeFuncWrapper(id : number, ...args : any[]) {
		const go: Go = this;
		return function () {
			const event = { id: id, this: go, args: args, result: (undefined as any) };
			go._pendingEvent = event;
			go._resume();
			return event.result;
		};
	}
}
