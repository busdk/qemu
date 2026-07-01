/*
 * Lightweight performance-attribution counters.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

#ifndef QEMU_PERF_ATTRIB_H
#define QEMU_PERF_ATTRIB_H

#include "qemu/osdep.h"

bool qemu_perf_attrib_enabled(void);
int64_t qemu_perf_attrib_begin(void);
void qemu_perf_attrib_virtio_queue(const char *device, unsigned queue,
                                   int64_t start_ns);
void qemu_perf_attrib_virtio_notify(const char *device);
void qemu_perf_attrib_virtio_block_request(bool is_write, uint64_t bytes);
void qemu_perf_attrib_virtio_rng_request(uint64_t bytes);
void qemu_perf_attrib_virtio_rng_deliver(uint64_t bytes);
void qemu_perf_attrib_virtio_serial_host_to_guest(uint64_t bytes);
void qemu_perf_attrib_virtio_serial_guest_to_host(uint64_t bytes);
void qemu_perf_attrib_display_frame(uint64_t bytes);
void qemu_perf_attrib_display_key_event(void);

#endif /* QEMU_PERF_ATTRIB_H */
