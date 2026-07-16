"""Parser registry — the routing layer for the statement parser.

Phase 1 of the self-improving parser (see internal/self-improving-parser-plan.md):
this replaces the if/elif type-routing that used to live in
`parse_statements.main()`. Each institution parser registers with a `matches`
predicate (run against the `pdftotext` output) and a `priority`. `select()`
returns the lowest-priority parser whose `matches` is true, which reproduces the
original precedence exactly:

    Visa (10)  ->  chequing (20)  ->  Amex fallback (90)

Order matters because CIBC chequing statements contain the text "American
Express" (Amex card-payment lines), so the specific CIBC titles must be checked
before the Amex fallback.

Synthesised parsers (Tier-2 promotions) will register here too, with their own
priorities and fingerprints — not yet wired (see the plan, section 4.5).
"""
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Set


@dataclass
class Parser:
    id: str
    priority: int
    matches: Callable[[str], bool]
    parse: Callable[[str], list]          # takes a PDF path, returns canonical rows
    meta: Optional[Callable[[str], dict]] = None  # statement metadata (built-ins + scaffolds carry their own; the orchestrator prefers it)
    origin: str = "builtin"
    fingerprints: Set[str] = field(default_factory=set)


_REGISTRY: List[Parser] = []


def register(parser: Parser) -> None:
    """Add a parser, keeping the registry ordered by ascending priority."""
    _REGISTRY[:] = sorted([*_REGISTRY, parser], key=lambda p: p.priority)


def select(text: str) -> Optional[Parser]:
    """Lowest-priority parser whose `matches` predicate is true, else None."""
    for parser in _REGISTRY:
        if parser.matches(text):
            return parser
    return None


def all_parsers() -> List[Parser]:
    return list(_REGISTRY)


def register_builtins(mod) -> None:
    """Register the three built-in institution parsers from `mod` (the live
    parse_statements module). Idempotent, so repeated main()/test calls are safe.

    `mod` is passed in rather than imported so there is no second copy of
    parse_statements when it runs as a script (its module name is then
    ``__main__``, not ``parse_statements``).
    """
    if any(p.origin == "builtin" for p in _REGISTRY):
        return
    register(Parser("cibc_visa", 10,
                    matches=mod._detect_cibc_visa,
                    parse=mod.parse_cibc_visa,
                    meta=mod._cibc_visa_meta))
    register(Parser("cibc_chequing", 20,
                    matches=mod._detect_cibc_chequing,
                    parse=mod.parse_cibc_chequing,
                    meta=mod._cibc_chequing_meta))
    register(Parser("amex", 90,
                    matches=mod._detect_amex,
                    parse=mod.parse_amex,
                    meta=mod._amex_meta))


def register_scaffolds(mod) -> None:
    """Register the SCAFFOLDED banks from ``mod._SCAFFOLD_BANKS`` (RBC / TD /
    Scotia / BMO / Tangerine / Wealthsimple). Idempotent. Their priorities
    (30–41) place them between CIBC chequing (20) and the Amex fallback (90), so
    the Amex fallback stays last. Each scaffold carries its own ``detect`` /
    ``parse`` / ``meta`` — the same trio ``statement_meta()`` reads directly, so
    routing (here) and metadata stay in sync from one source of truth.
    """
    if any(p.origin == "scaffold" for p in _REGISTRY):
        return
    for b in mod._SCAFFOLD_BANKS:
        register(Parser(b.id, b.priority, matches=b.detect, parse=b.parse,
                        meta=b.meta, origin="scaffold"))
