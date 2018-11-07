CC = clang
CFLAGS += -I../libspc
LIB = $(wildcard ../libspc/*.c)

.PHONY: all
all: stage2.dylib tester

stage2.dylib: payload.c $(LIB) ../config.py
	$(CC) -shared $(CFLAGS) -DHOST=\"${HOST}\" -DHTTP_PORT=\"${HTTP_PORT}\" -DTCPLOG_PORT=\"${TCPLOG_PORT}\" -o stage2.dylib $(LIB) payload.c

tester: tester.c
	$(CC) -o tester tester.c
