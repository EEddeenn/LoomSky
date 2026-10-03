# The host file

The host file gives `loomsky` its station settings and admission rules.
The service reads it once at startup. Every key below is required;
unknown keys refuse the file. Restart the service to apply a change.

```json
{
  "token": "3f9c0e5d8a7b61240c9e1d2f3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d",
  "origins": ["http://192.168.1.10:3000", "http://localhost:3000"],
  "station": {
    "name": "bench-1",
    "device": "type=b200",
    "channel": 0,
    "reference": "none",
    "bands_hz": [[1559e6, 1610e6]],
    "max_gain_db": 60
  }
}
```

Replace the example token with the token for this host. It is a string
of 64 hexadecimal digits, passed unchanged as the bearer token on
[API calls](api.md#requests-and-replies).

## Callers

| Key | Meaning |
|---|---|
| `token` | the token required by every call except `OPTIONS` |
| `origins` | complete `Origin` header values allowed to call from a browser |

Write an origin as the browser sends it: scheme, host and any port,
without a path or trailing slash. Matching is exact; entries are not
patterns. The service echoes the matched entry in its CORS response.
A client without an `Origin` header still needs the token.

An invalid token stops startup. The error includes a newly generated
64-digit token to paste into the file, unless the system could not
supply random bytes.

## Station

| Key | Meaning |
|---|---|
| `station.name` | the station name returned in status and shown by the page |
| `station.device` | the device-argument string passed to UHD |
| `station.channel` | the unsigned transmit-channel index cabled to the receiver |
| `station.reference` | the radio's clock and time source |
| `station.bands_hz` | allowed signal bands, each `[low, high]` in Hz |
| `station.max_gain_db` | the maximum requested and read-back transmit gain, in dB |

Device-specific master clock and transport settings belong in the
`device` string. The service uses one transmit channel.

When the string explicitly selects `type=b200`, LoomSky supplies missing
transmit transport settings at device creation:

| Setting | Default |
|---|---|
| `send_frame_size` | `16384` bytes |
| `num_send_frames` | `512` |

Existing arguments and explicit values are preserved. For example,
`type=b200,serial=123456,num_send_frames=128` keeps that serial and frame
count, and adds only `send_frame_size=16384`. Other device types and
automatic discovery without `type=b200` receive no added settings.

Together the defaults request an 8 MiB host USB transmit buffer pool.
With one `sc16` channel at 10.24 MS/s, that is about 205 ms of samples
before transport overhead. Actual queued samples and tolerance of host
delays depend on sample production and the transport. This pool is
separate from the service's [200 ms sample ring](../design/timing.md#the-lead).

A bundle's full sampled band must fit inside one listed band:

```text
low ≤ centre − rate/2
centre + rate/2 ≤ high
```

The gain requested by a submission must be no greater than
`max_gain_db`. After tuning, the service checks the radio's read-back
gain against the same maximum. An empty band list admits no bundle.

## Reference

| `station.reference` | Source | Live clock setup |
|---|---|---|
| `none` | internal | set from the host clock |
| `external` | external 10 MHz and PPS inputs | wait for reference lock, then latch time at PPS |
| `gpsdo` | GPS disciplined oscillator | wait for reference and GPS locks, then latch time at PPS |

Replay uses the selected source and its required locks, then sets the
radio's time from the replay point when the first sample slot is ready.
The [clock design](../design/timing.md#the-clock) defines the GPS-time
conversion, PPS latch and lock checks.

## Limits and messages

| Rule | Message |
|---|---|
| valid JSON with each key once | `<fault> at <line>:<column>` |
| every required key present | `MissingField` |
| only the listed keys and types; numbers unquoted, enum names strings | `UnknownField`, `UnexpectedToken` or `InvalidEnumTag` |
| every number finite | `a number is not finite` |
| `token` has 64 hex digits | `token must be 64 hex digits` |
| `device` has no null character | `device must not contain a null character` |
| each band's low edge is below its high edge | `each band of bands_hz runs from its low edge to a higher one` |

The file may be at most 1 MiB. A read or parse failure stops startup
with exit 2; [Install](install.md#limits-and-messages) lists the complete
stderr lines. Settings that require the radio, such as channel support
or a requested sample rate, are checked when the device is used.

When B200 transport defaults are added, the expanded device string may
contain at most 4095 bytes. Exceeding this limit fails device opening
with `uhd_usrp_make: device arguments exceed 4095 bytes after adding B200 transport defaults`.
