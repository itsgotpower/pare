"""Statement parse orchestrator.

Phase 1 (see internal/self-improving-parser-plan.md): Tier-1 only — route a PDF
to its registered parser and attach statement metadata, reproducing the original
`parse_statements.main()` loop body exactly. Tiers 2 (verifier-gated LLM
fallback) and 3 (human review), plus the promotion flywheel, are specified in the
plan and not yet wired here.

`text_fn` and `meta_fn` are injected (`parse_statements.text` and
`parse_statements.statement_meta`) so this module stays decoupled from
parse_statements and there is no second module copy when the parser runs as a
script.
"""
import registry


def parse_file(path, *, text_fn, meta_fn):
    """Route one PDF and parse it.

    Returns ``(rows, meta)`` for a recognised statement, or ``None`` if no parser
    matches (the caller skips it, exactly as the old ``else: continue`` did).
    Metadata comes from the selected parser's own ``meta`` when it registered one
    (built-ins and scaffolds both do — no second detection pass); ``meta_fn``
    (statement_meta, which re-detects) is the fallback for parsers without one.
    """
    parser = registry.select(text_fn(path))
    if parser is None:
        return None
    rows = parser.parse(path)
    meta = parser.meta(path) if parser.meta is not None else meta_fn(path)
    return rows, meta
