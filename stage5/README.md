# khax

To prepare the kernel extension:

1. Create a self-signed certificate (for code signing purposes) using Keychain.app
2. Build the khax project and copy the resulting khax.kext here
3. codesign the kernel extension: `codesign -f -s $(sha1sum of certificate) khax.kext`
