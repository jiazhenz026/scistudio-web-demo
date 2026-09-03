"""Copy the agent contract pages into the demo project's ``docs/``.

Run at image build time, after ``scistudio init`` has created the project.

The copy is the point. ``get_doc`` and ``search_docs`` resolve only against
``{project}/docs`` — deliberately, so a production agent cannot read the
developer's source tree — and ``scistudio init`` does not create that
directory. Without this step both tools answer "no docs/ directory is visible",
and ``get_started`` sends the agent down six dead ends before it tries to write
a block against a contract it was never able to read.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path


def main() -> int:
    project_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "/data/demo")
    if not project_dir.is_dir():
        print(f"error: {project_dir} does not exist; run 'scistudio init' first", file=sys.stderr)
        return 1

    import scistudio

    reference = Path(scistudio.__file__).parent / "_agent_reference"
    docs = project_dir / "docs"
    docs.mkdir(exist_ok=True)

    copied = 0
    for page in sorted(reference.glob("*.md")):
        shutil.copy2(page, docs / page.name)
        print(f"  docs/{page.name}")
        copied += 1

    if copied == 0:
        print("error: no reference pages found to copy", file=sys.stderr)
        return 1

    print(f"demo project ready at {project_dir} ({copied} contract pages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
