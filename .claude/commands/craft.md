---
name: "craft"
version: "11.1.0"
description: |
  Generate UI components with design physics.
  Infers effect type from keywords and applies correct physics automatically.

arguments:
  - name: "description"
    type: "string"
    required: true
    description: "What to build (e.g., 'claim button', 'like button', 'dark mode toggle')"
    examples: ["claim button", "like button for posts", "delete with undo", "dark mode toggle"]

agent: "crafting-components"
agent_path: "skills/crafting-components/"

context_files:
  - path: "grimoires/sigil/constitution.yaml"
    required: false
    purpose: "Physics definitions and keywords"
  - path: "examples/components/"
    required: false
    purpose: "Reference implementations"

mode:
  default: "foreground"
---

# /craft

Generate design-aware UI components with correct physics.

## Invocation

```
/craft "claim button"
/craft "like button for posts"
/craft "delete with undo"
/craft "dark mode toggle"
```

## Agent

Launches `crafting-components` from `skills/crafting-components/`.

See: `skills/crafting-components/SKILL.md` for full workflow details.

## Physics Inference

| Keywords | Effect | Sync | Timing |
|----------|--------|------|--------|
| claim, deposit, withdraw, transfer | Financial | Pessimistic | 800ms |
| delete, remove, destroy | Destructive | Pessimistic | 600ms |
| save, update, like, follow | Standard | Optimistic | 200ms |
| toggle, switch, expand | Local state | Immediate | 100ms |

## Examples

```
/craft "trustworthy claim button"
→ Financial: pessimistic sync, 800ms, two-phase confirmation

/craft "like button"
→ Standard: optimistic sync, 200ms, no confirmation

/craft "dark mode toggle"
→ Local: immediate, 100ms spring animation
```

## Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `description` | Natural language description of component | Yes |

## Outputs

Generated component code with:
- Correct sync strategy (pessimistic/optimistic/immediate)
- Appropriate timing and animations
- Confirmation dialogs where required
- Error handling and loading states

<user-request>
$ARGUMENTS
</user-request>
