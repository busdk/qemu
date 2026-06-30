/*
 * Tiny Linux input-event helper for QEMU WebAssembly display/input smoke tests.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/select.h>
#include <sys/stat.h>
#include <unistd.h>

enum {
    MAX_INPUT_EVENTS = 32,
};

static volatile sig_atomic_t timed_out;

typedef struct InputFds {
    int fds[MAX_INPUT_EVENTS];
    unsigned int count;
} InputFds;

static void on_alarm(int signal)
{
    (void)signal;
    timed_out = 1;
}

static char key_code_to_char(unsigned int code)
{
    switch (code) {
    case KEY_A:
        return 'a';
    case KEY_B:
        return 'b';
    case KEY_C:
        return 'c';
    case KEY_D:
        return 'd';
    case KEY_E:
        return 'e';
    case KEY_F:
        return 'f';
    case KEY_G:
        return 'g';
    case KEY_H:
        return 'h';
    case KEY_I:
        return 'i';
    case KEY_J:
        return 'j';
    case KEY_K:
        return 'k';
    case KEY_L:
        return 'l';
    case KEY_M:
        return 'm';
    case KEY_N:
        return 'n';
    case KEY_O:
        return 'o';
    case KEY_P:
        return 'p';
    case KEY_Q:
        return 'q';
    case KEY_R:
        return 'r';
    case KEY_S:
        return 's';
    case KEY_T:
        return 't';
    case KEY_U:
        return 'u';
    case KEY_V:
        return 'v';
    case KEY_W:
        return 'w';
    case KEY_X:
        return 'x';
    case KEY_Y:
        return 'y';
    case KEY_Z:
        return 'z';
    default:
        break;
    }
    if (code >= KEY_1 && code <= KEY_9) {
        return (char)('1' + (code - KEY_1));
    }
    if (code == KEY_0) {
        return '0';
    }
    if (code == KEY_SPACE) {
        return ' ';
    }
    if (code == KEY_ENTER) {
        return '\n';
    }
    return 0;
}

static int read_event(int fd, struct input_event *event)
{
    unsigned char *cursor = (unsigned char *)event;
    size_t remaining = sizeof(*event);

    while (remaining > 0) {
        ssize_t count = read(fd, cursor, remaining);
        if (count < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK) {
                return -1;
            }
            if (errno == EINTR && !timed_out) {
                continue;
            }
            return -1;
        }
        if (count == 0) {
            errno = EIO;
            return -1;
        }
        cursor += count;
        remaining -= (size_t)count;
    }
    return 0;
}

static void close_input_fds(InputFds *inputs)
{
    for (unsigned int i = 0; i < inputs->count; i++) {
        close(inputs->fds[i]);
    }
    inputs->count = 0;
}

static int add_input_fd(InputFds *inputs, const char *path)
{
    if (inputs->count >= MAX_INPUT_EVENTS) {
        return 0;
    }
    int fd = open(path, O_RDONLY | O_NONBLOCK);
    if (fd < 0) {
        return -1;
    }
    inputs->fds[inputs->count++] = fd;
    return 0;
}

static bool input_path_is_directory(const char *path)
{
    struct stat st;

    if (stat(path, &st) == 0) {
        return S_ISDIR(st.st_mode);
    }
    return strcmp(path, "/dev/input") == 0;
}

static int open_input_fds(const char *device, InputFds *inputs)
{
    while (!timed_out) {
        if (input_path_is_directory(device)) {
            char path[128];

            close_input_fds(inputs);
            for (unsigned int i = 0; i < MAX_INPUT_EVENTS; i++) {
                snprintf(path, sizeof(path), "%s/event%u", device, i);
                if (add_input_fd(inputs, path) != 0 &&
                    errno != ENOENT && errno != ENODEV && errno != ENXIO) {
                    return -1;
                }
            }
            if (inputs->count > 0) {
                return 0;
            }
        } else {
            if (add_input_fd(inputs, device) == 0) {
                return 0;
            }
            if (errno != ENOENT && errno != ENODEV && errno != ENXIO) {
                return -1;
            }
        }

        usleep(100000);
    }

    errno = ETIMEDOUT;
    return -1;
}

static int wait_input_event(InputFds *inputs, struct input_event *event)
{
    while (!timed_out) {
        fd_set readfds;
        int maxfd = -1;
        struct timeval timeout = {
            .tv_sec = 0,
            .tv_usec = 100000,
        };

        FD_ZERO(&readfds);
        for (unsigned int i = 0; i < inputs->count; i++) {
            FD_SET(inputs->fds[i], &readfds);
            if (inputs->fds[i] > maxfd) {
                maxfd = inputs->fds[i];
            }
        }
        if (maxfd < 0) {
            errno = ENODEV;
            return -1;
        }

        int ready = select(maxfd + 1, &readfds, NULL, NULL, &timeout);
        if (ready < 0) {
            if (errno == EINTR && !timed_out) {
                continue;
            }
            return -1;
        }
        if (ready == 0) {
            continue;
        }
        for (unsigned int i = 0; i < inputs->count; i++) {
            if (!FD_ISSET(inputs->fds[i], &readfds)) {
                continue;
            }
            if (read_event(inputs->fds[i], event) == 0) {
                return 0;
            }
            if (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
                return -1;
            }
        }
    }

    errno = ETIMEDOUT;
    return -1;
}

int main(int argc, char **argv)
{
    const char *device = argc > 1 ? argv[1] : "/dev/input/event0";
    const char *expected = argc > 2 ? argv[2] : "ab";
    unsigned int timeout = argc > 3 ? (unsigned int)strtoul(argv[3], NULL, 10) : 30;
    const char *ready_marker = argc > 4 ? argv[4] : NULL;
    size_t expected_len = strlen(expected);
    size_t matched = 0;
    char seen[128];
    size_t seen_len = 0;

    if (expected_len == 0) {
        fprintf(stderr, "expected input must not be empty\n");
        return 2;
    }

    signal(SIGALRM, on_alarm);
    alarm(timeout == 0 ? 30 : timeout);

    InputFds inputs = { 0 };
    if (open_input_fds(device, &inputs) != 0) {
        fprintf(stderr, "open %s failed: %s\n", device, strerror(errno));
        return 2;
    }
    if (ready_marker && ready_marker[0]) {
        printf("%s\n", ready_marker);
        fflush(stdout);
    }

    while (!timed_out) {
        struct input_event event;
        if (wait_input_event(&inputs, &event) != 0) {
            if (timed_out) {
                break;
            }
            fprintf(stderr, "read %s failed: %s\n", device, strerror(errno));
            close_input_fds(&inputs);
            return 2;
        }
        if (event.type != EV_KEY || event.value != 1) {
            continue;
        }
        char ch = key_code_to_char(event.code);
        if (ch == 0) {
            continue;
        }
        if (seen_len + 2 < sizeof(seen)) {
            if (ch == '\n') {
                seen[seen_len++] = '\\';
                seen[seen_len++] = 'n';
            } else {
                seen[seen_len++] = ch;
            }
            seen[seen_len] = '\0';
        }
        if (ch == '\n' && matched == expected_len) {
            printf("QEMU_WASM_LINUX_INPUT_TEXT:%s\n", seen);
            close_input_fds(&inputs);
            return 0;
        }
        if (matched < expected_len && ch == expected[matched]) {
            matched++;
            if (matched == expected_len) {
                printf("QEMU_WASM_LINUX_INPUT_TEXT:%s\n", seen);
                close_input_fds(&inputs);
                return 0;
            }
        } else {
            matched = ch == expected[0] ? 1 : 0;
        }
    }

    printf("QEMU_WASM_LINUX_INPUT_TIMEOUT:%s\n", seen_len > 0 ? seen : "<none>");
    close_input_fds(&inputs);
    return 1;
}
