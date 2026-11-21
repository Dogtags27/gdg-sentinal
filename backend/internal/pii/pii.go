// Package pii masks personal data in ticket text before it leaves the gateway (FS-15).
//
// Placeholders follow contracts/README.md: typed and numbered ([EMAIL_1], [PHONE_2], ...), with one
// numbering per ticket so subject and body agree and a repeated value keeps its number:
//
//	m := pii.NewMasker()
//	subject, body := m.Mask(req.Subject), m.Mask(req.Body)
//	masked := m.Entities() // -> response "pii": {"masked": [...]}
//
// The rules mirror frontend/src/api/mockEngine.js; testdata/cases.json is run by both test suites.
package pii

import (
	"regexp"
	"strconv"
	"strings"
)

// Entity reports how many values of one kind were replaced, e.g. {"type":"EMAIL","count":2}.
type Entity struct {
	Type  string `json:"type"`
	Count int    `json:"count"`
}

type rule struct {
	kind string
	re   *regexp.Regexp
	// group, when set, masks only that capture group (the account number, not its label).
	group int
	// bounded: the match must not touch a word character or '-' on the left, or a word character on
	// the right. RE2 has no lookaround, so this is checked in code.
	bounded bool
	full    *regexp.Regexp // the pattern anchored at both ends, set in init for bounded rules
	// keep reports a match that looks like the pattern but is not PII.
	keep func(string) bool
}

// Order matters: each rule runs on the output of the previous ones, so the specific shapes (IBAN, card,
// labelled account numbers, IPs) are replaced before the phone rule can claim their digits.
var rules = []rule{
	{kind: "EMAIL", re: regexp.MustCompile(`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`)},
	// Compact or 4-spaced; the last group can be shorter (German IBANs end in a 2-character group).
	{kind: "IBAN", re: regexp.MustCompile(`\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b`)},
	{
		kind: "CARD",
		re:   regexp.MustCompile(`\b(?:\d[ -]?){12,18}\d\b`),
		// Grouped numbers are always masked (a mistyped card is still card data); a bare digit run must pass
		// the Luhn check, so long order numbers stay readable.
		keep: func(m string) bool { return !strings.ContainsAny(m, " -") && !luhn(digitsOf(m)) },
	},
	{
		kind:  "ACCOUNT",
		re:    regexp.MustCompile(`(?i)\b(account\s*(?:number|no\.?|nr\.?|#)|customer\s*(?:number|no\.?|id)|contract\s*(?:number|no\.?)|kontonummer|konto-?nr\.?|kundennummer|kunden-?nr\.?|vertragsnummer|vertrags-?nr\.?)(\s*(?:is\s+)?[:#]?\s*)([A-Z0-9][A-Z0-9-]{3,23})\b`),
		group: 3,
		// The value must contain a digit, so "customer number is missing" stays as it is.
		keep: func(m string) bool { return !strings.ContainsAny(m, "0123456789") },
	},
	{kind: "IP", re: regexp.MustCompile(`\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b`)},
	{
		kind:    "PHONE",
		re:      regexp.MustCompile(`(?:\+\d{1,3}[\s-]?)?\(?0?\d{2,4}\)?[\s\-/]?\d{3,4}[\s-]?\d{3,5}`),
		bounded: true,
		// A bare digit run such as an order number is not a phone: it needs +, (, a leading 0, or separators.
		keep: func(m string) bool {
			return !strings.ContainsAny(m[:1], "+(0") && !strings.ContainsAny(m, " \t\n\r\f-/)")
		},
	},
}

// maxBounded caps how far past a start a bounded match can end; phone numbers are far shorter.
const maxBounded = 40

func init() {
	for i := range rules {
		if rules[i].bounded {
			rules[i].full = regexp.MustCompile(`^(?:` + rules[i].re.String() + `)$`)
		}
	}
}

// Masker masks the fields of one ticket with shared numbering. It is not safe for concurrent use.
type Masker struct {
	numbers map[string]map[string]int // type -> value -> placeholder number
	counts  map[string]int            // type -> occurrences masked
}

func NewMasker() *Masker {
	return &Masker{numbers: map[string]map[string]int{}, counts: map[string]int{}}
}

// Mask replaces emails, IBANs, card numbers, labelled account numbers, IPv4 addresses and phone numbers.
func (m *Masker) Mask(text string) string {
	for _, r := range rules {
		text = m.apply(r, text)
	}
	return text
}

// Entities lists the masked types in rule order with their counts; never nil, so JSON encodes [] not null.
func (m *Masker) Entities() []Entity {
	out := []Entity{}
	for _, r := range rules {
		if n := m.counts[r.kind]; n > 0 {
			out = append(out, Entity{Type: r.kind, Count: n})
		}
	}
	return out
}

// Mask masks a single text with its own numbering.
func Mask(text string) (string, []Entity) {
	m := NewMasker()
	out := m.Mask(text)
	return out, m.Entities()
}

func (m *Masker) placeholder(kind, value string) string {
	byValue := m.numbers[kind]
	if byValue == nil {
		byValue = map[string]int{}
		m.numbers[kind] = byValue
	}
	n, ok := byValue[value]
	if !ok {
		n = len(byValue) + 1
		byValue[value] = n
	}
	m.counts[kind]++
	return "[" + kind + "_" + strconv.Itoa(n) + "]"
}

func (m *Masker) apply(r rule, text string) string {
	var b strings.Builder
	last, pos := 0, 0
	for pos <= len(text) {
		loc := find(r, text, pos)
		if loc == nil {
			break
		}
		start, end := loc[0], loc[1]
		if r.group > 0 {
			start, end = loc[2*r.group], loc[2*r.group+1]
		}
		value := text[start:end]
		if r.keep != nil && r.keep(value) {
			pos = loc[1]
			continue
		}
		b.WriteString(text[last:start])
		b.WriteString(m.placeholder(r.kind, value))
		last, pos = end, loc[1]
	}
	if last == 0 {
		return text
	}
	b.WriteString(text[last:])
	return b.String()
}

// find returns the leftmost match at or after pos as submatch indexes (whole match first). For bounded
// rules it tries each later start and, for a given start, the longest match that ends on a boundary,
// which is what a backtracking engine with (?<![\w-]) ... (?!\w) would pick.
func find(r rule, text string, pos int) []int {
	if !r.bounded {
		loc := r.re.FindStringSubmatchIndex(text[pos:])
		for i := range loc {
			if loc[i] >= 0 {
				loc[i] += pos
			}
		}
		return loc
	}
	for {
		loc := r.re.FindStringIndex(text[pos:])
		if loc == nil {
			return nil
		}
		start := pos + loc[0]
		if start == 0 || !isWord(text[start-1]) && text[start-1] != '-' {
			if end := longestBounded(r.full, text, start); end > start {
				return []int{start, end}
			}
		}
		pos = start + 1
		if pos > len(text) {
			return nil
		}
	}
}

// longestBounded returns the end of the longest full match of re starting at start that is followed by
// a non-word character or the end of the text, or start if there is none.
func longestBounded(re *regexp.Regexp, text string, start int) int {
	for end := min(len(text), start+maxBounded); end > start; end-- {
		if end < len(text) && isWord(text[end]) {
			continue
		}
		if re.MatchString(text[start:end]) {
			return end
		}
	}
	return start
}

func isWord(c byte) bool {
	return c == '_' || c >= '0' && c <= '9' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z'
}

func digitsOf(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] >= '0' && s[i] <= '9' {
			b.WriteByte(s[i])
		}
	}
	return b.String()
}

func luhn(digits string) bool {
	sum := 0
	for i := 0; i < len(digits); i++ {
		d := int(digits[len(digits)-1-i] - '0')
		if i%2 == 1 {
			if d *= 2; d > 9 {
				d -= 9
			}
		}
		sum += d
	}
	return len(digits) > 0 && sum%10 == 0
}
