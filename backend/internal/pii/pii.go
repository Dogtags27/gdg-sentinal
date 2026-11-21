// Package pii masks personal data in ticket text before it leaves the gateway (FS-15).
//
// The gateway masks subject and body separately, then reports the counts:
//
//	subject, se := pii.Mask(req.Subject)
//	body, be := pii.Mask(req.Body)
//	masked := pii.Merge(se, be) // -> response "pii": {"masked": [...]}
//
// The rules mirror frontend/src/api/mockEngine.js; testdata/cases.json is run by both test suites.
package pii

import (
	"regexp"
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
	// bounded: the match must not touch a word character or '-' on the left, or a word character on
	// the right. RE2 has no lookaround, so this is checked in code.
	bounded bool
	full    *regexp.Regexp // the pattern anchored at both ends, set in init for bounded rules
	// keep reports a match that looks like the pattern but is not PII.
	keep func(string) bool
}

// Order matters: an IBAN or card number must be replaced before the phone rule can claim its digits.
var rules = []rule{
	{kind: "EMAIL", re: regexp.MustCompile(`[\w.+-]+@[\w-]+\.[\w.-]+`)},
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

// Mask replaces emails, IBANs, card numbers and phone numbers with [EMAIL], [IBAN], [CARD] and [PHONE].
// Entities are returned in rule order and only for kinds that were found.
func Mask(text string) (string, []Entity) {
	found := []Entity{} // never nil, so JSON encodes [] rather than null
	for _, r := range rules {
		var n int
		text, n = apply(r, text)
		if n > 0 {
			found = append(found, Entity{Type: r.kind, Count: n})
		}
	}
	return text, found
}

// Merge adds up counts per type, keeping the order in which types first appear.
func Merge(lists ...[]Entity) []Entity {
	out := []Entity{}
	index := map[string]int{}
	for _, list := range lists {
		for _, e := range list {
			if i, ok := index[e.Type]; ok {
				out[i].Count += e.Count
				continue
			}
			index[e.Type] = len(out)
			out = append(out, e)
		}
	}
	return out
}

func apply(r rule, text string) (string, int) {
	var b strings.Builder
	count, last, pos := 0, 0, 0
	for pos <= len(text) {
		loc := find(r, text, pos)
		if loc == nil {
			break
		}
		start, end := loc[0], loc[1]
		m := text[start:end]
		if r.keep != nil && r.keep(m) {
			pos = end
			continue
		}
		b.WriteString(text[last:start])
		b.WriteString("[" + r.kind + "]")
		count++
		last, pos = end, end
	}
	if count == 0 {
		return text, 0
	}
	b.WriteString(text[last:])
	return b.String(), count
}

// find returns the leftmost match at or after pos. For bounded rules it tries each later start and,
// for a given start, the longest match that ends on a boundary, which is what a backtracking engine
// with (?<![\w-]) ... (?!\w) would pick.
func find(r rule, text string, pos int) []int {
	if !r.bounded {
		loc := r.re.FindStringIndex(text[pos:])
		if loc == nil {
			return nil
		}
		return []int{pos + loc[0], pos + loc[1]}
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
