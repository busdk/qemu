/*
 * Lightweight performance-attribution counters.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

#include "qemu/osdep.h"
#include "qemu/perf-attrib.h"
#include "qemu/timer.h"

#ifdef CONFIG_EMSCRIPTEN
#include <emscripten/emscripten.h>
#endif

#define PERF_ATTRIB_DEFAULT_INTERVAL 10000
#define PERF_ATTRIB_DEFAULT_TIME_INTERVAL_MS 30000
#define PERF_ATTRIB_WASM_ENV_FILE "/qemu-wasm-perf-attrib-env"

typedef struct PerfAttribVirtioCounters {
    uint64_t kicks;
    uint64_t completions;
    uint64_t handle_ns;
} PerfAttribVirtioCounters;

typedef struct PerfAttribState {
    bool initialized;
    bool enabled;
    uint64_t interval;
    uint64_t next_report;
    uint64_t time_interval_ms;
    int64_t next_time_report_ns;
    int64_t started_ns;
    uint64_t events;
    uint64_t virtio_notifies;
    PerfAttribVirtioCounters virtio_other;
    PerfAttribVirtioCounters virtio_block;
    PerfAttribVirtioCounters virtio_rng;
    PerfAttribVirtioCounters virtio_serial;
    PerfAttribVirtioCounters virtio_net;
    PerfAttribVirtioCounters virtio_display;
    PerfAttribVirtioCounters virtio_input;
    uint64_t block_reads;
    uint64_t block_read_bytes;
    uint64_t block_writes;
    uint64_t block_write_bytes;
    uint64_t rng_requests;
    uint64_t rng_request_bytes;
    uint64_t rng_deliveries;
    uint64_t rng_delivery_bytes;
    uint64_t serial_host_to_guest;
    uint64_t serial_host_to_guest_bytes;
    uint64_t serial_guest_to_host;
    uint64_t serial_guest_to_host_bytes;
    uint64_t display_frames;
    uint64_t display_frame_bytes;
    uint64_t display_key_events;
} PerfAttribState;

static PerfAttribState perf_attrib;

#ifdef CONFIG_EMSCRIPTEN
EM_JS(char *, perf_attrib_wasm_getenv, (const char *name), {
    const key = UTF8ToString(Number(name));
    const env = Module["qemuWasmPerfAttribEnv"] ||
        globalThis.qemuWasmPerfAttribEnv ||
        {};
    const value = env[key];

    if (!value) {
        return 0n;
    }

    const text = String(value);
    const length = lengthBytesUTF8(text) + 1;
    const pointer = _malloc(length);
    const pointerNumber = Number(pointer);

    stringToUTF8(text, pointerNumber, length);
    return BigInt(pointerNumber);
});

static char *perf_attrib_wasm_file_getenv(const char *name)
{
    g_autofree char *contents = NULL;
    const char *line;
    size_t name_len = strlen(name);

    if (!g_file_get_contents(PERF_ATTRIB_WASM_ENV_FILE, &contents, NULL,
                             NULL)) {
        return NULL;
    }

    line = contents;
    while (*line != '\0') {
        const char *end = strchr(line, '\n');
        size_t line_len = end ? end - line : strlen(line);

        if (line_len > name_len && line[name_len] == '=' &&
            memcmp(line, name, name_len) == 0) {
            return g_strndup(line + name_len + 1, line_len - name_len - 1);
        }
        line += line_len;
        if (*line == '\n') {
            line++;
        }
    }

    return NULL;
}
#endif

static const char *perf_attrib_getenv(const char *name, char **owned)
{
    const char *value = g_getenv(name);

    *owned = NULL;
#ifdef CONFIG_EMSCRIPTEN
    if (value == NULL) {
        *owned = perf_attrib_wasm_getenv(name);
        value = *owned;
    }
    if (value == NULL) {
        *owned = perf_attrib_wasm_file_getenv(name);
        value = *owned;
    }
#endif
    return value;
}

static uint64_t parse_u64_env(const char *name, uint64_t fallback,
                              uint64_t min, uint64_t max)
{
    char *owned;
    const char *raw = perf_attrib_getenv(name, &owned);
    uint64_t value;
    char *end = NULL;

    if (raw == NULL || raw[0] == '\0') {
        free(owned);
        return fallback;
    }
    value = g_ascii_strtoull(raw, &end, 10);
    if (end == raw || (end && *end != '\0') || value < min || value > max) {
        free(owned);
        return fallback;
    }
    free(owned);
    return value;
}

static bool parse_enabled(const char *value)
{
    return value != NULL &&
        (g_strcmp0(value, "1") == 0 ||
         g_ascii_strcasecmp(value, "true") == 0 ||
         g_ascii_strcasecmp(value, "yes") == 0 ||
         g_ascii_strcasecmp(value, "on") == 0);
}

static void perf_attrib_report(const char *reason);

static void perf_attrib_atexit(void)
{
    if (perf_attrib.initialized && perf_attrib.enabled &&
        perf_attrib.events) {
        perf_attrib_report("exit");
    }
}

static void perf_attrib_init(void)
{
    const char *enabled;
    char *owned;

    if (perf_attrib.initialized) {
        return;
    }

    perf_attrib.initialized = true;
    enabled = perf_attrib_getenv("QEMU_WASM_PERF_ATTRIBUTION", &owned);
    perf_attrib.enabled = parse_enabled(enabled);
    free(owned);
    if (!perf_attrib.enabled) {
        return;
    }

    perf_attrib.interval =
        parse_u64_env("QEMU_WASM_PERF_ATTRIBUTION_INTERVAL",
                      PERF_ATTRIB_DEFAULT_INTERVAL, 1, UINT64_MAX / 2);
    perf_attrib.next_report = perf_attrib.interval;
    perf_attrib.time_interval_ms =
        parse_u64_env("QEMU_WASM_PERF_ATTRIBUTION_TIME_INTERVAL_MS",
                      PERF_ATTRIB_DEFAULT_TIME_INTERVAL_MS, 1,
                      UINT64_MAX / 1000000);
    perf_attrib.started_ns = qemu_clock_get_ns(QEMU_CLOCK_REALTIME);
    if (perf_attrib.started_ns > 0) {
        perf_attrib.next_time_report_ns = perf_attrib.started_ns +
            perf_attrib.time_interval_ms * 1000000;
    }
    atexit(perf_attrib_atexit);
}

bool qemu_perf_attrib_enabled(void)
{
    perf_attrib_init();
    return perf_attrib.enabled;
}

int64_t qemu_perf_attrib_begin(void)
{
    if (!qemu_perf_attrib_enabled()) {
        return 0;
    }
    return qemu_clock_get_ns(QEMU_CLOCK_REALTIME);
}

void qemu_perf_attrib_poll(void)
{
    int64_t now_ns;

    if (!qemu_perf_attrib_enabled() ||
        perf_attrib.next_time_report_ns <= 0) {
        return;
    }

    now_ns = qemu_clock_get_ns(QEMU_CLOCK_REALTIME);
    if (now_ns < perf_attrib.next_time_report_ns) {
        return;
    }

    perf_attrib_report("time");
    do {
        perf_attrib.next_time_report_ns +=
            perf_attrib.time_interval_ms * 1000000;
    } while (now_ns >= perf_attrib.next_time_report_ns);
}

static PerfAttribVirtioCounters *virtio_counters_for(const char *device)
{
    if (device == NULL) {
        return &perf_attrib.virtio_other;
    }
    if (strstr(device, "blk") || strstr(device, "block")) {
        return &perf_attrib.virtio_block;
    }
    if (strstr(device, "rng")) {
        return &perf_attrib.virtio_rng;
    }
    if (strstr(device, "serial") || strstr(device, "console")) {
        return &perf_attrib.virtio_serial;
    }
    if (strstr(device, "net")) {
        return &perf_attrib.virtio_net;
    }
    if (strstr(device, "gpu") || strstr(device, "vga")) {
        return &perf_attrib.virtio_display;
    }
    if (strstr(device, "input") || strstr(device, "keyboard") ||
        strstr(device, "mouse")) {
        return &perf_attrib.virtio_input;
    }
    return &perf_attrib.virtio_other;
}

static void perf_attrib_count_event(void)
{
    perf_attrib.events++;
    if (perf_attrib.events >= perf_attrib.next_report) {
        perf_attrib_report("interval");
        perf_attrib.next_report = perf_attrib.events + perf_attrib.interval;
    }
}

void qemu_perf_attrib_virtio_queue(const char *device, unsigned queue,
                                   int64_t start_ns)
{
    PerfAttribVirtioCounters *counters;
    int64_t duration;

    (void)queue;

    if (!qemu_perf_attrib_enabled()) {
        return;
    }
    counters = virtio_counters_for(device);
    counters->kicks++;
    if (start_ns > 0) {
        duration = qemu_clock_get_ns(QEMU_CLOCK_REALTIME) - start_ns;
        if (duration > 0) {
            counters->handle_ns += duration;
        }
    }
    perf_attrib_count_event();
}

void qemu_perf_attrib_virtio_notify(const char *device)
{
    PerfAttribVirtioCounters *counters;

    if (!qemu_perf_attrib_enabled()) {
        return;
    }
    counters = virtio_counters_for(device);
    counters->completions++;
    perf_attrib.virtio_notifies++;
    perf_attrib_count_event();
}

void qemu_perf_attrib_virtio_block_request(bool is_write, uint64_t bytes)
{
    if (!qemu_perf_attrib_enabled()) {
        return;
    }
    if (is_write) {
        perf_attrib.block_writes++;
        perf_attrib.block_write_bytes += bytes;
    } else {
        perf_attrib.block_reads++;
        perf_attrib.block_read_bytes += bytes;
    }
    perf_attrib_count_event();
}

void qemu_perf_attrib_virtio_rng_request(uint64_t bytes)
{
    if (!qemu_perf_attrib_enabled()) {
        return;
    }
    perf_attrib.rng_requests++;
    perf_attrib.rng_request_bytes += bytes;
    perf_attrib_count_event();
}

void qemu_perf_attrib_virtio_rng_deliver(uint64_t bytes)
{
    if (!qemu_perf_attrib_enabled()) {
        return;
    }
    perf_attrib.rng_deliveries++;
    perf_attrib.rng_delivery_bytes += bytes;
    perf_attrib_count_event();
}

void qemu_perf_attrib_virtio_serial_host_to_guest(uint64_t bytes)
{
    if (!qemu_perf_attrib_enabled()) {
        return;
    }
    perf_attrib.serial_host_to_guest++;
    perf_attrib.serial_host_to_guest_bytes += bytes;
    perf_attrib_count_event();
}

void qemu_perf_attrib_virtio_serial_guest_to_host(uint64_t bytes)
{
    if (!qemu_perf_attrib_enabled()) {
        return;
    }
    perf_attrib.serial_guest_to_host++;
    perf_attrib.serial_guest_to_host_bytes += bytes;
    perf_attrib_count_event();
}

void qemu_perf_attrib_display_frame(uint64_t bytes)
{
    if (!qemu_perf_attrib_enabled()) {
        return;
    }
    perf_attrib.display_frames++;
    perf_attrib.display_frame_bytes += bytes;
    perf_attrib_count_event();
}

void qemu_perf_attrib_display_key_event(void)
{
    if (!qemu_perf_attrib_enabled()) {
        return;
    }
    perf_attrib.display_key_events++;
    perf_attrib_count_event();
}

static void report_virtio_counter(const char *name,
                                  const PerfAttribVirtioCounters *counters)
{
    fprintf(stderr,
            "\"%s\":{\"kicks\":%" PRIu64 ",\"completions\":%" PRIu64
            ",\"handle_ns\":%" PRIu64 "}",
            name,
            counters->kicks,
            counters->completions,
            counters->handle_ns);
}

static void perf_attrib_report(const char *reason)
{
    uint64_t elapsed_ms = 0;
    int64_t now_ns;

    if (perf_attrib.started_ns > 0) {
        now_ns = qemu_clock_get_ns(QEMU_CLOCK_REALTIME);
        if (now_ns > perf_attrib.started_ns) {
            elapsed_ms = (now_ns - perf_attrib.started_ns) / 1000000;
        }
    }

    fprintf(stderr,
            "qemu-wasm-perf-attrib: {\"format\":1,\"event\":\"summary\","
            "\"reason\":\"%s\",\"elapsed_ms\":%" PRIu64
            ",\"events\":%" PRIu64 ",\"virtio_notifies\":%" PRIu64
            ",\"virtio\":{",
            reason,
            elapsed_ms,
            perf_attrib.events,
            perf_attrib.virtio_notifies);
    report_virtio_counter("block", &perf_attrib.virtio_block);
    fprintf(stderr, ",");
    report_virtio_counter("rng", &perf_attrib.virtio_rng);
    fprintf(stderr, ",");
    report_virtio_counter("serial", &perf_attrib.virtio_serial);
    fprintf(stderr, ",");
    report_virtio_counter("net", &perf_attrib.virtio_net);
    fprintf(stderr, ",");
    report_virtio_counter("display", &perf_attrib.virtio_display);
    fprintf(stderr, ",");
    report_virtio_counter("input", &perf_attrib.virtio_input);
    fprintf(stderr, ",");
    report_virtio_counter("other", &perf_attrib.virtio_other);
    fprintf(stderr,
            "},\"block\":{\"reads\":%" PRIu64
            ",\"read_bytes\":%" PRIu64 ",\"writes\":%" PRIu64
            ",\"write_bytes\":%" PRIu64 "},"
            "\"rng\":{\"requests\":%" PRIu64
            ",\"request_bytes\":%" PRIu64 ",\"deliveries\":%" PRIu64
            ",\"delivery_bytes\":%" PRIu64 "},"
            "\"serial\":{\"host_to_guest\":%" PRIu64
            ",\"host_to_guest_bytes\":%" PRIu64
            ",\"guest_to_host\":%" PRIu64
            ",\"guest_to_host_bytes\":%" PRIu64 "},"
            "\"display\":{\"frames\":%" PRIu64
            ",\"frame_bytes\":%" PRIu64 ",\"key_events\":%" PRIu64 "}}\n",
            perf_attrib.block_reads,
            perf_attrib.block_read_bytes,
            perf_attrib.block_writes,
            perf_attrib.block_write_bytes,
            perf_attrib.rng_requests,
            perf_attrib.rng_request_bytes,
            perf_attrib.rng_deliveries,
            perf_attrib.rng_delivery_bytes,
            perf_attrib.serial_host_to_guest,
            perf_attrib.serial_host_to_guest_bytes,
            perf_attrib.serial_guest_to_host,
            perf_attrib.serial_guest_to_host_bytes,
            perf_attrib.display_frames,
            perf_attrib.display_frame_bytes,
            perf_attrib.display_key_events);
}
