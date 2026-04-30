# Evidence: A16 ICU Attribute Normalization Matrix

Date: 2026-04-29

Command:

```bash
bazelisk --output_user_root=/tmp/vulnhunter-bazel-user test \
  //packages/core/test/render3:render3 \
  --test_output=errors \
  --test_filter='A16 probe'
```

The temporary test intentionally failed to dump the matrix.

## Result Matrix

```json
[
  {
    "name": "uppercase-href",
    "input": "<a HREF=\"https://attacker.test/upper\">upper</a>",
    "outcome": "rendered",
    "html": "<a href=\"unsafe:blocked\">upper</a><!--ICU 27:0-->"
  },
  {
    "name": "tab-before-equals-href",
    "input": "<a href\\t=\"https://attacker.test/tab\">tab</a>",
    "outcome": "rendered",
    "html": "<a href=\"unsafe:blocked\">tab</a><!--ICU 27:0-->"
  },
  {
    "name": "newline-before-equals-src",
    "input": "<img src\\n=\"https://attacker.test/newline.png\">",
    "outcome": "rendered",
    "html": "<img src=\"unsafe:blocked\"><!--ICU 27:0-->"
  },
  {
    "name": "null-in-attr-name",
    "input": "<a href\\u0000=\"https://attacker.test/null\">null</a>",
    "outcome": "rendered",
    "html": "<a>null</a><!--ICU 27:0-->"
  },
  {
    "name": "entity-in-attr-name",
    "input": "<a h&#114;ef=\"https://attacker.test/entity\">entity</a>",
    "outcome": "rendered",
    "html": "<a>entity</a><!--ICU 27:0-->"
  },
  {
    "name": "xlink-href-uppercase",
    "input": "<a XLINK:HREF=\"https://attacker.test/xlink\">xlink</a>",
    "outcome": "rendered",
    "html": "<a xlink:href=\"unsafe:blocked\">xlink</a><!--ICU 27:0-->"
  },
  {
    "name": "style-attribute",
    "input": "<div style=\"background-image:url(https://attacker.test/style.png)\">style</div>",
    "outcome": "rendered",
    "html": "<div>style</div><!--ICU 27:0-->"
  },
  {
    "name": "iframe-srcdoc",
    "input": "<iframe srcdoc=\"<script>top.__A16=1</script>\">fallback</iframe>",
    "outcome": "rendered",
    "html": "<!--ICU 27:0-->"
  },
  {
    "name": "svg-style-mutation-shape",
    "input": "<svg><p><style><img src=\"</style><img src=x onerror=alert(1)//\"></style></p></svg>",
    "outcome": "rendered",
    "html": "<!--ICU 27:0-->"
  },
  {
    "name": "picture-source-srcset",
    "input": "<picture><source srcset=\"https://attacker.test/source-1x.png 1x\"><img alt=\"x\"></picture>",
    "outcome": "rendered",
    "html": "<picture><source srcset=\"https://attacker.test/source-1x.png 1x\"><img alt=\"x\"></picture><!--ICU 27:0-->"
  },
  {
    "name": "img-srcset-javascript",
    "input": "<img srcset=\"/safe.png 1x, javascript:alert(1) 2x\">",
    "outcome": "rendered",
    "html": "<img srcset=\"/safe.png 1x, javascript:alert(1) 2x\"><!--ICU 27:0-->"
  },
  {
    "name": "video-source-srcset",
    "input": "<video><source srcset=\"https://attacker.test/video-1x.mp4 1x\"></video>",
    "outcome": "rendered",
    "html": "<video><source srcset=\"https://attacker.test/video-1x.mp4 1x\"></video><!--ICU 27:0-->"
  }
]
```

## Interpretation

Parser-normalization bypasses close:

- uppercase `href` normalizes to `href` and is blocked.
- whitespace before `=` still normalizes to `href` / `src` and is blocked.
- null-byte and entity-spelled attribute names become unknown and are dropped.
- uppercase `xlink:href` normalizes and is blocked.
- `style`, `iframe`, and SVG mutation shapes are dropped by the allowlist.

Residual:

- `srcset` survives on `picture/source`, `img`, and `video/source`, matching A10's `img[srcset]`
  primitive and Angular's existing sanitizer posture for `srcset`.
