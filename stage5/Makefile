CC = clang
CFLAGS += -I../libspc
LIB+=$(wildcard ../libspc/*.c)

kextloader: kextloader.c $(LIB)
	$(CC) $(CFLAGS) -o kextloader $(LIB) kextloader.c
