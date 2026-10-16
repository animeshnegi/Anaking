"""
Conjoint helpers: balanced design generation, task normalisation and per-respondent
randomisation of task order / alternative positions.
"""

from __future__ import annotations

import random


def make_conjoint(attributes: list, n_tasks: int = 9, seed: int = 1,
                  n_alts: int = 3) -> dict:
    """Generate a main-effects balanced choice design.

    1. Level balance - for every attribute, its levels are dealt out across the
       ``n_tasks * n_alts`` profiles as evenly as possible (a seeded shuffle of a cyclic
       sequence), so each level is seen (almost) equally often.
    2. Dominance repair - if one alternative in a task is at least as good as another on
       every attribute, the two alternatives *swap* a level. Swapping keeps the level
       counts from step 1 intact while breaking the dominance, so respondents always face
       a genuine trade-off. ``higher_is_bad`` marks attributes such as price or toxicity.
    3. Within a task no two alternatives are identical.

    An attribute flagged ``group_inclusion`` is shown in a rotating subset of the tasks
    instead of every one - its levels are balanced across the tasks it does appear in, and
    the tasks it is absent from carry no value for it (see ``groups`` in the result).
    """
    if not attributes:
        raise ValueError("at least one attribute is required")
    rng = random.Random(seed)
    attrs = [a["id"] for a in attributes]
    levels = {a["id"]: list(a["levels"]) for a in attributes}
    L = {a: len(levels[a]) for a in attrs}
    if any(L[a] < 2 for a in attrs):
        raise ValueError("every attribute needs at least two levels")
    higher_bad = {a["id"]: bool(a.get("higher_is_bad", False)) for a in attributes}
    n_profiles = n_tasks * n_alts

    # Group inclusion: such an attribute appears in a rotating half of the tasks, so its
    # levels are balanced over the tasks it is in rather than over all of them.
    grouped = {a["id"] for a in attributes if a.get("group_inclusion")}
    groups = {}
    for idx, a in enumerate(attrs):
        if a in grouped:
            offset = idx % 2
            groups[a] = [t for t in range(n_tasks) if (t + offset) % 2 == 0] or list(range(n_tasks))

    def shown(a, t):
        return a not in grouped or t in groups[a]

    # 1. balanced columns - levels cycle evenly through the slots the attribute is shown in,
    # then get one seeded shuffle so no pattern is visible across tasks
    columns = {}
    for a in attrs:
        slots = [t * n_alts + k for t in range(n_tasks) if shown(a, t) for k in range(n_alts)]
        vals = [i % L[a] for i in range(len(slots))]
        rng.shuffle(vals)
        col = [0] * n_profiles                        # hidden slots: masked to None below
        for slot, v in zip(slots, vals):
            col[slot] = v
        columns[a] = col
    tasks = [[{a: columns[a][t * n_alts + k] for a in attrs if shown(a, t)}
              for k in range(n_alts)] for t in range(n_tasks)]
    # attributes are positional: keep every profile's key order the same for the exporter
    for task in tasks:
        for p in task:
            for a in attrs:
                p.setdefault(a, None)

    def good(p, a):  # higher = better value
        return L[a] - 1 - p[a] if higher_bad[a] else p[a]

    def shared(x, y):                       # attributes both profiles actually show
        return [a for a in attrs if x.get(a) is not None and y.get(a) is not None]

    def dominates(x, y):
        both = shared(x, y)
        if not both:
            return False
        gx = [good(x, a) for a in both]
        gy = [good(y, a) for a in both]
        return all(gx[i] >= gy[i] for i in range(len(both))) and gx != gy

    def violations(task):
        n = 0
        for i in range(n_alts):
            for j in range(n_alts):
                if i != j and (task[i] == task[j] or dominates(task[i], task[j])):
                    n += 1
        return n

    # 2./3. local search: swap one attribute's level between any two profiles (this never
    # changes the overall level counts) and keep the swap whenever it lowers the number of
    # dominated / duplicate pairs. Profiles are drawn from the worst tasks first.
    profiles = [(t, k) for t in range(n_tasks) for k in range(n_alts)]
    scores = [violations(task) for task in tasks]
    total = sum(scores)
    for _ in range(4000):
        if total == 0:
            break
        bad_tasks = [t for t in range(n_tasks) if scores[t]]
        t1 = rng.choice(bad_tasks)
        t2, k2 = rng.choice(profiles)
        k1 = rng.randrange(n_alts)
        if (t1, k1) == (t2, k2):
            continue
        if not shared(tasks[t1][k1], tasks[t2][k2]):
            continue
        a = rng.choice(shared(tasks[t1][k1], tasks[t2][k2]))
        tasks[t1][k1][a], tasks[t2][k2][a] = tasks[t2][k2][a], tasks[t1][k1][a]
        new1, new2 = violations(tasks[t1]), violations(tasks[t2])
        old = scores[t1] + (scores[t2] if t2 != t1 else 0)
        new = new1 + (new2 if t2 != t1 else 0)
        if new <= old:
            scores[t1], scores[t2] = new1, new2
            total += new - old
        else:
            tasks[t1][k1][a], tasks[t2][k2][a] = tasks[t2][k2][a], tasks[t1][k1][a]

    counts = {a: {i: 0 for i in range(L[a])} for a in attrs}
    for task in tasks:
        for p in task:
            for a in attrs:
                if p.get(a) is not None:
                    counts[a][p[a]] += 1
    # the design carries what the editor authored, so the survey renderer can show real labels
    meta = {a["id"]: a for a in attributes}
    return {
        "attributes": [{"id": a, "label": meta.get(a, {}).get("label") or a,
                        "levels": levels[a], "images": meta.get(a, {}).get("images") or [],
                        "higher_is_bad": bool(higher_bad[a]),
                        "group_inclusion": a in grouped} for a in attrs],
        "levels": levels, "tasks": tasks, "has_opt_out": True, "balance": counts,
        "groups": {a: groups[a] for a in grouped},
        "n_tasks": n_tasks, "n_alts": n_alts,
    }


def profile_levels(alt, attrs: list) -> dict:
    """``{attribute_id: level_index or None}`` for one alternative, whatever shape it has.

    Generated designs store ``levels`` positionally (aligned to the design's ``attributes``,
    ``None`` where a group-inclusion attribute is hidden in that task); designs authored
    through the conjoint editor may key them by attribute id instead. Both are read here so
    the export never has to guess.
    """
    # a bare ``{attr_id: level}`` profile (the shape the generator returns) is its own mapping
    lv = alt["levels"] if isinstance(alt, dict) and isinstance(alt.get("levels"), (list, dict)) \
        else alt
    if isinstance(lv, dict):
        return {a: lv.get(a) for a in attrs}
    lv = lv or []
    return {a: (lv[i] if i < len(lv) else None) for i, a in enumerate(attrs)}


def task_list(design: dict) -> list:
    """Conjoint tasks may be stored as a list (generated designs) or as a dict keyed by
    task number (the beacon seed). Always return a list in task order."""
    t = design["tasks"]
    if isinstance(t, dict):
        return [t[k] for k in sorted(t, key=lambda x: int(x))]
    return t


def assignment_for(code: str, design: dict, task_map: dict | None) -> dict:
    tl = task_list(design)
    n_tasks = len(tl)
    n_alts = len(tl[0])
    if task_map and code in task_map:
        return task_map[code]
    rng = random.Random("beacon:" + code)
    order = list(range(1, n_tasks + 1))
    rng.shuffle(order)
    positions = {}
    for t in order:
        p = list(range(1, n_alts + 1))
        rng.shuffle(p)
        positions[str(t)] = p
    return {"task_order": order, "alt_positions": positions}
