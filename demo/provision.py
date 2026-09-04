"""Prepare the demo project after ``scistudio init`` has created it.

Run at image build time. Two steps:

1. Copy the agent contract pages into ``{project}/docs``. The copy is the
   point: ``get_doc`` and ``search_docs`` resolve only against ``{project}/docs``
   — deliberately, so a production agent cannot read the developer's source tree
   — and ``scistudio init`` does not create that directory. Without this step
   both tools answer "no docs/ directory is visible", and ``get_started`` sends
   the agent down six dead ends before it tries to write a block against a
   contract it was never able to read.

2. Scaffold ``workflows/main.yaml`` with a single canvas note. ``scistudio
   init`` (unlike the GUI ``create_project``) leaves the project with no
   ``main.yaml``, so the demo would open on a blank canvas. The note is the one
   thing a visitor arriving through ChatGPT sees first: it tells them the
   project is empty on purpose and hands them a starter prompt for their AI
   partner.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

# The canvas note the demo opens on. A visitor coming in through ChatGPT has no
# project picker and no idea what to type; this is the whole onboarding.
DEMO_NOTE = (
    "This is just an empty project. Ask your AI partner to get started "
    "(Remember to use Sol 5.6 high!): Find a single-cell RNA seq data and "
    "build a workflow to analyze it with SciStudio. Try separating steps "
    "into different blocks for the workflow"
)


def _scaffold_note_workflow(project_dir: Path) -> None:
    """Write ``workflows/main.yaml`` holding one ``_annotation`` note node."""
    from scistudio.workflow.definition import NodeDef, WorkflowDefinition
    from scistudio.workflow.serializer import save_yaml

    workflow = WorkflowDefinition(
        id="main",
        description="",
        nodes=[
            NodeDef(
                id="note-welcome",
                block_type="_annotation",
                config={
                    "params": {"text": DEMO_NOTE},
                    "style": {"width": 460, "height": 200},
                },
                layout={"x": 120, "y": 80},
            )
        ],
        edges=[],
    )
    target = project_dir / "workflows" / "main.yaml"
    target.parent.mkdir(parents=True, exist_ok=True)
    save_yaml(workflow, target)
    print("  workflows/main.yaml (canvas note)")


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

    _scaffold_note_workflow(project_dir)

    print(f"demo project ready at {project_dir} ({copied} contract pages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
