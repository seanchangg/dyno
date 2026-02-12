---
id: skill-authoring
name: Skill Authoring Guide
description: How to write effective skill.md files for the Dyno agent
version: 1.0.0
author: Dyno
tags: [core, meta, authoring]
---

# Skill Authoring Guide

Skills are markdown files with YAML frontmatter that get injected into your system prompt. They give you domain knowledge, behavioral patterns, and specialized capabilities without modifying source code.

## Skill File Format

```markdown
---
id: my-skill-id
name: Human-Readable Name
description: Brief description of what this skill provides
version: 1.0.0
author: user
tags: [tag1, tag2]
---

# Skill Title

Your skill content here — instructions, examples, patterns, reference data.
```

## Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique kebab-case identifier (e.g. `data-analysis`) |
| `name` | Yes | Human-readable name |
| `description` | No | Brief summary |
| `version` | No | Semantic version (default: 1.0.0) |
| `author` | No | Who created it |
| `tags` | No | Categorization tags as array |

## Writing Effective Skills

### Good Skill Content
- **Domain knowledge** — terminology, concepts, relationships the agent should know
- **Behavioral patterns** — how to approach specific types of tasks
- **Templates** — structured formats for common outputs (reports, emails, code)
- **Decision trees** — when to use which approach
- **Reference data** — lookup tables, API endpoints, configuration values
- **Examples** — concrete input/output pairs showing expected behavior

### Skill Structure
1. Start with a clear purpose statement
2. Organize into logical sections with headers
3. Use bullet lists for instructions and rules
4. Include examples where behavior might be ambiguous
5. Keep it focused — one skill per domain/capability

## Best Practices

- **Keep skills focused** — one capability per skill, not a kitchen sink
- **Be specific** — "Format dates as YYYY-MM-DD" not "format dates properly"
- **Include examples** — show expected inputs and outputs
- **Version your skills** — bump the version when making significant changes
- **Use descriptive IDs** — `email-drafting` not `skill-1`
- **Stay under 50KB** — skills are injected into the system prompt, so brevity matters

## Anti-Patterns

- Don't duplicate tool documentation (that's in dyno-core)
- Don't include ephemeral data (use memory for that)
- Don't create skills for one-off tasks (use scripts instead)
- Don't put sensitive data in skills (they're stored in plain text)
- Don't override core agent behavior (dyno-core is protected)

## Skill Lifecycle

1. **Create** — `create_skill` when you notice a recurring pattern or domain need
2. **Test** — Skill takes effect on next connection (page refresh)
3. **Iterate** — `update_skill` to refine based on usage
4. **Prune** — `delete_skill` when no longer needed
5. **List** — `list_workspace_skills` to review what's active

## When to Create a Skill vs Other Tools

| Need | Use |
|------|-----|
| Recurring task automation | `save_script` |
| Persistent facts/notes | `save_memory` |
| Domain knowledge/patterns | `create_skill` |
| One-off code execution | `execute_code` |
| Dashboard customization | `ui_action` |
