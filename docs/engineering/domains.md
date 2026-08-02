# Candidate domains for Docket and Athena

> **Requirement:** GEN-23 — "Produce candidate domain names for Docket and for Athena as an
> explicit deliverable."
>
> **Checked:** 2026-08-02, from this machine, with `whois` and `dig` (both at `/usr/bin`).
>
> **Nothing here has been registered.** Registering a domain is a purchase, and purchases are the
> author's to make. This document is the shortlist and the evidence behind it; §6 is the exact
> step that turns a pick into a registration.

---

## 1. What the name has to do

These constraints come from the product, not from taste, and every candidate below was filtered
through them:

1. **Docket is not a developer tool.** It is a multi-organization personal command centre — the
   place someone runs their whole working life from. Names that read as infrastructure (`-hq`,
   `-io`, `-dev`, `-stack`, `-ops`, `-cli`) are out, however available they are.
2. **The tagline is "Run every organization from one calm place."** The name should sit next to
   that sentence without fighting it. Calm, plain, and a little domestic beats clever.
3. **Athena is the agent.** It is strongly interconnected with Docket but not strictly coupled to
   it: Athena has her own identity, her own inbound mail address, and could plausibly be spoken
   about on her own. That argues for her own apex rather than a subdomain of Docket's, even though
   a subdomain would be cheaper.
4. **The word "docket" is heavily used in legal software.** Every short `docket*.com` was checked
   below; the space is crowded, and most of what is free is free because it is awkward. A
   non-`.com` apex is a serious option rather than a consolation prize.
5. **Whatever is chosen has to carry four hosts**, because that is what production runs today:
   the web app, the API, the admin back-office, and the WebAuthn RP ID. Today those are
   `docket.hypertext.studio`, `docket-api.hypertext.studio`, `docket-admin.hypertext.studio`, and
   an RP ID of `hypertext.studio`. See `docs/engineering/domain-cutover.md`.

## 2. How each candidate was checked

```
$ whois -h whois.verisign-grs.com <domain>      # .com — the registry's own server
$ dig +short NS <domain>                        # delegation: a registered domain has nameservers
$ dig <domain> NS +noall +comment | grep status # NXDOMAIN = not in the zone at all
```

`whois <domain>` without `-h` is useless for several of these TLDs: Google's registry (`.app`,
`.day`) publishes no `refer:` in its IANA record, so the client falls back to IANA and returns TLD
metadata rather than domain data. Identity Digital's server answers `TLD is not supported.` for
`.place`. Where WHOIS was unavailable the DNS evidence is what is recorded, and it is labelled as
such — an absent NS delegation is strong evidence a name is unregistered but it is not proof, since
a registered domain can sit undelegated.

## 3. Docket candidates

| Candidate            | Result          | Evidence                                                                       |
| -------------------- | --------------- | ------------------------------------------------------------------------------ |
| `docket.place`       | **likely free** | `dig docket.place NS` → `status: NXDOMAIN`, no NS, no A                        |
| `runthedocket.com`   | **free**        | `No match for domain "RUNTHEDOCKET.COM".`                                      |
| `everydocket.com`    | **free**        | `No match for domain "EVERYDOCKET.COM".`                                       |
| `docketeveryday.com` | **free**        | `No match for domain "DOCKETEVERYDAY.COM".`                                    |
| `onedocket.com`      | for sale        | Registered 2020-10-31, Dynadot; NS `ns1.brandbucket.com` — a brokerage listing |
| `docketspace.com`    | for sale        | Registered 2024-01-28, GoDaddy; NS `ns1.afternic.com` — a brokerage listing    |
| `trydocket.com`      | expiring        | DropCatch.com 1051 LLC; **Registry Expiry Date: 2026-08-12** (ten days out)    |
| `mydocket.com`       | parked          | TurnCommerce/NameBright; NS `nsg1.namebrightdns.com`                           |
| `usedocket.app`      | taken, live     | NS `mack.ns.cloudflare.com`, A `216.198.79.1` — someone is serving from it     |
| `usedocket.com`      | taken           | Registered 2023-06-13, Amazon Registrar, AWS nameservers                       |
| `docketapp.com`      | taken           | Registered 2008-12-05, GoDaddy                                                 |
| `dockethq.com`       | taken           | Registered 2019-03-04, Tucows/Hover                                            |
| `docketwork.com`     | taken           | Registered 2026-04-20, Name.com                                                |
| `docketly.com`       | taken           | Registered 2012-06-11, GoDaddy, AWS nameservers                                |
| `yourdocket.com`     | taken           | Registered 2018-05-23, Squarespace Domains                                     |
| `calmdocket.com`     | taken           | Registered 2026-07-14, Cloudflare                                              |
| `docketdaily.com`    | taken           | Registered 2026-02-12, Network Solutions                                       |
| `docket.app`         | taken           | NS `dns1.registrar-servers.com` (Namecheap), no A record                       |
| `getdocket.app`      | taken, live     | Google nameservers, A records on Squarespace ranges                            |
| `thedocket.app`      | for sale        | NS `ns3.afternic.com`                                                          |

### `usedocket.app` — the one already in the codebase

`packages/auth/tests/builder/auth.test.ts:1293` lists `usedocket.app` as an allowed host. It is not
a real option:

```
$ dig +short NS usedocket.app
mack.ns.cloudflare.com.
venus.ns.cloudflare.com.
$ dig +short A usedocket.app
216.198.79.1
```

It is registered, delegated to Cloudflare, and answering with an address — somebody else is using
it. Its presence in that test is a fixture hostname, not a claim of ownership, and it should not be
read as one. (It is harmless where it sits: the test asserts how the allowed-hosts list is parsed,
and any string would do.)

### Verbatim WHOIS for the free names

```
$ whois -h whois.verisign-grs.com runthedocket.com
No match for domain "RUNTHEDOCKET.COM".

$ whois -h whois.verisign-grs.com everydocket.com
No match for domain "EVERYDOCKET.COM".

$ whois -h whois.verisign-grs.com docketeveryday.com
No match for domain "DOCKETEVERYDAY.COM".

$ dig docket.place NS +noall +comment
;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: ...
$ dig +short NS docket.place
$ dig +short A docket.place
```

## 4. Athena candidates

| Candidate         | Result          | Evidence                                                                  |
| ----------------- | --------------- | ------------------------------------------------------------------------- |
| `athena.day`      | **likely free** | `dig athena.day NS` → `status: NXDOMAIN`, no NS, no A                     |
| `athenaday.com`   | **free**        | `No match for domain "ATHENADAY.COM".`                                    |
| `quietathena.com` | **free**        | `No match for domain "QUIETATHENA.COM".`                                  |
| `athenaquiet.com` | **free**        | `No match for domain "ATHENAQUIET.COM".`                                  |
| `athena.place`    | **likely free** | `dig athena.place NS` → `status: NXDOMAIN`                                |
| `meetathena.com`  | for sale        | Registered 2021-02-16, GoDaddy; NS `ns1.afternic.com` — brokerage listing |
| `heyathena.app`   | inconclusive    | `dig heyathena.app NS` → `status: SERVFAIL` — neither present nor absent  |
| `withathena.com`  | taken           | Registered 2024-07-03, Amazon Registrar, AWS nameservers                  |
| `heyathena.com`   | taken           | Registered 2016-02-02, GoDaddy                                            |
| `askathena.com`   | taken           | Registered 2009-09-15, GoDaddy                                            |
| `askathena.app`   | taken           | NS `dns1.registrar-servers.com`, A `192.64.119.95`                        |
| `athena.app`      | taken, parked   | NS `park1.dns.ws` — a parking service                                     |
| `athenaworks.com` | taken           | Registered 1999-09-18, NameCheap                                          |
| `athenaspace.com` | taken           | Registered 2014-01-15, GoDaddy, AWS nameservers                           |
| `athenaroom.com`  | taken           | Registered 2024-01-05, Wild West Domains                                  |
| `athenachief.com` | taken           | Registered 2026-07-22, Name.com, **Vercel nameservers**                   |

### Verbatim WHOIS for the free names

```
$ whois -h whois.verisign-grs.com athenaday.com
No match for domain "ATHENADAY.COM".

$ whois -h whois.verisign-grs.com quietathena.com
No match for domain "QUIETATHENA.COM".

$ whois -h whois.verisign-grs.com athenaquiet.com
No match for domain "ATHENAQUIET.COM".

$ dig athena.day NS +noall +comment
;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: ...
$ dig +short NS athena.day
$ dig +short A athena.day
```

One thing worth noticing rather than skipping past: `athenachief.com` was registered on
**2026-07-22** and is delegated to `ns1.vercel-dns.com`. That is somebody building an
"Athena, chief of staff" product on Vercel, ten days ago. It does not block anything here, but the
name space around "Athena" plus "chief of staff" is being actively claimed.

## 5. Recommendations

### Docket → `docket.place`

The apex IS the product name, which nothing else on the free list manages. Every other free
candidate has to bolt a verb or a quantifier on the front (`run-the-`, `every-`, `-everyday`), and
each of those makes the name longer to say and weaker to own. `docket.place` also lands squarely on
the tagline — "one calm place" — without the domain having to spell the tagline out.

It maps cleanly onto the four hosts production needs:

| Today                           | After                |
| ------------------------------- | -------------------- |
| `docket.hypertext.studio`       | `docket.place`       |
| `docket-api.hypertext.studio`   | `api.docket.place`   |
| `docket-admin.hypertext.studio` | `admin.docket.place` |
| RP ID `hypertext.studio`        | RP ID `docket.place` |

Moving the apex to the product also fixes something the current layout gets wrong: an RP ID of
`hypertext.studio` scopes every passkey to the studio apex, so a second studio product on that apex
would share Docket's passkey scope.

**Honest trade-offs.** `.place` is an uncommon TLD. Three consequences to accept deliberately:
some chat and email clients auto-link `.com` more reliably than long-tail gTLDs; a few corporate
mail filters weight unfamiliar TLDs slightly in spam scoring, which matters because GEN-28 puts
transactional mail on this domain; and it costs more per year than `.com`. None is disqualifying,
but the mail point deserves the DMARC/DKIM work in the cutover runbook regardless.

**Conservative alternative:** `everydocket.com`. Free, a `.com`, and it reads as the product rather
than as a campaign. It is the pick if the deliverability question above outweighs the elegance of
an apex-as-brand-name. `runthedocket.com` is the third choice — closest to the tagline, but three
words is a lot to say out loud, and imperative product names age quickly.

### Athena → `athena.day`

Athena's job is the day: she plans it, works it, and reports on it. `athena.day` says that in two
syllables, keeps the agent's identity separate from Docket's (constraint 3) without implying she is
a different company, and is the only free candidate where the apex is just her name.

The concrete thing it buys is the mail identity. The interim inbound-mail host contemplated by the
plan is a subdomain of the studio apex; with this pick it becomes `inbox.athena.day`, and the
outbound sender becomes something like `Athena <no-reply@athena.day>` — a domain the product owns,
which is exactly what GEN-28 requires.

**Register `athenaday.com` at the same time** as a defensive pairing (it is free, it is cheap, and
it redirects). **Conservative alternative:** `athenaday.com` as the primary instead, with the same
reasoning as the Docket fallback.

## 6. What these checks do and do not prove

- A `No match for domain` from `whois.verisign-grs.com` is authoritative for `.com`: the registry
  itself says the name is not registered **as of 2026-08-02**. Names go fast; re-check at purchase.
- `NXDOMAIN` for `docket.place`, `athena.place`, and `athena.day` means the name is not in the
  parent zone. That is strong but not authoritative — a registered-and-undelegated domain looks the
  same from DNS. Confirm at a registrar's search box before assuming either is free.
- `SERVFAIL` for `heyathena.app` is evidence of nothing; it is recorded as inconclusive rather than
  quietly dropped.
- None of this is a price check. `.place` and `.day` are premium-tiered at some registrars, and a
  registry premium can be tens of times the base price for a short, obvious word — `athena.day`
  plausibly carries one.

**The next step is a purchase, and it is the author's to make.** Search the recommended name at a
registrar, confirm it is free and what tier it is priced at, and register it. Everything that
happens after that — DNS records, TLS, repo variables, cookie scope, the passkey RP ID, and the
mail domain — is written up step by step in `docs/engineering/domain-cutover.md`.
