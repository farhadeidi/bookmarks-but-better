---
# Keys the user cares about come first.
bbb_id: d4e5f6a7   # do not touch this

bbb_url: https://example.com/a,b(c)   # trailing comment
bbb_title: Commented
bbb_created: 2026-04-05T12:00:00Z
bbb_updated: 2026-04-05T12:00:00Z

# An unknown block scalar the vault must never rewrite.
description: |
  Line one.
  Line two.
nested:
  a: 1
  b:
    - deep
# Trailing comment inside the front matter.
---
Body.
