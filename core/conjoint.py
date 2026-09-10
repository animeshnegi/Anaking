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

    # 1. balanced columns
    columns = {}
    for a in attrs:
        col = [i % L[a] for i in range(n_profiles)]
        rng.shuffle(col)
        columns[a] = col
    tasks = [[{a: columns[a][t * n_alts + k] for a in attrs} for k in range(n_alts)]
             for t in range(n_tasks)]

    def good(p, a):  # higher = better value
        return L[a] - 1 - p[a] if higher_bad[a] else p[a]

    def dominates(x, y):
        gx = [good(x, a) for a in attrs]
        gy = [good(y, a) for a in attrs]
        return all(gx[i] >= gy[i] for i in range(len(attrs))) and gx != gy

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
        a = rng.choice(attrs)
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
                counts[a][p[a]] += 1
    return {"attributes": attrs, "levels": levels, "tasks": tasks,
            "has_opt_out": True, "balance": counts,
            "n_tasks": n_tasks, "n_alts": n_alts}


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
