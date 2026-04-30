# Evidence: link href direct i18n ResourceURL downgrade

Command:

```bash
orb -m ubuntu -u root chroot --userspec=carlosgomez:carlosgomez /mnt/machines/angularvm \
  /usr/bin/env HOME=/home/carlosgomez USER=carlosgomez LOGNAME=carlosgomez \
  PATH=/usr/local/bin:/usr/bin:/bin:/opt/node-v22.22.2/bin \
  pnpm --dir /home/carlosgomez/angular exec bazelisk test \
  //packages/core/test/acceptance:acceptance \
  --test_output=errors \
  --test_filter='security research probe: link href i18n direct baseline'
```

The temporary test intentionally failed to dump JSON.

## Results

```json
[
  {
    "name": "plain-interpolation",
    "template": "<link href=\"{{httpUrl}}\">",
    "outcome": "throw",
    "error": "NG0904: unsafe value used in a resource URL context ..."
  },
  {
    "name": "plain-property",
    "template": "<link [href]=\"httpUrl\">",
    "outcome": "throw",
    "error": "NG0904: unsafe value used in a resource URL context ..."
  },
  {
    "name": "plain-attr",
    "template": "<link [attr.href]=\"httpUrl\">",
    "outcome": "throw",
    "error": "NG0904: unsafe value used in a resource URL context ..."
  },
  {
    "name": "i18n-interpolation",
    "template": "<link href=\"{{httpUrl}}\" i18n-href>",
    "outcome": "rendered",
    "href": "http://attacker.example/poc.js",
    "html": "<link href=\"http://attacker.example/poc.js\">"
  },
  {
    "name": "i18n-property",
    "template": "<link [href]=\"httpUrl\" i18n-href>",
    "outcome": "throw",
    "error": "NG0904: unsafe value used in a resource URL context ..."
  },
  {
    "name": "i18n-attr",
    "template": "<link [attr.href]=\"httpUrl\" i18n-href>",
    "outcome": "throw",
    "error": "NG0904: unsafe value used in a resource URL context ..."
  },
  {
    "name": "inside-i18n-interpolation",
    "template": "<div i18n><link href=\"{{httpUrl}}\"></div>",
    "outcome": "throw",
    "error": "NG0904: unsafe value used in a resource URL context ..."
  }
]
```

## Interpretation

The vulnerable shape is narrow but real:

- direct translated attribute interpolation: affected
- normal interpolation/property/attribute binding: protected
- same link inside translated block: protected

