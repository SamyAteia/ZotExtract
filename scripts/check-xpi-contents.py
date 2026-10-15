#!/usr/bin/env python3
import sys
import zipfile


FORBIDDEN_SUFFIXES = (".stackdump", ".map")
FORBIDDEN_EXACT = {"content/zotextract-e2e.js"}
REQUIRED_EXACT = {
    "content/zotextract.js",
    "content/zotextract-window.js",
    "content/zotextract.css",
    "content/zotextract-data.js",
    "content/zotextract-context.js",
    "content/zotextract-quote-recovery.js",
    "content/zotextract-runner.js",
    "content/zotextract-window-ui.js",
    "content/zotextract-session-ui.js",
    "content/zotextract-evidence-ui.js",
    "content/zotextract-progress.js",
    "content/zotextract-provider-runtime.js",
    "content/zotextract-session-export.js",
}


def main() -> int:
    archive = sys.argv[1] if len(sys.argv) > 1 else "zotextract.xpi"
    with zipfile.ZipFile(archive) as zf:
        names = zf.namelist()
    forbidden = [
        name for name in names
        if name in FORBIDDEN_EXACT or name.endswith(FORBIDDEN_SUFFIXES)
    ]
    missing = sorted(REQUIRED_EXACT.difference(names))
    if forbidden:
        print("Forbidden files found in archive:", file=sys.stderr)
        for name in forbidden:
            print(f"  {name}", file=sys.stderr)
        return 1
    if missing:
        print("Required files missing from archive:", file=sys.stderr)
        for name in missing:
            print(f"  {name}", file=sys.stderr)
        return 1
    print(f"{archive}: {len(names)} entries checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
