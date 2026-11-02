# Getting data off the SIM800L without pretending about security

**The SIM800L is a 2G GSM/GPRS module.** Do not assume HTTPS works on it. Three things
have to line up before it does, and any one of them can fail:

1. The module revision and its firmware. Early SIM800L revisions implement `AT+HTTPPARA`
   with `SSL` support for TLS 1.0 only; later ones claim 1.2. The command can also be
   present and still fail at handshake.
2. Certificate validation. The module needs the CA chain installed
   (`AT+FTPGETPATH`-style storage or `AT+SST` writes, depending on firmware), and a
   Let's Encrypt chain that has moved between ISRG Root X1 and older cross-signatures is a
   classic reason a "working in 2023" device stops connecting.
3. The network. 2G has been switched off in a growing number of countries, and where it
   survives, GPRS gives roughly 30-60 kbps with high, variable latency.

Test yours before designing around it, from a serial terminal:

```
AT+HTTPINIT
AT+HTTPPARA="URL","https://example.com/"
AT+HTTPPARA="SSL",1
AT+HTTPACTION=0
```

If the action returns `+HTTPACTION: 0,603,0` or `604`, TLS did not negotiate. Those are
modem-level error codes, not HTTP status codes, and they are the common answer.

## What the sketches do

`USE_TLS` in `firmware/gateway/config.h` selects `http` or `https` in the URL. It defaults
to `0`, which means the JSON body and the bearer token cross the carrier network in
clear text. Do not leave it there if the site is public.

## Two honest arrangements

Pick one, and record which one you picked, because "we have a token" is not encryption.

### A. TLS-capable transport (preferred)

Replace or supplement the modem with a part that does modern TLS properly — SIM7000G,
SIM7600, or an A767x series Cat-1/LTE module all do TLS 1.2/1.3 with certificate
validation, and most support 4G where 2G has been retired. On the ESP32-2 side the code
path is unchanged: same AT commands, `USE_TLS 1`.

If ESP32-2 has any WiFi at all (its own radio, a phone hotspot, a nearby router), use it
and the built-in `HTTPClient` with a CA bundle. That is the cheapest correct answer for a
gateway that sits within range of a building.

### B. Plain HTTP into a transport you control

If the SIM800L has to stay, terminate the clear-text hop before the open internet:

- the gateway posts to **its own** ingest endpoint over a private APN or an operator
  whitelist, so the cleartext hop is inside a network you do not share with the public; or
- a small relay (a home server, a VPS tunnel, a `frp`/WireGuard peer) accepts the plain
  HTTP POST on the close side and re-emits it over HTTPS to FloodGuard. The relay holds
  the device tokens, so the relay is the trusted component and must be protected as one; or
- if the deployment can tolerate a few minutes of delay, cache packets on the gateway's
  flash and upload them opportunistically whenever a trusted link exists — the ingestion
  API takes `device_timestamp_ms` and stores it beside the server's own `received_at`, so
  late arrival is visible rather than hidden.

Do not solve this by putting the token in the URL, by shortening it to something guessable,
or by "it's only sensor data". A writable ingestion endpoint with no authentication is a
way for anyone to publish a flood alert to the public.

## Rate limits

The public endpoint allows 120 packets per minute per client. A gateway that relays five
nodes every five minutes is nowhere near it; if you see `429` with `retry_after_seconds`,
a loop is broken somewhere and you should fix the loop rather than raise the limit.
