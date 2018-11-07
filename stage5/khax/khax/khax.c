#include <mach/mach_types.h>
#include <sys/systm.h>

kern_return_t khax_start(kmod_info_t * ki, void *d);
kern_return_t khax_stop(kmod_info_t *ki, void *d);

kern_return_t khax_start(kmod_info_t * ki, void *d)
{
    printf("I'm in ur kernelz! ~saelo");
    return KERN_SUCCESS;
}

kern_return_t khax_stop(kmod_info_t *ki, void *d)
{
    return KERN_SUCCESS;
}
