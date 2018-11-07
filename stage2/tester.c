#include <dlfcn.h>

int main()
{
    dlopen("./payload.dylib", 0);

    return 0;
}
