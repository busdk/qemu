/*
 * QEMU Emscripten syscall shims.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

#include "qemu/osdep.h"

#include <stdint.h>
#include <unistd.h>

extern int __syscall_pipe(intptr_t fds);

/*
 * Emscripten provides a weak pipe2 syscall stub that returns ENOSYS and prints
 * a runtime warning before musl falls back to pipe()+fcntl().  GLib uses
 * pipe2() for main-context wakeups, so that warning appears during ordinary
 * QEMU startup even though Emscripten's PIPEFS-backed pipe syscall is enough
 * for this use case.
 */
int __syscall_pipe2(intptr_t fds, int flags)
{
    int *fd = (int *)fds;
    int existing;
    int ret;
    int saved;
    int i;

    if (fd == NULL) {
        return -EFAULT;
    }
    if (flags & ~(O_CLOEXEC | O_NONBLOCK)) {
        return -EINVAL;
    }

    ret = __syscall_pipe(fds);
    if (ret < 0) {
        return ret;
    }

    if (flags & O_NONBLOCK) {
        for (i = 0; i < 2; i++) {
            existing = fcntl(fd[i], F_GETFL, 0);
            if (existing < 0 ||
                fcntl(fd[i], F_SETFL, existing | O_NONBLOCK) < 0) {
                saved = errno;

                close(fd[0]);
                close(fd[1]);
                return -saved;
            }
        }
    }

    return 0;
}
