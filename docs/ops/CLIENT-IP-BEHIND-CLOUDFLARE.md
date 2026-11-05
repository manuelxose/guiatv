# Visitor IP behind Cloudflare → nginx → API

Public traffic reaches the API like this:

```
visitor ──▶ Cloudflare edge ──▶ nginx (VPS, :443) ──▶ API (127.0.0.1:4000)
```

nginx has no `real_ip` config, so `$remote_addr` is the Cloudflare edge. It appends that address to the
`X-Forwarded-For` header Cloudflare wrote (`$proxy_add_x_forwarded_for`). The API receives:

```
X-Forwarded-For: <anything the client sent>, <visitor>, <edge>     TCP peer: 127.0.0.1 (nginx)
```

## What `req.ip` is

`app.ts` sets `trust proxy` to `trustProxy` (`apps/backend/src/presentation/middlewares/trustProxy.ts`). Express walks
from the TCP peer leftwards through the header and stops at the first hop that is not trusted:

| hop | address | trusted when |
| --- | --- | --- |
| 0 | TCP peer | loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`), i.e. nginx or a local process |
| 1+ | `X-Forwarded-For`, right to left | inside Cloudflare's published ranges |

| request | `req.ip` |
| --- | --- |
| visitor through Cloudflare | the visitor |
| visitor through Cloudflare, with its own forged `X-Forwarded-For` | the visitor (the forged part is left of it) |
| sent straight to nginx, bypassing Cloudflare, with a forged header | the sender (nginx appended it; it is not Cloudflare) |
| sent straight to the API from outside (port closed by ufw) | the TCP peer; the header is never read, even from a Cloudflare address |
| Angular SSR → `127.0.0.1:4000`, no header | loopback (local reads stay exempt from rate limiting, `isDirectLocalRead`) |

This is the same rule the analytics collector uses (`resolveAnalyticsClient`): Cloudflare ranges are trusted only
behind the loopback nginx, never as the TCP peer. It feeds every per-IP rate limiter (`express-rate-limit` keys on
`req.ip`), the request log's `ip` field, and the address stored on auth sessions.

Before this change `trust proxy` was `1`, so `req.ip` was the edge address. All the visitors behind one edge shared a
rate-limit bucket, and one machine could get a fresh bucket by landing on another edge.

## Configuration

The analytics switches apply here too (`apps/backend/src/infrastructure/analytics/cloudflareIps.ts`):

* `ANALYTICS_TRUST_CLOUDFLARE=false`: trust no Cloudflare range. `req.ip` is then the edge again, like the old `trust proxy` 1.
* `ANALYTICS_CLOUDFLARE_RANGES=a/n,b/m,...`: replaces the built-in list. Use it if Cloudflare publishes new ranges
  (https://www.cloudflare.com/ips-v4, https://www.cloudflare.com/ips-v6) before the code is updated.

No nginx change on the VPS is needed.

## Checking it on the VPS

After a deploy, request any API path through the public site, then look at the request log:

```bash
curl -s -o /dev/null https://guiaprogramaciontv.com/v2/health
```

```bash
journalctl -u guiatv-api -n 200 --no-pager | grep 'Request completed' | grep health | grep -o '"ip":"[^"]*"' | tail -3
```

The `ip` field should be your own public address, not a `172.64.x.x`, `104.16.x.x`, `162.158.x.x` (or other
Cloudflare) address.

## Alternative: nginx `real_ip` (not applied)

You could also have nginx rewrite `$remote_addr`. This is a manual change on the VPS: in the `server` blocks, or in an
`http`-level include, add one `set_real_ip_from` line for each Cloudflare range, then:

```nginx
set_real_ip_from 173.245.48.0/20;
# … one line per range from https://www.cloudflare.com/ips-v4 and /ips-v6 …
real_ip_header CF-Connecting-IP;
```

Then reload nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

It is compatible with `trustProxy`. nginx would append the visitor itself as hop 1, which is not a Cloudflare address,
so the walk stops there with the same result. It would also fix `X-Real-IP` and nginx's own access log. The catch is
that the range list then lives on the VPS too, and must be kept in step by hand.

## Known limits

* **Requests from Cloudflare itself.** Any Cloudflare address is trusted as a hop, so a request made from Cloudflare
  infrastructure (for example a Worker fetching the origin) is believed about the address to its left. nginx `real_ip`
  has the same limit. To close it, accept only Cloudflare's client certificate (Authenticated Origin Pulls) or firewall
  :443 to Cloudflare's ranges.
* **nginx locations without `X-Forwarded-For`.** `/v2/ws`, `/storage` and the sitemaps take their proxy headers from
  `/etc/nginx/snippets/guiatv_proxy.conf`, which is not in the repository. If that snippet does not set
  `X-Forwarded-For`, those requests resolve to loopback (as before this change), and GET/HEAD there are treated as local
  reads.
