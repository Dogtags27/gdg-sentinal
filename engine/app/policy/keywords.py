"""
DA-07: Bilingual Keyword Rules (EN & DE)
Defines high-precision regex patterns for security breaches, prompt injections,
unsupported financial/SLA demands, and legal/compliance inquiries.
"""

import re
from typing import Dict, List

# 1. Security Incidents (P1)
SECURITY_KEYWORDS_EN = [
    r"\bransomware\b", r"\bdata\s+breach\b", r"\bsecurity\s+breach\b",
    r"\bhacked\b", r"\bmalware\b", r"\bddos\b", r"\bcredential\s+leak\b",
    r"\bunauthorized\s+access\b", r"\bcompromised\s+account\b", r"\bphishing\s+attack\b",
    r"\bkeylogger\b", r"\bbackdoor\b", r"\bzero-day\b"
]

SECURITY_KEYWORDS_DE = [
    r"\bransomware\b", r"\bdatenpanne\b", r"\bsicherheitsvorfall\b",
    r"\berpressungstrojaner\b", r"\bgehackt\b", r"\bschadsoftware\b",
    r"\bunbefugter\s+zugriff\b", r"\bkompromittiert\b", r"\bpasswort-diebstahl\b",
    r"\bangriff\b", r"\bspionage\b"
]

# 2. Prompt Injections & Jailbreak Attempts (P2)
PROMPT_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions",
    r"disregard\s+(all\s+)?(previous|prior)\s+instructions",
    r"system\s+prompt",
    r"you\s+are\s+now\s+(in\s+)?(dan\s+mode|unfiltered|jailbroken)",
    r"new\s+rule:",
    r"developer\s+mode\s+enabled",
    r"output\s+your\s+instructions",
    r"repeat\s+the\s+prompt\s+above",
    r"ignoriere\s+(alle\s+)?vorherigen\s+anweisungen",
    r"vergiss\s+alle\s+regeln",
    r"zeige\s+(den\s+)?system\s+prompt"
]

# 3. Unsupported Requests & Guarantees (P2)
UNSUPPORTED_REQUEST_KEYWORDS = [
    r"\b100%\s+refund\b", r"\bfull\s+refund\b", r"\brefund\s+guarantee\b",
    r"\bcompensation\b", r"\bcash\s+payout\b", r"\bwire\s+transfer\b",
    r"\bbitcoin\b", r"\bcrypto\b", r"\bsla\s+payout\b", r"\bsla\s+guarantee\b",
    r"\bfinancial\s+damages\b", r"\berstattung\b", r"\brückerstattung\b",
    r"\bentschädigung\b", r"\bschadenersatz\b", r"\bgeld\s+zurück\b"
]

# 4. Legal & Compliance Inquiries (P2)
LEGAL_KEYWORDS = [
    r"\blawyer\b", r"\battorney\b", r"\blawsuit\b", r"\bsue\s+you\b",
    r"\bcourt\b", r"\blegal\s+action\b", r"\bsubpoena\b", r"\bgdpr\b",
    r"\bdsgvo\b", r"\barticle\s+17\b", r"\bright\s+to\s+be\s+forgotten\b",
    r"\bdata\s+protection\s+officer\b", r"\banwalt\b", r"\brechtsanwalt\b",
    r"\bklage\b", r"\bgericht\b", r"\bvorladung\b", r"\blöschanspruch\b",
    r"\bdatenschutzbeauftragter\b"
]

def compile_patterns(patterns: List[str]) -> re.Pattern:
    combined = "|".join(f"(?:{p})" for p in patterns)
    return re.compile(combined, re.IGNORECASE)

PATTERNS: Dict[str, re.Pattern] = {
    "SECURITY_EN": compile_patterns(SECURITY_KEYWORDS_EN),
    "SECURITY_DE": compile_patterns(SECURITY_KEYWORDS_DE),
    "PROMPT_INJECTION": compile_patterns(PROMPT_INJECTION_PATTERNS),
    "UNSUPPORTED_REQUEST": compile_patterns(UNSUPPORTED_REQUEST_KEYWORDS),
    "LEGAL": compile_patterns(LEGAL_KEYWORDS)
}

def match_keywords(text: str) -> Dict[str, List[str]]:
    matches = {}
    for category, pat in PATTERNS.items():
        found = [m.group(0) for m in pat.finditer(text)]
        if found:
            matches[category] = found
    return matches
